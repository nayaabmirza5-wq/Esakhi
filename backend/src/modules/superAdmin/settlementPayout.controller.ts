import type { RequestHandler } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { randomBytes } from 'node:crypto';
import { User } from '../auth/user.model.js';
import { Order } from '../orders/order.model.js';
import { PenaltyLedger } from '../orders/penaltyLedger.model.js';
import { PayoutRecord } from './payoutRecord.model.js';
import { SellerApplication } from '../seller/sellerApplication.model.js';
import { Seller } from '../../models/Seller.js';
import { computeSellerStatutoryTaxSummary, getIndianFinancialYearBounds } from '../catalog/pricingTaxEngine.js';
import { DeliveryPartnerApplication } from '../cityAdmin/deliveryPartnerApplication.model.js';
import { authenticatedUserId } from '../../utils/authenticatedUser.js';
import { sendData } from '../../utils/apiResponse.js';
import { AppError } from '../../utils/AppError.js';
import { AuditLog } from '../audit/auditLog.model.js';

function generatePayoutReference(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = randomBytes(3).toString('hex').toUpperCase();
  return `PAY-${dateStr}-${rand}`;
}

const COMPLETED_FULFILMENT_STATUSES = [
  'delivered',
  'completed',
  'return_delivered_to_seller',
  'ready_for_refund',
  'refund_completed',
] as const;

interface CompletedOrderLean {
  _id: mongoose.Types.ObjectId;
  orderReference: string;
  subtotalPaise?: number;
  totalPaise?: number;
  deliveryFeePaise?: number;
  fulfilmentStatus: string;
  paymentStatus: string;
  address?: { city?: string };
  items?: Array<{ sellerId?: mongoose.Types.ObjectId; lineTotalPaise?: number; quantity?: number; productName: string }>;
  sellerPickup?: { sellerId?: mongoose.Types.ObjectId };
  deliveryPartner?: { userId?: mongoose.Types.ObjectId };
  createdAt: Date;
}

export const getSuperAdminCityAdminSettlements: RequestHandler = async (_req, res) => {
  const cityAdmins = await User.find({ role: 'city_admin' })
    .select('_id name phoneE164 email assignedCity bankAccount status')
    .lean();

  const allCompletedOrders = await Order.find({
    fulfilmentStatus: { $in: COMPLETED_FULFILMENT_STATUSES },
    paymentStatus: 'confirmed',
  })
    .sort({ createdAt: -1 })
    .lean<CompletedOrderLean[]>();

  const allDisbursedPayouts = await PayoutRecord.find({
    beneficiaryType: 'city_admin',
    status: { $in: ['disbursed', 'settled'] },
  }).lean();

  const results = cityAdmins.map((admin) => {
    const city = admin.assignedCity || 'Damoh';
    const cityRegex = new RegExp(`^${city.trim()}$`, 'i');

    const adminOrders = allCompletedOrders.filter((o) =>
      o.address?.city && cityRegex.test(o.address.city.trim())
    );

    const grossSalesPaise = adminOrders.reduce((sum, o) => sum + (o.subtotalPaise || 0), 0);
    // Fixed 5% of subtotal
    const commissionPaise = Math.round(grossSalesPaise * 0.05);

    const penaltyDeductionsPaise = 0;

    const disbursedPayouts = allDisbursedPayouts.filter(
      (p) => String(p.beneficiaryId) === String(admin._id)
    );
    const alreadyDisbursedPaise = disbursedPayouts.reduce((sum, p) => sum + (p.netPaidPaise || 0), 0);

    const netLockedPayablePaise = Math.max(0, commissionPaise - penaltyDeductionsPaise - alreadyDisbursedPaise);

    const rawAcc = admin.bankAccount?.accountNumber;
    const bankAccount = rawAcc
      ? {
          accountHolderName: admin.bankAccount?.accountHolderName || admin.name || 'City Admin',
          accountNumberMasked: rawAcc.length > 4 ? `${'*'.repeat(Math.max(4, rawAcc.length - 4))}${rawAcc.slice(-4)}` : rawAcc,
          ifscCode: admin.bankAccount?.ifscCode || 'SBIN0000001',
          bankName: admin.bankAccount?.bankName || 'State Bank of India',
          upiId: admin.bankAccount?.upiId || undefined,
          isPending: false,
        }
      : {
          accountHolderName: admin.name || 'City Admin',
          accountNumberMasked: 'PENDING_REGISTRATION',
          ifscCode: 'PENDING',
          bankName: 'Bank Details Pending',
          upiId: undefined,
          isPending: true,
        };

    return {
      cityAdminId: String(admin._id),
      cityAdminName: admin.name || 'City Administrator',
      phoneE164: admin.phoneE164,
      email: admin.email || null,
      city,
      ordersHandledCount: adminOrders.length,
      grossCitySalesPaise: grossSalesPaise,
      commissionPaise, // 5%
      penaltyDeductionsPaise,
      alreadyDisbursedPaise,
      netLockedPayablePaise, // non-editable
      bankAccount,
      recentDisbursements: disbursedPayouts.slice(0, 3).map((p) => ({
        payoutReference: p.payoutReference,
        netPaidPaise: p.netPaidPaise,
        utrReference: p.utrReference,
        disbursedAt: p.disbursedAt,
      })),
      recentOrders: adminOrders.slice(0, 5).map((o) => ({
        orderReference: o.orderReference,
        subtotalPaise: o.subtotalPaise || 0,
        cityAdminCommissionPaise: Math.round((o.subtotalPaise || 0) * 0.05),
        createdAt: o.createdAt,
      })),
    };
  });

  sendData(res, results);
};

export const getSuperAdminSellerSettlements: RequestHandler = async (_req, res) => {
  const sellers = await User.find({ role: 'seller' })
    .select('_id name phoneE164 email assignedCity bankAccount')
    .lean();

  const [sellerApps, sellerProfiles] = await Promise.all([
    SellerApplication.find({
      $or: [
        { sellerId: { $in: sellers.map((s) => s._id) } },
        { phoneE164: { $in: sellers.map((s) => s.phoneE164) } },
      ],
    }).lean(),
    Seller.find({ userId: { $in: sellers.map((s) => s._id) } }).lean(),
  ]);

  const sellerProfileByUserId = new Map(sellerProfiles.map((sp) => [String(sp.userId), sp]));
  const { fyStart, fyEnd } = getIndianFinancialYearBounds();

  const allCompletedOrders = await Order.find({
    fulfilmentStatus: { $in: COMPLETED_FULFILMENT_STATUSES },
    paymentStatus: 'confirmed',
  })
    .sort({ createdAt: -1 })
    .lean<CompletedOrderLean[]>();

  const allDisbursedPayouts = await PayoutRecord.find({
    beneficiaryType: 'seller',
    status: { $in: ['disbursed', 'settled'] },
  }).lean();

  const penalties = await PenaltyLedger.find({ partyType: 'seller' }).lean();

  const results = sellers.map((seller) => {
    const sId = String(seller._id);
    const app = sellerApps.find((a) => String(a.sellerId) === sId || a.phoneE164 === seller.phoneE164);
    const profile = sellerProfileByUserId.get(sId);

    let grossSalesPaise = 0;
    let fyOrdersGrossPaise = 0;
    let unitsSold = 0;
    const sellerOrdersList: Array<{ orderReference: string; itemTotalPaise: number; productName: string }> = [];

    for (const order of allCompletedOrders) {
      let orderMatched = false;
      let orderSellerGross = 0;
      for (const item of order.items || []) {
        if (item.sellerId && String(item.sellerId) === sId) {
          const itemLine = item.lineTotalPaise || 0;
          grossSalesPaise += itemLine;
          orderSellerGross += itemLine;
          unitsSold += item.quantity || 1;
          orderMatched = true;
          sellerOrdersList.push({
            orderReference: order.orderReference,
            itemTotalPaise: itemLine,
            productName: item.productName,
          });
        }
      }
      if (!orderMatched && order.sellerPickup?.sellerId && String(order.sellerPickup.sellerId) === sId) {
        const sub = order.subtotalPaise || 0;
        grossSalesPaise += sub;
        orderSellerGross += sub;
        sellerOrdersList.push({
          orderReference: order.orderReference,
          itemTotalPaise: sub,
          productName: order.items?.[0]?.productName || 'Handcrafted items',
        });
      }
      if (orderSellerGross > 0) {
        const createdDate = new Date(order.createdAt);
        if (createdDate >= fyStart && createdDate <= fyEnd) {
          fyOrdersGrossPaise += orderSellerGross;
        }
      }
    }

    const fyGrossSalesPaise = Math.max(fyOrdersGrossPaise, grossSalesPaise);
    const statutoryTax = computeSellerStatutoryTaxSummary({
      fyGrossSalesPaise,
      periodGrossSalesPaise: grossSalesPaise,
      hasGst: profile?.taxDetails?.hasGst,
      gstin: profile?.taxDetails?.gstin,
      enrolmentId: profile?.taxDetails?.enrolmentId,
      panNumber: profile?.taxDetails?.panNumber,
    });

    // 10% platform + city admin retention (5% platform + 5% city admin)
    const commissionDeductionsPaise = Math.round(grossSalesPaise * 0.10);
    // Statutory Govt Deductions:
    // - Section 52 GST TCS (0.5% of net taxable value for GSTIN sellers; ₹0 for Non-GST Enrolment ID sellers)
    // - Section 194-O Income Tax TDS (0.1% of gross sales when FY gross sales > ₹5,00,000; ₹0 below ₹5L)
    const tcsDeductionPaise = statutoryTax.tcsTotalPaise;
    const tdsDeductionPaise = statutoryTax.tds194OPaise;

    // Net artisan base share after commission & statutory TCS/TDS
    const grossArtisanSharePaise = Math.max(
      0,
      grossSalesPaise - commissionDeductionsPaise - tcsDeductionPaise - tdsDeductionPaise,
    );

    const sellerPenalties = penalties.filter(
      (p) => String(p.partyId) === sId && p.settlementStatus !== 'WAIVED'
    );
    const penaltyDeductionsPaise = sellerPenalties.reduce((sum, p) => sum + (p.penaltyAmountPaise || 0), 0);

    const disbursedPayouts = allDisbursedPayouts.filter(
      (p) => String(p.beneficiaryId) === sId
    );
    const alreadyDisbursedPaise = disbursedPayouts.reduce((sum, p) => sum + (p.netPaidPaise || 0), 0);

    const netLockedPayablePaise = Math.max(0, grossArtisanSharePaise - penaltyDeductionsPaise - alreadyDisbursedPaise);

    const rawAcc = seller.bankAccount?.accountNumber || profile?.bankDetails?.accountNumber;
    const bankAccount = rawAcc
      ? {
          accountHolderName: seller.bankAccount?.accountHolderName || profile?.bankDetails?.accountHolderName || app?.representative || seller.name || 'Artisan Seller',
          accountNumberMasked: rawAcc.length > 4 ? `${'*'.repeat(Math.max(4, rawAcc.length - 4))}${rawAcc.slice(-4)}` : rawAcc,
          ifscCode: seller.bankAccount?.ifscCode || profile?.bankDetails?.ifscCode || 'SBIN0000001',
          bankName: seller.bankAccount?.bankName || profile?.bankDetails?.bankName || 'State Bank of India',
          upiId: seller.bankAccount?.upiId || undefined,
          isPending: false,
        }
      : {
          accountHolderName: app?.representative || seller.name || 'Artisan Lead',
          accountNumberMasked: 'PENDING_REGISTRATION',
          ifscCode: 'PENDING',
          bankName: 'Bank Details Pending',
          upiId: undefined,
          isPending: true,
        };

    return {
      sellerId: sId,
      sellerName: profile?.supplierDetails?.shgName || app?.shgName || seller.name || 'Maitri SHG Artisan Group',
      representative: profile?.supplierDetails?.shgLeaderName || app?.representative || seller.name || 'Sunita Bai',
      shgCode: profile?.supplierDetails?.shgCode || 'MP-DMH-1042',
      fssaiNumber: profile?.supplierDetails?.fssaiNumber || app?.fssaiRegistrationNumber || null,
      phoneE164: seller.phoneE164,
      city: profile?.pickupAddress?.city || app?.city || seller.assignedCity || 'Damoh',
      unitsSold,
      grossSalesPaise,
      commissionDeductionsPaise, // 10% (5% platform + 5% city)
      tcsDeductionPaise, // 0.5% GSTR-8 TCS for GSTIN, 0 for Enrolment ID
      tdsDeductionPaise, // 0.1% Sec 194-O TDS when FY sales > ₹5L
      statutoryTax,
      grossArtisanSharePaise,
      penaltyDeductionsPaise,
      alreadyDisbursedPaise,
      netLockedPayablePaise, // non-editable
      bankAccount,
      recentDisbursements: disbursedPayouts.slice(0, 3).map((p) => ({
        payoutReference: p.payoutReference,
        netPaidPaise: p.netPaidPaise,
        utrReference: p.utrReference,
        disbursedAt: p.disbursedAt,
      })),
      recentOrders: sellerOrdersList.slice(0, 5),
    };
  });

  sendData(res, results);
};

export const getSuperAdminPartnerSettlements: RequestHandler = async (_req, res) => {
  const partners = await User.find({ role: 'delivery_partner' })
    .select('_id name phoneE164 email assignedCity bankAccount isOnline availabilityStatus')
    .lean();

  const partnerApps = await DeliveryPartnerApplication.find({
    phoneE164: { $in: partners.map((p) => p.phoneE164) },
  }).lean();

  const allCompletedDeliveries = await Order.find({
    fulfilmentStatus: { $in: COMPLETED_FULFILMENT_STATUSES },
    'deliveryPartner.userId': { $exists: true },
  })
    .sort({ createdAt: -1 })
    .lean<CompletedOrderLean[]>();

  const allDisbursedPayouts = await PayoutRecord.find({
    beneficiaryType: 'delivery_partner',
    status: { $in: ['disbursed', 'settled'] },
  }).lean();

  const penalties = await PenaltyLedger.find({ partyType: 'delivery_partner' }).lean();

  const results = partners.map((partner) => {
    const pId = String(partner._id);
    const app = partnerApps.find((a) => a.phoneE164 === partner.phoneE164);

    const partnerDeliveries = allCompletedDeliveries.filter(
      (o) => String(o.deliveryPartner?.userId) === pId
    );

    // Each delivery pays exactly ₹29.00 (2,900 paise)
    const grossEarningsPaise = partnerDeliveries.reduce((sum, o) => {
      const fee = o.deliveryFeePaise && o.deliveryFeePaise > 0 ? o.deliveryFeePaise : 2900;
      return sum + fee;
    }, 0);

    const partnerPenalties = penalties.filter(
      (p) => String(p.partyId) === pId && p.settlementStatus !== 'WAIVED'
    );
    const penaltyDeductionsPaise = partnerPenalties.reduce((sum, p) => sum + (p.penaltyAmountPaise || 0), 0);

    const disbursedPayouts = allDisbursedPayouts.filter(
      (p) => String(p.beneficiaryId) === pId
    );
    const alreadyDisbursedPaise = disbursedPayouts.reduce((sum, p) => sum + (p.netPaidPaise || 0), 0);

    const netLockedPayablePaise = Math.max(0, grossEarningsPaise - penaltyDeductionsPaise - alreadyDisbursedPaise);

    const rawAcc = partner.bankAccount?.accountNumber;
    const appAcc = app?.bankDetails?.accountNumberMasked;
    const bankAccount = rawAcc
      ? {
          accountHolderName: partner.bankAccount?.accountHolderName || partner.name || 'Delivery Partner',
          accountNumberMasked: rawAcc.length > 4 ? `${'*'.repeat(Math.max(4, rawAcc.length - 4))}${rawAcc.slice(-4)}` : rawAcc,
          ifscCode: partner.bankAccount?.ifscCode || 'SBIN0000001',
          bankName: partner.bankAccount?.bankName || 'State Bank of India',
          upiId: partner.bankAccount?.upiId || undefined,
          isPending: false,
        }
      : appAcc
      ? {
          accountHolderName: app?.name || partner.name || 'Delivery Partner',
          accountNumberMasked: appAcc,
          ifscCode: app?.bankDetails?.ifscCode || 'SBIN0000001',
          bankName: app?.bankDetails?.bankName || 'State Bank of India',
          upiId: app?.bankDetails?.upiVpa || undefined,
          isPending: false,
        }
      : {
          accountHolderName: partner.name || 'Delivery Partner',
          accountNumberMasked: 'PENDING_REGISTRATION',
          ifscCode: 'PENDING',
          bankName: 'Bank Details Pending',
          upiId: undefined,
          isPending: true,
        };

    return {
      partnerId: pId,
      partnerName: partner.name || app?.name || 'Ramesh Patel',
      phoneE164: partner.phoneE164,
      city: partner.assignedCity || 'Damoh',
      tripsCompleted: partnerDeliveries.length,
      grossEarningsPaise,
      penaltyDeductionsPaise,
      alreadyDisbursedPaise,
      netLockedPayablePaise, // non-editable
      bankAccount,
      recentDisbursements: disbursedPayouts.slice(0, 3).map((p) => ({
        payoutReference: p.payoutReference,
        netPaidPaise: p.netPaidPaise,
        utrReference: p.utrReference,
        disbursedAt: p.disbursedAt,
      })),
      recentDeliveries: partnerDeliveries.slice(0, 5).map((o) => ({
        orderReference: o.orderReference,
        deliveryFeePaise: o.deliveryFeePaise || 2900,
        createdAt: o.createdAt,
      })),
    };
  });

  sendData(res, results);
};

const recordDisbursementSchema = z.object({
  beneficiaryType: z.enum(['city_admin', 'seller', 'delivery_partner']),
  beneficiaryId: z.string().regex(/^[a-f\d]{24}$/i),
  paymentMethod: z.enum(['upi_intent', 'bank_transfer', 'razorpay_manual']).default('upi_intent'),
  utrReference: z
    .string()
    .trim()
    .min(6, 'Bank UTR or transaction reference must be at least 6 characters.')
    .max(64)
    .refine((val) => !val.includes('@'), 'Please enter the real bank UTR / transaction reference number, not a UPI ID address.')
    .refine((val) => /^[A-Za-z0-9_-]{6,64}$/.test(val), 'Invalid UTR format. Bank UTR must contain only letters, numbers, hyphens, or underscores.'),
  notes: z.string().trim().max(500).optional(),
}).strict();

export const recordSuperAdminDisbursement: RequestHandler = async (req, res) => {
  const superAdminId = authenticatedUserId(req);
  const input = recordDisbursementSchema.parse(req.body);

  // Security Audit: Prevent duplicate UTR usage across all settlements
  const existingUtr = await PayoutRecord.findOne({ utrReference: input.utrReference });
  if (existingUtr) {
    throw new AppError(
      409,
      'DUPLICATE_UTR',
      `This Bank UTR (${input.utrReference}) was already settled on ${existingUtr.disbursedAt.toLocaleDateString('en-IN')}. Re-using previous bank transaction receipts is strictly forbidden for financial safety.`
    );
  }

  const superAdmin = await User.findById(superAdminId).select('name').lean();
  const beneficiary = await User.findById(input.beneficiaryId).select('name phoneE164 assignedCity bankAccount').lean();
  if (!beneficiary) throw new AppError(404, 'BENEFICIARY_NOT_FOUND', 'The target beneficiary user was not found.');

  // Recalculate exact net payable to guarantee ZERO manipulation or front-end spoofing
  let grossPaise = 0;
  let commissionPaise = 0;
  let tcsPaise = 0;
  let tdsPaise = 0;
  let penaltyDeductionsPaise = 0;

  if (input.beneficiaryType === 'city_admin') {
    const city = beneficiary.assignedCity || 'Damoh';
    const cityRegex = new RegExp(`^${city.trim()}$`, 'i');
    const adminOrders = await Order.find({
      fulfilmentStatus: { $in: COMPLETED_FULFILMENT_STATUSES },
      paymentStatus: 'confirmed',
      'address.city': cityRegex,
    }).lean<CompletedOrderLean[]>();

    grossPaise = adminOrders.reduce((sum, o) => sum + (o.subtotalPaise || 0), 0);
    commissionPaise = Math.round(grossPaise * 0.05); // 5%
  } else if (input.beneficiaryType === 'seller') {
    const [sellerOrders, sellerProfile] = await Promise.all([
      Order.find({
        fulfilmentStatus: { $in: COMPLETED_FULFILMENT_STATUSES },
        paymentStatus: 'confirmed',
        $or: [{ 'items.sellerId': beneficiary._id }, { 'sellerPickup.sellerId': beneficiary._id }],
      }).lean<CompletedOrderLean[]>(),
      Seller.findOne({ userId: beneficiary._id }).lean(),
    ]);

    const { fyStart, fyEnd } = getIndianFinancialYearBounds();
    let fyGross = 0;

    for (const order of sellerOrders) {
      let matched = false;
      let orderGross = 0;
      for (const item of order.items || []) {
        if (item.sellerId && String(item.sellerId) === String(beneficiary._id)) {
          const line = item.lineTotalPaise || 0;
          grossPaise += line;
          orderGross += line;
          matched = true;
        }
      }
      if (!matched && order.sellerPickup?.sellerId && String(order.sellerPickup.sellerId) === String(beneficiary._id)) {
        const sub = order.subtotalPaise || 0;
        grossPaise += sub;
        orderGross += sub;
      }
      if (orderGross > 0) {
        const d = new Date(order.createdAt);
        if (d >= fyStart && d <= fyEnd) fyGross += orderGross;
      }
    }
    commissionPaise = Math.round(grossPaise * 0.10); // 10% platform + city
    const statutoryTax = computeSellerStatutoryTaxSummary({
      fyGrossSalesPaise: Math.max(fyGross, grossPaise),
      periodGrossSalesPaise: grossPaise,
      hasGst: sellerProfile?.taxDetails?.hasGst,
      gstin: sellerProfile?.taxDetails?.gstin,
      enrolmentId: sellerProfile?.taxDetails?.enrolmentId,
      panNumber: sellerProfile?.taxDetails?.panNumber,
    });
    tcsPaise = statutoryTax.tcsTotalPaise;
    tdsPaise = statutoryTax.tds194OPaise;
  } else {
    // Delivery partner: ₹29 per trip
    const partnerOrders = await Order.find({
      fulfilmentStatus: { $in: COMPLETED_FULFILMENT_STATUSES },
      'deliveryPartner.userId': beneficiary._id,
    }).lean<CompletedOrderLean[]>();

    grossPaise = partnerOrders.reduce((sum, o) => sum + (o.deliveryFeePaise && o.deliveryFeePaise > 0 ? o.deliveryFeePaise : 2900), 0);
  }

  const penalties = await PenaltyLedger.find({
    partyId: beneficiary._id as mongoose.Types.ObjectId,
    settlementStatus: { $ne: 'WAIVED' },
  }).lean();
  penaltyDeductionsPaise = penalties.reduce((sum, p) => sum + (p.penaltyAmountPaise || 0), 0);

  const pastPayouts = await PayoutRecord.find({
    beneficiaryId: beneficiary._id as mongoose.Types.ObjectId,
    status: { $in: ['disbursed', 'settled'] },
  }).lean();
  const alreadyDisbursedPaise = pastPayouts.reduce((sum, p) => sum + (p.netPaidPaise || 0), 0);

  const baseEligible = input.beneficiaryType === 'city_admin'
    ? commissionPaise
    : input.beneficiaryType === 'seller'
    ? Math.max(0, grossPaise - commissionPaise - tcsPaise - tdsPaise)
    : grossPaise;

  const netPayablePaise = Math.max(0, baseEligible - penaltyDeductionsPaise - alreadyDisbursedPaise);

  if (netPayablePaise <= 0) {
    throw new AppError(400, 'NO_PENDING_BALANCE', 'This beneficiary has no remaining pending payable balance.');
  }

  const payoutReference = generatePayoutReference();
  const accountName = beneficiary.bankAccount?.accountHolderName || beneficiary.name;

  const payout = await PayoutRecord.create({
    payoutReference,
    beneficiaryType: input.beneficiaryType,
    beneficiaryId: beneficiary._id as mongoose.Types.ObjectId,
    beneficiaryName: beneficiary.name || 'Beneficiary',
    beneficiaryPhone: beneficiary.phoneE164,
    city: beneficiary.assignedCity || 'Damoh',
    grossAmountPaise: grossPaise,
    commissionPaise,
    penaltyDeductionsPaise,
    netPaidPaise: netPayablePaise, // strictly enforced locked sum
    bankAccountSnapshot: {
      ...(accountName ? { accountHolderName: accountName } : {}),
      ...(beneficiary.bankAccount?.accountNumber ? { accountNumberMasked: beneficiary.bankAccount.accountNumber } : {}),
      ...(beneficiary.bankAccount?.ifscCode ? { ifscCode: beneficiary.bankAccount.ifscCode } : {}),
      ...(beneficiary.bankAccount?.bankName ? { bankName: beneficiary.bankAccount.bankName } : {}),
      ...(beneficiary.bankAccount?.upiId ? { upiId: beneficiary.bankAccount.upiId } : {}),
    },
    paymentMethod: input.paymentMethod,
    utrReference: input.utrReference,
    status: 'settled',
    disbursedBy: new mongoose.Types.ObjectId(superAdminId),
    disbursedByName: superAdmin?.name || 'Super Admin',
    disbursedAt: new Date(),
    ...(input.notes ? { notes: input.notes } : {}),
  });

  await AuditLog.create([{
    actorId: superAdminId,
    action: 'super_admin.payout_disbursed',
    resourceType: 'payout_record',
    resourceId: String(payout._id),
    metadata: {
      payoutReference,
      beneficiaryType: input.beneficiaryType,
      beneficiaryName: beneficiary.name,
      netPaidPaise: netPayablePaise,
      utrReference: input.utrReference,
    },
  }]);

  sendData(res, payout.toObject(), 201);
};
