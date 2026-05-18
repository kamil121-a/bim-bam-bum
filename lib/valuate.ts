import OpenAI from 'openai';
import type { AssetCategory } from '@/types';

const VALID_CATEGORIES: AssetCategory[] = [
  'Elektronika',
  'Finanse',
  'Nieruchomości',
  'Inne',
];

export interface ValuationResult {
  estimatedValue: number; // total = unitPrice × quantity
  unitPrice: number;      // price for 1 unit
  currency: 'PLN';
  confidence: 'high' | 'medium' | 'low';
  source: string;
  suggestedCategory: AssetCategory;
  reasoning: string;
}

const SYSTEM_PROMPT = `Jesteś ekspertem wyceny majątku na polskim rynku w 2026 roku. \
Użytkownik poda Ci nazwę aktywa/przedmiotu ORAZ ilość jednostek. \
Twoim zadaniem jest oszacowanie aktualnej wartości rynkowej w polskich złotych (PLN).

Odpowiadaj WYŁĄCZNIE w formacie JSON (bez żadnego dodatkowego tekstu):
{
  "unit_price": <cena za 1 jednostkę, liczba całkowita PLN>,
  "value": <unit_price × quantity, liczba całkowita PLN>,
  "category": "<jedna z: Elektronika, Finanse, Nieruchomości, Inne>",
  "reasoning": "<uzasadnienie wyceny 1-2 zdania po polsku>"
}

Wskazówki:
- Elektronika: używane ceny z OLX/Allegro dla konkretnego modelu
- Finanse (akcje, ETF, krypto, kruszce): aktualne kursy rynkowe PLN
- Nieruchomości: ceny PLN/m², domyślnie Warszawa gdy brak lokalizacji
- Pojazdy: ceny z OtoDom/OLX dla danego modelu
- unit_price i value zawsze > 0, liczby całkowite (bez groszy)`.trim();

function isValidCategory(cat: string): cat is AssetCategory {
  return VALID_CATEGORIES.includes(cat as AssetCategory);
}

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const makeErrorResult = (reason: string): ValuationResult => ({
  estimatedValue: 0,
  unitPrice: 0,
  currency: 'PLN',
  confidence: 'low',
  source: 'OpenAI gpt-4o-mini (błąd)',
  suggestedCategory: 'Inne',
  reasoning: reason,
});

export async function estimateValue(
  itemName: string,
  quantity: number = 1
): Promise<ValuationResult> {
  try {
    const openai = getOpenAI();
    const qty = Math.max(0.0001, quantity);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 256,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Wycen: "${itemName}" (ilość: ${qty})`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('Empty response from OpenAI');

    const parsed = JSON.parse(raw) as {
      unit_price?: unknown;
      value?: unknown;
      category?: unknown;
      reasoning?: unknown;
    };

    const unitPrice =
      typeof parsed.unit_price === 'number' && parsed.unit_price > 0
        ? Math.round(parsed.unit_price)
        : 0;

    const totalValue =
      typeof parsed.value === 'number' && parsed.value > 0
        ? Math.round(parsed.value)
        : unitPrice > 0
          ? Math.round(unitPrice * qty)
          : 0;

    const rawCategory = String(parsed.category ?? '');
    const category: AssetCategory = isValidCategory(rawCategory) ? rawCategory : 'Inne';

    const reasoning =
      typeof parsed.reasoning === 'string' && parsed.reasoning.length > 0
        ? parsed.reasoning
        : 'Wycena AI bez uzasadnienia.';

    if (totalValue === 0) {
      return makeErrorResult(
        'Model nie zwrócił wartości > 0. Sprawdź nazwę aktywa lub spróbuj ponownie.'
      );
    }

    return {
      estimatedValue: totalValue,
      unitPrice,
      currency: 'PLN',
      confidence: 'medium',
      source: 'OpenAI gpt-4o-mini',
      suggestedCategory: category,
      reasoning,
    };
  } catch (err) {
    console.error('[valuate] OpenAI error:', err);
    return makeErrorResult(
      'Nie udało się pobrać wyceny z OpenAI. Sprawdź klucz API lub wpisz dane ponownie.'
    );
  }
}
