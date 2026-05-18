'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { LayoutDashboard, PlusCircle, Trophy, LogOut, Wallet, BarChart2 } from 'lucide-react';

const NAV_LINKS = [
  { href: '/dashboard', label: 'Panel',        icon: LayoutDashboard },
  { href: '/add-asset', label: 'Dodaj Aktywo', icon: PlusCircle },
  { href: '/ranking',   label: 'Ranking',      icon: Trophy },
  { href: '/stats',     label: 'Statystyki',   icon: BarChart2 },
];

export default function Navigation() {
  const pathname = usePathname();
  const router   = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  return (
    <nav className="bg-slate-900 border-b border-slate-700/60 shadow-lg sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">

          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2 font-bold text-xl text-indigo-400 hover:text-indigo-300 transition-colors">
            <Wallet className="w-6 h-6" />
            <span>WealthTracker</span>
          </Link>

          {/* Nav links */}
          <div className="flex items-center gap-1">
            {NAV_LINKS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:block">{label}</span>
                </Link>
              );
            })}
          </div>

          {/* User + logout */}
          <div className="flex items-center gap-3">
            {user && (
              <span className="hidden sm:block text-sm text-slate-400 font-medium">
                {user.username}
              </span>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:block">Wyloguj</span>
            </button>
          </div>

        </div>
      </div>
    </nav>
  );
}
