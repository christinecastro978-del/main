# Pilot review (drafts only)

Route: Drafts only (`SEND-ROUTE.md`). No sender, provider, guide, export script or gtm.py exists on this route, so there is no import, native preview, container, CSV or approval grant. Every row is held for sending.

Draft cohort hash (sha256 of company, recipient, subject, text and HTML for the 8 drafts in `PROSPECT-DRAFTS.json`): `d74d7b1acb422366321c01ff2a2d11eb8ff8dc4145126af00068105c28c1df93`
Any edit to a draft changes this hash.

Sender: none permitted. Signature in drafts: Christine Castro / 978-852-7484. Links: 0. Attachments: 0. Unsubscribe: plain-text "no thanks" line; no provider footer exists.

| # | Row | Recipient | Subject | Draft | Send hold |
|---|-----|-----------|---------|-------|-----------|
| 0 | Owned self-test | (none) | (none) | Not prepared | No sender on this route |
| 1 | A Security (a.security) | — | — | Not written | Company held: Sources disagree on country and the official site states none; held, not guessed |
| 2 | Cantina (cantina.security) | Harikrishnan (Hari) Mulackal, no address | Marketing after Cantina's raise | Written, awaiting owner review | No address; no validation; exclusion read incomplete |
| 3 | Way Security (way.security) | — | — | Not written | Company held: HQ country is not stated anywhere; 'founded in Israel' does not establish HQ |
| 4 | Cogent Security (cogent.com) | Vineet Edupuganti, no address | Marketing after Cogent's Series A | Written, awaiting owner review | No address; no validation; exclusion read incomplete |
| 5 | Oligo Security (oligo.security) | Nadav Czerninski, no address | Oligo's next marketing stage | Written, awaiting owner review | No address; no validation; exclusion read incomplete |
| 6 | MIND (mind.io) | Eran Barak, no address | Marketing after MIND's Series B | Written, awaiting owner review | No address; no validation; exclusion read incomplete |
| 7 | Tines (tines.com) | Eoin Hinchy, no address | Tines and the next marketing stage | Written, awaiting owner review | No address; no validation; exclusion read incomplete |
| 8 | Adaptive Security (adaptivesecurity.com) | Brian Long, no address | Marketing after Adaptive's Series B | Written, awaiting owner review | No address; no validation; exclusion read incomplete |
| 9 | Port (port.io) | Zohar Einy, no address | Marketing after Port's Series C | Written, awaiting owner review | No address; no validation; exclusion read incomplete |
| 10 | Zenity (zenity.io) | Ben Kliger, no address | Marketing after Zenity's Series C | Written, awaiting owner review | No address; no validation; exclusion read incomplete |

Full plain text and HTML: `EMAIL-PREVIEWS.md` and `PROSPECT-DRAFTS.json`.

## Holds blocking a real pilot
1. No permitted sender or provider: the route is Drafts only.
2. No prospect email addresses, and no ZeroBounce access to validate them.
3. No opt-out, booking, current-customer or open-deal list.
4. Only 8 of 10 prospects are eligible for drafting (A Security, Way Security held on country).
5. The 8 drafts have not been reviewed by the owner.
6. No owned self-test row: there is no sender to test.

No Yes / No / Edits approval was requested: the cohort isn't concrete or eligible to send.
