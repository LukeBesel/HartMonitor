import { useEffect, useId, useRef, useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { getWip, type WipAnswer } from '../../api/floor';

// ─── "Where is WO-1042?" ──────────────────────────────────────────────────────
//
// The question a supervisor asks twenty times a day, and until now the only way
// to answer it was to open the Schedule, find the row, open the drawer and
// count the operations list. It is one box and one sentence, and it is on both
// screens somebody would think to ask it on — the Schedule and the Command
// Center.
//
// The SENTENCE is the server's, not this component's. /api/floor/wip writes
// "WO-1042 is at operation 3 of 7 (Weld), 12 of 50 done" once, so the two
// screens cannot word the same fact differently — and neither of them can
// invent an answer out of a list it happens to have in memory.
//
// A query that matches nothing prints the server's reason rather than an empty
// box: "no work order or part number matches …" is an answer; a blank space is
// a screen that looks broken.
//
// Three questions, one box: the server asks "is this a work-order number?",
// "is it a part number?" and "is it a part name?" in that order, so the
// placeholder has to name all three or the third one is a secret.

export interface WipSearchProps {
  /** Shown above the box. */
  label?: string;
  placeholder?: string;
  className?: string;
  /** Render against a permanently dark surface (a TV board, the player). */
  onDark?: boolean;
  'data-testid'?: string;
}

/** Long enough to be a query, short enough that "042" still works. */
const MIN_QUERY = 2;
/** A supervisor types a work order number in about a second; asking on every
 *  keystroke would put ten lookups behind one question. */
const DEBOUNCE_MS = 350;

export default function WipSearch({
  label = 'Where is a job?',
  // Names the third thing the box answers to. The server matches a part NAME
  // as well as the two numbers, and a supervisor who is not told that types the
  // number they had to go and look up instead of the words in front of them.
  placeholder = 'Work order number, part number or part name…',
  className = '',
  onDark = false,
  'data-testid': testId = 'wip-search',
}: WipSearchProps) {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<WipAnswer | null>(null);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  /** Only the newest lookup may write the answer: typing "WO-104" then "WO-1042"
   *  fires two, and the slower one must not overwrite the newer. */
  const latest = useRef(0);

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < MIN_QUERY) {
      setAnswer(null);
      setError(null);
      setLooking(false);
      return;
    }
    const ticket = ++latest.current;
    setLooking(true);
    const timer = setTimeout(() => {
      getWip(trimmed)
        .then(res => {
          if (latest.current !== ticket) return;
          setAnswer(res);
          setError(null);
        })
        .catch((err: unknown) => {
          if (latest.current !== ticket) return;
          setAnswer(null);
          setError(err instanceof Error ? err.message : 'Could not look that up');
        })
        .finally(() => {
          if (latest.current === ticket) setLooking(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const muted = onDark ? 'text-blue-200/80' : 'text-gray-500';

  return (
    <div className={`${onDark ? 'dark ' : ''}${className}`} data-testid={testId}>
      <label htmlFor={inputId} className={`block text-[11px] font-semibold uppercase tracking-wide ${muted} mb-1.5`}>
        {label}
      </label>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
        {/* No autoFocus: a manager arriving by keyboard should not have the page
            scroll-jump into a search box they did not ask for. */}
        <input
          id={inputId}
          className="input-field pl-9 w-full"
          placeholder={placeholder}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {/* One line, live: a supervisor reading the answer must not have to notice
          that it changed. */}
      <div aria-live="polite" className="mt-2 min-h-[1.25rem]">
        {trimmed.length >= MIN_QUERY && looking && (
          <span className={`inline-flex items-center gap-1.5 text-xs ${muted}`}>
            <Loader2 size={12} className="animate-spin" /> Looking…
          </span>
        )}

        {!looking && error && (
          <span className="text-xs text-red-600">{error}</span>
        )}

        {!looking && !error && answer && answer.result && (
          <p className={`text-sm font-medium ${onDark ? 'text-white' : 'text-gray-900'}`} data-testid="wip-answer">
            {answer.answer}
          </p>
        )}

        {/* Several jobs — a shared part number, or two jobs answering to what
            was typed. Say how many, and say where each one is, rather than
            picking one and being confidently wrong. A capped page SAYS it is
            capped: "25" read as "all of them" is a wrong answer. */}
        {!looking && !error && answer && !answer.result && answer.results.length > 1 && (
          <div data-testid="wip-answer">
            <p className={`text-sm font-medium ${onDark ? 'text-white' : 'text-gray-900'}`}>{answer.answer}</p>
            <ul className={`mt-1 space-y-0.5 text-xs ${muted}`}>
              {answer.results.map(r => <li key={r.work_order_id}>{r.answer}</li>)}
            </ul>
            {answer.truncated_note && (
              <p className={`mt-1 text-[11px] ${muted}`} data-testid="wip-truncated">{answer.truncated_note}</p>
            )}
          </div>
        )}

        {!looking && !error && answer && !answer.result && answer.results.length === 0 && (
          <p className={`text-xs ${muted}`} data-testid="wip-answer">{answer.reason}</p>
        )}
      </div>
    </div>
  );
}
