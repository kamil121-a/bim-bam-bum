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

function formatQuantity(qty: number): string {
  if (!qty || qty === 1) return '';
  // Show up to 4 decimal places, strip trailing zeros
  return `${parseFloat(qty.toFixed(4))} ×`;
}

export default function AssetCard({ asset, onDelete, deleting }: Props) {
  const qtyLabel = formatQuantity(asset.quantity ?? 1);

  return (
    <div className="flex items-center justify-between p-4 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {qtyLabel && (
            <span className="text-xs font-semibold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-md shrink-0">
              {qtyLabel}
            </span>
          )}
          <p className="font-semibold text-gray-900 truncate">{asset.name}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <CategoryBadge category={asset.category} />
          <span className="text-xs text-gray-400">
            {new Date(asset.created_at).toLocaleDateString('pl-PL')}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 ml-4 shrink-0">
        <span className="font-bold text-lg text-indigo-700">{formatPLN(asset.value)}</span>
        <button
          onClick={() => onDelete(asset.id)}
          disabled={deleting}
          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
          title="Usuń aktywo"
        >
          {deleting ? (
            <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}
