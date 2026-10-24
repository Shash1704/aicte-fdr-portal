// Node entry point for the demo-data generator: `npm run seed` recreates server/data/fdr.db.
import fs from 'node:fs';
import path from 'node:path';
import { openDb, initSchema, DB_PATH, UPLOAD_DIR } from './db.js';
import { hashPassword } from './auth.js';
import { initVault } from './vault.js';
import { makeStore } from './storage.js';
import { seedDatabase } from './seed.js';

export function seed() {
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) fs.rmSync(f, { force: true });
  for (const f of fs.readdirSync(UPLOAD_DIR)) if (f !== '.gitkeep') fs.rmSync(path.join(UPLOAD_DIR, f), { force: true });
  const db = openDb();
  initSchema(db);
  initVault(db);
  seedDatabase(db, { hashPassword, store: makeStore(db), log: console.log });
  console.log(`  database: ${DB_PATH}`);
  db.close();
}

if (import.meta.url === `file://${process.argv[1]}`) seed();
