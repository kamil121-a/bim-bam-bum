import OpenAI from 'openai';
import type { AssetCategory } from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ValuationResult {
  estimatedValue: number; // total = unitPrice × quantity
  unitPrice: number;      // price per 1 unit
  currency: 'PLN';
  confidence: 'high' | 'medium' | 'low';
  source: string;
  suggestedCategory: AssetCategory; // mapped to valid DB value
  aiCategory: string;               // raw AI label for display
  reasoning: string;
}

// ── Category mapping ──────────────────────────────────────────────────────────
// AI uses granular labels; we map them to the four DB-allowed categories.

const AI_TO_DB: Record<string, AssetCategory> = {
  'Giełda/Krypto': 'Finanse',
  Metale:          'Finanse',
  Elektronika:     'Elektronika',
  Nieruchomości:   'Nieruchomości',
  Finanse:         'Finanse',
  Inne:            'Inne',
};

function resolveCategory(raw: string): { db: AssetCategory; ai: string } {
  const s = (raw ?? '').trim();
  return { db: AI_TO_DB[s] ?? 'Inne', ai: s || 'Inne' };
}

// ── Prompt (kept intentionally short to minimise token cost & latency) ────────

const SYSTEM_PROMPT =
  'Wyceniaj aktywa w PLN (rok 2026). Odpowiedz TYLKO poprawnym JSON:\n' +
  '{"unit_value":<PLN za 1 szt., integer>,"value":<unit_value×ilość, integer>,' +
  '"category":"Giełda/Krypto|Metale|Elektronika|Nieruchomości|Inne",' +
  '"reasoning":"<max 15 słów>"}\n' +
  'Zasady: zawsze >0. Giełda/krypto→kursy rynkowe 2026 w PLN. ' +
  'Metale→ceny spot PLN. Elektronika→Allegro/OLX używane. Nieruchomości→PLN/m² 2026.';

// ── OpenAI singleton ──────────────────────────────────────────────────────────

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

// ── Fallback ──────────────────────────────────────────────────────────────────

const FALLBACK: ValuationResult = {
  estimatedValue: 0,
  unitPrice: 0,
  currency: 'PLN',
  confidence: 'low',
  source: 'OpenAI gpt-4o-mini (błąd)',
  suggestedCategory: 'Inne',
  aiCategory: 'Inne',
  reasoning:
    'Nie udało się automatycznie pobrać wyceny. Wartość ustawiona tymczasowo na 0 PLN.',
};

// ── Main function ─────────────────────────────────────────────────────────────

export async function estimateValue(
  itemName: string,
  quantity = 1,
): Promise<ValuationResult> {
  const qty = Math.max(0.0001, quantity);

  try {
    const openai = getClient();

    // Hard 8-second timeout – leaves 2 s headroom inside Vercel Hobby 10 s limit
    const signal = AbortSignal.timeout(8_000);

    const completion = await openai.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 128,   // JSON response never needs more than ~80 tokens
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: `"${itemName}", ilość: ${qty}` },
        ],
      },
      { signal },
    );

    const raw = completion.choices[0]?.message?.content ?? '';

    // ── Parse ──────────────────────────────────────────────────────────────────
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      console.error('[valuate] JSON parse failed. raw response:', raw);
      return { ...FALLBACK, reasoning: `Błąd parsowania odpowiedzi AI (raw: ${raw.slice(0, 80)})` };
    }

    // Accept both new key ("unit_value") and legacy ("unit_price")
    const rawUnit = parsed.unit_value ?? parsed.unit_price;
    const unitPrice =
      typeof rawUnit === 'number' && rawUnit > 0 ? Math.round(rawUnit) : 0;

    const rawTotal  = parsed.value;
    const totalValue =
      typeof rawTotal === 'number' && rawTotal > 0
        ? Math.round(rawTotal)
        : unitPrice > 0
          ? Math.round(unitPrice * qty)
          : 0;

    if (totalValue === 0) {
      console.warn('[valuate] Model returned 0 for:', itemName, '| raw:', raw);
      return FALLBACK;
    }

    const { db: suggestedCategory, ai: aiCategory } = resolveCategory(
      String(parsed.category ?? ''),
    );

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
      suggestedCategory,
      aiCategory,
      reasoning,
    };
  } catch (err) {
    // Catches AbortError (timeout), network errors, API errors, etc.
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    console.error(
      `[valuate] ${isTimeout ? 'TIMEOUT (>8 s)' : 'ERROR'} for "${itemName}":`,
      isTimeout ? 'AbortSignal fired' : err,
    );
    return {
      ...FALLBACK,
      reasoning: isTimeout
        ? 'Przekroczono czas wyceny (>8 s). Spróbuj ponownie.'
        : 'Błąd połączenia z OpenAI. Spróbuj ponownie.',
    };
  }
}
