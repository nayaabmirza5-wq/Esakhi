import type { RequestHandler } from 'express';
import { z } from 'zod';
import { sendData } from '../../utils/apiResponse.js';
import { AppError } from '../../utils/AppError.js';
import { authenticatedUserId } from '../../utils/authenticatedUser.js';
import { Order } from '../orders/order.model.js';
import { logger } from '../../utils/logger.js';
import {
  isRazorpayConfigured,
  getRazorpayKeyId,
  createRazorpayOrder,
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
} from './razorpay.service.js';

export const getRazorpayConfig: RequestHandler = (_req, res) => {
  sendData(res, {
    configured: isRazorpayConfigured(),
    keyId: getRazorpayKeyId(),
  });
};

const createOrderBodySchema = z.object({
  orderId: z.string().trim().min(1),
});

export const createRazorpayOrderController: RequestHandler = async (req, res) => {
  const { orderId } = createOrderBodySchema.parse(req.body);
  const customerId = authenticatedUserId(req);

  const order = await Order.findOne({ _id: orderId, customerId });
  if (!order) {
    throw new AppError(404, 'NOT_FOUND', 'Order not found.');
  }

  if (order.paymentStatus === 'confirmed') {
    throw new AppError(409, 'ALREADY_PAID', 'This order has already been paid and confirmed.');
  }

  const razorpayOrder = await createRazorpayOrder({
    amountPaise: order.totalPaise,
    receipt: order.orderReference,
    notes: {
      eSakhiOrderId: order._id.toString(),
      orderReference: order.orderReference,
      customerPhone: order.customerPhoneE164 || '',
    },
  });

  // Attach Razorpay orderId to the order
  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        'razorpay.orderId': razorpayOrder.id,
      },
    }
  );

  sendData(res, {
    razorpayOrderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    keyId: razorpayOrder.keyId,
    mode: razorpayOrder.mode,
    orderReference: order.orderReference,
    customerName: order.customerName,
    customerPhone: order.customerPhoneE164,
  });
};

const verifyPaymentBodySchema = z.object({
  orderId: z.string().trim().min(1),
  razorpayOrderId: z.string().trim().min(1),
  razorpayPaymentId: z.string().trim().min(1),
  razorpaySignature: z.string().trim().min(1),
});

export const verifyRazorpayPaymentController: RequestHandler = async (req, res) => {
  const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = verifyPaymentBodySchema.parse(req.body);
  const customerId = authenticatedUserId(req);

  const order = await Order.findOne({ _id: orderId, customerId });
  if (!order) {
    throw new AppError(404, 'NOT_FOUND', 'Order not found.');
  }

  const isValid = verifyRazorpayPaymentSignature({
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  });

  if (!isValid) {
    logger.warn('Razorpay payment signature mismatch', { orderId, razorpayOrderId, razorpayPaymentId });
    throw new AppError(400, 'INVALID_PAYMENT_SIGNATURE', 'Payment verification failed. Signature mismatch.');
  }

  // Update order to confirmed payment
  const updatedOrder = await Order.findOneAndUpdate(
    { _id: order._id },
    {
      $set: {
        paymentStatus: 'confirmed',
        'razorpay.orderId': razorpayOrderId,
        'razorpay.paymentId': razorpayPaymentId,
        'razorpay.signature': razorpaySignature,
      },
      $push: {
        paymentEvents: {
          status: 'confirmed',
          actorId: customerId,
          note: `Razorpay payment authorized successfully. Payment ID: ${razorpayPaymentId}`,
          createdAt: new Date(),
        },
      },
    },
    { new: true }
  );

  logger.info('Razorpay payment confirmed successfully', {
    orderId: order._id.toString(),
    orderReference: order.orderReference,
    razorpayPaymentId,
  });

  sendData(res, {
    verified: true,
    paymentStatus: 'confirmed',
    orderReference: updatedOrder?.orderReference,
  });
};

export const razorpayWebhookController: RequestHandler = async (req, res) => {
  const signature = req.headers['x-razorpay-signature'] as string | undefined;
  if (!signature) {
    res.status(400).json({ error: 'Missing webhook signature' });
    return;
  }

  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const isValid = verifyRazorpayWebhookSignature(rawBody, signature);

  if (!isValid) {
    logger.warn('Razorpay webhook signature verification failed');
    res.status(400).json({ error: 'Invalid webhook signature' });
    return;
  }

  const event = req.body as { event?: string; payload?: { payment?: { entity?: { order_id?: string; id?: string } } } };
  logger.info('Razorpay webhook event received', { event: event.event });

  if (event.event === 'payment.captured' || event.event === 'order.paid') {
    const rzpOrderId = event.payload?.payment?.entity?.order_id;
    const rzpPaymentId = event.payload?.payment?.entity?.id;

    if (rzpOrderId) {
      await Order.updateOne(
        { 'razorpay.orderId': rzpOrderId },
        {
          $set: {
            paymentStatus: 'confirmed',
            'razorpay.paymentId': rzpPaymentId,
          },
        }
      );
    }
  }

  res.status(200).json({ status: 'ok' });
};
