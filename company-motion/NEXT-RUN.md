# Next run (reusable prompt, Drafts-only route)

Saved 2026-11-17. Paste the block below into your local agent to run the next cycle. It is manual and drafts-only. It does not authorize another cohort, a sender, reply sends or any schedule.

```
Work in company-motion/. Read SEND-ROUTE.md first. If the route is not
"Drafts only", stop and follow that route's own instructions instead.

1. Read the current state before anything else:
   ANSWERS.md, EXCLUSIONS.md, ACCOUNTS.json, PEOPLE.json, PROSPECT-DRAFTS.json,
   PILOT-REVIEW.md, CANARY.md, PILOT-RESULTS.md, REPLY-REVIEW.md, WAITS.md,
   PROGRESS.md.
   Confirm: 0 sends, 0 provider keys, 0 of the 11-email lifetime cap used.
   If any file shows a send, a reply, an opt-out, a booking or an unknown
   result, stop and report it. Do not continue.

2. Refresh facts, read-only:
   - Gmail: search mail to and from every target domain for replies,
     opt-outs or history. Record thread IDs. Never send.
   - Calendar: search for target names. Report the coverage you actually
     read; never call an unread calendar empty.
   - Re-check each company's stage, country and CEO on official pages.
     A changed fact puts that row on hold until the owner reviews it.
   - Keep every exclusion and every owner hold (A Security, Way Security).

3. Apply the owner's draft review from REVIEW.md: approve, edit or reject.
   Edit only drafts the owner marked for edits, using
   skills/outbound-email/SKILL.md. Recompute the draft hash and note
   that it changed.

4. Save the results in PROGRESS.md (artifact, check, next task) and
   update WAITS.md. Show the result and stop.

Never: import into a provider, send, schedule, follow up, swap in a held
buyer, validate addresses with paid tools without owner approval, or reset
or rewrite earlier attempts and history.
```

## State readback (2026-11-17)
- Original keys: none exist; nothing was imported or submitted.
- Pilot: 8 drafts (hash `d74d7b1a…`), 10 of 10 prospects held, self-test not prepared, 0 of 11 cap used.
- Extra skill-test draft: Tailscale (`SKILL-TEST.md`), unsent and not in the pilot.
- Exclusions: 7 companies (`EXCLUSIONS.md`). Owner holds: A Security (country conflict; owner chose held, not excluded), Way Security (country unknown).
- History: Gmail found 1 non-pilot thread (A Security declined a job application, 2026-07-06); 0 opt-outs. Calendar: 0 events found, partial coverage.
- Bookings: none found; only the primary calendar was read.

## Missing access and setup (named)
1. A sending route other than Drafts only (Gmail, Instantly or Apollo), chosen by the owner.
2. A sender tool: no `gtm.py`, `code/` folder, `PROVIDER-ROUTE-GUIDE.md` or export script exists in this repo.
3. ZeroBounce (or another approved validator) and owner approval for paid calls.
4. The owner's self-test address.
5. Current sources for customers, open deals, opt-outs and bookings: a Calendly export or calendar access beyond the primary calendar. The GTM Radar CRM has blank history columns.
6. Two correct manual cycles (self-test plus pilot) completed and verified before any schedule is considered. None has run.

Runtime: no native container exists, and the Gmail runtime has never run; both stay paused. No schedule is installed. Gifts, social and ads are not enabled.

## One next local task
Owner reviews the 8 drafts in `EMAIL-PREVIEWS.md`, marks approve, edit or reject in `REVIEW.md`, and confirms the HYPR and Morphisec line.
