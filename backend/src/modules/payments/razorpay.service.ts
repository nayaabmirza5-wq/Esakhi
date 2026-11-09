import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../utils/AppError.js';

export interface CreateOrderParams {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrderResponse {
  id: string;
  amount: number;
  currency: string;
  keyId: string;
  mode: 'live' | 'mock';
  message?: string;
}

export interface VerifyPaymentParams {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export function isRazorpayConfigured(): boolean {
  return Boolean(env.RAZORPAY_KEY_ID?.trim() && env.RAZORPAY_KEY_SECRET?.trim());
}

export function getRazorpayKeyId(): string | null {
  return env.RAZORPAY_KEY_ID?.trim() || null;
}

/**
 * Creates a Razorpay Order.
 * If RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are provided in backend/.env,
 * this calls the official Razorpay v1 API directly.
 * Otherwise, it provides a mock order so the checkout UI and logic can be tested end-to-end.
 */
export async function createRazorpayOrder(params: CreateOrderParams): Promise<RazorpayOrderResponse> {
  const { amountPaise, receipt, notes = {} } = params;

  if (isRazorpayConfigured()) {
    const keyId = env.RAZORPAY_KEY_ID!.trim();
    const keySecret = env.RAZORPAY_KEY_SECRET!.trim();
    const authHeader = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

    try {
      const response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({
          amount: amountPaise,
          currency: 'INR',
          receipt: receipt.slice(0, 40),
          notes,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Razorpay API create order error', { status: response.status, body: errorText });
        throw new AppError(502, 'RAZORPAY_API_ERROR', 'Failed to initialize payment with Razorpay.');
      }

      const data = (await response.json()) as { id: string; amount: number; currency: string };
      return {
        id: data.id,
        amount: data.amount,
        currency: data.currency || 'INR',
        keyId,
        mode: 'live',
      };
    } catch (cause) {
      if (cause instanceof AppError) throw cause;
      logger.error('Razorpay network error', { error: cause instanceof Error ? cause.message : cause });
      throw new AppError(502, 'RAZORPAY_NETWORK_ERROR', 'Unable to reach payment gateway. Please check your network.');
    }
  }

  // Ready-to-go Mock Mode when keys haven't been added yet
  logger.info('Razorpay operating in mock/placeholder mode (keys not yet added in backend/.env)', { receipt, amountPaise });
  return {
    id: `order_mock_${receipt}_${Date.now().toString().slice(-6)}`,
    amount: amountPaise,
    currency: 'INR',
    keyId: 'rzp_test_placeholder_key',
    mode: 'mock',
    message: 'Razorpay keys not yet added in backend/.env. Ready to plug in real keys anytime.',
  };
}

/**
 * Verifies Razorpay payment signature using standard HMAC-SHA256.
 */
export function verifyRazorpayPaymentSignature(params: VerifyPaymentParams): boolean {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = params;

  if (isRazorpayConfigured()) {
    const keySecret = env.RAZORPAY_KEY_SECRET!.trim();
    const body = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expectedSignature = createHmac('sha256', keySecret).update(body).digest('hex');

    try {
      const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
      const signatureBuffer = Buffer.from(razorpaySignature, 'utf8');
      if (expectedBuffer.length !== signatureBuffer.length) return false;
      return timingSafeEqual(expectedBuffer, signatureBuffer);
    } catch {
      return false;
    }
  }

  // In mock mode without secret keys, any non-empty signature is accepted for sandbox testing
  return Boolean(razorpayOrderId && razorpayPaymentId && razorpaySignature);
}

/**
 * Verifies Razorpay webhook signature.
 */
export function verifyRazorpayWebhookSignature(rawBody: string, webhookSignature: string): boolean {
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) return false;

  try {
    const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const signatureBuffer = Buffer.from(webhookSignature, 'utf8');
    if (expectedBuffer.length !== signatureBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, signatureBuffer);
  } catch {
    return false;
  }
}
