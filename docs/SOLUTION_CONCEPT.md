# Solution concept — AICTE Security Deposit / FDR Portal (SIH26265)

Draft for team discussion. Working name: **FDR Vault** (rename freely).

## One-line pitch
One portal where institutions submit FDRs, the Regulation Bureau verifies them against the bank, and the system watches every maturity date, chases renewals and runs releases through a checklist and approval chain, with every field showing whether **the institution said it** or **the bank confirmed it**.

## Users and roles
| Role | Does |
|---|---|
| Institution user | Uploads FDRs and renewals, answers discrepancy queries, requests release, sees own reminders |
| Dealing officer (RB) | Scrutinises submissions, triggers bank verification, records observations, raises queries |
| Section officer / Bureau head | Approves verification outcomes, handles escalations, recommends releases |
| Accounts / Finance | Confirms lien, processes discharge/refund |
| Competent authority | Final approval of release; sees everything |
| Auditor (read-only) | Audit trail and reports |

## Instrument lifecycle (state machine)
```
Draft → Submitted → Under scrutiny ─┬→ Discrepancy raised → (institution responds) → Under scrutiny
                                    └→ Verified (bank-confirmed or officer-verified)
Verified → Active → Expiring (T-90…T-0) → Matured/Expired
                         └→ Renewal submitted → (new instrument linked as successor) → Renewed
Active → Release requested → Conditions check → Recommended → Approved by CA → Lien removed → Released / Refunded
```
Every transition is logged with who, when, remarks and attachments. A replaced instrument stays in the history chain (predecessor → successor), so a single institution's deposit has a full lineage.

## The core idea: provenance per field
Each key field (FDR no., bank, branch/IFSC, amount, issue date, maturity date, beneficiary/lien in favour of AICTE, depositor name) is stored three ways:

| Field | Declared by institution | Read from document (OCR) | Confirmed by bank |
|---|---|---|---|
| Amount | ₹25,00,000 | ₹25,00,000 | ₹25,00,000 ✓ |
| Maturity | 12-03-2029 | 12-03-2028 ⚠ | — (pending) |

- Green = all three agree and the bank confirmed. Amber = declared and document agree, bank not yet confirmed. Red = any mismatch.
- A record counts as **Verified** only on bank confirmation, or an officer's explicit manual verification with a reason (labelled differently on screen and in reports).
- This directly answers "distinguish information submitted by an institution and information independently confirmed by an authorised bank".

## Discrepancy detection (rule engine, configurable)
- Declared vs OCR vs bank mismatch on any field.
- Amount below the required deposit for that institution's category/course (requirement table is admin-configurable, not hard-coded, because norms change by handbook year).
- Tenure shorter than required; maturity before the approval period ends.
- Lien/beneficiary not in favour of AICTE; joint-name wording missing.
- Same FDR number + bank reused by another institution, or the same file hash uploaded twice.
- Invalid IFSC, issue date in the future, maturity before issue, unreadable/low-quality scan.
- Missing prescribed documents (covering letter, board resolution, bank confirmation letter, etc. — checklist is configurable).
Each flag carries a severity and a suggested action, and becomes a query to the institution in one click.

## Monitoring, reminders, escalation
- Configurable reminder ladder per instrument type, e.g. T-90, T-60, T-30, T-7, T-0, then overdue every 7 days.
- Escalation ladder: institution → dealing officer → section head → Bureau head when a deadline passes without a renewal or a query goes unanswered for N days.
- Daily job recomputes statuses (Active/Expiring/Matured/Overdue) so the dashboard is always current.
- Channels in the prototype: in-app + email log (simulated); real deployment: email/SMS gateway.

## Release / refund workflow
- Institution raises a request with reason (closure, change of norms, excess deposit, instrument replaced).
- System pre-fills a **conditions checklist**: approval status, no pending dues, no open discrepancy, no active show-cause/complaint, successor instrument in place if this is a replacement. Each item is auto-checked where data exists, otherwise ticked by an officer with evidence.
- Maker → checker → competent authority approval, with remarks at each step; release letter generated as PDF.
- Hooks into PS1 (ICMS): a release can check for open complaint cases against the same AICTE Permanent ID. Good talking point for judges since both PSs come from the Regulation Bureau.

## Verification sources (what is realistic)
The statement says "legitimate bank-issued verification mechanisms wherever supported" and "where formally authorised". Prototype plan:
- **Simulated bank verification API** (clearly labelled as a sandbox) that returns confirmed/mismatch/not-found for seeded FDRs, so the full flow can be demonstrated.
- **Bank confirmation letter upload** as the manual fallback, verified by an officer.
- Production paths to name in the deck (all need formal authorisation): bank-side verification APIs/portals for lien-marked FDRs; RBI's **Account Aggregator** framework, which covers term-deposit data with the holder's consent; and **e-Bank Guarantees via NeSL** if AICTE accepts BGs in place of FDRs. Treat these as integration options, not promises.

## Security
- Role-based access with institution users scoped to their own Permanent ID.
- Documents encrypted at rest (AES-256-GCM), stored with a SHA-256 hash to detect tampering and duplicates.
- Sensitive fields (account numbers) encrypted at field level and masked on screen.
- Tamper-evident audit trail: each log entry carries the hash of the previous one, so edits to history are detectable.
- Session timeout, password policy, optional OTP; download watermarking with user + timestamp.

## Dashboard and reports
- Tiles: Active · Expiring in 30/60/90 days · Matured · Renewed · Released · Pending verification · Open discrepancies · Overdue.
- Maturity calendar / timeline; region- and institution-wise views; total amount held.
- Reports: pending verifications, upcoming maturities, missing documents, cases needing intervention, release register, ageing, CSV/PDF export.

## Measurable improvements (the statement asks for these)
Show a KPI panel computed from the data:
- **Verification turnaround** — median days from submission to verified.
- **Timely renewals** — % of instruments renewed before maturity; count lapsed.
- **Record accuracy** — % of fields bank-confirmed; open discrepancies.
- **Manual effort saved** — reminders and escalations sent automatically vs. letters that would have been drafted by hand.
- **Visibility** — pending cases by age bucket.
A "demo time machine" (advance the clock by N days) shows reminders, escalations and status changes happening live in front of judges.

## Test scenarios (from the statement) → demo script
1. New FDR submission with OCR prefill.
2. Validity tracking — instrument moves Active → Expiring as the clock advances.
3. Approaching maturity — reminder ladder and escalation fire.
4. Renewal — successor instrument submitted, verified, predecessor closed, lineage shown.
5. Discrepancy identification — mismatched maturity date and reused FDR number caught.
6. Authorised release — checklist, maker-checker, CA approval, release letter.

## Proposed stack (reuse PS1)
Same as SIH-PS1 so we move fast and keep the free static demo:
- Client: React + Vite + TypeScript.
- Server: Node 22 + Express + built-in `node:sqlite`.
- Browser demo on GitHub Pages: same server code running in the browser with sql.js.
- OCR: tesseract.js (runs in the browser, no API key).
- Synthetic seed data: ~300 institutions, ~600 instruments across every lifecycle state, including planted discrepancies.
