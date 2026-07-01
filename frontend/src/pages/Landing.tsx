import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Blocks, CalendarClock, Gauge, ShieldCheck, Package, Smartphone,
  MessageSquare, WifiOff, ScanLine, Check, Sparkles, LayoutDashboard, ClipboardCheck,
  Tv, BarChart3, Trophy, AlertTriangle,
} from 'lucide-react';
import { api } from '../api/client';
import type { PricingCatalog } from '../types';
import MarketingNav from '../marketing/MarketingNav';
import MarketingFooter from '../marketing/MarketingFooter';
import BrowserFrame from '../marketing/BrowserFrame';
import Reveal from '../marketing/Reveal';

// Midnight-blue → glowing-pink brand gradient.
const GRADIENT = 'linear-gradient(135deg, #6366f1, #ec4899)';
const PINK = '#ec4899';

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
        <p className="text-sm font-semibold uppercase tracking-widest mb-4 bg-gradient-to-r from-indigo-400 to-pink-400 bg-clip-text text-transparent">{eyebrow}</p>
        <h3 className="text-3xl md:text-4xl font-semibold text-white tracking-tight leading-tight">{title}</h3>
        <p className="mt-5 text-lg text-gray-400 leading-relaxed">{body}</p>
        <ul className="mt-7 space-y-3">
          {points.map(p => (
            <li key={p} className="flex items-start gap-3 text-gray-300">
              <span className="mt-1 w-5 h-5 rounded-full bg-pink-500/15 flex items-center justify-center flex-shrink-0">
                <Check size={12} className="text-pink-400" strokeWidth={3} />
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

// ── Self-contained MES preview mockups (pure CSS/JSX — no app imports/APIs) ──

function Pill({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'pink' | 'indigo'; children: ReactNode }) {
  const tones: Record<string, string> = {
    green: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    red: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
    pink: 'bg-pink-500/15 text-pink-300 ring-pink-500/30',
    indigo: 'bg-indigo-500/15 text-indigo-300 ring-indigo-500/30',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ${tones[tone]}`}>
      {children}
    </span>
  );
}

// A device-frame mockup card with a header chrome bar, a fake screen, and a caption.
function MockupCard({ icon: Icon, label, caption, children }: {
  icon: typeof LayoutDashboard; label: string; caption: string; children: ReactNode;
}) {
  return (
    <Reveal className="h-full">
      <div className="group h-full flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden transition-all hover:border-pink-500/30 hover:bg-white/[0.05]">
        {/* chrome bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10 bg-[#0a0e27]/60">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/70" />
          <span className="ml-2 inline-flex items-center gap-1.5 text-xs font-medium text-gray-400">
            <Icon size={13} className="text-pink-400" /> {label}
          </span>
        </div>
        {/* screen */}
        <div className="relative p-4 bg-gradient-to-br from-[#0b1030] to-[#0a0e27] flex-1">
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full opacity-20 blur-3xl" style={{ background: PINK }} />
          <div className="relative">{children}</div>
        </div>
        {/* caption */}
        <p className="px-4 pb-4 pt-3 text-sm text-gray-400 leading-relaxed border-t border-white/5">{caption}</p>
      </div>
    </Reveal>
  );
}

function Bar({ pct, tone = 'pink' }: { pct: number; tone?: 'pink' | 'indigo' | 'emerald' | 'amber' }) {
  const colors: Record<string, string> = {
    pink: 'linear-gradient(90deg,#6366f1,#ec4899)',
    indigo: 'linear-gradient(90deg,#4f46e5,#6366f1)',
    emerald: 'linear-gradient(90deg,#059669,#10b981)',
    amber: 'linear-gradient(90deg,#d97706,#f59e0b)',
  };
  return (
    <div className="h-2 rounded-full bg-white/10 overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: colors[tone] }} />
    </div>
  );
}

// 1 — Command Center / Live Floor View
function CommandCenterMock() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {[
          { k: 'OEE', v: '87%' }, { k: 'On time', v: '94%' }, { k: 'Pass rate', v: '99.1%' },
        ].map(s => (
          <div key={s.k} className="rounded-lg bg-white/5 ring-1 ring-white/10 p-2">
            <div className="text-[10px] text-gray-500">{s.k}</div>
            <div className="text-base font-semibold text-white">{s.v}</div>
          </div>
        ))}
      </div>
      <div className="rounded-lg bg-white/5 ring-1 ring-white/10 p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-gray-300">Needs attention</span>
          <Pill tone="red"><AlertTriangle size={9} /> 2 overdue</Pill>
        </div>
        <div className="flex items-center justify-between text-[11px] text-gray-400">
          <span>WO-4821 · CNC Mill 3</span><Pill tone="amber">Behind takt</Pill>
        </div>
        <div className="flex items-center justify-between text-[11px] text-gray-400">
          <span>WO-4830 · Assembly A</span><Pill tone="green">On track</Pill>
        </div>
      </div>
      <div className="rounded-lg bg-white/5 ring-1 ring-white/10 p-2.5">
        <div className="text-[10px] text-gray-500 mb-1.5">Throughput (units/hr)</div>
        <div className="flex items-end gap-1 h-12">
          {[40, 55, 48, 62, 70, 58, 75, 82, 68, 90].map((h, i) => (
            <div key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, background: 'linear-gradient(180deg,#ec4899,#6366f1)' }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// 2 — SQDC board
function SqdcMock() {
  const tiles = [
    { k: 'S', label: 'Safety', tone: 'green' as const, v: '142 days' },
    { k: 'Q', label: 'Quality', tone: 'green' as const, v: '99.1%' },
    { k: 'D', label: 'Delivery', tone: 'amber' as const, v: '94%' },
    { k: 'C', label: 'Cost', tone: 'green' as const, v: '-3.2%' },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {tiles.map(t => (
        <div key={t.k} className="rounded-lg bg-white/5 ring-1 ring-white/10 p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold text-white" style={{ background: GRADIENT }}>{t.k}</span>
            <span className={`w-2.5 h-2.5 rounded-full ${t.tone === 'green' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          </div>
          <div className="text-[10px] text-gray-500">{t.label}</div>
          <div className="text-sm font-semibold text-white">{t.v}</div>
          <div className="mt-1.5 flex gap-0.5">
            {Array.from({ length: 7 }).map((_, i) => (
              <span key={i} className={`flex-1 h-1.5 rounded-sm ${i === 4 && t.tone === 'amber' ? 'bg-amber-400' : 'bg-emerald-400/70'}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// 3 — Department TV display
function TvMock() {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white">Machining · Shift A</span>
        <Pill tone="green">LIVE</Pill>
      </div>
      <div className="rounded-lg bg-white/5 ring-1 ring-white/10 p-3 text-center">
        <div className="text-[10px] uppercase tracking-wide text-gray-500">Units this shift</div>
        <div className="text-3xl font-bold bg-gradient-to-r from-indigo-300 to-pink-300 bg-clip-text text-transparent">1,284</div>
        <div className="text-[10px] text-gray-500">Target 1,200 · 107%</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-white/5 ring-1 ring-white/10 p-2 text-center">
          <div className="text-[10px] text-gray-500">Scrap</div>
          <div className="text-sm font-semibold text-emerald-300">0.8%</div>
        </div>
        <div className="rounded-lg bg-white/5 ring-1 ring-white/10 p-2 text-center">
          <div className="text-[10px] text-gray-500">Downtime</div>
          <div className="text-sm font-semibold text-amber-300">12 min</div>
        </div>
      </div>
    </div>
  );
}

// 4 — App Builder
function AppBuilderMock() {
  return (
    <div className="flex gap-2">
      <div className="w-1/3 space-y-1.5">
        {['Text', 'Photo', 'Checkbox', 'Number', 'Sign-off'].map(w => (
          <div key={w} className="rounded-md bg-white/5 ring-1 ring-white/10 px-2 py-1.5 text-[10px] text-gray-300 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: PINK }} /> {w}
          </div>
        ))}
      </div>
      <div className="flex-1 rounded-lg ring-1 ring-dashed ring-pink-500/40 bg-white/[0.03] p-2.5 space-y-2">
        <div className="text-[10px] font-semibold text-gray-400">Step 2 · Torque check</div>
        <div className="rounded-md bg-white/5 ring-1 ring-white/10 h-8" />
        <div className="rounded-md bg-white/5 ring-1 ring-white/10 h-12 flex items-center justify-center text-[10px] text-gray-500">Photo widget</div>
        <div className="rounded-md ring-1 ring-pink-500/40 bg-pink-500/10 h-7 flex items-center px-2 text-[10px] text-pink-200">+ Drop widget here</div>
      </div>
    </div>
  );
}

// 5 — Operation Analytics
function AnalyticsMock() {
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-white/5 ring-1 ring-white/10 p-2.5">
        <div className="text-[10px] text-gray-500 mb-1.5">OEE breakdown</div>
        {[
          { k: 'Availability', v: 91, tone: 'indigo' as const },
          { k: 'Performance', v: 84, tone: 'pink' as const },
          { k: 'Quality', v: 99, tone: 'emerald' as const },
        ].map(r => (
          <div key={r.k} className="mb-2 last:mb-0">
            <div className="flex justify-between text-[10px] text-gray-400 mb-1"><span>{r.k}</span><span>{r.v}%</span></div>
            <Bar pct={r.v} tone={r.tone} />
          </div>
        ))}
      </div>
      <div className="rounded-lg bg-white/5 ring-1 ring-white/10 p-2.5">
        <div className="text-[10px] text-gray-500 mb-1.5">Cycle time trend (s)</div>
        <svg viewBox="0 0 100 32" className="w-full h-10">
          <polyline points="0,26 14,20 28,22 42,14 56,16 70,9 84,12 100,5" fill="none" stroke="url(#g)" strokeWidth="2.5" strokeLinecap="round" />
          <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#6366f1" /><stop offset="1" stopColor="#ec4899" /></linearGradient></defs>
        </svg>
      </div>
    </div>
  );
}

// 6 — Leaderboard
function LeaderboardMock() {
  const rows = [
    { n: 'Maria S.', pts: 2480, tone: 'pink' as const, badge: '#1' },
    { n: 'Devon K.', pts: 2310, tone: 'indigo' as const, badge: '#2' },
    { n: 'Aisha R.', pts: 2155, tone: 'green' as const, badge: '#3' },
    { n: 'Tom W.', pts: 1990, tone: 'indigo' as const, badge: '#4' },
  ];
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={r.n} className={`flex items-center gap-2.5 rounded-lg p-2 ring-1 ${i === 0 ? 'bg-pink-500/10 ring-pink-500/30' : 'bg-white/5 ring-white/10'}`}>
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: i === 0 ? GRADIENT : 'rgba(255,255,255,0.08)' }}>{r.badge}</span>
          <span className="flex-1 text-[11px] font-medium text-gray-200">{r.n}</span>
          <div className="w-16 hidden sm:block"><Bar pct={(r.pts / 2480) * 100} tone={r.tone === 'pink' ? 'pink' : r.tone === 'green' ? 'emerald' : 'indigo'} /></div>
          <span className="text-[11px] font-semibold text-white tabular-nums">{r.pts.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

const MES_PREVIEWS = [
  { icon: LayoutDashboard, label: 'Command Center', node: <CommandCenterMock />, caption: 'The live floor view — OEE, on-time delivery, and the "needs attention" feed in one glance, refreshed in real time.' },
  { icon: ClipboardCheck, label: 'SQDC Board', node: <SqdcMock />, caption: 'A digital Safety / Quality / Delivery / Cost board that replaces the whiteboard and updates itself from floor data.' },
  { icon: Tv, label: 'Department TV', node: <TvMock />, caption: 'Big-screen shift displays that keep every team aligned on targets, output, scrap, and downtime as it happens.' },
  { icon: Blocks, label: 'App Builder', node: <AppBuilderMock />, caption: 'Drag widgets into guided work instructions — no code. Build a paperless process and publish it to the floor in minutes.' },
  { icon: BarChart3, label: 'Operation Analytics', node: <AnalyticsMock />, caption: 'Drill into OEE, cycle-time trends, and quality by operation, product, and date — decisions backed by real data.' },
  { icon: Trophy, label: 'Leaderboard', node: <LeaderboardMock />, caption: 'Recognize top performers and drive friendly competition with points earned from on-time, high-quality work.' },
];

export default function Landing() {
  const [pricing, setPricing] = useState<PricingCatalog | null>(null);

  useEffect(() => {
    api.getPublicPricing().then(setPricing).catch(() => {});
    document.title = 'HartMonitor — Manufacturing Execution System';
  }, []);

  const fmt = (p: number | null) => (p === null ? 'Custom' : p === 0 ? '$0' : `$${p}`);

  return (
    <div className="bg-[#070a1a] text-white antialiased overflow-x-hidden">
      <MarketingNav />

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="relative pt-32 pb-20 md:pt-44 md:pb-28">
        {/* background glows — midnight navy base with a pink + indigo aurora */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-48 left-1/2 -translate-x-1/2 w-[900px] h-[900px] rounded-full opacity-25 blur-[120px]" style={{ background: GRADIENT }} />
          <div className="absolute -top-24 right-[10%] w-[520px] h-[520px] rounded-full opacity-30 blur-[130px]" style={{ background: 'radial-gradient(circle, #ec4899, transparent 70%)' }} />
          <div className="absolute top-40 left-[5%] w-[460px] h-[460px] rounded-full opacity-25 blur-[130px]" style={{ background: 'radial-gradient(circle, #6366f1, transparent 70%)' }} />
          <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '64px 64px' }} />
        </div>

        <div className="relative max-w-5xl mx-auto px-6 text-center">
          <Reveal>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs font-medium text-gray-300 mb-8">
              <Sparkles size={13} className="text-pink-400" />
              The modern manufacturing execution system
            </div>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="text-5xl md:text-7xl font-semibold tracking-tight leading-[1.05]">
              Run your shop floor
              <br />
              like the <span className="bg-gradient-to-r from-indigo-400 to-pink-400 bg-clip-text text-transparent">future</span>.
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
                className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-full text-white font-semibold text-base transition-all hover:scale-[1.03] shadow-lg shadow-pink-500/30"
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
              <div className="text-3xl md:text-4xl font-semibold bg-gradient-to-r from-indigo-400 to-pink-400 bg-clip-text text-transparent">{s.value}</div>
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

      {/* ── MES preview gallery (self-contained mockups) ───────────────── */}
      <section id="previews" className="relative border-t border-white/10 bg-white/[0.02]">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full opacity-10 blur-[140px]" style={{ background: PINK }} />
        </div>
        <div className="relative max-w-6xl mx-auto px-6 py-24 md:py-32">
          <Reveal className="text-center max-w-2xl mx-auto">
            <p className="text-sm font-semibold uppercase tracking-widest mb-4 bg-gradient-to-r from-indigo-400 to-pink-400 bg-clip-text text-transparent">A closer look</p>
            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight">See exactly what you get.</h2>
            <p className="mt-5 text-lg text-gray-400">Real views from across the platform — from the live floor command center to the SQDC board, TV displays, and analytics.</p>
          </Reveal>
          <div className="mt-16 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {MES_PREVIEWS.map((p, i) => (
              <div key={p.label} style={{ transitionDelay: `${(i % 3) * 80}ms` }}>
                <MockupCard icon={p.icon} label={p.label} caption={p.caption}>
                  {p.node}
                </MockupCard>
              </div>
            ))}
          </div>
        </div>
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
          {!pricing && [1, 2, 3].map(i => (
            <div key={i} className="rounded-2xl p-8 border border-white/10 bg-white/[0.03] h-80 animate-pulse" />
          ))}
          {pricing && Object.entries(pricing.tiers).map(([key, tier], i) => {
            const featured = key === 'pro';
            return (
              <Reveal key={key} delay={i * 90}>
                <div className={`relative h-full rounded-2xl p-8 border ${featured ? 'border-pink-500/40 bg-gradient-to-b from-pink-500/[0.08] to-transparent' : 'border-white/10 bg-white/[0.03]'}`}>
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
        <Reveal className="text-center mt-12">
          <Link to="/pricing" className="inline-flex items-center gap-2 text-pink-400 hover:text-pink-300 font-semibold transition-colors">
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
