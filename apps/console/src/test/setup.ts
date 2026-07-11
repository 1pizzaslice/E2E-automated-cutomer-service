// Registers @testing-library/jest-dom matchers (toBeInTheDocument, etc.) on
// vitest's expect. Harmless under the default node environment — component
// tests that render DOM opt into jsdom with a `// @vitest-environment jsdom`
// docblock; @testing-library/react's auto-cleanup runs via the global afterEach
// (test.globals is enabled in vite.config.ts).
import "@testing-library/jest-dom/vitest";
