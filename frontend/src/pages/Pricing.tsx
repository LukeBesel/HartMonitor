import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ArrowRight, Plus } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { PricingCatalog } from '../types';
import MarketingNav from '../marketing/MarketingNav';
import MarketingFooter from '../marketing/MarketingFooter';
import Reveal from '../marketing/Reveal';

// Midnight-blue → glowing-pink brand gradient (matches the new Midnight theme).
const GRADIENT = 'linear-gradient(135deg, #6366f1, #ec4899)';

const FAQ = [
  { q: 'Is there really a free trial?', a: 'Yes. Every paid plan starts with a 14-day free trial — no credit card required. You get full access to every feature in your chosen plan during the trial.' },
  { q: 'Can I upgrade or downgrade anytime?', a: 'Yes. Upgrade, downgrade, or buy add-ons from your workspace settings at any time. Changes take effect immediately and billing is prorated.' },
  { q: 'What happens when my trial ends?', a: 'Your account pauses and you will be prompted to add a payment method. Your data is retained for 30 days — nothing is deleted. You can reactivate anytime during that window.' },
  { q: 'Do you offer refunds?', a: 'Yes. We offer a pro-rated refund within 30 days of any charge. Contact support@hartmonitor.io and we will process it promptly.' },
  { q: 'Can I export my data?', a: 'Absolutely. CSV export is available for all data — work orders, quality records, analytics, inventory — on every plan, including Free. Your data is always yours.' },
  { q: 'How do add-on slots work?', a: 'On the Free plan you can buy individual extra app or dashboard slots if you only need a little more room, without jumping to Pro. Pro and Enterprise already include unlimited apps and dashboards.' },
  { q: 'Is there a discount for annual billing?', a: 'Annual billing is coming soon and will save you 20%. Join the waitlist at sales@hartmonitor.io to be notified when it launches.' },
];

export default function Pricing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pricing, setPricing] = useState<PricingCatalog | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const loadPricing = () => {
    setLoadFailed(false);
    api.getPublicPricing().then(setPricing).catch(() => setLoadFailed(true));
  };

  useEffect(() => {
    loadPricing();
    document.title = 'Pricing — HartMonitor';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Buying happens inside the app (tied to your workspace & billing). Send
  // logged-in users straight to settings; everyone else signs up first.
  const goBuy = (tier: string) => {
    if (tier === 'enterprise') { window.location.href = 'mailto:sales@hartmonitor.io'; return; }
    if (user) navigate('/settings');
    else navigate('/login?mode=signup');
  };

  const fmt = (p: number | null) => (p === null ? 'Custom' : p === 0 ? '$0' : `$${p}`);
  const cta = (key: string) => (key === 'free' ? 'Start free' : key === 'enterprise' ? 'Contact sales' : 'Start 14-day free trial');

  return (
    <div className="bg-[#060911] text-white antialiased min-h-screen overflow-x-hidden">
      <MarketingNav />

      {/* Header */}
      <section className="relative pt-36 pb-12 md:pt-44 text-center px-6">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full opacity-15 blur-[120px]" style={{ background: GRADIENT }} />
        </div>
        <Reveal className="relative">
          <h1 className="text-5xl md:text-6xl font-semibold tracking-tight">Pricing that scales with you.</h1>
          <p className="mt-6 text-lg text-gray-400 max-w-2xl mx-auto">Start with a 14-day free trial on any paid plan — no credit card required. Every plan includes the full operator experience.</p>
          <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/5 text-sm font-medium text-gray-300">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Annual billing coming soon — save 20%
          </div>
        </Reveal>
      </section>

      {/* Tiers */}
      <section className="max-w-6xl mx-auto px-6 pb-8">
        {!pricing && !loadFailed && (
          <div className="grid md:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded-2xl p-8 border border-white/10 bg-white/[0.03] h-96 animate-pulse" />
            ))}
          </div>
        )}
        {!pricing && loadFailed && (
          <div className="text-center py-16">
            <p className="text-gray-400">Couldn't load pricing right now.</p>
            <button onClick={loadPricing} className="mt-4 px-6 py-2.5 rounded-full border border-white/15 text-sm font-semibold text-white hover:bg-white/5 transition-colors">
              Retry
            </button>
          </div>
        )}
        <div className="grid md:grid-cols-3 gap-6">
          {pricing && Object.entries(pricing.tiers).map(([key, tier], i) => {
            const featured = key === 'pro';
            return (
              <Reveal key={key} delay={i * 90}>
                <div className={`relative h-full rounded-2xl p-8 border flex flex-col ${featured ? 'border-pink-500/40 bg-gradient-to-b from-pink-500/[0.1] to-transparent' : 'border-white/10 bg-white/[0.03]'}`}>
                  {featured && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-bold text-white" style={{ background: GRADIENT }}>
                      MOST POPULAR
                    </span>
                  )}
                  <h3 className="text-xl font-semibold text-white">{tier.name}</h3>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-5xl font-semibold text-white">{fmt(tier.monthly_price)}</span>
                    {tier.monthly_price !== null && tier.monthly_price > 0 && <span className="text-gray-500">/mo</span>}
                  </div>
                  <p className="mt-2 text-sm text-gray-500">
                    {key === 'free' ? 'Forever free, no credit card' : key === 'pro' ? '14-day free trial · then billed monthly' : "Let's talk about your needs"}
                  </p>

                  <button
                    onClick={() => goBuy(key)}
                    className={`mt-6 w-full py-3 rounded-full font-semibold text-sm transition-all hover:scale-[1.02] ${
                      featured ? 'text-white shadow-lg shadow-pink-500/30' : 'text-white border border-white/15 hover:bg-white/5'
                    }`}
                    style={featured ? { background: GRADIENT } : undefined}
                  >
                    {cta(key)}
                  </button>

                  <ul className="mt-8 space-y-3.5">
                    {tier.features.map(f => (
                      <li key={f} className="flex items-start gap-2.5 text-sm text-gray-300">
                        <Check size={15} className="text-pink-400 flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* Add-ons */}
      {pricing && (
        <section className="max-w-6xl mx-auto px-6 py-16">
          <Reveal className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">Need just a little more?</h2>
            <p className="mt-3 text-gray-400">On the Free plan, add capacity à la carte — no need to jump to Pro.</p>
          </Reveal>
          <div className="grid sm:grid-cols-2 gap-5 max-w-3xl mx-auto">
            {Object.entries(pricing.addons).map(([key, addon], i) => (
              <Reveal key={key} delay={i * 90}>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: GRADIENT }}>
                    <Plus size={18} className="text-white" />
                  </div>
                  <div>
                    <div className="flex items-baseline gap-2">
                      <h3 className="font-semibold text-white">{addon.name}</h3>
                      <span className="text-sm text-pink-400 font-semibold">${addon.monthly_price}/mo</span>
                    </div>
                    <p className="mt-1.5 text-sm text-gray-400">{addon.description}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal className="text-center mt-8">
            <p className="text-sm text-gray-500">
              Add-ons are purchased from your <Link to={user ? '/settings' : '/login?mode=signup'} className="text-pink-400 hover:text-pink-300">workspace settings</Link>.
            </p>
          </Reveal>
        </section>
      )}

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-6 py-16">
        <Reveal className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">Questions, answered.</h2>
        </Reveal>
        <div className="space-y-4">
          {FAQ.map((item, i) => (
            <Reveal key={item.q} delay={i * 70}>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <h3 className="font-semibold text-white">{item.q}</h3>
                <p className="mt-2.5 text-sm text-gray-400 leading-relaxed">{item.a}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 pb-28">
        <Reveal>
          <div className="relative max-w-4xl mx-auto rounded-3xl overflow-hidden border border-white/10 px-8 py-16 text-center">
            <div className="absolute inset-0 opacity-25 blur-2xl" style={{ background: GRADIENT }} />
            <div className="relative">
              <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">Start your free 14-day trial today.</h2>
              <p className="mt-4 text-gray-300">No credit card required. Set up your workspace in minutes and see results on your first shift.</p>
              <Link to="/login?mode=signup" className="mt-8 inline-flex items-center gap-2 px-8 py-4 rounded-full bg-white text-gray-900 font-semibold transition-all hover:scale-[1.03] shadow-xl">
                Start free trial — no credit card required <ArrowRight size={18} />
              </Link>
              <p className="mt-4 text-sm text-gray-500">Questions? Email us at <a href="mailto:sales@hartmonitor.io" className="text-pink-400 hover:text-pink-300">sales@hartmonitor.io</a></p>
            </div>
          </div>
        </Reveal>
      </section>

      <MarketingFooter />
    </div>
  );
}
