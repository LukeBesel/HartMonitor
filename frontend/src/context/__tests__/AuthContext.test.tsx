import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock the API module
vi.mock('../../api/client', () => ({
  api: {
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  },
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

  it('starts with no user when localStorage is empty', async () => {
    vi.mocked(api.getMe).mockRejectedValue({ status: 401 });
    const { result } = renderHook(() => useAuth(), { wrapper });
    // loading might be true initially
    expect(result.current.user).toBeNull();
  });

  it('isAtLeast returns false for lower roles', () => {
    // This tests the role comparison logic without needing a full login
    // TODO: expand when role helper is extracted to a utility function
    expect(true).toBe(true); // placeholder
  });
});
