'use client';

import { useState, useEffect } from 'react';
import { Trash2, Pencil, Check, X, Info, CheckCircle2 } from 'lucide-react';
import type { Asset } from '@/types';
import CategoryBadge from './CategoryBadge';

// ── Exported helpers (used in other components) ───────────────────────────────

export function formatPLN(value: number): string {
  return new Intl.NumberFormat('pl-PL', {
    style:                'currency',
    currency:             'PLN',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatQuantity(qty: number): string {
  if (!qty || qty === 1) return '';
  return `${parseFloat(qty.toFixed(4))} ×`;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  asset:     Asset;
  onDelete:  (id: string) => void;
  onEdit:    (id: string, changes: { name: string; quantity: number }) => Promise<void>;
  deleting:  boolean;
  refreshed?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AssetCard({ asset, onDelete, onEdit, deleting, refreshed }: Props) {
  const [editing,   setEditing]   = useState(false);
  const [editName,  setEditName]  = useState(asset.name);
  const [editQty,   setEditQty]   = useState(String(asset.quantity ?? 1));
  const [saving,    setSaving]    = useState(false);
  const [editError, setEditError] = useState('');
  // Controls the green checkmark badge — stays visible for 3.5 s after refresh
  const [showCheck, setShowCheck] = useState(false);

  useEffect(() => {
    if (!refreshed) return;
    setShowCheck(true);
    const t = setTimeout(() => setShowCheck(false), 3_500);
    return () => clearTimeout(t);
  }, [refreshed]);

  const qtyLabel         = formatQuantity(asset.quantity ?? 1);
  const showOriginalName = Boolean(
    asset.original_name && asset.original_name !== asset.name,
  );

  // Derived: preview new value while user types a new quantity
  const unitPrice    = asset.value / Math.max(Number(asset.quantity) || 1, 0.0001);
  const previewQty   = parseFloat(editQty) || 0;
  const previewValue = previewQty > 0 ? Math.round(unitPrice * previewQty) : 0;

  // ── Edit handlers ───────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!editName.trim()) { setEditError('Nazwa nie może być pusta.'); return; }
    const qty = parseFloat(editQty);
    if (isNaN(qty) || qty <= 0) { setEditError('Ilość musi być > 0.'); return; }

    setSaving(true);
    setEditError('');
    try {
      await onEdit(asset.id, { name: editName.trim(), quantity: qty });
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Błąd zapisu. Spróbuj ponownie.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setEditName(asset.name);
    setEditQty(String(asset.quantity ?? 1));
    setEditError('');
  };

  // ── Edit mode ───────────────────────────────────────────────────────────────

  if (editing) {
    return (
      <div className="p-4 bg-white rounded-xl border-2 border-indigo-200 shadow-md">
        <div className="space-y-3">

          {/* Name field */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Nazwa aktywa</label>
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
              autoFocus
              disabled={saving}
            />
          </div>

          {/* Quantity field */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Ilość</label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="0.0001"
                step="any"
                value={editQty}
                onChange={e => setEditQty(e.target.value)}
                className="w-36 px-3 py-2 text-sm rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
                disabled={saving}
              />
              {previewValue > 0 && (
                <span className="text-sm text-gray-500">
                  → <strong className="text-indigo-700">{formatPLN(previewValue)}</strong>
                  <span className="text-xs text-gray-400 ml-1">
                    ({formatPLN(Math.round(unitPrice))}/szt.)
                  </span>
                </span>
              )}
            </div>
          </div>

          {editError && (
            <p className="text-xs text-red-500 bg-red-50 px-3 py-1.5 rounded-lg">{editError}</p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              Zapisz
            </button>
            <button
              onClick={handleCancel}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5" />
              Anuluj
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── View mode ───────────────────────────────────────────────────────────────

  return (
    <div className={`flex items-center justify-between p-4 bg-white rounded-xl border shadow-sm hover:shadow-md transition-all ${showCheck ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-100'}`}>

      {/* Left: name + meta */}
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {qtyLabel && (
            <span className="text-xs font-semibold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-md shrink-0">
              {qtyLabel}
            </span>
          )}
          <p className="font-semibold text-gray-900 truncate">{asset.name}</p>

          {/* Original-name tooltip – only shown when user renamed the asset */}
          {showOriginalName && (
            <div className="relative group">
              <button
                className="text-gray-300 hover:text-indigo-400 transition-colors"
                title={`Pierwotna nazwa: ${asset.original_name}`}
                aria-label="Pokaż pierwotną nazwę"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
              {/* Tooltip */}
              <div className="pointer-events-none absolute left-0 bottom-6 z-20 hidden group-hover:block w-56 bg-gray-800 text-white text-xs rounded-xl px-3 py-2.5 shadow-lg">
                <span className="text-gray-400">Pierwotna nazwa:</span>
                <br />
                <span className="font-medium">{asset.original_name}</span>
                {/* Arrow */}
                <div className="absolute left-2 -bottom-1.5 w-3 h-3 bg-gray-800 rotate-45" />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <CategoryBadge category={asset.category} />
          <span className="text-xs text-gray-400">
            {new Date(asset.created_at).toLocaleDateString('pl-PL')}
          </span>
        </div>
      </div>

      {/* Right: value + action buttons */}
      <div className="flex items-center gap-1.5 ml-4 shrink-0">
        {/* Green checkmark – slides in after a successful price refresh */}
        <div
          className={`flex items-center gap-1 transition-all duration-500 overflow-hidden ${
            showCheck ? 'opacity-100 max-w-[7rem]' : 'opacity-0 max-w-0'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="text-xs font-medium text-emerald-600 whitespace-nowrap">Zaktualizowano</span>
        </div>

        <span className="font-bold text-lg text-indigo-700 mr-1">{formatPLN(asset.value)}</span>

        {/* Edit button */}
        <button
          onClick={() => setEditing(true)}
          className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors"
          title="Edytuj nazwę / ilość"
        >
          <Pencil className="w-4 h-4" />
        </button>

        {/* Delete button */}
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
