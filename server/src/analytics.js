// Register queries, dashboard figures, measurable-improvement KPIs and MIS reports.
import { today, addDays, daysBetween, getSetting } from './dbutil.js';
import { REGIONS, BANKS, PURPOSES, DEFAULT_SETTINGS, DOC_KINDS, REQUIRED_DOCS, bankByCode, RELEASE_REASONS } from './domain.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const lit = (d) => { if (!ISO.test(d)) throw new Error('bad date'); return `'${d}'`; };

/** SQL expression for an instrument's validity on date t (x = instrument, s = its successor). */
export function validitySql(t) {
  const T = lit(t);
  const T90 = lit(addDays(t, 90));
  return `CASE
    WHEN x.status IN ('Submitted','Under Scrutiny','Query Raised') THEN 'pending'
    WHEN x.status IN ('Renewed','Released','Rejected') THEN 'closed'
    WHEN x.maturity_date IS NULL THEN CASE WHEN x.hold_until <= ${T} THEN 'complete' ELSE 'valid' END
    WHEN s.status IN ('Submitted','Under Scrutiny','Query Raised') THEN 'renewal_submitted'
    WHEN x.hold_until <= ${T} THEN 'complete'
    WHEN x.maturity_date < ${T} THEN CASE WHEN x.hold_until > x.maturity_date THEN 'lapsed' ELSE 'complete' END
    WHEN x.maturity_date <= ${T90} THEN CASE WHEN x.hold_until > x.maturity_date THEN 'expiring' ELSE 'maturing' END
    ELSE 'valid' END`;
}

export function listSelect(t) {
  return `SELECT x.id, x.ref_no, x.institution_id, x.purpose, x.type, x.status, x.instrument_no, x.bank_code, x.branch, x.amount, x.issue_date, x.maturity_date,
      x.hold_until, x.required_amount, x.verification, x.bank_status, x.submitted_at, x.verified_at, x.activated_at, x.escalation_level, x.successor_id,
      x.predecessor_id, x.next_action, x.next_action_due, x.officer_id, x.reminder_stage, x.legacy,
      i.name AS institution_name, i.aicte_id, i.city, i.state, i.region_code, i.type AS institution_type, u.name AS officer_name,
      ${validitySql(t)} AS validity,
      CAST(julianday(x.maturity_date) - julianday(${lit(t)}) AS INTEGER) AS days_left,
      CAST(julianday(${lit(t)}) - julianday(substr(x.submitted_at, 1, 10)) AS INTEGER) AS age_days,
      (SELECT COUNT(*) FROM discrepancies d WHERE d.instrument_id = x.id AND d.status = 'open') AS open_issues,
      (SELECT MAX(CASE d.severity WHEN 'critical' THEN 4 WHEN 'serious' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END) FROM discrepancies d WHERE d.instrument_id = x.id AND d.status = 'open') AS worst_issue
    FROM instruments x JOIN institutions i ON i.id = x.institution_id LEFT JOIN users u ON u.id = x.officer_id LEFT JOIN instruments s ON s.id = x.successor_id`;
}

/** WHERE clause for the instrument register from query-string filters. */
export function instrumentFilter(q, user) {
  const t = today();
  const where = ['1=1'];
  const p = [];
  if (user.role === 'institution') { where.push('x.institution_id = ?'); p.push(user.institution_id); }
  const list = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);
  if (q.q) {
    const like = `%${String(q.q).trim()}%`;
    where.push('(x.ref_no LIKE ? OR x.instrument_no LIKE ? OR i.name LIKE ? OR i.aicte_id LIKE ? OR i.city LIKE ?)');
    p.push(like, `%${String(q.q).toUpperCase().replace(/[^A-Z0-9]/g, '')}%`, like, like, like);
  }
  if (q.institution_id) { where.push('x.institution_id = ?'); p.push(Number(q.institution_id)); }
  if (q.region) { where.push('i.region_code = ?'); p.push(q.region); }
  if (q.type) { where.push('x.type = ?'); p.push(q.type); }
  if (q.purpose) { where.push('x.purpose = ?'); p.push(q.purpose); }
  if (q.bank) { where.push('x.bank_code = ?'); p.push(q.bank); }
  if (q.status) { const s = list(q.status); where.push(`x.status IN (${s.map(() => '?').join(',')})`); p.push(...s); }
  if (q.validity) { const s = list(q.validity); where.push(`(${validitySql(t)}) IN (${s.map(() => '?').join(',')})`); p.push(...s); }
  if (q.verification === 'bank') where.push("x.verification IN ('bank_api','bank_letter')");
  else if (q.verification) { where.push('x.verification = ?'); p.push(q.verification); }
  if (q.bank_status) { const s = list(q.bank_status); where.push(`x.bank_status IN (${s.map(() => '?').join(',')})`); p.push(...s); }
  if (q.maturity_from) { where.push('x.maturity_date >= ?'); p.push(q.maturity_from); }
  if (q.maturity_to) { where.push('x.maturity_date <= ?'); p.push(q.maturity_to); }
  if (q.submitted_from) { where.push('substr(x.submitted_at,1,10) >= ?'); p.push(q.submitted_from); }
  if (q.submitted_to) { where.push('substr(x.submitted_at,1,10) <= ?'); p.push(q.submitted_to); }
  if (q.mine === '1') { where.push('x.officer_id = ?'); p.push(user.id); }
  if (q.issues === 'open') where.push("EXISTS (SELECT 1 FROM discrepancies d WHERE d.instrument_id = x.id AND d.status = 'open')");
  if (q.issues === 'blocking') where.push("EXISTS (SELECT 1 FROM discrepancies d WHERE d.instrument_id = x.id AND d.status = 'open' AND d.severity IN ('critical','serious'))");
  if (q.escalated === '1') where.push('x.escalation_level > 0');
  return { sql: where.join(' AND '), params: p, t };
}

export const SORTS = {
  submitted: 'x.submitted_at', maturity: 'x.maturity_date IS NULL, x.maturity_date', amount: 'x.amount', ref: 'x.id', institution: 'i.name',
  age: 'x.submitted_at', issues: 'worst_issue', status: 'x.status',
};

export function toCsv(cols, rows) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [cols.map((c) => esc(c.label)).join(','), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(','))].join('\n');
}

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

export function buildAnalytics(db) {
  const settings = () => ({ ...DEFAULT_SETTINGS, ...getSetting(db, 'monitoring', {}) });
  const scope = (user) => (user.role === 'institution' ? { sql: 'x.institution_id = ?', p: [user.institution_id] } : { sql: '1=1', p: [] });

  function dashboard(user) {
    const t = today();
    const sc = scope(user);
    const base = `FROM instruments x JOIN institutions i ON i.id = x.institution_id LEFT JOIN instruments s ON s.id = x.successor_id WHERE ${sc.sql}`;
    const V = validitySql(t);
    const cat = db.prepare(`SELECT
        SUM(x.status = 'Active' AND (${V}) IN ('valid','complete')) AS active,
        SUM(x.status = 'Active' AND (${V}) IN ('expiring','maturing','renewal_submitted')) AS expiring,
        SUM(x.status = 'Active' AND (${V}) = 'expiring') AS expiring_unrenewed,
        SUM(x.status = 'Matured') AS matured,
        SUM(x.status = 'Matured' AND (${V}) = 'lapsed') AS lapsed,
        SUM(x.status = 'Renewed') AS renewed,
        SUM(x.status = 'Released') AS released,
        SUM(x.status IN ('Submitted','Under Scrutiny','Query Raised')) AS pending,
        SUM(x.status = 'Query Raised') AS queries,
        SUM(x.status = 'Release Requested') AS release_requested,
        SUM(CASE WHEN x.status IN ('Active','Matured','Release Requested') THEN x.amount ELSE 0 END) AS held_amount,
        SUM(x.status IN ('Active','Matured','Release Requested')) AS held_count,
        SUM(CASE WHEN x.status = 'Matured' AND (${V}) = 'lapsed' THEN x.amount ELSE 0 END) AS lapsed_amount,
        SUM(CASE WHEN x.status = 'Active' AND (${V}) = 'expiring' THEN x.amount ELSE 0 END) AS expiring_amount
      ${base}`).get(...sc.p);
    const openIssues = db.prepare(`SELECT d.severity, COUNT(*) n FROM discrepancies d JOIN instruments x ON x.id = d.instrument_id WHERE d.status = 'open' AND ${sc.sql} GROUP BY d.severity`).all(...sc.p);

    // maturity profile, next 12 months
    const months = [];
    for (let k = 0; k < 12; k++) {
      const d = new Date(t + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + k);
      months.push(d.toISOString().slice(0, 7));
    }
    const mat = db.prepare(`SELECT substr(x.maturity_date,1,7) AS m, SUM(x.hold_until > x.maturity_date AND x.successor_id IS NULL) AS renewal_due,
        SUM(x.hold_until > x.maturity_date AND x.successor_id IS NOT NULL) AS renewal_in,
        SUM(x.hold_until <= x.maturity_date) AS release_eligible, SUM(x.amount) AS amount
      ${base} AND x.status = 'Active' AND x.maturity_date >= ? AND substr(x.maturity_date,1,7) <= ? GROUP BY m`).all(...sc.p, t, months[11]);
    const maturityProfile = months.map((m) => ({ month: m, renewal_due: 0, renewal_in: 0, release_eligible: 0, amount: 0, ...mat.find((r) => r.m === m) }));

    const byRegion = REGIONS.map((r) => ({ code: r.code, name: r.name, ...db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(x.amount),0) amount,
        SUM(x.status = 'Matured' AND x.hold_until > x.maturity_date) AS lapsed
      ${base} AND i.region_code = ? AND x.status IN ('Active','Matured','Release Requested')`).get(...sc.p, r.code) }));
    const byBank = db.prepare(`SELECT x.bank_code, COUNT(*) n, SUM(x.amount) amount ${base} AND x.status IN ('Active','Matured','Release Requested') GROUP BY x.bank_code ORDER BY amount DESC`).all(...sc.p)
      .map((b) => ({ ...b, name: b.bank_code ? bankByCode[b.bank_code]?.name ?? b.bank_code : 'AICTE account (online deposits)', api: b.bank_code ? !!bankByCode[b.bank_code]?.api : null }));
    const pendingAge = db.prepare(`SELECT
        SUM(julianday(?) - julianday(substr(x.submitted_at,1,10)) <= 3) a, SUM(julianday(?) - julianday(substr(x.submitted_at,1,10)) BETWEEN 4 AND 7) b,
        SUM(julianday(?) - julianday(substr(x.submitted_at,1,10)) BETWEEN 8 AND 15) c, SUM(julianday(?) - julianday(substr(x.submitted_at,1,10)) > 15) d
      ${base} AND x.status IN ('Submitted','Under Scrutiny','Query Raised')`).get(t, t, t, t, ...sc.p);

    const attention = db.prepare(`${listSelect(t)} WHERE ${sc.sql} AND (
        (x.status = 'Matured' AND x.hold_until > x.maturity_date AND (s.id IS NULL OR s.status = 'Rejected'))
        OR x.bank_status IN ('encashed','not_found') AND x.status IN ('Active','Matured','Release Requested')
        OR (x.status IN ('Submitted','Under Scrutiny') AND EXISTS (SELECT 1 FROM discrepancies d WHERE d.instrument_id = x.id AND d.status='open' AND d.severity='critical'))
        OR (x.status = 'Active' AND x.hold_until > x.maturity_date AND x.successor_id IS NULL AND x.maturity_date <= ?))
      ORDER BY CASE WHEN x.bank_status IN ('encashed','not_found') AND x.status IN ('Active','Matured') THEN 0 WHEN x.status = 'Matured' THEN 1 WHEN x.status = 'Active' THEN 3 ELSE 2 END,
        x.escalation_level DESC, x.maturity_date LIMIT 10`).all(...sc.p, addDays(t, 15));

    const recent = db.prepare(`SELECT e.id, e.at, e.type, e.remarks, x.id AS instrument_id, x.ref_no, i.name AS institution_name, u.name AS actor_name
      FROM instrument_events e JOIN instruments x ON x.id = e.instrument_id JOIN institutions i ON i.id = x.institution_id LEFT JOIN users u ON u.id = e.actor_id
      WHERE ${sc.sql} AND e.type NOT IN ('EXTRACTED','SCRUTINY') ORDER BY e.at DESC, e.id DESC LIMIT 12`).all(...sc.p);

    return { today: t, categories: cat, openIssues, maturityProfile, byRegion, byBank, pendingAge, attention, recent, kpis: kpis(user) };
  }

  /** Measurable improvements the problem statement asks for, computed from the data. */
  function kpis(user) {
    const t = today();
    const sc = scope(user);
    const s = settings();
    const verified = db.prepare(`SELECT x.legacy, substr(x.submitted_at,1,10) AS sub, substr(x.verified_at,1,10) AS ver FROM instruments x
      WHERE ${sc.sql} AND x.verified_at IS NOT NULL AND x.verified_at >= ?`).all(...sc.p, addDays(t, -730));
    const turn = (rows) => rows.map((r) => daysBetween(r.sub, r.ver));
    const portal = turn(verified.filter((r) => !r.legacy && r.ver >= addDays(t, -365)));
    const legacy = turn(verified.filter((r) => r.legacy));
    const renewals = db.prepare(`SELECT x.legacy, substr(x.submitted_at,1,10) AS sub, p.maturity_date FROM instruments x JOIN instruments p ON p.id = x.predecessor_id
      WHERE ${sc.sql} AND x.status NOT IN ('Rejected') AND p.maturity_date >= ? AND p.maturity_date <= ?`).all(...sc.p, addDays(t, -730), t);
    const onTime = (rows) => pct(rows.filter((r) => r.sub <= r.maturity_date).length, rows.length);
    const held = db.prepare(`SELECT COUNT(*) n, SUM(x.verification IN ('bank_api','bank_letter')) bank, SUM(x.verification = 'bank_api') api FROM instruments x
      WHERE ${sc.sql} AND x.status IN ('Active','Matured','Release Requested')`).get(...sc.p);
    const caught = db.prepare(`SELECT d.rule, COUNT(DISTINCT d.instrument_id) n, SUM(x.amount) amount FROM discrepancies d JOIN instruments x ON x.id = d.instrument_id
      WHERE ${sc.sql} AND d.severity IN ('critical','serious') AND d.detected_at >= ? GROUP BY d.rule ORDER BY n DESC`).all(...sc.p, addDays(t, -365));
    const atRisk = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(x.amount),0) amount FROM instruments x WHERE ${sc.sql}
      AND EXISTS (SELECT 1 FROM discrepancies d WHERE d.instrument_id = x.id AND d.severity = 'critical' AND d.detected_at >= ?)`).get(...sc.p, addDays(t, -365));
    const notices = db.prepare(`SELECT COUNT(*) n, SUM(o.at >= ?) last30, SUM(o.kind IN ('REMINDER','OVERDUE','FINAL_NOTICE')) reminders FROM outbox o JOIN instruments x ON x.id = o.instrument_id
      WHERE ${sc.sql} AND o.at >= ?`).get(addDays(t, -30), ...sc.p, addDays(t, -365));
    const withinSla = portal.filter((d) => d <= s.scrutiny_sla_days).length;
    return {
      turnaround: { portal: median(portal), legacy: median(legacy), portalCount: portal.length, legacyCount: legacy.length, withinSlaPct: pct(withinSla, portal.length), slaDays: s.scrutiny_sla_days },
      renewals: { portalOnTimePct: onTime(renewals.filter((r) => !r.legacy)), legacyOnTimePct: onTime(renewals.filter((r) => r.legacy)), count: renewals.length },
      bankConfirmed: { pct: pct(held.bank ?? 0, held.n), apiPct: pct(held.api ?? 0, held.n), held: held.n },
      discrepancies: { byRule: caught, atRiskCount: atRisk.n, atRiskAmount: atRisk.amount },
      automation: { notices: notices.n ?? 0, last30: notices.last30 ?? 0, reminders: notices.reminders ?? 0, hoursSaved: Math.round(((notices.n ?? 0) * s.minutes_per_manual_letter) / 60) },
    };
  }

  // ---------------- reports ----------------
  const fmtSev = "CASE d.severity WHEN 'critical' THEN 'Critical' WHEN 'serious' THEN 'Serious' WHEN 'warning' THEN 'Warning' ELSE 'Info' END";
  const REPORTS = {
    'pending-verification': {
      title: 'Pending verifications', description: 'Submissions awaiting scrutiny or a reply to a query, oldest first.',
      run: (u, q, t) => db.prepare(`${listSelect(t)} WHERE ${scope(u).sql} AND x.status IN ('Submitted','Under Scrutiny','Query Raised') ORDER BY x.submitted_at`).all(...scope(u).p),
      cols: [['ref_no', 'Reference'], ['institution_name', 'Institution'], ['aicte_id', 'AICTE ID'], ['region_code', 'Region'], ['type', 'Type'], ['instrument_no', 'Instrument no.'], ['amount', 'Amount (Rs)'], ['status', 'Status'], ['age_days', 'Days pending'], ['bank_status', 'Bank check'], ['open_issues', 'Open discrepancies'], ['officer_name', 'Dealing officer']],
    },
    'upcoming-maturities': {
      title: 'Upcoming maturities', description: 'Held instruments maturing in the selected window, with renewal status.', param: { key: 'days', label: 'Window (days)', options: [30, 60, 90, 180, 365], default: 90 },
      run: (u, q, t) => db.prepare(`${listSelect(t)} WHERE ${scope(u).sql} AND x.status = 'Active' AND x.maturity_date BETWEEN ? AND ? ORDER BY x.maturity_date`).all(...scope(u).p, t, addDays(t, Number(q.days) || 90))
        .map((r) => ({ ...r, renewal: r.hold_until > r.maturity_date ? (r.successor_id ? 'Renewal submitted' : 'Renewal required') : 'Not required (holding period ends)' })),
      cols: [['maturity_date', 'Maturity'], ['days_left', 'Days left'], ['ref_no', 'Reference'], ['institution_name', 'Institution'], ['region_code', 'Region'], ['type', 'Type'], ['bank_code', 'Bank'], ['instrument_no', 'Instrument no.'], ['amount', 'Amount (Rs)'], ['hold_until', 'Hold until'], ['renewal', 'Renewal'], ['reminder_stage', 'Last reminder (T-days)']],
    },
    'missing-documents': {
      title: 'Missing documents', description: 'Pending and held instruments that lack a prescribed document.',
      run: (u, q, t) => db.prepare(`SELECT x.id, x.ref_no, x.status, x.type, i.name AS institution_name, i.aicte_id, i.region_code, d.message, d.detected_at
          FROM discrepancies d JOIN instruments x ON x.id = d.instrument_id JOIN institutions i ON i.id = x.institution_id
          WHERE ${scope(u).sql} AND d.rule = 'MISSING_DOC' AND d.status = 'open' ORDER BY d.detected_at`).all(...scope(u).p),
      cols: [['ref_no', 'Reference'], ['institution_name', 'Institution'], ['aicte_id', 'AICTE ID'], ['region_code', 'Region'], ['type', 'Type'], ['status', 'Status'], ['message', 'Missing'], ['detected_at', 'Flagged on']],
    },
    intervention: {
      title: 'Cases requiring intervention', description: 'Lapsed deposits, bank alerts, critical discrepancies and overdue queries.',
      run: (u, q, t) => {
        const sc = scope(u);
        return db.prepare(`${listSelect(t)} WHERE ${sc.sql} AND (
            (x.status = 'Matured' AND x.hold_until > x.maturity_date AND (s.id IS NULL OR s.status = 'Rejected'))
            OR (x.bank_status IN ('encashed','not_found') AND x.status IN ('Active','Matured','Release Requested'))
            OR (x.status IN ('Submitted','Under Scrutiny','Query Raised') AND EXISTS (SELECT 1 FROM discrepancies d WHERE d.instrument_id = x.id AND d.status='open' AND d.severity='critical'))
            OR EXISTS (SELECT 1 FROM queries qq WHERE qq.instrument_id = x.id AND qq.status = 'open' AND qq.due_on < ?))
          ORDER BY x.escalation_level DESC, x.maturity_date`).all(...sc.p, t).map((r) => ({
          ...r, reason: ['encashed', 'not_found'].includes(r.bank_status) && r.status !== 'Submitted' && r.status !== 'Under Scrutiny' ? `Bank: ${r.bank_status === 'encashed' ? 'deposit encashed' : 'no record'}` : r.validity === 'lapsed' ? `Renewal overdue ${-r.days_left} days (level ${r.escalation_level})` : r.status === 'Query Raised' ? 'Query unanswered past due date' : 'Critical discrepancy',
        }));
      },
      cols: [['ref_no', 'Reference'], ['institution_name', 'Institution'], ['aicte_id', 'AICTE ID'], ['region_code', 'Region'], ['reason', 'Why'], ['amount', 'Amount (Rs)'], ['maturity_date', 'Maturity'], ['status', 'Status'], ['officer_name', 'Dealing officer']],
    },
    'release-register': {
      title: 'Release / refund register', description: 'All release and refund requests with their stage and turnaround.',
      run: (u) => db.prepare(`SELECT r.req_no, r.status, r.reason, substr(r.requested_at,1,10) AS requested_on, substr(r.released_at,1,10) AS released_on, r.release_ref,
          x.ref_no, x.type, x.instrument_no, x.amount, i.name AS institution_name, i.aicte_id,
          CAST(julianday(COALESCE(r.released_at, ?)) - julianday(r.requested_at) AS INTEGER) AS days
        FROM release_requests r JOIN instruments x ON x.id = r.instrument_id JOIN institutions i ON i.id = r.institution_id WHERE ${scope(u).sql} ORDER BY r.requested_at DESC`).all(today(), ...scope(u).p)
        .map((r) => ({ ...r, reason: RELEASE_REASONS.find((x) => x.code === r.reason)?.name ?? r.reason })),
      cols: [['req_no', 'Request'], ['requested_on', 'Requested'], ['institution_name', 'Institution'], ['aicte_id', 'AICTE ID'], ['ref_no', 'Instrument'], ['type', 'Type'], ['amount', 'Amount (Rs)'], ['reason', 'Reason'], ['status', 'Stage'], ['days', 'Days'], ['released_on', 'Released'], ['release_ref', 'Letter no.']],
    },
    'institution-holdings': {
      title: 'Institution-wise holdings', description: 'Deposits held against the requirement for each institution, with any shortfall.',
      run: (u) => db.prepare(`SELECT i.id, i.name AS institution_name, i.aicte_id, i.region_code, i.type AS institution_type,
          COUNT(x.id) AS instruments, COALESCE(SUM(x.amount),0) AS held,
          (SELECT COALESCE(SUM(r.min_amount),0) FROM (SELECT DISTINCT y.purpose FROM instruments y WHERE y.institution_id = i.id AND y.status IN ('Active','Matured','Release Requested')) p
            JOIN requirements r ON r.purpose = p.purpose AND r.inst_type = i.type) AS required,
          SUM(x.status = 'Matured' AND x.hold_until > x.maturity_date) AS lapsed, MIN(CASE WHEN x.status = 'Active' THEN x.maturity_date END) AS next_maturity
        FROM institutions i JOIN instruments x ON x.institution_id = i.id AND x.status IN ('Active','Matured','Release Requested')
        WHERE ${u.role === 'institution' ? 'i.id = ?' : '1=1'} GROUP BY i.id ORDER BY (held - required), i.name`).all(...(u.role === 'institution' ? [u.institution_id] : []))
        .map((r) => ({ ...r, shortfall: Math.max(0, r.required - r.held) })),
      cols: [['institution_name', 'Institution'], ['aicte_id', 'AICTE ID'], ['region_code', 'Region'], ['institution_type', 'Type'], ['instruments', 'Instruments'], ['held', 'Held (Rs)'], ['required', 'Required (Rs)'], ['shortfall', 'Shortfall (Rs)'], ['lapsed', 'Lapsed'], ['next_maturity', 'Next maturity']],
    },
    'bank-exposure': {
      title: 'Bank-wise exposure', description: 'Where the deposits are held, and how many can be checked online.',
      run: (u, q, t) => BANKS.map((b) => ({ bank: b.name, online: b.api ? 'Yes' : 'Letter', ...db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(x.amount),0) amount, SUM(x.verification IN ('bank_api','bank_letter')) confirmed,
          SUM(x.bank_status IN ('encashed','not_found','mismatch')) alerts FROM instruments x WHERE ${scope(u).sql} AND x.bank_code = ? AND x.status IN ('Active','Matured','Release Requested')`).get(...scope(u).p, b.code) })).filter((r) => r.n),
      cols: [['bank', 'Bank'], ['online', 'Online verification'], ['n', 'Instruments'], ['amount', 'Amount (Rs)'], ['confirmed', 'Bank-confirmed'], ['alerts', 'Bank alerts']],
    },
    'region-summary': {
      title: 'Region-wise summary', description: 'Holdings, pending verifications and lapsed deposits by AICTE region.',
      run: (u, q, t) => REGIONS.map((r) => ({ region: `${r.name} (${r.office})`, ...db.prepare(`SELECT SUM(x.status IN ('Active','Matured','Release Requested')) held,
          COALESCE(SUM(CASE WHEN x.status IN ('Active','Matured','Release Requested') THEN x.amount END),0) amount,
          SUM(x.status IN ('Submitted','Under Scrutiny','Query Raised')) pending, SUM(x.status = 'Matured' AND x.hold_until > x.maturity_date) lapsed,
          SUM(x.status = 'Active' AND x.maturity_date BETWEEN ? AND ?) expiring90, SUM(x.status = 'Released') released
          FROM instruments x JOIN institutions i ON i.id = x.institution_id WHERE ${scope(u).sql} AND i.region_code = ?`).get(t, addDays(t, 90), ...scope(u).p, r.code) })),
      cols: [['region', 'Region'], ['held', 'Held'], ['amount', 'Amount (Rs)'], ['pending', 'Pending verification'], ['expiring90', 'Maturing in 90 days'], ['lapsed', 'Lapsed'], ['released', 'Released']],
    },
    'discrepancy-register': {
      title: 'Discrepancy register', description: 'Every discrepancy found by the rule engine in the last year, and how it was closed.',
      run: (u, q, t) => db.prepare(`SELECT x.ref_no, i.name AS institution_name, d.rule, ${fmtSev} AS severity, d.message, d.status, substr(d.detected_at,1,10) AS detected, substr(d.resolved_at,1,10) AS resolved, d.note
          FROM discrepancies d JOIN instruments x ON x.id = d.instrument_id JOIN institutions i ON i.id = x.institution_id WHERE ${scope(u).sql} AND d.detected_at >= ? ORDER BY d.detected_at DESC`).all(...scope(u).p, addDays(t, -365)),
      cols: [['detected', 'Detected'], ['ref_no', 'Reference'], ['institution_name', 'Institution'], ['rule', 'Rule'], ['severity', 'Severity'], ['message', 'Finding'], ['status', 'Status'], ['resolved', 'Closed on'], ['note', 'Note']],
    },
    notifications: {
      title: 'Notifications sent', description: 'E-mail and SMS the portal sent automatically (reminders, queries, acknowledgements).',
      run: (u, q, t) => db.prepare(`SELECT o.at, o.channel, o.to_addr, o.kind, o.subject, i.name AS institution_name FROM outbox o JOIN institutions i ON i.id = o.institution_id
          LEFT JOIN instruments x ON x.id = o.instrument_id WHERE ${u.role === 'institution' ? 'o.institution_id = ?' : '1=1'} AND o.at >= ? ORDER BY o.at DESC LIMIT 2000`).all(...(u.role === 'institution' ? [u.institution_id] : []), addDays(t, -90)),
      cols: [['at', 'Sent at'], ['channel', 'Channel'], ['kind', 'Type'], ['institution_name', 'Institution'], ['to_addr', 'To'], ['subject', 'Subject']],
    },
  };

  function report(name, user, q = {}) {
    const r = REPORTS[name];
    if (!r) return null;
    const rows = r.run(user, q, today());
    return { name, title: r.title, description: r.description, param: r.param ?? null, columns: r.cols.map(([key, label]) => ({ key, label })), rows };
  }
  const reportList = () => Object.entries(REPORTS).map(([name, r]) => ({ name, title: r.title, description: r.description }));

  return { dashboard, kpis, report, reportList };
}

export { PURPOSES, DOC_KINDS, REQUIRED_DOCS };
