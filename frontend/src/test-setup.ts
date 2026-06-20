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

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Suppress console.error in tests (uncomment if tests are noisy)
// const originalError = console.error;
// beforeAll(() => { console.error = vi.fn(); });
// afterAll(() => { console.error = originalError; });
