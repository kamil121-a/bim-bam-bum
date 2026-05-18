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
      <div className="p-4 bg-slate-800 rounded-xl border-2 border-indigo-500/40 shadow-lg shadow-black/20">
        <div className="space-y-3">

          {/* Name field */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Nazwa aktywa</label>
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-slate-700 border border-slate-600 text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
              autoFocus
              disabled={saving}
            />
          </div>

          {/* Quantity field */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Ilość</label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="0.0001"
                step="any"
                value={editQty}
                onChange={e => setEditQty(e.target.value)}
                className="w-36 px-3 py-2 text-sm rounded-lg bg-slate-700 border border-slate-600 text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
                disabled={saving}
              />
              {previewValue > 0 && (
                <span className="text-sm text-slate-400">
                  → <strong className="text-indigo-400">{formatPLN(previewValue)}</strong>
                  <span className="text-xs text-slate-500 ml-1">
                    ({formatPLN(Math.round(unitPrice))}/szt.)
                  </span>
                </span>
              )}
            </div>
          </div>

          {editError && (
            <p className="text-xs text-red-400 bg-red-500/10 px-3 py-1.5 rounded-lg border border-red-500/20">{editError}</p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
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
              className="flex items-center gap-1.5 px-4 py-1.5 border border-slate-600 text-slate-300 text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50"
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
    <div className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
      showCheck
        ? 'bg-emerald-900/20 border-emerald-500/30'
        : 'bg-slate-800 border-slate-700/60 hover:border-slate-600'
    }`}>

      {/* Left: name + meta */}
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {qtyLabel && (
            <span className="text-xs font-semibold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-md shrink-0 border border-indigo-500/20">
              {qtyLabel}
            </span>
          )}
          <p className="font-semibold text-slate-100 truncate">{asset.name}</p>

          {/* Original-name tooltip */}
          {showOriginalName && (
            <div className="relative group">
              <button
                className="text-slate-600 hover:text-indigo-400 transition-colors"
                title={`Pierwotna nazwa: ${asset.original_name}`}
                aria-label="Pokaż pierwotną nazwę"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
              <div className="pointer-events-none absolute left-0 bottom-6 z-20 hidden group-hover:block w-56 bg-slate-900 text-slate-200 text-xs rounded-xl px-3 py-2.5 shadow-xl border border-slate-700">
                <span className="text-slate-500">Pierwotna nazwa:</span>
                <br />
                <span className="font-medium">{asset.original_name}</span>
                <div className="absolute left-2 -bottom-1.5 w-3 h-3 bg-slate-900 rotate-45 border-r border-b border-slate-700" />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <CategoryBadge category={asset.category} />
          <span className="text-xs text-slate-500">
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
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-xs font-medium text-emerald-400 whitespace-nowrap">Zaktualizowano</span>
        </div>

        <span className="font-bold text-lg text-indigo-400 mr-1">{formatPLN(asset.value)}</span>

        {/* Edit button */}
        <button
          onClick={() => setEditing(true)}
          className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors"
          title="Edytuj nazwę / ilość"
        >
          <Pencil className="w-4 h-4" />
        </button>

        {/* Delete button */}
        <button
          onClick={() => onDelete(asset.id)}
          disabled={deleting}
          className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
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
