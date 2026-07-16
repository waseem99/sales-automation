# Acquisition Worker Architecture

Issue: #200  
Parent epic: #198

## Boundary

The Python worker runs on a local workstation or dedicated worker. Vercel remains the review/API surface. The worker package is not referenced by `vercel.json`, the pnpm workspace or any production function.

## Flow

1. A user bootstraps a persistent, authorized Chromium profile outside the repository.
2. A source adapter reads a configuration-driven segment.
3. The adapter emits normalized `SourceEvidence` with the original URL and capture time.
4. Validation rejects incomplete records.
5. Deterministic deduplication prevents repeated ingestion.
6. A checkpoint is written atomically after each accepted record.
7. Dry-run writes reviewable JSONL.
8. A future approved HTTP boundary may ingest records into #204 qualification.
9. All external communication remains human-reviewed and manually executed.

## Current implementation

- shared evidence/opportunity/run-summary models;
- TOML configuration loader;
- fixture HTML adapter for regression testing;
- deterministic source-ID/URL deduplication;
- atomic JSON checkpoint recovery;
- JSONL dry-run sink;
- optional token-authenticated HTTP ingestion sink;
- Playwright persistent Chromium bootstrap;
- sensitive-field and log redaction;
- standard-library unit tests.

## Source adapter contract

Source-specific work in #201/#202/#203 must implement:

```python
class AcquisitionAdapter(Protocol):
    adapter_id: str
    def collect(self, *, limit: int, enabled_segments: set[str]) -> Iterable[SourceEvidence]: ...
```

Adapters must not submit proposals, send messages or bypass account protections.

## Follow-on work

- #204: evidence-based qualification and business-unit routing;
- #201: Upwork saved-search adapter and pilot;
- #202: Sales Navigator research adapter;
- #203: website and buying-trigger audit adapter;
- #205: human-reviewed draft generation;
- #206: commercial calibration.
