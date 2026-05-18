-- =============================================================================
-- WealthTracker – Migracja: edycja aktywów + original_name
-- Wklej do: Supabase Dashboard → SQL Editor → New query → Run
-- Bezpieczne przy ponownym uruchomieniu (IF NOT EXISTS / OR REPLACE).
-- =============================================================================

-- 1. Dodaj kolumnę original_name (zachowuje oryginalną nazwę AI po zmianie przez usera)
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS original_name TEXT;

-- 2. Backfill: dla istniejących aktywów ustaw original_name = name
UPDATE public.assets
  SET original_name = name
  WHERE original_name IS NULL;

-- 3. Dodaj politykę UPDATE (użytkownik może edytować tylko swoje aktywa)
DROP POLICY IF EXISTS "assets_update_own" ON public.assets;
CREATE POLICY "assets_update_own"
  ON public.assets FOR UPDATE
  TO authenticated
  USING     (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4. (Opcjonalnie) dodaj kolumnę quantity jeśli jeszcze nie istnieje
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS quantity NUMERIC(18, 8) NOT NULL DEFAULT 1
  CHECK (quantity > 0);

-- Gotowe! Możesz zamknąć editor.
