import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, initSchema, DB_PATH, getSetting, setClockOffset } from './db.js';
import { Engine, bus } from './engine.js';
import { InstrumentService, HttpError } from './instruments.js';
import { makeAuth, setSecret } from './auth.js';
import { makeAudit } from './audit.js';
import { initVault } from './vault.js';
import { makeStore } from './storage.js';
import { buildRouter } from './routes.js';
import { buildAnalytics } from './analytics.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);

if (!fs.existsSync(DB_PATH)) {
  console.log('No database found — generating demo data…');
  const { seed } = await import('./seed-cli.js');
  seed();
}

const db = openDb();
initSchema(db);
initVault(db);
let secret = db.prepare("SELECT value FROM settings WHERE key = 'secret'").get()?.value;
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT INTO settings (key, value) VALUES ('secret', ?)").run(secret);
}
setSecret(secret);
setClockOffset(getSetting(db, 'clock_offset_days', 0));

const engine = new Engine(db);
const audit = makeAudit(db);
const store = makeStore(db);
const service = new InstrumentService({ db, engine, audit, store });
const analytics = buildAnalytics(db);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---------- real-time stream (Server-Sent Events) ----------
const auth = makeAuth(db);
const clients = new Set();
app.get('/api/events', auth, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`event: hello\ndata: ${JSON.stringify({ user: req.user.username })}\n\n`);
  const client = { res, user: req.user };
  clients.add(client);
  req.on('close', () => clients.delete(client));
});
bus.on('event', (evt) => {
  const payload = `event: update\ndata: ${JSON.stringify({ ...evt, at: new Date().toISOString() })}\n\n`;
  for (const c of clients) {
    // Institutions only hear about their own instruments.
    if (c.user.role === 'institution' && evt.institution_id && evt.institution_id !== c.user.institution_id) continue;
    c.res.write(payload);
  }
});
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 25000).unref();

app.use('/api', buildRouter({ db, engine, service, analytics, audit, store, bus }));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---------- static frontend ----------
const dist = path.resolve(here, '../../client/dist');
app.use(express.static(dist, { index: false, maxAge: '1h' }));
app.use((req, res, next) => {
  const index = path.join(dist, 'index.html');
  if (req.method !== 'GET' || !fs.existsSync(index)) return next();
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(index);
});

// ---------- errors ----------
app.use((err, req, res, _next) => {
  const status = err instanceof HttpError ? err.status : err.status || (err.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 10 MB' : err.message });
});

// Daily monitoring: run at start and then every hour (it is idempotent).
engine.sweep({ emit: false });
setInterval(() => engine.sweep(), 60 * 60 * 1000).unref();

app.listen(PORT, () => {
  console.log(`AICTE SD/FDR portal on http://localhost:${PORT}  (db: ${DB_PATH})`);
});
