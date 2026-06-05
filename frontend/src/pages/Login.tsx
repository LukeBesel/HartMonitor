import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Activity, Eye, EyeOff, ArrowRight } from 'lucide-react';

const DEMO_ACCOUNTS = [
  { label: 'Developer (full access)', email: 'admin@hartmonitor.demo', password: 'Admin123!', color: 'bg-purple-100 text-purple-700' },
  { label: 'Manager', email: 'manager@hartmonitor.demo', password: 'Manager123', color: 'bg-blue-100 text-blue-700' },
  { label: 'Operator (limited)', email: 'operator@hartmonitor.demo', password: 'Operator123', color: 'bg-green-100 text-green-700' },
  { label: 'Viewer (read only)', email: 'demo@hartmonitor.demo', password: 'demo', color: 'bg-gray-100 text-gray-700' },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const doLogin = async (e?: FormEvent, prefill?: { email: string; password: string }) => {
    if (e) e.preventDefault();
    const creds = prefill ?? { email, password };
    if (!creds.email || !creds.password) { setError('Please enter email and password'); return; }
    setError('');
    setLoading(true);
    try {
      await login(creds.email, creds.password);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const quickLogin = (acct: typeof DEMO_ACCOUNTS[0]) => {
    setEmail(acct.email);
    setPassword(acct.password);
    doLogin(undefined, acct);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 shadow-lg mb-4">
            <Activity size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">HartMonitor</h1>
          <p className="text-blue-300 text-sm mt-1">Manufacturing Execution System</p>
        </div>

        {/* Login card */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-8 py-8">
            <h2 className="text-xl font-semibold text-gray-800 mb-6">Sign in to your account</h2>
            <form onSubmit={doLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  placeholder="you@company.com"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm pr-10"
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
          </div>

          {/* Demo accounts */}
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
        </div>

        <p className="text-center text-blue-400 text-xs mt-6">
          HartMonitor Demo · All data resets on container restart
        </p>
      </div>
    </div>
  );
}
