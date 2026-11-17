# Progress

## 2026-11-17: route saved and drafts-only flow
- Step: saved the owner-confirmed route (Drafts only) and the drafts-only execution flow.
- Artifacts: `SEND-ROUTE.md`, `EXECUTION-FLOW.md`, `REVIEW.md`.
- Check: no company brief, history, exclusions, bookings or buyer list is in the repo. 0 drafts written, 0 recipients cleared, 0 sent.
- Next task: add the company brief, exclusion and booking history, and a sourced buyer list to `company-motion/`, then write the first exact drafts for review.

## 2026-11-17: company brief from christinecastro.com
- Step: captured the homepage of christinecastro.com into a company brief. Did not run the rule test: the saved route is Drafts only, and that test belongs to the Gmail and provider routes.
- Artifact: `COMPANY-BRIEF.md`, with `REVIEW.md` and `EXECUTION-FLOW.md` updated.
- Check: 1 page captured; 12 proof points recorded as the site states them; 0 exclusions confirmed; 0 drafts; 0 sent. Missing: outreach history, exclusions, bookings, a sourced buyer list. No sender access (none needed on this route).
- Next task: confirm exclusions (for example, past employers) and build a sourced list of 10 Seed to Series C cybersecurity companies for drafts.

## 2026-11-17: exclusions confirmed, CRM read, shortlist built
- Step: saved the 7 owner-confirmed exclusions. Read GTM Radar CRM (read-only) and screened its 42 contact rows into a 10-company Seed to Series C shortlist.
- Artifacts: `EXCLUSIONS.md`, `CRM-SOURCE.md`, `TARGET-LIST.md`, with `REVIEW.md` and `EXECUTION-FLOW.md` updated.
- Check: 470 CRM rows; 3 excluded companies found in the sheet (COGNNA, HYPR, Morphisec); 0 sends or replies recorded; 0 contact emails; 10 rows shortlisted, all held; 0 sent; the sheet is unchanged.
- Next task: review the 10 existing CRM drafts against `COMPANY-BRIEF.md` and re-verify each company's stage and contact.

## 2026-11-17: accounts and buyers checked against official sources
- Step: checked the 10 shortlisted companies' domain, country, funding and leader against official pages. Applied the owner's country rule. Wrote local account and people records. Imported nothing and validated no emails.
- Artifacts: `ACCOUNTS.json`, `PEOPLE.json`, `ANSWERS.md`, with `REVIEW.md` and `TARGET-LIST.md` updated.
- Check: 10 of 10 leaders confirmed in role on an official page. 8 companies included for drafts; 2 held (A Security: conflicting country; Way Security: unknown country); 0 excluded. 0 emails sought or validated. 10 of 10 held for sending. 5 outdated CRM fields recorded.
- Missing access: ZeroBounce and any sender. Missing lists: opt-outs, bookings, current customers, open deals.
- Next task: write and source-check the first drafts for the 8 included companies, using only `COMPANY-BRIEF.md` proof points and `ACCOUNTS.json` facts.

## 2026-11-17: first-email drafts
- Step: wrote one first email for each of the 8 included companies: one sourced relevance reason, the real offer, one permission ask, the owner's opt-out line and signature. No metrics, customer claims or links. No follow-ups or variants.
- Artifacts: `EMAIL-PREVIEWS.md` and `PROSPECT-DRAFTS.json` (plain text, HTML and a source note for each draft); signature and opt-out saved in `ANSWERS.md`.
- Check: 8 drafts; 58 to 70 words each before the opt-out and signature; 0 links, tokens or unresolved variables (checked by script); every funding claim tied to an official or trade-press source. 2 companies held (A Security, Way Security). 0 addresses; 0 imported; 0 sent.
- Next task: owner reviews all 8 drafts and marks each approve, edit or reject in `REVIEW.md`.

## 2026-11-17: pilot review (drafts only)
- Step: built the 11-row pilot review (1 self-test slot and 10 prospects). Skipped the provider and Gmail exercises (input file, export script, CSVs, native import and previews, approval grant): the saved route is Drafts only and none of those tools exists here.
- Artifact: `PILOT-REVIEW.md`, with draft cohort hash `d74d7b1acb422366…`.
- Check: 8 drafts written, 2 companies held, 1 self-test not prepared; 0 addresses, 0 CSVs, 0 imports, 0 sends; no approval requested or recorded.
- Next task: owner reviews the 8 drafts (approve, edit or reject). To run a real pilot, the owner first saves a new route in `SEND-ROUTE.md`.

## 2026-11-17: canary (simulated, held)
- Step: ran a simulated local preflight for the self-test. No submission: the route is Drafts only, and no manifest, approval or self-test row exists.
- Artifact: `CANARY.md`.
- Check: decision HOLD; 0 submitted; no provider result; the draft cohort hash is unchanged (`d74d7b1a…`). Six pieces of live evidence are missing (listed in `CANARY.md`).
- Next task: owner reviews the 8 drafts. To test a real send, the owner first saves a sending route and supplies their own self-test address.

## 2026-11-17: Sent check (none to match)
- Step: attempted the self-test Sent match. No original self-test exists (the canary was held), so there was nothing to match or label. Ran one read-only Gmail Sent search for the draft subjects.
- Artifact: `CANARY.md` (section "Sent check").
- Check: 0 Sent threads matched in the last 2 days. No message ID, receipt or label. 10 of 10 prospects held. No second self-test created.
- Next task: owner reviews the 8 drafts. A real self-test needs a saved sending route, the owner's own test address and an explicit release.

## 2026-11-17: pilot release (held)
- Step: checked the release preconditions for the 10-prospect pilot. All failed or are missing on the Drafts-only route, so nothing was released. No gtm.py or provider commands were run, and no buyers were substituted.
- Artifact: `PILOT-RESULTS.md`.
- Check: prepared 8, held 10 of 10, accepted 0, Sent 0, unknown 0. Lifetime cap: 0 of 11 used. Draft hash unchanged.
- Next task: owner reviews the 8 drafts. A real pilot needs a saved sending route first.

## 2026-11-17: results read (none to read)
- Step: read the pilot results. No native activity exists because nothing was imported or sent; recorded all counts separately. Saved waits and one next action.
- Artifacts: `PILOT-RESULTS.md` (section "Results read"), `WAITS.md`.
- Check: prepared 8, held 10 of 10, queued 0, accepted 0, Sent 0, received 0, bounced 0, replied 0, booked 0, unknown 0. 0 of 11 keys exist; no container to pause; no repeat send or import.
- Next task: owner reviews the 8 drafts in `EMAIL-PREVIEWS.md`.

## 2026-11-17: email skill saved and tested
- Step: saved the first-email instructions as a reusable skill, then used it for one extra unsent local draft (Tailscale, the saved next-in-line target), with official and trade-press sources.
- Artifacts: `skills/outbound-email/SKILL.md`, `SKILL-TEST.md`.
- Check: the draft passes the stage, country, exclusion, role, link and placeholder checks; word count is in `SKILL-TEST.md`. It is not imported, not sent and not added to the pilot. The 11-email cap and the original cohort are unchanged.
- Next task: owner reviews the 8 pilot drafts plus the Tailscale skill test, and confirms the HYPR and Morphisec line.
