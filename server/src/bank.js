// Bank verification sandbox (SIMULATED). It stands in for a bank's deposit-verification service: given
// a bank and instrument number it answers from the bank's own books (the bank_registry table), never
// from what the institution typed. Production would call each bank's authorised service instead.
import { bankByCode } from './domain.js';
import { nowIso } from './dbutil.js';
import { sha256 } from './sha256.js';

export const normNo = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * → { status: 'found' | 'not_found' | 'encashed' | 'closed' | 'unsupported' | 'unknown_bank', record?, ref, at, bank }
 */
export function bankLookup(db, { bank_code, instrument_no }) {
  const bank = bankByCode[bank_code];
  const at = nowIso();
  const ref = `BVS-${sha256(`${bank_code}|${instrument_no}|${at}`).slice(0, 10).toUpperCase()}`;
  if (!bank) return { status: 'unknown_bank', at, ref };
  if (!bank.api) return { status: 'unsupported', bank: bank.name, at, ref };
  const rec = db.prepare('SELECT * FROM bank_registry WHERE bank_code = ? AND instrument_no = ?').get(bank_code, normNo(instrument_no));
  if (!rec) return { status: 'not_found', bank: bank.name, at, ref };
  const record = {
    instrument_no: rec.instrument_no, amount: rec.amount, issue_date: rec.issue_date, maturity_date: rec.maturity_date,
    ifsc: rec.ifsc, branch: rec.branch, depositor_name: rec.depositor_name, lien_in_favour: rec.lien_in_favour, status: rec.status,
  };
  return { status: rec.status === 'active' ? 'found' : rec.status, bank: bank.name, record, at, ref };
}
