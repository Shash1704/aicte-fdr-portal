export type Role = 'admin' | 'head' | 'officer' | 'accounts' | 'institution' | 'auditor';
export type Severity = 'info' | 'warning' | 'serious' | 'critical';
export type Status = 'Submitted' | 'Under Scrutiny' | 'Query Raised' | 'Active' | 'Matured' | 'Renewed' | 'Release Requested' | 'Released' | 'Rejected';
export type Validity = 'pending' | 'closed' | 'valid' | 'expiring' | 'maturing' | 'lapsed' | 'renewal_submitted' | 'complete';
export type Verification = 'unverified' | 'bank_api' | 'bank_letter' | 'officer';
export type BankStatus = 'unchecked' | 'confirmed' | 'mismatch' | 'not_found' | 'encashed' | 'closed' | 'unsupported' | 'unknown_bank';

export interface InstitutionLite { id: number; name: string; aicte_id: string; city: string; state: string; type: string; trust_name: string; region_code: string }
export interface User {
  id: number; username: string; name: string; designation: string; email: string; role: Role;
  institution_id: number | null; regions: string | null; institution?: InstitutionLite | null;
}
export interface Region { code: string; name: string; office: string; states: string[] }
export interface Bank { code: string; name: string; ifsc: string; api: number }
export interface Meta {
  regions: Region[]; types: Array<{ code: string; name: string; short: string; hasMaturity: boolean }>; purposes: Array<{ code: string; name: string }>;
  statuses: Status[]; banks: Bank[]; docKinds: Array<{ code: string; name: string }>; requiredDocs: Record<string, string[]>;
  releaseReasons: Array<{ code: string; name: string }>; releaseChecks: ReleaseCheck[]; releaseStatuses: string[]; roles: Record<Role, string>;
  eventLabels: Record<string, string>; verification: Record<Verification, { label: string; bank: boolean }>; institutionTypes: string[];
  requirements: Array<{ purpose: string; inst_type: string; min_amount: number; min_tenure_months: number; hold_years: number; accepted_types: string }>;
  users: Array<{ id: number; name: string; designation: string; role: Role; regions: string | null }>;
}

export interface InstrumentRow {
  id: number; ref_no: string; institution_id: number; purpose: string; type: string; status: Status; instrument_no: string; bank_code: string | null; branch: string | null;
  amount: number; issue_date: string; maturity_date: string | null; hold_until: string | null; required_amount: number | null; verification: Verification; bank_status: BankStatus;
  submitted_at: string; verified_at: string | null; activated_at: string | null; escalation_level: number; successor_id: number | null; predecessor_id: number | null;
  next_action: string | null; next_action_due: string | null; officer_id: number | null; reminder_stage: number | null; legacy: number;
  institution_name: string; aicte_id: string; city: string; state: string; region_code: string; institution_type: string; officer_name: string | null;
  validity: Validity; days_left: number | null; age_days: number; open_issues: number; worst_issue: number | null;
}

export interface Provenance { field: string; label: string; declared: string | number | null; document: string | number | null; bank: string | number | null; documentMatch?: boolean; bankMatch?: boolean }
export interface Discrepancy { id: number; rule: string; field: string; severity: Severity; message: string; action: string | null; status: 'open' | 'resolved' | 'waived'; detected_at: string; resolved_at: string | null; resolved_by_name: string | null; note: string | null }
export interface InstrumentEvent { id: number; at: string; type: string; from_status: string | null; to_status: string | null; remarks: string | null; data: Record<string, unknown> | null; actor_name: string | null; actor_designation: string | null; actor_role: Role | null }
export interface Doc { id: number; kind: string; filename: string; mime: string; size: number; sha256: string; uploaded_at: string; uploaded_by_name: string | null; release_id: number | null }
export interface Query { id: number; raised_at: string; due_on: string; text: string; status: 'open' | 'answered' | 'closed'; response: string | null; responded_at: string | null; raised_by_name: string | null; responded_by_name: string | null }
export interface ReleaseCheck { code: string; label: string; auto: boolean; role?: string; types?: string[]; ok?: boolean; detail?: string }
export interface Release {
  id: number; req_no: string; instrument_id: number; institution_id: number; reason: string; details: string | null; status: string; requested_at: string;
  recommended_at: string | null; forwarded_at: string | null; approved_at: string | null; released_at: string | null; release_ref: string | null; closed_remarks: string | null;
  ref_no: string; type: string; amount: number; instrument_no: string; bank_code: string | null; institution_name: string; aicte_id: string;
  requested_by_name: string | null; recommended_by_name: string | null; forwarded_by_name: string | null; approved_by_name: string | null; released_by_name: string | null;
  checklist: ReleaseCheck[]; age_days?: number; waiting_on?: boolean; documents?: Doc[];
}
export interface Institution {
  id: number; aicte_id: string; name: string; type: string; ownership: string; trust_name: string; address: string; city: string; state: string; pincode: string;
  region_code: string; established: number; approval_status: string; email: string; phone: string; head_name: string; open_cases: number; dues_outstanding: number;
}
export interface InstrumentDetail extends InstrumentRow {
  depositor_name: string; lien_in_favour: string; ifsc: string | null; interest_rate: number | null; auto_renew: number; account_masked: string | null;
  doc: { source: string; fields: Record<string, unknown>; confidence: Record<string, number> } | null;
  bank: { status: string; bank?: string; record?: Record<string, unknown>; at: string; ref: string } | null; bank_checked_at: string | null;
  verify_note: string | null; verified_by_name: string | null; validity_state: Validity;
  institution: Institution; requirement: { min_amount: number; min_tenure_months: number; hold_years: number; accepted_types: string } | null;
  provenance: Provenance[]; events: InstrumentEvent[]; documents: Doc[]; discrepancies: Discrepancy[]; queries: Query[]; releases: Release[];
  lineage: Array<{ id: number; ref_no: string; instrument_no: string; bank_code: string | null; amount: number; issue_date: string; maturity_date: string | null; status: Status; verification: Verification }>;
  permissions: Record<'bankCheck' | 'query' | 'verify' | 'verifyWithoutBank' | 'reject' | 'waive' | 'edit' | 'reply' | 'upload' | 'note' | 'renew' | 'requestRelease', boolean>;
}
export interface Alert {
  id: number; type: string; severity: Severity; title: string; message: string | null; created_at: string; resolved_at: string | null; instrument_id: number | null;
  institution_id: number | null; release_id: number | null; ref_no?: string | null; institution_name?: string | null; read: number;
}
