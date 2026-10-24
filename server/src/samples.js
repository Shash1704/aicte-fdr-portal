// Sample instruments for trying the submission flow in the demo. Each sample is a realistic PDF plus a
// matching entry in the bank sandbox, so the full journey (read → check with bank → rules) can be seen.
import { addMonths, nowIso } from './dbutil.js';
import { bankByCode } from './domain.js';
import { instrumentPdf, coverLetterPdf, resolutionPdf, bankConfirmationPdf } from './letters.js';
import { normNo } from './bank.js';

const BRANCH = { SBI: ['Parliament Street, New Delhi', 'SBIN0000691'], PNB: ['Connaught Place, New Delhi', 'PUNB0015300'], IB: ['Anna Salai, Chennai', 'IDIB000A031'], CNB: ['MG Road, Bengaluru', 'CNRB0000401'], HDFC: ['Kasturba Gandhi Marg, New Delhi', 'HDFC0000003'] };

export function sampleSpecs(inst, t) {
  const trust = inst.trust_name;
  const aicte = 'Member Secretary, AICTE, New Delhi';
  const issue = t;
  const base = (key, bank, extra) => {
    const [branch, ifsc] = BRANCH[bank];
    const no = `${String(1000 + (inst.id % 9000))}${['clean', 'tampered', 'nolien', 'letter', 'short'].indexOf(key) + 1}${t.slice(2, 4)}${t.slice(5, 7)}${t.slice(8, 10)}`;
    return { key, type: 'FDR', bank_code: bank, branch, ifsc, instrument_no: normNo(`${bank === 'SBI' ? '4' : bank === 'PNB' ? '06' : '7'}${no}`), issue_date: issue,
      maturity_date: addMonths(issue, 36), depositor_name: trust, lien_in_favour: aicte, interest_rate: 7.1, auto_renew: 1, account_no: `3${String(inst.id).padStart(5, '0')}${no.slice(-5)}`, ...extra };
  };
  const req = inst.required ?? 3500000;
  return [
    { ...base('clean', 'SBI', { amount: req }), title: 'Valid FDR, State Bank of India', expect: 'Passes every check; the bank confirms it instantly.' },
    { ...base('tampered', 'PNB', { amount: req, bank_amount: Math.round(req / 10) }), title: 'Altered FDR (amount changed on the scan)', expect: 'The bank\'s record shows a tenth of the amount: flagged as a critical mismatch.' },
    { ...base('nolien', 'HDFC', { amount: req, lien_in_favour: trust }), title: 'FDR not lien-marked to AICTE', expect: 'Flagged: the deposit is in the Trust\'s own name.' },
    { ...base('letter', 'IB', { amount: req }), title: 'FDR from a bank without online verification', expect: 'Needs a bank confirmation letter (provided) before acceptance.' },
    { ...base('short', 'CNB', { amount: Math.round(req * 0.6), maturity_date: addMonths(issue, 9) }), title: 'Short FDR (amount and tenure below norms)', expect: 'Flagged: below the required amount and minimum tenure.' },
  ].map((s) => ({ ...s, bank_name: bankByCode[s.bank_code].name }));
}

/** Returns the sample's PDF and makes sure the bank sandbox knows about the deposit. */
export function sampleFile(db, inst, spec, doc) {
  if (doc === 'instrument') {
    db.prepare(`INSERT INTO bank_registry (bank_code, instrument_no, branch, ifsc, amount, issue_date, maturity_date, depositor_name, lien_in_favour, status, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?, 'active', ?) ON CONFLICT(bank_code, instrument_no) DO NOTHING`).run(spec.bank_code, spec.instrument_no, spec.branch, spec.ifsc,
      spec.bank_amount ?? spec.amount, spec.issue_date, spec.maturity_date, spec.depositor_name, spec.lien_in_favour, nowIso());
    return instrumentPdf(spec);
  }
  if (doc === 'cover') return coverLetterPdf(inst, spec, 'approval');
  if (doc === 'resolution') return resolutionPdf(inst, spec);
  if (doc === 'bank') return bankConfirmationPdf(spec);
  return null;
}
