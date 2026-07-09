# First MVP Evaluation Flow

This document describes the first useful sales intelligence flow for Codistan.

## Input

A lead can enter the system from:

- Manual submission.
- Upwork job alert/email.
- LinkedIn/Sales Navigator alert.
- Partner prospecting research.
- Solution-led campaign research.

For Sprint 1, sample leads are available in `@sales-automation/fixtures`.

---

## Flow

### 1. Normalize Lead

Each opportunity becomes a `Lead` object with:

- Source.
- Lead type.
- Title.
- Description.
- Service category.
- Budget signal.
- Timeline signal.
- Captured time.
- Freshness.
- Pipeline status.

### 2. Detect Red Flags

The evaluator checks for common disqualifiers:

- Free/unpaid sample requests.
- Very low budget.
- Unrealistic clone/timeline requests.
- US-only ambiguity.
- Restricted or high-risk industry language.

### 3. Match Portfolio

The portfolio matcher compares the lead against Codistan proof items using:

- Service category.
- Industry.
- Tags.
- Proof confidentiality level.
- Whether assets or links are available.
- Whether a business outcome is documented.

### 4. Score Lead

The scoring engine calculates a 0-100 score using:

- Service fit.
- Buyer quality.
- Budget/ROI.
- Timing/freshness.
- Portfolio proof match.
- Competition/access risk.
- Compliance safety.
- Red flag penalties.

### 5. Recommend Profile

The routing engine recommends the best sales/profile identity:

- US AI/full-stack profile.
- Waseem AI/founder-led profile.
- AR/3D/animation profile.
- Cybersecurity/compliance profile.
- Codistan partner identity.
- Solution campaign identity.
- Needs human review.

### 6. Recommend Next Action

The evaluator returns a clear action:

- Review immediately.
- Add to qualified queue.
- Send to human review.
- Add to nurture/watch queue.
- Reject/archive.

---

## Current Output

The end-to-end evaluator returns:

```ts
{
  lead,
  score,
  profileRecommendation,
  portfolioMatches,
  recommendedNextAction
}
```

---

## Next Build Step

The next layer should be a manual lead input API or CLI that accepts a pasted opportunity and returns the evaluation result.

After that, add:

1. Sample evaluation runner.
2. Tests.
3. Upwork email parser.
4. Draft generator.
5. Hot alert interface.
