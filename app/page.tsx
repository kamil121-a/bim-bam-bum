/**
 * Strona główna — przekierowanie obsługuje middleware (→ /dashboard lub /login).
 */
export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
