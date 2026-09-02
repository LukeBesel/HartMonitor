import { useEffect, useState, useCallback, useRef } from 'react';
import {
  ClipboardList, Plus, X, ChevronDown, ChevronUp, AlertTriangle,
  CheckCircle2, Clock, Users, Shield, Package, Trash2, ArrowRight,
  BookOpen,
} from 'lucide-react';
import { api } from '../api/client';
import { getScrapByPart } from '../api/scrap';
import type { ScrapByPart } from '../api/scrap';
import { currentShiftFor, formatShiftRange, toMinutes } from '../utils/shifts';
import type { SiteShift } from '../utils/shifts';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ShiftNote {
  id: string;
  department_id?: string;
  department_name?: string;
  shift_date: string;
  shift_name: 'day' | 'afternoon' | 'night' | 'custom';
  shift_label?: string;
  author_name: string;
  // 'active' is the stored word (a DB CHECK); the page used to say 'draft',
  // so a note it had just created never matched and the shift never opened.
  status: 'active' | 'submitted' | 'handed_off';
  good_count: number;
  scrap_count: number;
  downtime_minutes: number;
  attendance_count: number;
  safety_incidents: number;
  notes: string;
  issues: string;
  handoff_notes: string;
  handed_off_to: string;
  handed_off_at?: string;
  created_at: string;
}

interface Department { id: string; name: string; }
interface Issue { text: string; severity: 'low' | 'medium' | 'high'; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDatetime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function parseIssues(raw: string): Issue[] {
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

// Maps a facility shift (from the site's shift builder) onto the note's
// day/afternoon/night buckets by start time. The shift_notes schema has no
// shift column, so the selector only prefills the note's metadata.
function bucketForFacilityShift(shift: SiteShift): 'day' | 'afternoon' | 'night' {
  const start = toMinutes(shift.starts_at);
  if (!Number.isFinite(start)) return 'day';
  if (start >= 5 * 60 && start < 12 * 60) return 'day';
  if (start >= 12 * 60 && start < 20 * 60) return 'afternoon';
  return 'night';
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const SHIFT_BADGE: Record<string, string> = {
  day:       'bg-amber-50 text-amber-700 border border-amber-200',
  afternoon: 'bg-blue-50 text-blue-700 border border-blue-200',
  night:     'bg-indigo-50 text-indigo-700 border border-indigo-200',
  custom:    'bg-gray-50 text-gray-700 border border-gray-300',
};

const STATUS_BADGE: Record<string, string> = {
  active:     'bg-gray-100 text-gray-700',
  submitted:  'bg-blue-50 text-blue-700',
  handed_off: 'bg-emerald-50 text-emerald-700',
};

const SEVERITY_BADGE: Record<Issue['severity'], string> = {
  low:    'bg-amber-50 text-amber-700 border border-amber-200',
  medium: 'bg-amber-50 text-amber-700 border border-amber-200',
  high:   'bg-red-50 text-red-700 border border-red-200',
};

function ShiftBadge({ shift, label }: { shift: string; label?: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize ${SHIFT_BADGE[shift] ?? SHIFT_BADGE.custom}`}>
      {label || shift}
    </span>
  );
}

function StatusBadge({ status }: { status: ShiftNote['status'] }) {
  const labels: Record<ShiftNote['status'], string> = {
    active: 'In progress',
    submitted: 'Submitted',
    handed_off: 'Handed Off',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_BADGE[status]}`}>
      {labels[status]}
    </span>
  );
}

function IssueSeverityBadge({ severity }: { severity: Issue['severity'] }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium capitalize ${SEVERITY_BADGE[severity]}`}>
      {severity}
    </span>
  );
}

// ── StartShiftModal ───────────────────────────────────────────────────────────

interface StartShiftModalProps {
  departments: Department[];
  facilityShifts: SiteShift[];
  selectedDate: string;
  onClose: () => void;
  onCreate: (note: ShiftNote) => void;
}

function StartShiftModal({ departments, facilityShifts, selectedDate, onClose, onCreate }: StartShiftModalProps) {
  // Preselect the facility shift that is running right now, when one matches.
  const initialShift = facilityShifts.length > 0 ? currentShiftFor(facilityShifts) : null;
  const [facilityShiftId, setFacilityShiftId] = useState(initialShift?.id ?? '');
  const [shiftName, setShiftName] = useState<'day' | 'afternoon' | 'night'>(
    initialShift ? bucketForFacilityShift(initialShift) : 'day'
  );
  const [departmentId, setDepartmentId] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!authorName.trim()) { setError('Author name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const note = await api.createShiftNote({
        shift_date: selectedDate,
        shift_name: shiftName,
        department_id: departmentId || undefined,
        author_name: authorName.trim(),
        status: 'active',
        good_count: 0,
        scrap_count: 0,
        downtime_minutes: 0,
        attendance_count: 0,
        safety_incidents: 0,
        notes: '',
        issues: '[]',
        handoff_notes: '',
        handed_off_to: '',
      }) as ShiftNote;
      onCreate(note);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create shift note.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Start Shift Note</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertTriangle size={14} />
              {error}
            </div>
          )}

          {facilityShifts.length > 0 && (
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Facility Shift</label>
              <select
                value={facilityShiftId}
                onChange={e => {
                  const id = e.target.value;
                  setFacilityShiftId(id);
                  const shift = facilityShifts.find(s => s.id === id);
                  if (shift) setShiftName(bucketForFacilityShift(shift));
                }}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">— none —</option>
                {facilityShifts.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({formatShiftRange(s)})</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-500 mt-1">Prefills the shift below from your facility's shift schedule.</p>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Shift</label>
            <select
              value={shiftName}
              onChange={e => setShiftName(e.target.value as 'day' | 'afternoon' | 'night')}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="day">Day</option>
              <option value="afternoon">Afternoon</option>
              <option value="night">Night</option>
            </select>
          </div>

          {departments.length > 0 && (
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Department</label>
              <select
                value={departmentId}
                onChange={e => setDepartmentId(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">All / None</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Your Name</label>
            <input
              type="text"
              value={authorName}
              onChange={e => setAuthorName(e.target.value)}
              placeholder="Enter your name"
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>

          <p className="text-xs text-gray-500">Date: {formatDate(selectedDate)}</p>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Creating…' : 'Start Shift Note'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ActiveNoteEditor ──────────────────────────────────────────────────────────

interface ActiveNoteEditorProps {
  note: ShiftNote;
  onRefresh: () => void;
}

function ActiveNoteEditor({ note, onRefresh }: ActiveNoteEditorProps) {
  const [goodCount, setGoodCount] = useState(note.good_count);
  const [scrapCount, setScrapCount] = useState(note.scrap_count);
  const [downtimeMinutes, setDowntimeMinutes] = useState(note.downtime_minutes);
  const [attendanceCount, setAttendanceCount] = useState(note.attendance_count);
  const [safetyIncidents, setSafetyIncidents] = useState(note.safety_incidents);
  const [notesText, setNotesText] = useState(note.notes || '');
  const [issues, setIssues] = useState<Issue[]>(parseIssues(note.issues));
  const [newIssueText, setNewIssueText] = useState('');
  const [newIssueSeverity, setNewIssueSeverity] = useState<Issue['severity']>('low');
  const [handoffNotes, setHandoffNotes] = useState(note.handoff_notes || '');
  const [handedOffTo, setHandedOffTo] = useState(note.handed_off_to || '');
  const [submitting, setSubmitting] = useState(false);
  const [handingOff, setHandingOff] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [error, setError] = useState('');
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What the runs themselves recorded today. Shown BESIDE the typed count and
  // never written into it: the hand-entered number is what the supervisor
  // believes and the derived one is what the floor recorded, and a screen that
  // silently overwrites one with the other destroys the only evidence that they
  // ever disagreed. Best-effort — a plan or permission that cannot read it just
  // sees the typed count on its own, exactly as before.
  const [derivedScrap, setDerivedScrap] = useState<ScrapByPart | null>(null);
  useEffect(() => {
    let live = true;
    getScrapByPart(1).then(d => { if (live) setDerivedScrap(d); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  // Only for the note's OWN day: yesterday's shift cannot be checked against
  // today's runs, and saying nothing is better than saying something wrong.
  const derivedForThisShift = derivedScrap && derivedScrap.plant_date === note.shift_date
    ? derivedScrap.totals
    : null;

  // Sync local state when note changes (e.g. after refresh)
  useEffect(() => {
    setGoodCount(note.good_count);
    setScrapCount(note.scrap_count);
    setDowntimeMinutes(note.downtime_minutes);
    setAttendanceCount(note.attendance_count);
    setSafetyIncidents(note.safety_incidents);
    setNotesText(note.notes || '');
    setIssues(parseIssues(note.issues));
    setHandoffNotes(note.handoff_notes || '');
    setHandedOffTo(note.handed_off_to || '');
  }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveNumericFields() {
    try {
      await api.updateShiftNote(note.id, {
        good_count: goodCount,
        scrap_count: scrapCount,
        downtime_minutes: downtimeMinutes,
        attendance_count: attendanceCount,
        safety_incidents: safetyIncidents,
      });
    } catch {
      // Silent save — don't block the user
    }
  }

  async function saveNotesText() {
    setSavingNotes(true);
    try {
      await api.updateShiftNote(note.id, { notes: notesText });
    } catch {
      // Silent save
    } finally {
      setSavingNotes(false);
    }
  }

  function handleNotesChange(val: string) {
    setNotesText(val);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => {
      api.updateShiftNote(note.id, { notes: val }).catch(() => {});
    }, 800);
  }

  async function saveIssues(list: Issue[]) {
    try {
      await api.updateShiftNote(note.id, { issues: JSON.stringify(list) });
    } catch {
      // Silent save
    }
  }

  function addIssue() {
    if (!newIssueText.trim()) return;
    const updated = [...issues, { text: newIssueText.trim(), severity: newIssueSeverity }];
    setIssues(updated);
    setNewIssueText('');
    setNewIssueSeverity('low');
    saveIssues(updated);
  }

  function removeIssue(index: number) {
    const updated = issues.filter((_, i) => i !== index);
    setIssues(updated);
    saveIssues(updated);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    try {
      await api.submitShiftNote(note.id);
      onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleHandoff() {
    if (!handedOffTo.trim()) { setError('Recipient name is required to hand off.'); return; }
    setHandingOff(true);
    setError('');
    try {
      await api.handoffShiftNote(note.id, { handoff_notes: handoffNotes, handed_off_to: handedOffTo.trim() });
      onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to hand off.');
    } finally {
      setHandingOff(false);
    }
  }

  const isOpen = note.status === 'active';
  const isSubmitted = note.status === 'submitted';

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Note Header */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-200 bg-gray-50">
        <ShiftBadge shift={note.shift_name} label={note.shift_label} />
        {note.department_name && (
          <span className="text-sm text-gray-700 font-medium">{note.department_name}</span>
        )}
        <span className="text-sm text-gray-500">by <span className="text-gray-900">{note.author_name}</span></span>
        <span className="text-sm text-gray-500">&mdash; {formatDate(note.shift_date)}</span>
        <div className="ml-auto">
          <StatusBadge status={note.status} />
        </div>
      </div>

      <div className="p-4 space-y-6">
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        {/* Production Numbers */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Production Numbers</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {/* Good Count */}
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Package size={14} className="text-emerald-700" />
                <label className="text-xs font-medium text-gray-500">Good Count</label>
              </div>
              <input
                type="number"
                min={0}
                value={goodCount}
                onChange={e => setGoodCount(Number(e.target.value))}
                onBlur={saveNumericFields}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            {/* Scrap Count — typed, beside what the runs recorded */}
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Trash2 size={14} className="text-red-700" />
                <label className="text-xs font-medium text-gray-500">Scrap Count</label>
                <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">hand-entered</span>
              </div>
              <input
                type="number"
                min={0}
                value={scrapCount}
                onChange={e => setScrapCount(Number(e.target.value))}
                onBlur={saveNumericFields}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
              <div className="text-[11px] mt-1.5 leading-snug">
                {derivedForThisShift === null ? (
                  <span className="text-gray-400">Runs recorded: only shown for today’s shift</span>
                ) : derivedForThisShift.sample === 0 ? (
                  <span className="text-gray-400">Runs recorded: — no run counted units today</span>
                ) : (
                  <span className="text-gray-600 tabular-nums">
                    Runs recorded: <strong>{derivedForThisShift.scrap}</strong> scrap
                    {' · '}{derivedForThisShift.good} good
                    {derivedForThisShift.fpy_pct !== null && ` · ${derivedForThisShift.fpy_pct}% first pass`}
                  </span>
                )}
              </div>
            </div>

            {/* Downtime */}
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Clock size={14} className="text-amber-700" />
                <label className="text-xs font-medium text-gray-500">Downtime (min)</label>
              </div>
              <input
                type="number"
                min={0}
                value={downtimeMinutes}
                onChange={e => setDowntimeMinutes(Number(e.target.value))}
                onBlur={saveNumericFields}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            {/* Attendance */}
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Users size={14} className="text-blue-700" />
                <label className="text-xs font-medium text-gray-500">Attendance</label>
              </div>
              <input
                type="number"
                min={0}
                value={attendanceCount}
                onChange={e => setAttendanceCount(Number(e.target.value))}
                onBlur={saveNumericFields}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            {/* Safety Incidents */}
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Shield size={14} className="text-amber-700" />
                <label className="text-xs font-medium text-gray-500">Safety Incidents</label>
              </div>
              <input
                type="number"
                min={0}
                value={safetyIncidents}
                onChange={e => setSafetyIncidents(Number(e.target.value))}
                onBlur={saveNumericFields}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-gray-500 block">Shift Notes</label>
            {savingNotes && <span className="text-xs text-gray-500">Saving…</span>}
          </div>
          <textarea
            rows={4}
            value={notesText}
            onChange={e => handleNotesChange(e.target.value)}
            onBlur={saveNotesText}
            placeholder="Describe what happened this shift — production highlights, issues, observations…"
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
          />
        </div>

        {/* Issues */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Issues</h3>

          {issues.length > 0 && (
            <ul className="space-y-2 mb-3">
              {issues.map((issue, i) => (
                <li key={i} className="flex items-start gap-2 bg-gray-50 rounded-lg px-3 py-2">
                  <IssueSeverityBadge severity={issue.severity} />
                  <span className="flex-1 text-sm text-gray-700 leading-snug">{issue.text}</span>
                  <button
                    onClick={() => removeIssue(i)}
                    className="text-gray-500 hover:text-red-800 transition-colors flex-shrink-0 mt-0.5"
                    title="Remove issue"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Add Issue Row */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newIssueText}
              onChange={e => setNewIssueText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addIssue(); } }}
              placeholder="Describe the issue…"
              className="flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            <select
              value={newIssueSeverity}
              onChange={e => setNewIssueSeverity(e.target.value as Issue['severity'])}
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <button
              onClick={addIssue}
              disabled={!newIssueText.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={14} />
              Add
            </button>
          </div>
        </div>

        {/* Submit Button (only while the shift is still open) */}
        {isOpen && (
          <div className="flex items-center justify-end pt-2 border-t border-gray-200">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle2 size={15} />
              {submitting ? 'Submitting…' : 'Submit Shift Note'}
            </button>
          </div>
        )}

        {/* Handoff Section (submitted only) */}
        {isSubmitted && (
          <div className="space-y-3 pt-4 border-t border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700">Shift Handoff</h3>

            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Handoff Notes</label>
              <textarea
                rows={3}
                value={handoffNotes}
                onChange={e => setHandoffNotes(e.target.value)}
                placeholder="Notes for the incoming shift leader…"
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Recipient Name</label>
              <input
                type="text"
                value={handedOffTo}
                onChange={e => setHandedOffTo(e.target.value)}
                placeholder="Who is receiving this handoff?"
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            <div className="flex items-center justify-end">
              <button
                onClick={handleHandoff}
                disabled={handingOff}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ArrowRight size={15} />
                {handingOff ? 'Handing Off…' : 'Hand Off to Next Shift'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── HistoryCard ───────────────────────────────────────────────────────────────

interface HistoryCardProps {
  note: ShiftNote;
  expanded: boolean;
  onToggle: () => void;
}

function HistoryCard({ note, expanded, onToggle }: HistoryCardProps) {
  const issues = parseIssues(note.issues);

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Card Header — always visible */}
      <button
        onClick={onToggle}
        className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <ShiftBadge shift={note.shift_name} label={note.shift_label} />
        <span className="text-sm text-gray-700 font-medium">{formatDate(note.shift_date)}</span>
        {note.department_name && (
          <span className="text-sm text-gray-500">{note.department_name}</span>
        )}
        <span className="text-sm text-gray-500">by {note.author_name}</span>

        {/* Stats row */}
        <div className="flex items-center gap-3 ml-auto flex-wrap">
          <span className="flex items-center gap-1 text-xs text-emerald-700">
            <Package size={12} /> {note.good_count}
          </span>
          <span className="flex items-center gap-1 text-xs text-red-700">
            <Trash2 size={12} /> {note.scrap_count}
          </span>
          <span className="flex items-center gap-1 text-xs text-amber-700">
            <Clock size={12} /> {note.downtime_minutes}m
          </span>
          <span className="flex items-center gap-1 text-xs text-blue-700">
            <Users size={12} /> {note.attendance_count}
          </span>
          {note.safety_incidents > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-700">
              <Shield size={12} /> {note.safety_incidents}
            </span>
          )}
          <StatusBadge status={note.status} />
          {expanded ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
        </div>
      </button>

      {/* Expanded Details */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-200 pt-4">
          {/* Notes */}
          {note.notes && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Shift Notes</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{note.notes}</p>
            </div>
          )}

          {/* Issues */}
          {issues.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Issues ({issues.length})</p>
              <ul className="space-y-1.5">
                {issues.map((issue, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <IssueSeverityBadge severity={issue.severity} />
                    <span className="text-sm text-gray-700">{issue.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Handoff info */}
          {note.status === 'handed_off' && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 space-y-1">
              <p className="text-xs font-medium text-emerald-700">Handed Off</p>
              {note.handed_off_to && (
                <p className="text-sm text-gray-700">To: <span className="text-gray-900">{note.handed_off_to}</span></p>
              )}
              {note.handed_off_at && (
                <p className="text-xs text-gray-500">{formatDatetime(note.handed_off_at)}</p>
              )}
              {note.handoff_notes && (
                <p className="text-sm text-gray-700 pt-1 whitespace-pre-wrap">{note.handoff_notes}</p>
              )}
            </div>
          )}

          {/* No content fallback */}
          {!note.notes && issues.length === 0 && note.status !== 'handed_off' && (
            <p className="text-sm text-gray-500 italic">No notes or issues recorded.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ShiftNotes() {
  const [selectedDate, setSelectedDate] = useState(todayISO);
  const [selectedDept, setSelectedDept] = useState('');
  const [shiftNotes, setShiftNotes] = useState<ShiftNote[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [showStartModal, setShowStartModal] = useState(false);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState('');
  const [facilityShifts, setFacilityShifts] = useState<SiteShift[]>([]);

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    setFetchError('');
    try {
      const params: { date: string; department_id?: string } = { date: selectedDate };
      if (selectedDept) params.department_id = selectedDept;
      const notes = await api.getShiftNotes(params) as ShiftNote[];
      setShiftNotes(notes);
      // The shift being written now: the first open or submitted note.
      const active = notes.find(n => n.status === 'active' || n.status === 'submitted');
      setActiveNoteId(active?.id ?? null);
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load shift notes.');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, selectedDept]);

  // Fetch departments once on mount
  useEffect(() => {
    api.getDepartments().then(data => {
      setDepartments((data as Department[]).map(d => ({ id: d.id, name: d.name })));
    }).catch(() => {});
  }, []);

  // Fetch the current site's facility shifts (primary site, or the first one)
  // once on mount. They power the optional shift selector in the start modal.
  useEffect(() => {
    api.getSites().then(sites => {
      const list = Array.isArray(sites) ? sites : [];
      const site = list.find((s: any) => s.is_primary) ?? list[0];
      if (!site) return;
      api.getSiteShifts(site.id)
        .then(shifts => setFacilityShifts(Array.isArray(shifts) ? shifts : []))
        .catch(() => {});
    }).catch(() => {});
  }, []);

  // Fetch notes on date/dept change
  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  function handleNoteCreated(note: ShiftNote) {
    setShowStartModal(false);
    // Add to list immediately; full refresh will reconcile
    setShiftNotes(prev => [note, ...prev]);
    setActiveNoteId(note.id);
    fetchNotes();
  }

  const activeNote = shiftNotes.find(n => n.id === activeNoteId) ?? null;
  const historyNotes = shiftNotes
    .filter(n => n.id !== activeNoteId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className="bg-gray-50 min-h-screen p-4 sm:p-6 space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center">
            <BookOpen size={20} className="text-blue-700" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Shift Notes</h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Date Picker */}
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />

          {/* Department Filter */}
          {departments.length > 0 && (
            <select
              value={selectedDept}
              onChange={e => setSelectedDept(e.target.value)}
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="">All Departments</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}

          {/* Start Shift Note */}
          <button
            onClick={() => setShowStartModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus size={15} />
            Start Shift Note
          </button>
        </div>
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse bg-gray-100 rounded-xl h-24" />
          ))}
        </div>
      )}

      {/* ── Error ── */}
      {!loading && fetchError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          <AlertTriangle size={16} />
          {fetchError}
          <button onClick={fetchNotes} className="ml-auto text-red-700 hover:text-red-100 underline">Retry</button>
        </div>
      )}

      {/* ── Content ── */}
      {!loading && !fetchError && (
        <>
          {/* Active Note */}
          {activeNote ? (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <ClipboardList size={18} className="text-blue-700" />
                Active Shift Note
              </h2>
              <ActiveNoteEditor
                key={activeNote.id}
                note={activeNote}
                onRefresh={fetchNotes}
              />
            </div>
          ) : (
            shiftNotes.length === 0 && (
              /* Empty State */
              <div className="flex flex-col items-center justify-center py-20 space-y-3 text-center">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 border border-gray-300 flex items-center justify-center mb-2">
                  <BookOpen size={28} className="text-gray-500" />
                </div>
                <p className="text-gray-900 font-semibold text-lg">No shift notes for {formatDate(selectedDate)}</p>
                <p className="text-gray-500 text-sm max-w-xs">Start a shift note to begin tracking production, issues, and handoff information.</p>
                <button
                  onClick={() => setShowStartModal(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors mt-2"
                >
                  <Plus size={15} />
                  Start a Shift Note
                </button>
              </div>
            )
          )}

          {/* History */}
          {historyNotes.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">Past Shift Notes</h2>
              <div className="space-y-2">
                {historyNotes.map(note => (
                  <HistoryCard
                    key={note.id}
                    note={note}
                    expanded={expandedId === note.id}
                    onToggle={() => setExpandedId(expandedId === note.id ? null : note.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Start Modal ── */}
      {showStartModal && (
        <StartShiftModal
          departments={departments}
          facilityShifts={facilityShifts}
          selectedDate={selectedDate}
          onClose={() => setShowStartModal(false)}
          onCreate={handleNoteCreated}
        />
      )}
    </div>
  );
}
