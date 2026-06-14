interface BrowserFrameProps {
  src: string;
  alt: string;
  url?: string;
  className?: string;
}

// A clean macOS-style browser chrome wrapping a product screenshot. Gives the
// marketing shots a premium, "this is real software" framing.
export default function BrowserFrame({ src, alt, url = 'app.hartmonitor.io', className = '' }: BrowserFrameProps) {
  return (
    <div className={`rounded-xl overflow-hidden border border-white/10 bg-[#0c1018] shadow-2xl shadow-black/50 ${className}`}>
      <div className="flex items-center gap-2 px-4 h-10 bg-white/5 border-b border-white/10">
        <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
        <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
        <span className="w-3 h-3 rounded-full bg-[#28c840]" />
        <div className="ml-4 flex-1 max-w-sm">
          <div className="h-6 rounded-md bg-black/30 border border-white/5 flex items-center justify-center px-3">
            <span className="text-[11px] text-gray-500 truncate">{url}</span>
          </div>
        </div>
      </div>
      <img src={src} alt={alt} loading="lazy" className="w-full block" />
    </div>
  );
}
