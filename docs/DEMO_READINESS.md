# Demo Readiness Checklist

This checklist keeps the Codistan Lead Desk MVP focused on a visible, safe, human-approved sales intelligence workflow.

## Local verification

Run from a fresh checkout of `main` or the current PR branch:

```bash
pnpm install
pnpm --filter @sales-automation/web dev
```

Open:

```text
http://localhost:3000
```

Verify:

- Dashboard loads.
- Summary cards render.
- Upwork sample fills the form.
- LinkedIn/Sales Navigator sample fills the form.
- **Evaluate lead** saves a lead locally.
- Saved lead appears in the opportunity list.
- Lead cards are clickable.
- Search/filter bar narrows the opportunity list.
- Saved-view chips work.
- Lead detail shows score, recommended Codistan profile, portfolio proof, draft preview, red flags, notes, and source evidence.
- **Copy draft for manual review** copies text only; it does not send anything.
- Status actions update the internal local pipeline only.
- Owner assignment updates the internal local pipeline only.
- Notes update the internal local pipeline only.
- **Reset local data** clears local JSON demo data only.

## Safety verification

Confirm the MVP still does not perform any unsafe automation:

- No LinkedIn scraping.
- No Upwork auto-bidding.
- No Upwork proposal submission.
- No LinkedIn auto-DM.
- No Gmail sending.
- No Gmail archive/delete/label modifications.
- No real external Slack/WhatsApp/email alert delivery.
- No paid enrichment by default.
- No contact/business email is treated as outreach-ready without human verification.

## Screenshot plan

Add screenshots only after running the app locally. Do not fabricate screenshots.

Recommended location:

```text
docs/assets/demo/
```

Recommended screenshots:

1. `01-dashboard-landing.png` — dashboard header and summary cards.
2. `02-evaluate-lead.png` — intake form and evaluation result.
3. `03-opportunity-list.png` — opportunity list, saved views, and filters.
4. `04-lead-detail.png` — lead detail with score, profile, proof, source evidence, draft, and red flags.
5. `05-review-actions.png` — status, owner, notes, copy draft, and reset controls.

## Demo script

1. Open the dashboard.
2. Explain that this is an internal sales intelligence tool, not a spam or scraping tool.
3. Click **Use Upwork sample**.
4. Click **Evaluate lead**.
5. Show the saved opportunity in the list.
6. Click the lead card.
7. Review score, recommended profile, matched portfolio proof, source evidence, and draft.
8. Copy the draft and clarify that sending remains human-approved.
9. Assign an owner and add a note.
10. Update internal pipeline status.
11. Use search/filter and saved views.
12. Reset local demo data if needed.

## Next after demo readiness

Only after this flow is stable:

1. Plan Gmail read-only runtime integration.
2. Decide production database path.
3. Decide production auth path.
4. Add one internal alert channel.
5. Prepare deployment checklist.
