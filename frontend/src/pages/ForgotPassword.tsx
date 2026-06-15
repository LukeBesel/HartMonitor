import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Activity, ArrowRight, ChevronLeft, MailCheck } from 'lucide-react';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);

  const inputClass = 'w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError('Please enter your email address'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await api.forgotPassword(email.trim());
      setDevUrl(res.dev_reset_url ?? null);
      setSent(true);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link to="/login" className="inline-flex items-center gap-1.5 text-blue-300/70 hover:text-blue-200 text-sm mb-6 transition-colors">
          <ChevronLeft size={16} /> Back to sign in
        </Link>

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 shadow-lg mb-4">
            <Activity size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Reset your password</h1>
          <p className="text-blue-300 text-sm mt-1">We'll email you a secure reset link</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-8 py-8">
            {sent ? (
              <div className="text-center space-y-4">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-50 text-green-600">
                  <MailCheck size={28} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Check your inbox</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    If an account exists for <span className="font-medium text-gray-700">{email.trim()}</span>,
                    we've sent a link to reset your password. It expires in 1 hour.
                  </p>
                </div>
                {devUrl && (
                  <div className="text-left rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-xs font-semibold text-amber-700 mb-1">Email isn't configured on this server</p>
                    <p className="text-xs text-amber-700/80 mb-2">Use this one-time link to continue:</p>
                    <a href={devUrl} className="text-xs font-medium text-blue-600 hover:underline break-all">{devUrl}</a>
                  </div>
                )}
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center gap-2 w-full py-3 rounded-xl text-white font-semibold text-sm transition-all"
                  style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}
                >
                  Back to sign in <ArrowRight size={14} />
                </Link>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <p className="text-sm text-gray-500">
                  Enter the email address associated with your account and we'll send you a link to set a new password.
                </p>
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
                {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-all"
                  style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}
                >
                  {loading ? 'Sending…' : <><span>Send reset link</span><ArrowRight size={14} /></>}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
