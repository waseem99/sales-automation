# Seller Funnel Analytics

`@sales-automation/funnel-analytics` provides the append-only `seller-funnel.v1` contract for captured, technically valid, qualified, human-reviewed, accepted, manually contacted, replied, meeting, proposal and won/lost stages.

System code may record only the first three internal stages. Human review is required for review and acceptance. Contact, reply, meeting and proposal events require explicit human evidence or a separately approved confirmation integration; they are never inferred from recommendations or timestamps.

Every event retains source, campaign, offer, model version, owner, actor, reason, timestamp, transition kind and a deterministic SHA-256 event hash. Analytics reconcile directly from these immutable events.
