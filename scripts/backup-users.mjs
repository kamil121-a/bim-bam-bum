/**
 * Jednorazowy backup profili + listy użytkowników Auth do pliku JSON.
 * Uruchomienie: npm run backup:users
 *
 * Wymaga w .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
} from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function loadEnvLocal() {
  const path = join(ROOT, '.env.local');
  if (!existsSync(path)) {
    console.warn('[backup-users] Brak .env.local — używam zmiennych już ustawionych w środowisku.');
    return;
  }
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function parseArgs() {
  const argv = process.argv.slice(2);
  let out = process.env.BACKUP_USERS_OUT ?? join(ROOT, 'backups', 'users-backup.json');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) {
      out = resolve(argv[++i]);
    }
  }
  return { out };
}

function safePickUser(u) {
  return {
    id:             u.id,
    email:          u.email,
    created_at:     u.created_at,
    last_sign_in_at: u.last_sign_in_at ?? null,
    user_metadata:  u.user_metadata ?? {},
    app_metadata:   u.app_metadata ?? {},
  };
}

async function listAllAuthUsers(admin) {
  const users = [];
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const batch = data.users ?? [];
    users.push(...batch.map(safePickUser));
    if (batch.length < perPage) break;
    page += 1;
  }
  return users;
}

async function main() {
  loadEnvLocal();
  const { out } = parseArgs();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      '[backup-users] Brak NEXT_PUBLIC_SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY.',
    );
    process.exit(1);
  }

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: profiles, error: pErr } = await admin
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true });

  if (pErr) {
    console.error('[backup-users] Błąd profiles:', pErr.message);
    process.exit(1);
  }

  let authUsers;
  try {
    authUsers = await listAllAuthUsers(admin);
  } catch (e) {
    console.error('[backup-users] Błąd listUsers:', e instanceof Error ? e.message : e);
    process.exit(1);
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    source:     'moneyrank backup-users.mjs',
    profiles:   profiles ?? [],
    authUsers,
  };

  const dir = dirname(out);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const prev = `${out}.previous.json`;
  if (existsSync(out)) {
    try {
      renameSync(out, prev);
    } catch {
      /* ignore — np. plik zablokowany */
    }
  }

  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(
    `[backup-users] Zapisano: ${out} (${(profiles ?? []).length} profili, ${authUsers.length} kont Auth)`,
  );
  if (existsSync(prev)) console.log(`[backup-users] Poprzednia wersja: ${prev}`);
}

main().catch((err) => {
  console.error('[backup-users]', err);
  process.exit(1);
});
