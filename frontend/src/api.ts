import type {
  Address,
  AuditLogEntry,
  CityAdminDashboard,
  CityAdminOrder,
  Dashboard,
  DeliveryPartner,
  Order,
  PageResult,
  Product,
  SellerDashboard,
  SellerOrder,
  ServiceArea,
  Settings,
  SuperAdminOverview,
  SuperAdminCity,
  SuperAdminCitySummary,
  SuperAdminOrder,
  User,
} from './types';

const baseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
let accessToken: string | null = null;

export function resolveProductImageUrl(imageUrl: string): string {
  return new URL(imageUrl, baseUrl || window.location.origin).toString();
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string[]>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string[]>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

type Envelope<T> = { success: boolean; data?: T; error?: { code?: string; message?: string; fields?: Record<string, string[]> }; pagination?: PageResult<unknown>['pagination'] };

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach eSakhi right now. Check that the backend is running and try again.');
  }

  if (response.status === 401 && retry && !path.endsWith('/auth/refresh') && !path.includes('/auth/otp/')) {
    const refreshed = await refreshSession().catch(() => false);
    if (refreshed) return request<T>(path, init, false);
  }

  const payload = await response.json().catch(() => null) as Envelope<T> | null;
  if (!response.ok || payload?.success === false) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'REQUEST_FAILED',
      payload?.error?.message ?? `Request failed (${response.status}).`,
      payload?.error?.fields,
    );
  }
  if (!payload || !('data' in payload)) {
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server returned an unexpected response.');
  }
  if (Array.isArray(payload.data) && payload.pagination) {
    return { data: payload.data, pagination: payload.pagination } as T;
  }
  return payload.data as T;
}

export const api = {
  root: () => request<{ name: string; apiBase: string; health: string; readiness: string }>('/'),
  discovery: () => request<{ message: string; endpoints: string[]; health: string }>('/api/v1'),
  health: () => request<{ status: string }>('/health'),
  ready: () => request<{ status: string }>('/ready'),
  requestOtp: (phone: string) => request<{ message: string }>('/api/v1/auth/otp/request', { method: 'POST', body: JSON.stringify({ phone }) }),
  verifyOtp: (phone: string, code: string) => request<{ accessToken: string; user: User }>('/api/v1/auth/otp/verify', { method: 'POST', body: JSON.stringify({ phone, code }) }, false),
  refresh: () => request<{ accessToken: string }>('/api/v1/auth/refresh', { method: 'POST' }, false),
  logout: () => request<{ message: string }>('/api/v1/auth/logout', { method: 'POST' }, false),
  me: () => request<User>('/api/v1/auth/me'),
  updateMe: (name: string) => request<User & { savedAddresses?: Address[] }>('/api/v1/auth/me', { method: 'PATCH', body: JSON.stringify({ name }) }),
  replaceAddresses: (addresses: Address[]) => request<Address[]>('/api/v1/auth/me/addresses', { method: 'PUT', body: JSON.stringify({ addresses }) }),
  categories: () => request<string[]>('/api/v1/categories'),
  categoryAlias: () => request<string[]>('/api/v1/products/categories'),
  products: (query: URLSearchParams = new URLSearchParams()) => request<PageResult<Product>>(`/api/v1/products${query.size ? `?${query}` : ''}`),
  bestSellingProducts: (limit = 5) => request<Product[]>(`/api/v1/products/bestsellers?limit=${limit}`),
  product: (slug: string) => request<Product>(`/api/v1/products/${encodeURIComponent(slug)}`),
  serviceArea: () => request<ServiceArea>('/api/v1/service-area'),
  createOrder: (payload: Record<string, unknown>) => request<{ order: Order; paymentInstructions: Record<string, unknown> }>('/api/v1/orders', { method: 'POST', body: JSON.stringify(payload) }),
  myOrders: (page = 1, limit = 20) => request<PageResult<Order>>(`/api/v1/orders?page=${page}&limit=${limit}`),
  myOrder: (id: string) => request<Order>(`/api/v1/orders/${encodeURIComponent(id)}`),
  requestCancellation: (id: string, note?: string) => request<Order>(`/api/v1/orders/${encodeURIComponent(id)}/cancellation-requests`, { method: 'POST', body: JSON.stringify(note ? { note } : {}) }),
  registerPushToken: (token: string) => request<{ registered: boolean }>('/api/v1/notifications/push-token', { method: 'POST', body: JSON.stringify({ token }) }),
  removePushToken: (token: string) => request<{ removed: boolean }>('/api/v1/notifications/push-token', { method: 'DELETE', body: JSON.stringify({ token }) }),
  dashboard: () => request<Dashboard>('/api/v1/admin/dashboard'),
  superAdminOverview: (days = 30) => request<SuperAdminOverview>(`/api/v1/super-admin/overview?days=${days}`),
  superAdminOrders: (query: URLSearchParams = new URLSearchParams()) => request<PageResult<SuperAdminOrder>>(`/api/v1/super-admin/orders${query.size ? `?${query}` : ''}`),
  superAdminCities: () => request<SuperAdminCitySummary[]>('/api/v1/super-admin/cities'),
  superAdminCity: (city: string) => request<SuperAdminCity>(`/api/v1/super-admin/cities/${encodeURIComponent(city)}`),
  superAdminCityAdmins: (page = 1, limit = 20) => request<PageResult<User>>(`/api/v1/super-admin/city-admins?page=${page}&limit=${limit}`),
  superAdminCityAdmin: (id: string) => request<User>(`/api/v1/super-admin/city-admins/${encodeURIComponent(id)}`),
  createCityAdmin: (payload: { phone: string; name?: string; email?: string; city?: string }) => request<User>('/api/v1/super-admin/city-admins', { method: 'POST', body: JSON.stringify(payload) }),
  updateCityAdmin: (id: string, payload: { city?: string; name?: string; email?: string; status?: 'active' | 'disabled' }) => request<User>(`/api/v1/super-admin/city-admins/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  superAdminSellers: (page = 1, limit = 20) => request<PageResult<User>>(`/api/v1/super-admin/sellers?page=${page}&limit=${limit}`),
  superAdminSeller: (id: string) => request<User>(`/api/v1/super-admin/sellers/${encodeURIComponent(id)}`),
  superAdminAuditLogs: (page = 1, limit = 20) => request<PageResult<AuditLogEntry>>(`/api/v1/super-admin/audit-logs?page=${page}&limit=${limit}`),
  cityAdminDashboard: () => request<CityAdminDashboard>('/api/v1/city-admin/dashboard'),
  cityAdminOrders: (query: URLSearchParams = new URLSearchParams()) => request<PageResult<CityAdminOrder>>(`/api/v1/city-admin/orders${query.size ? `?${query}` : ''}`),
  sellerDashboard: () => request<SellerDashboard>('/api/v1/seller/dashboard'),
  sellerProducts: (page = 1, limit = 20) => request<PageResult<Product>>(`/api/v1/seller/products?page=${page}&limit=${limit}`),
  sellerOrders: (page = 1, limit = 20) => request<PageResult<SellerOrder>>(`/api/v1/seller/orders?page=${page}&limit=${limit}`),
  deliveryPartners: (page = 1, limit = 100) => request<PageResult<DeliveryPartner>>(`/api/v1/admin/delivery-partners?page=${page}&limit=${limit}`),
  deliveryPartner: (id: string, page = 1, limit = 20) => request<{ partner: DeliveryPartner; orders: PageResult<Order> }>(`/api/v1/admin/delivery-partners/${encodeURIComponent(id)}?page=${page}&limit=${limit}`),
  updateDeliveryPartnerStatus: (id: string, status: 'active' | 'disabled') => request<DeliveryPartner>(`/api/v1/admin/delivery-partners/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  customers: (page = 1, limit = 20) => request<PageResult<User>>(`/api/v1/admin/customers?page=${page}&limit=${limit}`),
  customer: (id: string) => request<User & { orderCount: number }>(`/api/v1/admin/customers/${encodeURIComponent(id)}`),
  customerOrders: (id: string, page = 1, limit = 20) => request<PageResult<Order>>(`/api/v1/admin/customers/${encodeURIComponent(id)}/orders?page=${page}&limit=${limit}`),
  updateRole: (id: string, role: 'customer' | 'staff' | 'seller' | 'delivery_partner') => request<User>(`/api/v1/admin/users/${encodeURIComponent(id)}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  updateUserStatus: (id: string, status: 'active' | 'disabled') => request<User>(`/api/v1/admin/users/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  adminProducts: (query: URLSearchParams = new URLSearchParams()) => request<PageResult<Product>>(`/api/v1/admin/products${query.size ? `?${query}` : ''}`),
  adminProduct: (id: string) => request<Product>(`/api/v1/admin/products/${encodeURIComponent(id)}`),
  uploadProductImage: (file: File) => {
    const body = new FormData();
    body.append('image', file);
    return request<{ imageUrl: string }>('/api/v1/admin/products/images', { method: 'POST', body });
  },
  createProduct: (payload: Record<string, unknown>) => request<Product>('/api/v1/admin/products', { method: 'POST', body: JSON.stringify(payload) }),
  updateProduct: (id: string, payload: Record<string, unknown>) => request<Product>(`/api/v1/admin/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  archiveProduct: (id: string) => request<Product>(`/api/v1/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  adminOrders: (query: URLSearchParams = new URLSearchParams()) => request<PageResult<Order>>(`/api/v1/admin/orders${query.size ? `?${query}` : ''}`),
  adminOrder: (id: string) => request<Order>(`/api/v1/admin/orders/${encodeURIComponent(id)}`),
  fulfilOrder: (id: string, status: string, note?: string) => request<Order>(`/api/v1/admin/orders/${encodeURIComponent(id)}/fulfilment`, { method: 'PATCH', body: JSON.stringify(note ? { status, note } : { status }) }),
  assignDeliveryPartner: (id: string, payload: { partnerId?: string; name?: string; phone?: string; internalNotes?: string }) => request<Order>(`/api/v1/admin/orders/${encodeURIComponent(id)}/delivery-partner`, { method: 'PUT', body: JSON.stringify(payload) }),
  bulkAssignDeliveryPartner: (payload: { partnerId: string; orderIds: string[]; internalNotes?: string }) => request<Order[]>('/api/v1/admin/orders/delivery-partner-assignments', { method: 'POST', body: JSON.stringify(payload) }),
  partnerOrders: () => request<Order[]>('/api/v1/delivery-partners/orders'),
  partnerOrderHistory: () => request<Order[]>('/api/v1/delivery-partners/orders/history'),
  updatePartnerOrderStatus: (id: string, status: 'out_for_delivery' | 'delivered' | 'delivery_failed', note?: string) => request<Order>(`/api/v1/delivery-partners/orders/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify(note ? { status, note } : { status }) }),
  failedNotifications: (page = 1) => request<PageResult<FailedNotification>>(`/api/v1/admin/notifications?page=${page}&limit=20`),
  retryNotification: (id: string) => request<{ id: string; deliveryStatus: string }>(`/api/v1/admin/notifications/${encodeURIComponent(id)}/retry`, { method: 'POST' }),
  addOrderNote: (id: string, note: string) => request<Order>(`/api/v1/admin/orders/${encodeURIComponent(id)}/notes`, { method: 'POST', body: JSON.stringify({ note }) }),
  reviewPayment: (id: string, status: 'confirmed' | 'rejected', note: string) => request<Order>(`/api/v1/admin/orders/${encodeURIComponent(id)}/payment-review`, { method: 'POST', body: JSON.stringify({ status, note }) }),
  reviewCancellation: (id: string, decision: 'approved' | 'rejected', note?: string) => request<Order>(`/api/v1/admin/orders/${encodeURIComponent(id)}/cancellation-review`, { method: 'POST', body: JSON.stringify(note ? { decision, note } : { decision }) }),
  settings: () => request<Settings | null>('/api/v1/admin/settings'),
  saveSettings: (settings: Settings) => request<Settings>('/api/v1/admin/settings', {
    method: 'PUT',
    body: JSON.stringify({
      businessName: settings.businessName,
      phone: settings.phone,
      whatsapp: settings.whatsapp,
      address: settings.address,
      city: settings.city,
      state: settings.state,
      serviceableLocalities: settings.serviceableLocalities,
      pickupEnabled: settings.pickupEnabled,
      deliveryEnabled: settings.deliveryEnabled,
      staffEnabled: settings.staffEnabled,
      upiEnabled: settings.upiEnabled,
      upiId: settings.upiId,
      upiQrUrl: settings.upiQrUrl,
      upiInstructions: settings.upiInstructions,
      cashEnabled: settings.cashEnabled,
      cashInstructions: settings.cashInstructions,
      pickupInstructions: settings.pickupInstructions,
      stockReservationHours: settings.stockReservationHours,
      policies: settings.policies,
      lowStockThreshold: settings.lowStockThreshold,
    }),
  }),
  adjustInventory: (id: string, payload: { quantityChange: number; reason: string; variantId?: string }) => request<unknown>(`/api/v1/admin/inventory/${encodeURIComponent(id)}/adjustments`, { method: 'POST', body: JSON.stringify(payload) }),
};

export interface FailedNotification {
  _id: string;
  orderReference: string;
  status: string;
  attempts: number;
  lastErrorCode?: string;
  updatedAt: string;
}

let refreshPromise: Promise<boolean> | null = null;

export function refreshSession(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const data = await api.refresh();
      setAccessToken(data.accessToken);
      return true;
    } catch {
      setAccessToken(null);
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}
