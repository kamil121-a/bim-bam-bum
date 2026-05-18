'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { LayoutDashboard, PlusCircle, Trophy, LogOut, Wallet } from 'lucide-react';

const NAV_LINKS = [
  { href: '/dashboard', label: 'Panel', icon: LayoutDashboard },
  { href: '/add-asset', label: 'Dodaj Aktywo', icon: PlusCircle },
  { href: '/ranking', label: 'Ranking', icon: Trophy },
];

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  return (
    <nav className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2 font-bold text-xl text-indigo-600">
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
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
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
              <span className="hidden sm:block text-sm text-gray-500 font-medium">
                {user.username}
              </span>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors"
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
