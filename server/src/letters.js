// Generates the PDFs the portal needs: synthetic instrument "scans" (seed data and demo samples) and
// system letters (acknowledgement, bank confirmation, release/discharge letter).
import { makePdf } from './pdf.js';
import { bankByCode } from './domain.js';

const dmy = (iso) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '');
const money = (n) => `Rs ${Number(n).toLocaleString('en-IN')}.00`;
const months = (a, b) => Math.round((new Date(b) - new Date(a)) / (86400000 * 30.44));

/** What the bank's document says. `f` holds the values printed on it (may differ from what was declared). */
export function instrumentPdf(f) {
  const bank = bankByCode[f.bank_code] ?? { name: 'Bank' };
  const head = [{ text: bank.name.toUpperCase(), size: 17, bold: true }, `Branch: ${f.branch}   IFSC: ${f.ifsc}`, { rule: true, gap: 10 }];
  if (f.type === 'BG') {
    return makePdf([...head,
      { text: 'BANK GUARANTEE', size: 14, bold: true, gap: 26 },
      `Guarantee No: ${f.instrument_no}`,
      `Date of Issue: ${dmy(f.issue_date)}`,
      `Beneficiary: ${f.lien_in_favour}`,
      `Applicant: ${f.depositor_name}`,
      `Guarantee Amount: ${money(f.amount)}`,
      `Valid up to: ${dmy(f.maturity_date)}   Claim period: 12 months thereafter`,
      { text: '', gap: 14 },
      'We, the above bank, irrevocably undertake to pay the Beneficiary on first written demand',
      'any sum up to the Guarantee Amount, without demur, during the validity of this guarantee.',
      { text: 'For ' + bank.name + ' - Authorised Signatory', gap: 40 },
    ], { border: true, stamp: 'Synthetic document generated for the SIH 2026 demo' });
  }
  if (f.type === 'SD') {
    return makePdf([...head,
      { text: 'E-RECEIPT: FUNDS TRANSFER (RTGS/NEFT)', size: 14, bold: true, gap: 26 },
      `UTR No: ${f.instrument_no}`,
      `Date of Transfer: ${dmy(f.issue_date)}`,
      `Remitter: ${f.depositor_name}`,
      `In favour of: ${f.lien_in_favour}`,
      `Amount: ${money(f.amount)}`,
      'Purpose: Security deposit to AICTE',
      { text: 'This is a system generated receipt and does not need a signature.', gap: 30 },
    ], { border: true, stamp: 'Synthetic document generated for the SIH 2026 demo' });
  }
  return makePdf([...head,
    { text: 'FIXED DEPOSIT RECEIPT (ADVICE)', size: 14, bold: true, gap: 26 },
    `FDR No: ${f.instrument_no}`,
    `Name of Depositor: ${f.depositor_name}`,
    `Lien marked in favour of: ${f.lien_in_favour}`,
    `Deposit Amount: ${money(f.amount)}`,
    `Date of Deposit: ${dmy(f.issue_date)}`,
    `Period: ${months(f.issue_date, f.maturity_date)} months   Rate of Interest: ${Number(f.interest_rate || 7).toFixed(2)}% p.a.`,
    `Maturity Date: ${dmy(f.maturity_date)}`,
    `Deposit A/c No: ${f.account_no ?? '—'}`,
    `Auto renewal: ${f.auto_renew ? 'Yes' : 'No'}`,
    { text: 'Premature withdrawal is not permitted without a no-objection from the lien holder.', gap: 30 },
    { text: 'For ' + bank.name + ' - Branch Manager', gap: 40 },
  ], { border: true, stamp: 'Synthetic document generated for the SIH 2026 demo' });
}

export function coverLetterPdf(inst, f, purposeName) {
  return makePdf([
    { text: inst.name, size: 14, bold: true }, `${inst.city}, ${inst.state} · AICTE Permanent ID ${inst.aicte_id}`, { rule: true },
    { text: 'To: The Director, Regulation Bureau, AICTE, New Delhi', gap: 24 },
    `Subject: Submission of ${f.type === 'BG' ? 'Bank Guarantee' : f.type === 'SD' ? 'security deposit' : 'FDR'} for ${purposeName}`,
    { text: `We submit ${f.type} No. ${f.instrument_no} for ${money(f.amount)} issued by ${bankByCode[f.bank_code]?.name ?? ''}`, gap: 22 },
    `on ${dmy(f.issue_date)}${f.maturity_date ? `, valid till ${dmy(f.maturity_date)}` : ''}, in favour of ${f.lien_in_favour}.`,
    { text: `${inst.head_name}, Principal / Director`, gap: 40 },
  ], { stamp: 'Synthetic document generated for the SIH 2026 demo' });
}

export function resolutionPdf(inst, f) {
  return makePdf([
    { text: inst.trust_name, size: 14, bold: true }, 'Extract of the resolution of the Board of Trustees', { rule: true },
    { text: `RESOLVED that a deposit of ${money(f.amount)} be placed with ${bankByCode[f.bank_code]?.name ?? 'the bank'} in favour of`, gap: 24 },
    `${f.lien_in_favour}, towards the requirement of AICTE for ${inst.name},`,
    'and that the Secretary is authorised to sign all documents relating to it.',
    { text: 'Certified true copy - Secretary', gap: 40 },
  ], { stamp: 'Synthetic document generated for the SIH 2026 demo' });
}

export function bankConfirmationPdf(f) {
  const bank = bankByCode[f.bank_code] ?? { name: 'Bank' };
  return makePdf([
    { text: bank.name.toUpperCase(), size: 15, bold: true }, `Branch: ${f.branch}   IFSC: ${f.ifsc}`, { rule: true },
    { text: 'To: The Director, Regulation Bureau, AICTE, New Delhi', gap: 24 },
    'Subject: Confirmation of deposit and lien',
    { text: `We confirm that ${f.type} No. ${f.instrument_no} for ${money(f.amount)} dated ${dmy(f.issue_date)}`, gap: 22 },
    `${f.maturity_date ? `maturing on ${dmy(f.maturity_date)} ` : ''}is held in our books and lien is marked in favour of`,
    `${f.lien_in_favour}. It will not be released without AICTE's written consent.`,
    { text: 'Branch Manager', gap: 40 },
  ], { stamp: 'Synthetic document generated for the SIH 2026 demo' });
}

export function releaseLetterPdf({ inst, instrument, rr, approver, ref, date }) {
  const bank = bankByCode[instrument.bank_code] ?? { name: 'the bank' };
  const isSd = instrument.type === 'SD';
  return makePdf([
    { text: 'ALL INDIA COUNCIL FOR TECHNICAL EDUCATION', size: 14, bold: true, center: true },
    { text: 'Regulation Bureau, Nelson Mandela Marg, Vasant Kunj, New Delhi', center: true, size: 10 },
    { rule: true },
    { text: `No. ${ref}`, gap: 22 }, `Date: ${dmy(date)}`,
    { text: `To: The Branch Manager, ${bank.name}, ${instrument.branch}`, gap: 22 },
    `Copy: ${inst.name}, ${inst.city} (AICTE ID ${inst.aicte_id})`,
    { text: `Subject: ${isSd ? 'Refund of security deposit' : 'Release of lien / discharge'} - ${instrument.type} No. ${instrument.instrument_no}`, gap: 22, bold: true },
    { text: `With reference to request ${rr.req_no}, the competent authority has approved the ${isSd ? 'refund' : 'release'} of`, gap: 22 },
    `${instrument.type} No. ${instrument.instrument_no} for ${money(instrument.amount)} dated ${dmy(instrument.issue_date)}.`,
    isSd ? 'The amount will be credited to the institution\'s verified bank account.' : 'You are requested to remove the lien marked in favour of AICTE and release the deposit',
    isSd ? '' : 'to the depositor as per your rules.',
    { text: `Approved by: ${approver}`, gap: 30 },
    { text: 'Director, Regulation Bureau', gap: 30 },
  ], { stamp: `Digitally generated by the AICTE SD/FDR Portal · ${ref}` });
}
