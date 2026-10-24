// Colour carries meaning only: workflow status, validity and severity.
export const STATUS_COLOR: Record<string, string> = {
  Submitted: 'var(--s7)',
  'Under Scrutiny': 'var(--s1)',
  'Query Raised': 'var(--warning)',
  Active: 'var(--good)',
  Matured: 'var(--serious)',
  Renewed: 'var(--s3)',
  'Release Requested': 'var(--s5)',
  Released: 'var(--muted)',
  Rejected: 'var(--critical)',
};

export const VALIDITY: Record<string, { label: string; tone: 'good' | 'warning' | 'serious' | 'critical' | 'info' | 'muted' }> = {
  valid: { label: 'Valid', tone: 'good' },
  expiring: { label: 'Renewal due', tone: 'warning' },
  maturing: { label: 'Maturing', tone: 'info' },
  lapsed: { label: 'Renewal overdue', tone: 'critical' },
  renewal_submitted: { label: 'Renewal submitted', tone: 'info' },
  complete: { label: 'Holding period over', tone: 'info' },
  pending: { label: 'Awaiting verification', tone: 'muted' },
  closed: { label: 'Closed', tone: 'muted' },
};

export const BANK_STATUS: Record<string, { label: string; tone: 'good' | 'warning' | 'serious' | 'critical' | 'info' | 'muted' }> = {
  confirmed: { label: 'Bank confirmed', tone: 'good' },
  mismatch: { label: 'Bank: details differ', tone: 'critical' },
  not_found: { label: 'Bank: no record', tone: 'critical' },
  encashed: { label: 'Bank: encashed', tone: 'critical' },
  closed: { label: 'Bank: closed', tone: 'serious' },
  unsupported: { label: 'Needs bank letter', tone: 'warning' },
  unchecked: { label: 'Not checked', tone: 'muted' },
  unknown_bank: { label: 'Unknown bank', tone: 'warning' },
};

export const PURPOSE_COLOR: Record<string, string> = { NEW_INST: 'var(--s1)', INTAKE: 'var(--s3)', COLLAB: 'var(--s7)', CHANGE: 'var(--s4)', CONDITIONAL: 'var(--s5)' };
