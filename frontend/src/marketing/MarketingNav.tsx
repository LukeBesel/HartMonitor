import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const LINKS = [
  { label: 'Product', href: '/#product' },
  { label: 'Features', href: '/#features' },
  { label: 'Pricing', href: '/pricing' },
];

export default function MarketingNav() {
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-[#060911]/80 backdrop-blur-xl border-b border-white/10' : 'bg-transparent border-b border-transparent'
      }`}
    >
      <nav className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1, #ec4899)' }}>
            <Activity size={18} className="text-white" strokeWidth={2.4} />
          </span>
          <span className="text-white font-semibold text-lg tracking-tight">HartMonitor</span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          {LINKS.map(l => (
            <a key={l.label} href={l.href} className="text-sm text-gray-300 hover:text-white transition-colors">
              {l.label}
            </a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          {user ? (
            <Link
              to="/dashboard"
              className="text-sm font-semibold text-white px-4 py-2 rounded-full transition-all hover:opacity-90 glow-pink"
              style={{ background: 'linear-gradient(135deg, #6366f1, #ec4899)' }}
            >
              Open Dashboard
            </Link>
          ) : (
            <>
              <Link to="/login" className="text-sm text-gray-300 hover:text-white transition-colors">
                Sign in
              </Link>
              <Link
                to="/login?mode=signup"
                className="text-sm font-semibold text-white px-4 py-2 rounded-full transition-all hover:opacity-90 glow-pink"
                style={{ background: 'linear-gradient(135deg, #6366f1, #ec4899)' }}
              >
                Get started
              </Link>
            </>
          )}
        </div>

        <button className="md:hidden text-white" onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </nav>

      {menuOpen && (
        <div className="md:hidden bg-[#060911]/95 backdrop-blur-xl border-b border-white/10 px-6 py-4 space-y-3">
          {LINKS.map(l => (
            <a key={l.label} href={l.href} onClick={() => setMenuOpen(false)} className="block text-gray-300 hover:text-white py-1">
              {l.label}
            </a>
          ))}
          <div className="pt-3 border-t border-white/10 flex flex-col gap-2">
            {user ? (
              <Link to="/dashboard" className="text-center text-sm font-semibold text-white px-4 py-2.5 rounded-full" style={{ background: 'linear-gradient(135deg, #6366f1, #ec4899)' }}>
                Open Dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" onClick={() => setMenuOpen(false)} className="text-center text-sm text-gray-200 px-4 py-2.5 rounded-full border border-white/15">
                  Sign in
                </Link>
                <Link to="/login?mode=signup" onClick={() => setMenuOpen(false)} className="text-center text-sm font-semibold text-white px-4 py-2.5 rounded-full" style={{ background: 'linear-gradient(135deg, #6366f1, #ec4899)' }}>
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
