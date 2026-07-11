/**
 * Root of the reviewer console (Milestone 23). Slice 1 is the framework
 * scaffold — a static shell that proves the Vite/React/vitest toolchain builds
 * and tests green under `pnpm -r build` / `pnpm -r test`. Slices 2-4 layer on
 * Clerk auth, permission-gated navigation, and the queue → evidence → decide
 * and QA surfaces, all against `@support/api-client`.
 */
export function App() {
  return (
    <main className="app-shell">
      <h1>Support Reviewer Console</h1>
      <p>Reviewer workspace for the support automation pilot.</p>
    </main>
  );
}
