import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock fetch globally for tests
global.fetch = vi.fn();

// Mock window.matchMedia (used by some components)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver. This has to be a real class: components call
// `new ResizeObserver(cb)`, and an arrow-function mock is not constructible —
// it throws before the component ever renders.
class MockResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
global.ResizeObserver = MockResizeObserver;

// Suppress console.error in tests (uncomment if tests are noisy)
// const originalError = console.error;
// beforeAll(() => { console.error = vi.fn(); });
// afterAll(() => { console.error = originalError; });
