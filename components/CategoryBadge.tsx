import type { AssetCategory } from '@/types';

const CATEGORY_STYLES: Record<AssetCategory, string> = {
  Elektronika: 'bg-blue-100 text-blue-700',
  Finanse: 'bg-emerald-100 text-emerald-700',
  Nieruchomości: 'bg-amber-100 text-amber-700',
  Inne: 'bg-gray-100 text-gray-600',
};

const CATEGORY_ICONS: Record<AssetCategory, string> = {
  Elektronika: '💻',
  Finanse: '📈',
  Nieruchomości: '🏠',
  Inne: '📦',
};

export default function CategoryBadge({ category }: { category: AssetCategory }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${CATEGORY_STYLES[category]}`}
    >
      <span>{CATEGORY_ICONS[category]}</span>
      {category}
    </span>
  );
}
