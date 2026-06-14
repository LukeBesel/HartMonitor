export default function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 flex-shrink-0"
      style={{
        backgroundColor: checked ? 'var(--accent)' : '#e5e7eb',
        // @ts-ignore
        '--tw-ring-color': 'var(--accent)',
      }}
      aria-checked={checked}
      role="switch"
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
