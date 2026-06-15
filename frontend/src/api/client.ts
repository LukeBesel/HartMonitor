import type {
  DailyBrief, LeaderboardResponse, LeaderboardPeriod, BroadcastMessage, MessageSeverity, PricingCatalog,
  Site, NotificationPrefs, NotificationLogEntry, RolePermissionMap, ApiKey, Webhook, WebhookDelivery,
  AuditLogEntry, SSOProviderInfo,
} from '../types';

const BASE = '/api';

export interface AnalyticsFilters {
  app_id?: string;
  product_type_id?: string;
}

// Build a query string from analytics filters plus any extra params, omitting
// empty values. Returns e.g. "?days=30&app_id=abc" or "" when nothing is set.
function filterQS(f?: AnalyticsFilters, extra?: Record<string, string | number>): string {
  const qs = new URLSearchParams();
  if (extra) for (const [k, v] of Object.entries(extra)) qs.set(k, String(v));
  if (f?.app_id) qs.set('app_id', f.app_id);
  if (f?.product_type_id) qs.set('product_type_id', f.product_type_id);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('hm_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options?.headers) Object.assign(headers, options.headers);

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    const err = await res.json().catch(() => ({ code: 'INVALID_TOKEN' }));
    if (err.code === 'INVALID_TOKEN' || err.code === 'NO_TOKEN') {
      localStorage.removeItem('hm_token');
      localStorage.removeItem('hm_user');
      if (!window.location.pathname.startsWith('/login')) {
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

// Authenticated file download via fetch + blob, saved with the server-provided
// filename (Content-Disposition) or the given fallback.
async function downloadBlob(path: string, fallbackFilename: string): Promise<void> {
  const token = localStorage.getItem('hm_token');
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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

export const api = {
  // ── Apps
  getApps: () => request<any[]>('/apps'),
  getApp: (id: string) => request<any>(`/apps/${id}`),
  createApp: (data: any) => request<any>('/apps', { method: 'POST', body: JSON.stringify(data) }),
  updateApp: (id: string, data: any) => request<any>(`/apps/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  publishApp: (id: string) => request<any>(`/apps/${id}/publish`, { method: 'POST' }),
  deleteApp: (id: string) => request<any>(`/apps/${id}`, { method: 'DELETE' }),
  getAppCompletions: (id: string) => request<any[]>(`/apps/${id}/completions`),

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

  // ── Tables
  getTables: () => request<any[]>('/tables'),
  getTable: (id: string) => request<any>(`/tables/${id}`),
  createTable: (data: any) => request<any>('/tables', { method: 'POST', body: JSON.stringify(data) }),
  updateTable: (id: string, data: any) => request<any>(`/tables/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTable: (id: string) => request<any>(`/tables/${id}`, { method: 'DELETE' }),
  getRecords: (tableId: string) => request<any[]>(`/tables/${tableId}/records`),
  createRecord: (tableId: string, data: any) => request<any>(`/tables/${tableId}/records`, { method: 'POST', body: JSON.stringify({ data }) }),
  updateRecord: (tableId: string, recordId: string, data: any) => request<any>(`/tables/${tableId}/records/${recordId}`, { method: 'PUT', body: JSON.stringify({ data }) }),
  deleteRecord: (tableId: string, recordId: string) => request<any>(`/tables/${tableId}/records/${recordId}`, { method: 'DELETE' }),

  // ── Stations
  getStations: (params?: { site_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.site_id) qs.set('site_id', params.site_id);
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

  // ── Product Types
  getProductTypes: (appId: string) => request<any[]>(`/product-types?app_id=${appId}`),
  createProductType: (data: any) => request<any>('/product-types', { method: 'POST', body: JSON.stringify(data) }),
  updateProductType: (id: string, data: any) => request<any>(`/product-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProductType: (id: string) => request<any>(`/product-types/${id}`, { method: 'DELETE' }),

  // ── Analytics
  getOverview: (f?: AnalyticsFilters) => request<any>(`/analytics/overview${filterQS(f)}`),
  getDailyBrief: () => request<DailyBrief>('/analytics/daily-brief'),
  getThroughput: (days?: number, f?: AnalyticsFilters) => request<any[]>(`/analytics/throughput${filterQS(f, { days: days ?? 30 })}`),
  getCycleTimes: (days?: number, f?: AnalyticsFilters) => request<any[]>(`/analytics/cycle-times${filterQS(f, { days: days ?? 30 })}`),
  getOperatorPerformance: (f?: AnalyticsFilters) => request<any[]>(`/analytics/operator-performance${filterQS(f)}`),
  getAppPerformance: (f?: AnalyticsFilters) => request<any[]>(`/analytics/app-performance${filterQS(f)}`),
  getQualityData: (days?: number, f?: AnalyticsFilters) => request<any[]>(`/analytics/quality${filterQS(f, { days: days ?? 30 })}`),
  getManagerView: () => request<any>('/analytics/manager-view'),
  getPlantView: (params?: { site_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.site_id) qs.set('site_id', params.site_id);
    const s = qs.toString();
    return request<any>(`/analytics/plant-view${s ? `?${s}` : ''}`);
  },
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
  getDashboardData: (id: string) => request<any>(`/dashboards/${id}/data`),

  // ── Inventory
  getInventoryItems: (params?: { category?: string; search?: string; low_stock?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set('category', params.category);
    if (params?.search)   qs.set('search', params.search);
    if (params?.low_stock) qs.set('low_stock', '1');
    return request<any[]>(`/inventory/items?${qs}`);
  },
  getInventorySummary: () => request<any>('/inventory/items/summary'),
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
    return request<any[]>(`/inventory/movements?${qs}`);
  },

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
  createCheckout: (payload: { tier?: string; addon?: 'app_slot' | 'dashboard_slot'; quantity?: number }) =>
    request<{ url: string }>('/config/plan/checkout', { method: 'POST', body: JSON.stringify(payload) }),
  createBillingPortal: () => request<{ url: string }>('/config/plan/portal', { method: 'POST' }),

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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_name, display_name, email, password }),
    }).then(async res => {
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error(data.error || 'Signup failed'), { status: res.status });
      return data;
    }),
  logout: () => request<any>('/auth/logout', { method: 'POST' }),
  getMe: () => request<any>('/auth/me'),
  changePassword: (current_password: string, new_password: string) =>
    request<any>('/auth/change-password', { method: 'PUT', body: JSON.stringify({ current_password, new_password }) }),

  // ── Leaderboard
  getLeaderboard: (period: LeaderboardPeriod = 'week') =>
    request<LeaderboardResponse>(`/leaderboard?period=${period}`),

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
  getAuditLog: (params?: { entity_type?: string; actor?: string; from?: string; to?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.entity_type) qs.set('entity_type', params.entity_type);
    if (params?.actor)       qs.set('actor', params.actor);
    if (params?.from)        qs.set('from', params.from);
    if (params?.to)          qs.set('to', params.to);
    if (params?.limit)       qs.set('limit', String(params.limit));
    const s = qs.toString();
    return request<AuditLogEntry[]>(`/activity${s ? `?${s}` : ''}`);
  },
  downloadAuditLog: (params?: { entity_type?: string; actor?: string; from?: string; to?: string }) => {
    const qs = new URLSearchParams();
    if (params?.entity_type) qs.set('entity_type', params.entity_type);
    if (params?.actor)       qs.set('actor', params.actor);
    if (params?.from)        qs.set('from', params.from);
    if (params?.to)          qs.set('to', params.to);
    const s = qs.toString();
    return downloadBlob(`/activity/export${s ? `?${s}` : ''}`, 'audit-log-export.csv');
  },

  // ── Sample data
  loadSampleData: () => request<any>('/config/sample-data', { method: 'POST' }),

  // ── SSO
  getSSOProviders: () => request<SSOProviderInfo[]>('/auth/sso/providers'),

  // ── Product Routings
  getRoutings: () => request<any[]>('/routings'),
  getRouting: (id: string) => request<any>(`/routings/${id}`),
  createRouting: (data: any) => request<any>('/routings', { method: 'POST', body: JSON.stringify(data) }),
  updateRouting: (id: string, data: any) => request<any>(`/routings/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRouting: (id: string) => request<any>(`/routings/${id}`, { method: 'DELETE' }),
  createRoutingStep: (routingId: string, data: any) => request<any>(`/routings/${routingId}/steps`, { method: 'POST', body: JSON.stringify(data) }),
  updateRoutingStep: (routingId: string, stepId: string, data: any) => request<any>(`/routings/${routingId}/steps/${stepId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRoutingStep: (routingId: string, stepId: string) => request<any>(`/routings/${routingId}/steps/${stepId}`, { method: 'DELETE' }),
  reorderRoutingSteps: (routingId: string, steps: { id: string; step_number: number }[]) =>
    request<any>(`/routings/${routingId}/steps/reorder`, { method: 'PUT', body: JSON.stringify({ steps }) }),

  // ── File upload
  uploadImage: (data: string, mimeType: string, filename: string) =>
    request<{ url: string }>('/upload/image', { method: 'POST', body: JSON.stringify({ data, mimeType, filename }) }),
};
