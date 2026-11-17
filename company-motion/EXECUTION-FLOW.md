# Execution flow: drafts only

Route source: `company-motion/SEND-ROUTE.md` (Drafts only). Sending is held at every step.

| # | Step | Output | Status 2026-11-17 |
|---|------|--------|-------------------|
| 1 | Read company brief, past attempts, exclusions, replies, bookings and opt-outs | Notes in `REVIEW.md` | Brief saved (`COMPANY-BRIEF.md`); history and exclusions still missing |
| 2 | Select current buyers: founders/CEOs of venture-backed cybersecurity companies (ICP from `README.md`) | Candidate list with a source per row | Blocked: no buyer list provided |
| 3 | Hold anyone unknown, replied, booked or opted out | Held list | Waiting on step 1 |
| 4 | Write exact messages, each claim tied to a source | `drafts/` with one file per recipient | Waiting on step 2 |
| 5 | Owner reviews every draft | Approve or reject marks in `REVIEW.md` | Waiting on step 4 |
| 6 | Stop. Nothing is sent, scheduled or followed up | — | Held |

Roles: the local agent researches and writes. No tool sends or records sends on this route.

Leaving drafts only requires the owner to save a new route in `SEND-ROUTE.md`.
