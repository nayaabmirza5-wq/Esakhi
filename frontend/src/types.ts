export type Role = 'customer' | 'staff' | 'admin' | 'delivery_partner';

export interface User {
  id: string;
  _id?: string;
  createdAt?: string;
  phone?: string;
  phoneE164?: string;
  name?: string;
  email?: string;
  role: Role;
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
