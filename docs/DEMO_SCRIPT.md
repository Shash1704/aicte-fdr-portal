# Demo script (about 7 minutes)

Start the app (`npm run build && npm start`) and open http://localhost:4000, or use the GitHub Pages demo. Every password is `Aicte@2026`; the login screen lists the accounts.

1. **Sign in as the Director (`rb.director`). Dashboard.**
   ₹ held for AICTE, renewals overdue, and the six categories the statement asks for (active, expiring, matured, renewed, released, pending). On the right, **Portal vs manual register**: verification median of about 2 days against about a month by hand, renewals on time, bank-confirmed share, problems caught and staff-hours saved. *Needs attention* opens with two **Bank: encashed** cases.

2. **Open an encashed deposit** (top of *Needs attention*).
   The FDR was accepted months ago; the periodic re-check with the bank found it broken before maturity. The history shows when it was accepted and when the bank reported the change. *This is the risk a paper register cannot catch.*

3. **My desk → To verify.** Open a submission marked **Bank: details differ**.
   The **three-way check**: declared, read from the document, confirmed by the bank. Red cells are where the bank disagrees. Then the **Discrepancies** panel: duplicate instrument (already pledged by another institution), and the suggested action. Try **Accept**: it is blocked. **Raise query**: the text is prefilled from the findings.

4. **Sign out; sign in as `institution1`.**
   The institution home: *To do* shows an FDR maturing soon, the requirement-vs-holdings bars, and every reminder the portal sent. Click **Submit renewal**.

5. **Submit renewal with a sample FDR.**
   In *Try a sample FDR*, click **Valid FDR, State Bank of India**: the PDF is read and 13 fields fill in automatically. Submit. The bank confirms instantly and every row of the three-way check is green.
   Optionally, also submit **Altered FDR**: the bank's record shows a tenth of the amount, flagged critical.

6. **Sign in as `rb.officer1` (or the Director)** and open the renewal (bell or *My desk*). **Accept → Confirmed by the bank online.** Open the old FDR: it is now *Renewed*, with the **Renewal history** chain.

7. **Time machine: sign in as `ms`. Administration → +30 days.**
   The toast lists reminders sent, instruments matured and escalations raised. Show the *Maturity calendar*, *Alerts* (renewal overdue, escalation levels) and an institution's *Messages from the portal*. **Back to today** when done.

8. **Release: Releases → Waiting on me.** Open a request at *Forwarded*.
   Conditions checked automatically: verified, holding period over, no discrepancies, **no open complaint in ICMS** (our PS SIH26264), no dues. Approve. Sign in as `accounts` and **Issue release letter**: a PDF letter is generated and the instrument becomes *Released*. Segregation of duties: if the Director recommends a request as maker, the portal refuses to let the same person forward it as checker.

9. **Audit: Administration → Audit trail → Verify the chain** (as `ms` or `auditor`). Every action is hash-chained; editing any past entry breaks the chain and is reported.

10. **Reports**: pending verifications, upcoming maturities (30/60/90/180/365 days), missing documents, cases requiring intervention, release register, institution holdings with shortfall, bank exposure. **CSV** and **Print**.
