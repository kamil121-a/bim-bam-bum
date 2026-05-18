import OpenAI from 'openai';
import type { AssetCategory } from '@/types';

const VALID_CATEGORIES: AssetCategory[] = [
  'Elektronika',
  'Finanse',
  'Nieruchomości',
  'Inne',
];

export interface ValuationResult {
  estimatedValue: number;
  currency: 'PLN';
  confidence: 'high' | 'medium' | 'low';
  source: string;
  suggestedCategory: AssetCategory;
  reasoning: string;
}

const SYSTEM_PROMPT = `Jesteś ekspertem wyceny majątku na polskim rynku w 2026 roku. \
Twoim zadaniem jest oszacowanie aktualnej wartości rynkowej podanego przedmiotu lub aktywa \
w polskich złotych (PLN).

Odpowiadaj WYŁĄCZNIE w formacie JSON (bez żadnego dodatkowego tekstu):
{
  "value": <liczba całkowita w PLN, większa niż 0>,
  "category": "<jedna z: Elektronika, Finanse, Nieruchomości, Inne>",
  "reasoning": "<uzasadnienie wyceny, 1-2 zdania po polsku>"
}

Wskazówki wyceny:
- Elektronika: używane ceny z OLX/Allegro dla konkretnego modelu i stanu
- Finanse (akcje, ETF, krypto, kruszce): aktualne ceny rynkowe (kurs PLN)
- Nieruchomości: ceny rynkowe PLN/m², domyślnie Warszawa gdy brak lokalizacji
- Pojazdy: ceny z OtoDom/OLX dla danego modelu, rocznika i przebiegu
- Wartość ZAWSZE > 0, nawet dla bardzo ogólnych opisów
- Wartość jako liczba całkowita (bez groszy)`.trim();

function isValidCategory(cat: string): cat is AssetCategory {
  return VALID_CATEGORIES.includes(cat as AssetCategory);
}

// Lazy-initialize the client so build-time imports don't throw without the key.
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const ERROR_RESULT: ValuationResult = {
  estimatedValue: 0,
  currency: 'PLN',
  confidence: 'low',
  source: 'OpenAI gpt-4o-mini (błąd)',
  suggestedCategory: 'Inne',
  reasoning:
    'Nie udało się pobrać wyceny z OpenAI. Sprawdź klucz API lub wpisz wartość ręcznie.',
};

export async function estimateValue(itemName: string): Promise<ValuationResult> {
  try {
    const openai = getOpenAI();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 256,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Wycen: "${itemName}"` },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('Empty response from OpenAI');

    const parsed = JSON.parse(raw) as {
      value?: unknown;
      category?: unknown;
      reasoning?: unknown;
    };

    const value =
      typeof parsed.value === 'number' && parsed.value > 0
        ? Math.round(parsed.value)
        : 0;

    const rawCategory = String(parsed.category ?? '');
    const category: AssetCategory = isValidCategory(rawCategory)
      ? rawCategory
      : 'Inne';

    const reasoning =
      typeof parsed.reasoning === 'string' && parsed.reasoning.length > 0
        ? parsed.reasoning
        : 'Wycena AI bez uzasadnienia.';

    if (value === 0) {
      return {
        ...ERROR_RESULT,
        source: 'OpenAI gpt-4o-mini',
        suggestedCategory: category,
        reasoning:
          'Model nie zwrócił wartości > 0. Sprawdź nazwę aktywa lub wpisz wartość ręcznie.',
      };
    }

    return {
      estimatedValue: value,
      currency: 'PLN',
      confidence: 'medium',
      source: 'OpenAI gpt-4o-mini',
      suggestedCategory: category,
      reasoning,
    };
  } catch (err) {
    console.error('[valuate] OpenAI error:', err);
    return ERROR_RESULT;
  }
}
