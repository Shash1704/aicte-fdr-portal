// Discrepancy detection. Every instrument is checked against three sources: what the institution
// declared, what its uploaded document says, and what the bank confirms, plus the AICTE requirement
// rules and the rest of the register (duplicates). Each finding has a severity and a suggested action.
import { REQUIRED_DOCS, bankByCode, bankByIfsc, typeByCode, DOC_KINDS } from './domain.js';
import { monthsBetween } from './dbutil.js';
import { normNo } from './bank.js';

export const FIELDS = [
  { key: 'instrument_no', label: 'Instrument number', critical: true },
  { key: 'amount', label: 'Amount', critical: true },
  { key: 'issue_date', label: 'Date of issue / deposit' },
  { key: 'maturity_date', label: 'Maturity / validity date', critical: true },
  { key: 'ifsc', label: 'IFSC' },
  { key: 'depositor_name', label: 'Depositor / applicant' },
  { key: 'lien_in_favour', label: 'Lien / beneficiary' },
];

const normText = (s) => String(s || '').toLowerCase().replace(/\b(the|of|and|reg|regd|registered|m\/s)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
/** Token overlap between two names (0..1), tolerant to punctuation and word order. */
export function nameSimilarity(a, b) {
  const A = new Set(normText(a).split(' ').filter(Boolean));
  const B = new Set(normText(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const t of A) if (B.has(t)) common++;
  return common / Math.min(A.size, B.size);
}

/** Do two values of a field agree? undefined when either side is missing. */
export function sameValue(key, a, b) {
  if (a == null || a === '' || b == null || b === '') return undefined;
  if (key === 'amount') return Math.round(Number(a)) === Math.round(Number(b));
  if (key === 'instrument_no') return normNo(a) === normNo(b);
  if (key === 'ifsc') return String(a).toUpperCase() === String(b).toUpperCase();
  if (key === 'depositor_name' || key === 'lien_in_favour') return nameSimilarity(a, b) >= 0.8;
  return String(a).slice(0, 10) === String(b).slice(0, 10);
}

const parse = (j) => { try { return j ? JSON.parse(j) : null; } catch { return null; } };

/** Field-by-field comparison of the three sources (shown on the instrument page). */
export function provenance(instr) {
  const doc = parse(instr.doc_json)?.fields ?? {};
  const bank = parse(instr.bank_json)?.record ?? null;
  return FIELDS.filter((f) => f.key !== 'maturity_date' || typeByCode[instr.type]?.hasMaturity).map((f) => ({
    field: f.key, label: f.label,
    declared: instr[f.key] ?? null,
    document: doc[f.key] ?? null,
    bank: bank ? bank[f.key] ?? null : null,
    documentMatch: sameValue(f.key, instr[f.key], doc[f.key]),
    bankMatch: bank ? sameValue(f.key, instr[f.key], bank[f.key]) : undefined,
  }));
}

export const isAicte = (s) => /\baicte\b|all india council for technical education/i.test(String(s || ''));

/**
 * ctx: { instrument, institution, requirement, documents, duplicates, duplicateFiles, today }
 * → [{ rule, field, severity, message, action }]
 */
export function evaluateRules(ctx) {
  const { instrument: i, institution: inst, requirement: req, documents = [], duplicates = [], duplicateFiles = [], today } = ctx;
  const out = [];
  const add = (rule, severity, message, action, field = '') => out.push({ rule, field, severity, message, action });
  const type = typeByCode[i.type];
  const hasMaturity = type?.hasMaturity;
  const doc = parse(i.doc_json);
  const bank = parse(i.bank_json);

  // --- document vs declared
  if (doc?.fields && Object.keys(doc.fields).length) {
    for (const f of FIELDS) {
      if (f.key === 'maturity_date' && !hasMaturity) continue;
      if (sameValue(f.key, i[f.key], doc.fields[f.key]) === false) {
        add('DOC_MISMATCH', f.critical ? 'serious' : 'warning', `${f.label} in the form (${fmt(f.key, i[f.key])}) differs from the uploaded document (${fmt(f.key, doc.fields[f.key])}).`,
          'Ask the institution to correct the form or upload the right document.', f.key);
      }
    }
  } else if (!i.legacy && documents.some((d) => d.kind === 'INSTRUMENT')) {
    add('DOC_UNREADABLE', 'info', 'The uploaded instrument could not be read automatically.', 'Compare the scan with the declared details manually.');
  }

  // --- bank vs declared
  if (bank) {
    if (bank.status === 'not_found') add('BANK_NOT_FOUND', 'critical', `${bank.bank ?? 'The bank'} has no record of instrument ${i.instrument_no}.`, 'Do not accept. Ask the institution and the bank branch to confirm in writing; possible forged instrument.');
    if (bank.status === 'encashed' || bank.status === 'closed') add('BANK_ENCASHED', 'critical', `${bank.bank ?? 'The bank'} reports this deposit as ${bank.status === 'encashed' ? 'prematurely encashed' : 'closed'}${bank.record?.updated_at ? '' : ''}.`, 'Issue a show-cause notice and demand a fresh instrument immediately.');
    if (bank.record) {
      for (const f of FIELDS) {
        if (f.key === 'maturity_date' && !hasMaturity) continue;
        if (sameValue(f.key, i[f.key], bank.record[f.key]) === false) {
          add('BANK_MISMATCH', f.critical ? 'critical' : 'serious', `${f.label} declared (${fmt(f.key, i[f.key])}) does not match the bank's record (${fmt(f.key, bank.record[f.key])}).`,
            'Raise a query; accept only after the bank confirms the corrected details.', f.key);
        }
      }
      if (bank.record.lien_in_favour && !isAicte(bank.record.lien_in_favour)) add('BANK_NO_LIEN', 'critical', 'The bank shows no lien in favour of AICTE on this deposit.', 'Ask the bank to mark the lien in favour of AICTE before acceptance.');
    }
  }

  // --- AICTE requirements
  if (req) {
    if (!req.accepted_types.split(',').includes(i.type)) add('TYPE_NOT_ACCEPTED', 'serious', `${type?.name ?? i.type} is not an accepted instrument for this purpose (accepted: ${req.accepted_types.split(',').join(', ')}).`, 'Return the submission and ask for an accepted instrument.');
    const required = i.required_amount ?? req.min_amount;
    if (Number(i.amount) < required) add('AMOUNT_SHORT', 'serious', `Amount ${fmt('amount', i.amount)} is below the required ${fmt('amount', required)} (short by ${fmt('amount', required - i.amount)}).`, 'Ask for an additional instrument for the shortfall.', 'amount');
    if (hasMaturity && i.maturity_date && i.issue_date && monthsBetween(i.issue_date, i.maturity_date) < req.min_tenure_months) {
      add('TENURE_SHORT', 'serious', `Tenure of ${monthsBetween(i.issue_date, i.maturity_date)} months is shorter than the minimum ${req.min_tenure_months} months.`, 'Ask for an instrument with the minimum tenure.', 'maturity_date');
    }
  }
  if (!isAicte(i.lien_in_favour)) add('LIEN_NOT_AICTE', 'serious', `The instrument is in favour of "${i.lien_in_favour || '—'}", not AICTE.`, 'The lien / beneficiary must be the Member Secretary, AICTE (jointly with the Trust where prescribed).', 'lien_in_favour');
  if (inst && i.depositor_name && Math.max(nameSimilarity(i.depositor_name, inst.trust_name), nameSimilarity(i.depositor_name, inst.name)) < 0.5) {
    add('DEPOSITOR_MISMATCH', 'warning', `Depositor "${i.depositor_name}" does not match the institution or its Trust/Society (${inst.trust_name}).`, 'Confirm the deposit was made by the sponsoring body.', 'depositor_name');
  }

  // --- internal consistency
  if (hasMaturity && i.maturity_date && i.issue_date && i.maturity_date <= i.issue_date) add('DATES_INVALID', 'serious', 'The maturity date is on or before the date of issue.', 'Correct the dates.', 'maturity_date');
  if (i.issue_date && today && i.issue_date > today) add('DATES_INVALID', 'serious', 'The date of issue is in the future.', 'Correct the date of issue.', 'issue_date');
  if (i.type !== 'SD' && i.ifsc) {
    const b = bankByIfsc(i.ifsc);
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(i.ifsc)) add('IFSC_INVALID', 'warning', `IFSC ${i.ifsc} is not in the standard 11-character format.`, 'Correct the IFSC.', 'ifsc');
    else if (b && b.code !== i.bank_code) add('IFSC_INVALID', 'warning', `IFSC ${i.ifsc} belongs to ${b.name}, but the bank selected is ${bankByCode[i.bank_code]?.name ?? i.bank_code}.`, 'Correct the bank or the IFSC.', 'ifsc');
  }

  // --- register-wide checks
  for (const d of duplicates) add('DUPLICATE_INSTRUMENT', 'critical', `The same ${d.type} number at the same bank is already on record as ${d.ref_no} (${d.institution_name}, ${d.status}).`, 'Possible reuse of one instrument for two approvals. Investigate before accepting.', `dup:${d.id}`);
  for (const d of duplicateFiles) add('DUPLICATE_FILE', 'critical', `An identical file was already submitted with ${d.ref_no} (${d.institution_name}).`, 'Check whether the same document was reused.', `file:${d.ref_no}`);

  // --- documents
  const have = new Set(documents.map((d) => d.kind));
  for (const kind of REQUIRED_DOCS[i.type] ?? []) {
    if (!have.has(kind)) add('MISSING_DOC', 'warning', `Missing: ${DOC_KINDS.find((k) => k.code === kind)?.name}.`, 'Ask the institution to upload it.', kind);
  }
  if (i.type !== 'SD' && i.verification === 'unverified' && !bankByCode[i.bank_code]?.api && !have.has('BANK_CONFIRMATION')) {
    add('MISSING_DOC', 'warning', `${bankByCode[i.bank_code]?.name ?? 'This bank'} cannot be checked online, so a bank confirmation / lien-marking letter is required.`, 'Ask for the bank confirmation letter.', 'BANK_CONFIRMATION');
  }
  return out;
}

function fmt(key, v) {
  if (v == null || v === '') return '—';
  if (key === 'amount') return `Rs ${Number(v).toLocaleString('en-IN')}`;
  if (/date/.test(key)) { const s = String(v); return `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`; }
  return String(v);
}
