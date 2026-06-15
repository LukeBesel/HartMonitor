import { useState, useEffect, FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import type { SSOProviderInfo } from '../types';
import { Activity, Eye, EyeOff, ArrowRight, Building2, ChevronLeft, Globe, Square } from 'lucide-react';

const DEMO_ACCOUNTS = [
  { label: 'Developer (full access)', email: 'admin@hartmonitor.demo', password: 'Admin123!', color: 'bg-purple-100 text-purple-700' },
  { label: 'Manager', email: 'manager@hartmonitor.demo', password: 'Manager123', color: 'bg-blue-100 text-blue-700' },
  { label: 'Operator (limited)', email: 'operator@hartmonitor.demo', password: 'Operator123', color: 'bg-green-100 text-green-700' },
  { label: 'Viewer (read only)', email: 'demo@hartmonitor.demo', password: 'demo', color: 'bg-gray-100 text-gray-700' },
];

export default function Login() {
  const { login, signup } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<'signin' | 'signup'>(searchParams.get('mode') === 'signup' ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ssoProviders, setSsoProviders] = useState<SSOProviderInfo[]>([]);

  useEffect(() => {
    api.getSSOProviders()
      .then(providers => setSsoProviders(providers || []))
      .catch(() => setSsoProviders([]));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoError = params.get('sso_error');
    if (ssoError !== null) {
      let message = 'Single sign-on failed. Please try again or use your email and password.';
      try {
        const decoded = decodeURIComponent(ssoError).trim();
        if (decoded) message = decoded;
      } catch {
        // ignore decode errors, fall back to generic message
      }
      setError(message);
      params.delete('sso_error');
      const newSearch = params.toString();
      const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  const switchMode = (m: 'signin' | 'signup') => {
    setMode(m);
    setError('');
  };

  const doLogin = async (e?: FormEvent, prefill?: { email: string; password: string }) => {
    if (e) e.preventDefault();
    const creds = prefill ?? { email, password };
    if (!creds.email || !creds.password) { setError('Please enter email and password'); return; }
    setError('');
    setLoading(true);
    try {
      await login(creds.email, creds.password);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const doSignup = async (e: FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) { setError('Please enter your company name'); return; }
    if (!displayName.trim()) { setError('Please enter your name'); return; }
    if (!email || !password) { setError('Please enter email and password'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    setError('');
    setLoading(true);
    try {
      await signup(companyName.trim(), displayName.trim(), email, password);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  const quickLogin = (acct: typeof DEMO_ACCOUNTS[0]) => {
    setEmail(acct.email);
    setPassword(acct.password);
    doLogin(undefined, acct);
  };

  const inputClass = 'w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Back to marketing site */}
        <Link to="/" className="inline-flex items-center gap-1.5 text-blue-300/70 hover:text-blue-200 text-sm mb-6 transition-colors">
          <ChevronLeft size={16} /> Back to home
        </Link>
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 shadow-lg mb-4">
            <Activity size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">HartMonitor</h1>
          <p className="text-blue-300 text-sm mt-1">Manufacturing Execution System</p>
        </div>

        {/* Auth card */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-8 py-8">
            {/* Mode toggle */}
            <div className="flex rounded-xl bg-gray-100 p-1 mb-6">
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${mode === 'signin' ? 'bg-white text-gray-900 shadow' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${mode === 'signup' ? 'bg-white text-gray-900 shadow' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Create Company
              </button>
            </div>

            {mode === 'signin' ? (
              <form onSubmit={doLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Email address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className={inputClass}
                    placeholder="you@company.com"
                    autoFocus
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-medium text-gray-700">Password</label>
                    <Link to="/forgot-password" className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline">
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className={`${inputClass} pr-10`}
                      placeholder="••••••••"
                    />
                    <button type="button" onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-all"
                  style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}
                >
                  {loading ? 'Signing in…' : <><span>Sign In</span><ArrowRight size={14} /></>}
                </button>
              </form>
            ) : (
              <form onSubmit={doSignup} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Company name</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={companyName}
                      onChange={e => setCompanyName(e.target.value)}
                      className={`${inputClass} pl-10`}
                      placeholder="Acme Manufacturing"
                      autoFocus
                    />
                    <Building2 size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Your name</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    className={inputClass}
                    placeholder="Jane Smith"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Email address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className={inputClass}
                    placeholder="you@company.com"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                    <div className="relative">
                      <input
                        type={showPw ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className={`${inputClass} pr-9`}
                        placeholder="8+ characters"
                      />
                      <button type="button" onClick={() => setShowPw(!showPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm</label>
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className={inputClass}
                      placeholder="••••••••"
                    />
                  </div>
                </div>
                {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-all"
                  style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}
                >
                  {loading ? 'Creating workspace…' : <><span>Create Workspace</span><ArrowRight size={14} /></>}
                </button>
                <p className="text-xs text-gray-400 text-center">
                  Free plan includes 5 production apps & 2 dashboards — no credit card required. You become the owner.
                </p>
                <p className="text-xs text-gray-400 text-center">
                  By creating a workspace you agree to our{' '}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Terms</a>{' '}
                  and{' '}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Privacy Policy</a>.
                </p>
              </form>
            )}

            {/* SSO providers */}
            {mode === 'signin' && ssoProviders.length > 0 && (
              <div className="mt-5 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-xs text-gray-400 uppercase tracking-wider">or continue with</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
                <div className="space-y-2">
                  {ssoProviders.map(provider => {
                    const Icon = provider.id === 'microsoft' ? Square : Globe;
                    return (
                      <a
                        key={provider.id}
                        href={`/api/auth/sso/${provider.id}/start`}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700"
                      >
                        <Icon size={16} className="text-gray-500" />
                        <span>Continue with {provider.name}</span>
                        {provider.mode === 'demo' && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
                            Demo
                          </span>
                        )}
                      </a>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Demo accounts */}
          {mode === 'signin' && (
            <div className="px-8 pb-8 border-t border-gray-100 pt-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Try a demo account</p>
              <div className="space-y-2">
                {DEMO_ACCOUNTS.map(acct => (
                  <button key={acct.email} onClick={() => quickLogin(acct)}
                    className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-gray-100 hover:border-blue-200 hover:bg-blue-50 transition-all text-left group">
                    <div>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${acct.color} mr-2`}>{acct.label}</span>
                    </div>
                    <ArrowRight size={12} className="text-gray-300 group-hover:text-blue-400 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-blue-400 text-xs mt-6">
          HartMonitor Demo · All data resets on container restart
        </p>
      </div>
    </div>
  );
}
