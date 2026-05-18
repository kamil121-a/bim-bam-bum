'use client';

import { Trash2 } from 'lucide-react';
import type { Asset } from '@/types';
import CategoryBadge from './CategoryBadge';

interface Props {
  asset: Asset;
  onDelete: (id: string) => void;
  deleting: boolean;
}

export function formatPLN(value: number): string {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'PLN',
    maximumFractionDigits: 0,
  }).format(value);
}

export default function AssetCard({ asset, onDelete, deleting }: Props) {
  return (
    <div className="flex items-center justify-between p-4 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow group">
      <div className="flex flex-col gap-1 min-w-0">
        <p className="font-semibold text-gray-900 truncate">{asset.name}</p>
        <div className="flex items-center gap-2">
          <CategoryBadge category={asset.category} />
          <span className="text-xs text-gray-400">
            {new Date(asset.createdAt).toLocaleDateString('pl-PL')}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-4 ml-4 shrink-0">
        <span className="font-bold text-lg text-indigo-700">{formatPLN(asset.value)}</span>
        <button
          onClick={() => onDelete(asset.id)}
          disabled={deleting}
          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-40"
          title="Usuń aktywo"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
