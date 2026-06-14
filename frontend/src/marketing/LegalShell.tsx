import { useEffect, ReactNode } from 'react';
import MarketingNav from './MarketingNav';
import MarketingFooter from './MarketingFooter';

// Shared dark-themed wrapper for legal/policy pages so they match the marketing
// site. Renders a constrained, readable prose column.
export default function LegalShell({ title, updated, children }: {
  title: string; updated: string; children: ReactNode;
}) {
  useEffect(() => { document.title = `${title} — HartMonitor`; }, [title]);

  return (
    <div className="bg-[#060911] text-white antialiased min-h-screen flex flex-col">
      <MarketingNav />
      <main className="flex-1 pt-32 pb-20">
        <div className="max-w-3xl mx-auto px-6">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-3 text-sm text-gray-500">Last updated: {updated}</p>
          <div className="legal-prose mt-10 space-y-6 text-gray-300 leading-relaxed">
            {children}
          </div>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}

// Small helpers to keep the policy pages readable.
export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-white tracking-tight">{heading}</h2>
      {children}
    </section>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-gray-400">{children}</p>;
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2 list-disc pl-5 text-gray-400 marker:text-blue-400">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  );
}
