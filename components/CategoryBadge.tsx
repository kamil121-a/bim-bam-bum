import type { AssetCategory } from '@/types';

const CATEGORY_STYLES: Record<AssetCategory, string> = {
  Elektronika:   'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  Finanse:       'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  Nieruchomości: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  Inne:          'bg-slate-600/50 text-slate-300 border border-slate-500/30',
};

const CATEGORY_ICONS: Record<AssetCategory, string> = {
  Elektronika:   '💻',
  Finanse:       '📈',
  Nieruchomości: '🏠',
  Inne:          '📦',
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
