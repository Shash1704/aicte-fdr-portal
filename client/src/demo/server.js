// The SD/FDR portal server, running inside the browser for the GitHub Pages demo.
// It mirrors server/src/index.js and reuses the real server modules unchanged (routes, rules,
// bank sandbox, monitoring engine, release workflow, analytics, seed). Only the database (sql.js),
// file storage and a few Node built-ins are swapped for browser equivalents (see vite.config.ts).
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import express from './shims/express.js';
import { SqliteAdapter } from './sqlite-adapter.js';
import { loadSnapshot, saveSnapshot, clearSnapshots } from './persist.js';
import { makeAuth, hashPassword } from './auth-browser.js';
import { makeStore } from './storage-browser.js';
import { initSchema, getSetting, setClockOffset } from '../../../server/src/dbutil.js';
import { Engine, bus } from '../../../server/src/engine.js';
import { InstrumentService, HttpError } from '../../../server/src/instruments.js';
import { makeAudit } from '../../../server/src/audit.js';
import { buildRouter } from '../../../server/src/routes.js';
import { buildAnalytics } from '../../../server/src/analytics.js';
import { seedDatabase } from '../../../server/src/seed.js';

const SNAPSHOT_KEY = 'fdr-db-v1';
const statusListeners = new Set();
let lastStatus = 'Starting…';
const setStatus = (s) => { lastStatus = s; statusListeners.forEach((fn) => fn(s)); };
export const onStatus = (fn) => { statusListeners.add(fn); fn(lastStatus); return () => statusListeners.delete(fn); };
const paint = () => new Promise((r) => setTimeout(r, 30)); // let the loading screen update before heavy work

let instance;
export const getDemoServer = () => (instance ??= start());

async function start() {
  setStatus('Loading the database engine…');
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const snapshot = await loadSnapshot(SNAPSHOT_KEY);
  let db = null;
  if (snapshot) {
    try {
      db = new SqliteAdapter(SQL, snapshot);
      if (!db.prepare("SELECT value FROM settings WHERE key = 'seeded_at'").get()) db = null;
    } catch { db = null; }
  }
  if (!db) {
    setStatus('Generating 650+ synthetic deposits in your browser…');
    await paint();
    db = new SqliteAdapter(SQL);
    initSchema(db);
    seedDatabase(db, { hashPassword, store: makeStore(db) });
    await saveSnapshot(SNAPSHOT_KEY, db.export());
  }
  setStatus('Starting the monitoring engine…');
  await paint();
  initSchema(db);
  setClockOffset(getSetting(db, 'clock_offset_days', 0));
  const engine = new Engine(db);
  const audit = makeAudit(db);
  const store = makeStore(db);
  const service = new InstrumentService({ db, engine, audit, store });
  const analytics = buildAnalytics(db);

  const app = express();
  app.get('/api/health', (_req, res) => res.json({ ok: true, demo: true, time: new Date().toISOString() }));
  app.use('/api', buildRouter({ db, engine, service, analytics, audit, store, bus }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err, _req, res, _next) => { // eslint-disable-line no-unused-vars
    const status = err instanceof HttpError ? err.status : err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal error' : err.message });
  });

  engine.sweep({ emit: false });
  setInterval(() => engine.sweep(), 60 * 60 * 1000);
  let saveTimer = null;
  const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveSnapshot(SNAPSHOT_KEY, db.export()), 1500); };
  bus.on('event', scheduleSave);
  makeAuth(db); // warm the prepared statement
  setStatus('Ready');
  return { app, db, bus, scheduleSave };
}

function makeRes() {
  return {
    statusCode: 200, headers: {}, body: null, finished: false,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = String(v); return this; },
    writeHead(c, h = {}) { this.statusCode = c; for (const [k, v] of Object.entries(h)) this.setHeader(k, v); return this; },
    write() { return true; },
    json(o) { this.setHeader('content-type', 'application/json'); this.body = JSON.stringify(o); return this.end(); },
    send(d) { if (!this.headers['content-type']) this.setHeader('content-type', typeof d === 'string' ? 'text/plain; charset=utf-8' : 'application/octet-stream'); this.body = d; return this.end(); },
    sendFile() { return this.status(404).json({ error: 'Not available in the demo' }); },
    end() { this.finished = true; this._done?.(); return this; },
  };
}

/** fetch()-compatible entry point used by the client in demo mode. */
export async function demoFetch(input, init = {}) {
  const { app, scheduleSave } = await getDemoServer();
  const url = new URL(String(input), 'http://demo.local');
  const headers = {};
  for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = v;
  const req = {
    method: (init.method || 'GET').toUpperCase(), url: url.pathname + url.search, path: url.pathname,
    query: Object.fromEntries(url.searchParams), headers, params: {}, ip: '127.0.0.1', body: undefined, on() {},
  };
  if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
    req._form = init.body;
    req.body = Object.fromEntries([...init.body.entries()].filter(([, v]) => typeof v === 'string'));
  } else if (typeof init.body === 'string') {
    try { req.body = JSON.parse(init.body); } catch { req.body = init.body; }
  }
  const res = makeRes();
  await new Promise((resolve) => {
    res._done = resolve;
    app.handle(req, res, (err) => {
      if (res.finished) return;
      if (err) res.status(err.status || 500).json({ error: err.message || 'Error' });
      else res.status(404).json({ error: 'Not found' });
    });
  });
  if (req.method !== 'GET') scheduleSave();
  return new Response(res.body, { status: res.statusCode, headers: res.headers });
}

/** Live updates: the in-browser equivalent of the server's /api/events stream. */
export async function subscribeLive(fn) {
  const { bus: b } = await getDemoServer();
  const handler = (evt) => fn({ ...evt, at: new Date().toISOString() });
  b.on('event', handler);
  return { simulator: false, unsubscribe: () => b.off('event', handler) };
}

export async function resetDemoData() {
  await clearSnapshots();
  location.reload();
}
