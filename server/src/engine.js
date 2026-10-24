// Monitoring engine: re-checks instruments, tracks validity, sends the reminder ladder, escalates
// overdue renewals, re-verifies held deposits with the bank and keeps the alert list current.
import { EventEmitter } from 'node:events';
import { DEFAULT_SETTINGS, PENDING_STATUSES, HELD_STATUSES, CLOSED_STATUSES, bankByCode, typeByCode, purposeByCode, RELEASE_OPEN } from './domain.js';
import { today as todayFn, nowIso, daysBetween, addDays, getSetting, inr } from './dbutil.js';
import { evaluateRules } from './rules.js';
import { bankLookup, normNo } from './bank.js';

export const bus = new EventEmitter();
bus.setMaxListeners(100);

const dmy = (iso) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '—');
const RELEASE_STAGE_ROLE = { Submitted: 'officer', Recommended: 'head', Forwarded: 'admin', Approved: 'accounts', Returned: 'institution' };

export class Engine {
  constructor(db) {
    this.db = db;
    this.q = {
      instr: db.prepare('SELECT * FROM instruments WHERE id = ?'),
      inst: db.prepare('SELECT * FROM institutions WHERE id = ?'),
      req: db.prepare('SELECT * FROM requirements WHERE purpose = ? AND inst_type = ?'),
      docs: db.prepare('SELECT id, kind, sha256 FROM documents WHERE instrument_id = ?'),
      dups: db.prepare(`SELECT x.id, x.ref_no, x.type, x.status, i.name AS institution_name FROM instruments x JOIN institutions i ON i.id = x.institution_id
        WHERE x.bank_code = ? AND x.instrument_no = ? AND x.id != ? AND x.status NOT IN ('Rejected','Released')`),
      dupFiles: db.prepare(`SELECT DISTINCT x.ref_no, i.name AS institution_name FROM documents d JOIN instruments x ON x.id = d.instrument_id JOIN institutions i ON i.id = x.institution_id
        WHERE d.sha256 = ? AND d.instrument_id != ? AND d.kind = 'INSTRUMENT'`),
      discOpen: db.prepare("SELECT * FROM discrepancies WHERE instrument_id = ? AND status != 'resolved'"),
      discUpsert: db.prepare(`INSERT INTO discrepancies (instrument_id, rule, field, severity, message, action, status, detected_at) VALUES (?,?,?,?,?,?,'open',?)
        ON CONFLICT(instrument_id, rule, field) DO UPDATE SET severity = excluded.severity, message = excluded.message, action = excluded.action,
          status = CASE WHEN discrepancies.status = 'waived' THEN 'waived' ELSE 'open' END,
          detected_at = CASE WHEN discrepancies.status = 'resolved' THEN excluded.detected_at ELSE discrepancies.detected_at END,
          resolved_at = CASE WHEN discrepancies.status = 'waived' THEN discrepancies.resolved_at ELSE NULL END`),
      discResolve: db.prepare("UPDATE discrepancies SET status = 'resolved', resolved_at = ? WHERE id = ?"),
      event: db.prepare('INSERT INTO instrument_events (instrument_id, at, actor_id, type, from_status, to_status, remarks, data) VALUES (?,?,?,?,?,?,?,?)'),
      outbox: db.prepare('INSERT INTO outbox (at, channel, to_addr, institution_id, instrument_id, kind, subject, body) VALUES (?,?,?,?,?,?,?,?)'),
    };
  }

  settings() { return { ...DEFAULT_SETTINGS, ...getSetting(this.db, 'monitoring', {}) }; }
  today() { return todayFn(); }

  requirementFor(instr, inst) {
    inst ??= this.q.inst.get(instr.institution_id);
    return this.q.req.get(instr.purpose, inst?.type ?? 'Engineering') ?? null;
  }

  event(instrumentId, type, actor, { from = null, to = null, remarks = null, data = null, at = nowIso() } = {}) {
    this.q.event.run(instrumentId, at, actor?.id ?? null, type, from, to, remarks, data ? JSON.stringify(data) : null);
  }

  notify(inst, instr, kind, subject, body, { at = nowIso(), channel = 'email' } = {}) {
    this.q.outbox.run(at, channel, channel === 'sms' ? inst.phone : inst.email, inst.id, instr?.id ?? null, kind, subject, body);
  }

  /** Runs the discrepancy rules for one instrument and syncs the discrepancies table. */
  evaluate(id) {
    const instr = this.q.instr.get(id);
    if (!instr) return [];
    const open = this.q.discOpen.all(id);
    if (CLOSED_STATUSES.includes(instr.status)) {
      for (const d of open) if (d.status === 'open') this.q.discResolve.run(nowIso(), d.id);
      return [];
    }
    const inst = this.q.inst.get(instr.institution_id);
    const documents = this.q.docs.all(id);
    const instrumentDoc = documents.find((d) => d.kind === 'INSTRUMENT');
    const chain = new Set([instr.predecessor_id, instr.successor_id].filter(Boolean));
    const findings = evaluateRules({
      instrument: instr, institution: inst, requirement: this.requirementFor(instr, inst), documents,
      duplicates: this.q.dups.all(instr.bank_code, normNo(instr.instrument_no), id).filter((d) => !chain.has(d.id)),
      duplicateFiles: instrumentDoc ? this.q.dupFiles.all(instrumentDoc.sha256, id) : [],
      today: this.today(),
    });
    const at = nowIso();
    const seen = new Set();
    for (const f of findings) {
      const key = `${f.rule}|${f.field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.q.discUpsert.run(id, f.rule, f.field, f.severity, f.message, f.action, at);
    }
    for (const d of open) if (d.status === 'open' && !seen.has(`${d.rule}|${d.field}`)) this.q.discResolve.run(at, d.id);
    return this.db.prepare("SELECT * FROM discrepancies WHERE instrument_id = ? AND status = 'open'").all(id);
  }

  /** Applies a bank lookup to an instrument (used by officers and the periodic re-check). */
  applyBankCheck(instr, actor, { periodic = false, at = null } = {}) {
    const res = bankLookup(this.db, instr);
    if (at) res.at = at;
    const before = instr.bank_status;
    let status;
    if (res.status === 'found') {
      const r = res.record;
      const same = normNo(r.instrument_no) === normNo(instr.instrument_no) && Number(r.amount) === Number(instr.amount)
        && (r.issue_date ?? '') === (instr.issue_date ?? '') && (!typeByCode[instr.type]?.hasMaturity || (r.maturity_date ?? '') === (instr.maturity_date ?? ''));
      status = same ? 'confirmed' : 'mismatch';
    } else status = res.status; // not_found | encashed | closed | unsupported | unknown_bank
    this.db.prepare('UPDATE instruments SET bank_json = ?, bank_status = ?, bank_checked_at = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(res), status, res.at, nowIso(), instr.id);
    if (!periodic || status !== before) {
      this.event(instr.id, periodic ? (['encashed', 'closed', 'not_found'].includes(status) ? 'BANK_ALERT' : 'REVERIFIED') : 'BANK_CHECK', actor, {
        remarks: bankCheckSummary(status, res), data: { status, ref: res.ref }, at: res.at,
      });
    }
    this.evaluate(instr.id);
    return { status, result: res, changed: status !== before };
  }

  /** Derived validity of an instrument on a date. */
  validity(instr, onDate = this.today(), successor) {
    if (PENDING_STATUSES.includes(instr.status)) return { state: 'pending' };
    if (instr.status === 'Rejected' || instr.status === 'Released' || instr.status === 'Renewed') return { state: 'closed' };
    const holdLeft = instr.hold_until ? daysBetween(onDate, instr.hold_until) : null;
    if (!typeByCode[instr.type]?.hasMaturity || !instr.maturity_date) {
      return { state: holdLeft !== null && holdLeft <= 0 ? 'complete' : 'valid', holdLeft };
    }
    const daysLeft = daysBetween(onDate, instr.maturity_date);
    const renewalNeeded = !!instr.hold_until && instr.maturity_date < instr.hold_until;
    successor ??= instr.successor_id ? this.q.instr.get(instr.successor_id) : null;
    const renewalPending = successor && PENDING_STATUSES.includes(successor.status);
    let state;
    if (renewalPending) state = 'renewal_submitted';
    else if (holdLeft !== null && holdLeft <= 0) state = 'complete';
    else if (daysLeft < 0) state = renewalNeeded ? 'lapsed' : 'complete';
    else if (daysLeft <= 90) state = renewalNeeded ? 'expiring' : 'maturing';
    else state = 'valid';
    return { state, daysLeft, renewalNeeded, holdLeft };
  }

  /**
   * Daily monitoring job. Safe to run any number of times a day: every reminder, notice and
   * escalation is recorded once per stage.
   */
  sweep({ emit = true } = {}) {
    const s = this.settings();
    const t = this.today();
    const db = this.db;
    const changes = { matured: 0, reminders: 0, overdue: 0, escalated: 0, bankAlerts: 0 };
    const held = db.prepare(`SELECT * FROM instruments WHERE status IN (${HELD_STATUSES.map(() => '?').join(',')})`).all(...HELD_STATUSES);
    const instCache = new Map();
    const instOf = (id) => instCache.get(id) ?? instCache.set(id, this.q.inst.get(id)).get(id);
    const ladder = [...s.reminder_ladder].sort((a, b) => b - a);

    for (const instr of held) {
      const inst = instOf(instr.institution_id);
      const v = this.validity(instr, t);
      // 1. maturity
      if (instr.status === 'Active' && v.daysLeft !== undefined && v.daysLeft < 0) {
        db.prepare("UPDATE instruments SET status = 'Matured', matured_on = ?, updated_at = ? WHERE id = ?").run(instr.maturity_date, nowIso(), instr.id);
        this.event(instr.id, 'MATURED', null, { from: 'Active', to: 'Matured', remarks: v.renewalNeeded ? 'Matured before the end of the holding period; renewal is now overdue.' : 'Matured after the holding period; eligible for release.' });
        if (!v.renewalNeeded) this.notify(inst, instr, 'MATURED', `${instr.ref_no}: instrument matured, eligible for release`, `${typeByCode[instr.type].short} No. ${instr.instrument_no} matured on ${dmy(instr.maturity_date)} and the holding period is complete. You may apply for release on the portal.`);
        instr.status = 'Matured';
        changes.matured++;
      }
      // 2. reminder ladder before maturity
      if (instr.status === 'Active' && (v.state === 'expiring')) {
        const stage = ladder.filter((d) => v.daysLeft <= d).pop();
        if (stage !== undefined && (instr.reminder_stage == null || stage < instr.reminder_stage)) {
          const subject = `${instr.ref_no}: ${typeByCode[instr.type].short} matures on ${dmy(instr.maturity_date)} - renewal required`;
          const body = `${typeByCode[instr.type].short} No. ${instr.instrument_no} (${bankByCode[instr.bank_code]?.name}) for ${inr(instr.amount)} held for "${purposeByCode[instr.purpose]?.name}" matures in ${v.daysLeft} day(s). The deposit must be maintained until ${dmy(instr.hold_until)}. Please submit the renewed or replacement instrument on the portal before maturity.`;
          this.notify(inst, instr, 'REMINDER', subject, body);
          if (stage <= 15) this.notify(inst, instr, 'REMINDER', subject, `AICTE: ${instr.ref_no} matures ${dmy(instr.maturity_date)}. Submit renewal on the SD/FDR portal.`, { channel: 'sms' });
          db.prepare('UPDATE instruments SET reminder_stage = ?, next_action = ?, next_action_due = ?, updated_at = ? WHERE id = ?')
            .run(stage, 'Institution to submit renewed instrument', instr.maturity_date, nowIso(), instr.id);
          this.event(instr.id, 'REMINDER_SENT', null, { remarks: `T-${stage} reminder sent to ${inst.email}${stage <= 15 ? ' and by SMS' : ''}.`, data: { stage } });
          changes.reminders++;
        }
      }
      // 3. overdue renewal: notices and escalation
      if (instr.status === 'Matured' && v.state === 'lapsed') {
        const overdue = -v.daysLeft;
        const level = s.escalation_days.filter((d) => overdue >= d).length;
        if (!instr.last_overdue_notice || daysBetween(instr.last_overdue_notice, t) >= s.overdue_repeat_days) {
          this.notify(inst, instr, 'OVERDUE', `${instr.ref_no}: renewal overdue by ${overdue} day(s)`, `${typeByCode[instr.type].short} No. ${instr.instrument_no} matured on ${dmy(instr.maturity_date)} but must be maintained until ${dmy(instr.hold_until)}. No renewed instrument has been received. Submit it immediately to avoid regulatory action.`);
          db.prepare('UPDATE instruments SET last_overdue_notice = ?, next_action = ?, next_action_due = ? WHERE id = ?').run(t, 'Renewal overdue: follow up with institution', t, instr.id);
          changes.overdue++;
        }
        if (level > instr.escalation_level) {
          const who = ['', 'Dealing Officer', 'Director, Regulation Bureau', 'Competent Authority'][level];
          db.prepare('UPDATE instruments SET escalation_level = ?, updated_at = ? WHERE id = ?').run(level, nowIso(), instr.id);
          this.event(instr.id, 'ESCALATED', null, { remarks: `Renewal overdue by ${overdue} days: escalated to ${who} (level ${level}).`, data: { level } });
          if (level === 3) this.notify(inst, instr, 'FINAL_NOTICE', `${instr.ref_no}: final notice - security deposit not maintained`, `The security deposit required for your approval has lapsed for ${overdue} days. The matter has been placed before the Competent Authority for action under the applicable regulations.`);
          changes.escalated++;
        }
      }
      // 4. periodic re-verification with the bank (catches premature encashment after acceptance)
      if (instr.type !== 'SD' && bankByCode[instr.bank_code]?.api && instr.verification !== 'unverified'
        && (!instr.bank_checked_at || daysBetween(instr.bank_checked_at.slice(0, 10), t) >= s.reverify_days)) {
        const r = this.applyBankCheck(instr, null, { periodic: true });
        if (r.changed && ['encashed', 'closed', 'not_found'].includes(r.status)) changes.bankAlerts++;
      }
    }
    this.refreshAlerts();
    if (emit && Object.values(changes).some(Boolean)) bus.emit('event', { type: 'sweep', ...changes });
    return changes;
  }

  /** Rebuilds the set of active alerts from current data (adds new ones, resolves stale ones). */
  refreshAlerts() {
    const db = this.db;
    const s = this.settings();
    const t = this.today();
    const want = new Map();
    const put = (key, a) => want.set(key, a);
    const aud = (...roles) => `,${roles.join(',')},`;

    const rows = db.prepare(`SELECT x.*, i.name AS inst_name, i.region_code FROM instruments x JOIN institutions i ON i.id = x.institution_id
      WHERE x.status NOT IN ('Renewed','Released','Rejected')`).all();
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const x of rows) {
      const base = { instrument_id: x.id, institution_id: x.institution_id, region_code: x.region_code };
      const label = `${x.ref_no} · ${x.inst_name}`;
      if (PENDING_STATUSES.includes(x.status) && x.status !== 'Query Raised') {
        const age = daysBetween(x.submitted_at.slice(0, 10), t);
        if (age > s.scrutiny_sla_days) {
          const late = age > s.scrutiny_sla_days * 2;
          put(`VERIFY:${x.id}:${late ? 2 : 1}`, { ...base, type: 'VERIFY_PENDING', severity: late ? 'serious' : 'warning', audience: late ? aud('officer', 'head') : aud('officer'), title: `Verification pending for ${age} days: ${label}`, message: `Scrutiny timeline is ${s.scrutiny_sla_days} days.` });
        }
      }
      if (!HELD_STATUSES.includes(x.status)) continue;
      const v = this.validity(x, t, x.successor_id ? byId.get(x.successor_id) ?? this.q.instr.get(x.successor_id) : null);
      if (v.state === 'expiring' && v.daysLeft <= 30) {
        put(`EXP:${x.id}:${v.daysLeft <= 7 ? 7 : 30}`, { ...base, type: 'EXPIRING', severity: v.daysLeft <= 7 ? 'serious' : 'warning', audience: aud('officer', 'institution'), title: `Matures in ${v.daysLeft} day(s), renewal not received: ${label}`, message: `Maturity ${dmy(x.maturity_date)}; must be held until ${dmy(x.hold_until)}.` });
      }
      if (v.state === 'lapsed') {
        const lvl = Math.max(1, x.escalation_level);
        const roles = ['officer', 'institution', ...(lvl >= 2 ? ['head'] : []), ...(lvl >= 3 ? ['admin'] : [])];
        put(`LAPSED:${x.id}:${lvl}`, { ...base, type: 'LAPSED', severity: lvl >= 2 ? 'critical' : 'serious', audience: aud(...roles), title: `Renewal overdue ${-v.daysLeft} days (escalation level ${lvl}): ${label}`, message: `Matured ${dmy(x.maturity_date)}; the deposit must be maintained until ${dmy(x.hold_until)}.` });
      }
      if (['encashed', 'closed', 'not_found'].includes(x.bank_status)) {
        put(`BANK:${x.id}:${x.bank_status}`, { ...base, type: 'BANK_ALERT', severity: 'critical', audience: aud('officer', 'head', 'admin'), title: `Bank reports deposit ${x.bank_status === 'not_found' ? 'not found' : x.bank_status}: ${label}`, message: 'Found during periodic re-verification with the bank.' });
      }
    }
    // critical discrepancies on submissions under scrutiny
    for (const d of db.prepare(`SELECT d.instrument_id, COUNT(*) n, x.ref_no, x.institution_id, i.name AS inst_name, i.region_code FROM discrepancies d
        JOIN instruments x ON x.id = d.instrument_id JOIN institutions i ON i.id = x.institution_id
        WHERE d.status = 'open' AND d.severity = 'critical' AND x.status IN ('Submitted','Under Scrutiny','Query Raised') GROUP BY d.instrument_id`).all()) {
      put(`DISC:${d.instrument_id}`, { instrument_id: d.instrument_id, institution_id: d.institution_id, region_code: d.region_code, type: 'DISCREPANCY', severity: 'critical', audience: aud('officer', 'head'), title: `${d.n} critical discrepanc${d.n === 1 ? 'y' : 'ies'}: ${d.ref_no} · ${d.inst_name}`, message: 'Do not accept until resolved.' });
    }
    // open queries
    for (const q of db.prepare(`SELECT q.*, x.ref_no, x.institution_id, i.name AS inst_name, i.region_code FROM queries q JOIN instruments x ON x.id = q.instrument_id
        JOIN institutions i ON i.id = x.institution_id WHERE q.status = 'open'`).all()) {
      const overdue = q.due_on < t;
      put(`QUERY:${q.id}:${overdue ? 'late' : 'open'}`, { instrument_id: q.instrument_id, institution_id: q.institution_id, region_code: q.region_code, type: 'QUERY', severity: overdue ? 'warning' : 'info',
        audience: overdue ? aud('officer', 'institution') : aud('institution'), title: overdue ? `Query unanswered past ${dmy(q.due_on)}: ${q.ref_no} · ${q.inst_name}` : `Reply needed by ${dmy(q.due_on)}: ${q.ref_no}`, message: q.text.slice(0, 160) });
    }
    // release requests waiting on someone
    for (const r of db.prepare(`SELECT r.*, x.ref_no, i.name AS inst_name, i.region_code FROM release_requests r JOIN instruments x ON x.id = r.instrument_id JOIN institutions i ON i.id = r.institution_id
        WHERE r.status IN (${RELEASE_OPEN.map(() => '?').join(',')})`).all(...RELEASE_OPEN)) {
      const age = daysBetween(r.requested_at.slice(0, 10), t);
      const late = age > s.release_sla_days;
      put(`REL:${r.id}:${r.status}:${late ? 1 : 0}`, { instrument_id: r.instrument_id, institution_id: r.institution_id, release_id: r.id, region_code: r.region_code, type: 'RELEASE', severity: late ? 'warning' : 'info',
        audience: aud(RELEASE_STAGE_ROLE[r.status]), title: `${r.status === 'Returned' ? 'Release request returned for clarification' : `Release request awaiting ${({ officer: 'scrutiny', head: 'Director', admin: 'approval', accounts: 'release' })[RELEASE_STAGE_ROLE[r.status]]}`}${late ? ` (${age} days)` : ''}: ${r.req_no} · ${r.inst_name}`, message: r.details || null });
    }

    const active = db.prepare('SELECT id, dedupe_key FROM alerts WHERE resolved_at IS NULL').all();
    const at = nowIso();
    const ins = db.prepare(`INSERT INTO alerts (dedupe_key, type, severity, audience, instrument_id, institution_id, release_id, region_code, title, message, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO UPDATE SET resolved_at = NULL, title = excluded.title, message = excluded.message`);
    let added = 0;
    const activeKeys = new Set(active.map((a) => a.dedupe_key));
    for (const [key, a] of want) {
      if (!activeKeys.has(key)) added++;
      ins.run(key, a.type, a.severity, a.audience, a.instrument_id ?? null, a.institution_id ?? null, a.release_id ?? null, a.region_code ?? null, a.title, a.message ?? null, at);
    }
    const res = db.prepare('UPDATE alerts SET resolved_at = ? WHERE id = ?');
    for (const a of active) if (!want.has(a.dedupe_key)) res.run(at, a.id);
    return added;
  }
}

export function bankCheckSummary(status, res) {
  return {
    confirmed: `${res.bank} confirmed all details (ref ${res.ref}).`,
    mismatch: `${res.bank} holds this deposit but some details differ (ref ${res.ref}).`,
    not_found: `${res.bank} has no record of this instrument (ref ${res.ref}).`,
    encashed: `${res.bank} reports the deposit was encashed before maturity (ref ${res.ref}).`,
    closed: `${res.bank} reports the deposit is closed (ref ${res.ref}).`,
    unsupported: `${res.bank} is not connected to the verification service; a bank confirmation letter is needed.`,
    unknown_bank: 'Unknown bank.',
  }[status] ?? status;
}

export { addDays };
