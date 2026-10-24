# Requirements map — SIH26265

How each item in the problem statement is met, and where to see it in the app.

## Expected solution: the 10 capabilities

| # | Capability | Implementation | See it |
|---|---|---|---|
| 1 | Centralised SD/FDR repository | Institution-wise and instrument-wise records: reference, purpose, type, number, bank, branch, IFSC, amount, issue and maturity dates, depositor, lien, interest, auto-renewal, encrypted account number, validity, status, documents | Register; Institutions → profile; instrument page |
| 2 | Digital document management | Upload (PDF/PNG/JPEG, 10 MB), typed documents (instrument, covering letter, resolution, bank letter, query reply, no-dues, release letter); encrypted at rest; SHA-256 fingerprint; every view audited | Submit; instrument page → Documents |
| 3 | Verification and discrepancy detection | Bank verification service (sandbox) on submission and on demand; bank letter route for banks without a service; 16 rules covering bank, document, requirement, consistency, duplicates and missing documents; declared vs document vs bank shown per field | Instrument page → Three-way check, Discrepancies; Check with bank |
| 4 | Automated validity and maturity tracking | Daily monitoring job; validity states (valid, renewal due, maturing, renewal submitted, matured/overdue, holding period over); configurable reminder ladder | Dashboard maturity profile; Maturity calendar; badges in every list |
| 5 | Renewal and replacement monitoring | Renewal linked to its predecessor, inherits purpose, requirement and holding period; old instrument becomes *Renewed* on acceptance; full chain kept | Submit renewal; instrument page → Renewal history |
| 6 | Release and refund workflow | Reasons (holding period over, replaced, closure, not approved, excess); automatic conditions + manual confirmations; officer (maker) → Director (checker) → Competent Authority (approver) → Accounts; return/resubmit/reject; release letter PDF | Releases; release page |
| 7 | Alerts and escalation | Reminders T-90/60/30/15/7/0 (SMS from T-15), overdue notices every 7 days, escalation at 1/15/30 days to officer/Director/Competent Authority, verification and query SLAs, bank alerts; alerts clear themselves | Alerts; bell; institution's messages; Reports → Notifications sent |
| 8 | Dashboard and reports | Active, expiring, matured, renewed, released, pending (and release requested); holdings by region and bank; 10 reports with CSV and print | Dashboard; Reports |
| 9 | Audit trail and access control | Six roles enforced on the server; institutions scoped to their own records; hash-chained audit log with integrity check; segregation of duties | Administration → Audit trail; release page |
| 10 | Integration and data security | AICTE Permanent ID as the key; bank sandbox API shaped like a real service; ICMS complaint check before release; AES-256-GCM documents and account numbers | Administration → Bank sandbox; release conditions |

## Detailed description, point by point

| Statement | Where |
|---|---|
| "verify available instrument details through legitimate bank-issued verification mechanisms wherever supported" | Connected banks are checked online; others need a bank confirmation letter, which the rules ask for |
| "identify incomplete records and flag discrepancies requiring further scrutiny" | Missing-document and discrepancy rules; Reports → Missing documents, Discrepancy register |
| "distinguish between information submitted by an institution and information independently confirmed by an authorised bank" | Three-way check; *Institution-declared / Bank-confirmed / Officer-verified* badges; acceptance without bank confirmation needs Director/CA and a reason |
| "configurable reminders … overdue or unresolved cases flagged" | Administration → Monitoring rules; overdue notices and escalation |
| "release, discharge or refund … authorisation by the competent authority" | Release workflow; only the Competent Authority approves |
| "search records, review document histories, update permitted fields, record scrutiny observations" | Register search and filters; history timeline; *Correct details* (reason required for officers); notes and queries |
| "reports … pending verifications, upcoming maturity dates, missing documents and cases requiring intervention" | Reports: exactly these four, plus six more |
| "role-based access, secure document storage, appropriate encryption, audit trails" | See Security in the README |
| "integration with existing AICTE systems and bank verification services" | ICMS link, Permanent ID, bank sandbox; production path in the README |

## Measurable improvements (statement: "the prototype should demonstrate")

| Measure | How it is shown |
|---|---|
| Record accuracy | Share of held deposits bank-confirmed; discrepancies caught by rule; form/document mismatches |
| Verification turnaround | Median days, portal vs manual baseline; % within 7 days |
| Timely renewal monitoring | % renewals received before maturity, portal vs manual; lapsed count and amount |
| Reduction in manual tracking | Notices sent automatically and the staff-hours they replace |
| Visibility into pending cases | Pending by age; My desk; intervention report |

## Test scenarios (statement) → automated tests ([server/test/api.test.js](../server/test/api.test.js))

| Scenario | Test |
|---|---|
| New FDR submission | *new FDR submission is read, bank-confirmed and accepted* |
| Validity tracking, approaching maturity | *validity tracking and approaching maturity (time machine)* |
| Renewal | *renewal is linked to the instrument it replaces* |
| Discrepancy identification | *discrepancies are identified and block acceptance* (altered, duplicate, reused file, no lien, short amount and tenure) |
| Authorised release processing | *authorised release with maker-checker-approver and a release letter* |
| Security | *documents are encrypted at rest and the audit trail is tamper-evident*; *institutions see only their own records* |
