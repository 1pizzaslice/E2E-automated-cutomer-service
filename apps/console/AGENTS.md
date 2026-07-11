# apps/console — Reviewer Console

The reviewer console (ADR-0026, ADR-0028). `packages/api` is its backend — there
is no BFF. It is a **static Vite + React 19 SPA**: `vite build` emits `dist/`,
Caddy serves it and falls back to `index.html` for client-side routing. The
Milestone 20 contract proof (`src/review-flow.ts` + its test) still drives
login → queue → evidence → decide purely through `@support/api-client`, and the
Milestone 23 UI is built on the same client.

## Toolchain

- `pnpm --filter @support/console dev` (Vite dev server), `build` (`vite build`),
  `test` (vitest: node-default env; component tests opt into jsdom via a
  `// @vitest-environment jsdom` docblock), `test:e2e:console` (Playwright,
  **out of** root `pnpm test`), `typecheck`/`lint` (`tsc --noEmit`).
- Env vars (baked into the static bundle, none secret): `VITE_API_BASE_URL`
  (empty = same-origin) and `VITE_CLERK_PUBLISHABLE_KEY` (empty = the dev
  token-auth provider).

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
- The UI framework is **Vite + React 19** (ADR-0028). Reach for a new dependency
  only when the reviewer loop needs it; keep the app a static SPA (no BFF).
- Browser/e2e tests (Milestone 23) run behind `test:e2e:console`, kept out of
  the root `pnpm test` (which requires `uv`). The Milestone 20 slice test is a
  plain Node/vitest test and may run in the root suite.
