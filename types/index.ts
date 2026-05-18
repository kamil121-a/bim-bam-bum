export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export type AssetCategory = 'Elektronika' | 'Finanse' | 'Nieruchomości' | 'Inne';

export const ASSET_CATEGORIES: AssetCategory[] = [
  'Elektronika',
  'Finanse',
  'Nieruchomości',
  'Inne',
];

export interface Asset {
  id: string;
  userId: string;
  name: string;
  category: AssetCategory;
  value: number;
  createdAt: string;
}

export interface Session {
  token: string;
  userId: string;
  expiresAt: string;
}

export interface Database {
  users: User[];
  assets: Asset[];
  sessions: Session[];
}

export interface PublicUser {
  id: string;
  username: string;
}

export interface RankingEntry extends PublicUser {
  totalValue: number;
  assetCount: number;
}
