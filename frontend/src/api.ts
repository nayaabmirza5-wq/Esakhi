import type {
  Address,
  AdminResolutionAction,
  DeliveryExceptionReasonCode,
  RiderRequestedAction,
  AddressSuggestion,
  AuditLogEntry,
  CityAdminDashboard,
  CityAdminDeliveryPartner,
  CityAdminOrder,
  CityAdminProduct,
  CityAdminSeller,
  CityAdminProfileData,
  CityAdminServiceZones,
  CustomerBankAccount,
  DeliveryPartnerApplication,
  DeliveryPartnerRecord,
  DamohDeliveryPartnerOnboardingPayload,
  Dashboard,
  DeliveryPartner,
  Locality,
  Order,
  PartnerLiveTrackingResponse,
  PartnerProfile,
  PartnerSettlementsResponse,
  PenaltyLedgerEntry,
  ProductCategory,
  PageResult,
  Product,
  ReturnFaultAttribution,
  ReturnReasonCode,
  SellerDashboard,
  SellerInventoryAdjustment,
  SellerOrder,
  SellerSettlementsResponse,
  ServiceArea,
  Settings,
  SellerApplication,
  SellerOnboardingPayload,
  SellerRecord,
  ShgLookupResult,
  SuperAdminOverview,
  SuperAdminCity,
  SuperAdminCitySummary,
  SuperAdminOrder,
  SuperAdminSettlementsLedgerResponse,
  User,
  SupportTicketItem,
  CityAdminSettlementItem,
  SellerPayoutSettlementItem,
  PartnerPayoutSettlementItem,
  PayoutRecordItem,
} from './types';

const baseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
let accessToken: string | null = (typeof window !== 'undefined' ? localStorage.getItem('token') : null);

export function resolveProductImageUrl(imageUrl: string): string {
  if (!imageUrl) return '';
  if (imageUrl.startsWith('data:') || imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }
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
  if (typeof window !== 'undefined') {
    if (token) localStorage.setItem('token', token);
    else localStorage.removeItem('token');
  }
}

type Envelope<T> = { success: boolean; data?: T; error?: { code?: string; message?: string; fields?: Record<string, string[]> }; pagination?: PageResult<unknown>['pagination'] };

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      credentials: 'include',
      signal: init.signal || controller.signal,
    });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'AbortError') {
      throw new ApiError(408, 'TIMEOUT', 'Request took too long to respond. Please check your connection and retry.');
    }
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach eSakhi right now. Check that the backend is running and try again.');
  } finally {
    clearTimeout(timeoutId);
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
  if (!payload) {
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server returned an unexpected response.');
  }
  const result = ('data' in payload && payload.data !== undefined) ? payload.data : payload;
  if (Array.isArray(result) && payload.pagination) {
    return { data: result, pagination: payload.pagination } as T;
  }
  return result as T;
}

export const api = {
  root: () => request<{ name: string; apiBase: string; health: string; readiness: string }>('/'),
  discovery: () => request<{ message: string; endpoints: string[]; health: string }>('/api/v1'),
  health: () => request<{ status: string }>('/health'),
  ready: () => request<{ status: string }>('/ready'),
  sendOtp: (phone: string, channel: 'phone' | 'email' = 'phone', email?: string) =>
    request<{ message: string; channel?: string; destination?: string }>('/api/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, channel, email }),
    }),
  requestOtp: (phone: string, channel: 'phone' | 'email' = 'phone', email?: string) =>
    request<{ message: string; channel?: string; destination?: string }>('/api/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, channel, email }),
    }),
  verifyOtp: (phone: string, otp: string, channel: 'phone' | 'email' = 'phone', email?: string) =>
    request<{ accessToken: string; token?: string; user: User; verified?: boolean; message?: string }>('/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, otp, code: otp, channel, email }),
    }, false),
  firebaseLogin: (idToken: string, role = 'customer') => request<{ accessToken: string; token?: string; user: User }>('/api/v1/auth/firebase-login', { method: 'POST', body: JSON.stringify({ idToken, role }) }, false),
  refresh: () => request<{ accessToken: string }>('/api/v1/auth/refresh', { method: 'POST' }, false),
  logout: () => request<{ message: string }>('/api/v1/auth/logout', { method: 'POST' }, false),
  me: () => request<User>('/api/v1/auth/me'),
  updateMe: (payload: { name: string; email?: string } | string) =>
    request<User & { savedAddresses?: Address[] }>('/api/v1/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(typeof payload === 'string' ? { name: payload } : payload),
    }),
  replaceAddresses: (addresses: Address[]) => request<Address[]>('/api/v1/auth/me/addresses', { method: 'PUT', body: JSON.stringify({ addresses }) }),
  addresses: () => request<Address[]>('/api/v1/auth/me/addresses'),
  createAddress: (address: Omit<Address, 'id' | '_id'>) => request<Address>('/api/v1/auth/me/addresses', { method: 'POST', body: JSON.stringify(address) }),
  updateAddress: (id: string, address: Partial<Omit<Address, 'id' | '_id'>>) => request<Address>(`/api/v1/auth/me/addresses/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(address) }),
  deleteAddress: (id: string) => request<{ deleted: boolean }>(`/api/v1/auth/me/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  setDefaultAddress: (id: string) => request<Address>(`/api/v1/auth/me/addresses/${encodeURIComponent(id)}/default`, { method: 'PUT' }),
  searchAddresses: (query: string, signal?: AbortSignal) => request<AddressSuggestion[]>(`/api/v1/auth/me/address-search?q=${encodeURIComponent(query)}`, { signal }),
  reverseAddress: (latitude: number, longitude: number, signal?: AbortSignal) => request<AddressSuggestion>(`/api/v1/auth/me/address-reverse?latitude=${latitude}&longitude=${longitude}`, { signal }),
  categories: () => request<ProductCategory[]>('/api/v1/categories'),
  categoryAlias: () => request<ProductCategory[]>('/api/v1/products/categories'),
  products: (query: URLSearchParams = new URLSearchParams()) => request<PageResult<Product>>(`/api/v1/products${query.size ? `?${query}` : ''}`),
  bestSellingProducts: (limit = 5) => request<Product[]>(`/api/v1/products/bestsellers?limit=${limit}`),
  product: (slug: string) => request<Product>(`/api/v1/products/${encodeURIComponent(slug)}`),
  serviceArea: () => request<ServiceArea>('/api/v1/service-area'),
  razorpayConfig: () => request<{ configured: boolean; keyId: string | null }>('/api/v1/payments/razorpay/config'),
  createRazorpayOrder: (orderId: string) =>
    request<{
      razorpayOrderId: string;
      amount: number;
      currency: string;
      keyId: string;
      mode: 'live' | 'mock';
      orderReference: string;
      customerName: string;
      customerPhone: string;
    }>('/api/v1/payments/razorpay/create-order', {
      method: 'POST',
      body: JSON.stringify({ orderId }),
    }),
  verifyRazorpayPayment: (payload: {
    orderId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }) =>
    request<{ verified: boolean; paymentStatus: string; orderReference?: string }>('/api/v1/payments/razorpay/verify-payment', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createOrder: (payload: Record<string, unknown>) => request<{ order: Order; paymentInstructions: Record<string, unknown> }>('/api/v1/orders', { method: 'POST', body: JSON.stringify(payload) }),
  myOrders: (page = 1, limit = 20) => request<PageResult<Order>>(`/api/v1/orders?page=${page}&limit=${limit}`),
  myOrder: (id: string) => request<Order>(`/api/v1/orders/${encodeURIComponent(id)}`),
  requestCancellation: (id: string, note?: string) => request<Order>(`/api/v1/orders/${encodeURIComponent(id)}/cancellation-requests`, { method: 'POST', body: JSON.stringify(note ? { note } : {}) }),
  cancelOrderDirect: (id: string, reason?: string) => request<Order>(`/api/v1/orders/${encodeURIComponent(id)}/cancel-direct`, { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) }),
  getCustomerBankAccount: () => request<{ bankAccount: CustomerBankAccount }>('/api/v1/orders/bank-account'),
  upsertCustomerBankAccount: (payload: { accountHolderName: string; accountNumber: string; ifscCode: string; bankName: string; upiId?: string }) =>
    request<{ bankAccount: CustomerBankAccount }>('/api/v1/orders/bank-account', { method: 'PUT', body: JSON.stringify(payload) }),
  submitReturnRequest: (
    orderId: string,
    payload: {
      reasonCode: ReturnReasonCode;
      reasonText: string;
      boxConditionImages: string[];
      productFaultImages: string[];
    },
  ) => request<Order>(`/api/v1/orders/${encodeURIComponent(orderId)}/return-request`, { method: 'POST', body: JSON.stringify(payload) }),
  registerPushToken: (token: string) => request<{ registered: boolean }>('/api/v1/notifications/push-token', { method: 'POST', body: JSON.stringify({ token }) }),
  removePushToken: (token: string) => request<{ removed: boolean }>('/api/v1/notifications/push-token', { method: 'DELETE', body: JSON.stringify({ token }) }),
  dashboard: () => request<Dashboard>('/api/v1/admin/dashboard'),
  superAdminOverview: (days = 30) => request<SuperAdminOverview>(`/api/v1/super-admin/overview?days=${days}`),
  superAdminSettlements: () => request<SuperAdminSettlementsLedgerResponse>('/api/v1/super-admin/settlements'),
  processSuperAdminRefund: (orderId: string, note?: string) =>
    request<SuperAdminOrder>(`/api/v1/super-admin/orders/${encodeURIComponent(orderId)}/process-refund`, {
      method: 'POST',
      body: JSON.stringify(note ? { note } : {}),
    }),
  settleSuperAdminPenalty: (penaltyId: string) =>
    request<PenaltyLedgerEntry>(`/api/v1/super-admin/penalties/${encodeURIComponent(penaltyId)}/settle`, { method: 'PATCH' }),
  superAdminOrders: (query: URLSearchParams = new URLSearchParams()) => request<PageResult<SuperAdminOrder>>(`/api/v1/super-admin/orders${query.size ? `?${query}` : ''}`),
  superAdminCities: () => request<SuperAdminCitySummary[]>('/api/v1/super-admin/cities'),
  superAdminCity: (city: string) => request<SuperAdminCity>(`/api/v1/super-admin/cities/${encodeURIComponent(city)}`),
  superAdminAddCityZone: (city: string, payload: { name: string; coveredLocalities: string[] | string; postalCodes?: string[] | string; deliveryFeePaise?: number }) =>
    request<{ success: boolean; serviceableLocalities: Locality[] }>(`/api/v1/super-admin/cities/${encodeURIComponent(city)}/zones`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  superAdminUpdateCityZone: (city: string, index: number, payload: { name: string; coveredLocalities: string[] | string; postalCodes?: string[] | string; deliveryFeePaise?: number }) =>
    request<{ success: boolean; serviceableLocalities: Locality[] }>(`/api/v1/super-admin/cities/${encodeURIComponent(city)}/zones/${index}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  superAdminDeleteCityZone: (city: string, index: number) =>
    request<{ success: boolean; serviceableLocalities: Locality[] }>(`/api/v1/super-admin/cities/${encodeURIComponent(city)}/zones/${index}`, {
      method: 'DELETE',
    }),
  superAdminCityAdmins: (page = 1, limit = 20) => request<PageResult<User>>(`/api/v1/super-admin/city-admins?page=${page}&limit=${limit}`),
  superAdminCityAdmin: (id: string) => request<User>(`/api/v1/super-admin/city-admins/${encodeURIComponent(id)}`),
  createCityAdmin: (payload: {
    phone: string;
    name: string;
    city: string;
    email?: string;
    residentialAddress?: string;
    aadhaarNumber?: string;
    compensationRate?: string;
    payerText?: string;
    bankAccount: {
      accountHolderName: string;
      accountNumber: string;
      ifscCode: string;
      bankName: string;
      upiId?: string;
    };
  }) => request<User>('/api/v1/super-admin/city-admins', { method: 'POST', body: JSON.stringify(payload) }),
  updateCityAdmin: (id: string, payload: {
    city?: string;
    name?: string;
    email?: string;
    status?: 'active' | 'disabled';
    bankAccount?: {
      accountHolderName?: string;
      accountNumber?: string;
      ifscCode?: string;
      bankName?: string;
      upiId?: string;
    };
  }) => request<User>(`/api/v1/super-admin/city-admins/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  superAdminSellers: (page = 1, limit = 20) => request<PageResult<User>>(`/api/v1/super-admin/sellers?page=${page}&limit=${limit}`),
  superAdminSeller: (id: string) => request<User>(`/api/v1/super-admin/sellers/${encodeURIComponent(id)}`),
  superAdminAuditLogs: (page = 1, limit = 20) => request<PageResult<AuditLogEntry>>(`/api/v1/super-admin/audit-logs?page=${page}&limit=${limit}`),
  superAdminSupportTickets: (status?: string, category?: string, city?: string) => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (category) q.set('category', category);
    if (city) q.set('city', city);
    return request<SupportTicketItem[]>(`/api/v1/super-admin/support-tickets${q.size ? `?${q}` : ''}`);
  },
  resolveSuperAdminSupportTicket: (id: string, payload: { status: 'action_taken' | 'resolved' | 'closed'; decisionNote: string; actionTaken?: string }) =>
    request<SupportTicketItem>(`/api/v1/super-admin/support-tickets/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  superAdminCityAdminSettlements: () => request<CityAdminSettlementItem[]>('/api/v1/super-admin/settlements/city-admins'),
  superAdminSellerSettlements: () => request<SellerPayoutSettlementItem[]>('/api/v1/super-admin/settlements/sellers'),
  superAdminPartnerSettlements: () => request<PartnerPayoutSettlementItem[]>('/api/v1/super-admin/settlements/delivery-partners'),
  recordSuperAdminDisbursement: (payload: {
    beneficiaryType: 'city_admin' | 'seller' | 'delivery_partner';
    beneficiaryId: string;
    paymentMethod: 'upi_intent' | 'bank_transfer' | 'razorpay_manual';
    utrReference: string;
    notes?: string;
  }) => request<PayoutRecordItem>('/api/v1/super-admin/settlements/disburse', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  cityAdminSupportTickets: () => request<SupportTicketItem[]>('/api/v1/city-admin/support-tickets'),
  createCityAdminSupportTicket: (payload: {
    category: string;
    priority: string;
    subject: string;
    description: string;
    relatedOrderReference?: string;
    relatedParty?: { partyType: string; name?: string; phoneE164?: string };
  }) => request<SupportTicketItem>('/api/v1/city-admin/support-tickets', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  cityAdminProfile: () => request<CityAdminProfileData>('/api/v1/city-admin/profile'),
  cityAdminDashboard: () => request<CityAdminDashboard>('/api/v1/city-admin/dashboard'),
  cityAdminServiceZones: () => request<CityAdminServiceZones>('/api/v1/city-admin/service-zones'),
  requestCityAdminServiceZoneChange: (requestText: string) => request<{ id: string; city: string; status: string; createdAt: string }>('/api/v1/city-admin/service-zone-change-requests', { method: 'POST', body: JSON.stringify({ requestText }) }),
  cityAdminSellers: (query: URLSearchParams = new URLSearchParams()) => request<PageResult<CityAdminSeller>>(`/api/v1/city-admin/sellers${query.size ? `?${query}` : ''}`),
  cityAdminProducts: (query: URLSearchParams = new URLSearchParams()) => request<PageResult<CityAdminProduct>>(`/api/v1/city-admin/products${query.size ? `?${query}` : ''}`),
  reviewCityAdminProduct: (productId: string, payload: { decision: 'approved' | 'rejected'; note?: string; categoryId?: string; subcategoryId?: string; productType?: string }) => request<{ productId: string; approvalStatus: 'approved' | 'rejected'; isActive: boolean }>(`/api/v1/city-admin/products/${encodeURIComponent(productId)}/review`, { method: 'PATCH', body: JSON.stringify(payload) }),
  flagCityAdminProduct: (productId: string, reason: string) => request<{ id: string; productId: string; status: string; createdAt: string }>(`/api/v1/city-admin/products/${encodeURIComponent(productId)}/flags`, { method: 'POST', body: JSON.stringify({ reason }) }),
  cityAdminRemittanceSummary: () =>
    request<import('./types').CityAdminRemittanceSummary>('/api/v1/city-admin/remittance/summary'),
  cityAdminSettleRemittance: (partnerId: string, amountPaise: number, handshakePin: string, notes?: string) =>
    request<import('./types').SettleRemittanceResponse>('/api/v1/city-admin/remittance/settle', {
      method: 'POST',
      body: JSON.stringify({ partnerId, amountPaise, handshakePin, notes }),
    }),
  partnerRegenerateRemittancePin: () =>
    request<{ remittancePin: string; expiresInSeconds?: number; generatedAt: string; expiresAt?: string }>('/api/v1/delivery-partners/remittance-pin/regenerate', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  partnerRemitViaUpi: () =>
    request<import('./types').SettleRemittanceResponse>('/api/v1/delivery-partners/remit-cash-upi', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  cityAdminDeliveryPartners: (page = 1, limit = 20, options?: { orderId?: string; sellerLat?: number; sellerLng?: number } | number, sellerLng?: number) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (typeof options === 'number' && sellerLng !== undefined) {
      params.set('sellerLat', String(options));
      params.set('sellerLng', String(sellerLng));
    } else if (options && typeof options === 'object') {
      if (options.orderId) params.set('orderId', options.orderId);
      if (options.sellerLat !== undefined && options.sellerLng !== undefined) {
        params.set('sellerLat', String(options.sellerLat));
        params.set('sellerLng', String(options.sellerLng));
      }
    }
    return request<PageResult<CityAdminDeliveryPartner>>(`/api/v1/city-admin/delivery-partners?${params}`);
  },
  cityAdminDeliveryPartnerApplications: (query: URLSearchParams = new URLSearchParams()) => request<PageResult<DeliveryPartnerApplication>>(`/api/v1/city-admin/delivery-partner-applications${query.size ? `?${query}` : ''}`),
    onboardDeliveryPartner: (payload: DamohDeliveryPartnerOnboardingPayload) =>
    request<{
      partner: DeliveryPartnerRecord;
      user: User;
      accessToken: string;
      token: string;
      message: string;
    }>('/api/v1/delivery-partner-applications/onboard', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  submitDeliveryPartnerApplication: (payload: {
    name: string;
    phone: string;
    city: string;
    requestedLocalities: string[];
    applicantNote?: string;
    selfieUrl?: string;
    emergencyContactName?: string;
    emergencyContactRel?: string;
    emergencyContactPhone?: string;
    residentialAddress?: string;
    pincode?: string;
    vehicleType: 'BICYCLE' | 'MOTORCYCLE';
    govIdUrl?: string;
    dlNumber?: string;
    dlExpiryDate?: string;
    vehicleRcNumber?: string;
    dlFrontUrl?: string;
    dlBackUrl?: string;
    passbookDocUrl?: string;
    accountNumber?: string;
    confirmAccountNumber?: string;
    ifscCode?: string;
    bankName?: string;
    branchName?: string;
    upiVpa?: string;
  }) => request<{ status: string; message: string; applicationId?: string }>('/api/v1/delivery-partner-applications', { method: 'POST', body: JSON.stringify(payload) }),
  reviewDeliveryPartnerApplication: (
    id: string,
    decision: 'approved' | 'rejected' | 'needs_info' | 'action_required',
    note?: string,
    flaggedFields?: string[],
  ) =>
    request<{ applicationId: string; status: string; partnerId?: string; flaggedFields?: string[] }>(
      `/api/v1/city-admin/delivery-partner-applications/${encodeURIComponent(id)}/review`,
      { method: 'PATCH', body: JSON.stringify({ decision, ...(note ? { note } : {}), ...(flaggedFields ? { flaggedFields } : {}) }) },
    ),
  cityAdminOrder: (id: string) => request<Order>(`/api/v1/city-admin/orders/${encodeURIComponent(id)}`),
  trackOrderPartner: (orderId: string) => request<PartnerLiveTrackingResponse>(`/api/v1/city-admin/track/partner/${encodeURIComponent(orderId)}`),
  assignCityAdminDeliveryPartner: (id: string, payload: { partnerId: string; reassignmentReason?: string }) => request<Order>(`/api/v1/city-admin/orders/${encodeURIComponent(id)}/delivery-partner`, { method: 'PUT', body: JSON.stringify(payload) }),
  arbitrateCityAdminReturnDispute: (
    orderId: string,
    payload: {
      decision: 'approved' | 'rejected';
      faultAttribution?: ReturnFaultAttribution;
      penaltyAmountRupees?: number;
      reviewNote: string;
    },
  ) => request<Order>(`/api/v1/city-admin/orders/${encodeURIComponent(orderId)}/return-arbitration`, { method: 'POST', body: JSON.stringify(payload) }),
  assignCityAdminReversePartner: (orderId: string, payload: { partnerId: string; note?: string }) =>
    request<Order>(`/api/v1/city-admin/orders/${encodeURIComponent(orderId)}/reverse-partner`, { method: 'PUT', body: JSON.stringify(payload) }),
  escalateCityAdminOrderRefund: (orderId: string, note?: string) =>
    request<Order>(`/api/v1/city-admin/orders/${encodeURIComponent(orderId)}/escalate-refund`, { method: 'POST', body: JSON.stringify(note ? { note } : {}) }),
  cityAdminOrders: (query: URLSearchParams = new URLSearchParams()) => request<PageResult<CityAdminOrder>>(`/api/v1/city-admin/orders${query.size ? `?${query}` : ''}`),
  cityAdminEscalatedOrders: (query: URLSearchParams = new URLSearchParams()) =>
    request<PageResult<CityAdminOrder>>(`/api/v1/city-admin/orders/escalations${query.size ? `?${query}` : ''}`),
  resolveCityAdminDeliveryFailure: (
    orderId: string,
    payload: {
      action: AdminResolutionAction;
      newRiderId?: string;
      partnerId?: string;
      adminNotes?: string;
    },
  ) => request<Order>(`/api/v1/city-admin/orders/${encodeURIComponent(orderId)}/delivery-resolution`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  submitSellerApplication: (payload: { shgName: string; representative: string; phone: string; city: string; address: string; categoryId: string; subcategoryId: string; productType: string; fssaiRegistrationNumber?: string }) => request<{ status: string; message: string }>('/api/v1/seller-applications', { method: 'POST', body: JSON.stringify(payload) }),
  cityAdminSellerApplications: (query: URLSearchParams = new URLSearchParams()) => request<PageResult<SellerApplication>>(`/api/v1/seller-applications${query.size ? `?${query}` : ''}`),
  reviewSellerApplication: (id: string, decision: 'approved' | 'rejected' | 'needs_info', note?: string, fssaiDecision?: 'verified' | 'needs_info') => request<{ applicationId: string; status: string; sellerId?: string }>(`/api/v1/seller-applications/${encodeURIComponent(id)}/review`, { method: 'PATCH', body: JSON.stringify({ decision, ...(note ? { note } : {}), ...(fssaiDecision ? { fssaiDecision } : {}) }) }),
  sellerDashboard: () => request<SellerDashboard>('/api/v1/seller/dashboard'),
  onboardSeller: (payload: SellerOnboardingPayload) =>
    request<{
      seller: SellerRecord;
      user: User;
      accessToken: string;
      token: string;
      message: string;
    }>('/api/v1/seller/onboard', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  initiateEnrolment: (payload: { panNumber: string; phone?: string; applicantName?: string; state?: string; district?: string }) =>
    request<{
      sessionId: string;
      pan: string;
      maskedPhone: string;
      demoOtp: string;
      expiresInSeconds: number;
      message: string;
    }>('/api/v1/seller/initiate-enrolment', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  confirmEnrolment: (payload: { sessionId: string; panNumber: string; otp: string; applicantName?: string; state?: string; district?: string }) =>
    request<{
      enrolmentId: string;
      pan: string;
      cardholderName: string;
      status: string;
      gstnRegistrationStatus: string;
      stateCode: string;
      stateName: string;
      district: string;
      notificationBasis: string;
      certificateNumber: string;
      turnoverLimit: string;
      verifiedAt: string;
    }>('/api/v1/seller/confirm-enrolment', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  verifyEnrolmentId: (payload: { enrolmentId: string; panNumber?: string }) =>
    request<{
      isValid: boolean;
      enrolmentId: string;
      status: string;
      pan: string;
      cardholderName: string;
      legalNameOfBusiness?: string;
      tradeName?: string;
      effectiveDateOfCreation?: string;
      stateJurisdiction?: string;
      stateCode: string;
      stateName: string;
      legalCategory: string;
      notificationNumber: string;
      turnoverThreshold: string;
      verifiedAt: string;
      gstnRegistryConfirmation: string;
    }>('/api/v1/seller/verify-enrolment-id', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  verifyGstin: (payload: { gstin: string; panNumber?: string; declaredLegalName?: string; declaredTradeName?: string }) =>
    request<{
      isValid: boolean;
      gstin: string;
      status: string;
      legalNameOfBusiness: string;
      tradeName: string;
      effectiveDateOfCreation: string;
      registrationDate: string;
      stateJurisdiction: string;
      constitutionOfBusiness: string;
      taxpayerType: string;
      stateCode: string;
      stateName?: string;
      embeddedPan: string;
      checksumValid?: boolean;
      requiresNameDeclaration?: boolean;
      verifiedSource?: string;
      verifiedAt: string;
      gstnRegistryConfirmation: string;
    }>('/api/v1/seller/verify-gstin', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateEnrolmentId: (payload: { panNumber: string; applicantName?: string; state?: string; district?: string }) =>
    request<{
      enrolmentId: string;
      pan: string;
      stateCode: string;
      stateName: string;
      district: string;
      applicantName: string;
      status: string;
      notificationNumber: string;
      turnoverThreshold: string;
      exemptionScope: string;
      certificateNumber: string;
      isGovernmentLiveRegistered?: boolean;
      governmentRegistrationUrl?: string;
      generatedAt: string;
    }>('/api/v1/seller/generate-enrolment-id', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  verifyPan: (panNumber: string, declaredName?: string) =>
    request<{
      isValid: boolean;
      pan: string;
      cardholderName: string;
      entityCode: string;
      entityName: string;
      surnameInitial: string;
      panStatus: string;
      aadhaarSeeded: boolean;
      isCustomDeclared?: boolean;
      verifiedSource: string;
      verifiedAt: string;
    }>('/api/v1/seller/verify-pan', {
      method: 'POST',
      body: JSON.stringify({ panNumber, declaredName }),
    }),
  lookupShg: (code: string) =>
    request<ShgLookupResult>(`/api/v1/seller/shg-lookup/${encodeURIComponent(code)}`),
  getSellerProfile: () =>
    request<{
      seller: SellerRecord;
      user: User;
      status: string;
    }>('/api/v1/seller/profile'),
  sellerSettlements: () => request<SellerSettlementsResponse>('/api/v1/seller/settlements'),
  updateSellerProfile: (payload: { shgName: string; representative: string; registeredAddress: string; storeDescription: string }) => request<Pick<NonNullable<SellerDashboard['storeProfile']>, 'shgName' | 'representative' | 'registeredAddress' | 'storeDescription' | 'city' | 'phoneE164' | 'fssaiStatus'>>('/api/v1/seller/profile', { method: 'PATCH', body: JSON.stringify(payload) }),
  sellerProducts: (query: URLSearchParams = new URLSearchParams()) => request<PageResult<Product>>(`/api/v1/seller/products${query.size ? `?${query}` : ''}`),
  uploadSellerProductImage: (file: File) => {
    const body = new FormData();
    body.append('image', file);
    return request<{ imageUrl: string }>('/api/v1/seller/products/images', { method: 'POST', body });
  },
  createSellerProduct: (payload: { name: string; slug: string; description: string; categoryId: string; subcategoryId: string; productType: string; pricePaise: number; imageUrls?: string[]; stock: number; lowStockThreshold: number }) => request<Product>('/api/v1/seller/products', { method: 'POST', body: JSON.stringify(payload) }),
  adjustSellerInventory: (productId: string, payload: { quantityChange: number; reason: string; variantId?: string }) => request<Product>(`/api/v1/seller/products/${encodeURIComponent(productId)}/inventory-adjustments`, { method: 'POST', body: JSON.stringify(payload) }),
  sellerInventoryHistory: (productId: string, page = 1, limit = 20) => request<PageResult<SellerInventoryAdjustment>>(`/api/v1/seller/products/${encodeURIComponent(productId)}/inventory-adjustments?page=${page}&limit=${limit}`),
  sellerOrders: (page = 1, limit = 20, status: 'all' | 'new' | 'processing' | 'ready' | 'completed' | 'cancelled' = 'all') => request<PageResult<SellerOrder>>(`/api/v1/seller/orders?page=${page}&limit=${limit}&status=${status}`),
  uploadSellerOrderInspectionImages: (orderId: string, payload: { imageUrls: string[]; inspectionNote?: string }) =>
    request<SellerOrder>(`/api/v1/seller/orders/${encodeURIComponent(orderId)}/inspection-images`, { method: 'POST', body: JSON.stringify(payload) }),
  updateSellerOrderStatus: (orderId: string, status: 'accepted' | 'preparing' | 'ready_for_pickup' | 'completed', note?: string, inspectionImageUrls?: string[]) =>
    request<SellerOrder>(`/api/v1/seller/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        ...(note ? { note } : {}),
        ...(inspectionImageUrls && inspectionImageUrls.length === 5 ? { inspectionImageUrls } : {}),
      }),
    }),
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
  partnerProfile: () => request<PartnerProfile>('/api/v1/delivery-partners/profile'),
  updatePartnerAvailability: (payload: { isOnline?: boolean; availabilityStatus?: 'available' | 'busy' | 'offline'; latitude?: number; longitude?: number }) => request<{ _id: string; isOnline: boolean; availabilityStatus: 'available' | 'busy' | 'offline'; currentLocation: { latitude: number; longitude: number; updatedAt?: string } }>('/api/v1/delivery-partners/availability', { method: 'PATCH', body: JSON.stringify(payload) }),
  partnerOrders: () => request<Order[]>('/api/v1/delivery-partners/orders'),
  partnerOrderHistory: () => request<Order[]>('/api/v1/delivery-partners/orders/history'),
  partnerSettlements: () => request<PartnerSettlementsResponse>('/api/v1/delivery-partners/settlements'),
  reportPartnerDeliveryFailure: (
    id: string,
    payload: {
      reasonCode: DeliveryExceptionReasonCode;
      reasonNotes?: string;
      proofImageUrl?: string;
      riderRequestedAction?: RiderRequestedAction;
    },
  ) => request<Order>(`/api/v1/delivery-partners/orders/${encodeURIComponent(id)}/delivery-failure`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  updatePartnerOrderStatus: (
    id: string,
    status: 'out_for_pickup' | 'picked_up' | 'out_for_delivery' | 'delivered' | 'delivery_failed' | 'return_picked_up' | 'return_delivered_to_seller',
    note?: string,
    paymentCollected?: boolean,
    deliveryOtp?: string,
    paymentMode?: 'cash' | 'upi_qr' | 'prepaid_online',
    upiUtr?: string,
  ) => request<Order>(`/api/v1/delivery-partners/orders/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({
      status,
      ...(note ? { note } : {}),
      ...(paymentCollected !== undefined ? { paymentCollected } : {}),
      ...(deliveryOtp ? { deliveryOtp } : {}),
      ...(paymentMode ? { paymentMode } : {}),
      ...(upiUtr ? { upiUtr } : {}),
    }),
  }),
  updatePartnerReverseOrderStatus: (
    id: string,
    status: 'return_picked_up' | 'return_delivered_to_seller',
    note?: string,
  ) => request<Order>(`/api/v1/delivery-partners/orders/${encodeURIComponent(id)}/reverse-status`, {
    method: 'PATCH',
    body: JSON.stringify({
      status,
      ...(note ? { note } : {}),
    }),
  }),
  broadcastPartnerOrderLocation: (id: string, latitude: number, longitude: number) => request<{
    orderId: string;
    fulfilmentStatus: string;
    streamStatus: 'GPS_STREAM_ACTIVE' | 'GPS_STREAM_INACTIVE';
    active: boolean;
    latitude?: number;
    longitude?: number;
    distanceKm?: number;
    updatedAt?: string;
    message?: string;
  }>(`/api/v1/delivery-partners/orders/${encodeURIComponent(id)}/location`, {
    method: 'POST',
    body: JSON.stringify({ latitude, longitude }),
  }),
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
let sessionRefreshListeners: Array<(refreshed: boolean) => void> = [];

export function onSessionRefresh(listener: (refreshed: boolean) => void): () => void {
  sessionRefreshListeners.push(listener);
  return () => {
    sessionRefreshListeners = sessionRefreshListeners.filter((existing) => existing !== listener);
  };
}

export function refreshSession(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const data = await api.refresh();
      setAccessToken(data.accessToken);
      for (const listener of sessionRefreshListeners) listener(true);
      return true;
    } catch {
      setAccessToken(null);
      for (const listener of sessionRefreshListeners) listener(false);
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}
