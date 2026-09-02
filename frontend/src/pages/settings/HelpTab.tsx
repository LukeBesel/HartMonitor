// ─── Help and guides ────────────────────────────────────────────────────────
import { useState } from 'react';
import { Settings, Check, Building2, Activity, ClipboardList, Package, ShoppingCart, ShieldCheck, Users, AppWindow, ChevronDown, ChevronRight, Bell, Tablet, PlayCircle, BarChart3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { REPLAY_FLAG } from '../../components/shared/OnboardingWizard';

// ─── Main Page ────────────────────────────────────────────────────────────────

// ─── Help & Guides tab ────────────────────────────────────────────────────────

interface ModuleGuide {
  icon: React.ReactNode;
  title: string;
  summary: string;
  link: string;
  linkLabel: string;
  steps: string[];
  tips: string[];
  color: string;
}

const MODULE_GUIDES: ModuleGuide[] = [
  {
    icon: <Activity size={16} />,
    title: 'Command Center',
    summary: 'Your home dashboard -- everything that needs attention in one place.',
    link: '/dashboard',
    linkLabel: 'Open Command Center',
    color: '#3b82f6',
    steps: [
      'The top row shows today\'s output, pass rate, and active work orders at a glance.',
      'Overdue work orders and open quality alerts are surfaced automatically.',
      'Click any metric card to drill into the detail page for that area.',
      'Live throughput updates every 30 seconds via WebSocket -- no refresh needed.',
    ],
    tips: [
      'Check here first thing each shift to spot problems early.',
      'The "Quick Actions" panel lets you log a downtime event or create a work order without leaving the dashboard.',
    ],
  },
  {
    icon: <Tablet size={16} />,
    title: 'Operator Portal',
    summary: 'The dedicated full-screen screen your operators use on the shop floor.',
    link: '/operator',
    linkLabel: 'Open Operator Portal',
    color: '#10b981',
    steps: [
      'Click the blue "Operator Portal" launcher in the sidebar -- it opens full-screen.',
      'The operator selects their name, then picks a Work Order and App to run.',
      'They follow the step-by-step guided instructions (checkboxes, inputs, pass/fail).',
      'On completion the record is saved, OEE data is logged, and the next job loads.',
      'Operators can also report a quality issue (NCR) directly from any step.',
    ],
    tips: [
      'Set this up on a dedicated tablet or touchscreen at each workstation.',
      'The portal works offline -- completions sync when the connection restores.',
    ],
  },
  {
    icon: <AppWindow size={16} />,
    title: 'App Library & Builder',
    summary: 'Build and publish digital work instructions for your production processes.',
    link: '/apps',
    linkLabel: 'Open App Library',
    color: '#8b5cf6',
    steps: [
      'Go to App Library → click "New App" to start building.',
      'Add Steps (one per major task) using the "+" button.',
      'Drag widgets into each step: text instructions, checkboxes, number inputs, pass/fail, photos, timers, etc.',
      'Preview the app at any time with the "Preview" button to see exactly what operators will see.',
      'Click "Publish" to make it live -- published apps appear in the Operator Portal immediately.',
    ],
    tips: [
      'Keep each step focused on one task. Too many widgets per step = confused operators.',
      'Use the "Instruction" widget with a yellow background to highlight safety warnings.',
      'Set takt times per step -- the system tracks if operators exceed the target.',
    ],
  },
  {
    icon: <Building2 size={16} />,
    title: 'Command Center / Live Floor View',
    summary: 'See the live status of your entire floor and manage your work centers.',
    link: '/dashboard',
    linkLabel: 'Open Command Center',
    color: '#f59e0b',
    steps: [
      'Go to Stations → "New Station" to add each physical workstation on your floor.',
      'Assign an App to each station so operators always know what to run there.',
      'Organize stations into Departments (Assembly, QC, Packaging, etc.) for grouped views.',
      'The Command Center Live Floor View shows live throughput, OEE, and machine status for every station.',
      'Click any station card to see its real-time metrics and recent completions.',
    ],
    tips: [
      'Put the Command Center on a TV in the production area -- it auto-refreshes.',
      'Departments aggregate KPIs so managers can see section-level performance at a glance.',
    ],
  },
  {
    icon: <ClipboardList size={16} />,
    title: 'Work Orders & Schedule',
    summary: 'Plan and track production jobs from creation to completion.',
    link: '/schedule',
    linkLabel: 'Open Schedule',
    color: '#ec4899',
    steps: [
      'Go to Schedule → "New Work Order" and enter part number, quantity, and due date.',
      'Assign a Department and takt time target so the system can track pace vs. plan.',
      'Set priority (Critical / High / Medium / Low) -- overdue high-priority WOs show red in the dashboard.',
      'As operators complete jobs in the portal, quantity_completed updates automatically.',
      'Manager View gives a drag-and-drop calendar view of all open work orders by department.',
    ],
    tips: [
      'Takt time is the "goal" cycle time per unit. Set it accurately for meaningful OEE data.',
      'Use the "Overdue" filter in Schedule to find WOs that slipped past their end date.',
    ],
  },
  {
    icon: <Package size={16} />,
    title: 'Inventory',
    summary: 'Track raw materials, components, and finished goods across your warehouse locations.',
    link: '/inventory',
    linkLabel: 'Open Inventory',
    color: '#0ea5e9',
    steps: [
      'Create Locations first (Main Warehouse, Assembly Floor, QC Hold, Finished Goods).',
      'Add Items with SKU, unit cost, reorder point, and reorder quantity.',
      'Record stock movements: Receive (incoming PO), Consume (production), Adjust, Scrap.',
      'Items below their reorder point appear in red on the Inventory dashboard.',
      'Stock levels update instantly as movements are logged.',
    ],
    tips: [
      'Inventory is a Pro feature. Upgrade in Settings → Plan to unlock it.',
      'Link items to NCRs when scrapping defective stock to keep traceability.',
    ],
  },
  {
    icon: <ShoppingCart size={16} />,
    title: 'Purchasing',
    summary: 'Create and track purchase orders from draft to receiving.',
    link: '/purchasing',
    linkLabel: 'Open Purchasing',
    color: '#14b8a6',
    steps: [
      'Add Vendors first with contact details and payment terms.',
      'Create a Purchase Order, pick the vendor, and add line items (item + qty + cost).',
      'Change PO status: Draft → Sent → Received. When received, stock levels update automatically.',
      'PO history lets you compare actual vs. planned cost and lead times over time.',
    ],
    tips: [
      'Purchasing is a Pro feature. Reorder-point alerts show when to create a new PO.',
      'Set Lead Time Days on each vendor to anticipate when stock will arrive.',
    ],
  },
  {
    icon: <ShieldCheck size={16} />,
    title: 'Quality / NCR',
    summary: 'Track non-conformances, assign ownership, and drive corrective action.',
    link: '/quality',
    linkLabel: 'Open Quality',
    color: '#ef4444',
    steps: [
      'Create an NCR from the Quality page -- or operators can log one directly from the portal mid-job.',
      'Set severity (Minor, Major, Critical) and assign it to a team member.',
      'Investigate: record root cause and corrective action in the NCR detail.',
      'Add comments to keep a timestamped audit trail of the investigation.',
      'Close the NCR once corrective action is verified -- the history is preserved.',
    ],
    tips: [
      'Quality is a Pro feature. Link NCRs to work orders and inventory items for full traceability.',
      'The dashboard shows open critical NCRs front-and-center so nothing slips through.',
    ],
  },
  {
    icon: <BarChart3 size={16} />,
    title: 'Analytics & OEE',
    summary: 'Measure throughput, cycle time, and equipment effectiveness over time.',
    link: '/analytics',
    linkLabel: 'Open Analytics',
    color: '#6366f1',
    steps: [
      'Analytics → pick a date range to see throughput, cycle time, and pass rates by app and operator.',
      'OEE Tracker breaks down Availability, Performance, and Quality losses by station.',
      'Step Metrics shows per-step cycle times -- spot which step is the bottleneck.',
      'Leaderboard ranks operators by completed units -- great for gamification.',
      'Build custom Dashboards with cards for any combination of metrics.',
    ],
    tips: [
      'OEE < 85% is a flag. Dig into Availability (downtime), Performance (slow cycles), or Quality (rework) to find the root cause.',
      'Publish a Dashboard in "kiosk" mode to put live metrics on a production TV.',
    ],
  },
  {
    icon: <Bell size={16} />,
    title: 'Alerts & Messages',
    summary: 'Stay in sync with your team via broadcasts and direct messages.',
    link: '/dashboard',
    linkLabel: 'Open Dashboard',
    color: '#f97316',
    steps: [
      'Click the bell icon at the bottom of the sidebar to open the Alerts & Messages panel.',
      'To broadcast to the whole team: type your message, leave "To: Everyone" selected, and send.',
      'For a direct message: click the "To: Everyone" dropdown and pick a specific teammate.',
      'Alerts (machine down, overdue WO) float to the top automatically with red/amber badges.',
      'Recipients see your message in real time -- no email or Slack needed for shift handoff.',
    ],
    tips: [
      'Use "Urgent" severity for critical issues -- it shows with a red badge and sounds an alert for receivers.',
      'Direct messages are private -- only the sender and recipient can see them.',
    ],
  },
  {
    icon: <Users size={16} />,
    title: 'Team & Permissions',
    summary: 'Invite users, assign roles, and control what each role can see and do.',
    link: '/settings?tab=users',
    linkLabel: 'Open Team Settings',
    color: '#84cc16',
    steps: [
      'Settings → Users → "Invite User" to add a teammate by email.',
      'Assign one of five roles: Developer (full access), Manager, Supervisor, Operator, Viewer.',
      'Settings → Permissions lets you show or hide specific nav items per role.',
      'Viewers can see everything but can\'t create, edit, or delete anything.',
      'Operators can log completions and NCRs; Supervisors can also manage apps and stations.',
    ],
    tips: [
      'Most shop-floor workers should be Operator role -- they can use the portal and log issues.',
      'The Permissions tab lets you, for example, hide Planning from operators who don\'t need it.',
    ],
  },
];

function HelpModuleCard({ guide, isOpen, onToggle }: {
  guide: ModuleGuide; isOpen: boolean; onToggle: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-white"
          style={{ backgroundColor: guide.color }}>
          {guide.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-900">{guide.title}</div>
          <div className="text-xs text-gray-500 mt-0.5 truncate">{guide.summary}</div>
        </div>
        <ChevronDown size={15} className={`text-gray-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-3">
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">How to use it</div>
            <ol className="space-y-1.5">
              {guide.steps.map((s, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-700">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: guide.color }}>
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
          {guide.tips.length > 0 && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5 space-y-1">
              <div className="text-xs font-semibold text-amber-700">Pro tips</div>
              {guide.tips.map((t, i) => (
                <p key={i} className="text-xs text-amber-800 leading-relaxed">💡 {t}</p>
              ))}
            </div>
          )}
          <button
            onClick={() => navigate(guide.link)}
            className="text-sm font-semibold flex items-center gap-1.5 transition-colors"
            style={{ color: guide.color }}
          >
            {guide.linkLabel} <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

export function HelpTab() {
  const navigate = useNavigate();
  const [openGuide, setOpenGuide] = useState<string | null>(null);

  const replayTour = () => {
    localStorage.setItem(REPLAY_FLAG, '1');
    navigate('/dashboard');
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* Product tour */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}>
            <PlayCircle size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900">Product tour</h3>
            <p className="text-sm text-gray-500 mt-1">
              New here, or want a refresher? Replay the 12-step guided walkthrough that introduces
              every area of the app.
            </p>
            <button onClick={replayTour} className="btn-primary mt-4">
              <PlayCircle size={15} /> Replay product tour
            </button>
          </div>
        </div>
      </div>

      {/* Per-module guides */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-1">Module guides</h3>
        <p className="text-sm text-gray-500 mb-4">
          Click any module for a step-by-step walkthrough and tips.
        </p>
        <div className="space-y-2">
          {MODULE_GUIDES.map(guide => (
            <HelpModuleCard
              key={guide.title}
              guide={guide}
              isOpen={openGuide === guide.title}
              onToggle={() => setOpenGuide(o => o === guide.title ? null : guide.title)}
            />
          ))}
        </div>
      </div>

      {/* Quick reference card */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Quick reference</h3>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
          {[
            ['Roles', 'Developer → Manager → Supervisor → Operator → Viewer'],
            ['Plan tiers', 'Free (5 apps) → Pro (unlimited + Inventory/Quality) → Enterprise (SSO + Facilities)'],
            ['Takt time', 'Target seconds per unit. Used to calculate OEE Performance score.'],
            ['OEE', 'Availability × Performance × Quality. World class = 85%+'],
            ['NCR', 'Non-Conformance Report -- a logged quality issue.'],
            ['App vs Work Order', 'An App is the instruction set; a Work Order is the job that runs it.'],
            ['Live Floor View', 'Live floor dashboard in the Command Center -- designed for a TV visible to the whole team.'],
            ['Direct message', 'Select a specific user in the message composer instead of "Everyone".'],
          ].map(([term, def]) => (
            <div key={term} className="py-2 border-b border-gray-50 last:border-0">
              <span className="text-xs font-semibold text-gray-700">{term}: </span>
              <span className="text-xs text-gray-500">{def}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
