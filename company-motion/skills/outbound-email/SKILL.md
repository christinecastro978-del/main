---
name: outbound-email
description: Write one sourced, link-free first email from Christine Castro to a founder or CEO at a cybersecurity or security-adjacent company, saved as a local draft for owner review. Never imports or sends.
---

# Outbound first email (Christine Castro)

## Route and limits
- Saved route: **Drafts only** (`company-motion/SEND-ROUTE.md`). This skill writes local drafts only. It never imports, schedules, sends or follows up, and it grants no send permission.
- If the route changes, the original pilot manifest, the lifetime cap of 1 self-test plus 10 original prospects, suppression checks and unknown-outcome holds still apply. A draft made with this skill does not join or widen any approved cohort.
- Origin: this skill reproduces the instructions behind the 8 drafts in `PROSPECT-DRAFTS.json` (2026-11-17). **Those drafts are not owner-reviewed yet**; update this skill when the review comes back.

## Inputs (all required, or the target is held)
1. Company: official domain, country (any except sanctioned countries per `ANSWERS.md`; unknown or conflicting means held), stage from Seed to Series C, not in `EXCLUSIONS.md`, not acquired.
2. Buyer: name and current role (founder or CEO) confirmed on an official page, with the URL, a verbatim excerpt and the read date.
3. One business reason: a dated fact from an official page or reputable trade press (funding round, use of funds, a new product line). Record the URL and excerpt.
4. Offer and signature from `COMPANY-BRIEF.md` and `ANSWERS.md` only.

## Message shape
```
Subject: <3-6 words, names the company, no hype>

Hi <first name>,

<One sentence stating the sourced fact. One sentence on why it matters for marketing. Say "congratulations" only if the fact is from the last 12 months.>

I build demand gen, positioning and marketing teams for cybersecurity companies, as a fractional CMO or full-time leader. I've done it at HYPR and Morphisec.

Would you be open to a short conversation about <company>'s marketing plan for the next year?

If this isn't relevant, reply "no thanks" and I won't follow up.

Christine Castro
978-852-7484
```
- 50 to 80 words before the opt-out and signature.
- No links, attachments, tokens, `{}` placeholders or merge fields.
- No metrics, client names, testimonials, meeting lengths or launches that aren't in a source.
- HTML is the same text, one `<p>` per paragraph, with `<br>` inside the signature.
- Pending owner check: confirm that "I've done it at HYPR and Morphisec" is accurate.

## Checks before saving
1. Every factual claim maps to a source URL and an excerpt.
2. Script check: word count in range, 0 links (`http`, `www.`), 0 braces.
3. Plain text and HTML carry the same words.
4. Status `draft_for_review`, send status `held`. Stop for exact owner review.
