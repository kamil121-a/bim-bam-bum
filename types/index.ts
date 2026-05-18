export type AssetCategory =
  | 'Akcje'
  | 'Kruszce'
  | 'Gotówka'
  | 'Finanse'                   // legacy – backward compat
  | 'Nieruchomości'
  | 'Pojazdy'
  | 'Elektronika'
  | 'Biżuteria'
  | 'Przedmioty kolekcjonerskie'
  | 'Inne';

export const ASSET_CATEGORIES: AssetCategory[] = [
  'Akcje',
  'Kruszce',
  'Gotówka',
  'Finanse',
  'Nieruchomości',
  'Pojazdy',
  'Elektronika',
  'Biżuteria',
  'Przedmioty kolekcjonerskie',
  'Inne',
];

/** Categories that belong to the "Finanse" visual group */
export const FINANCE_CATEGORIES = new Set<AssetCategory>([
  'Akcje', 'Kruszce', 'Gotówka', 'Finanse',
]);

/** Matches Supabase snake_case column names returned from the DB. */
export interface Asset {
  id: string;
  user_id: string;
  name: string;
  /** Original AI-generated name; set once on creation, never overwritten. */
  original_name: string | null;
  category: AssetCategory;
  value: number;
  quantity: number;
  reasoning: string | null;
  created_at: string;
}

export interface RankingEntry {
  id: string;
  username: string;
  totalValue: number;
  assetCount: number;
}
