# High-intent Discovery Campaigns

Automated public-search discovery uses service-specific campaign packs instead of broad agency or technology keywords.

## Default campaigns

- `ai_rag_automation`
- `custom_software_saas`
- `white_label_agency`
- `cybersecurity_compliance`
- `immersive_3d_ar_vr`
- `digital_marketing_web`

Queries are interleaved round-robin so the configured query limit gives every active campaign coverage before a second query is taken from any campaign.

## Production configuration

Set `PROSPECT_CAMPAIGN_IDS` in Vercel to a comma-separated subset when a narrower campaign is required. Leaving it blank runs all safe defaults.

Examples:

```text
PROSPECT_CAMPAIGN_IDS=ai_rag_automation,custom_software_saas,white_label_agency
```

```text
PROSPECT_CAMPAIGN_IDS=cybersecurity_compliance
```

`PROSPECT_SEARCH_QUERIES` remains an expert override. When populated, it replaces campaign-generated queries and should therefore be changed only after adding valid and invalid regression examples.

## Quality rules

Every generated query includes:

- explicit RFP, vendor, agency, implementation, outsourcing or partner intent;
- job, salary, resume and career exclusions;
- guide, tutorial, course, directory and general-content exclusions;
- blocked reference/content hosts including Wikipedia and IMDb.

The result-level quality gate remains mandatory. Search-query wording alone cannot cause a result to qualify.

RemoteOK is disabled by default in the production cron and should not be enabled as a direct sales source. Greenhouse and Lever remain research signals only when explicitly configured.

## Run evidence

Each final discovery run records:

- active campaign IDs;
- generated query count;
- closeability rescore count;
- accepted/new/duplicate counts already produced by the core runner.

The wrapper persists the final enriched run metadata after campaign selection and rescoring.
