-- =============================================================================
-- WealthTracker – Supabase Schema (idempotentny – bezpieczny przy ponownym uruchomieniu)
-- Wklej cały plik do: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Czyszczenie – usuń wszystko jeśli istnieje (kolejność ma znaczenie!)
-- ---------------------------------------------------------------------------

-- Triggery na auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Triggery na tabelach publicznych
DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;

-- Polityki RLS – assets
DROP POLICY IF EXISTS "assets_delete_own"  ON public.assets;
DROP POLICY IF EXISTS "assets_insert_own"  ON public.assets;
DROP POLICY IF EXISTS "assets_select_own"  ON public.assets;

-- Polityki RLS – profiles
DROP POLICY IF EXISTS "profiles_update_own"              ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own"              ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_authenticated"    ON public.profiles;

-- Tabele (CASCADE usuwa klucze obce zależnych tabel)
DROP TABLE IF EXISTS public.assets   CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- Funkcje
DROP FUNCTION IF EXISTS public.get_ranking();
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 1. Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ---------------------------------------------------------------------------
-- 1. Tabela profiles (rozszerza auth.users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    TEXT        UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE  public.profiles             IS 'Publiczny profil użytkownika (1:1 z auth.users)';
COMMENT ON COLUMN public.profiles.username    IS 'Unikalna nazwa widoczna w rankingu';


-- ---------------------------------------------------------------------------
-- 2. Tabela assets (aktywa)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assets (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  value       NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (value >= 0),
  category    TEXT        NOT NULL DEFAULT 'Inne'
              CHECK (category IN ('Elektronika', 'Finanse', 'Nieruchomości', 'Inne')),
  reasoning   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE  public.assets            IS 'Aktywa majątkowe użytkownika';
COMMENT ON COLUMN public.assets.value      IS 'Wartość w PLN (zaokrąglona do groszy)';
COMMENT ON COLUMN public.assets.reasoning  IS 'Uzasadnienie wyceny zwrócone przez AI';

-- Indexes
CREATE INDEX IF NOT EXISTS assets_user_id_idx    ON public.assets (user_id);
CREATE INDEX IF NOT EXISTS assets_created_at_idx ON public.assets (created_at DESC);


-- ---------------------------------------------------------------------------
-- 3. Row Level Security (RLS)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets   ENABLE ROW LEVEL SECURITY;

-- profiles: każdy zalogowany może czytać (potrzebne do rankingu i pobierania username)
CREATE POLICY "profiles_select_authenticated"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

-- profiles: użytkownik może tworzyć tylko swój profil
CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- profiles: użytkownik może edytować tylko swój profil
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- assets: użytkownik widzi tylko swoje aktywa
CREATE POLICY "assets_select_own"
  ON public.assets FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- assets: użytkownik dodaje tylko do swojego konta
CREATE POLICY "assets_insert_own"
  ON public.assets FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- assets: użytkownik usuwa tylko swoje aktywa
CREATE POLICY "assets_delete_own"
  ON public.assets FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 4. Funkcja rankingowa (SECURITY DEFINER – omija RLS, bezpieczna)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_ranking()
RETURNS TABLE (
  id          UUID,
  username    TEXT,
  total_value NUMERIC,
  asset_count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.username,
    COALESCE(SUM(a.value), 0) AS total_value,
    COUNT(a.id)               AS asset_count
  FROM public.profiles p
  LEFT JOIN public.assets a ON a.user_id = p.id
  GROUP BY p.id, p.username
  ORDER BY total_value DESC;
$$;

-- Dostęp do funkcji dla zalogowanych użytkowników
GRANT EXECUTE ON FUNCTION public.get_ranking() TO authenticated;


-- ---------------------------------------------------------------------------
-- 5. Trigger: automatyczne tworzenie profilu po rejestracji
--    Czyta username z raw_user_meta_data (ustawiany przez AuthContext.register)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'username'), ''),
      SPLIT_PART(NEW.email, '@', 1)   -- fallback: część emaila przed @
    )
  )
  ON CONFLICT (id) DO NOTHING;        -- idempotentny (bezpieczny przy retry)
  RETURN NEW;
END;
$$;

-- Usuń stary trigger jeśli istnieje, żeby query był idempotentny
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- ---------------------------------------------------------------------------
-- 6. Trigger: auto-update updated_at w profiles
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();


-- ---------------------------------------------------------------------------
-- Gotowe! Sprawdź tabele w: Table Editor → profiles, assets
-- ---------------------------------------------------------------------------
