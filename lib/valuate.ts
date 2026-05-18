import OpenAI from 'openai';
import type { AssetCategory } from '@/types';

// ── Public interface ──────────────────────────────────────────────────────────

export interface ValuationResult {
  estimatedValue: number; // total = unitPrice × quantity
  unitPrice: number;      // price for 1 unit
  currency: 'PLN';
  confidence: 'high' | 'medium' | 'low';
  source: string;
  suggestedCategory: AssetCategory; // always a valid DB category
  aiCategory: string;               // raw AI label for display ("Giełda/Krypto" etc.)
  reasoning: string;
}

// ── Category mapping ──────────────────────────────────────────────────────────
// AI uses granular labels for accurate reasoning; we map them to DB categories.

const AI_TO_DB_CATEGORY: Record<string, AssetCategory> = {
  'Giełda/Krypto': 'Finanse',
  'Metale':        'Finanse',
  'Elektronika':   'Elektronika',
  'Nieruchomości': 'Nieruchomości',
  'Finanse':       'Finanse',
  'Inne':          'Inne',
};

function resolveCategory(aiCat: string): { db: AssetCategory; ai: string } {
  const trimmed = aiCat?.trim() ?? '';
  return {
    db: AI_TO_DB_CATEGORY[trimmed] ?? 'Inne',
    ai: trimmed || 'Inne',
  };
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Jesteś profesjonalnym algorytmem wyceniającym aktywa. \
Twoim zadaniem jest podanie szacunkowej wartości rynkowej dla 1 JEDNOSTKI podanego \
przedmiotu/aktywa w PLN, aktualnej na obecny rok (2026). \
Działaj według poniższych kryteriów w zależności od kategorii:

- SPÓŁKI GIEŁDOWE / ETFy / KRYPTOWALUTY: Symuluj pobranie danych z serwisów \
finansowych (Yahoo Finance, Google Finance, CoinMarketCap). Podaj realny, aktualny \
kurs giełdowy danej spółki (np. Apple, Microsoft, Orlen) lub indeksu (np. S&P 500) \
z 2026 roku przeliczony na PLN po aktualnym kursie walutowym.
- METALE SZLACHETNE: Wyceniaj na podstawie aktualnych światowych kursów spot za \
uncję/gram (złoto ~420 PLN/g, srebro ~13 PLN/g w 2026) przeliczonych na PLN.
- ELEKTRONIKA I SPRZĘT (np. SteelSeries, PlayStation, iPhone): Szacuj wartość na \
podstawie średnich cen rynkowych z portali aukcyjnych (Allegro, OLX, eBay) dla \
sprzętu UŻYWANEGO w stanie dobrym.
- NIERUCHOMOŚCI: Podaj wartość rynkową 1 m² dla lokalizacji i typu nieruchomości. \
Dla Warszawy przyjmij ~15 000 PLN/m² (2026). Dla domów szacuj łączną wartość.
- POJAZDY: Użyj cen z OtoDom/OLX dla danego modelu, rocznika i stanu.

Odpowiadaj WYŁĄCZNIE w formacie JSON (bez żadnego dodatkowego tekstu):
{
  "unit_value": <cena za 1 sztukę/jednostkę w PLN, liczba całkowita>,
  "value": <unit_value pomnożone przez podaną ilość, liczba całkowita PLN>,
  "category": "<jedna z: Giełda/Krypto | Metale | Elektronika | Nieruchomości | Inne>",
  "reasoning": "<Krótkie, profesjonalne uzasadnienie: skąd pochodzi wycena, np. 'Kurs zamknięcia NYSE dla AAPL w 2026 przeliczony po kursie USD/PLN ~3.95' lub 'Średnia cena używanych Arctis 7 na Allegro/OLX'>"
}

Zasady:
- unit_value i value ZAWSZE > 0, liczby całkowite (bez groszy)
- Jeśli nie znasz dokładnej ceny, podaj najlepsze realistyczne oszacowanie
- NIE zwracaj null, undefined ani pustych wartości`.trim();

// ── OpenAI client singleton ───────────────────────────────────────────────────

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// ── Error result factory ──────────────────────────────────────────────────────

const makeErrorResult = (reason: string): ValuationResult => ({
  estimatedValue: 0,
  unitPrice: 0,
  currency: 'PLN',
  confidence: 'low',
  source: 'OpenAI gpt-4o-mini (błąd)',
  suggestedCategory: 'Inne',
  aiCategory: 'Inne',
  reasoning: reason,
});

// ── Main export ───────────────────────────────────────────────────────────────

export async function estimateValue(
  itemName: string,
  quantity: number = 1
): Promise<ValuationResult> {
  const qty = Math.max(0.0001, quantity);

  try {
    const openai = getOpenAI();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.2,   // lower = more deterministic/factual
      max_tokens: 300,
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

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (parseErr) {
      console.error('[valuate] JSON parse error, raw response:', raw, parseErr);
      throw new Error('Invalid JSON from OpenAI');
    }

    // Accept both "unit_value" (new prompt) and "unit_price" (legacy fallback)
    const rawUnitPrice = parsed.unit_value ?? parsed.unit_price;
    const unitPrice =
      typeof rawUnitPrice === 'number' && rawUnitPrice > 0
        ? Math.round(rawUnitPrice)
        : 0;

    const rawTotal = parsed.value;
    const totalValue =
      typeof rawTotal === 'number' && rawTotal > 0
        ? Math.round(rawTotal)
        : unitPrice > 0
          ? Math.round(unitPrice * qty)
          : 0;

    if (totalValue === 0) {
      console.warn('[valuate] Model returned zero value for:', itemName, '| raw:', raw);
      return makeErrorResult(
        'Model nie zwrócił wartości > 0. Sprawdź nazwę aktywa lub spróbuj ponownie.'
      );
    }

    const { db: dbCategory, ai: aiCategory } = resolveCategory(String(parsed.category ?? ''));

    const reasoning =
      typeof parsed.reasoning === 'string' && parsed.reasoning.length > 0
        ? parsed.reasoning
        : 'Wycena AI.';

    return {
      estimatedValue: totalValue,
      unitPrice,
      currency: 'PLN',
      confidence: 'medium',
      source: 'OpenAI gpt-4o-mini',
      suggestedCategory: dbCategory,
      aiCategory,
      reasoning,
    };
  } catch (err) {
    console.error('[valuate] Error estimating value for:', itemName, '| qty:', qty, '| error:', err);
    return makeErrorResult(
      'Nie udało się pobrać wyceny z OpenAI. Sprawdź klucz API lub spróbuj ponownie.'
    );
  }
}
