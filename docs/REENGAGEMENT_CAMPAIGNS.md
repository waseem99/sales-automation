# Re-engagement Campaigns

The protected workspace is available at `/api/re-engagement` for Admin and Waseem.

## Supported relationship types

- previous client;
- existing-account cross-sell;
- dormant proposal;
- agency partner;
- referral partner.

## Core rules

A prior relationship increases trust but does not prove a current buying requirement.

- Previous clients and existing accounts receive a high relationship-strength signal.
- Dormant proposals and agency partners receive a medium signal.
- Referral partners begin as developing relationships.
- A record becomes a live opportunity only when the supplied current signal contains explicit buyer-side project, vendor, implementation or procurement intent.
- A cross-sell hypothesis alone remains a partnership/research target.

## Privacy and proof

Prior engagement summaries, internal notes and previously delivered services are stored under an internal-only re-engagement payload. They are not copied into the public lead description or outbound wording.

Only proof from the approved managed portfolio catalog may be recommended. If no safe proof matches, the system records a research gap rather than inventing a client result.

## Deduplication

The workflow checks, in order:

1. official organization domain;
2. normalized organization name;
3. supplied evidence URL.

When a match exists, the existing prospect is updated and rescored rather than duplicated. Final/archived records are reopened to human review only when a new re-engagement entry is saved.

## Contact and follow-up

- Personal email providers cannot be stored as verified business routes.
- When an official website is supplied, the business email must match its domain.
- An owner and follow-up time may be set during intake.
- No email, message, proposal or application is sent automatically.
- Every generated brief requires human approval.

## Recommended operating rhythm

Review previous clients, dormant proposals and partner relationships weekly. Add only records with a documented relationship history. Keep records without a current buying signal in research/nurture until the account owner confirms a timely need.
