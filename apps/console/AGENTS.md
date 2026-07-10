# apps/console — Reviewer Console

The reviewer console (ADR-0026). `packages/api` is its backend — there is no
BFF. The console UI itself is **Milestone 23**; Milestone 20 landed only the
contract proof (`src/review-flow.ts` + its test), which drives
login → queue → evidence → decide purely through `@support/api-client`.

## Reading path (scoped)

When working in this directory, load **only**:

1. This file.
2. The served OpenAPI document (`GET /openapi.json`, or `packages/api/src/openapi.ts`).
3. `packages/api-client` — the typed client (`SupportApiClient`) and its
   `API_ROUTES` manifest. Everything the console needs is here.

Do **not** load `docs/BACKEND_SPEC.md` or `docs/AI_RUNTIME_HARNESS.md`: the
console consumes the API contract, it does not implement it (docs/README.md,
ADR-0026). If the contract seems to be missing something, that is a
**Milestone 20 backend gap** to fix in `packages/api` — not something to work
around here.

## Rules

- All server calls go through `@support/api-client`. Never hand-roll `fetch`
  against `/v1/*`; if a route is missing from the client, add it there (and the
  route↔spec drift test will hold the client, the routes, and the OpenAPI doc
  in sync).
- Reviewer identity comes from the verified session token the client carries —
  never from a request body or a client-supplied user id.
- The UI framework is **not yet chosen** (Milestone 23 records it in an
  implementation ADR). Keep Milestone 20 code framework-free.
- Browser/e2e tests (Milestone 23) run behind `test:e2e:console`, kept out of
  the root `pnpm test` (which requires `uv`). The Milestone 20 slice test is a
  plain Node/vitest test and may run in the root suite.
