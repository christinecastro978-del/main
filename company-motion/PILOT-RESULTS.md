# Pilot results: HELD, simulated status only

Date: 2026-11-17. Route: Drafts only (`SEND-ROUTE.md`).

**No provider result exists.** Nothing was released, accepted or sent. This table records local preparation status, not provider outcomes.

## Release preconditions (local check)
| Precondition | Result |
|---|---|
| Owner YES for this exact cohort version | MISSING |
| Self-test Sent and received | MISSING (canary HOLD; 0 Sent threads found) |
| Original prospect keys or manifest | MISSING |
| Exclusions refreshed within 60 minutes, bookings within 20 | NOT RUN: no history, opt-out or booking source |
| Prospect email addresses, validated | MISSING (0 of 10) |
| Sender or provider | NONE (Drafts only) |
| Draft cohort unchanged | PASS: sha256 `d74d7b1acb422366321c01ff2a2d11eb8ff8dc4145126af00068105c28c1df93` |

Lifetime cap (1 self-test plus 10 prospects): 0 used, 11 remaining. No attempt recorded.

## Per company
| Company | Draft | Pilot status | Reason |
|---|---|---|---|
| A Security | Not written | HELD | Sources disagree on country and the official site states none; held, not guessed |
| Cantina | Written | HELD (prepared, not sent) | No address, no approval, no self-test Sent match, no sender |
| Way Security | Not written | HELD | HQ country is not stated anywhere; 'founded in Israel' does not establish HQ |
| Cogent Security | Written | HELD (prepared, not sent) | No address, no approval, no self-test Sent match, no sender |
| Oligo Security | Written | HELD (prepared, not sent) | No address, no approval, no self-test Sent match, no sender |
| MIND | Written | HELD (prepared, not sent) | No address, no approval, no self-test Sent match, no sender |
| Tines | Written | HELD (prepared, not sent) | No address, no approval, no self-test Sent match, no sender |
| Adaptive Security | Written | HELD (prepared, not sent) | No address, no approval, no self-test Sent match, no sender |
| Port | Written | HELD (prepared, not sent) | No address, no approval, no self-test Sent match, no sender |
| Zenity | Written | HELD (prepared, not sent) | No address, no approval, no self-test Sent match, no sender |

Counts: prepared 8; held 10 of 10; accepted 0; Sent 0; unknown 0. No buyer was substituted. No Gmail labels applied.

## Live evidence still missing
Saved sending route; validated prospect and self-test addresses; manifest with original keys; owner YES for this exact version; self-test Sent plus receipt; fresh exclusion, history and booking reads; then, per prospect, a native Sent ID and a label readback.

## Results read, 2026-11-17: no native activity exists

No original keys, provider or container IDs, message IDs, thread IDs or send timestamps exist: nothing was imported or submitted on the Drafts-only route. No container exists to pause. No send or import was repeated.

| Count | Value | Evidence |
|---|---|---|
| Prepared (drafts) | 8 | `PROSPECT-DRAFTS.json` |
| Held | 10 of 10 prospects, plus the self-test | This file; `CANARY.md` |
| Queued | 0 | No provider |
| Accepted | 0 | No provider |
| Sent (exact) | 0 | Gmail Sent search returned 0 threads (`CANARY.md`) |
| Received | 0 | — |
| Bounced | 0 | — |
| Replied | 0 | Nothing sent |
| Booked | 0 | Nothing sent |
| Unknown commitments | 0 | No submission attempted |

Reconciliation: 0 of 11 original keys exist, so there is nothing to reconcile. The full 10-prospect send is not done: 0 exact Sent matches out of 10.

## Next action (one, evidence-supported)
Owner reviews the 8 drafts in `EMAIL-PREVIEWS.md` (approve, edit or reject). Evidence: the drafts exist with the hash `d74d7b1a…`, and every release precondition above fails first on missing owner review and a missing sending route.
