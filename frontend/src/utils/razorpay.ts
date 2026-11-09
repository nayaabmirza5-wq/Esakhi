import { api } from '../api.js';

interface RazorpaySuccessResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  image?: string;
  order_id: string;
  handler: (response: RazorpaySuccessResponse) => void;
  prefill?: {
    name?: string;
    contact?: string;
    email?: string;
  };
  notes?: Record<string, string>;
  theme?: {
    color?: string;
  };
  modal?: {
    ondismiss?: () => void;
  };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => {
      open: () => void;
      on: (event: string, callback: (response: unknown) => void) => void;
    };
  }
}

let scriptLoadingPromise: Promise<boolean> | null = null;

export function loadRazorpayScript(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);

  if (scriptLoadingPromise) return scriptLoadingPromise;

  scriptLoadingPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      console.warn('Could not load official Razorpay SDK script from CDN.');
      resolve(false);
    };
    document.body.appendChild(script);
  });

  return scriptLoadingPromise;
}

export interface LaunchRazorpayParams {
  orderId: string;
  orderReference: string;
  amountPaise: number;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  onSuccess: (result: { verified: boolean; paymentStatus: string }) => void;
  onError: (error: string) => void;
  onDismiss?: () => void;
}

/**
 * Initializes and triggers Razorpay checkout for an order.
 * If live keys are configured in backend/.env, the official Razorpay modal opens.
 * If keys have not been provided yet, a test simulator is displayed so the workflow works end-to-end.
 */
export async function launchRazorpayPayment(params: LaunchRazorpayParams): Promise<void> {
  const {
    orderId,
    orderReference,
    amountPaise,
    customerName,
    customerPhone,
    customerEmail,
    onSuccess,
    onError,
    onDismiss,
  } = params;

  try {
    const orderData = await api.createRazorpayOrder(orderId);

    // If keys are not set yet, use the built-in simulator
    if (orderData.mode === 'mock') {
      showMockPaymentModal({
        orderId,
        orderReference,
        amountPaise,
        razorpayOrderId: orderData.razorpayOrderId,
        onSuccess,
        onError,
        onDismiss,
      });
      return;
    }

    // Live mode: load official Razorpay SDK
    const loaded = await loadRazorpayScript();
    if (!loaded || !window.Razorpay) {
      onError('Unable to load Razorpay payment gateway. Please check your internet connection.');
      return;
    }

    const options: RazorpayOptions = {
      key: orderData.keyId,
      amount: orderData.amount,
      currency: orderData.currency || 'INR',
      name: 'eSakhi Artisans',
      description: `Payment for Order #${orderReference}`,
      image: '/images/esakhi-emblem.png',
      order_id: orderData.razorpayOrderId,
      handler: async (response: RazorpaySuccessResponse) => {
        try {
          const verification = await api.verifyRazorpayPayment({
            orderId,
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
          });
          onSuccess(verification);
        } catch (cause) {
          onError(cause instanceof Error ? cause.message : 'Payment verification failed.');
        }
      },
      prefill: {
        name: customerName || '',
        contact: customerPhone || '',
        email: customerEmail || '',
      },
      notes: {
        eSakhiOrderId: orderId,
        orderReference,
      },
      theme: {
        color: '#6b215c',
      },
      modal: {
        ondismiss: () => {
          onDismiss?.();
        },
      },
    };

    const rzp = new window.Razorpay(options);
    rzp.open();
  } catch (cause) {
    onError(cause instanceof Error ? cause.message : 'Failed to start Razorpay payment.');
  }
}

/**
 * Built-in mock modal when Razorpay keys are not yet configured in backend/.env.
 */
function showMockPaymentModal(args: {
  orderId: string;
  orderReference: string;
  amountPaise: number;
  razorpayOrderId: string;
  onSuccess: (result: { verified: boolean; paymentStatus: string }) => void;
  onError: (error: string) => void;
  onDismiss?: () => void;
}): void {
  const backdrop = document.createElement('div');
  backdrop.id = 'razorpay-mock-modal';
  Object.assign(backdrop.style, {
    position: 'fixed',
    inset: '0',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '10000',
    padding: '1rem',
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    backgroundColor: '#ffffff',
    borderRadius: '18px',
    maxWidth: '440px',
    width: '100%',
    padding: '1.75rem',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#0f172a',
  });

  const formattedAmount = `₹${(args.amountPaise / 100).toFixed(2)}`;

  card.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1.4rem;">💳</span>
        <div>
          <strong style="display: block; font-size: 1.05rem; color: #0284c7;">Razorpay Integration Ready</strong>
          <small style="color: #64748b; font-size: 0.76rem;">Order #${args.orderReference}</small>
        </div>
      </div>
      <span style="background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 999px; font-size: 0.72rem; font-weight: 800;">
        SIMULATOR MODE
      </span>
    </div>

    <div style="background: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 12px; padding: 1rem; margin-bottom: 1.25rem;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
        <span style="font-size: 0.85rem; color: #475569;">Payable Total:</span>
        <strong style="font-size: 1.15rem; color: #0f172a;">${formattedAmount}</strong>
      </div>
      <p style="font-size: 0.78rem; color: #64748b; margin: 0; line-height: 1.4;">
        ℹ️ <strong>Keys not yet added:</strong> All code, routes, and signature validation logic are fully implemented.
        Simply paste your <code>RAZORPAY_KEY_ID</code> and <code>RAZORPAY_KEY_SECRET</code> into <code>backend/.env</code> anytime to activate live processing.
      </p>
    </div>

    <div style="display: flex; flex-direction: column; gap: 0.6rem;">
      <button id="rzp-sim-success-btn" style="background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color: #ffffff; border: none; padding: 0.8rem; border-radius: 10px; font-weight: 800; font-size: 0.95rem; cursor: pointer;">
        ⚡ Simulate Successful Payment (${formattedAmount})
      </button>
      <button id="rzp-sim-cancel-btn" style="background: transparent; color: #64748b; border: 1px solid #cbd5e1; padding: 0.6rem; border-radius: 10px; font-weight: 600; font-size: 0.85rem; cursor: pointer;">
        Cancel
      </button>
    </div>
  `;

  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  const cleanup = () => {
    backdrop.remove();
  };

  card.querySelector('#rzp-sim-cancel-btn')?.addEventListener('click', () => {
    cleanup();
    args.onDismiss?.();
  });

  card.querySelector('#rzp-sim-success-btn')?.addEventListener('click', async () => {
    const btn = card.querySelector('#rzp-sim-success-btn') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.innerText = 'Verifying with Backend…';
    }

    try {
      const mockPaymentId = `pay_mock_${Date.now().toString().slice(-8)}`;
      const mockSignature = `sig_mock_${Date.now().toString().slice(-8)}`;

      const result = await api.verifyRazorpayPayment({
        orderId: args.orderId,
        razorpayOrderId: args.razorpayOrderId,
        razorpayPaymentId: mockPaymentId,
        razorpaySignature: mockSignature,
      });

      cleanup();
      args.onSuccess(result);
    } catch (err) {
      cleanup();
      args.onError(err instanceof Error ? err.message : 'Mock verification failed.');
    }
  });
}
