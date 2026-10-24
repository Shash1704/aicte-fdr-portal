// Instrument and release-request workflows. Every change records an event, an audit entry and a
// live update, and re-runs the discrepancy rules.
import { bus } from './engine.js';
import { tx, nowIso, today, addDays, addMonths, daysBetween, inr } from './dbutil.js';
import {
  PENDING_STATUSES, HELD_STATUSES, RELEASE_CHECKS, RELEASE_OPEN, bankByCode, typeByCode, purposeByCode, DOC_KINDS, RELEASE_REASONS,
} from './domain.js';
import { extractFromDocument, parseFields } from './extract.js';
import { normNo } from './bank.js';
import { sha256 } from './sha256.js';
import { encryptText } from './vault.js';
import { releaseLetterPdf } from './letters.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const STAFF_ACT = ['officer', 'head', 'admin'];
export const canView = (user, instr) => user.role !== 'institution' || instr.institution_id === user.institution_id;
const dmy = (iso) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '—');
const EDITABLE = ['instrument_no', 'bank_code', 'branch', 'ifsc', 'amount', 'issue_date', 'maturity_date', 'depositor_name', 'lien_in_favour', 'auto_renew', 'interest_rate'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const rand = () => Math.random().toString(36).slice(2, 10);
export const maskAccount = (a) => (a ? `XXXX${String(a).slice(-4)}` : null);

export class InstrumentService {
  constructor({ db, engine, audit, store }) {
    Object.assign(this, { db, engine, audit, store });
  }

  get(id) {
    const x = this.db.prepare('SELECT * FROM instruments WHERE id = ?').get(Number(id));
    if (!x) throw new HttpError(404, 'Instrument not found');
    return x;
  }
  viewable(id, user) {
    const x = this.get(id);
    if (!canView(user, x)) throw new HttpError(403, 'Not your institution');
    return x;
  }
  emit(type, x, user, extra = {}) {
    bus.emit('event', { type, instrument_id: x.id, ref_no: x.ref_no, institution_id: x.institution_id, status: extra.status ?? x.status, by: user?.name, ...extra });
  }

  nextRef(prefix, table, col) {
    const year = today().slice(0, 4);
    const max = this.db.prepare(`SELECT MAX(CAST(substr(${col}, ?) AS INTEGER)) AS n FROM ${table} WHERE ${col} LIKE ?`).get(prefix.length + 7, `${prefix}-${year}-%`)?.n;
    const n = (max ?? 0) + 1;
    return `${prefix}-${year}-${String(n).padStart(5, '0')}`;
  }

  saveDoc({ instrumentId = null, releaseId = null, kind, file, user, at = nowIso() }) {
    if (!DOC_KINDS.some((k) => k.code === kind)) throw new HttpError(400, `Unknown document type ${kind}`);
    const bytes = file.buffer instanceof Uint8Array ? file.buffer : new Uint8Array(file.buffer);
    const ext = (file.originalname.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? '').toLowerCase();
    const stored = `${Date.now()}-${rand()}${ext}`;
    this.store.save(stored, bytes);
    const hash = sha256(bytes);
    const r = this.db.prepare('INSERT INTO documents (instrument_id, release_id, kind, filename, stored_name, mime, size, sha256, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(instrumentId, releaseId, kind, file.originalname, stored, file.mimetype, bytes.length, hash, user?.id ?? null, at);
    return { id: Number(r.lastInsertRowid), bytes, hash };
  }

  officerFor(regionCode) {
    return this.db.prepare("SELECT id FROM users WHERE role = 'officer' AND active = 1 AND (',' || regions || ',') LIKE ? ORDER BY id LIMIT 1").get(`%,${regionCode},%`)?.id ?? null;
  }

  /** Reads the uploaded instrument: PDF text layer on the server, or OCR text sent by the browser. */
  readDocument(file, ocrText) {
    if (file) {
      const r = extractFromDocument(file.buffer instanceof Uint8Array ? file.buffer : new Uint8Array(file.buffer), file.mimetype);
      if (r.found) return { source: r.source, fields: r.fields, confidence: r.confidence };
    }
    if (ocrText && String(ocrText).trim().length > 20) {
      const r = parseFields(ocrText);
      return { source: 'ocr', fields: r.fields, confidence: r.confidence };
    }
    return { source: 'none', fields: {}, confidence: {} };
  }

  cleanFields(body, { partial = false } = {}) {
    const f = {};
    for (const k of EDITABLE) if (body[k] !== undefined) f[k] = typeof body[k] === 'string' ? body[k].trim() : body[k];
    if (f.instrument_no !== undefined) f.instrument_no = normNo(f.instrument_no);
    if (f.ifsc !== undefined) f.ifsc = String(f.ifsc).toUpperCase().replace(/\s/g, '') || null;
    if (f.amount !== undefined) f.amount = Math.round(Number(String(f.amount).replace(/[^\d.]/g, '')));
    if (f.interest_rate !== undefined) f.interest_rate = f.interest_rate === '' || f.interest_rate === null ? null : Number(f.interest_rate);
    if (f.auto_renew !== undefined) f.auto_renew = f.auto_renew === true || f.auto_renew === '1' || f.auto_renew === 1 || f.auto_renew === 'true' ? 1 : 0;
    if (f.maturity_date === '') f.maturity_date = null;
    if (!partial) {
      for (const k of ['instrument_no', 'amount', 'issue_date', 'lien_in_favour', 'depositor_name']) if (!f[k]) throw new HttpError(400, `Missing ${k.replace(/_/g, ' ')}`);
    }
    if (f.amount !== undefined && !(f.amount > 0)) throw new HttpError(400, 'Amount must be a positive number');
    for (const k of ['issue_date', 'maturity_date']) if (f[k] && !ISO.test(f[k])) throw new HttpError(400, `${k.replace('_', ' ')} must be a date (YYYY-MM-DD)`);
    if (f.bank_code !== undefined && f.bank_code && !bankByCode[f.bank_code]) throw new HttpError(400, 'Unknown bank');
    return f;
  }

  // ---------------- submission ----------------
  create(body, user, files = []) {
    if (!['institution', ...STAFF_ACT].includes(user.role)) throw new HttpError(403, 'Not permitted for your role');
    const institutionId = user.role === 'institution' ? user.institution_id : Number(body.institution_id);
    const inst = this.db.prepare('SELECT * FROM institutions WHERE id = ?').get(institutionId);
    if (!inst) throw new HttpError(400, 'Choose the institution');
    let pred = null;
    if (body.predecessor_id) {
      pred = this.get(body.predecessor_id);
      if (pred.institution_id !== institutionId) throw new HttpError(400, 'The instrument being renewed belongs to another institution');
      if (!HELD_STATUSES.includes(pred.status)) throw new HttpError(400, `${pred.ref_no} is ${pred.status}; only held instruments can be renewed`);
      if (pred.successor_id) {
        const s = this.get(pred.successor_id);
        if (s.status !== 'Rejected') throw new HttpError(400, `A renewal (${s.ref_no}) has already been submitted for ${pred.ref_no}`);
      }
    }
    const purpose = pred?.purpose ?? body.purpose;
    const type = body.type;
    if (!purposeByCode[purpose]) throw new HttpError(400, 'Choose the purpose of the deposit');
    if (!typeByCode[type]) throw new HttpError(400, 'Choose the instrument type');
    const f = this.cleanFields(body);
    if (typeByCode[type].hasMaturity && !f.maturity_date) throw new HttpError(400, 'Maturity / validity date is required');
    if (type !== 'SD' && !f.bank_code) throw new HttpError(400, 'Choose the issuing bank');
    if (type === 'SD' && !f.bank_code) f.bank_code = null;
    const instrumentFile = files.find((x) => x.fieldname === 'INSTRUMENT');
    if (!instrumentFile) throw new HttpError(400, 'Upload the scanned instrument');

    const req = this.engine.requirementFor({ purpose }, inst);
    const at = nowIso();
    const id = tx(this.db, () => {
      const ref = this.nextRef('SD', 'instruments', 'ref_no');
      const doc = this.readDocument(instrumentFile, body.ocr_text);
      const r = this.db.prepare(`INSERT INTO instruments (ref_no, institution_id, purpose, type, status, instrument_no, bank_code, branch, ifsc, amount, issue_date, maturity_date,
          depositor_name, lien_in_favour, auto_renew, interest_rate, account_enc, account_masked, doc_json, doc_source, required_amount, hold_until, predecessor_id, officer_id,
          submitted_at, submitted_by, next_action, next_action_due, created_at, updated_at)
        VALUES (?,?,?,?,'Submitted',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        ref, institutionId, purpose, type, f.instrument_no, f.bank_code, f.branch ?? null, f.ifsc ?? null, f.amount, f.issue_date, typeByCode[type].hasMaturity ? f.maturity_date : null,
        f.depositor_name, f.lien_in_favour, f.auto_renew ?? 0, f.interest_rate ?? null, encryptText(body.account_no), maskAccount(body.account_no),
        JSON.stringify(doc), doc.source, pred?.required_amount ?? req?.min_amount ?? null,
        pred?.hold_until ?? (req ? addMonths(f.issue_date, req.hold_years * 12) : null), pred?.id ?? null, this.officerFor(inst.region_code),
        at, user.id, 'Scrutiny by dealing officer', addDays(today(), this.engine.settings().scrutiny_sla_days), at, at);
      const newId = Number(r.lastInsertRowid);
      for (const file of files) this.saveDoc({ instrumentId: newId, kind: file.fieldname, file, user, at });
      this.engine.event(newId, 'SUBMITTED', user, { to: 'Submitted', remarks: body.remarks || `${typeByCode[type].short} ${f.instrument_no} for ${inr(f.amount)}${pred ? ` as renewal of ${pred.ref_no}` : ''}.` });
      if (doc.source !== 'none') this.engine.event(newId, 'EXTRACTED', null, { remarks: `${Object.keys(doc.fields).length} fields read from the document (${doc.source === 'ocr' ? 'OCR' : 'PDF text'}).`, data: doc.fields });
      if (pred) {
        this.db.prepare('UPDATE instruments SET successor_id = ?, next_action = ?, updated_at = ? WHERE id = ?').run(newId, `Verify renewal ${ref}`, at, pred.id);
        this.engine.event(pred.id, 'RENEWAL_SUBMITTED', user, { remarks: `Renewal submitted as ${ref}.`, data: { successor_id: newId } });
      }
      return newId;
    });
    let x = this.get(id);
    // Instant check with the bank where the bank is connected: most submissions arrive pre-verified.
    if (x.type !== 'SD' && bankByCode[x.bank_code]?.api) this.engine.applyBankCheck(x, null);
    else if (x.type !== 'SD') this.db.prepare("UPDATE instruments SET bank_status = 'unsupported' WHERE id = ?").run(id);
    this.engine.evaluate(id);
    x = this.get(id);
    this.engine.notify(inst, x, 'ACK', `${x.ref_no}: ${typeByCode[type].short} received`, `We have received ${typeByCode[type].short} No. ${x.instrument_no} for ${inr(x.amount)} towards "${purposeByCode[purpose].name}". Reference ${x.ref_no}. You will be informed of the verification result.`);
    this.audit(user, 'instrument.submit', 'instrument', x.ref_no, { institution: inst.aicte_id, amount: x.amount });
    this.engine.refreshAlerts();
    this.emit('instrument.submitted', x, user, { institution: inst.name });
    return x;
  }

  ensureScrutiny(x, user) {
    if (x.status === 'Submitted') {
      this.db.prepare("UPDATE instruments SET status = 'Under Scrutiny', updated_at = ? WHERE id = ?").run(nowIso(), x.id);
      this.engine.event(x.id, 'SCRUTINY', user, { from: 'Submitted', to: 'Under Scrutiny' });
      x.status = 'Under Scrutiny';
    }
  }
  requireStaff(user, roles = STAFF_ACT) { if (!roles.includes(user.role)) throw new HttpError(403, 'Not permitted for your role'); }

  bankCheck(id, user) {
    this.requireStaff(user);
    const x = this.get(id);
    if (x.type === 'SD') throw new HttpError(400, 'Online security deposits are confirmed from the AICTE account statement, not a bank FDR service');
    if (PENDING_STATUSES.includes(x.status)) this.ensureScrutiny(x, user);
    const r = this.engine.applyBankCheck(x, user);
    this.audit(user, 'instrument.bank_check', 'instrument', x.ref_no, { status: r.status, ref: r.result.ref });
    this.engine.refreshAlerts();
    this.emit('instrument.updated', x, user);
    return r;
  }

  updateFields(id, body, user) {
    const x = this.viewable(id, user);
    const reason = String(body.reason || '').trim();
    if (user.role === 'institution') {
      if (!['Submitted', 'Query Raised'].includes(x.status)) throw new HttpError(400, 'Details can be corrected only while the submission is pending or a query is open');
    } else {
      this.requireStaff(user);
      if (!PENDING_STATUSES.includes(x.status)) throw new HttpError(400, 'Details of an accepted instrument cannot be edited; raise a fresh submission instead');
      if (reason.length < 5) throw new HttpError(400, 'Give a reason for the correction');
    }
    const f = this.cleanFields(body.fields || {}, { partial: true });
    const diff = {};
    for (const [k, v] of Object.entries(f)) if (String(x[k] ?? '') !== String(v ?? '')) diff[k] = { from: x[k], to: v };
    if (!Object.keys(diff).length) return x;
    const at = nowIso();
    this.db.prepare(`UPDATE instruments SET ${Object.keys(diff).map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...Object.keys(diff).map((k) => f[k]), at, x.id);
    this.engine.event(x.id, 'FIELD_UPDATED', user, { remarks: reason || 'Corrected by institution', data: diff });
    let y = this.get(x.id);
    if (y.type !== 'SD' && bankByCode[y.bank_code]?.api && ['instrument_no', 'bank_code', 'amount', 'issue_date', 'maturity_date'].some((k) => diff[k])) this.engine.applyBankCheck(y, null);
    this.engine.evaluate(x.id);
    y = this.get(x.id);
    this.audit(user, 'instrument.update', 'instrument', x.ref_no, diff);
    this.engine.refreshAlerts();
    this.emit('instrument.updated', y, user);
    return y;
  }

  uploadDocs(id, files, user) {
    const x = this.viewable(id, user);
    if (user.role === 'auditor' || user.role === 'accounts') throw new HttpError(403, 'Not permitted for your role');
    if (!files.length) throw new HttpError(400, 'Choose a file');
    for (const file of files) {
      this.saveDoc({ instrumentId: x.id, kind: file.fieldname === 'files' ? 'OTHER' : file.fieldname, file, user });
      this.engine.event(x.id, 'DOC_UPLOADED', user, { remarks: `${DOC_KINDS.find((k) => k.code === file.fieldname)?.name ?? 'Document'}: ${file.originalname}` });
    }
    this.engine.evaluate(x.id);
    this.audit(user, 'document.upload', 'instrument', x.ref_no, { count: files.length });
    this.engine.refreshAlerts();
    this.emit('instrument.updated', x, user);
    return this.get(x.id);
  }

  raiseQuery(id, body, user) {
    this.requireStaff(user);
    const x = this.get(id);
    if (!['Submitted', 'Under Scrutiny'].includes(x.status)) throw new HttpError(400, `Cannot raise a query on a ${x.status} instrument`);
    const text = String(body.text || '').trim();
    if (text.length < 10) throw new HttpError(400, 'Write the query for the institution');
    const days = Math.min(60, Math.max(3, Number(body.due_days) || this.engine.settings().query_response_days));
    const due = addDays(today(), days);
    const from = x.status;
    tx(this.db, () => {
      this.db.prepare("INSERT INTO queries (instrument_id, raised_by, raised_at, due_on, text, status) VALUES (?,?,?,?,?,'open')").run(x.id, user.id, nowIso(), due, text);
      this.db.prepare("UPDATE instruments SET status = 'Query Raised', next_action = 'Reply awaited from institution', next_action_due = ?, updated_at = ? WHERE id = ?").run(due, nowIso(), x.id);
      this.engine.event(x.id, 'QUERY_RAISED', user, { from, to: 'Query Raised', remarks: text, data: { due } });
    });
    const inst = this.db.prepare('SELECT * FROM institutions WHERE id = ?').get(x.institution_id);
    this.engine.notify(inst, x, 'QUERY', `${x.ref_no}: query from AICTE, reply by ${dmy(due)}`, text);
    this.audit(user, 'instrument.query', 'instrument', x.ref_no, { due });
    this.engine.refreshAlerts();
    this.emit('instrument.updated', x, user, { status: 'Query Raised' });
    return this.get(x.id);
  }

  answerQuery(id, body, files, user) {
    const x = this.viewable(id, user);
    if (user.role !== 'institution') this.requireStaff(user);
    const q = this.db.prepare("SELECT * FROM queries WHERE instrument_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(x.id);
    if (!q) throw new HttpError(400, 'There is no open query');
    const response = String(body.response || '').trim();
    if (response.length < 3) throw new HttpError(400, 'Write a reply');
    if (body.fields && Object.keys(body.fields).length) this.updateFields(x.id, { fields: body.fields, reason: `Corrected in reply to query: ${response.slice(0, 80)}` }, user.role === 'institution' ? user : { ...user, role: 'institution', institution_id: x.institution_id });
    tx(this.db, () => {
      for (const file of files) this.saveDoc({ instrumentId: x.id, kind: DOC_KINDS.some((k) => k.code === file.fieldname) ? file.fieldname : 'QUERY_REPLY', file, user });
      this.db.prepare("UPDATE queries SET status = 'answered', response = ?, responded_at = ?, responded_by = ? WHERE id = ?").run(response, nowIso(), user.id, q.id);
      this.db.prepare("UPDATE instruments SET status = 'Under Scrutiny', next_action = 'Review reply to query', next_action_due = ?, updated_at = ? WHERE id = ?").run(addDays(today(), 7), nowIso(), x.id);
      this.engine.event(x.id, 'QUERY_ANSWERED', user, { from: 'Query Raised', to: 'Under Scrutiny', remarks: response, data: { files: files.length } });
    });
    this.engine.evaluate(x.id);
    this.audit(user, 'instrument.query_reply', 'instrument', x.ref_no, null);
    this.engine.refreshAlerts();
    this.emit('instrument.updated', x, user, { status: 'Under Scrutiny' });
    return this.get(x.id);
  }

  waive(discId, body, user) {
    this.requireStaff(user, ['head', 'admin']);
    const d = this.db.prepare('SELECT * FROM discrepancies WHERE id = ?').get(Number(discId));
    if (!d) throw new HttpError(404, 'Discrepancy not found');
    const note = String(body.note || '').trim();
    if (note.length < 10) throw new HttpError(400, 'Record why this discrepancy is being waived');
    if (d.severity === 'critical') throw new HttpError(400, 'Critical discrepancies cannot be waived; they must be resolved');
    this.db.prepare("UPDATE discrepancies SET status = 'waived', resolved_at = ?, resolved_by = ?, note = ? WHERE id = ?").run(nowIso(), user.id, note, d.id);
    this.engine.event(d.instrument_id, 'WAIVED', user, { remarks: `${d.message} — ${note}` });
    this.audit(user, 'discrepancy.waive', 'instrument', String(d.instrument_id), { rule: d.rule, note });
    this.engine.refreshAlerts();
    return { ok: true };
  }

  verify(id, body, user) {
    this.requireStaff(user);
    const x = this.get(id);
    if (!['Submitted', 'Under Scrutiny'].includes(x.status)) throw new HttpError(400, `A ${x.status} instrument cannot be accepted`);
    const open = this.engine.evaluate(x.id);
    const blocking = open.filter((d) => d.severity === 'critical' || d.severity === 'serious');
    if (blocking.length) throw new HttpError(400, `Resolve or waive ${blocking.length} blocking discrepanc${blocking.length === 1 ? 'y' : 'ies'} first: ${blocking[0].message}`);
    const mode = body.mode;
    const note = String(body.note || '').trim();
    if (mode === 'bank_api') {
      if (x.bank_status !== 'confirmed') throw new HttpError(400, 'The bank has not confirmed this instrument. Check with the bank first, or use a bank confirmation letter.');
    } else if (mode === 'bank_letter') {
      if (!this.db.prepare("SELECT 1 FROM documents WHERE instrument_id = ? AND kind = 'BANK_CONFIRMATION'").get(x.id)) throw new HttpError(400, 'Upload the bank confirmation letter first');
    } else if (mode === 'officer') {
      if (!['head', 'admin'].includes(user.role)) throw new HttpError(403, 'Acceptance without bank confirmation needs the Director or the Competent Authority');
      if (note.length < 15) throw new HttpError(400, 'Record why the instrument is accepted without bank confirmation');
    } else throw new HttpError(400, 'Choose how the instrument was verified');
    const at = nowIso();
    const pred = x.predecessor_id ? this.get(x.predecessor_id) : null;
    tx(this.db, () => {
      this.db.prepare(`UPDATE instruments SET status = 'Active', verification = ?, verified_at = ?, verified_by = ?, verify_note = ?, activated_at = ?, next_action = NULL, next_action_due = NULL,
        reminder_stage = NULL, updated_at = ? WHERE id = ?`).run(mode, at, user.id, note || null, at, at, x.id);
      this.engine.event(x.id, 'VERIFIED', user, { from: x.status, to: 'Active', remarks: note || { bank_api: 'Bank confirmed all details through the verification service.', bank_letter: 'Verified against the bank confirmation letter.' }[mode], data: { mode } });
      if (pred && HELD_STATUSES.includes(pred.status)) {
        this.db.prepare("UPDATE instruments SET status = 'Renewed', closed_at = ?, next_action = 'Release old instrument to the institution', escalation_level = 0, updated_at = ? WHERE id = ?").run(at, at, pred.id);
        this.engine.event(pred.id, 'RENEWED', user, { from: pred.status, to: 'Renewed', remarks: `Superseded by ${x.ref_no}.` });
      }
    });
    const inst = this.db.prepare('SELECT * FROM institutions WHERE id = ?').get(x.institution_id);
    this.engine.notify(inst, x, 'ACCEPTED', `${x.ref_no}: accepted by AICTE`, `${typeByCode[x.type].short} No. ${x.instrument_no} for ${inr(x.amount)} has been verified and taken on record${x.maturity_date ? `. It matures on ${dmy(x.maturity_date)}` : ''}.${pred ? ` It replaces ${pred.ref_no}; you may apply for release of the old instrument.` : ''}`);
    this.engine.evaluate(x.id);
    if (pred) this.engine.evaluate(pred.id);
    this.audit(user, 'instrument.verify', 'instrument', x.ref_no, { mode });
    this.engine.sweep({ emit: false });
    this.emit('instrument.verified', x, user, { status: 'Active' });
    return this.get(x.id);
  }

  reject(id, body, user) {
    this.requireStaff(user);
    const x = this.get(id);
    if (!PENDING_STATUSES.includes(x.status)) throw new HttpError(400, `A ${x.status} instrument cannot be rejected`);
    const note = String(body.note || '').trim();
    if (note.length < 10) throw new HttpError(400, 'Give the reason for rejection');
    tx(this.db, () => {
      this.db.prepare("UPDATE instruments SET status = 'Rejected', closed_at = ?, next_action = NULL, next_action_due = NULL, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), x.id);
      this.db.prepare("UPDATE queries SET status = 'closed' WHERE instrument_id = ? AND status = 'open'").run(x.id);
      this.engine.event(x.id, 'REJECTED', user, { from: x.status, to: 'Rejected', remarks: note });
      if (x.predecessor_id) this.db.prepare('UPDATE instruments SET successor_id = NULL WHERE id = ? AND successor_id = ?').run(x.predecessor_id, x.id);
    });
    const inst = this.db.prepare('SELECT * FROM institutions WHERE id = ?').get(x.institution_id);
    this.engine.notify(inst, x, 'REJECTED', `${x.ref_no}: submission not accepted`, `Your submission ${x.ref_no} was not accepted. Reason: ${note}. Please submit a valid instrument.`);
    this.engine.evaluate(x.id);
    this.audit(user, 'instrument.reject', 'instrument', x.ref_no, { note });
    this.engine.refreshAlerts();
    this.emit('instrument.updated', x, user, { status: 'Rejected' });
    return this.get(x.id);
  }

  note(id, body, user) {
    if (user.role === 'auditor') throw new HttpError(403, 'Read-only role');
    const x = this.viewable(id, user);
    const text = String(body.text || '').trim();
    if (text.length < 3) throw new HttpError(400, 'Write a note');
    this.engine.event(x.id, 'NOTE', user, { remarks: text });
    this.audit(user, 'instrument.note', 'instrument', x.ref_no, null);
    return { ok: true };
  }

  // ---------------- release / refund ----------------
  checklist(rr) {
    const x = this.get(rr.instrument_id);
    const inst = this.db.prepare('SELECT * FROM institutions WHERE id = ?').get(x.institution_id);
    const manual = JSON.parse(rr.manual_checks || '{}');
    const t = today();
    const openDisc = this.db.prepare("SELECT COUNT(*) n FROM discrepancies WHERE instrument_id = ? AND status = 'open' AND severity IN ('critical','serious')").get(x.id).n;
    const succ = x.successor_id ? this.get(x.successor_id) : null;
    let eligible = false;
    let detail = '';
    switch (rr.reason) {
      case 'HOLD_COMPLETE': eligible = !!x.hold_until && x.hold_until <= t; detail = `Holding period ${eligible ? 'ended' : 'ends'} on ${dmy(x.hold_until)}`; break;
      case 'REPLACED': eligible = !!succ && ['Active', 'Matured'].includes(succ.status); detail = succ ? `Replacement ${succ.ref_no} is ${succ.status}` : 'No replacement on record'; break;
      case 'CLOSURE': case 'NOT_APPROVED': eligible = ['Closure approved', 'Approval refused', 'Application withdrawn'].includes(inst.approval_status); detail = `Approval status: ${inst.approval_status}`; break;
      case 'EXCESS': {
        const others = this.db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM instruments WHERE institution_id = ? AND purpose = ? AND id != ? AND status IN ('Active','Matured')`).get(x.institution_id, x.purpose, x.id).s;
        eligible = others >= (x.required_amount ?? Infinity); detail = `Other deposits for this purpose: ${inr(others)} against ${inr(x.required_amount)} required`; break;
      }
      default: detail = 'Unknown reason';
    }
    return RELEASE_CHECKS.filter((c) => !c.types || c.types.includes(x.type)).map((c) => {
      const auto = {
        VERIFIED: [x.verification !== 'unverified', x.verification === 'unverified' ? 'Never verified' : `Verified (${x.verification.replace('_', ' ')}) on ${dmy(x.verified_at)}`],
        ELIGIBLE: [eligible, detail],
        NO_DISCREPANCY: [openDisc === 0, openDisc ? `${openDisc} open discrepanc${openDisc === 1 ? 'y' : 'ies'}` : 'None open'],
        NO_REG_ACTION: [inst.open_cases === 0, inst.open_cases ? `${inst.open_cases} open complaint/regulatory case(s) in ICMS` : 'No open cases in ICMS'],
        NO_DUES: [inst.dues_outstanding === 0, inst.dues_outstanding ? `${inr(inst.dues_outstanding)} outstanding` : 'No dues'],
      }[c.code];
      if (auto) return { ...c, ok: auto[0], detail: auto[1] };
      const m = manual[c.code];
      return { ...c, ok: !!m?.ok, detail: m?.ok ? `Confirmed by ${m.by} on ${dmy(m.at)}` : 'Not yet confirmed' };
    });
  }

  requestRelease(instrumentId, body, files, user) {
    const x = this.viewable(instrumentId, user);
    if (user.role !== 'institution') this.requireStaff(user);
    const reason = body.reason;
    if (!RELEASE_REASONS.some((r) => r.code === reason)) throw new HttpError(400, 'Choose the reason for release');
    const allowed = reason === 'REPLACED' ? ['Active', 'Matured', 'Renewed'] : ['Active', 'Matured'];
    if (!allowed.includes(x.status)) throw new HttpError(400, `A ${x.status} instrument cannot be released${x.status === 'Renewed' ? ' except as "replaced"' : ''}`);
    if (this.db.prepare(`SELECT 1 FROM release_requests WHERE instrument_id = ? AND status IN (${RELEASE_OPEN.map(() => '?').join(',')})`).get(x.id, ...RELEASE_OPEN)) throw new HttpError(400, 'A release request is already in progress for this instrument');
    const at = nowIso();
    const id = tx(this.db, () => {
      const reqNo = this.nextRef('REL', 'release_requests', 'req_no');
      const r = this.db.prepare(`INSERT INTO release_requests (req_no, instrument_id, institution_id, reason, details, status, prev_instrument_status, requested_by, requested_at, updated_at)
        VALUES (?,?,?,?,?,'Submitted',?,?,?,?)`).run(reqNo, x.id, x.institution_id, reason, String(body.details || '').trim() || null, x.status, user.id, at, at);
      const rid = Number(r.lastInsertRowid);
      for (const file of files) this.saveDoc({ instrumentId: x.id, releaseId: rid, kind: DOC_KINDS.some((k) => k.code === file.fieldname) ? file.fieldname : 'OTHER', file, user });
      this.db.prepare("UPDATE instruments SET status = 'Release Requested', next_action = 'Scrutinise release request', next_action_due = ?, updated_at = ? WHERE id = ?").run(addDays(today(), 7), at, x.id);
      this.engine.event(x.id, 'RELEASE_REQUESTED', user, { from: x.status, to: 'Release Requested', remarks: `${reqNo}: ${RELEASE_REASONS.find((r) => r.code === reason).name}.${body.details ? ` ${body.details}` : ''}`, data: { release_id: rid } });
      return rid;
    });
    const rr = this.release(id);
    this.audit(user, 'release.request', 'release', rr.req_no, { instrument: x.ref_no, reason });
    this.engine.refreshAlerts();
    this.emit('release.updated', x, user, { status: 'Release Requested', req_no: rr.req_no });
    return rr;
  }

  release(id) {
    const rr = this.db.prepare(`SELECT r.*, x.ref_no, x.type, x.amount, x.instrument_no, x.bank_code, x.status AS instrument_status, i.name AS institution_name, i.aicte_id,
        ur.name AS requested_by_name, u1.name AS recommended_by_name, u2.name AS forwarded_by_name, u3.name AS approved_by_name, u4.name AS released_by_name
      FROM release_requests r JOIN instruments x ON x.id = r.instrument_id JOIN institutions i ON i.id = r.institution_id
      LEFT JOIN users ur ON ur.id = r.requested_by LEFT JOIN users u1 ON u1.id = r.recommended_by LEFT JOIN users u2 ON u2.id = r.forwarded_by
      LEFT JOIN users u3 ON u3.id = r.approved_by LEFT JOIN users u4 ON u4.id = r.released_by WHERE r.id = ?`).get(Number(id));
    if (!rr) throw new HttpError(404, 'Release request not found');
    return { ...rr, manual_checks: JSON.parse(rr.manual_checks || '{}'), checklist: this.checklist(rr) };
  }

  /** One step of the release workflow: maker (officer) → checker (Director) → approver (CA) → Accounts. */
  actRelease(id, body, user) {
    const rr = this.release(id);
    const x = this.get(rr.instrument_id);
    if (user.role === 'institution' && x.institution_id !== user.institution_id) throw new HttpError(403, 'Not your institution');
    const action = body.action;
    const remarks = String(body.remarks || '').trim();
    const at = nowIso();
    const set = (fields) => this.db.prepare(`UPDATE release_requests SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...Object.values(fields), at, rr.id);
    const step = (to, text) => {
      this.engine.event(x.id, 'RELEASE_STEP', user, { remarks: `${rr.req_no}: ${text}${remarks ? ` — ${remarks}` : ''}`, data: { release_id: rr.id, from: rr.status, to } });
    };
    const need = (cond, msg, code = 400) => { if (!cond) throw new HttpError(code, msg); };
    const sameActor = (uid) => uid && uid === user.id;
    const failing = (codes) => rr.checklist.filter((c) => codes.includes(c.code) && !c.ok);
    const inst = this.db.prepare('SELECT * FROM institutions WHERE id = ?').get(x.institution_id);

    switch (action) {
      case 'check': {
        const item = RELEASE_CHECKS.find((c) => c.code === body.code && !c.auto);
        need(item, 'Unknown checklist item');
        need(RELEASE_OPEN.includes(rr.status) && rr.status !== 'Returned', 'This request is not open');
        need(user.role === item.role || user.role === 'admin' || (item.role === 'officer' && user.role === 'head'), `Only the ${item.role === 'accounts' ? 'Accounts Officer' : 'dealing officer'} can confirm this item`, 403);
        const manual = { ...rr.manual_checks, [item.code]: body.ok ? { ok: true, by: user.name, at: today() } : undefined };
        set({ manual_checks: JSON.stringify(manual) });
        step(rr.status, `${body.ok ? 'Confirmed' : 'Unchecked'}: ${item.label}`);
        break;
      }
      case 'recommend':
        need(['officer', 'head'].includes(user.role), 'Only the dealing officer recommends release', 403);
        need(rr.status === 'Submitted', `Request is ${rr.status}`);
        need(!failing(['VERIFIED', 'ELIGIBLE', 'NO_DISCREPANCY']).length, `Cannot recommend: ${failing(['VERIFIED', 'ELIGIBLE', 'NO_DISCREPANCY']).map((c) => c.detail).join('; ')}`);
        set({ status: 'Recommended', recommended_by: user.id, recommended_at: at });
        step('Recommended', 'Scrutinised and recommended for release');
        break;
      case 'forward':
        need(user.role === 'head', 'Only the Director forwards to the Competent Authority', 403);
        need(rr.status === 'Recommended', `Request is ${rr.status}`);
        need(!sameActor(rr.recommended_by), 'The person who recommended cannot also check it (maker-checker)');
        set({ status: 'Forwarded', forwarded_by: user.id, forwarded_at: at });
        step('Forwarded', 'Checked and forwarded to the Competent Authority');
        break;
      case 'approve': {
        need(user.role === 'admin', 'Only the Competent Authority approves release', 403);
        need(rr.status === 'Forwarded', `Request is ${rr.status}`);
        need(!sameActor(rr.recommended_by) && !sameActor(rr.forwarded_by), 'The approver must be different from the maker and the checker');
        const bad = rr.checklist.filter((c) => !c.ok && c.code !== 'REFUND_ACCOUNT');
        need(!bad.length, `Conditions not met: ${bad.map((c) => c.label).join('; ')}`);
        set({ status: 'Approved', approved_by: user.id, approved_at: at });
        step('Approved', 'Approved by the Competent Authority');
        this.engine.notify(inst, x, 'RELEASE', `${rr.req_no}: release approved`, `Release of ${x.ref_no} (${typeByCode[x.type].short} ${x.instrument_no}, ${inr(x.amount)}) has been approved. The discharge letter will follow from the Accounts section.`);
        break;
      }
      case 'release': {
        need(user.role === 'accounts', 'Release is executed by the Accounts Officer', 403);
        need(rr.status === 'Approved', `Request is ${rr.status}`);
        const bad = rr.checklist.filter((c) => !c.ok);
        need(!bad.length, `Conditions not met: ${bad.map((c) => c.label).join('; ')}`);
        const ref = `AICTE/RB/REL/${today().slice(0, 4)}/${rr.req_no.split('-').pop()}`;
        const approver = this.db.prepare('SELECT name, designation FROM users WHERE id = ?').get(rr.approved_by);
        tx(this.db, () => {
          const pdf = releaseLetterPdf({ inst, instrument: x, rr, approver: `${approver?.name}, ${approver?.designation}`, ref, date: today() });
          this.saveDoc({ instrumentId: x.id, releaseId: rr.id, kind: 'RELEASE_LETTER', file: { originalname: `release-letter-${rr.req_no}.pdf`, mimetype: 'application/pdf', buffer: pdf }, user });
          set({ status: 'Released', released_by: user.id, released_at: at, release_ref: ref });
          this.db.prepare("UPDATE instruments SET status = 'Released', closed_at = ?, next_action = NULL, next_action_due = NULL, updated_at = ? WHERE id = ?").run(at, at, x.id);
          if (x.bank_code) this.db.prepare("UPDATE bank_registry SET lien_in_favour = 'Lien released', status = 'active', updated_at = ? WHERE bank_code = ? AND instrument_no = ?").run(at, x.bank_code, normNo(x.instrument_no));
          this.engine.event(x.id, 'RELEASED', user, { from: x.status, to: 'Released', remarks: `${rr.req_no}: ${x.type === 'SD' ? 'refund processed' : 'lien release letter issued to the bank'} (${ref}).`, data: { release_id: rr.id } });
        });
        this.engine.notify(inst, x, 'RELEASE', `${rr.req_no}: ${x.type === 'SD' ? 'security deposit refunded' : 'lien released'}`, `Letter ${ref} has been issued for ${x.ref_no}. ${x.type === 'SD' ? 'The amount will be credited to your verified bank account.' : 'Please collect the deposit from your bank.'}`);
        break;
      }
      case 'return':
        need(STAFF_ACT.includes(user.role), 'Not permitted', 403);
        need(['Submitted', 'Recommended', 'Forwarded'].includes(rr.status), `Request is ${rr.status}`);
        need(remarks.length >= 10, 'Say what the institution must clarify');
        set({ status: 'Returned', closed_remarks: remarks });
        step('Returned', 'Returned to the institution for clarification');
        this.engine.notify(inst, x, 'RELEASE', `${rr.req_no}: clarification needed`, remarks);
        break;
      case 'resubmit':
        need(rr.status === 'Returned', `Request is ${rr.status}`);
        need(user.role === 'institution' || STAFF_ACT.includes(user.role), 'Not permitted', 403);
        set({ status: 'Submitted', details: [rr.details, remarks && `Clarification: ${remarks}`].filter(Boolean).join('\n'), recommended_by: null, recommended_at: null, forwarded_by: null, forwarded_at: null });
        step('Submitted', 'Resubmitted with clarification');
        break;
      case 'reject':
        need(['head', 'admin'].includes(user.role), 'Only the Director or Competent Authority can reject', 403);
        need(RELEASE_OPEN.includes(rr.status), `Request is ${rr.status}`);
        need(remarks.length >= 10, 'Give the reason for rejection');
        tx(this.db, () => {
          set({ status: 'Rejected', closed_remarks: remarks });
          this.db.prepare('UPDATE instruments SET status = ?, next_action = NULL, updated_at = ? WHERE id = ?').run(rr.prev_instrument_status || 'Active', at, x.id);
          step('Rejected', 'Release request rejected');
        });
        this.engine.notify(inst, x, 'RELEASE', `${rr.req_no}: release not approved`, remarks);
        break;
      default: throw new HttpError(400, 'Unknown action');
    }
    this.audit(user, `release.${action}`, 'release', rr.req_no, { remarks: remarks || undefined, code: body.code });
    this.engine.refreshAlerts();
    const out = this.release(rr.id);
    this.emit('release.updated', x, user, { status: out.status, req_no: out.req_no });
    return out;
  }
}

export { daysBetween };
