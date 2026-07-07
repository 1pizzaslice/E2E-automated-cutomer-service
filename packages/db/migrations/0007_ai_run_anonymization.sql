-- Milestone 17: AI-run anonymization marker (BACKEND_SPEC section 22).
-- The retention job nulls the PII-bearing ai_runs columns
-- (structured_output, guardrail_results) for runs older than the tenant's
-- ai_run_days window and stamps anonymized_at so re-runs skip already
-- anonymized rows. Run metadata (status, tokens, latency, provenance) is
-- retained for reporting.
alter table ai_runs
  add column if not exists anonymized_at timestamptz;
