const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export const api = {
  // Apps
  getApps: () => request<any[]>('/apps'),
  getApp: (id: string) => request<any>(`/apps/${id}`),
  createApp: (data: any) => request<any>('/apps', { method: 'POST', body: JSON.stringify(data) }),
  updateApp: (id: string, data: any) => request<any>(`/apps/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  publishApp: (id: string) => request<any>(`/apps/${id}/publish`, { method: 'POST' }),
  deleteApp: (id: string) => request<any>(`/apps/${id}`, { method: 'DELETE' }),
  getAppCompletions: (id: string) => request<any[]>(`/apps/${id}/completions`),

  // Completions
  getCompletions: (params?: { limit?: number; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.status) qs.set('status', params.status);
    return request<any[]>(`/completions?${qs}`);
  },
  getCompletion: (id: string) => request<any>(`/completions/${id}`),
  createCompletion: (data: any) => request<any>('/completions', { method: 'POST', body: JSON.stringify(data) }),
  updateCompletion: (id: string, data: any) => request<any>(`/completions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getAppHistory: (appId: string, page = 1, limit = 25) =>
    request<any>(`/completions/app/${appId}/history?page=${page}&limit=${limit}`),

  // Tables
  getTables: () => request<any[]>('/tables'),
  getTable: (id: string) => request<any>(`/tables/${id}`),
  createTable: (data: any) => request<any>('/tables', { method: 'POST', body: JSON.stringify(data) }),
  updateTable: (id: string, data: any) => request<any>(`/tables/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTable: (id: string) => request<any>(`/tables/${id}`, { method: 'DELETE' }),
  getRecords: (tableId: string) => request<any[]>(`/tables/${tableId}/records`),
  createRecord: (tableId: string, data: any) => request<any>(`/tables/${tableId}/records`, { method: 'POST', body: JSON.stringify({ data }) }),
  updateRecord: (tableId: string, recordId: string, data: any) => request<any>(`/tables/${tableId}/records/${recordId}`, { method: 'PUT', body: JSON.stringify({ data }) }),
  deleteRecord: (tableId: string, recordId: string) => request<any>(`/tables/${tableId}/records/${recordId}`, { method: 'DELETE' }),

  // Stations
  getStations: () => request<any[]>('/stations'),
  createStation: (data: any) => request<any>('/stations', { method: 'POST', body: JSON.stringify(data) }),
  updateStation: (id: string, data: any) => request<any>(`/stations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteStation: (id: string) => request<any>(`/stations/${id}`, { method: 'DELETE' }),

  // Departments
  getDepartments: () => request<any[]>('/departments'),
  createDepartment: (data: any) => request<any>('/departments', { method: 'POST', body: JSON.stringify(data) }),
  updateDepartment: (id: string, data: any) => request<any>(`/departments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDepartment: (id: string) => request<any>(`/departments/${id}`, { method: 'DELETE' }),

  // Work Orders
  getWorkOrders: () => request<any[]>('/work-orders'),
  getWorkOrder: (id: string) => request<any>(`/work-orders/${id}`),
  createWorkOrder: (data: any) => request<any>('/work-orders', { method: 'POST', body: JSON.stringify(data) }),
  updateWorkOrder: (id: string, data: any) => request<any>(`/work-orders/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWorkOrder: (id: string) => request<any>(`/work-orders/${id}`, { method: 'DELETE' }),
  completeWorkOrder: (id: string) => request<any>(`/work-orders/${id}/complete`, { method: 'PUT' }),

  // Product Types
  getProductTypes: (appId: string) => request<any[]>(`/product-types?app_id=${appId}`),
  createProductType: (data: any) => request<any>('/product-types', { method: 'POST', body: JSON.stringify(data) }),
  updateProductType: (id: string, data: any) => request<any>(`/product-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProductType: (id: string) => request<any>(`/product-types/${id}`, { method: 'DELETE' }),

  // Analytics
  getOverview: () => request<any>('/analytics/overview'),
  getThroughput: (days?: number) => request<any[]>(`/analytics/throughput?days=${days ?? 30}`),
  getCycleTimes: (days?: number) => request<any[]>(`/analytics/cycle-times?days=${days ?? 30}`),
  getOperatorPerformance: () => request<any[]>('/analytics/operator-performance'),
  getAppPerformance: () => request<any[]>('/analytics/app-performance'),
  getQualityData: (days?: number) => request<any[]>(`/analytics/quality?days=${days ?? 30}`),
  getManagerView: () => request<any>('/analytics/manager-view'),
  getPlantView: () => request<any>('/analytics/plant-view'),
  getCompletionDetail: (id: string) => request<any>(`/analytics/completion/${id}`),
  getStepMetrics: (appId: string, days?: number) => request<any>(`/analytics/step-metrics/${appId}?days=${days ?? 90}`),
  getCapacity: () => request<any>('/analytics/capacity'),

  // OEE
  getOEE: () => request<any[]>('/oee'),
  getOEEMachine: (id: string) => request<any>(`/oee/${id}`),
  logOEEEvent: (id: string, data: { event_type: string; reason?: string }) =>
    request<any>(`/oee/${id}/event`, { method: 'POST', body: JSON.stringify(data) }),
  updateOEESettings: (id: string, data: { planned_hours_per_day?: number; ideal_cycle_seconds?: number }) =>
    request<any>(`/oee/${id}/settings`, { method: 'PUT', body: JSON.stringify(data) }),
  getOEEHistory: (id: string) => request<any[]>(`/oee/${id}/history`),

  // Dashboards
  getDashboards: () => request<any[]>('/dashboards'),
  getDashboard: (id: string) => request<any>(`/dashboards/${id}`),
  createDashboard: (data: any) => request<any>('/dashboards', { method: 'POST', body: JSON.stringify(data) }),
  updateDashboard: (id: string, data: any) => request<any>(`/dashboards/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDashboard: (id: string) => request<any>(`/dashboards/${id}`, { method: 'DELETE' }),
  getDashboardData: (id: string) => request<any>(`/dashboards/${id}/data`),
};
