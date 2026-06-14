import { Link } from 'react-router-dom';
import { Activity } from 'lucide-react';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: '/#features' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Operator Portal', href: '/#product' },
      { label: 'Sign in', href: '/login' },
    ],
  },
  {
    title: 'Solutions',
    links: [
      { label: 'Work Instructions', href: '/#features' },
      { label: 'Scheduling & OEE', href: '/#features' },
      { label: 'Quality / NCR', href: '/#features' },
      { label: 'Inventory', href: '/#features' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: '/#product' },
      { label: 'Contact Sales', href: 'mailto:sales@hartmonitor.io' },
      { label: 'Get started', href: '/login?mode=signup' },
    ],
  },
];

export default function MarketingFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#060911]">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
          <div className="col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center gap-2.5 mb-4">
              <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}>
                <Activity size={18} className="text-white" strokeWidth={2.4} />
              </span>
              <span className="text-white font-semibold text-lg tracking-tight">HartMonitor</span>
            </Link>
            <p className="text-sm text-gray-500 leading-relaxed max-w-xs">
              The manufacturing execution system for the modern shop floor.
            </p>
          </div>
          {COLUMNS.map(col => (
            <div key={col.title}>
              <h4 className="text-sm font-semibold text-white mb-4">{col.title}</h4>
              <ul className="space-y-3">
                {col.links.map(l => (
                  <li key={l.label}>
                    {l.href.startsWith('/#') || l.href.startsWith('mailto') ? (
                      <a href={l.href} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">{l.label}</a>
                    ) : (
                      <Link to={l.href} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">{l.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 pt-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-600">© {new Date().getFullYear()} HartMonitor. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <Link to="/privacy" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Privacy</Link>
            <Link to="/terms" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Terms</Link>
            <a href="mailto:security@hartmonitor.io" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Security</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
