# Codistan Sales Automation

Internal opportunity intelligence platform for Codistan.

The objective is to identify, qualify, score, and route high-value opportunities from Upwork, LinkedIn/Sales Navigator, and future lead sources. The system should prioritize early action for warm opportunities, recommend the right Codistan profile/portfolio, and prepare human-approved outreach or proposal drafts.

## Core principle

Do not build an unsafe scraping or auto-spam tool. Build a compliant sales intelligence and decision-support system:

- Capture leads from approved/safe sources.
- Run warm lead checks frequently, initially every 30 minutes.
- Score leads using Codistan-specific qualification criteria.
- Alert humans when timing matters.
- Recommend profile, portfolio proof, positioning, and draft response.
- Keep final sending/bidding human-approved.

## Planning docs

- [`docs/BACKLOG.md`](docs/BACKLOG.md) — full epic and task backlog.

## Initial MVP focus

1. Upwork opportunity ingestion and scoring.
2. LinkedIn/Sales Navigator warm signal capture and scoring.
3. Codistan portfolio/profile matching.
4. Human-approved proposal/outreach draft generation.
5. Real-time alerting for high-score opportunities.
6. Dashboard and status tracking.
