import type {
  DailyBrief, LeaderboardResponse, LeaderboardDepartmentsResponse, LeaderboardPeriod,
  BroadcastMessage, MessageSeverity, PricingCatalog,
  Site, NotificationPrefs, NotificationLogEntry, RolePermissionMap, ApiKey, Webhook, WebhookDelivery,
  AuditLogEntry, SSOProviderInfo,
  InventoryTrackerSummary, InventoryMovement,
  App, Step, StepGroup, AppVariable,
  BOM, BOMLine, Kit, KitLine, KitLineStatus,
  CompletionValue, CompletionValueInput,
  MESTable,
  AndonCall, AndonCallInput, AndonSummary, AndonTeam,
  DepartmentMember, DepartmentMemberInput, DepartmentTeamRole,
  CIProject, CIProjectTask, CIProjectSummary,
} from '../types';

const BASE = '/api';

/** An unused password-reset link an admin can hand to a locked-out user when
 *  the deployment has no SMTP configured. */
export interface PendingReset {
  id: string;
  user_email: string;
  reset_url: string;
  expires_at: string;
  created_at: string;
}

// On native (iOS/Android), cookies don't work across origins so we inject
// the token as an Authorization header instead. Set by AuthContext after login.
let _nativeToken: string | null = null;
export function setNativeToken(token: string | null) { _nativeToken = token; }

export interface AnalyticsFilters {
  app_id?: string;
  product_type_id?: string;
  department_id?: string;
}

/** Page-level filters for dashboard / report card data. Empty = unfiltered. */
export interface DashboardFilters {
  department_id?: string;
  app_id?: string;
  site_id?: string;
}

// Build a query string from analytics filters plus any extra params, omitting
// empty values. Returns e.g. "?days=30&app_id=abc" or "" when nothing is set.
function filterQS(f?: AnalyticsFilters, extra?: Record<string, string | number>): string {
  const qs = new URLSearchParams();
  if (extra) for (const [k, v] of Object.entries(extra)) qs.set(k, String(v));
  if (f?.app_id) qs.set('app_id', f.app_id);
  if (f?.product_type_id) qs.set('product_type_id', f.product_type_id);
  if (f?.department_id) qs.set('department_id', f.department_id);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

// ── App-platform v2 payload shapes (spec §7) ─────────────────────────────────

/** Whole-blob save payload for PUT /api/apps/:id — v2 adds step_groups,
 *  schema_version alongside the existing fields (all optional / additive). */
export interface AppSavePayload {
  name?: string; description?: string; status?: 'draft' | 'published';
  steps?: Step[]; variables?: AppVariable[];
  step_groups?: StepGroup[]; schema_version?: number;
  department_id?: string | null; site_id?: string | null; station_id?: string | null;
  show_takt_warnings?: number | boolean;
}

/** Line input for PUT /api/boms/:id (draft only — server replaces lines). */
export interface BOMLineInput {
  id?: string; item_id: string; qty_per: number;
  unit?: string; reference?: string; step_id?: string;
  scan_code?: string; sort_order?: number; notes?: string;
}

/** Body for PUT /api/kits/:kitId/lines/:lineId. */
export interface KitLineUpdate {
  status: KitLineStatus;
  qty_picked?: number;
  short_reason?: string;
  actor?: string;
}

/** Body for POST /api/tables/import — `data` is the base64-encoded .xlsx/.csv.
 *  First sheet only; first row = headers; server caps 50 cols / 5000 rows / 10 MB. */
export interface TableImportPayload {
  name: string;
  data: string;
  filename: string;
}

/** Flush payload for PUT /api/completions/:id — dual-writes legacy data/
 *  step_times and upserts structured completion_values. partial:true never
 *  flips status (autosave). */
export interface CompletionFlushPayload {
  data?: Record<string, unknown>;
  step_times?: Record<string, number>;
  values?: CompletionValueInput[];
  partial?: boolean;
  status?: 'in_progress' | 'completed' | 'abandoned';
  takt_exceeded_steps?: number[];
}

// ── App analytics (GET /api/apps/:id/analytics + /export.csv) ────────────────

export interface AppAnalyticsParams {
  days?: number;
  operator?: string;
  work_order_id?: string;
  product_type_id?: string;
}

export type AppFieldKind = 'number' | 'boolean' | 'option' | 'text';

export interface AppAnalyticsField {
  widget_id: string;
  label: string;
  type: string;
  step_name: string;
  kind: AppFieldKind;
  stats: {
    avg?: number | null; min?: number | null; max?: number | null; count?: number;
    pass?: number; fail?: number; yield_pct?: number | null;
    options?: { value: string; count: number }[];
  };
  trend?: { date: string; avg: number }[];
}

export interface AppAnalyticsResponse {
  app_id: string;
  app_name: string;
  days: number;
  totals: {
    runs: number; completed: number; abandoned: number;
    avg_duration_s: number | null; first_pass_yield: number | null;
  };
  series: { date: string; completed: number; avg_duration_s: number | null }[];
  by_operator: { operator_name: string; runs: number; avg_duration_s: number | null }[];
  fields: AppAnalyticsField[];
  filter_options: {
    operators: string[];
    work_orders: { id: string; work_order_number: string }[];
    product_types: { id: string; name: string }[];
  };
  recent_runs: {
    id: string; started_at: string; completed_at: string | null; status: string;
    operator_name: string; duration_s: number | null;
    work_order_number: string | null; product_type_name: string | null;
  }[];
}

function appAnalyticsQS(params?: AppAnalyticsParams): string {
  const qs = new URLSearchParams();
  if (params?.days) qs.set('days', String(params.days));
  if (params?.operator) qs.set('operator', params.operator);
  if (params?.work_order_id) qs.set('work_order_id', params.work_order_id);
  if (params?.product_type_id) qs.set('product_type_id', params.product_type_id);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/** Query string for the page-level dashboard filters (department / app / site),
 *  omitting anything unset. Shared by every endpoint that honours a page scope so
 *  the three params are always spelled the same way on the wire. */
function dashboardFilterQS(f?: DashboardFilters): string {
  const qs = new URLSearchParams();
  if (f?.department_id) qs.set('department_id', f.department_id);
  if (f?.app_id)        qs.set('app_id', f.app_id);
  if (f?.site_id)       qs.set('site_id', f.site_id);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

// ─── Hitting the API's rate limit ────────────────────────────────────────────
// The server rejects an over-budget request in its rate-limit middleware, before
// the route ever runs. That is a stronger guarantee than a 429 usually carries:
// the request was not merely unsuccessful, it was never processed, so nothing
// was written. Which is why a rejected POST is replayed here alongside the GETs.
// The alternative — telling an operator half-way through a run that starting the
// job "failed" — throws away real work, and there is no double-submit to fear
// because the handler never saw the first attempt.
//
// The `code` is what pins that reasoning down. Only our own general limiter
// sends it; a 429 from anywhere else in the chain (a proxy, a CDN, the auth
// limiter guarding credentials) makes no promise about whether the request ran,
// so it is surfaced to the caller untouched and never replayed.
const REPLAYABLE_429 = 'API_RATE_LIMITED';
const MAX_429_RETRIES = 3;
// Past this, waiting is worse than telling the truth: the person is better off
// being told when to come back than watching a spinner for ten minutes.
const MAX_429_WAIT_MS = 15_000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** `Retry-After` in milliseconds — seconds form or HTTP-date form. Null if absent. */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(header);
  return Number.isNaN(when) ? null : Math.max(0, when - Date.now());
}

/** "40 seconds" / "about 3 minutes", from a real Retry-After — never a guess. */
function describeWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds <= 90) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

async function sendRequest<T>(path: string, options?: RequestInit, attempt = 0): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // On native apps, send token as Authorization header (cookies don't cross origins in WebView)
  if (_nativeToken) headers['Authorization'] = `Bearer ${_nativeToken}`;
  if (options?.headers) Object.assign(headers, options.headers);

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include', // sends httpOnly cookie on web; no-op on native (header used instead)
    headers,
  });

  if (res.status === 429) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const retryAfterMs = parseRetryAfter(res.headers.get('Retry-After'));
    if (err?.code === REPLAYABLE_429 && attempt < MAX_429_RETRIES
        && (retryAfterMs === null || retryAfterMs <= MAX_429_WAIT_MS)) {
      // Honour Retry-After when the server sent one; otherwise back off on a
      // jittered curve so a page's worth of parallel calls don't all come back
      // in the same instant and trip the limit again.
      const backoff = 400 * 2 ** attempt + Math.random() * 250;
      await sleep(retryAfterMs ?? backoff);
      return sendRequest<T>(path, options, attempt + 1);
    }
    const when = retryAfterMs === null ? '' : ` Please try again in ${describeWait(retryAfterMs)}.`;
    throw Object.assign(
      new Error(`The server is handling too many requests right now.${when || ' Please try again in a moment.'}`),
      { status: 429, data: err },
    );
  }

  if (res.status === 401) {
    const err = await res.json().catch(() => ({ code: 'INVALID_TOKEN' }));
    if (err.code === 'INVALID_TOKEN' || err.code === 'NO_TOKEN') {
      localStorage.removeItem('hm_user');
      // Only force the login screen from inside the app. On public pages
      // (landing, pricing, legal, auth flows) an expired session must never
      // hijack the visit — that bounced every returning visitor to /login.
      const p = window.location.pathname;
      const isPublic = p === '/' || p.startsWith('/pricing') || p.startsWith('/terms')
        || p.startsWith('/privacy') || p.startsWith('/login') || p.startsWith('/forgot-password')
        || p.startsWith('/reset-password') || p.startsWith('/sso/');
      if (!isPublic) {
        window.location.href = '/login';
      }
    }
    throw Object.assign(new Error(err.message || err.error || 'Not authenticated'), { status: 401, data: err });
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.message || err.error || 'Request failed'), { status: res.status, data: err });
  }
  return res.json();
}

// ─── Sharing one GET between the components that all want it ─────────────────
// Mounting a screen mounts a sidebar, a coach, a checklist and the page itself,
// and several of them independently need the same list. They are not wrong to
// need it — asking the server for it four times is what is wrong. So identical
// GETs raised close together are answered from one round trip.
//
// This is a backstop, not the plan: a component that fetches something it has no
// business fetching still needs fixing at the component. What it removes is the
// last, irreducible kind of duplication — separate components that each honestly
// need the same list at the same moment.
//
// The freshness window is deliberately about as long as a mount cascade and no
// longer, and any write clears the whole thing, so nothing here can serve a
// caller data from before their own change.
const GET_SHARE_WINDOW_MS = 2000;

interface SharedGet { at: number; promise: Promise<unknown> }
const sharedGets = new Map<string, SharedGet>();

/** Forget every shared GET. Called after any write, and on sign-out. */
export function invalidateApiCache(): void {
  sharedGets.clear();
}

// Callers own what they are handed — one of them sorting an array in place must
// not rearrange it for everybody else sharing the response.
function detach<T>(value: T): T {
  try {
    return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? 'GET').toUpperCase();

  if (method !== 'GET') {
    try {
      return await sendRequest<T>(path, options);
    } finally {
      // A write may have changed anything, so no read from before it survives.
      invalidateApiCache();
    }
  }

  const key = `${path}::${JSON.stringify(options?.headers ?? null)}`;
  const existing = sharedGets.get(key);
  if (existing && Date.now() - existing.at < GET_SHARE_WINDOW_MS) {
    return detach((await existing.promise) as T);
  }

  const promise = sendRequest<T>(path, options);
  sharedGets.set(key, { at: Date.now(), promise });
  try {
    // The first caller gets the original object; only the sharers pay for a copy.
    return await promise;
  } catch (err) {
    // A failure is not a result worth handing to the next caller.
    if (sharedGets.get(key)?.promise === promise) sharedGets.delete(key);
    throw err;
  }
}

// Authenticated file download via fetch + blob, saved with the server-provided
// filename (Content-Disposition) or the given fallback.
async function downloadBlob(path: string, fallbackFilename: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include', // sends httpOnly cookie automatically
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match?.[1] || fallbackFilename;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * The IANA zone this browser is set to, e.g. 'Europe/Berlin'. Empty when the
 * runtime will not say — the caller must cope with that rather than substitute
 * a zone of its own.
 */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

export const api = {
  // ── Apps
  getApps: () => request<any[]>('/apps'),
  getApp: (id: string) => request<any>(`/apps/${id}`),
  createApp: (data: any) => request<any>('/apps', { method: 'POST', body: JSON.stringify(data) }),
  updateApp: (id: string, data: any) => request<any>(`/apps/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  publishApp: (id: string) => request<any>(`/apps/${id}/publish`, { method: 'POST' }),
  deleteApp: (id: string) => request<any>(`/apps/${id}`, { method: 'DELETE' }),
  getAppCompletions: (id: string) => request<any[]>(`/apps/${id}/completions`),

  // ── App analytics dashboard + exports
  getAppAnalytics: (id: string, params?: AppAnalyticsParams) =>
    request<AppAnalyticsResponse>(`/apps/${id}/analytics${appAnalyticsQS(params)}`),
  downloadAppAnalyticsCsv: (id: string, params?: AppAnalyticsParams) =>
    downloadBlob(`/apps/${id}/export.csv${appAnalyticsQS(params)}`, 'app-analytics-export.csv'),
  downloadAllCompanyData: () =>
    downloadBlob('/config/export-data', `hartmonitor-export-${new Date().toISOString().slice(0, 10)}.json`),

  // ── Completions
  getCompletions: (params?: { limit?: number; status?: string; operator_name?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.status) qs.set('status', params.status);
    if (params?.operator_name) qs.set('operator_name', params.operator_name);
    return request<any[]>(`/completions?${qs}`);
  },
  getCompletion: (id: string) => request<any>(`/completions/${id}`),
  createCompletion: (data: any) => request<any>('/completions', { method: 'POST', body: JSON.stringify(data) }),
  updateCompletion: (id: string, data: any) => request<any>(`/completions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getAppHistory: (appId: string, page = 1, limit = 25) =>
    request<any>(`/completions/app/${appId}/history?page=${page}&limit=${limit}`),

  // ── App-platform v2: typed app save (rides the existing PUT /api/apps/:id
  //    whole-blob endpoint; adds step_groups / schema_version / variables)
  saveApp: (id: string, data: AppSavePayload) =>
    request<App>(`/apps/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // ── App-platform v2: structured completion capture
  // Flush the player's values buffer (autosave / step change / complete).
  flushCompletion: (id: string, data: CompletionFlushPayload) =>
    request<any>(`/completions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  /** Same PUT, but survives the page going away — for a last flush on unload.
   *  `keepalive` lets the browser finish the request after the document is
   *  gone, which a normal fetch would abandon. */
  flushCompletionOnUnload: (id: string, data: CompletionFlushPayload) =>
    request<any>(`/completions/${id}`, { method: 'PUT', body: JSON.stringify(data), keepalive: true }),
  getCompletionValues: (id: string) =>
    request<CompletionValue[]>(`/completions/${id}/values`),

  // ── BOMs (per product type, versioned)
  getBOMs: (params?: { product_type_id?: string; app_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.product_type_id) qs.set('product_type_id', params.product_type_id);
    if (params?.app_id)          qs.set('app_id', params.app_id);
    const s = qs.toString();
    return request<BOM[]>(`/boms${s ? `?${s}` : ''}`);
  },
  createBOM: (data: { product_type_id: string; notes?: string }) =>
    request<BOM>('/boms', { method: 'POST', body: JSON.stringify(data) }),
  getBOM: (id: string) => request<BOM>(`/boms/${id}`),
  updateBOM: (id: string, data: { lines: BOMLineInput[]; notes?: string }) =>
    request<BOM>(`/boms/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  activateBOM: (id: string) => request<BOM>(`/boms/${id}/activate`, { method: 'POST' }),
  newBOMVersion: (id: string) => request<BOM>(`/boms/${id}/new-version`, { method: 'POST' }),
  deleteBOM: (id: string) => request<any>(`/boms/${id}`, { method: 'DELETE' }),
  // WO → product_type → active BOM + lines; 404 {code:'NO_BOM'} when absent.
  resolveBOM: (workOrderId: string) =>
    request<BOM & { lines: BOMLine[] }>(`/boms/resolve?work_order_id=${encodeURIComponent(workOrderId)}`),

  // ── Kits (one per work order, generated from the active BOM)
  generateKit: (data: { work_order_id: string; location_id?: string }) =>
    request<Kit>('/kits/generate', { method: 'POST', body: JSON.stringify(data) }),
  getKits: (params?: { work_order_id?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.work_order_id) qs.set('work_order_id', params.work_order_id);
    if (params?.status)        qs.set('status', params.status);
    const s = qs.toString();
    return request<Kit[]>(`/kits${s ? `?${s}` : ''}`);
  },
  getKit: (id: string) => request<Kit & { lines: KitLine[] }>(`/kits/${id}`),
  updateKitLine: (kitId: string, lineId: string, data: KitLineUpdate) =>
    request<{ line: KitLine; kit_status: string }>(`/kits/${kitId}/lines/${lineId}`, { method: 'PUT', body: JSON.stringify(data) }),
  verifyKit: (id: string) => request<Kit>(`/kits/${id}/verify`, { method: 'POST' }),
  deleteKit: (id: string) => request<any>(`/kits/${id}`, { method: 'DELETE' }),

  // ── Operator badge/PIN login for player attribution
  badgeLogin: (payload: { badge_code?: string; pin?: string }) =>
    request<{ user_id: string; display_name: string }>('/operators/badge-login', { method: 'POST', body: JSON.stringify(payload) }),

  // ── Instant no-sign-in demo sandbox (sets the session cookie server-side)
  startDemo: () => request<{ user: any; sandbox: boolean }>('/auth/demo', { method: 'POST' }),

  // ── Tables
  getTables: () => request<any[]>('/tables'),
  /** Import an .xlsx/.csv (base64) as a new table — first sheet, first row = headers. */
  importTable: (payload: TableImportPayload) =>
    request<MESTable>('/tables/import', { method: 'POST', body: JSON.stringify(payload) }),
  getTable: (id: string) => request<any>(`/tables/${id}`),
  createTable: (data: any) => request<any>('/tables', { method: 'POST', body: JSON.stringify(data) }),
  updateTable: (id: string, data: any) => request<any>(`/tables/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTable: (id: string) => request<any>(`/tables/${id}`, { method: 'DELETE' }),
  getRecords: (tableId: string) => request<any[]>(`/tables/${tableId}/records`),
  createRecord: (tableId: string, data: any) => request<any>(`/tables/${tableId}/records`, { method: 'POST', body: JSON.stringify({ data }) }),
  updateRecord: (tableId: string, recordId: string, data: any) => request<any>(`/tables/${tableId}/records/${recordId}`, { method: 'PUT', body: JSON.stringify({ data }) }),
  deleteRecord: (tableId: string, recordId: string) => request<any>(`/tables/${tableId}/records/${recordId}`, { method: 'DELETE' }),

  // ── Stations
  getStations: (params?: { site_id?: string; department_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.site_id) qs.set('site_id', params.site_id);
    if (params?.department_id) qs.set('department_id', params.department_id);
    const s = qs.toString();
    return request<any[]>(`/stations${s ? `?${s}` : ''}`);
  },
  createStation: (data: any) => request<any>('/stations', { method: 'POST', body: JSON.stringify(data) }),
  updateStation: (id: string, data: any) => request<any>(`/stations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteStation: (id: string) => request<any>(`/stations/${id}`, { method: 'DELETE' }),

  // ── Departments
  getDepartments: (params?: { site_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.site_id) qs.set('site_id', params.site_id);
    const s = qs.toString();
    return request<any[]>(`/departments${s ? `?${s}` : ''}`);
  },
  createDepartment: (data: any) => request<any>('/departments', { method: 'POST', body: JSON.stringify(data) }),

  // ── Department membership — who receives that department's Andon alerts
  getDepartmentMembers: (departmentId: string) =>
    request<DepartmentMember[]>(`/departments/${departmentId}/members`),
  /** Company-wide lookup, e.g. everyone on the quality team. */
  findDepartmentMembers: (params?: { team_role?: DepartmentTeamRole; user_id?: string; active_only?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.team_role) qs.set('team_role', params.team_role);
    if (params?.user_id) qs.set('user_id', params.user_id);
    if (params?.active_only) qs.set('active_only', 'true');
    const s = qs.toString();
    return request<DepartmentMember[]>(`/departments/members${s ? `?${s}` : ''}`);
  },
  addDepartmentMember: (departmentId: string, data: DepartmentMemberInput) =>
    request<DepartmentMember>(`/departments/${departmentId}/members`, { method: 'POST', body: JSON.stringify(data) }),
  updateDepartmentMember: (memberId: string, data: Partial<Omit<DepartmentMemberInput, 'user_id'>>) =>
    request<DepartmentMember>(`/departments/members/${memberId}`, { method: 'PUT', body: JSON.stringify(data) }),
  removeDepartmentMember: (memberId: string) =>
    request<{ success: boolean }>(`/departments/members/${memberId}`, { method: 'DELETE' }),
  updateDepartment: (id: string, data: any) => request<any>(`/departments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDepartment: (id: string) => request<any>(`/departments/${id}`, { method: 'DELETE' }),

  // ── Work Orders
  getWorkOrders: (params?: { status?: string; department_id?: string; priority?: string; site_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status)        qs.set('status', params.status);
    if (params?.department_id) qs.set('department_id', params.department_id);
    if (params?.priority)      qs.set('priority', params.priority);
    if (params?.site_id)       qs.set('site_id', params.site_id);
    const s = qs.toString();
    return request<any[]>(`/work-orders${s ? `?${s}` : ''}`);
  },
  getWorkOrder: (id: string) => request<any>(`/work-orders/${id}`),
  createWorkOrder: (data: any) => request<any>('/work-orders', { method: 'POST', body: JSON.stringify(data) }),
  updateWorkOrder: (id: string, data: any) => request<any>(`/work-orders/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWorkOrder: (id: string) => request<any>(`/work-orders/${id}`, { method: 'DELETE' }),
  completeWorkOrder: (id: string) => request<any>(`/work-orders/${id}/complete`, { method: 'PUT' }),
  getWorkOrderComments: (id: string) => request<any[]>(`/work-orders/${id}/comments`),
  addWorkOrderComment: (id: string, body: string) => request<any>(`/work-orders/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
  deleteWorkOrderComment: (woId: string, commentId: string) => request<any>(`/work-orders/${woId}/comments/${commentId}`, { method: 'DELETE' }),

  // ── Product Types
  getProductTypes: (appId: string) => request<any[]>(`/product-types?app_id=${appId}`),
  createProductType: (data: any) => request<any>('/product-types', { method: 'POST', body: JSON.stringify(data) }),
  updateProductType: (id: string, data: any) => request<any>(`/product-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProductType: (id: string) => request<any>(`/product-types/${id}`, { method: 'DELETE' }),

  // ── Analytics
  getOverview: (f?: AnalyticsFilters) => request<any>(`/analytics/overview${filterQS(f)}`),
  // Both of these honour the Command Center's page scope: the server applies
  // department / app / site to every figure it returns, not just some of them.
  getDailyBrief: (filters?: DashboardFilters) =>
    request<DailyBrief>(`/analytics/daily-brief${dashboardFilterQS(filters)}`),
  getThroughput: (days?: number, f?: AnalyticsFilters) => request<any[]>(`/analytics/throughput${filterQS(f, { days: days ?? 30 })}`),
  getCycleTimes: (days?: number, f?: AnalyticsFilters) => request<any[]>(`/analytics/cycle-times${filterQS(f, { days: days ?? 30 })}`),
  getOperatorPerformance: (f?: AnalyticsFilters) => request<any[]>(`/analytics/operator-performance${filterQS(f)}`),
  getAppPerformance: (f?: AnalyticsFilters) => request<any[]>(`/analytics/app-performance${filterQS(f)}`),
  getQualityData: (days?: number, f?: AnalyticsFilters) => request<any[]>(`/analytics/quality${filterQS(f, { days: days ?? 30 })}`),
  getManagerView: () => request<any>('/analytics/manager-view'),
  getPlantView: (params?: DashboardFilters) =>
    request<any>(`/analytics/plant-view${dashboardFilterQS(params)}`),
  getDepartmentView: (id: string) => request<any>(`/analytics/department/${id}`),
  getStationView: (id: string) => request<any>(`/analytics/station/${id}`),
  getCompletionDetail: (id: string) => request<any>(`/analytics/completion/${id}`),
  getStepMetrics: (appId: string, days?: number) => request<any>(`/analytics/step-metrics/${appId}?days=${days ?? 90}`),
  getCapacity: () => request<any>('/analytics/capacity'),

  // ── OEE
  getOEE: () => request<any[]>('/oee'),
  getOEEMachine: (id: string) => request<any>(`/oee/${id}`),
  logOEEEvent: (id: string, data: { event_type: string; reason?: string }) =>
    request<any>(`/oee/${id}/event`, { method: 'POST', body: JSON.stringify(data) }),
  updateOEESettings: (id: string, data: { planned_hours_per_day?: number; ideal_cycle_seconds?: number }) =>
    request<any>(`/oee/${id}/settings`, { method: 'PUT', body: JSON.stringify(data) }),
  getOEEHistory: (id: string) => request<any[]>(`/oee/${id}/history`),

  // ── Dashboards
  getDashboards: () => request<any[]>('/dashboards'),
  getDashboard: (id: string) => request<any>(`/dashboards/${id}`),
  createDashboard: (data: any) => request<any>('/dashboards', { method: 'POST', body: JSON.stringify(data) }),
  updateDashboard: (id: string, data: any) => request<any>(`/dashboards/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDashboard: (id: string) => request<any>(`/dashboards/${id}`, { method: 'DELETE' }),
  // Card data honours optional page-level filters; the server applies each one
  // to the card types it is meaningful for and ignores unknown ids.
  getDashboardData: (id: string, filters?: DashboardFilters) =>
    request<any>(`/dashboards/${id}/data${dashboardFilterQS(filters)}`),

  // ── Inventory
  getInventoryItems: (params?: { category?: string; search?: string; low_stock?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set('category', params.category);
    if (params?.search)   qs.set('search', params.search);
    if (params?.low_stock) qs.set('low_stock', '1');
    return request<any[]>(`/inventory/items?${qs}`);
  },
  getInventorySummary: () => request<any>('/inventory/items/summary'),
  // Richer rollup for the Inventory Tracker Overview tab (KPIs + low-stock list +
  // stock value by category for the chart).
  getInventoryTrackerSummary: () => request<InventoryTrackerSummary>('/inventory/summary'),
  getInventoryItem: (id: string) => request<any>(`/inventory/items/${id}`),
  createInventoryItem: (data: any) => request<any>('/inventory/items', { method: 'POST', body: JSON.stringify(data) }),
  updateInventoryItem: (id: string, data: any) => request<any>(`/inventory/items/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteInventoryItem: (id: string) => request<any>(`/inventory/items/${id}`, { method: 'DELETE' }),
  getLocations: (params?: { site_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.site_id) qs.set('site_id', params.site_id);
    const s = qs.toString();
    return request<any[]>(`/inventory/locations${s ? `?${s}` : ''}`);
  },
  createLocation: (data: any) => request<any>('/inventory/locations', { method: 'POST', body: JSON.stringify(data) }),
  updateLocation: (id: string, data: any) => request<any>(`/inventory/locations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  createMovement: (data: any) => request<any>('/inventory/movements', { method: 'POST', body: JSON.stringify(data) }),
  getMovements: (params?: { item_id?: string; movement_type?: string; days?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.item_id)       qs.set('item_id', params.item_id);
    if (params?.movement_type) qs.set('movement_type', params.movement_type);
    if (params?.days)          qs.set('days', String(params.days));
    if (params?.limit)         qs.set('limit', String(params.limit));
    return request<InventoryMovement[]>(`/inventory/movements?${qs}`);
  },

  // ── Inventory Shipments
  getShipments: () => request<any[]>('/inventory/shipments'),
  createShipment: (data: any) => request<any>('/inventory/shipments', { method: 'POST', body: JSON.stringify(data) }),
  updateShipment: (id: string, data: any) => request<any>(`/inventory/shipments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteShipment: (id: string) => request<any>(`/inventory/shipments/${id}`, { method: 'DELETE' }),

  // ── Inventory Requirements (MRP)
  getInventoryRequirements: () => request<any>('/inventory/requirements'),

  // ── Purchasing
  getVendors: (params?: { search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    return request<any[]>(`/purchasing/vendors?${qs}`);
  },
  getVendor: (id: string) => request<any>(`/purchasing/vendors/${id}`),
  createVendor: (data: any) => request<any>('/purchasing/vendors', { method: 'POST', body: JSON.stringify(data) }),
  updateVendor: (id: string, data: any) => request<any>(`/purchasing/vendors/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteVendor: (id: string) => request<any>(`/purchasing/vendors/${id}`, { method: 'DELETE' }),
  getPurchaseOrders: (params?: { status?: string; vendor_id?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status)    qs.set('status', params.status);
    if (params?.vendor_id) qs.set('vendor_id', params.vendor_id);
    if (params?.search)    qs.set('search', params.search);
    return request<any[]>(`/purchasing/orders?${qs}`);
  },
  getPurchaseOrder: (id: string) => request<any>(`/purchasing/orders/${id}`),
  createPurchaseOrder: (data: any) => request<any>('/purchasing/orders', { method: 'POST', body: JSON.stringify(data) }),
  updatePurchaseOrder: (id: string, data: any) => request<any>(`/purchasing/orders/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePurchaseOrder: (id: string) => request<any>(`/purchasing/orders/${id}`, { method: 'DELETE' }),
  addPOLine: (poId: string, data: any) => request<any>(`/purchasing/orders/${poId}/lines`, { method: 'POST', body: JSON.stringify(data) }),
  removePOLine: (poId: string, lineId: string) => request<any>(`/purchasing/orders/${poId}/lines/${lineId}`, { method: 'DELETE' }),
  sendPurchaseOrder: (id: string) => request<any>(`/purchasing/orders/${id}/send`, { method: 'POST' }),
  receivePurchaseOrder: (id: string, data: any) => request<any>(`/purchasing/orders/${id}/receive`, { method: 'POST', body: JSON.stringify(data) }),
  getPurchasingSummary: () => request<any>('/purchasing/summary'),

  // ── Quality / NCRs
  getNCRs: (params?: { status?: string; severity?: string; source?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status)   qs.set('status', params.status);
    if (params?.severity) qs.set('severity', params.severity);
    if (params?.source)   qs.set('source', params.source);
    if (params?.search)   qs.set('search', params.search);
    return request<any[]>(`/quality/ncrs?${qs}`);
  },
  getNCR: (id: string) => request<any>(`/quality/ncrs/${id}`),
  createNCR: (data: any) => request<any>('/quality/ncrs', { method: 'POST', body: JSON.stringify(data) }),
  updateNCR: (id: string, data: any) => request<any>(`/quality/ncrs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNCR: (id: string) => request<any>(`/quality/ncrs/${id}`, { method: 'DELETE' }),
  addNCRComment: (id: string, data: { author: string; body: string }) =>
    request<any>(`/quality/ncrs/${id}/comments`, { method: 'POST', body: JSON.stringify(data) }),
  getQualitySummary: () => request<any>('/quality/summary'),

  // ── SQDC (Safety · Quality · Delivery · Cost board)
  getSQDC: (params?: { date?: string; department_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.date)          qs.set('date', params.date);
    if (params?.department_id) qs.set('department_id', params.department_id);
    const s = qs.toString();
    return request<any>(`/sqdc${s ? `?${s}` : ''}`);
  },
  getDepartmentTV: (id: string, params?: { date?: string }) => {
    const qs = new URLSearchParams();
    if (params?.date) qs.set('date', params.date);
    const s = qs.toString();
    return request<any>(`/sqdc/department/${id}${s ? `?${s}` : ''}`);
  },
  getSQDCDetail: (category: string, params?: { date?: string; department_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.date)          qs.set('date', params.date);
    if (params?.department_id) qs.set('department_id', params.department_id);
    const s = qs.toString();
    return request<any>(`/sqdc/${category}/detail${s ? `?${s}` : ''}`);
  },
  createSQDCEntry: (payload: {
    category: string; subtype?: string; department_id?: string;
    location?: string; description?: string; value?: number | null; entry_date?: string;
  }) => request<any>('/sqdc/entries', { method: 'POST', body: JSON.stringify(payload) }),

  // ── Activity log
  getActivityLog: (entityType: 'work_order' | 'purchase_order' | 'ncr', entityId: string) =>
    request<{ id: string; action: string; actor: string; created_at: string }[]>(`/activity/${entityType}/${entityId}`),

  // ── Public pricing catalog (no auth required)
  getPublicPricing: () => request<PricingCatalog>('/public/pricing'),

  // ── Live broadcast messages
  getMessages: (limit = 50) => request<BroadcastMessage[]>(`/messages?limit=${limit}`),
  sendMessage: (body: string, severity: MessageSeverity = 'info', recipientId?: string | null) =>
    request<BroadcastMessage>('/messages', { method: 'POST', body: JSON.stringify({ body, severity, recipient_id: recipientId || null }) }),

  // ── Config
  getCompanySettings: () => request<any>('/config'),
  updateCompanySettings: (data: any) => request<any>('/config', { method: 'PUT', body: JSON.stringify(data) }),
  getPlan: () => request<any>('/config/plan'),
  updatePlan: (data: { tier?: string }) =>
    request<any>('/config/plan', { method: 'PUT', body: JSON.stringify(data) }),
  purchaseAddon: (type: 'app_slot' | 'dashboard_slot', quantity = 1) =>
    request<any>('/config/plan/purchase', { method: 'POST', body: JSON.stringify({ type, quantity }) }),
  removeAddon: (type: 'app_slot' | 'dashboard_slot', quantity = 1) =>
    request<any>('/config/plan/addon', { method: 'DELETE', body: JSON.stringify({ type, quantity }) }),

  // ── Real payments (Stripe) — fall back to demo flow when not configured
  getBillingConfig: () => request<{ configured: boolean; mode: 'demo' | 'test' | 'live' }>('/config/plan/billing-config'),
  createCheckout: (tier: string, addons?: string[]) =>
    request<{ url: string }>('/config/plan/checkout', { method: 'POST', body: JSON.stringify({ tier, addons }) }),
  createBillingPortal: () => request<{ url: string }>('/config/plan/portal', { method: 'POST' }),
  openBillingPortal: () => request<{ url: string }>('/config/plan/portal', { method: 'POST' }),
  getCurrentPlan: () => request<any>('/config/plan'),

  // ── Export — authenticated download via fetch + blob (Bearer header required)
  downloadExport: async (type: string, params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const fallbackName = type.replace(/\//g, '-');
    const fallbackExt = type === 'all' ? 'json' : (params?.format === 'xlsx' ? 'xlsx' : 'csv');
    await downloadBlob(`/export/${type}${qs}`, `${fallbackName}-export.${fallbackExt}`);
  },

  // ── Per-app export
  downloadAppCompletions: (appId: string) => api.downloadExport(`apps/${appId}/completions`),
  downloadAppBundle: (appId: string) => api.downloadExport(`apps/${appId}/bundle`),

  // ── Auth
  login: (email: string, password: string) =>
    fetch(`${BASE}/auth/login`, {
      method: 'POST',
      credentials: 'include', // allows the server to set httpOnly cookie
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).then(async res => {
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error(data.error || 'Login failed'), { status: res.status });
      return data;
    }),
  signup: (company_name: string, display_name: string, email: string, password: string) =>
    fetch(`${BASE}/auth/signup`, {
      method: 'POST',
      credentials: 'include', // allows the server to set httpOnly cookie
      headers: { 'Content-Type': 'application/json' },
      // The browser already knows where the person signing up is standing, and
      // that decides when every "completed today" counter on every screen rolls
      // over. Sending it beats the server guessing US Eastern for a shop in
      // Berlin; if it is missing or unrecognised the server stores UTC.
      body: JSON.stringify({ company_name, display_name, email, password, timezone: browserTimeZone() }),
    }).then(async res => {
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error(data.error || 'Signup failed'), { status: res.status });
      return data;
    }),
  /** Promote the CURRENT demo sandbox into a real free account, keeping every
   *  row already in the workspace (same company_id). Sandbox session only. */
  claimSandbox: (company_name: string, display_name: string, email: string, password: string) =>
    request<{ token: string; user: any; claimed: true }>('/auth/claim-sandbox', {
      method: 'POST',
      body: JSON.stringify({ company_name, display_name, email, password }),
    }),
  logout: () => request<any>('/auth/logout', { method: 'POST' }),
  getMe: () => request<any>('/auth/me'),
  changePassword: (current_password: string, new_password: string) =>
    request<any>('/auth/change-password', { method: 'PUT', body: JSON.stringify({ current_password, new_password }) }),
  // Password reset (public, no token). forgotPassword always resolves to avoid
  // leaking which emails exist; the response may include dev_reset_url when SMTP
  // isn't configured so self-hosted installs can still complete the flow.
  forgotPassword: (email: string) =>
    fetch(`${BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).then(async res => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
      return data as { ok: boolean; dev_reset_url?: string };
    }),
  resetPassword: (token: string, new_password: string) =>
    fetch(`${BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, new_password }),
    }).then(async res => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || 'Reset failed'), { status: res.status });
      return data;
    }),

  // ── Operator floor identity (PIN / badge clock-in)
  getOperatorRoster: () =>
    request<{ id: string; display_name: string; job_title?: string; has_pin: number; has_badge: number }[]>('/operators/roster'),
  verifyOperatorPin: (payload: { user_id?: string; pin?: string; badge_code?: string }) =>
    request<{ id: string; display_name: string }>('/operators/verify', { method: 'POST', body: JSON.stringify(payload) }),
  // Manager+ sets or clears an operator's PIN / badge.
  setUserPin: (id: string, payload: { pin?: string | null; badge_code?: string | null }) =>
    request<{ ok: boolean; has_pin: boolean; has_badge: boolean }>(`/users/${id}/pin`, { method: 'PUT', body: JSON.stringify(payload) }),

  // ── Leaderboard
  // Level 1: leaderboard ranked by department.
  getLeaderboardDepartments: (period: LeaderboardPeriod = 'week') =>
    request<LeaderboardDepartmentsResponse>(`/leaderboard/departments?period=${period}`),
  // Level 2: per-(app, product) operator boards, optionally scoped to a
  // department and/or a single app/operation for the drill-down view.
  getLeaderboard: (period: LeaderboardPeriod = 'week', scope?: { department_id?: string; app_id?: string }) => {
    const qs = new URLSearchParams({ period });
    if (scope?.department_id) qs.set('department_id', scope.department_id);
    if (scope?.app_id) qs.set('app_id', scope.app_id);
    return request<LeaderboardResponse>(`/leaderboard?${qs}`);
  },

  // ── Users
  getUsers: () => request<any[]>('/users'),
  getUser: (id: string) => request<any>(`/users/${id}`),
  createUser: (data: any) => request<any>('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id: string, data: any) => request<any>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (id: string) => request<any>(`/users/${id}`, { method: 'DELETE' }),

  // ── Sites (multi-site / multi-plant)
  getSites: () => request<Site[]>('/sites'),
  createSite: (data: { name: string; code?: string; address?: string; timezone?: string }) =>
    request<Site>('/sites', { method: 'POST', body: JSON.stringify(data) }),
  updateSite: (id: string, data: Partial<Site>) =>
    request<Site>(`/sites/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSite: (id: string) => request<any>(`/sites/${id}`, { method: 'DELETE' }),

  // ── Notifications (email/SMS alerts)
  getNotificationPrefs: () => request<NotificationPrefs>('/notifications'),
  updateNotificationPrefs: (data: { email_enabled?: boolean; email_to?: string; sms_enabled?: boolean; sms_to?: string; events?: string[] }) =>
    request<NotificationPrefs>('/notifications', { method: 'PUT', body: JSON.stringify(data) }),
  getNotificationLog: (limit = 50) => request<NotificationLogEntry[]>(`/notifications/log?limit=${limit}`),
  sendTestNotification: () => request<any>('/notifications/test', { method: 'POST' }),

  // ── Role permission overrides
  getPermissions: () => request<RolePermissionMap>('/permissions'),
  updatePermissions: (overrides: { role: string; nav_key: string; visible: boolean | null }[]) =>
    request<RolePermissionMap>('/permissions', { method: 'PUT', body: JSON.stringify({ overrides }) }),
  resetPermissions: () => request<RolePermissionMap>('/permissions/reset', { method: 'DELETE' }),

  // ── Integrations setup status (Stripe / SSO) — managers+
  getIntegrations: () => request<{
    app_url: string; app_url_explicit: boolean;
    payments: { configured: boolean; mode: string; webhook_url: string; events: string[]; env_vars: string[] };
    sso: { id: string; name: string; configured: boolean; redirect_uri: string; env_vars: string[] }[];
  }>('/config/integrations'),

  // ── Developer: API keys & webhooks (Enterprise)
  getDeveloperAvailability: () => request<{ available: boolean; events: string[] }>('/developer/availability'),
  getApiKeys: () => request<ApiKey[]>('/developer/api-keys'),
  createApiKey: (name: string) =>
    request<ApiKey & { key: string }>('/developer/api-keys', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteApiKey: (id: string) => request<any>(`/developer/api-keys/${id}`, { method: 'DELETE' }),
  getWebhooks: () => request<Webhook[]>('/developer/webhooks'),
  createWebhook: (data: { name: string; url: string; events: string[] }) =>
    request<Webhook>('/developer/webhooks', { method: 'POST', body: JSON.stringify(data) }),
  updateWebhook: (id: string, data: Partial<Webhook>) =>
    request<Webhook>(`/developer/webhooks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWebhook: (id: string) => request<any>(`/developer/webhooks/${id}`, { method: 'DELETE' }),
  getWebhookDeliveries: (id: string) => request<WebhookDelivery[]>(`/developer/webhooks/${id}/deliveries`),
  testWebhook: (id: string) => request<any>(`/developer/webhooks/${id}/test`, { method: 'POST' }),

  // ── Audit log
  // `scope` ('production' default | 'all') decides which entity types are
  // returned when no explicit entity_type is set. The Transaction Log uses
  // 'production' so it only shows shop-floor events, not settings/admin changes.
  getAuditLog: (params?: { entity_type?: string; scope?: 'production' | 'all'; actor?: string; from?: string; to?: string; department_id?: string; station_id?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.entity_type)   qs.set('entity_type', params.entity_type);
    if (params?.scope)         qs.set('scope', params.scope);
    if (params?.actor)         qs.set('actor', params.actor);
    if (params?.from)          qs.set('from', params.from);
    if (params?.to)            qs.set('to', params.to);
    if (params?.department_id) qs.set('department_id', params.department_id);
    if (params?.station_id)    qs.set('station_id', params.station_id);
    if (params?.limit)         qs.set('limit', String(params.limit));
    const s = qs.toString();
    return request<AuditLogEntry[]>(`/activity${s ? `?${s}` : ''}`);
  },
  downloadAuditLog: (params?: { entity_type?: string; scope?: 'production' | 'all'; actor?: string; from?: string; to?: string; department_id?: string; station_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.entity_type)   qs.set('entity_type', params.entity_type);
    if (params?.scope)         qs.set('scope', params.scope);
    if (params?.actor)         qs.set('actor', params.actor);
    if (params?.from)          qs.set('from', params.from);
    if (params?.to)            qs.set('to', params.to);
    if (params?.department_id) qs.set('department_id', params.department_id);
    if (params?.station_id)    qs.set('station_id', params.station_id);
    const s = qs.toString();
    return downloadBlob(`/activity/export${s ? `?${s}` : ''}`, 'audit-log-export.csv');
  },

  // ── Sample data
  loadSampleData: () => request<any>('/config/sample-data', { method: 'POST' }),

  // ── SSO
  getSSOProviders: () => request<SSOProviderInfo[]>('/auth/sso/providers'),

  // ── Product Routings
  getRoutings: (params?: { department_id?: string }) => {
    const qs = params?.department_id ? `?department_id=${encodeURIComponent(params.department_id)}` : '';
    return request<any[]>(`/routings${qs}`);
  },
  getRouting: (id: string) => request<any>(`/routings/${id}`),
  createRouting: (data: any) => request<any>('/routings', { method: 'POST', body: JSON.stringify(data) }),
  updateRouting: (id: string, data: any) => request<any>(`/routings/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRouting: (id: string) => request<any>(`/routings/${id}`, { method: 'DELETE' }),
  createRoutingStep: (routingId: string, data: any) => request<any>(`/routings/${routingId}/steps`, { method: 'POST', body: JSON.stringify(data) }),
  updateRoutingStep: (routingId: string, stepId: string, data: any) => request<any>(`/routings/${routingId}/steps/${stepId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRoutingStep: (routingId: string, stepId: string) => request<any>(`/routings/${routingId}/steps/${stepId}`, { method: 'DELETE' }),
  reorderRoutingSteps: (routingId: string, steps: { id: string; step_number: number }[]) =>
    request<any>(`/routings/${routingId}/steps/reorder`, { method: 'PUT', body: JSON.stringify(steps) }),

  // ── File upload
  uploadImage: (data: string, mimeType: string, filename: string) =>
    request<{ url: string }>('/upload/image', { method: 'POST', body: JSON.stringify({ data, mimeType, filename }) }),

  // ── Training & Skills Matrix
  getTrainingSummary: () => request<any>('/training/summary'),
  getTrainingMatrix: (departmentId?: string) => {
    const qs = departmentId ? `?department_id=${departmentId}` : '';
    return request<any>(`/training/matrix${qs}`);
  },
  getTrainingRecords: (params?: { user_id?: string; app_id?: string; status?: string }) => {
    const qs = new URLSearchParams(params as any).toString();
    return request<any[]>(`/training/records${qs ? '?' + qs : ''}`);
  },
  upsertTrainingRecord: (data: any) =>
    request<any>('/training/records', { method: 'POST', body: JSON.stringify(data) }),
  updateTrainingRecord: (id: string, data: any) =>
    request<any>(`/training/records/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTrainingRecord: (id: string) =>
    request<any>(`/training/records/${id}`, { method: 'DELETE' }),

  getCertifications: (userId?: string) => {
    const qs = userId ? `?user_id=${userId}` : '';
    return request<any[]>(`/training/certifications${qs}`);
  },
  createCertification: (data: any) =>
    request<any>('/training/certifications', { method: 'POST', body: JSON.stringify(data) }),
  updateCertification: (id: string, data: any) =>
    request<any>(`/training/certifications/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCertification: (id: string) =>
    request<any>(`/training/certifications/${id}`, { method: 'DELETE' }),

  getTrainingPlans: (params?: { user_id?: string; status?: string }) => {
    const qs = new URLSearchParams(params as any).toString();
    return request<any[]>(`/training/plans${qs ? '?' + qs : ''}`);
  },
  createTrainingPlan: (data: any) =>
    request<any>('/training/plans', { method: 'POST', body: JSON.stringify(data) }),
  updateTrainingPlan: (id: string, data: any) =>
    request<any>(`/training/plans/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTrainingPlan: (id: string) =>
    request<any>(`/training/plans/${id}`, { method: 'DELETE' }),

  // ── Shift Notes
  getShiftNotes: (params?: { department_id?: string; date?: string; shift_name?: string }) => {
    const qs = new URLSearchParams();
    if (params?.department_id) qs.set('department_id', params.department_id);
    if (params?.date)          qs.set('date', params.date);
    if (params?.shift_name)    qs.set('shift_name', params.shift_name);
    const s = qs.toString();
    return request<any[]>(`/shifts${s ? `?${s}` : ''}`);
  },
  getShiftNote: (id: string) => request<any>(`/shifts/${id}`),
  createShiftNote: (data: any) => request<any>('/shifts', { method: 'POST', body: JSON.stringify(data) }),
  updateShiftNote: (id: string, data: any) => request<any>(`/shifts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  submitShiftNote: (id: string) => request<any>(`/shifts/${id}/submit`, { method: 'POST' }),
  handoffShiftNote: (id: string, data: { handoff_notes: string; handed_off_to: string }) =>
    request<any>(`/shifts/${id}/handoff`, { method: 'POST', body: JSON.stringify(data) }),
  deleteShiftNote: (id: string) => request<any>(`/shifts/${id}`, { method: 'DELETE' }),

  // ── Andon System / team calls
  getAndonCalls: (params?: { status?: string; department_id?: string; type?: string; team?: AndonTeam; station_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status)        qs.set('status', params.status);
    if (params?.department_id) qs.set('department_id', params.department_id);
    if (params?.type)          qs.set('type', params.type);
    if (params?.team)          qs.set('team', params.team);
    if (params?.station_id)    qs.set('station_id', params.station_id);
    const s = qs.toString();
    return request<AndonCall[]>(`/andon${s ? `?${s}` : ''}`);
  },
  createAndonCall: (data: AndonCallInput) => request<AndonCall>('/andon', { method: 'POST', body: JSON.stringify(data) }),
  /** "On my way" — records the responder and the response time. */
  acknowledgeAndonCall: (id: string) => request<AndonCall>(`/andon/${id}/acknowledge`, { method: 'PUT' }),
  resolveAndonCall: (id: string, resolution?: string) =>
    request<AndonCall>(`/andon/${id}/resolve`, { method: 'PUT', body: JSON.stringify({ resolution: resolution ?? '' }) }),
  /** The operator stood the call down — kept on the board with an honest reason. */
  cancelAndonCall: (id: string, reason?: string) =>
    request<AndonCall>(`/andon/${id}/cancel`, { method: 'PUT', body: JSON.stringify({ reason: reason ?? '' }) }),
  deleteAndonCall: (id: string) => request<{ ok: boolean }>(`/andon/${id}`, { method: 'DELETE' }),
  /** Pass department_id to scope every number to one department — GET /andon/summary
   *  honours it the same way GET /andon does. Omit it for plant-wide totals. */
  getAndonSummary: (params?: { department_id?: string }) => {
    const qs = params?.department_id ? `?department_id=${encodeURIComponent(params.department_id)}` : '';
    return request<AndonSummary>(`/andon/summary${qs}`);
  },

  // ── CAPA (standalone module)
  getCAPAs: (params?: { status?: string; priority?: string; department_id?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status)        qs.set('status', params.status);
    if (params?.priority)      qs.set('priority', params.priority);
    if (params?.department_id) qs.set('department_id', params.department_id);
    if (params?.search)        qs.set('search', params.search);
    const s = qs.toString();
    return request<any[]>(`/capa${s ? `?${s}` : ''}`);
  },
  getCAPAItem: (id: string) => request<any>(`/capa/${id}`),
  createCAPAItem: (data: any) => request<any>('/capa', { method: 'POST', body: JSON.stringify(data) }),
  updateCAPAItem: (id: string, data: any) => request<any>(`/capa/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCAPAItem: (id: string) => request<any>(`/capa/${id}`, { method: 'DELETE' }),
  getCAPAItemActions: (capaId: string) => request<any[]>(`/capa/${capaId}/actions`),
  createCAPAItemAction: (capaId: string, data: any) =>
    request<any>(`/capa/${capaId}/actions`, { method: 'POST', body: JSON.stringify(data) }),
  updateCAPAItemAction: (capaId: string, actionId: string, data: any) =>
    request<any>(`/capa/${capaId}/actions/${actionId}`, { method: 'PUT', body: JSON.stringify(data) }),
  getCAPAModuleSummary: () => request<any>('/capa/summary'),

  // Aliases used by the CAPA page
  getCAPA: (id: string) => request<any>(`/capa/${id}`),
  createCAPA: (data: any) => request<any>('/capa', { method: 'POST', body: JSON.stringify(data) }),
  updateCAPA: (id: string, data: any) => request<any>(`/capa/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCAPA: (id: string) => request<any>(`/capa/${id}`, { method: 'DELETE' }),
  getCAPAActions: (capaId: string) => request<any[]>(`/capa/${capaId}/actions`),
  createCAPAAction: (capaId: string, data: any) =>
    request<any>(`/capa/${capaId}/actions`, { method: 'POST', body: JSON.stringify(data) }),
  updateCAPAAction: (capaId: string, actionId: string, data: any) =>
    request<any>(`/capa/${capaId}/actions/${actionId}`, { method: 'PUT', body: JSON.stringify(data) }),
  getCAPASummary: () => request<any>('/capa/summary'),

  // ── Maintenance / CMMS
  getAssets: (params?: { department_id?: string; status?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.department_id) qs.set('department_id', params.department_id);
    if (params?.status)        qs.set('status', params.status);
    if (params?.search)        qs.set('search', params.search);
    const s = qs.toString();
    return request<any[]>(`/maintenance/assets${s ? `?${s}` : ''}`);
  },
  createAsset: (data: any) => request<any>('/maintenance/assets', { method: 'POST', body: JSON.stringify(data) }),
  updateAsset: (id: string, data: any) => request<any>(`/maintenance/assets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAsset: (id: string) => request<any>(`/maintenance/assets/${id}`, { method: 'DELETE' }),
  getPMSchedules: (params?: { asset_id?: string; overdue?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.asset_id)  qs.set('asset_id', params.asset_id);
    if (params?.overdue)   qs.set('overdue', 'true');
    const s = qs.toString();
    return request<any[]>(`/maintenance/pm${s ? `?${s}` : ''}`);
  },
  createPMSchedule: (data: any) => request<any>('/maintenance/pm', { method: 'POST', body: JSON.stringify(data) }),
  updatePMSchedule: (id: string, data: any) => request<any>(`/maintenance/pm/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  completePMSchedule: (id: string) => request<any>(`/maintenance/pm/${id}/complete`, { method: 'POST' }),
  getMaintenanceWOs: (params?: { status?: string; asset_id?: string; type?: string; priority?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status)    qs.set('status', params.status);
    if (params?.asset_id)  qs.set('asset_id', params.asset_id);
    if (params?.type)      qs.set('type', params.type);
    if (params?.priority)  qs.set('priority', params.priority);
    const s = qs.toString();
    return request<any[]>(`/maintenance/work-orders${s ? `?${s}` : ''}`);
  },
  createMaintenanceWO: (data: any) => request<any>('/maintenance/work-orders', { method: 'POST', body: JSON.stringify(data) }),
  updateMaintenanceWO: (id: string, data: any) => request<any>(`/maintenance/work-orders/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMaintenanceWO: (id: string) => request<any>(`/maintenance/work-orders/${id}`, { method: 'DELETE' }),
  getMaintenanceSummary: () => request<any>('/maintenance/summary'),

  // ── Kaizen / CI Ideas
  getKaizenIdeas: (params?: { status?: string; category?: string; department_id?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status)        qs.set('status', params.status);
    if (params?.category)      qs.set('category', params.category);
    if (params?.department_id) qs.set('department_id', params.department_id);
    if (params?.search)        qs.set('search', params.search);
    const s = qs.toString();
    return request<any[]>(`/kaizen${s ? `?${s}` : ''}`);
  },
  createKaizenIdea: (data: any) => request<any>('/kaizen', { method: 'POST', body: JSON.stringify(data) }),
  updateKaizenIdea: (id: string, data: any) => request<any>(`/kaizen/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteKaizenIdea: (id: string) => request<any>(`/kaizen/${id}`, { method: 'DELETE' }),
  getKaizenSummary: () => request<any>('/kaizen/summary'),

  // ── CI Projects (Kaizen / CI workspace)
  // A project is where an idea gets executed. Task endpoints are nested under
  // their project so the server can prove ownership of both ids in one place.
  getCIProjects: (params?: { status?: string; department_id?: string; kaizen_idea_id?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status)         qs.set('status', params.status);
    if (params?.department_id)  qs.set('department_id', params.department_id);
    if (params?.kaizen_idea_id) qs.set('kaizen_idea_id', params.kaizen_idea_id);
    if (params?.search)         qs.set('search', params.search);
    const s = qs.toString();
    return request<CIProject[]>(`/ci-projects${s ? `?${s}` : ''}`);
  },
  getCIProject: (id: string) => request<CIProject>(`/ci-projects/${id}`),
  getCIProjectSummary: () => request<CIProjectSummary>('/ci-projects/summary'),
  createCIProject: (data: Partial<CIProject>) =>
    request<CIProject>('/ci-projects', { method: 'POST', body: JSON.stringify(data) }),
  updateCIProject: (id: string, data: Partial<CIProject>) =>
    request<CIProject>(`/ci-projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCIProject: (id: string) => request<{ ok: boolean }>(`/ci-projects/${id}`, { method: 'DELETE' }),

  getCIProjectTasks: (projectId: string) => request<CIProjectTask[]>(`/ci-projects/${projectId}/tasks`),
  createCIProjectTask: (projectId: string, data: Partial<CIProjectTask>) =>
    request<CIProjectTask>(`/ci-projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(data) }),
  updateCIProjectTask: (projectId: string, taskId: string, data: Partial<CIProjectTask>) =>
    request<CIProjectTask>(`/ci-projects/${projectId}/tasks/${taskId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCIProjectTask: (projectId: string, taskId: string) =>
    request<{ ok: boolean }>(`/ci-projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' }),

  // ─── Admin (developer-only) ────────────────────────────────────────────────
  /** Reset links for THIS company, for self-hosted recovery when SMTP is off.
   *  Company-scoped on the server; returns [] when email is configured. */
  getPendingResets: () => request<PendingReset[]>('/admin/pending-resets'),
  getAdminStats: () => request<any>('/admin/stats'),
  getAdminCompanies: (params?: { search?: string; plan?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.plan) qs.set('plan', params.plan);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const s = qs.toString();
    return request<any[]>(`/admin/companies${s ? `?${s}` : ''}`);
  },
  getAdminCompany: (id: string) => request<any>(`/admin/companies/${id}`),
  updateAdminCompanyPlan: (id: string, tier: string, note?: string) =>
    request<any>(`/admin/companies/${id}/plan`, { method: 'PUT', body: JSON.stringify({ tier, note }) }),
  getAdminUsers: (params?: { search?: string; role?: string; company_id?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.role) qs.set('role', params.role);
    if (params?.company_id) qs.set('company_id', params.company_id);
    if (params?.limit) qs.set('limit', String(params.limit));
    const s = qs.toString();
    return request<any[]>(`/admin/users${s ? `?${s}` : ''}`);
  },
  getAdminActivity: (params?: { limit?: number; company_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.company_id) qs.set('company_id', params.company_id);
    const s = qs.toString();
    return request<any[]>(`/admin/activity${s ? `?${s}` : ''}`);
  },
  getAdminHealth: () => request<any>('/admin/health'),

  // ─── Category Reports (per-workspace Reports pages) ────────────────────────
  getCategoryDashboard: (category: string) => request<any>(`/dashboards/category/${category}`),

  // ─── App templates (app-templates slice) ───────────────────────────────────
  getAppTemplates: () => request<AppTemplatesResponse>('/apps/templates'),
  saveAppAsTemplate: (appId: string, data: { name?: string; description?: string }) =>
    request<MyTemplateSummary>(`/apps/${appId}/save-as-template`, { method: 'POST', body: JSON.stringify(data) }),
  deleteAppTemplate: (id: string) =>
    request<{ success: boolean }>(`/apps/templates/${id}`, { method: 'DELETE' }),
  createAppFromTemplate: (data: { built_in_key?: string; template_id?: string; name: string }) =>
    request<App>('/apps/from-template', { method: 'POST', body: JSON.stringify(data) }),

  // ─── Facility shifts (site_shifts) — appended block, do not reorder ─────────
  getSiteShifts: (siteId: string) => request<SiteShift[]>(`/sites/${siteId}/shifts`),
  createSiteShift: (siteId: string, data: SiteShiftInput) =>
    request<SiteShift>(`/sites/${siteId}/shifts`, { method: 'POST', body: JSON.stringify(data) }),
  updateSiteShift: (siteId: string, shiftId: string, data: Partial<SiteShiftInput>) =>
    request<SiteShift>(`/sites/${siteId}/shifts/${shiftId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSiteShift: (siteId: string, shiftId: string) =>
    request<{ success: boolean }>(`/sites/${siteId}/shifts/${shiftId}`, { method: 'DELETE' }),
  // ─── end facility shifts block ──────────────────────────────────────────────

  // ── Player batch: run sessions, jobs in progress, supervisor authorization ──
  // (appended block — see CompletionSession / JobInProgress types at file end)
  /** Supervisor sign-off for in-run actions (NCR filing). 403 = lower role or bad PIN.
   *  `authorization_id` is a single-use, server-issued proof that the PIN was
   *  verified — the authorized action must send it back or the server rejects
   *  the claimed sign-off. */
  verifyAuthorizer: (pin: string) =>
    request<{ authorization_id: string; user_id: string; display_name: string; role: string }>('/operators/verify-authorizer', {
      method: 'POST', body: JSON.stringify({ pin }),
    }),
  /** One completion with its operator sessions attached. */
  getCompletionWithSessions: (id: string) =>
    request<any & { sessions: CompletionSession[] }>(`/completions/${id}`),
  /** Open an operator stint on a run (start or resume). */
  openCompletionSession: (completionId: string, data: { operator_name: string; operator_user_id?: string | null }) =>
    request<CompletionSession>(`/completions/${completionId}/sessions`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  /** Close the run's open stint (pause-and-leave / abandon / complete). */
  closeCompletionSession: (completionId: string, data: { handoff_comment?: string } = {}) =>
    request<CompletionSession>(`/completions/${completionId}/sessions/close`, {
      method: 'PUT', body: JSON.stringify(data),
    }),
  /** This app's in_progress runs for the setup screen's "Jobs in progress" list. */
  getJobsInProgress: (appId: string) =>
    request<JobInProgress[]>(`/completions?status=in_progress&app_id=${encodeURIComponent(appId)}`),

  // ── Apps-first slice: library stats, in-depth detail, duplicate ────────────
  // (appended block — see AppRunStats / AppDetailResponse types at file end)
  /** Per-app run counters for the App Library cards + "has this company ever
   *  run anything?", the signal the first-run landing decision uses. */
  getAppsStats: () => request<AppsStatsResponse>('/apps/stats'),
  /** Everything the in-depth app page shows: bindings, run stats, operators,
   *  recent runs. Tenant-scoped server-side (404 for other companies' apps). */
  getAppDetail: (id: string) => request<AppDetailResponse>(`/apps/${id}/detail`),
  /** Copy an app into a new draft with fresh step/widget ids. */
  duplicateApp: (id: string, data: { name?: string } = {}) =>
    request<App>(`/apps/${id}/duplicate`, { method: 'POST', body: JSON.stringify(data) }),
  // ── end apps-first block ───────────────────────────────────────────────────
};

// ─── App templates (app-templates slice) ─────────────────────────────────────

/** A built-in HartMonitor model template (defined in server code). */
export interface BuiltInTemplateSummary {
  key: string; name: string; description: string; step_count: number;
}

/** A template this company saved from one of its own apps. */
export interface MyTemplateSummary {
  id: string; name: string; description: string; step_count: number; created_at: string;
}

/** Response of GET /api/apps/templates. */
export interface AppTemplatesResponse {
  built_in: BuiltInTemplateSummary[];
  mine: MyTemplateSummary[];
}

// ─── Facility shifts types (appended block) ──────────────────────────────────
// Uses an import() type so this stays inside the appended block instead of
// touching the import list at the top of the file.
type SiteShift = import('../utils/shifts').SiteShift;

/** Body for POST/PUT /api/sites/:siteId/shifts. days = weekday numbers 0-6. */
export interface SiteShiftInput {
  name: string;
  starts_at: string;
  ends_at: string;
  days?: number[];
  color?: string;
  sort_order?: number;
}

// ── Player batch types (appended block) ──────────────────────────────────────

/** One operator stint on a completion (completion_sessions row). */
export interface CompletionSession {
  id: string;
  company_id: string;
  completion_id: string;
  operator_user_id: string | null;
  operator_name: string;
  started_at: string;
  ended_at: string | null;
  handoff_comment: string;
  created_at: string;
}

/** An in_progress completion as returned by the jobs-in-progress listing. */
export interface JobInProgress {
  id: string;
  app_id: string;
  app_name: string;
  operator_name: string;
  started_at: string;
  work_order_id: string | null;
  product_type_id?: string | null;
  station_id: string | null;
  data: Record<string, unknown>;
  step_times: Record<string, number>;
  /** Most recent operator stint, or null when no session was ever opened. */
  last_session: {
    operator_name: string;
    operator_user_id: string | null;
    started_at: string;
    ended_at: string | null;
    handoff_comment: string;
  } | null;

}

// ── Apps-first types (appended block) ────────────────────────────────────────

/** One app's run counters, from GET /api/apps/stats. */
export interface AppRunStats {
  app_id: string;
  runs_total: number;
  runs_7d: number;
  in_progress: number;
  last_run_at: string | null;
}

/** Response of GET /api/apps/stats. */
export interface AppsStatsResponse {
  /** True once this company has ever started a run of any app. */
  company_has_completions: boolean;
  apps: AppRunStats[];
}

export interface AppDetailStationRef {
  id: string; name: string; location: string; status: string;
}

export interface AppDetailRoutingRef {
  routing_id: string; routing_name: string; step_name: string; step_number: number;
}

export interface AppDetailWorkOrderRef {
  id: string; work_order_number: string; part_number: string; part_name: string;
  status: string; quantity: number; quantity_completed: number;
}

/** Everything this app is wired into — all real rows that point at it. */
export interface AppDetailBindings {
  department: { id: string; name: string; color: string } | null;
  site: { id: string; name: string; code: string } | null;
  default_station: AppDetailStationRef | null;
  stations: AppDetailStationRef[];
  product_types: { id: string; name: string; description: string }[];
  routings: AppDetailRoutingRef[];
  work_orders: AppDetailWorkOrderRef[];
  work_order_count: number;
}

export interface AppDetailStats {
  runs_total: number; completed: number; abandoned: number; in_progress: number;
  runs_7d: number; runs_30d: number; completed_30d: number;
  avg_duration_s: number | null; avg_duration_30d_s: number | null;
  first_run_at: string | null; last_run_at: string | null;
  first_pass_yield: number | null;
  operator_count: number;
}

export interface AppDetailOperator {
  operator_name: string; runs: number; completed: number;
  /** Runs this person picked up mid-job rather than started. */
  joined_runs: number;
  last_run_at: string | null; avg_duration_s: number | null;
}

export interface AppDetailRun {
  id: string; started_at: string; completed_at: string | null;
  status: 'in_progress' | 'completed' | 'abandoned';
  operator_name: string; duration_s: number | null;
  work_order_number: string | null; product_type_name: string | null;
  station_name: string | null;
}

/** Response of GET /api/apps/:id/detail. */
export interface AppDetailResponse {
  app: App;
  bindings: AppDetailBindings;
  stats: AppDetailStats;
  operators: AppDetailOperator[];
  recent_runs: AppDetailRun[];
}
// ── end apps-first types ─────────────────────────────────────────────────────
