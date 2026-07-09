# Qualified Lead Engine

## MVP objective

Find, qualify, score, and route useful Codistan opportunities from Upwork and LinkedIn/Sales Navigator as quickly as possible.

The first useful version must help the BD team answer:

1. Which opportunities should we act on now?
2. Which prospects are worth researching?
3. Which Codistan profile, service line, and proof should we use?
4. What should a human review before outreach or bidding?

## Source model

### Upwork warm leads

Approved input paths:

- Upwork job alert email text
- saved-search/digest email text
- manual Upwork job URL/text submission
- official API only if approved later

Not allowed:

- auto-bidding
- credential sharing
- scraping private Upwork data
- submitting proposals without human approval

### LinkedIn warm leads

Approved input paths:

- public/manual post text
- LinkedIn notification text pasted by a human
- Sales Navigator alert text pasted by a human
- existing network/referral notes pasted by a human

Warm examples:

- founder asks for an AI partner
- company posts hiring/implementation intent
- visible operational pain or software need
- referral or inbound signal

Not allowed:

- LinkedIn scraping
- auto-DM
- fake accounts
- bulk outbound messaging

### LinkedIn/Sales Navigator cold prospects

Approved input paths:

- manually researched target account
- manually researched decision maker
- Sales Navigator saved-search/account signal captured by a human
- manually verified business context

Cold prospects should normally start as `needs_research` before they become `approved_to_contact`.

## Qualification dimensions

Each lead/prospect is evaluated across:

- service fit
- buyer quality
- budget or ROI potential
- timing/urgency
- portfolio proof match
- competition/access risk
- compliance and safety

## BD saved views

Core views:

- Hot Leads
- Warm Leads
- Cold Prospects
- Contact Ready
- Hot Upwork Now
- Hot LinkedIn Warm Posts
- AI Automation Leads
- Needs Research
- Needs Human Review
- Overdue Hot Leads

## Human approval boundary

The system may prepare internal drafts, profile routing, and portfolio proof.

The system must not:

- send emails automatically
- submit Upwork proposals automatically
- send LinkedIn DMs automatically
- scrape LinkedIn or Upwork
- modify Gmail messages

## Practical next step

The next product step is real source input readiness:

1. Upwork email/manual input path.
2. LinkedIn/Sales Navigator manual signal input path.
3. Cold prospect manual research input path.
4. BD review workflow from `needs_research` to `approved_to_contact`.
