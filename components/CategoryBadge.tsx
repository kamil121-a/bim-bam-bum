import type { AssetCategory } from '@/types';

const CATEGORY_STYLES: Record<AssetCategory, string> = {
  Akcje:                       'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  Kruszce:                     'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30',
  Gotówka:                     'bg-green-500/20 text-green-300 border border-green-500/30',
  Finanse:                     'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  Nieruchomości:               'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  Pojazdy:                     'bg-sky-500/20 text-sky-300 border border-sky-500/30',
  Elektronika:                 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  'Przedmioty kolekcjonerskie':'bg-purple-500/20 text-purple-300 border border-purple-500/30',
  Inne:                        'bg-slate-600/50 text-slate-300 border border-slate-500/30',
};

const CATEGORY_ICONS: Record<AssetCategory, string> = {
  Akcje:                       '📈',
  Kruszce:                     '🥇',
  Gotówka:                     '💵',
  Finanse:                     '📊',
  Nieruchomości:               '🏠',
  Pojazdy:                     '🚗',
  Elektronika:                 '💻',
  'Przedmioty kolekcjonerskie':'🏆',
  Inne:                        '📦',
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
