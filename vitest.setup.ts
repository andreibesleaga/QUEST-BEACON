// BEACON — Vitest global setup. Registers @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
// for the happy-dom component tests. Harmless in the node-env backend tests (matchers activate only on use).
import '@testing-library/jest-dom/vitest';
