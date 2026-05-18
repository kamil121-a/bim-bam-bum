-- =============================================================================
-- WealthTracker – Migration #1
-- Wklej do: Supabase Dashboard → SQL Editor → New query → Run
-- Dodaje: quantity do assets, total_wealth do profiles, trigger auto-sync.
-- =============================================================================

-- 1. Kolumna quantity w tabeli assets (ilość jednostek)
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS quantity NUMERIC NOT NULL DEFAULT 1
  CHECK (quantity > 0);

-- 2. Kolumna total_wealth w tabeli profiles (dla szybkiego rankingu)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS total_wealth NUMERIC NOT NULL DEFAULT 0;

-- 3. Zainicjuj total_wealth dla istniejących użytkowników
UPDATE public.profiles p
SET total_wealth = (
  SELECT COALESCE(SUM(value), 0)
  FROM public.assets
  WHERE user_id = p.id
);

-- 4. Funkcja aktualizująca total_wealth po każdej zmianie w assets
CREATE OR REPLACE FUNCTION public.update_total_wealth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_user_id UUID;
BEGIN
  -- DELETE: korzystamy z OLD; INSERT/UPDATE: z NEW
  affected_user_id := COALESCE(NEW.user_id, OLD.user_id);

  UPDATE public.profiles
  SET total_wealth = (
    SELECT COALESCE(SUM(value), 0)
    FROM public.assets
    WHERE user_id = affected_user_id
  )
  WHERE id = affected_user_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 5. Trigger na tabeli assets
DROP TRIGGER IF EXISTS assets_wealth_sync ON public.assets;

CREATE TRIGGER assets_wealth_sync
  AFTER INSERT OR UPDATE OF value OR DELETE ON public.assets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_total_wealth();

-- Gotowe! total_wealth będzie teraz aktualizowany automatycznie.
