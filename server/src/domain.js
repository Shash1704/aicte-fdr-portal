// Reference data for the AICTE Security Deposit / FDR portal.
// Amounts and periods in REQUIREMENT_DEFAULTS are illustrative demo values. Admins change them
// in the portal (Administration → Requirement rules) because the actual norms vary by handbook year.

export const REGIONS = [
  { code: 'NRO', name: 'Northern', office: 'Kanpur', states: ['Uttar Pradesh', 'Uttarakhand', 'Bihar'] },
  { code: 'NWRO', name: 'North-Western', office: 'Chandigarh', states: ['Punjab', 'Haryana', 'Himachal Pradesh', 'Delhi', 'Rajasthan', 'Jammu and Kashmir'] },
  { code: 'WRO', name: 'Western', office: 'Mumbai', states: ['Maharashtra', 'Goa', 'Gujarat'] },
  { code: 'CRO', name: 'Central', office: 'Bhopal', states: ['Madhya Pradesh', 'Chhattisgarh'] },
  { code: 'ERO', name: 'Eastern', office: 'Kolkata', states: ['West Bengal', 'Odisha', 'Jharkhand', 'Assam'] },
  { code: 'SRO', name: 'Southern', office: 'Chennai', states: ['Tamil Nadu', 'Puducherry'] },
  { code: 'SWRO', name: 'South-Western', office: 'Bengaluru', states: ['Karnataka', 'Kerala'] },
  { code: 'SCRO', name: 'South-Central', office: 'Hyderabad', states: ['Telangana', 'Andhra Pradesh'] },
];
export const regionForState = (state) => REGIONS.find((r) => r.states.includes(state))?.code ?? null;

export const INSTRUMENT_TYPES = [
  { code: 'FDR', name: 'Fixed Deposit Receipt', short: 'FDR', hasMaturity: true },
  { code: 'BG', name: 'Bank Guarantee', short: 'BG', hasMaturity: true },
  { code: 'SD', name: 'Security deposit (online transfer to AICTE)', short: 'SD', hasMaturity: false },
];
export const typeByCode = Object.fromEntries(INSTRUMENT_TYPES.map((t) => [t.code, t]));

export const PURPOSES = [
  { code: 'NEW_INST', name: 'Approval of new institution' },
  { code: 'INTAKE', name: 'New course / increase in intake' },
  { code: 'COLLAB', name: 'Collaboration / twinning with a foreign university' },
  { code: 'CHANGE', name: 'Change of site, name or management' },
  { code: 'CONDITIONAL', name: 'Conditional approval (deficiency compliance)' },
];
export const purposeByCode = Object.fromEntries(PURPOSES.map((p) => [p.code, p]));

export const INSTITUTION_TYPES = ['Engineering', 'Management', 'Pharmacy', 'Polytechnic', 'Computer Applications', 'Architecture'];

const L = 100000; // one lakh
const BASE_NEW = { Engineering: 35 * L, Management: 15 * L, Pharmacy: 15 * L, Polytechnic: 10 * L, 'Computer Applications': 10 * L, Architecture: 15 * L };
// [purpose, amount(type), min tenure (months), holding period (years), accepted instrument types]
export const REQUIREMENT_DEFAULTS = INSTITUTION_TYPES.flatMap((t) => [
  ['NEW_INST', BASE_NEW[t], 12, 5, 'FDR,BG'],
  ['INTAKE', 5 * L, 12, 3, 'FDR,SD'],
  ['COLLAB', 25 * L, 12, 5, 'FDR,BG'],
  ['CHANGE', 10 * L, 12, 3, 'FDR,SD'],
  ['CONDITIONAL', 5 * L, 6, 2, 'FDR,BG,SD'],
].map(([purpose, min_amount, min_tenure_months, hold_years, accepted_types]) => ({ purpose, inst_type: t, min_amount, min_tenure_months, hold_years, accepted_types })));

// Instrument workflow status (stored). Validity and verification are tracked separately.
export const STATUSES = ['Submitted', 'Under Scrutiny', 'Query Raised', 'Active', 'Matured', 'Renewed', 'Release Requested', 'Released', 'Rejected'];
export const PENDING_STATUSES = ['Submitted', 'Under Scrutiny', 'Query Raised'];
export const HELD_STATUSES = ['Active', 'Matured', 'Release Requested'];
export const CLOSED_STATUSES = ['Renewed', 'Released', 'Rejected'];

// How an instrument's details were confirmed. Only the first two count as "bank-confirmed".
export const VERIFICATION = {
  unverified: { label: 'Not yet verified', bank: false },
  bank_api: { label: 'Confirmed by bank (verification service)', bank: true },
  bank_letter: { label: 'Confirmed by bank letter', bank: true },
  officer: { label: 'Verified by officer (no bank confirmation)', bank: false },
};

// Banks. `api` marks banks reachable through the (simulated) verification sandbox; the others need a
// bank confirmation letter. Real integrations would need each bank's formal authorisation.
export const BANKS = [
  { code: 'SBI', name: 'State Bank of India', ifsc: 'SBIN', api: 1 },
  { code: 'PNB', name: 'Punjab National Bank', ifsc: 'PUNB', api: 1 },
  { code: 'BOB', name: 'Bank of Baroda', ifsc: 'BARB', api: 1 },
  { code: 'CNB', name: 'Canara Bank', ifsc: 'CNRB', api: 1 },
  { code: 'UBI', name: 'Union Bank of India', ifsc: 'UBIN', api: 1 },
  { code: 'HDFC', name: 'HDFC Bank', ifsc: 'HDFC', api: 1 },
  { code: 'ICICI', name: 'ICICI Bank', ifsc: 'ICIC', api: 1 },
  { code: 'AXIS', name: 'Axis Bank', ifsc: 'UTIB', api: 1 },
  { code: 'IB', name: 'Indian Bank', ifsc: 'IDIB', api: 0 },
  { code: 'BOI', name: 'Bank of India', ifsc: 'BKID', api: 0 },
  { code: 'IOB', name: 'Indian Overseas Bank', ifsc: 'IOBA', api: 0 },
  { code: 'UCO', name: 'UCO Bank', ifsc: 'UCBA', api: 0 },
  { code: 'CBI', name: 'Central Bank of India', ifsc: 'CBIN', api: 0 },
];
export const bankByCode = Object.fromEntries(BANKS.map((b) => [b.code, b]));
export const bankByIfsc = (ifsc) => BANKS.find((b) => String(ifsc || '').toUpperCase().startsWith(b.ifsc)) ?? null;

export const DOC_KINDS = [
  { code: 'INSTRUMENT', name: 'Scanned instrument (FDR / BG / payment receipt)' },
  { code: 'COVER_LETTER', name: 'Covering letter from the institution' },
  { code: 'RESOLUTION', name: 'Trust / Society board resolution' },
  { code: 'BANK_CONFIRMATION', name: 'Bank confirmation / lien-marking letter' },
  { code: 'QUERY_REPLY', name: 'Reply to query' },
  { code: 'NO_DUES', name: 'No-dues certificate' },
  { code: 'RELEASE_LETTER', name: 'Release / discharge letter (system generated)' },
  { code: 'OTHER', name: 'Other document' },
];
export const REQUIRED_DOCS = { FDR: ['INSTRUMENT', 'COVER_LETTER', 'RESOLUTION'], BG: ['INSTRUMENT', 'COVER_LETTER', 'RESOLUTION'], SD: ['INSTRUMENT', 'COVER_LETTER'] };

export const RELEASE_REASONS = [
  { code: 'HOLD_COMPLETE', name: 'Prescribed holding period completed' },
  { code: 'REPLACED', name: 'Replaced by a renewed / new instrument' },
  { code: 'CLOSURE', name: 'Closure of institution / course approved' },
  { code: 'NOT_APPROVED', name: 'Approval not granted / application withdrawn' },
  { code: 'EXCESS', name: 'Deposit exceeds the requirement' },
];
export const RELEASE_STATUSES = ['Submitted', 'Recommended', 'Forwarded', 'Approved', 'Released', 'Returned', 'Rejected'];
export const RELEASE_OPEN = ['Submitted', 'Recommended', 'Forwarded', 'Approved', 'Returned'];

// Conditions checked before a release can be approved. `auto` items are evaluated from data.
export const RELEASE_CHECKS = [
  { code: 'VERIFIED', label: 'Instrument verified and held on record', auto: true },
  { code: 'ELIGIBLE', label: 'Release condition met (holding period over, replacement active, or closure/refusal on record)', auto: true },
  { code: 'NO_DISCREPANCY', label: 'No open discrepancies on the instrument', auto: true },
  { code: 'NO_REG_ACTION', label: 'No open regulatory action or complaint against the institution (from ICMS)', auto: true },
  { code: 'NO_DUES', label: 'No outstanding dues or penalties payable to AICTE', auto: true },
  { code: 'ORIGINALS', label: 'Original instrument / discharge documents in AICTE custody', auto: false, role: 'officer' },
  { code: 'REFUND_ACCOUNT', label: 'Refund bank account verified (security deposits only)', auto: false, role: 'accounts', types: ['SD'] },
];

export const ROLES = {
  admin: 'Competent Authority',
  head: 'Director, Regulation Bureau',
  officer: 'Dealing Officer',
  accounts: 'Accounts Officer',
  institution: 'Institution',
  auditor: 'Auditor (read-only)',
};
export const STAFF_ROLES = ['admin', 'head', 'officer', 'accounts', 'auditor'];

export const EVENT_LABELS = {
  SUBMITTED: 'Submitted by institution',
  EXTRACTED: 'Details read from document',
  SCRUTINY: 'Scrutiny started',
  BANK_CHECK: 'Checked with bank',
  REVERIFIED: 'Periodic re-check with bank',
  QUERY_RAISED: 'Query raised to institution',
  QUERY_ANSWERED: 'Institution replied to query',
  FIELD_UPDATED: 'Details corrected',
  DOC_UPLOADED: 'Document uploaded',
  WAIVED: 'Discrepancy waived',
  VERIFIED: 'Verified and accepted',
  REJECTED: 'Submission rejected',
  NOTE: 'Note',
  REMINDER_SENT: 'Reminder sent',
  ESCALATED: 'Escalated',
  MATURED: 'Instrument matured',
  RENEWAL_SUBMITTED: 'Renewal submitted',
  RENEWED: 'Superseded by renewal',
  RELEASE_REQUESTED: 'Release requested',
  RELEASE_STEP: 'Release request updated',
  RELEASED: 'Released / discharged',
  BANK_ALERT: 'Bank reported a change',
};

// Monitoring defaults (Administration → Monitoring rules can change them).
export const DEFAULT_SETTINGS = {
  reminder_ladder: [90, 60, 30, 15, 7, 0], // days before maturity
  overdue_repeat_days: 7,
  escalation_days: [1, 15, 30], // days overdue for level 1 (officer), 2 (Director), 3 (Competent Authority)
  scrutiny_sla_days: 7,
  query_response_days: 15,
  release_sla_days: 30,
  reverify_days: 30,
  minutes_per_manual_letter: 20, // used to estimate staff time saved by automatic reminders
};
