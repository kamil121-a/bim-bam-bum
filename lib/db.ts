import fs from 'fs';
import path from 'path';
import type { Database } from '@/types';

const DB_PATH = path.join(process.cwd(), 'data', 'db.json');

const DEFAULT_DB: Database = {
  users: [],
  assets: [],
  sessions: [],
};

export function readDb(): Database {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH)) {
      writeDb(DEFAULT_DB);
      return structuredClone(DEFAULT_DB);
    }
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(raw) as Database;
  } catch {
    return structuredClone(DEFAULT_DB);
  }
}

export function writeDb(db: Database): void {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}
