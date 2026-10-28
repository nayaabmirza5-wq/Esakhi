import { randomBytes } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import { AppError } from '../../utils/AppError.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { InventoryAdjustment } from '../inventory/inventoryAdjustment.model.js';
import { Product } from '../catalog/product.model.js';
import { Settings } from '../settings/settings.model.js';
import { Order, type OrderRecord } from './order.model.js';
import { User } from '../auth/user.model.js';
import type { z } from 'zod';
import { createOrderSchema } from './order.schemas.js';
import { enqueueOrderStatusNotification } from '../notifications/orderNotification.service.js';

type Checkout = z.infer<typeof createOrderSchema>;

function orderReference(): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `ES-${date}-${randomBytes(8).toString('hex').toUpperCase()}`;
}

async function reserveItem(
  item: Checkout['items'][number],
  actorId: string,
  session: ClientSession,
): Promise<{ productName: string; sellerId: string | null; unitPricePaise: number; variantAttributes: Map<string, string> }> {
  const product = await Product.findOne({
    _id: item.productId,
    isActive: true,
    isArchived: false,
  }).session(session);
  if (!product) throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'A selected product is no longer available.');
  if (!product.sellerId) {
    throw new AppError(409, 'SELLER_NOT_FOUND', 'This product is not assigned to a seller yet.');
  }

  if (product.variants.length > 0) {
    if (!item.variantId) throw new AppError(400, 'VARIANT_REQUIRED', 'Select an available product option.');
    const variant = product.variants.id(item.variantId);
    if (!variant) throw new AppError(409, 'VARIANT_UNAVAILABLE', 'A selected product option is no longer available.');
    const update = await Product.updateOne(
      { _id: product._id, isActive: true, isArchived: false, variants: { $elemMatch: { _id: item.variantId, stock: { $gte: item.quantity } } } },
      { $inc: { 'variants.$.stock': -item.quantity } },
      { session },
    );
    if (update.modifiedCount !== 1) throw new AppError(409, 'INSUFFICIENT_STOCK', 'The selected product option has insufficient stock.');
    await InventoryAdjustment.create([{
      productId: product._id,
      variantId: variant._id,
      quantityChange: -item.quantity,
      reason: 'Order stock reservation',
      actorId,
    }], { session });
    return { productName: product.name, sellerId: product.sellerId ? product.sellerId.toString() : null, unitPricePaise: product.pricePaise, variantAttributes: variant.attributes };
  }

  if (item.variantId) throw new AppError(400, 'VARIANT_INVALID', 'This product does not have selectable options.');
  const update = await Product.updateOne(
    { _id: product._id, isActive: true, isArchived: false, stock: { $gte: item.quantity } },
    { $inc: { stock: -item.quantity } },
    { session },
  );
  if (update.modifiedCount !== 1) throw new AppError(409, 'INSUFFICIENT_STOCK', 'A selected product has insufficient stock.');
  await InventoryAdjustment.create([{
    productId: product._id,
    quantityChange: -item.quantity,
    reason: 'Order stock reservation',
    actorId,
  }], { session });
  return { productName: product.name, sellerId: product.sellerId ? product.sellerId.toString() : null, unitPricePaise: product.pricePaise, variantAttributes: new Map() };
}

export async function createOrder(actorId: string, input: Checkout): Promise<{ order: mongoose.HydratedDocument<OrderRecord>; created: boolean }> {
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const existing = await Order.findOne({ customerId: actorId, idempotencyKey: input.idempotencyKey }).session(session);
      if (existing) {
        return { order: existing, created: false };
      }

      const settings = await Settings.findOne({ key: 'global' }).session(session);
      if (!settings) throw new AppError(503, 'CHECKOUT_NOT_CONFIGURED', 'Checkout is not configured yet.');
      const customer = await User.findById(actorId).select('phoneE164 status').session(session);
      if (!customer || customer.status !== 'active') {
        throw new AppError(403, 'ACCOUNT_DISABLED', 'This account is unavailable.');
      }
      if (customer.phoneE164 !== input.customerPhone) {
        throw new AppError(400, 'PHONE_MISMATCH', 'The order contact must match the verified account phone number.');
      }
      if (input.fulfilmentMethod === 'pickup' && !settings.pickupEnabled) {
        throw new AppError(400, 'FULFILMENT_UNAVAILABLE', 'Pickup is not currently available.');
      }
      if (input.fulfilmentMethod === 'delivery' && !settings.deliveryEnabled) {
        throw new AppError(400, 'FULFILMENT_UNAVAILABLE', 'Local delivery is not currently available.');
      }
      if ((input.paymentMethod === 'upi' && !settings.upiEnabled) ||
          (input.paymentMethod === 'cash' && !settings.cashEnabled)) {
        throw new AppError(400, 'PAYMENT_METHOD_UNAVAILABLE', 'The selected payment method is not currently available.');
      }

      let deliveryFeePaise = 0;
      if (input.fulfilmentMethod === 'delivery') {
        const address = input.address;
        if (!address) throw new AppError(400, 'ADDRESS_REQUIRED', 'A delivery address is required.');
        const locality = settings.serviceableLocalities.find((candidate) =>
          candidate.name.toLocaleLowerCase() === address.locality.toLocaleLowerCase() &&
          candidate.postalCodes.includes(address.postalCode));
        if (!locality) {
          throw new AppError(400, 'OUTSIDE_SERVICE_AREA', 'This address is outside the configured delivery area.');
        }
        if (locality.deliveryFeePaise == null) {
          throw new AppError(503, 'CHECKOUT_NOT_CONFIGURED', 'Delivery pricing is not configured for this locality.');
        }
        deliveryFeePaise = locality.deliveryFeePaise;
      }

      const itemSnapshots: Array<{
        productId: string;
        sellerId?: string | null;
        variantId?: string;
        productName: string;
        variantAttributes: Map<string, string>;
        unitPricePaise: number;
        quantity: number;
        lineTotalPaise: number;
      }> = [];      let subtotalPaise = 0;
      for (const item of input.items) {
        const reserved = await reserveItem(item, actorId, session);
        const lineTotalPaise = reserved.unitPricePaise * item.quantity;
        subtotalPaise += lineTotalPaise;
        itemSnapshots.push({
          productId: item.productId,
          ...(reserved.sellerId ? { sellerId: reserved.sellerId } : { sellerId: null }),
          ...(item.variantId ? { variantId: item.variantId } : {}),
          productName: reserved.productName,
          variantAttributes: reserved.variantAttributes,
          unitPricePaise: reserved.unitPricePaise,
          quantity: item.quantity,
          lineTotalPaise,
        });
      }
      if (!Number.isSafeInteger(subtotalPaise + deliveryFeePaise)) {
        throw new AppError(400, 'INVALID_TOTAL', 'The order total exceeds the supported amount.');
      }

      const [order] = await Order.create([{
        orderReference: orderReference(),
        idempotencyKey: input.idempotencyKey,
        customerId: actorId,
        customerName: input.customerName,
        customerPhoneE164: input.customerPhone,
        ...(input.deliveryInstructions ? { deliveryInstructions: input.deliveryInstructions } : {}),
        ...(input.fulfilmentMethod === 'delivery' && input.address ? {
          address: {
            name: input.address.name,
            phoneE164: input.address.phone,
            addressLine1: input.address.addressLine1,
            ...(input.address.addressLine2 ? { addressLine2: input.address.addressLine2 } : {}),
            locality: settings.serviceableLocalities.find((candidate) =>
              candidate.name.toLocaleLowerCase() === input.address?.locality.toLocaleLowerCase() &&
              candidate.postalCodes.includes(input.address.postalCode))?.name ?? input.address.locality,
            city: settings.city,
            state: settings.state,
            postalCode: input.address.postalCode,
          },
        } : {}),
        fulfilmentMethod: input.fulfilmentMethod,
        items: itemSnapshots,
        subtotalPaise,
        deliveryFeePaise,
        totalPaise: subtotalPaise + deliveryFeePaise,
        ...(settings.stockReservationHours
          ? { reservationExpiresAt: new Date(Date.now() + settings.stockReservationHours * 60 * 60 * 1000) }
          : {}),
        paymentMethod: input.paymentMethod,
        paymentStatus: 'pending_verification',
        fulfilmentStatus: 'placed',
        statusHistory: [{
          status: 'placed',
          changedAt: new Date(),
          actorType: 'user',
          actorId,
        }],
        paymentEvents: [{ status: 'pending_verification', actorId, note: 'Order placed' }],
      }], { session });
      if (!order) throw new AppError(500, 'INTERNAL_ERROR', 'The order could not be created.');
      await enqueueOrderStatusNotification(order, 'placed', session);
      await AuditLog.create([{
        actorId,
        action: 'order.placed',
        resourceType: 'order',
        resourceId: order.id,
        metadata: { orderReference: order.orderReference, itemCount: order.items.length },
      }], { session });
      return { order, created: true };
    });
    if (!result) throw new AppError(500, 'INTERNAL_ERROR', 'The order could not be created.');
    return result;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const existing = await Order.findOne({ customerId: actorId, idempotencyKey: input.idempotencyKey });
      if (existing) return { order: existing, created: false };
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}
