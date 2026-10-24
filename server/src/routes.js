import express from 'express';
import multer from 'multer';
import { makeAuth, requireRole, signToken, verifyPassword, publicUser } from './auth.js';
import {
  REGIONS, INSTRUMENT_TYPES, PURPOSES, STATUSES, BANKS, DOC_KINDS, REQUIRED_DOCS, RELEASE_REASONS, RELEASE_CHECKS, RELEASE_STATUSES,
  ROLES, EVENT_LABELS, VERIFICATION, DEFAULT_SETTINGS, INSTITUTION_TYPES, RELEASE_OPEN, typeByCode,
} from './domain.js';
import { HttpError, canView, STAFF_ACT } from './instruments.js';
import { instrumentFilter, listSelect, SORTS, toCsv } from './analytics.js';
import { provenance } from './rules.js';
import { today, getClockOffset, setClockOffset, setSetting, getSetting, tx, daysBetween, addDays } from './dbutil.js';
import { verifyAuditChain } from './audit.js';
import { bankLookup } from './bank.js';
import { sampleSpecs, sampleFile } from './samples.js';

const ALLOWED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, cb) => cb(ALLOWED_MIME.has(file.mimetype) ? null : new HttpError(400, `Only PDF, PNG or JPEG files are accepted (${file.originalname})`), ALLOWED_MIME.has(file.mimetype)),
});
const parseJson = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } };

export function buildRouter({ db, engine, service, analytics, audit, store, bus }) {
  const r = express.Router();
  const auth = makeAuth(db);

  // ---------- auth ----------
  const attempts = new Map();
  r.post('/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const key = String(username || '').toLowerCase();
    const a = attempts.get(key) || { n: 0, until: 0 };
    if (a.until > Date.now()) return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
    const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(key);
    if (!u || !verifyPassword(String(password || ''), u.password_hash)) {
      a.n++; if (a.n >= 5) { a.until = Date.now() + 60_000; a.n = 0; }
      attempts.set(key, a);
      audit(null, 'auth.failed', 'user', key, null, req.ip);
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    attempts.delete(key);
    audit(u, 'auth.login', 'user', u.username, null, req.ip);
    res.json({ token: signToken(u.id), user: publicUser(u) });
  });
  r.get('/auth/demo-accounts', (_req, res) => {
    if (process.env.FDR_HIDE_DEMO === '1') return res.json([]);
    res.json(db.prepare(`SELECT u.username, u.name, u.designation, u.role, i.name AS institution_name FROM users u LEFT JOIN institutions i ON i.id = u.institution_id
      WHERE u.username IN ('ms','rb.director','rb.officer1','accounts','auditor','institution1','institution2') ORDER BY u.id`).all());
  });

  r.use(auth);
  const me = (req) => {
    const u = req.user;
    return { ...u, institution: u.institution_id ? db.prepare('SELECT id, name, aicte_id, city, state, type, trust_name, region_code FROM institutions WHERE id = ?').get(u.institution_id) : null };
  };
  r.get('/auth/me', (req, res) => res.json(me(req)));

  // ---------- reference data ----------
  r.get('/meta', (req, res) => {
    res.json({
      regions: REGIONS, types: INSTRUMENT_TYPES, purposes: PURPOSES, statuses: STATUSES, banks: BANKS, docKinds: DOC_KINDS, requiredDocs: REQUIRED_DOCS,
      releaseReasons: RELEASE_REASONS, releaseChecks: RELEASE_CHECKS, releaseStatuses: RELEASE_STATUSES, roles: ROLES, eventLabels: EVENT_LABELS,
      verification: VERIFICATION, institutionTypes: INSTITUTION_TYPES,
      requirements: db.prepare('SELECT purpose, inst_type, min_amount, min_tenure_months, hold_years, accepted_types FROM requirements').all(),
      users: req.user.role === 'institution' ? [] : db.prepare("SELECT id, name, designation, role, regions FROM users WHERE active = 1 AND role != 'institution' ORDER BY id").all(),
    });
  });
  r.get('/clock', (_req, res) => res.json({ today: today(), offset: getClockOffset() }));

  // ---------- search ----------
  r.get('/search', (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ instruments: [], institutions: [] });
    const f = instrumentFilter({ q }, req.user);
    const instruments = db.prepare(`${listSelect(f.t)} WHERE ${f.sql} ORDER BY x.submitted_at DESC LIMIT 7`).all(...f.params);
    const like = `%${q}%`;
    const institutions = req.user.role === 'institution' ? [] : db.prepare('SELECT id, name, aicte_id, city, state FROM institutions WHERE name LIKE ? OR aicte_id LIKE ? OR city LIKE ? ORDER BY name LIMIT 6').all(like, like, like);
    res.json({ instruments, institutions });
  });

  // ---------- dashboard ----------
  r.get('/dashboard', (req, res) => res.json(analytics.dashboard(req.user, req.query)));
  r.get('/agenda', (req, res) => res.json(analytics.agenda(req.user, req.query)));

  // ---------- instruments ----------
  r.get('/instruments', (req, res) => {
    const f = instrumentFilter(req.query, req.user);
    const sort = SORTS[req.query.sort] || 'x.submitted_at';
    const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
    const base = `${listSelect(f.t)} WHERE ${f.sql}`;
    if (req.query.format === 'csv') {
      const rows = db.prepare(`${base} ORDER BY ${sort} ${dir}`).all(...f.params);
      audit(req.user, 'export.instruments', 'instruments', null, { count: rows.length });
      const cols = [['ref_no', 'Reference'], ['institution_name', 'Institution'], ['aicte_id', 'AICTE Permanent ID'], ['region_code', 'Region'], ['purpose', 'Purpose'], ['type', 'Type'],
        ['instrument_no', 'Instrument no.'], ['bank_code', 'Bank'], ['amount', 'Amount (Rs)'], ['issue_date', 'Issued'], ['maturity_date', 'Maturity'], ['hold_until', 'Hold until'],
        ['status', 'Status'], ['validity', 'Validity'], ['verification', 'Verification'], ['bank_status', 'Bank check'], ['open_issues', 'Open discrepancies'], ['officer_name', 'Dealing officer']].map(([key, label]) => ({ key, label }));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="aicte-sd-fdr-register-${today()}.csv"`);
      return res.send(toCsv(cols, rows));
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(200, Math.max(5, Number(req.query.size) || 25));
    const totals = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(x.amount),0) amount FROM instruments x JOIN institutions i ON i.id = x.institution_id LEFT JOIN instruments s ON s.id = x.successor_id WHERE ${f.sql}`).get(...f.params);
    const rows = db.prepare(`${base} ORDER BY ${sort} ${dir}, x.id DESC LIMIT ? OFFSET ?`).all(...f.params, size, (page - 1) * size);
    res.json({ total: totals.n, amount: totals.amount, page, size, rows });
  });

  r.get('/instruments/:id', (req, res) => {
    const x = service.viewable(req.params.id, req.user);
    const t = today();
    const row = db.prepare(`${listSelect(t)} WHERE x.id = ?`).get(x.id);
    const inst = db.prepare('SELECT * FROM institutions WHERE id = ?').get(x.institution_id);
    const events = db.prepare(`SELECT e.*, u.name AS actor_name, u.designation AS actor_designation, u.role AS actor_role FROM instrument_events e LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.instrument_id = ? ORDER BY e.at, e.id`).all(x.id).map((e) => ({ ...e, data: parseJson(e.data) }));
    const documents = db.prepare(`SELECT d.id, d.kind, d.filename, d.mime, d.size, d.sha256, d.uploaded_at, d.release_id, u.name AS uploaded_by_name FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE d.instrument_id = ? ORDER BY d.uploaded_at, d.id`).all(x.id);
    const discrepancies = db.prepare(`SELECT d.*, u.name AS resolved_by_name FROM discrepancies d LEFT JOIN users u ON u.id = d.resolved_by WHERE d.instrument_id = ?
      ORDER BY d.status = 'open' DESC, CASE d.severity WHEN 'critical' THEN 0 WHEN 'serious' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, d.detected_at DESC`).all(x.id);
    const queries = db.prepare(`SELECT q.*, u1.name AS raised_by_name, u2.name AS responded_by_name FROM queries q LEFT JOIN users u1 ON u1.id = q.raised_by LEFT JOIN users u2 ON u2.id = q.responded_by
      WHERE q.instrument_id = ? ORDER BY q.raised_at DESC`).all(x.id);
    const releases = db.prepare('SELECT id FROM release_requests WHERE instrument_id = ? ORDER BY id DESC').all(x.id).map((rr) => service.release(rr.id));
    // lineage: walk back to the first instrument, then forward through successors
    let first = x;
    const guard = new Set();
    while (first.predecessor_id && !guard.has(first.id)) { guard.add(first.id); first = db.prepare('SELECT * FROM instruments WHERE id = ?').get(first.predecessor_id); }
    const lineage = [];
    for (let cur = first, n = 0; cur && n < 30; n++) {
      lineage.push({ id: cur.id, ref_no: cur.ref_no, instrument_no: cur.instrument_no, bank_code: cur.bank_code, amount: cur.amount, issue_date: cur.issue_date, maturity_date: cur.maturity_date, status: cur.status, verification: cur.verification });
      cur = cur.successor_id ? db.prepare('SELECT * FROM instruments WHERE id = ?').get(cur.successor_id) : null;
    }
    const verifiedBy = x.verified_by ? db.prepare('SELECT name, designation FROM users WHERE id = ?').get(x.verified_by) : null;
    const u = req.user;
    const pending = ['Submitted', 'Under Scrutiny'].includes(x.status);
    const openRelease = releases.find((rr) => RELEASE_OPEN.includes(rr.status));
    const staffAct = STAFF_ACT.includes(u.role);
    res.json({
      ...row, ...x, account_enc: undefined, doc: parseJson(x.doc_json), bank: parseJson(x.bank_json), doc_json: undefined, bank_json: undefined,
      validity: engine.validity(x, t), validity_state: row.validity,
      institution: inst, requirement: engine.requirementFor(x, inst), provenance: provenance(x), events, documents, discrepancies, queries, releases, lineage,
      verified_by_name: verifiedBy ? `${verifiedBy.name}, ${verifiedBy.designation}` : null,
      permissions: {
        bankCheck: staffAct && x.type !== 'SD' && !['Released', 'Rejected', 'Renewed'].includes(x.status),
        query: staffAct && pending,
        verify: staffAct && pending,
        verifyWithoutBank: ['head', 'admin'].includes(u.role) && pending,
        reject: staffAct && ['Submitted', 'Under Scrutiny', 'Query Raised'].includes(x.status),
        waive: ['head', 'admin'].includes(u.role),
        edit: (u.role === 'institution' && ['Submitted', 'Query Raised'].includes(x.status)) || (staffAct && ['Submitted', 'Under Scrutiny', 'Query Raised'].includes(x.status)),
        reply: (u.role === 'institution' || staffAct) && x.status === 'Query Raised',
        upload: u.role === 'institution' || staffAct,
        note: u.role !== 'auditor',
        renew: (u.role === 'institution' || staffAct) && ['Active', 'Matured'].includes(x.status) && (!x.successor_id || db.prepare('SELECT status FROM instruments WHERE id = ?').get(x.successor_id)?.status === 'Rejected'),
        requestRelease: (u.role === 'institution' || staffAct) && ['Active', 'Matured', 'Renewed'].includes(x.status) && !openRelease,
      },
    });
  });

  r.post('/extract', upload.any(), (req, res) => {
    const file = (req.files || [])[0];
    res.json(service.readDocument(file, req.body?.ocr_text));
  });

  r.post('/instruments', upload.any(), (req, res) => res.status(201).json(service.create(req.body || {}, req.user, req.files || [])));
  r.post('/instruments/:id/bank-check', (req, res) => res.json(service.bankCheck(req.params.id, req.user)));
  r.post('/instruments/:id/fields', (req, res) => res.json(service.updateFields(req.params.id, req.body || {}, req.user)));
  r.post('/instruments/:id/documents', upload.any(), (req, res) => res.json(service.uploadDocs(req.params.id, req.files || [], req.user)));
  r.post('/instruments/:id/query', (req, res) => res.json(service.raiseQuery(req.params.id, req.body || {}, req.user)));
  r.post('/instruments/:id/reply', upload.any(), (req, res) => res.json(service.answerQuery(req.params.id, { ...req.body, fields: parseJson(req.body?.fields) }, req.files || [], req.user)));
  r.post('/instruments/:id/verify', (req, res) => res.json(service.verify(req.params.id, req.body || {}, req.user)));
  r.post('/instruments/:id/reject', (req, res) => res.json(service.reject(req.params.id, req.body || {}, req.user)));
  r.post('/instruments/:id/note', (req, res) => res.json(service.note(req.params.id, req.body || {}, req.user)));
  r.post('/instruments/:id/release', upload.any(), (req, res) => res.status(201).json(service.requestRelease(req.params.id, req.body || {}, req.files || [], req.user)));
  r.post('/discrepancies/:id/waive', (req, res) => res.json(service.waive(req.params.id, req.body || {}, req.user)));

  r.get('/documents/:id', (req, res) => {
    const d = db.prepare('SELECT d.*, x.institution_id FROM documents d JOIN instruments x ON x.id = d.instrument_id WHERE d.id = ?').get(Number(req.params.id));
    if (!d) throw new HttpError(404, 'Document not found');
    if (!canView(req.user, d)) throw new HttpError(403, 'Not permitted');
    const bytes = store.read(d.stored_name);
    if (!bytes) throw new HttpError(404, 'File missing on server');
    audit(req.user, 'document.view', 'document', String(d.id), { instrument_id: d.instrument_id });
    res.setHeader('Content-Type', d.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${d.filename.replace(/"/g, '')}"`);
    res.send(bytes);
  });

  // ---------- release / refund ----------
  r.get('/releases', (req, res) => {
    const where = ['1=1'];
    const p = [];
    if (req.user.role === 'institution') { where.push('r.institution_id = ?'); p.push(req.user.institution_id); }
    const stageFor = { officer: 'Submitted', head: 'Recommended', admin: 'Forwarded', accounts: 'Approved', institution: 'Returned' };
    let rows = db.prepare(`SELECT r.id FROM release_requests r WHERE ${where.join(' AND ')} ORDER BY r.updated_at DESC`).all(...p).map((x) => service.release(x.id));
    if (req.query.status === 'open') rows = rows.filter((x) => RELEASE_OPEN.includes(x.status));
    else if (req.query.status === 'mine') rows = rows.filter((x) => x.status === stageFor[req.user.role]);
    else if (req.query.status) rows = rows.filter((x) => x.status === req.query.status);
    res.json(rows.map((x) => ({ ...x, age_days: daysBetween(x.requested_at.slice(0, 10), today()), waiting_on: stageFor[req.user.role] === x.status })));
  });
  r.get('/releases/:id', (req, res) => {
    const rr = service.release(req.params.id);
    if (req.user.role === 'institution' && rr.institution_id !== req.user.institution_id) throw new HttpError(403, 'Not your institution');
    const docs = db.prepare('SELECT id, kind, filename, mime, size, uploaded_at FROM documents WHERE release_id = ?').all(rr.id);
    res.json({ ...rr, documents: docs });
  });
  r.post('/releases/:id/act', (req, res) => res.json(service.actRelease(req.params.id, req.body || {}, req.user)));

  // ---------- institutions ----------
  r.get('/institutions', requireRole('admin', 'head', 'officer', 'accounts', 'auditor'), (req, res) => {
    const where = ['1=1'];
    const p = [];
    if (req.query.region) { where.push('i.region_code = ?'); p.push(req.query.region); }
    if (req.query.type) { where.push('i.type = ?'); p.push(req.query.type); }
    if (req.query.q) { const q = `%${req.query.q}%`; where.push('(i.name LIKE ? OR i.aicte_id LIKE ? OR i.city LIKE ?)'); p.push(q, q, q); }
    const t = today();
    const having = req.query.attention === '1' ? 'HAVING lapsed > 0 OR pending > 0 OR alerts > 0' : '';
    const sort = { name: 'i.name', held: 'held DESC', lapsed: 'lapsed DESC' }[req.query.sort] || 'lapsed DESC, alerts DESC, i.name';
    const size = Math.min(200, Number(req.query.size) || 50);
    const page = Math.max(1, Number(req.query.page) || 1);
    const sql = `SELECT i.id, i.aicte_id, i.name, i.city, i.state, i.region_code, i.type, i.approval_status, i.open_cases, i.dues_outstanding,
        COUNT(x.id) AS instruments,
        COALESCE(SUM(CASE WHEN x.status IN ('Active','Matured','Release Requested') THEN x.amount END),0) AS held,
        SUM(x.status IN ('Submitted','Under Scrutiny','Query Raised')) AS pending,
        SUM(x.status = 'Matured' AND x.hold_until > x.maturity_date) AS lapsed,
        SUM(x.bank_status IN ('encashed','not_found') AND x.status IN ('Active','Matured','Release Requested')) AS alerts,
        MIN(CASE WHEN x.status = 'Active' AND x.maturity_date >= ? THEN x.maturity_date END) AS next_maturity
      FROM institutions i LEFT JOIN instruments x ON x.institution_id = i.id WHERE ${where.join(' AND ')} GROUP BY i.id ${having}`;
    const total = db.prepare(`SELECT COUNT(*) n FROM (${sql})`).get(t, ...p).n;
    const rows = db.prepare(`${sql} ORDER BY ${sort} LIMIT ? OFFSET ?`).all(t, ...p, size, (page - 1) * size);
    res.json({ total, rows });
  });
  r.get('/institutions/:id', (req, res) => {
    const id = Number(req.params.id);
    if (req.user.role === 'institution' && req.user.institution_id !== id) throw new HttpError(403, 'Not your institution');
    const inst = db.prepare('SELECT * FROM institutions WHERE id = ?').get(id);
    if (!inst) throw new HttpError(404, 'Institution not found');
    const t = today();
    const instruments = db.prepare(`${listSelect(t)} WHERE x.institution_id = ? ORDER BY x.purpose, x.issue_date DESC`).all(id);
    const requirements = db.prepare('SELECT * FROM requirements WHERE inst_type = ?').all(inst.type);
    const purposes = [...new Set(instruments.filter((x) => !['Rejected'].includes(x.status)).map((x) => x.purpose))];
    const compliance = purposes.map((pc) => {
      const req = requirements.find((rq) => rq.purpose === pc);
      const held = instruments.filter((x) => x.purpose === pc && ['Active', 'Matured', 'Release Requested'].includes(x.status));
      const heldAmount = held.filter((x) => x.validity !== 'lapsed').reduce((s, x) => s + x.amount, 0);
      const holdUntil = instruments.filter((x) => x.purpose === pc).map((x) => x.hold_until).sort().pop();
      return { purpose: pc, required: req?.min_amount ?? 0, held: heldAmount, holdUntil, complete: holdUntil && holdUntil <= t, lapsed: held.filter((x) => x.validity === 'lapsed').length };
    });
    const outbox = db.prepare('SELECT * FROM outbox WHERE institution_id = ? ORDER BY at DESC LIMIT 60').all(id);
    const releases = db.prepare('SELECT id FROM release_requests WHERE institution_id = ? ORDER BY id DESC').all(id).map((x) => service.release(x.id));
    res.json({ ...inst, region: REGIONS.find((rg) => rg.code === inst.region_code), instruments, compliance, outbox, releases });
  });

  // ---------- alerts ----------
  const alertScope = (u) => {
    if (u.role === 'institution') return { sql: "a.audience LIKE '%,institution,%' AND a.institution_id = ?", params: [u.institution_id] };
    if (u.role === 'auditor') return { sql: '1=1', params: [] };
    if (u.role === 'officer') {
      const regions = String(u.regions || '').split(',').filter(Boolean);
      return { sql: `a.audience LIKE '%,officer,%' AND (a.region_code IS NULL OR a.region_code IN (${regions.map(() => '?').join(',') || "''"}))`, params: regions };
    }
    if (u.role === 'head') return { sql: "(a.audience LIKE '%,head,%' OR a.audience LIKE '%,officer,%')", params: [] };
    return { sql: `a.audience LIKE '%,${u.role},%'`, params: [] };
  };
  r.get('/alerts', (req, res) => {
    const s = alertScope(req.user);
    const where = [s.sql];
    const params = [...s.params];
    if (req.query.type) { where.push('a.type = ?'); params.push(req.query.type); }
    if (req.query.severity) { where.push('a.severity = ?'); params.push(req.query.severity); }
    if (req.query.state !== 'all') where.push(req.query.state === 'resolved' ? 'a.resolved_at IS NOT NULL' : 'a.resolved_at IS NULL');
    if (req.query.unread === '1') where.push('rd.alert_id IS NULL');
    const rows = db.prepare(`SELECT a.*, x.ref_no, i.name AS institution_name, (rd.alert_id IS NOT NULL) AS read
      FROM alerts a LEFT JOIN instruments x ON x.id = a.instrument_id LEFT JOIN institutions i ON i.id = a.institution_id
      LEFT JOIN alert_reads rd ON rd.alert_id = a.id AND rd.user_id = ? WHERE ${where.join(' AND ')}
      ORDER BY a.resolved_at IS NOT NULL, CASE a.severity WHEN 'critical' THEN 0 WHEN 'serious' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, a.created_at DESC LIMIT ?`).all(req.user.id, ...params, Math.min(500, Number(req.query.limit) || 200));
    const counts = db.prepare(`SELECT a.type, a.severity, COUNT(*) n FROM alerts a WHERE ${s.sql} AND a.resolved_at IS NULL GROUP BY a.type, a.severity`).all(...s.params);
    res.json({ rows, counts });
  });
  r.get('/alerts/summary', (req, res) => {
    const s = alertScope(req.user);
    const row = db.prepare(`SELECT COUNT(*) total, SUM(rd.alert_id IS NULL) unread, SUM(a.severity = 'critical' AND rd.alert_id IS NULL) critical
      FROM alerts a LEFT JOIN alert_reads rd ON rd.alert_id = a.id AND rd.user_id = ? WHERE ${s.sql} AND a.resolved_at IS NULL`).get(req.user.id, ...s.params);
    const latest = db.prepare(`SELECT a.id, a.type, a.severity, a.title, a.created_at, a.instrument_id, a.institution_id, a.release_id, (rd.alert_id IS NOT NULL) AS read FROM alerts a
      LEFT JOIN alert_reads rd ON rd.alert_id = a.id AND rd.user_id = ? WHERE ${s.sql} AND a.resolved_at IS NULL
      ORDER BY rd.alert_id IS NOT NULL, CASE a.severity WHEN 'critical' THEN 0 WHEN 'serious' THEN 1 ELSE 2 END, a.created_at DESC LIMIT 8`).all(req.user.id, ...s.params);
    res.json({ ...row, latest });
  });
  r.post('/alerts/:id/read', (req, res) => {
    db.prepare('INSERT OR IGNORE INTO alert_reads (alert_id, user_id) VALUES (?,?)').run(Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });
  r.post('/alerts/read-all', (req, res) => {
    const s = alertScope(req.user);
    db.prepare(`INSERT OR IGNORE INTO alert_reads (alert_id, user_id) SELECT a.id, ? FROM alerts a WHERE ${s.sql} AND a.resolved_at IS NULL`).run(req.user.id, ...s.params);
    res.json({ ok: true });
  });

  // ---------- reports ----------
  r.get('/reports', (req, res) => res.json(analytics.reportList()));
  r.get('/reports/:name', (req, res) => {
    const rep = analytics.report(req.params.name, req.user, req.query);
    if (!rep) throw new HttpError(404, 'Unknown report');
    if (req.query.format === 'csv') {
      audit(req.user, 'export.report', 'report', rep.name, { count: rep.rows.length });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="aicte-${rep.name}-${today()}.csv"`);
      return res.send(toCsv(rep.columns, rep.rows));
    }
    res.json(rep);
  });

  // ---------- demo samples ----------
  const sampleInst = (req) => {
    const id = req.user.role === 'institution' ? req.user.institution_id : Number(req.query.institution_id);
    const inst = db.prepare('SELECT * FROM institutions WHERE id = ?').get(id);
    if (!inst) throw new HttpError(400, 'Choose the institution first');
    const purpose = String(req.query.purpose || 'NEW_INST');
    inst.required = db.prepare('SELECT min_amount FROM requirements WHERE purpose = ? AND inst_type = ?').get(purpose, inst.type)?.min_amount;
    return inst;
  };
  r.get('/samples', (req, res) => res.json(sampleSpecs(sampleInst(req), today()).map(({ key, title, expect, bank_name, type }) => ({ key, title, expect, bank_name, type }))));
  r.get('/samples/:key/:doc', (req, res) => {
    const inst = sampleInst(req);
    const spec = sampleSpecs(inst, today()).find((s) => s.key === req.params.key);
    if (!spec) throw new HttpError(404, 'Unknown sample');
    const pdf = sampleFile(db, inst, spec, req.params.doc);
    if (!pdf) throw new HttpError(404, 'Unknown document');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="sample-${spec.key}-${req.params.doc}.pdf"`);
    res.send(pdf);
  });
  r.get('/bank-sandbox/lookup', requireRole('admin', 'head', 'officer', 'auditor'), (req, res) => res.json(bankLookup(db, { bank_code: req.query.bank, instrument_no: req.query.no })));

  // ---------- administration ----------
  r.get('/admin/settings', requireRole('admin', 'head', 'auditor'), (_req, res) => res.json({
    monitoring: { ...DEFAULT_SETTINGS, ...getSetting(db, 'monitoring', {}) },
    requirements: db.prepare('SELECT * FROM requirements ORDER BY purpose, inst_type').all(),
    clock: { today: today(), offset: getClockOffset() },
  }));
  r.post('/admin/settings', requireRole('admin'), (req, res) => {
    const m = req.body?.monitoring || {};
    const clean = {};
    const nums = (v) => String(v).split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0);
    if (m.reminder_ladder !== undefined) clean.reminder_ladder = [...new Set(Array.isArray(m.reminder_ladder) ? m.reminder_ladder.map(Number) : nums(m.reminder_ladder))].sort((a, b) => b - a);
    if (m.escalation_days !== undefined) { clean.escalation_days = (Array.isArray(m.escalation_days) ? m.escalation_days.map(Number) : nums(m.escalation_days)).slice(0, 3).sort((a, b) => a - b); if (clean.escalation_days.length !== 3) throw new HttpError(400, 'Give three escalation thresholds'); }
    for (const k of ['overdue_repeat_days', 'scrutiny_sla_days', 'query_response_days', 'release_sla_days', 'reverify_days', 'minutes_per_manual_letter']) if (m[k] !== undefined) clean[k] = Math.max(1, Number(m[k]) || 1);
    setSetting(db, 'monitoring', { ...getSetting(db, 'monitoring', {}), ...clean });
    audit(req.user, 'settings.monitoring', 'settings', 'monitoring', clean);
    engine.refreshAlerts();
    res.json({ ok: true });
  });
  r.post('/admin/requirements', requireRole('admin'), (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    tx(db, () => {
      for (const row of rows) {
        const types = String(row.accepted_types || '').split(',').map((s) => s.trim()).filter((s) => typeByCode[s]);
        if (!types.length) throw new HttpError(400, 'Each rule needs at least one accepted instrument type');
        db.prepare('UPDATE requirements SET min_amount = ?, min_tenure_months = ?, hold_years = ?, accepted_types = ? WHERE id = ?')
          .run(Math.max(0, Math.round(Number(row.min_amount) || 0)), Math.max(1, Number(row.min_tenure_months) || 1), Math.max(1, Number(row.hold_years) || 1), types.join(','), Number(row.id));
      }
    });
    audit(req.user, 'settings.requirements', 'settings', 'requirements', { count: rows.length });
    res.json({ ok: true });
  });
  r.post('/admin/clock', requireRole('admin'), (req, res) => {
    const before = getClockOffset();
    const target = req.body?.reset ? 0 : Math.min(3650, Math.max(0, before + (Number(req.body?.days) || 0)));
    const changes = { matured: 0, reminders: 0, overdue: 0, escalated: 0, bankAlerts: 0 };
    if (target < before) {
      // Going back is only a display change: reminders already sent stay sent.
      setClockOffset(target);
    } else {
      // Step day by day so every reminder and escalation fires on the right date.
      for (let d = before + 1; d <= target; d++) {
        setClockOffset(d);
        const c = engine.sweep({ emit: false });
        for (const k of Object.keys(changes)) changes[k] += c[k] ?? 0;
      }
    }
    setSetting(db, 'clock_offset_days', target);
    audit(req.user, 'demo.clock', 'system', null, { from: before, to: target });
    bus.emit('event', { type: 'clock', offset: target, today: today(), by: req.user.name, ...changes });
    res.json({ today: today(), offset: target, ...changes });
  });
  r.post('/admin/sweep', requireRole('admin', 'head'), (req, res) => {
    const changes = engine.sweep();
    audit(req.user, 'monitoring.sweep', 'system', null, changes);
    res.json(changes);
  });
  r.get('/audit', requireRole('admin', 'auditor'), (req, res) => {
    const rows = db.prepare(`SELECT l.*, u.name AS user_name, u.username FROM audit_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT ?`).all(Math.min(1000, Number(req.query.limit) || 200));
    res.json(rows);
  });
  r.get('/audit/verify', requireRole('admin', 'auditor'), (req, res) => {
    const out = verifyAuditChain(db);
    audit(req.user, 'audit.verify', 'audit_log', null, out);
    res.json(out);
  });

  return r;
}

export { addDays };
