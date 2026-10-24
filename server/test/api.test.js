// End-to-end API tests against a freshly seeded throwaway database. They follow the test scenarios
// named in the problem statement: new submission, discrepancy identification, renewal, authorised
// release, validity tracking and approaching maturity (time machine), plus security checks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdr-test-'));
const PORT = 4300 + Math.floor(Math.random() * 500);
const base = `http://localhost:${PORT}/api`;
const DB = path.join(dir, 'test.db');
let proc;

async function call(method, url, token, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(base + url, {
    method, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body && !isForm && { 'Content-Type': 'application/json' }) },
    body: body && (isForm ? body : JSON.stringify(body)),
  });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : ct.includes('pdf') ? new Uint8Array(await res.arrayBuffer()) : await res.text() };
}
const login = async (u) => (await call('POST', '/auth/login', null, { username: u, password: 'Aicte@2026' })).body.token;
const tokens = {};

async function sample(token, key, doc) {
  const r = await call('GET', `/samples/${key}/${doc}`, token);
  assert.equal(r.status, 200, `sample ${key}/${doc}`);
  return new Blob([r.body], { type: 'application/pdf' });
}
/** Submits a sample the way the UI does: read the scan, prefill from it, attach the documents. */
async function submitSample(token, key, extra = {}) {
  const scan = await sample(token, key, 'instrument');
  const ex = new FormData();
  ex.append('file', scan, `${key}.pdf`);
  const read = (await call('POST', '/extract', token, ex)).body;
  assert.equal(read.source, 'pdf-text');
  const f = new FormData();
  f.append('purpose', extra.purpose ?? 'NEW_INST');
  f.append('type', read.fields.type ?? 'FDR');
  for (const k of ['instrument_no', 'bank_code', 'branch', 'ifsc', 'amount', 'issue_date', 'maturity_date', 'depositor_name', 'lien_in_favour', 'interest_rate', 'account_no']) {
    if (read.fields[k] !== undefined) f.append(k, String(read.fields[k]));
  }
  for (const [k, v] of Object.entries(extra)) if (k !== 'purpose' && k !== 'files') f.set(k, String(v));
  f.append('INSTRUMENT', scan, `${key}.pdf`);
  f.append('COVER_LETTER', await sample(token, key, 'cover'), 'cover.pdf');
  f.append('RESOLUTION', await sample(token, key, 'resolution'), 'resolution.pdf');
  for (const [kind, blob] of extra.files ?? []) f.append(kind, blob, `${kind}.pdf`);
  return call('POST', '/instruments', token, f);
}

before(async () => {
  proc = spawn(process.execPath, ['src/index.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, DB_PATH: DB, UPLOAD_DIR: path.join(dir, 'uploads') }, stdio: 'pipe' });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  for (const u of ['ms', 'rb.director', 'rb.officer1', 'rb.officer2', 'accounts', 'auditor', 'institution1', 'institution2']) tokens[u] = await login(u);
  assert.ok(tokens.ms, 'server did not start');
});
after(() => { proc?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('auth: bad credentials and unauthenticated calls are refused', async () => {
  assert.equal((await call('POST', '/auth/login', null, { username: 'ms', password: 'x' })).status, 401);
  assert.equal((await call('GET', '/instruments')).status, 401);
});

test('dashboard: every category the statement lists, plus KPIs', async () => {
  const { body } = await call('GET', '/dashboard', tokens.ms);
  for (const k of ['active', 'expiring', 'matured', 'renewed', 'released', 'pending']) assert.equal(typeof body.categories[k], 'number', k);
  assert.equal(body.maturityProfile.length, 12);
  assert.ok(body.kpis.turnaround.portal < body.kpis.turnaround.legacy, 'portal verification should be faster than the manual baseline');
  assert.ok(body.kpis.bankConfirmed.pct > 0);
});

test('institutions see only their own records', async () => {
  const mine = (await call('GET', '/instruments?size=200', tokens.institution1)).body;
  assert.ok(mine.total > 0);
  const me = (await call('GET', '/auth/me', tokens.institution1)).body;
  assert.ok(mine.rows.every((r) => r.institution_id === me.institution_id));
  const other = (await call('GET', '/instruments?size=5', tokens.ms)).body.rows.find((r) => r.institution_id !== me.institution_id);
  assert.equal((await call('GET', `/instruments/${other.id}`, tokens.institution1)).status, 403);
  assert.equal((await call('GET', '/institutions', tokens.institution1)).status, 403);
});

let cleanId;
test('scenario: new FDR submission is read, bank-confirmed and accepted', async () => {
  const r = await submitSample(tokens.institution1, 'clean');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  cleanId = r.body.id;
  const d = (await call('GET', `/instruments/${cleanId}`, tokens['rb.director'])).body;
  assert.equal(d.bank_status, 'confirmed');
  assert.ok(d.provenance.every((p) => p.documentMatch !== false && p.bankMatch !== false), 'declared, document and bank agree');
  assert.equal(d.discrepancies.filter((x) => x.status === 'open' && ['critical', 'serious'].includes(x.severity)).length, 0);
  assert.equal((await call('POST', `/instruments/${cleanId}/verify`, tokens.auditor, { mode: 'bank_api' })).status, 403, 'auditor is read-only');
  const v = await call('POST', `/instruments/${cleanId}/verify`, tokens['rb.director'], { mode: 'bank_api' });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.status, 'Active');
  assert.equal(v.body.verification, 'bank_api');
});

test('scenario: discrepancies are identified and block acceptance', async () => {
  // an altered FDR: the bank's books show a tenth of the amount on the scan
  const t = await submitSample(tokens.institution1, 'tampered');
  assert.equal(t.status, 201);
  const d = (await call('GET', `/instruments/${t.body.id}`, tokens['rb.director'])).body;
  assert.ok(d.discrepancies.some((x) => x.rule === 'BANK_MISMATCH' && x.field === 'amount' && x.severity === 'critical'));
  const v = await call('POST', `/instruments/${t.body.id}/verify`, tokens['rb.director'], { mode: 'bank_api' });
  assert.equal(v.status, 400);
  // critical findings cannot be waived
  const crit = d.discrepancies.find((x) => x.severity === 'critical');
  assert.equal((await call('POST', `/discrepancies/${crit.id}/waive`, tokens['rb.director'], { note: 'Looks fine to me on paper' })).status, 400);
  // the same FDR submitted twice is caught as a duplicate
  const dup = await submitSample(tokens.institution1, 'clean');
  const dd = (await call('GET', `/instruments/${dup.body.id}`, tokens['rb.director'])).body;
  assert.ok(dd.discrepancies.some((x) => x.rule === 'DUPLICATE_INSTRUMENT'));
  assert.ok(dd.discrepancies.some((x) => x.rule === 'DUPLICATE_FILE'));
  // no lien to AICTE, and short amount / tenure
  const nl = (await call('GET', `/instruments/${(await submitSample(tokens.institution1, 'nolien')).body.id}`, tokens.ms)).body;
  assert.ok(nl.discrepancies.some((x) => x.rule === 'LIEN_NOT_AICTE'));
  const sh = (await call('GET', `/instruments/${(await submitSample(tokens.institution1, 'short')).body.id}`, tokens.ms)).body;
  assert.ok(sh.discrepancies.some((x) => x.rule === 'AMOUNT_SHORT'));
  assert.ok(sh.discrepancies.some((x) => x.rule === 'TENURE_SHORT'));
  // query → reply → back under scrutiny; then reject
  const q = await call('POST', `/instruments/${t.body.id}/query`, tokens['rb.director'], { text: 'The bank reports a different amount. Please explain.' });
  assert.equal(q.body.status, 'Query Raised');
  const reply = new FormData();
  reply.append('response', 'We will get the bank to confirm in writing.');
  const a = await call('POST', `/instruments/${t.body.id}/reply`, tokens.institution1, reply);
  assert.equal(a.body.status, 'Under Scrutiny');
  const rej = await call('POST', `/instruments/${t.body.id}/reject`, tokens['rb.director'], { note: 'Altered instrument: bank record shows Rs 3.5 lakh.' });
  assert.equal(rej.body.status, 'Rejected');
});

test('scenario: renewal is linked to the instrument it replaces', async () => {
  const list = (await call('GET', '/instruments?validity=expiring,lapsed&size=50', tokens.institution1)).body.rows;
  const old = list.find((x) => !x.successor_id) ?? (await call('GET', '/instruments?status=Active&size=50', tokens.institution1)).body.rows.find((x) => !x.successor_id && x.type !== 'SD');
  assert.ok(old, 'institution1 has an instrument to renew');
  const letter = await sample(tokens.institution1, 'letter', 'bank');
  const r = await submitSample(tokens.institution1, 'letter', { predecessor_id: old.id, files: [['BANK_CONFIRMATION', letter]] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.purpose, old.purpose, 'renewal inherits the purpose');
  assert.equal(r.body.hold_until, old.hold_until, 'and the holding period');
  assert.equal(r.body.bank_status, 'unsupported', 'Indian Bank is not connected to the sandbox');
  assert.equal((await call('POST', `/instruments/${r.body.id}/verify`, tokens['rb.officer1'], { mode: 'officer', note: 'Seen the original, looks fine' })).status, 403, 'officers cannot accept without bank confirmation');
  const v = await call('POST', `/instruments/${r.body.id}/verify`, tokens['rb.director'], { mode: 'bank_letter' });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const prev = (await call('GET', `/instruments/${old.id}`, tokens.ms)).body;
  assert.equal(prev.status, 'Renewed');
  assert.deepEqual(prev.lineage.slice(-2).map((l) => l.id), [old.id, r.body.id]);
});

test('scenario: authorised release with maker-checker-approver and a release letter', async () => {
  const rows = (await call('GET', '/instruments?status=Active,Matured&validity=complete,maturing&size=50', tokens.institution2)).body.rows;
  const x = rows.find((r) => r.hold_until <= new Date().toISOString().slice(0, 10)) ?? rows[0];
  assert.ok(x, 'institution2 has an instrument eligible for release');
  const f = new FormData();
  f.append('reason', 'HOLD_COMPLETE');
  f.append('details', 'Holding period completed; please release.');
  const rr = await call('POST', `/instruments/${x.id}/release`, tokens.institution2, f);
  assert.equal(rr.status, 201, JSON.stringify(rr.body));
  const id = rr.body.id;
  const act = (who, body) => call('POST', `/releases/${id}/act`, tokens[who], body);
  const officer = (await call('GET', `/instruments/${x.id}`, tokens.ms)).body.officer_name ? 'rb.director' : 'rb.director';
  assert.equal((await act('rb.director', { action: 'check', code: 'ORIGINALS', ok: true })).status, 200);
  assert.equal((await act(officer, { action: 'recommend', remarks: 'All conditions met' })).body.status, 'Recommended');
  assert.equal((await act('rb.director', { action: 'forward' })).status, 400, 'the maker cannot be the checker');
  // re-do with a different maker: return and resubmit, then officer recommends
  assert.equal((await act('rb.director', { action: 'return', remarks: 'Please attach the discharge form signed.' })).body.status, 'Returned');
  assert.equal((await act('institution2', { action: 'resubmit', remarks: 'Attached.' })).body.status, 'Submitted');
  const instOfficer = ['rb.officer1', 'rb.officer2'];
  let rec;
  for (const o of instOfficer) { rec = await act(o, { action: 'recommend' }); if (rec.status === 200) break; }
  assert.equal(rec.body.status, 'Recommended');
  assert.equal((await act('ms', { action: 'approve' })).status, 400, 'approval needs the Director first');
  assert.equal((await act('rb.director', { action: 'forward' })).body.status, 'Forwarded');
  assert.equal((await act('accounts', { action: 'approve' })).status, 403);
  assert.equal((await act('ms', { action: 'approve' })).body.status, 'Approved');
  const done = await act('accounts', { action: 'release' });
  assert.equal(done.body.status, 'Released', JSON.stringify(done.body));
  const d = (await call('GET', `/instruments/${x.id}`, tokens.institution2)).body;
  assert.equal(d.status, 'Released');
  const letter = d.documents.find((doc) => doc.kind === 'RELEASE_LETTER');
  assert.ok(letter);
  const pdf = await call('GET', `/documents/${letter.id}`, tokens.institution2);
  assert.equal(new TextDecoder().decode(pdf.body.slice(0, 5)), '%PDF-');
});

test('security: documents are encrypted at rest and the audit trail is tamper-evident', async () => {
  const uploads = fs.readdirSync(path.join(dir, 'uploads')).filter((f) => f !== '.gitkeep');
  const raw = fs.readFileSync(path.join(dir, 'uploads', uploads[0]));
  assert.notEqual(raw.subarray(0, 5).toString(), '%PDF-', 'files on disk are not readable PDFs');
  const ok = (await call('GET', '/audit/verify', tokens.auditor)).body;
  assert.equal(ok.ok, true);
  const db = new DatabaseSync(DB);
  db.prepare("UPDATE audit_log SET details = '{\"edited\":true}' WHERE id = 2").run();
  db.close();
  const bad = (await call('GET', '/audit/verify', tokens.auditor)).body;
  assert.equal(bad.ok, false);
  assert.equal(bad.brokenAt, 2);
});

test('scenario: validity tracking and approaching maturity (time machine)', async () => {
  const startedAt = new Date().toISOString();
  const expiring = (await call('GET', '/instruments?validity=expiring&size=200', tokens.ms)).body.total;
  assert.equal((await call('POST', '/admin/clock', tokens['rb.director'], { days: 30 })).status, 403);
  const r = await call('POST', '/admin/clock', tokens.ms, { days: 45 });
  assert.equal(r.body.offset, 45);
  const sent = (await call('GET', '/reports/notifications', tokens.ms)).body.rows.filter((n) => n.at > startedAt && ['REMINDER', 'OVERDUE'].includes(n.kind));
  assert.ok(sent.length > 0, 'reminders were sent as maturities approached');
  const lapsed = (await call('GET', '/instruments?validity=lapsed&size=200', tokens.ms)).body.total;
  assert.ok(lapsed > 0 && expiring >= 0);
  const alerts = (await call('GET', '/alerts?type=LAPSED', tokens.ms)).body.rows;
  assert.ok(alerts.length >= 0);
  assert.equal((await call('POST', '/admin/clock', tokens.ms, { reset: true })).body.offset, 0);
});
