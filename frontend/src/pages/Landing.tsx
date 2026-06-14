import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Blocks, CalendarClock, Gauge, ShieldCheck, Package, Smartphone,
  MessageSquare, WifiOff, ScanLine, Check, Sparkles,
} from 'lucide-react';
import { api } from '../api/client';
import type { PricingCatalog } from '../types';
import MarketingNav from '../marketing/MarketingNav';
import MarketingFooter from '../marketing/MarketingFooter';
import BrowserFrame from '../marketing/BrowserFrame';
import Reveal from '../marketing/Reveal';

const GRADIENT = 'linear-gradient(135deg, #3b82f6, #6366f1)';

const FEATURES = [
  { icon: Blocks, title: 'No-code App Builder', body: 'Drag-and-drop 13 widget types into guided, step-by-step work instructions. Publish to the floor in minutes.' },
  { icon: CalendarClock, title: 'Work Orders & Scheduling', body: 'Plan, sequence, and track every job with live schedule adherence and takt-time monitoring.' },
  { icon: Gauge, title: 'Real-time OEE', body: 'Availability, performance, and quality computed automatically from what operators actually do.' },
  { icon: ShieldCheck, title: 'Quality / NCR', body: 'Capture non-conformances at the source, route them, and close the loop with full audit history.' },
  { icon: Package, title: 'Inventory & Purchasing', body: 'Track stock, locations, vendors, and purchase orders alongside production — one system of record.' },
  { icon: Smartphone, title: 'Operator Portal', body: 'A touch-friendly, mobile-first portal so every operator sees their jobs and reports issues instantly.' },
  { icon: MessageSquare, title: 'Live Messaging', body: 'Broadcast shift updates and urgent alerts to the whole floor in real time over WebSockets.' },
  { icon: WifiOff, title: 'Offline-ready PWA', body: 'Install it like a native app. Keep working through dropouts — data syncs automatically on reconnect.' },
  { icon: ScanLine, title: 'Barcode Scanning', body: 'Scan work orders, parts, and SKUs with any device camera. No dedicated hardware required.' },
];

const STATS = [
  { value: '13', label: 'Widget types' },
  { value: '< 5 min', label: 'To publish an app' },
  { value: 'Real-time', label: 'OEE & analytics' },
  { value: '100%', label: 'Offline-capable' },
];

function ProductRow({ eyebrow, title, body, points, src, alt, phone = false, reverse = false }: {
  eyebrow: string; title: string; body: string; points: string[]; src: string; alt: string; phone?: boolean; reverse?: boolean;
}) {
  return (
    <div className={`grid lg:grid-cols-2 gap-12 lg:gap-16 items-center ${reverse ? 'lg:[&>*:first-child]:order-2' : ''}`}>
      <Reveal>
        <p className="text-sm font-semibold uppercase tracking-widest mb-4 bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">{eyebrow}</p>
        <h3 className="text-3xl md:text-4xl font-semibold text-white tracking-tight leading-tight">{title}</h3>
        <p className="mt-5 text-lg text-gray-400 leading-relaxed">{body}</p>
        <ul className="mt-7 space-y-3">
          {points.map(p => (
            <li key={p} className="flex items-start gap-3 text-gray-300">
              <span className="mt-1 w-5 h-5 rounded-full bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                <Check size={12} className="text-blue-400" strokeWidth={3} />
              </span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </Reveal>
      <Reveal delay={120}>
        {phone ? (
          <div className="flex justify-center">
            <div className="relative w-[260px] rounded-[2.5rem] border-[10px] border-[#1a1f2b] bg-[#1a1f2b] shadow-2xl shadow-black/60">
              <div className="rounded-[1.8rem] overflow-hidden bg-[#0a1628]">
                <img src={src} alt={alt} loading="lazy" className="w-full block" />
              </div>
            </div>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute -inset-6 rounded-3xl opacity-30 blur-3xl" style={{ background: GRADIENT }} />
            <BrowserFrame src={src} alt={alt} className="relative" />
          </div>
        )}
      </Reveal>
    </div>
  );
}

export default function Landing() {
  const [pricing, setPricing] = useState<PricingCatalog | null>(null);

  useEffect(() => {
    api.getPublicPricing().then(setPricing).catch(() => {});
    document.title = 'HartMonitor — Manufacturing Execution System';
  }, []);

  const fmt = (p: number | null) => (p === null ? 'Custom' : p === 0 ? '$0' : `$${p}`);

  return (
    <div className="bg-[#060911] text-white antialiased overflow-x-hidden">
      <MarketingNav />

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="relative pt-32 pb-20 md:pt-44 md:pb-28">
        {/* background glows */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[900px] rounded-full opacity-20 blur-[120px]" style={{ background: GRADIENT }} />
          <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '64px 64px' }} />
        </div>

        <div className="relative max-w-5xl mx-auto px-6 text-center">
          <Reveal>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs font-medium text-gray-300 mb-8">
              <Sparkles size={13} className="text-blue-400" />
              The modern manufacturing execution system
            </div>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="text-5xl md:text-7xl font-semibold tracking-tight leading-[1.05]">
              Run your shop floor
              <br />
              like the <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">future</span>.
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-7 text-lg md:text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
              Build guided work instructions, schedule jobs, track OEE, manage quality, and put real-time
              data in every operator's hands — all in one beautifully simple platform.
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/login?mode=signup"
                className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-full text-white font-semibold text-base transition-all hover:scale-[1.03] shadow-lg shadow-blue-500/25"
                style={{ background: GRADIENT }}
              >
                Start free
                <ArrowRight size={17} className="group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <a href="#product" className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full text-gray-200 font-semibold text-base border border-white/15 hover:bg-white/5 transition-all">
                See it in action
              </a>
            </div>
            <p className="mt-5 text-sm text-gray-500">Free plan includes 5 apps & 2 dashboards · No credit card required</p>
          </Reveal>
        </div>

        {/* hero product shot */}
        <div className="relative max-w-6xl mx-auto px-6 mt-16 md:mt-20">
          <Reveal delay={120}>
            <div className="relative">
              <div className="absolute -inset-4 md:-inset-8 rounded-3xl opacity-30 blur-3xl" style={{ background: GRADIENT }} />
              <BrowserFrame src="/shot-dashboard.png" alt="HartMonitor command center dashboard" className="relative" />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Stat band ──────────────────────────────────────────────────── */}
      <section className="border-y border-white/10 bg-white/[0.02]">
        <div className="max-w-6xl mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
          {STATS.map((s, i) => (
            <Reveal key={s.label} delay={i * 80} className="text-center">
              <div className="text-3xl md:text-4xl font-semibold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">{s.value}</div>
              <div className="mt-2 text-sm text-gray-500">{s.label}</div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Product showcase ───────────────────────────────────────────── */}
      <section id="product" className="max-w-6xl mx-auto px-6 py-24 md:py-32 space-y-28 md:space-y-40">
        <ProductRow
          eyebrow="Command Center"
          title="One view for the entire plant."
          body="Every overdue job, quality flag, and production metric surfaces the moment it matters — so nothing slips and your team always knows what to do next."
          points={['Live "needs attention" feed', 'Schedule adherence & pass-rate at a glance', 'Throughput trends updated in real time']}
          src="/shot-dashboard.png"
          alt="Command center dashboard"
        />
        <ProductRow
          reverse
          phone
          eyebrow="Operator Portal"
          title="Guided work in every operator's hands."
          body="A touch-first portal that shows operators exactly which jobs are theirs, walks them through each step, and lets them report issues or scan barcodes — online or off."
          points={['Mobile-first, install as an app', 'Works offline and syncs on reconnect', 'Built-in barcode & QR scanning']}
          src="/shot-operator.png"
          alt="Operator portal on mobile"
        />
        <ProductRow
          eyebrow="Analytics & OEE"
          title="Decisions backed by real data."
          body="Throughput, cycle time, quality pass rate, and full OEE are computed automatically from what actually happens on the floor — no spreadsheets, no manual entry."
          points={['Automatic OEE: availability × performance × quality', 'Cycle-time trends per step and per app', 'Filter by app, product, and date range']}
          src="/shot-analytics.png"
          alt="Analytics dashboard"
        />
      </section>

      {/* ── Feature grid ───────────────────────────────────────────────── */}
      <section id="features" className="border-t border-white/10 bg-white/[0.02]">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <Reveal className="text-center max-w-2xl mx-auto">
            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight">Everything your floor needs.</h2>
            <p className="mt-5 text-lg text-gray-400">One platform replaces the patchwork of spreadsheets, whiteboards, and disconnected tools.</p>
          </Reveal>
          <div className="mt-16 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 80}>
                <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-7 hover:bg-white/[0.05] hover:border-white/20 transition-all">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-5" style={{ background: GRADIENT }}>
                    <f.icon size={20} className="text-white" />
                  </div>
                  <h3 className="text-lg font-semibold text-white">{f.title}</h3>
                  <p className="mt-2.5 text-sm text-gray-400 leading-relaxed">{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing preview ────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-24 md:py-32">
        <Reveal className="text-center max-w-2xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-semibold tracking-tight">Simple, honest pricing.</h2>
          <p className="mt-5 text-lg text-gray-400">Start free. Upgrade when you're ready to scale across the plant.</p>
        </Reveal>

        <div className="mt-16 grid md:grid-cols-3 gap-6">
          {pricing && Object.entries(pricing.tiers).map(([key, tier], i) => {
            const featured = key === 'pro';
            return (
              <Reveal key={key} delay={i * 90}>
                <div className={`relative h-full rounded-2xl p-8 border ${featured ? 'border-blue-500/40 bg-gradient-to-b from-blue-500/[0.08] to-transparent' : 'border-white/10 bg-white/[0.03]'}`}>
                  {featured && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-bold text-white" style={{ background: GRADIENT }}>
                      MOST POPULAR
                    </span>
                  )}
                  <h3 className="text-xl font-semibold text-white">{tier.name}</h3>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-4xl font-semibold text-white">{fmt(tier.monthly_price)}</span>
                    {tier.monthly_price !== null && tier.monthly_price > 0 && <span className="text-gray-500 text-sm">/mo</span>}
                  </div>
                  <ul className="mt-7 space-y-3">
                    {tier.features.slice(0, 5).map(f => (
                      <li key={f} className="flex items-start gap-2.5 text-sm text-gray-300">
                        <Check size={15} className="text-blue-400 flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            );
          })}
        </div>
        <Reveal className="text-center mt-12">
          <Link to="/pricing" className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 font-semibold transition-colors">
            Compare all plans & add-ons <ArrowRight size={16} />
          </Link>
        </Reveal>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────────────── */}
      <section className="px-6 pb-28">
        <Reveal>
          <div className="relative max-w-5xl mx-auto rounded-3xl overflow-hidden border border-white/10 px-8 py-16 md:py-24 text-center">
            <div className="absolute inset-0 opacity-25 blur-2xl" style={{ background: GRADIENT }} />
            <div className="relative">
              <h2 className="text-4xl md:text-5xl font-semibold tracking-tight">Start running your floor today.</h2>
              <p className="mt-5 text-lg text-gray-300 max-w-xl mx-auto">Set up your workspace in minutes. No credit card, no sales call — just open the app and build.</p>
              <Link
                to="/login?mode=signup"
                className="mt-9 inline-flex items-center gap-2 px-8 py-4 rounded-full bg-white text-gray-900 font-semibold text-base transition-all hover:scale-[1.03] shadow-xl"
              >
                Get started free <ArrowRight size={18} />
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      <MarketingFooter />
    </div>
  );
}
