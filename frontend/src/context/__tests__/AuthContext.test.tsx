import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock Capacitor so tests run in jsdom without native APIs
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn().mockResolvedValue({ value: null }),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock the API module — include all named exports AuthContext uses
vi.mock('../../api/client', () => ({
  api: {
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    signup: vi.fn(),
  },
  setNativeToken: vi.fn(),
}));

import { AuthProvider, useAuth } from '../AuthContext';
import { api } from '../../api/client';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('starts with no user when getMe rejects', async () => {
    vi.mocked(api.getMe).mockRejectedValue({ status: 401 });
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.user).toBeNull();
  });

  it('isAtLeast returns false when not logged in', () => {
    vi.mocked(api.getMe).mockRejectedValue({ status: 401 });
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isAtLeast('viewer')).toBe(false);
  });
});
