// Database schema and helpers that run anywhere (Node's sqlite or sql.js in the browser).

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  designation TEXT,
  email TEXT, phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin','head','officer','accounts','institution','auditor')),
  institution_id INTEGER REFERENCES institutions(id),
  regions TEXT,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS institutions (
  id INTEGER PRIMARY KEY,
  aicte_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type TEXT, ownership TEXT, trust_name TEXT,
  address TEXT, city TEXT, district TEXT, state TEXT, pincode TEXT,
  region_code TEXT,
  established INTEGER, approval_status TEXT,
  email TEXT, phone TEXT, head_name TEXT,
  open_cases INTEGER NOT NULL DEFAULT 0,
  dues_outstanding INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_inst_region ON institutions(region_code);

CREATE TABLE IF NOT EXISTS requirements (
  id INTEGER PRIMARY KEY,
  purpose TEXT NOT NULL, inst_type TEXT NOT NULL,
  min_amount INTEGER NOT NULL, min_tenure_months INTEGER NOT NULL, hold_years INTEGER NOT NULL,
  accepted_types TEXT NOT NULL,
  UNIQUE (purpose, inst_type)
);

CREATE TABLE IF NOT EXISTS instruments (
  id INTEGER PRIMARY KEY,
  ref_no TEXT UNIQUE NOT NULL,
  institution_id INTEGER NOT NULL REFERENCES institutions(id),
  purpose TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  -- declared by the institution
  instrument_no TEXT NOT NULL,
  bank_code TEXT, branch TEXT, ifsc TEXT,
  amount INTEGER NOT NULL,
  issue_date TEXT NOT NULL,
  maturity_date TEXT,
  depositor_name TEXT, lien_in_favour TEXT,
  auto_renew INTEGER NOT NULL DEFAULT 0,
  interest_rate REAL,
  account_enc TEXT, account_masked TEXT,
  -- read from the uploaded document / confirmed by the bank
  doc_json TEXT, doc_source TEXT,
  bank_json TEXT, bank_status TEXT NOT NULL DEFAULT 'unchecked', bank_checked_at TEXT,
  verification TEXT NOT NULL DEFAULT 'unverified',
  verified_at TEXT, verified_by INTEGER REFERENCES users(id), verify_note TEXT,
  -- requirement and lifecycle
  required_amount INTEGER, hold_until TEXT,
  predecessor_id INTEGER REFERENCES instruments(id),
  successor_id INTEGER REFERENCES instruments(id),
  officer_id INTEGER REFERENCES users(id),
  submitted_at TEXT NOT NULL, submitted_by INTEGER REFERENCES users(id),
  activated_at TEXT, matured_on TEXT, closed_at TEXT,
  next_action TEXT, next_action_due TEXT,
  reminder_stage INTEGER, last_overdue_notice TEXT,
  escalation_level INTEGER NOT NULL DEFAULT 0,
  legacy INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_instr_inst ON instruments(institution_id);
CREATE INDEX IF NOT EXISTS idx_instr_status ON instruments(status);
CREATE INDEX IF NOT EXISTS idx_instr_maturity ON instruments(maturity_date);
CREATE INDEX IF NOT EXISTS idx_instr_no ON instruments(bank_code, instrument_no);

CREATE TABLE IF NOT EXISTS instrument_events (
  id INTEGER PRIMARY KEY,
  instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL,
  from_status TEXT, to_status TEXT,
  remarks TEXT,
  data TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_instr ON instrument_events(instrument_id, at);
CREATE INDEX IF NOT EXISTS idx_events_at ON instrument_events(at);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  instrument_id INTEGER REFERENCES instruments(id) ON DELETE CASCADE,
  release_id INTEGER REFERENCES release_requests(id),
  kind TEXT NOT NULL,
  filename TEXT NOT NULL, stored_name TEXT NOT NULL, mime TEXT, size INTEGER,
  sha256 TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id), uploaded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_instr ON documents(instrument_id);
CREATE INDEX IF NOT EXISTS idx_docs_hash ON documents(sha256);

CREATE TABLE IF NOT EXISTS discrepancies (
  id INTEGER PRIMARY KEY,
  instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  rule TEXT NOT NULL, field TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','serious','critical')),
  message TEXT NOT NULL, action TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','resolved','waived')),
  detected_at TEXT NOT NULL, resolved_at TEXT, resolved_by INTEGER REFERENCES users(id), note TEXT,
  UNIQUE (instrument_id, rule, field)
);

CREATE TABLE IF NOT EXISTS queries (
  id INTEGER PRIMARY KEY,
  instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  raised_by INTEGER REFERENCES users(id), raised_at TEXT NOT NULL, due_on TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','answered','closed')),
  response TEXT, responded_at TEXT, responded_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS release_requests (
  id INTEGER PRIMARY KEY,
  req_no TEXT UNIQUE NOT NULL,
  instrument_id INTEGER NOT NULL REFERENCES instruments(id),
  institution_id INTEGER NOT NULL REFERENCES institutions(id),
  reason TEXT NOT NULL, details TEXT,
  status TEXT NOT NULL,
  prev_instrument_status TEXT,
  requested_by INTEGER REFERENCES users(id), requested_at TEXT NOT NULL,
  manual_checks TEXT NOT NULL DEFAULT '{}',
  recommended_by INTEGER, recommended_at TEXT,
  forwarded_by INTEGER, forwarded_at TEXT,
  approved_by INTEGER, approved_at TEXT,
  released_by INTEGER, released_at TEXT, release_ref TEXT,
  closed_remarks TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  dedupe_key TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','serious','critical')),
  audience TEXT NOT NULL,
  instrument_id INTEGER REFERENCES instruments(id) ON DELETE CASCADE,
  institution_id INTEGER REFERENCES institutions(id),
  release_id INTEGER REFERENCES release_requests(id),
  region_code TEXT,
  title TEXT NOT NULL, message TEXT,
  created_at TEXT NOT NULL, resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);
CREATE TABLE IF NOT EXISTS alert_reads (
  alert_id INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (alert_id, user_id)
);

-- Messages the portal sent automatically (e-mail/SMS gateway in production; logged here).
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  channel TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  institution_id INTEGER REFERENCES institutions(id),
  instrument_id INTEGER REFERENCES instruments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL, body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_inst ON outbox(institution_id, at);

-- The bank side of the verification sandbox: what each bank's own books say.
CREATE TABLE IF NOT EXISTS bank_registry (
  id INTEGER PRIMARY KEY,
  bank_code TEXT NOT NULL, instrument_no TEXT NOT NULL,
  branch TEXT, ifsc TEXT, amount INTEGER, issue_date TEXT, maturity_date TEXT,
  depositor_name TEXT, lien_in_favour TEXT,
  status TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE (bank_code, instrument_no)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT, entity_id TEXT,
  details TEXT,
  ip TEXT,
  prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`;

export function initSchema(db) {
  db.exec(SCHEMA);
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------- clock ----------
// The demo "time machine" moves the whole system forward by a number of days so judges can watch
// reminders, maturities and escalations happen. Every date in the server comes from here.
let offsetDays = 0;
export const setClockOffset = (days) => { offsetDays = Number(days) || 0; };
export const getClockOffset = () => offsetDays;
export const now = () => new Date(Date.now() + offsetDays * 86400000);
export const nowIso = () => now().toISOString();
// Dates are Indian Standard Time calendar dates.
export const today = () => new Date(now().getTime() + 5.5 * 3600000).toISOString().slice(0, 10);

export const addDays = (isoDate, n) => {
  const d = new Date(isoDate.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const addMonths = (isoDate, n) => {
  const d = new Date(isoDate.slice(0, 10) + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => {
  const da = new Date(a.slice(0, 10) + 'T00:00:00Z');
  const db = new Date(b.slice(0, 10) + 'T00:00:00Z');
  return Math.round((db - da) / 86400000);
};
export const monthsBetween = (a, b) => Math.round(daysBetween(a, b) / 30.44);

export function getSetting(db, key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}
export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}

export const inr = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN')}`;
