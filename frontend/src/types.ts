export type Role = 'customer' | 'staff' | 'admin' | 'city_admin' | 'seller' | 'delivery_partner' | 'super_admin';

export interface User {
  id: string;
  _id?: string;
  createdAt?: string;
  phone?: string;
  phoneE164?: string;
  name?: string;
  email?: string;
  role: Role;
  assignedCity?: string;
  status?: 'active' | 'disabled';
  savedAddresses?: Address[];
}

export interface Address {
  id?: string;
  _id?: string;
  label?: string;
  name: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  locality: string;
  city: string;
  state: string;
  postalCode: string;
}

export interface Variant {
  _id: string;
  sku?: string;
  attributes: Record<string, string>;
  stock: number;
}

export interface Product {
  _id: string;
  id?: string;
  sellerId?: string | null;
  name: string;
  slug: string;
  description: string;
  category: string;
  pricePaise: number;
  imageUrls: string[];
  stock: number;
  lowStockThreshold: number;
  variants: Variant[];
  isActive: boolean;
  isArchived: boolean;
}

export interface PageResult<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface OrderItem {
  productId: string;
  variantId?: string;
  productName: string;
  variantAttributes?: Record<string, string>;
  unitPricePaise: number;
  quantity: number;
  lineTotalPaise: number;
}

export interface Order {
  _id: string;
  orderReference: string;
  customerId?: string;
  customerName: string;
  customerPhoneE164?: string;
  customerPhone?: string;
  items: OrderItem[];
  subtotalPaise: number;
  deliveryFeePaise: number;
  totalPaise: number;
  paymentMethod: 'upi' | 'cash';
  paymentStatus: 'pending_verification' | 'confirmed' | 'rejected';
  fulfilmentMethod: 'delivery' | 'pickup';
  fulfilmentStatus: string;
  address?: Address;
  pickupInstructions?: string;
  statusHistory?: Array<{
    status: string;
    changedAt: string;
    actorType?: 'user' | 'system';
    note?: string;
  }>;
  deliveryPartner?: {
    userId?: string;
    name: string;
    phoneE164: string;
    assignedAt: string;
    internalNotes?: string;
  };
  deliveryPartnerHistory?: Array<{
    userId?: string;
    name: string;
    phoneE164: string;
    assignedAt: string;
    unassignedAt: string;
  }>;
  cancellationRequest?: {
    requestedAt?: string;
    customerNote?: string;
    decision?: 'approved' | 'rejected';
    adminNote?: string;
  };
  paymentEvents?: Array<{
    status: 'confirmed' | 'rejected' | 'pending_verification';
    note: string;
    createdAt: string;
  }>;
  internalNotes?: string[];
  createdAt?: string;
}

export interface DeliveryPartner extends Omit<User, 'id'> {
  id?: string;
  _id: string;
  role: 'delivery_partner';
  assignedCount: number;
}

export interface SellerOrder {
  _id: string;
  orderReference: string;
  fulfilmentMethod: 'delivery' | 'pickup';
  fulfilmentStatus: string;
  paymentStatus: 'pending_verification' | 'confirmed' | 'rejected';
  items: Array<{ productName: string; quantity: number; lineTotalPaise: number }>;
  subtotalPaise: number;
  createdAt: string;
}

export interface SellerDashboard {
  metrics: {
    activeProducts: number;
    lowStockProducts: number;
    totalProducts: number;
    newOrders: number;
    ordersToPrepare: number;
    readyOrders: number;
    completedOrders: number;
    grossPaidProductSalesThisMonthPaise: number;
  };
  recentOrders: SellerOrder[];
  unavailableMetrics: string[];
}

export interface Locality {
  name: string;
  postalCodes: string[];
  deliveryFeePaise?: number;
}

export interface Settings {
  businessName: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
  city: string;
  state: string;
  serviceableLocalities: Locality[];
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  staffEnabled: boolean;
  upiEnabled: boolean;
  upiId?: string;
  upiQrUrl?: string;
  upiInstructions?: string;
  cashEnabled: boolean;
  cashInstructions?: string;
  pickupInstructions?: string;
  stockReservationHours: number | null;
  policies: Record<string, string>;
  lowStockThreshold: number;
}

export interface ServiceArea extends Partial<Settings> {
  configured: boolean;
  deliveryUnavailableReason?: string;
  paymentMethods?: {
    upi?: { upiId?: string; qrImageUrl?: string; instructions?: string };
    cash?: { instructions?: string };
  };
}

export interface Dashboard {
  ordersNeedingAction: number;
  pendingPayments: number;
  lowStockItems: number;
  recentOrders: Order[];
}

export interface SuperAdminOverview {
  generatedAt: string;
  days: number;
  metrics: {
    activeCustomers: number;
    activeDeliveryPartners: number;
    activeProducts: number;
    totalOrders: number;
    orderValuePaise: number;
    pendingPayments: number;
    ordersNeedingAction: number;
    unassignedDeliveryOrders: number;
    lowStockItems: number;
  };
  ordersByFulfilmentStatus: Array<{ status: string; count: number }>;
  ordersOverTime: Array<{ day: string; count: number }>;
  recentOrders: Array<{
    _id: string;
    customerId?: string;
    orderReference: string;
    customerName: string;
    address?: { city: string };
    items: Array<{ productName: string }>;
    fulfilmentStatus: string;
    paymentStatus: string;
    paymentMethod: string;
    totalPaise: number;
    createdAt: string;
    deliveryPartner?: { userId?: string; name: string };
  }>;
  unavailableModules: string[];
}

export interface SuperAdminOrder {
  _id: string;
  customerId?: string;
  orderReference: string;
  customerName: string;
  address?: { city: string };
  items: Array<{ productName: string }>;
  fulfilmentStatus: string;
  paymentStatus: string;
  paymentMethod: string;
  totalPaise: number;
  createdAt: string;
  deliveryPartner?: { userId?: string; name: string };
}

export interface SuperAdminCitySummary {
  city: string;
  state?: string;
  configured: boolean;
  cityAdminName: string | null;
  cityAdminCount: number;
  sellerCount: number;
  deliveryPartnerCount: number;
  orderCount: number;
  serviceZoneCount: number;
}

export interface SuperAdminCity extends Omit<SuperAdminCitySummary, 'cityAdminName' | 'cityAdminCount' | 'sellerCount' | 'deliveryPartnerCount' | 'orderCount' | 'serviceZoneCount'> {
  serviceableLocalities: Locality[];
  cityAdmins: User[];
  sellers: User[];
  deliveryPartners: User[];
  metrics: {
    cityAdmins: number;
    sellers: number;
    deliveryPartners: number;
    orders: number;
    serviceZones: number;
  };
  recentOrders: SuperAdminOrder[];
}

export interface AuditLogEntry {
  _id: string;
  actorId?: Pick<User, 'id' | '_id' | 'name' | 'role' | 'phoneE164'> | null;
  actorType: 'user' | 'system';
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface CityAdminDashboard {
  city: string;
  generatedAt: string;
  metrics: {
    todayOrders: number;
    awaitingAssignment: number;
    outForDelivery: number;
    deliveredToday: number;
    ordersNeedingAction: number;
    paymentsToReview: number;
  };
  ordersByStatus: Array<{ status: string; count: number }>;
  ordersOverTime: Array<{ day: string; count: number }>;
  recentOrders: CityAdminOrder[];
  assignmentExceptions: Array<{
    _id: string;
    orderReference: string;
    address?: { locality: string };
    fulfilmentStatus: string;
    createdAt: string;
  }>;
  unavailableMetrics: string[];
}

export interface CityAdminOrder {
  _id: string;
  orderReference: string;
  customerName: string;
  items: Array<{ productName: string }>;
  totalPaise: number;
  paymentMethod: 'upi' | 'cash';
  paymentStatus: 'pending_verification' | 'confirmed' | 'rejected';
  fulfilmentStatus: string;
  deliveryPartner?: { name: string };
  address?: { locality: string };
  createdAt: string;
}
