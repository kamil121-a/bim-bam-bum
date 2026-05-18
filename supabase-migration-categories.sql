-- =============================================================================
-- Migration: Add new asset categories
-- Wklej w: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- 1. Remove old category constraint
ALTER TABLE public.assets
  DROP CONSTRAINT IF EXISTS assets_category_check;

-- 2. Add new constraint with all categories
ALTER TABLE public.assets
  ADD CONSTRAINT assets_category_check
  CHECK (category IN (
    'Finanse',                    -- legacy (kept for backward compat)
    'Akcje',                      -- stocks (sub-Finanse)
    'Kruszce',                    -- precious metals (sub-Finanse)
    'Gotówka',                    -- cash/currencies (sub-Finanse)
    'Nieruchomości',
    'Pojazdy',
    'Elektronika',
    'Przedmioty kolekcjonerskie',
    'Inne'
  ));

-- 3. Add quantity column if not already present (needed for older schemas)
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS quantity NUMERIC(18, 8) NOT NULL DEFAULT 1 CHECK (quantity > 0);

-- 4. Add original_name column if not already present
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS original_name TEXT;

-- Done!
SELECT 'Migration complete ✓' AS status;
