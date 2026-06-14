import { useEffect } from 'react';

export default function SSOCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      window.location.href = '/login?sso_error=missing_token';
      return;
    }

    localStorage.setItem('hm_token', token);
    window.location.href = '/dashboard';
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="flex flex-col items-center gap-4 text-blue-200">
        <div className="w-10 h-10 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">Signing you in…</p>
      </div>
    </div>
  );
}
