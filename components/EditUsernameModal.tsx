'use client';

import { useEffect, useState, useCallback } from 'react';
import { UserRound, X, Loader2 } from 'lucide-react';

interface Props {
  open:       boolean;
  onClose:    () => void;
  username:   string;
  onSaved:    (next: string) => Promise<void>;
}

export default function EditUsernameModal({ open, onClose, username, onSaved }: Props) {
  const [value, setValue]       = useState(username);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => {
    if (open) {
      setValue(username);
      setError('');
    }
  }, [open, username]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = value.trim();
    if (next === username) {
      onClose();
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSaved(next);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd zapisu.');
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') onClose();
    },
    [open, onClose],
  );

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Rozmazane tło */}
      <button
        type="button"
        aria-label="Zamknij"
        className="absolute inset-0 bg-slate-950/55 backdrop-blur-md cursor-pointer"
        onClick={() => !saving && onClose()}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-username-title"
        className="relative w-full max-w-md rounded-2xl border border-slate-600/80 bg-slate-900 shadow-2xl shadow-black/50"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-700 px-5 py-4">
          <div className="flex items-center gap-2 text-slate-100">
            <UserRound className="w-5 h-5 text-indigo-400 shrink-0" />
            <h2 id="edit-username-title" className="text-lg font-semibold">
              Zmiana nicku
            </h2>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
            aria-label="Zamknij"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4">
          <div>
            <label htmlFor="username-input" className="block text-xs font-medium text-slate-400 mb-1.5">
              Nazwa widoczna w aplikacji i rankingu
            </label>
            <input
              id="username-input"
              type="text"
              autoComplete="username"
              value={value}
              onChange={e => setValue(e.target.value)}
              disabled={saving}
              maxLength={40}
              className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-600 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="Twój nick"
              autoFocus
            />
            <p className="text-[11px] text-slate-500 mt-1.5">2–40 znaków. Musi być unikalny.</p>
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={saving || value.trim().length < 2}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Zapisuję…
                </>
              ) : (
                'Zapisz nick'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
