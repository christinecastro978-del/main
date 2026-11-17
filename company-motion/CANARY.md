# Canary (self-test): HELD, not submitted

Date: 2026-11-17. Route: Drafts only (`SEND-ROUTE.md`).

**This is a simulated local preflight, not a provider result.** Nothing was submitted to Gmail, Instantly, Apollo or any other provider. No action key, intent record or native result exists.

## Simulated preflight (local files only)

| Check | Result |
|-------|--------|
| Saved route allows a sender | FAIL: Drafts only |
| Original manifest (`PROVIDER-MANIFEST.json` or `PILOT-ACTIONS.json`) | MISSING |
| Explicit owner approval for this version (`PILOT-APPROVAL.json`) | MISSING: none requested or given |
| Owned self-test row (sender equals recipient) | MISSING: not prepared in `PILOT-REVIEW.md` |
| Self-test address validated (receipt within 7 days) | MISSING |
| Exclusions refreshed within 60 minutes | NOT RUN: only the 7 confirmed companies in `EXCLUSIONS.md`; no live history or opt-out source |
| Booking review within 20 minutes | NOT RUN: no booking source connected |
| Prior commitments for the self-test (attempted, queued, sent, replied, booked, opted out, unknown) | UNKNOWN: no send log exists |
| Prospects held | PASS: all 10 held (no addresses) |
| Native one-step container, one sender, no follow-ups | NOT APPLICABLE: no provider on this route |
| Draft cohort unchanged since review file | PASS: sha256 `d74d7b1acb422366321c01ff2a2d11eb8ff8dc4145126af00068105c28c1df93` matches `PILOT-REVIEW.md` |

Decision: **HOLD**. Submitted: 0. Provider result: none.

## Live evidence still missing
1. A sending route saved by the owner (Gmail, Instantly or Apollo) and the matching tools: `gtm.py` or the provider guide and export script.
2. The owner's own self-test address, with a current validation receipt.
3. An original manifest containing the self-test key.
4. The owner's explicit release of that exact self-test.
5. A fresh exclusion, history and booking read, with original timestamps.
6. After a single submission: the native Sent record and the provider receipt.

## Sent check, 2026-11-17: NOT POSSIBLE (no original self-test)

There is no original self-test to match: the canary was never submitted, so it has no provider message ID, Sent record or receipt. No second self-test was created.

| Check | Result |
|-------|--------|
| Original self-test key or provider message ID | NONE: nothing was submitted |
| Native Sent record matching the approved preview | NONE |
| Owned recipient received the original email | NONE |
| Gmail label Agentic GTM/Part 2 | NOT APPLIED: Drafts-only route; no Sent message to label |
| Read-only Gmail Sent search: `in:sent newer_than:2d subject:(Series OR "next marketing stage" OR "Cantina's raise")` | 0 threads. Live read; it shows no draft subject was sent in the last 2 days |
| Prospects | HELD (10 of 10) |

Live evidence still missing: everything in "Live evidence still missing" above, plus the native Sent message ID, a recipient-side receipt and the label readback after a real self-test.
