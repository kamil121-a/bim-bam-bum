-- =============================================================================
-- Naprawa: violates check constraint "assets_category_check"
--
-- Pojawia się przy zapisie kategorii np. „Biżuteria”, jeśli baza ma STARY
-- constraint bez tej wartości (wcześniejsza migracja bez pełnej listy).
--
-- Supabase → SQL Editor → wklej → Run
-- Bezpieczne wielokrotne uruchomienie (DROP IF EXISTS + ADD).
-- =============================================================================

ALTER TABLE public.assets
  DROP CONSTRAINT IF EXISTS assets_category_check;

ALTER TABLE public.assets
  ADD CONSTRAINT assets_category_check
  CHECK (category IN (
    'Finanse',
    'Akcje',
    'Kruszce',
    'Gotówka',
    'Nieruchomości',
    'Pojazdy',
    'Elektronika',
    'Biżuteria',
    'Przedmioty kolekcjonerskie',
    'Inne'
  ));

SELECT 'Constraint assets_category_check zaktualizowany ✓' AS status;
