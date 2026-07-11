/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

// The console is a static SPA served by Caddy in the hardened profile
// (Milestone 23). `base` stays "/" — the reverse proxy serves it at the site
// root and rewrites unknown paths to index.html for client-side routing.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { outDir: "dist", sourcemap: true },
  test: {
    // Default to Node so the Milestone 20 contract-proof test (which boots the
    // real Fastify app via inject) is unaffected; component tests opt into
    // jsdom with a `// @vitest-environment jsdom` docblock.
    environment: "node",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
