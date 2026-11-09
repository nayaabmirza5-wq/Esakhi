export type Role = 'customer' | 'staff' | 'admin' | 'city_admin' | 'seller' | 'delivery_partner' | 'super_admin';

export interface CustomerBankAccount {
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  upiId?: string;
  linkedAt?: string;
  verified: boolean;
}

export interface PreDispatchInspection {
  imageUrls: string[];
  inspectionNote?: string;
  uploadedBy?: string;
  uploadedAt?: string;
}

export type ReturnReasonCode =
  | 'damaged'
  | 'defective'
  | 'wrong_item'
  | 'box_mutilated'
  | 'changed_mind'
  | 'other';

export type ReturnFaultAttribution =
  | 'seller_fault'
  | 'delivery_partner_fault'
  | 'no_fault';

export interface OrderReturnRequest {
  status:
    | 'requested'
    | 'rejected'
    | 'accepted'
    | 'partner_assigned'
    | 'picked_up'
    | 'delivered_to_seller'
    | 'ready_for_refund'
    | 'refund_completed';
  reasonCode: ReturnReasonCode;
  reasonText: string;
  boxConditionImages: string[];
  productFaultImages: string[];
  requestedBy?: string;
  requestedAt: string;
  arbitration?: {
    decision?: 'approved' | 'rejected';
    faultAttribution?: ReturnFaultAttribution;
    penaltyAmountPaise?: number;
    penaltyPartyId?: string;
    penaltyLedgerId?: string;
    reviewNote?: string;
    reviewedBy?: string;
    reviewedAt?: string;
  };
  reverseDeliveryPartner?: {
    userId?: string;
    name?: string;
    phoneE164?: string;
    distanceKm?: number;
    latitude?: number;
    longitude?: number;
    assignedAt?: string;
    pickedUpAt?: string;
    deliveredToSellerAt?: string;
  };
  escalatedToSuperAdminBy?: string;
  escalatedToSuperAdminAt?: string;
  refund?: {
    refundAmountPaise?: number;
    deductionAmountPaise?: number;
    deductionNote?: string;
    bankAccountHolderName?: string;
    bankAccountNumberMasked?: string;
    bankName?: string;
    ifscCode?: string;
    upiId?: string;
    transactionReference?: string;
    processedBy?: string;
    processedAt?: string;
  };
}

export type DeliveryStatus =
  | 'UNASSIGNED'
  | 'ASSIGNED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERY_FAILED'
  | 'ESCALATED_TO_ADMIN'
  | 'DELIVERED'
  | 'RETURN_TO_ORIGIN';

export type DeliveryExceptionReasonCode =
  | 'CUSTOMER_UNAVAILABLE'
  | 'INCORRECT_ADDRESS'
  | 'CUSTOMER_REFUSED'
  | 'RIDER_VEHICLE_ISSUE'
  | 'WEATHER_OR_ROAD_BLOCK'
  | 'RIDER_EMERGENCY'
  | 'OTHER';

export type RiderRequestedAction = 'RETRY_LATER' | 'UNASSIGN_ME' | 'CANCEL_ORDER';

export type AdminResolutionAction =
  | 'REASSIGN_SAME_RIDER'
  | 'REASSIGN_NEW_RIDER'
  | 'RESCHEDULE_LATER'
  | 'TRIGGER_RTO';

export interface DeliveryException {
  attemptedAt: string;
  riderId?: string;
  reasonCode: DeliveryExceptionReasonCode;
  reasonNotes?: string;
  proofImageUrl?: string;
  riderRequestedAction: RiderRequestedAction;
}

export interface AdminResolution {
  resolvedBy?: string;
  resolvedAt: string;
  action: AdminResolutionAction;
  adminNotes?: string;
}

export interface PenaltyLedgerEntry {
  _id: string;
  orderId: string;
  orderReference: string;
  city?: string;
  partyType?: 'seller' | 'delivery_partner';
  partyId?: string;
  partyName?: string;
  penaltyAmountPaise: number;
  reason: string;
  faultType?: 'seller_fault' | 'delivery_partner_fault';
  cityAdminId?: string;
  settlementStatus: 'SELLER_PENALTY_PENDING' | 'DELIVERY_PARTNER_PENALTY_PENDING' | 'SETTLED' | 'WAIVED';
  createdAt: string;
  settledAt?: string;
}

export interface SellerSettlementsResponse {
  monthLabel: string;
  grossMonthlyPayoutPaise: number;
  totalPenaltyDeductionsPaise: number;
  netSettlementPaise: number;
  completedOrdersCount: number;
  penalties: PenaltyLedgerEntry[];
}

export interface PartnerSettlementsResponse {
  monthLabel: string;
  completedDeliveriesCount: number;
  grossDeliveryEarningsPaise: number;
  totalPenaltyDeductionsPaise: number;
  netSettlementPaise: number;
  completedTrips: Array<{
    orderId: string;
    orderReference: string;
    fulfilmentStatus: string;
    payoutPaise: number;
    completedAt: string;
  }>;
  penalties: PenaltyLedgerEntry[];
}

export interface SuperAdminSettlementsLedgerResponse {
  monthLabel: string;
  summary: {
    grossSalesPaise: number;
    platformCommissionsPaise: number;
    activePenaltiesPaise: number;
    settledPenaltiesPaise: number;
    totalPenaltiesPaise: number;
    pendingRefundsCount: number;
    totalRefundsDisbursedPaise: number;
    finalNetPayoutsPaise: number;
  };
  pendingRefundOrders: Array<{
    _id: string;
    orderReference: string;
    customerName: string;
    customerPhoneE164?: string;
    totalPaise: number;
    fulfilmentStatus: string;
    paymentMethod: string;
    bankAccount?: CustomerBankAccount;
    returnRequest?: OrderReturnRequest;
    updatedAt?: string;
  }>;
  completedRefundOrders: Array<{
    _id: string;
    orderReference: string;
    customerName: string;
    totalPaise: number;
    fulfilmentStatus: string;
    refund?: OrderReturnRequest['refund'];
    updatedAt?: string;
  }>;
  penaltyLedger: PenaltyLedgerEntry[];
  sellerSettlements: Array<{
    sellerId: string;
    sellerName: string;
    phoneE164: string;
    city: string;
    grossMonthlyPayoutPaise: number;
    platformCommissionPaise: number;
    penaltyDeductionsPaise: number;
    netSettlementPaise: number;
    penalties: PenaltyLedgerEntry[];
  }>;
  deliveryPartnerSettlements: Array<{
    partnerId: string;
    partnerName: string;
    phoneE164: string;
    city: string;
    tripsCount: number;
    grossDeliveryEarningsPaise: number;
    penaltyDeductionsPaise: number;
    netSettlementPaise: number;
    penalties: PenaltyLedgerEntry[];
  }>;
}

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
  serviceableLocalities?: string[];
  status?: 'active' | 'disabled';
  isOnline?: boolean;
  availabilityStatus?: 'available' | 'busy' | 'offline';
  currentLocation?: {
    latitude: number;
    longitude: number;
    updatedAt?: string;
  };
  savedAddresses?: Address[];
  bankAccount?: CustomerBankAccount;
}

export interface PartnerProfile {
  _id: string;
  name: string;
  phoneE164: string;
  assignedCity: string;
  serviceableLocalities: string[];
  isOnline: boolean;
  availabilityStatus: 'available' | 'busy' | 'offline';
  activeOrderCount: number;
  unremittedCashPaise?: number;
  remittancePin?: string;
  remittancePinExpiresAt?: string;
  expiresInSeconds?: number;
  exceedsCodThreshold?: boolean;
  currentLocation: {
    latitude: number;
    longitude: number;
    updatedAt?: string;
  };
}

export interface SellerPickupSnapshot {
  sellerId?: string;
  sellerName: string;
  phoneE164?: string;
  address: string;
  city?: string;
  latitude: number;
  longitude: number;
}

export interface Address {
  id?: string;
  _id?: string;
  label?: string;
  isDefault?: boolean;
  name: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  locality: string;
  city: string;
  state: string;
  postalCode: string;
  houseNumber?: string;
  street?: string;
  area?: string;
  landmark?: string;
  villageOrCity?: string;
  district?: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  locationAccuracyMeters?: number;
  deliveryInstructions?: string;
}

export interface AddressSuggestion {
  formattedAddress: string;
  houseNumber?: string;
  street?: string;
  area?: string;
  villageOrCity?: string;
  district?: string;
  state?: string;
  postalCode?: string;
  latitude: number;
  longitude: number;
}

export interface Variant {
  _id: string;
  sku?: string;
  attributes: Record<string, string>;
  stock: number;
}

export interface Product {
  _id: string;
  productId?: string;
  id?: string;
  sellerId?: string | null;
  sellerName?: string | null;
  name: string;
  slug: string;
  description: string;
  category: string;
  categoryId: string;
  categoryName: string;
  subcategoryId: string;
  subcategoryName: string;
  productType: string;
  isFoodProduct: boolean;
  classificationStatus: 'classified' | 'needs_review';
  classificationNote?: string;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  foodComplianceStatus: 'not_required' | 'pending' | 'verified';
  pricePaise: number;
  imageUrls: string[];
  stock: number;
  lowStockThreshold: number;
  variants: Variant[];
  isActive: boolean;
  isArchived: boolean;
  updatedAt?: string;
}

export interface ProductTypeOption {
  productTypeId: string;
  productType: string;
  isFoodProduct: boolean;
  classificationStatus: 'classified' | 'needs_review';
  reviewNote: string;
}

export interface ProductSubcategory {
  subcategoryId: string;
  subcategoryName: string;
  productTypes: ProductTypeOption[];
}

export interface ProductCategory {
  categoryId: string;
  categoryName: string;
  icon: string;
  subcategories: ProductSubcategory[];
}

export interface PageResult<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface SellerApplication {
  _id: string;
  shgName: string;
  representative: string;
  phoneE164: string;
  city: string;
  registeredAddress: string;
  primaryCategoryId?: string;
  primaryCategoryName?: string;
  primarySubcategoryId?: string;
  primarySubcategoryName?: string;
  primaryProductType: string;
  primaryClassificationStatus?: 'classified' | 'needs_review';
  fssaiRegistrationNumber?: string;
  fssaiStatus: 'not_required' | 'pending' | 'verified' | 'needs_info';
  status: 'pending' | 'approved' | 'rejected' | 'needs_info';
  reviewNote?: string;
  createdAt: string;
  reviewedAt?: string;
}

export interface OrderItem {
  productId: string;
  sellerId?: string | null;
  sellerName?: string;
  variantId?: string;
  productName: string;
  variantAttributes?: Record<string, string>;
  unitPricePaise: number;
  quantity: number;
  lineTotalPaise: number;
}

export interface OrderAddressSnapshot {
  name: string;
  phoneE164: string;
  addressLine1: string;
  addressLine2?: string;
  locality: string;
  city: string;
  state: string;
  postalCode: string;
  houseNumber?: string;
  street?: string;
  area?: string;
  landmark?: string;
  villageOrCity?: string;
  district?: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  locationAccuracyMeters?: number;
  deliveryInstructions?: string;
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
  paymentMethod: 'upi' | 'cash' | 'card' | 'netbanking' | 'doorstep_upi' | string;
  paymentStatus: 'pending_verification' | 'confirmed' | 'rejected' | 'refunded';
  fulfilmentMethod: 'delivery' | 'pickup';
  fulfilmentStatus: string;
  deliveryStatus?: DeliveryStatus;
  deliveryExceptions?: DeliveryException[];
  adminResolution?: AdminResolution;
  address?: OrderAddressSnapshot;
  sellerPickup?: SellerPickupSnapshot;
  cityAdminDetails?: {
    id?: string;
    _id?: string;
    name: string;
    phoneE164?: string;
    email?: string;
    assignedCity?: string;
  };
  deliveryOtp?: string;
  requiresDeliveryOtp?: boolean;
  isPrepaid?: boolean;
  amountToCollectPaise?: number;
  doorstepPayment?: {
    mode?: 'cash' | 'upi_qr' | 'prepaid_online';
    upiUtr?: string;
    collectedAmountPaise?: number;
    collectedAt?: string;
    remittedToCityAdmin?: boolean;
    remittedAt?: string;
    remittedReceiptNumber?: string;
    notes?: string;
  };
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
    distanceKm?: number;
    latitude?: number;
    longitude?: number;
    assignedAt: string;
    internalNotes?: string;
  };
  deliveryPartnerHistory?: Array<{
    userId?: string;
    name: string;
    phoneE164: string;
    assignedAt: string;
    unassignedAt: string;
    changeReason?: string;
  }>;
  cancellationReason?: string;
  cancellationRequest?: {
    requestedAt?: string;
    customerNote?: string;
    decision?: 'approved' | 'rejected';
    adminNote?: string;
  };
  preDispatchInspection?: PreDispatchInspection;
  returnRequest?: OrderReturnRequest;
  paymentEvents?: Array<{
    status: 'confirmed' | 'rejected' | 'pending_verification' | 'refunded';
    note: string;
    createdAt: string;
  }>;
  internalNotes?: string[];
  createdAt?: string;
  updatedAt?: string;
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
  paymentStatus: 'pending_verification' | 'confirmed' | 'rejected' | 'refunded';
  items: Array<{ productName: string; quantity: number; lineTotalPaise: number }>;
  deliveryPartner?: { name: string; phoneE164?: string; distanceKm?: number; estimatedPickupEtaMinutes?: number; assignedAt?: string };
  preDispatchInspection?: PreDispatchInspection;
  returnRequest?: OrderReturnRequest;
  readyForPickupAt?: string;
  partnerAssignedAt?: string;
  outForPickupAt?: string;
  pickedUpAt?: string;
  outForDeliveryAt?: string;
  deliveredAt?: string;
  statusHistory?: Array<{ status: string; changedAt: string; note?: string }>;
  subtotalPaise: number;
  createdAt: string;
}

export interface PartnerLiveTrackingResponse {
  orderId: string;
  orderReference: string;
  fulfilmentStatus: string;
  streamStatus: 'GPS_STREAM_ACTIVE' | 'GPS_STREAM_INACTIVE';
  active: boolean;
  terminatedReason?: 'ORDER_DELIVERED' | 'RETURN_DELIVERED_TO_SELLER' | 'NOT_IN_ACTIVE_TRANSIT';
  terminatedAt?: string;
  sellerNode: {
    sellerName: string;
    phoneE164?: string;
    address: string;
    city: string;
    latitude: number;
    longitude: number;
  };
  customerNode: {
    name: string;
    phoneE164?: string;
    address: string;
    locality: string;
    city: string;
    latitude: number;
    longitude: number;
  };
  partnerLocation: {
    partnerId?: string;
    name: string;
    phoneE164: string;
    latitude: number;
    longitude: number;
    frozen: boolean;
    updatedAt: string;
  } | null;
  distanceToSellerKm: number;
  distanceToCustomerKm: number;
  estimatedEtaMinutes: number;
  signalQuality: 'live' | 'fallback_checkpoint' | 'terminated';
}

export interface SellerDashboard {
  storeProfile: {
    shgName: string;
    representative: string;
    registeredAddress: string;
    latitude?: number;
    longitude?: number;
    storeDescription: string;
    primaryCategoryId: string | null;
    primaryCategoryName: string | null;
    primarySubcategoryId: string | null;
    primarySubcategoryName: string | null;
    primaryProductType: string;
    fssaiStatus: 'not_required' | 'pending' | 'verified' | 'needs_info';
    verificationStatus: 'approved';
    city: string;
    phoneE164: string;
    email: string | null;
    assignedCity: string | null;
    serviceableLocalities: string[];
  } | null;
  metrics: {
    activeProducts: number;
    pendingProducts: number;
    outOfStockProducts: number;
    lowStockProducts: number;
    totalProducts: number;
    newOrders: number;
    ordersToPrepare: number;
    readyOrders: number;
    completedOrders: number;
    grossPaidProductSalesThisMonthPaise: number;
  };
  recentOrders: SellerOrder[];
  salesTrend: Array<{ month: string; totalPaise: number }>;
  topSellingProducts: Array<{ _id: string; productName: string; unitsSold: number; grossSalesPaise: number }>;
  lowStockProducts: Array<{ _id: string; name: string; categoryName: string; subcategoryName: string; availableStock: number; stock: number; variants: Variant[] }>;
  unavailableMetrics: string[];
}

export interface SellerInventoryAdjustment {
  _id: string;
  productId: string;
  variantId?: string;
  quantityChange: number;
  reason: string;
  createdAt: string;
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
  recentOrders: SuperAdminOrder[];
  unavailableModules: string[];
}

export interface SuperAdminOrder {
  _id: string;
  customerId?: string;
  orderReference: string;
  customerName: string;
  address?: { city: string };
  sellerPickup?: SellerPickupSnapshot;
  sellerDetails?: {
    sellerId?: string;
    sellerName: string;
    phoneE164?: string;
    address?: string;
    city?: string;
  };
  cityAdminDetails?: {
    id?: string;
    _id?: string;
    name: string;
    phoneE164?: string;
    email?: string;
    assignedCity?: string;
  };
  items: Array<{ productName: string; sellerId?: string }>;
  fulfilmentStatus: string;
  paymentStatus: string;
  paymentMethod: string;
  totalPaise: number;
  createdAt: string;
  updatedAt?: string;
  statusHistory?: Array<{ status: string; changedAt: string; note?: string }>;
  deliveryPartner?: { userId?: string; name: string; phoneE164?: string; distanceKm?: number | null; assignedAt?: string };
  preDispatchInspection?: PreDispatchInspection;
  returnRequest?: OrderReturnRequest;
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
    sellerApplicationsToReview: number;
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

export interface CityAdminServiceZones {
  city: string;
  state?: string;
  configured: boolean;
  eligiblePartnersTracked?: boolean;
  zones: Array<{
    name: string;
    coveredLocalities: string[];
    postalCodes: string[];
    deliveryFeePaise?: number;
    activeDeliveryCount: number;
    eligiblePartnerCount: number | null;
    status: 'active' | 'disabled';
  }>;
}

export interface CityAdminSeller {
  _id: string;
  name?: string;
  phoneE164: string;
  email?: string;
  status: 'active' | 'disabled';
  assignedCity: string;
  createdAt: string;
  productCount: number;
  productCategories: string[];
  orderCount: number;
  verificationStatus: 'not_tracked';
}

export interface CityAdminProduct extends Product {
  sellerName: string;
  availableStock: number;
  reservedStock: number;
  openFlagCount: number;
}

export interface CityAdminDeliveryPartner extends User {
  role: 'delivery_partner';
  serviceableLocalities: string[];
  activeDeliveries: number;
  completedDeliveries: number;
  failedDeliveries: number;
  isOnline?: boolean;
  availabilityStatus?: 'available' | 'busy' | 'offline';
  availability: string;
  distanceKm?: number;
  currentLocation?: {
    latitude: number;
    longitude: number;
    updatedAt?: string;
  };
  verificationStatus: string;
}

export interface DeliveryPartnerApplication {
  _id: string;
  name: string;
  phoneE164: string;
  city: string;
  requestedLocalities: string[];
  applicantNote?: string;
  status: 'pending' | 'approved' | 'rejected' | 'needs_info' | 'action_required';
  reviewNote?: string;
  flaggedFields?: string[];
  createdAt: string;
  reviewedAt?: string;

  // Rich Biodata & "No-DL" Dynamic Attributes
  selfieUrl?: string;
  emergencyContactName?: string;
  emergencyContactRel?: string;
  emergencyContactPhone?: string;
  residentialAddress?: string;
  pincode?: string;
  vehicleType?: 'BICYCLE' | 'MOTORCYCLE';
  maxDeliveryRadiusKm?: number;
  dlNumber?: string;
  dlExpiryDate?: string;
  vehicleRcNumber?: string;

  // Document URLs
  govIdUrl?: string;
  dlFrontUrl?: string;
  dlBackUrl?: string;
  passbookDocUrl?: string;

  // Bank Details
  bankDetails?: {
    accountHolderName?: string;
    accountNumberMasked?: string;
    ifscCode?: string;
    bankName?: string;
    branchName?: string;
    upiVpa?: string;
    isVerified?: boolean;
  };
}

export interface CityAdminOrder {
  _id: string;
  orderReference: string;
  customerId?: string;
  customerName: string;
  customerPhoneE164?: string;
  items: Array<{ productName: string; sellerName?: string | null; quantity?: number; sellerId?: string | null }>;
  subtotalPaise: number;
  deliveryFeePaise: number;
  totalPaise: number;
  paymentMethod: 'upi' | 'cash' | 'card' | 'netbanking' | 'doorstep_upi' | string;
  paymentStatus: 'pending_verification' | 'confirmed' | 'rejected' | 'refunded';
  fulfilmentMethod: 'delivery' | 'pickup';
  fulfilmentStatus: string;
  deliveryStatus?: DeliveryStatus;
  deliveryExceptions?: DeliveryException[];
  adminResolution?: AdminResolution;
  address?: OrderAddressSnapshot;
  sellerPickup?: SellerPickupSnapshot;
  deliveryPartner?: {
    userId?: string;
    name: string;
    phoneE164: string;
    distanceKm?: number;
    latitude?: number;
    longitude?: number;
    assignedAt?: string;
  };
  deliveryPartnerHistory?: Array<{ userId?: string; name: string; phoneE164: string; assignedAt: string; unassignedAt: string; changeReason?: string }>;
  preDispatchInspection?: PreDispatchInspection;
  returnRequest?: OrderReturnRequest;
  statusHistory?: Array<{ status: string; changedAt: string; note?: string }>;
  paymentEvents?: Array<{ status: string; createdAt: string; note?: string }>;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  ticketId: string;
  userType: 'customer' | 'seller' | 'delivery_partner';
  userName: string;
  userPhone: string;
  orderReference?: string;
  issueType: 'delivery_delay' | 'damaged_item' | 'payment_issue' | 'cancellation' | 'general';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'escalated' | 'resolved';
  city: string;
  subject: string;
  description: string;
  assignedStaff?: string;
  createdAt: string;
  lastUpdated: string;
  notes?: Array<{ author: string; note: string; timestamp: string }>;
}

export interface RefundRequest {
  id: string;
  refundId: string;
  orderReference: string;
  customerName: string;
  customerPhone: string;
  requestedAmountPaise: number;
  reason: 'item_damaged' | 'wrong_item' | 'undelivered' | 'cancelled_by_buyer' | 'quality_issue';
  status: 'pending_review' | 'approved' | 'rejected' | 'processed';
  requestedAt: string;
  reviewNote?: string;
  reviewedBy?: string;
  city: string;
}

export interface SellerSettlement {
  id: string;
  settlementId: string;
  sellerId: string;
  sellerName: string;
  period: string;
  orderCount: number;
  grossSalesPaise: number;
  platformCommissionPaise: number;
  adjustmentsPaise: number;
  netPayablePaise: number;
  status: 'pending_approval' | 'eligible' | 'paid' | 'on_hold';
  dueDate: string;
  paidAt?: string;
  payoutReference?: string;
}

export interface DeliveryPartnerPayout {
  id: string;
  payoutId: string;
  partnerId: string;
  partnerName: string;
  partnerPhone: string;
  period: string;
  completedDeliveries: number;
  baseEarningsPaise: number;
  incentivesPaise: number;
  adjustmentsPaise: number;
  netPayoutPaise: number;
  status: 'pending_approval' | 'approved' | 'paid';
  dueDate: string;
  paidAt?: string;
}

export interface ExternalDeliveryProvider {
  id: string;
  name: string;
  code: string;
  type: 'hyperlocal' | 'national_courier';
  status: 'active' | 'inactive' | 'testing';
  supportedCities: string[];
  serviceablePinCodes: string[];
  apiEndpoint?: string;
  accountNumber?: string;
  averageEtaHours: number;
}

export interface RoadHazardReport {
  id: string;
  hazardType: 'pothole' | 'waterlogging' | 'road_closure' | 'construction' | 'unsafe_route' | 'breakdown';
  severity: 'low' | 'moderate' | 'severe' | 'impassable';
  locality: string;
  coordinates?: { latitude: number; longitude: number };
  reportedBy: string;
  reporterRole: 'delivery_partner' | 'city_admin';
  description: string;
  reportedAt: string;
  status: 'active' | 'verified' | 'resolved';
}

export interface WeatherCondition {
  city: string;
  temperatureCelsius: number;
  condition: 'Sunny' | 'Partly Cloudy' | 'Rain' | 'Thunderstorm' | 'Fog' | 'Extreme Heat';
  rainProbability: number;
  windSpeedKmh: number;
  warning?: string;
  lastUpdated: string;
}

export interface DeliveryTrackingInfo {
  orderReference: string;
  step: 'assigned' | 'accepted' | 'arriving_at_pickup' | 'picked_up' | 'in_transit' | 'arriving_at_customer' | 'delivered';
  partnerName: string;
  partnerPhone: string;
  currentLocation?: { latitude: number; longitude: number; label: string };
  sellerPickupAddress: string;
  customerDeliveryAddress: string;
  estimatedArrivalMinutes: number;
  weatherWarning?: string;
  roadHazardWarning?: string;
  timeline: Array<{ title: string; time: string; done: boolean; current?: boolean }>;
}


export interface SellerRecord {
  _id?: string;
  id?: string;
  userId: string;
  status: 'ACTIVE' | 'SUSPENDED';
  stepCompleted: number;
  isOnboardingComplete: boolean;
  taxDetails: {
    hasGst: boolean;
    gstin?: string;
    hasEnrolmentId: boolean;
    enrolmentId?: string;
    panNumber: string;
    businessName: string;
    email: string;
  };
  pickupAddress: {
    streetAddress: string;
    locality: string;
    city: string;
    state: string;
    pincode: string;
    landmark?: string;
  };
  bankDetails: {
    accountHolderName: string;
    bankName: string;
    accountNumber: string;
    ifscCode: string;
    accountType: 'SAVINGS' | 'CURRENT';
  };
  supplierDetails: {
    shgCode?: string;
    shgName: string;
    shgLeaderName: string;
    numberOfMembers: number;
    category: 'HANDICRAFT' | 'TEXTILES' | 'FOOD' | 'HERBAL';
    isFoodSeller: boolean;
    fssaiNumber?: string;
    district: string;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface SellerOnboardingPayload {
  phone?: string;
  taxDetails: {
    hasGst: boolean;
    gstin?: string;
    hasEnrolmentId: boolean;
    enrolmentId?: string;
    panNumber: string;
    businessName: string;
    email: string;
  };
  pickupAddress: {
    streetAddress: string;
    locality?: string;
    city: string;
    state: string;
    pincode: string;
    landmark?: string;
  };
  bankDetails: {
    accountHolderName: string;
    bankName?: string;
    accountNumber: string;
    ifscCode: string;
    accountType: 'SAVINGS' | 'CURRENT';
  };
  supplierDetails: {
    shgCode?: string;
    shgName: string;
    shgLeaderName: string;
    numberOfMembers: number;
    category: 'HANDICRAFT' | 'TEXTILES' | 'FOOD' | 'HERBAL';
    isFoodSeller: boolean;
    fssaiNumber?: string;
    district: string;
  };
}

export interface ShgLookupResult {
  code: string;
  shgName: string;
  leaderName: string;
  memberCount: number;
  category: 'HANDICRAFT' | 'TEXTILES' | 'FOOD' | 'HERBAL';
  isVerified: boolean;
}

export interface DeliveryPartnerRecord {
  _id?: string;
  userId: string;
  partnerId: string;
  operatingCity: string;
  status: 'ACTIVE' | 'SUSPENDED';
  isAvailable: boolean;
  personalDetails: {
    fullName: string;
    phone: string;
    emergencyPhone: string;
    dob: string;
  };
  vehicleDetails: {
    vehicleType: 'BIKE' | 'EV' | 'CYCLE';
    dlNumber?: string;
    rcNumber?: string;
    isVerified: boolean;
  };
  kycDetails: {
    panNumber: string;
    aadharNumber: string;
    isPanVerified: boolean;
    isAadharVerified: boolean;
  };
  bankDetails: {
    accountHolderName: string;
    bankName: string;
    branchName: string;
    accountNumber: string;
    ifscCode: string;
    isVerified: boolean;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface DamohDeliveryPartnerOnboardingPayload {
  fullName: string;
  phone: string;
  emergencyPhone: string;
  dob: string;
  vehicleType: 'BIKE' | 'EV' | 'CYCLE';
  dlNumber?: string;
  rcNumber?: string;
  panNumber: string;
  aadharNumber: string;
  bankDetails: {
    accountHolderName: string;
    bankName: string;
    branchName: string;
    accountNumber: string;
    confirmAccountNumber: string;
    ifscCode: string;
  };
}

export interface CityAdminRemittancePartner {
  partnerId: string;
  name: string;
  phoneE164: string;
  isOnline: boolean;
  availabilityStatus: 'available' | 'busy' | 'offline';
  unremittedCashPaise: number;
  unremittedCashRupees: string;
  orderCount: number;
  orders: Array<{
    orderId: string;
    orderReference: string;
    customerName: string;
    totalPaise: number;
    totalRupees: string;
  }>;
  exceedsThreshold: boolean;
}

export interface CityAdminRemittanceSummary {
  city: string;
  totalOutstandingPaise: number;
  totalOutstandingRupees: string;
  thresholdLimitRupees: string;
  partners: CityAdminRemittancePartner[];
  recentVouchers: Array<{
    _id: string;
    receiptNumber: string;
    riderName: string;
    riderPhone: string;
    amountRupees: string;
    orderCount: number;
    orderReferences: string[];
    handshakePinUsed: string;
    settledByAdminName: string;
    settledAt: string;
  }>;
}

export interface SettleRemittanceResponse {
  success: boolean;
  receiptNumber: string;
  settledAmountPaise: number;
  settledAmountRupees: string;
  settledOrdersCount: number;
  voucherId: string;
  settledAt: string;
}

export type SellerProductDraft = {
  categoryId: string;
  subcategoryId: string;
  productType: string;
  name: string;
  slug: string;
  slugEdited: boolean;
  description: string;
  price: string;
  stock: string;
  lowStockThreshold: string;
  imageUrl: string;
};
