import { useState } from 'react';
import type { ReactNode } from 'react';
import { api, resolveProductImageUrl } from './api';
import type { SellerOrder } from './types';
import { MeeshoSlipModal } from './components/MeeshoSlipModal';

function formatMoneyInr(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format((paise || 0) / 100);
}

const DEFAULT_5_INSPECTION_PHOTOS = [
  '/images/products/chanderi-silk-saree.jpg',
  '/images/products/zardozi-clutch.jpg',
  '/images/products/bamboo-tokri.jpg',
  '/images/products/terracotta-diya.jpg',
  '/images/products/multani-mitti-soap.jpg',
];

const INSPECTION_ANGLE_LABELS = [
  '1. Front View',
  '2. Back / Weave',
  '3. Craft Detail',
  '4. Inner Wrap',
  '5. Outer Box',
];

const SELLER_STAGE_BADGE: Record<string, { code: string; label: string; bg: string; color: string; border: string }> = {
  placed: { code: 'ORDER_CONFIRMED', label: 'Order Confirmed', bg: '#fef3c7', color: '#92400e', border: '#f59e0b' },
  order_confirmed: { code: 'ORDER_CONFIRMED', label: 'Order Confirmed', bg: '#fef3c7', color: '#92400e', border: '#f59e0b' },
  accepted: { code: 'ORDER_CONFIRMED', label: 'Order Confirmed', bg: '#fef3c7', color: '#92400e', border: '#f59e0b' },
  preparing: { code: 'PREPARING', label: 'Preparing Package', bg: '#ffedd5', color: '#9a3412', border: '#f97316' },
  ready_for_pickup: { code: 'READY_FOR_PICKUP', label: 'Ready for Pickup', bg: '#dbeafe', color: '#1e40af', border: '#3b82f6' },
  delivery_partner_assigned: { code: 'PARTNER_ASSIGNED', label: 'Partner Assigned', bg: '#e0e7ff', color: '#3730a3', border: '#6366f1' },
  out_for_pickup: { code: 'OUT_FOR_PICKUP', label: 'Partner En Route for Pickup', bg: '#cffafe', color: '#155e75', border: '#06b6d4' },
  picked_up: { code: 'PICKED_UP', label: 'Picked Up from Shop', bg: '#f3e8ff', color: '#6b21a8', border: '#a855f7' },
  out_for_delivery: { code: 'OUT_FOR_DELIVERY', label: 'Out for Delivery to Customer', bg: '#fce7f3', color: '#9d174d', border: '#ec4899' },
  delivered: { code: 'DELIVERED', label: 'Delivered & Settled', bg: '#dcfce7', color: '#166534', border: '#22c55e' },
  completed: { code: 'DELIVERED', label: 'Completed', bg: '#dcfce7', color: '#166534', border: '#22c55e' },
  cancelled: { code: 'ORDER_CANCELLED', label: 'Cancelled', bg: '#f1f5f9', color: '#475569', border: '#94a3b8' },
  delivery_failed: { code: 'DELIVERY_FAILED', label: 'Delivery Failed', bg: '#fee2e2', color: '#991b1b', border: '#ef4444' },
  return_requested: { code: 'RETURN_REQUESTED', label: 'Return Dispute Under Review', bg: '#ffedd5', color: '#9a3412', border: '#f97316' },
  return_rejected: { code: 'RETURN_REJECTED', label: 'Return Dispute Rejected', bg: '#dcfce7', color: '#166534', border: '#22c55e' },
  return_accepted: { code: 'RETURN_ACCEPTED', label: 'Return Approved by City Admin', bg: '#fef3c7', color: '#92400e', border: '#f59e0b' },
  return_partner_assigned: { code: 'RETURN_PARTNER_ASSIGNED', label: 'Reverse Agent Assigned', bg: '#dbeafe', color: '#1e40af', border: '#3b82f6' },
  return_picked_up: { code: 'RETURN_PICKED_UP', label: 'Return Item En Route to Seller', bg: '#e0e7ff', color: '#3730a3', border: '#6366f1' },
  return_delivered_to_seller: { code: 'RETURN_DELIVERED_TO_SELLER', label: 'Return Received by Seller', bg: '#f3e8ff', color: '#6b21a8', border: '#a855f7' },
  ready_for_refund: { code: 'READY_FOR_REFUND', label: 'Escalated for Refund', bg: '#fce7f3', color: '#9d174d', border: '#ec4899' },
  refund_completed: { code: 'REFUND_COMPLETED', label: 'Customer Refund Completed', bg: '#f1f5f9', color: '#334155', border: '#64748b' },
};

const SELLER_TIMELINE_STEPS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: 'confirmed', label: '1. Order Confirmed', statuses: ['placed', 'order_confirmed', 'accepted'] },
  { key: 'preparing', label: '2. Preparing', statuses: ['preparing'] },
  { key: 'ready', label: '3. Ready for Pickup', statuses: ['ready_for_pickup'] },
  { key: 'pickup', label: '4. Partner Pickup', statuses: ['delivery_partner_assigned', 'out_for_pickup', 'picked_up', 'out_for_delivery'] },
  {
    key: 'delivered',
    label: '5. Delivered',
    statuses: [
      'delivered',
      'completed',
      'return_requested',
      'return_rejected',
      'return_accepted',
      'return_partner_assigned',
      'return_picked_up',
      'return_delivered_to_seller',
      'ready_for_refund',
      'refund_completed',
    ],
  },
];

export function SellerOrderSkeleton({ count = 2 }: { count?: number }): ReactNode {
  return (
    <div style={{ display: 'grid', gap: '1rem' }} aria-busy="true" aria-label="Syncing seller orders">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          style={{
            borderRadius: '16px',
            border: '1px solid rgba(107, 33, 92, 0.14)',
            background: '#fff',
            padding: '1.25rem',
            display: 'grid',
            gap: '0.85rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
            <div style={{ height: '22px', width: '220px', borderRadius: '6px', background: 'rgba(107, 33, 92, 0.09)' }} />
            <div style={{ height: '26px', width: '140px', borderRadius: '999px', background: 'rgba(107, 33, 92, 0.09)' }} />
          </div>
          <div style={{ height: '18px', width: '65%', borderRadius: '6px', background: 'rgba(107, 33, 92, 0.06)' }} />
          <div style={{ height: '44px', width: '100%', borderRadius: '10px', background: 'rgba(107, 33, 92, 0.05)' }} />
        </div>
      ))}
    </div>
  );
}

export function SellerOrderCard({
  order,
  isUpdating,
  onTransitionStatus,
}: {
  order: SellerOrder;
  isUpdating: boolean;
  onTransitionStatus: (order: SellerOrder, nextStatus: 'preparing' | 'ready_for_pickup' | 'completed') => Promise<void>;
}): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const [showSlip, setShowSlip] = useState(false);
  const [inspectionImages, setInspectionImages] = useState<string[]>(
    order.preDispatchInspection?.imageUrls?.length === 5
      ? order.preDispatchInspection.imageUrls
      : DEFAULT_5_INSPECTION_PHOTOS,
  );
  const [savingPhotos, setSavingPhotos] = useState(false);
  const [photoSavedMsg, setPhotoSavedMsg] = useState<string | null>(null);

  const badge = SELLER_STAGE_BADGE[order.fulfilmentStatus] ?? {
    code: order.fulfilmentStatus.toUpperCase(),
    label: order.fulfilmentStatus.replaceAll('_', ' '),
    bg: '#f3f4f6',
    color: '#374151',
    border: '#9ca3af',
  };

  const itemsPreview = order.items.map((item) => `${item.productName} × ${item.quantity}`).join(', ');
  const currentStepIdx = SELLER_TIMELINE_STEPS.findIndex((step) => step.statuses.includes(order.fulfilmentStatus));
  const isConfirmedStage = ['placed', 'order_confirmed', 'accepted'].includes(order.fulfilmentStatus);
  const isPreparingStage = order.fulfilmentStatus === 'preparing';
  const isReadyStage = order.fulfilmentStatus === 'ready_for_pickup';
  const isPartnerStage = ['delivery_partner_assigned', 'out_for_pickup', 'picked_up', 'out_for_delivery'].includes(order.fulfilmentStatus);
  const isCompletedStage = ['delivered', 'completed'].includes(order.fulfilmentStatus);
  const isReverseReturnStage = [
    'return_requested',
    'return_rejected',
    'return_accepted',
    'return_partner_assigned',
    'return_picked_up',
    'return_delivered_to_seller',
    'ready_for_refund',
    'refund_completed',
  ].includes(order.fulfilmentStatus);

  const etaMinutes = order.deliveryPartner?.estimatedPickupEtaMinutes
    ?? (order.deliveryPartner?.distanceKm != null
      ? Math.max(3, Math.round((order.deliveryPartner.distanceKm / 22) * 60))
      : 6);

  const handleReplaceAngleImage = (index: number, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      setInspectionImages((prev) => prev.map((img, i) => (i === index ? dataUrl : img)));
    };
    reader.readAsDataURL(file);
  };

  const handleSaveInspectionPhotos = async () => {
    setSavingPhotos(true);
    setPhotoSavedMsg(null);
    try {
      await api.uploadSellerOrderInspectionImages(order._id, {
        imageUrls: inspectionImages,
        inspectionNote: '5 mandatory pre-dispatch inspection photos verified by Seller before handover.',
      });
      setPhotoSavedMsg('✓ 5 Pre-Dispatch Inspection Photos saved as dispute ground truth!');
    } catch {
      setPhotoSavedMsg('Could not save inspection photos.');
    } finally {
      setSavingPhotos(false);
    }
  };

  const handleActionClick = async (nextStatus: 'preparing' | 'ready_for_pickup' | 'completed') => {
    if (nextStatus === 'ready_for_pickup') {
      await api
        .uploadSellerOrderInspectionImages(order._id, {
          imageUrls: inspectionImages,
          inspectionNote: '5 mandatory pre-dispatch inspection photos verified prior to Ready-for-Pickup handover.',
        })
        .catch(() => undefined);
    }
    void onTransitionStatus(order, nextStatus);
  };

  return (
    <article
      className="seller-order-card-modern"
      style={{
        borderRadius: '16px',
        border: `1.5px solid ${isConfirmedStage ? '#f59e0b66' : isPreparingStage ? '#f9731666' : 'rgba(107, 33, 92, 0.16)'}`,
        background: 'var(--surface, #ffffff)',
        padding: '1.25rem',
        boxShadow: '0 6px 20px rgba(42, 18, 35, 0.05)',
        display: 'grid',
        gap: '1rem',
        transition: 'box-shadow 0.2s ease',
      }}
    >
      {/* Card Header */}
      <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.85rem' }}>
        <div style={{ display: 'grid', gap: '0.25rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.55rem' }}>
            <span
              style={{
                fontFamily: 'monospace',
                fontWeight: 800,
                fontSize: '0.95rem',
                color: 'var(--brand, #6b215c)',
                background: 'rgba(107, 33, 92, 0.08)',
                padding: '0.2rem 0.55rem',
                borderRadius: '6px',
              }}
            >
              #{order.orderReference}
            </span>
            <span style={{ fontSize: '0.82rem', color: 'var(--muted, #6a5864)' }}>
              Placed {new Date(order.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
            <span
              style={{
                fontSize: '0.74rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                padding: '0.15rem 0.5rem',
                borderRadius: '999px',
                background: 'rgba(120, 80, 100, 0.1)',
                color: 'var(--text, #2b1924)',
              }}
            >
              {order.fulfilmentMethod}
            </span>
          </div>
          <h3 style={{ margin: '0.15rem 0 0', fontSize: '1.12rem', fontWeight: 700, color: 'var(--text, #23141d)' }}>
            {itemsPreview}
          </h3>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ textAlign: 'right' }}>
            <strong style={{ display: 'block', fontSize: '1.1rem', color: 'var(--text, #23141d)' }}>
              {formatMoneyInr(order.subtotalPaise)}
            </strong>
            <small style={{ fontSize: '0.76rem', color: 'var(--muted, #6a5864)' }}>
              Payment: {order.paymentStatus === 'confirmed' ? '✓ Paid / Settled' : order.paymentStatus === 'refunded' ? '↺ Refunded' : 'Pending Verification'}
            </small>
          </div>
          <span
            style={{
              display: 'inline-flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              padding: '0.38rem 0.85rem',
              borderRadius: '10px',
              background: badge.bg,
              color: badge.color,
              border: `1.5px solid ${badge.border}`,
              fontWeight: 700,
              fontSize: '0.82rem',
              lineHeight: 1.2,
            }}
          >
            <span>{badge.label}</span>
            <small style={{ fontSize: '0.66rem', opacity: 0.85, fontFamily: 'monospace' }}>{badge.code}</small>
          </span>
        </div>
      </header>

      {/* Customer Fulfillment Timeline Progress Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: '0.45rem',
          padding: '0.65rem',
          borderRadius: '12px',
          background: 'var(--surface-subtle, #fbf7fa)',
          border: '1px solid rgba(107, 33, 92, 0.1)',
        }}
      >
        {SELLER_TIMELINE_STEPS.map((step, index) => {
          const completed = currentStepIdx >= index;
          const active = currentStepIdx === index;
          return (
            <div
              key={step.key}
              style={{
                padding: '0.4rem 0.55rem',
                borderRadius: '8px',
                fontSize: '0.76rem',
                fontWeight: active ? 800 : 600,
                background: active ? 'var(--brand, #6b215c)' : completed ? 'rgba(29, 107, 67, 0.12)' : 'transparent',
                color: active ? '#ffffff' : completed ? '#166534' : 'var(--muted, #7a6874)',
              }}
            >
              {completed && !active ? '✓ ' : ''}{step.label}
            </div>
          );
        })}
      </div>

      {/* Seller Pre-Dispatch 5-Image Inspection Uploader (Visible in PREPARING stage or as Ground Truth badge) */}
      {(isPreparingStage || (order.preDispatchInspection?.imageUrls && order.preDispatchInspection.imageUrls.length === 5)) && (
        <div
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '12px',
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <div>
              <strong style={{ fontSize: '0.84rem', color: '#0f172a' }}>
                📸 5 Mandatory Pre-Dispatch Inspection Photos (Dispute Ground Truth)
              </strong>
              <div style={{ fontSize: '0.75rem', color: '#475569' }}>
                Attached permanently to order record to protect Seller against post-delivery return disputes.
              </div>
            </div>
            {isPreparingStage && (
              <button
                type="button"
                className="seller-secondary-action"
                disabled={savingPhotos}
                onClick={handleSaveInspectionPhotos}
                style={{ fontSize: '0.76rem', padding: '0.35rem 0.75rem' }}
              >
                {savingPhotos ? 'Saving…' : '✓ Save 5 Inspection Photos'}
              </button>
            )}
          </div>
          {photoSavedMsg && (
            <div style={{ fontSize: '0.76rem', color: '#15803d', fontWeight: 700, marginBottom: 6 }}>{photoSavedMsg}</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(72px, 1fr))', gap: 8 }}>
            {inspectionImages.map((imgUrl, idx) => (
              <div
                key={idx}
                style={{
                  padding: 4,
                  borderRadius: 8,
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  textAlign: 'center',
                }}
              >
                <img
                  src={resolveProductImageUrl(imgUrl)}
                  alt={INSPECTION_ANGLE_LABELS[idx]}
                  style={{ width: '100%', height: 54, objectFit: 'cover', borderRadius: 6 }}
                />
                <div style={{ fontSize: 10, fontWeight: 700, color: '#334155', marginTop: 2 }}>
                  {INSPECTION_ANGLE_LABELS[idx]}
                </div>
                {isPreparingStage && (
                  <label
                    style={{
                      display: 'inline-block',
                      marginTop: 2,
                      fontSize: 9,
                      color: '#6b215c',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Replace
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => e.target.files?.[0] && handleReplaceAngleImage(idx, e.target.files[0])}
                    />
                  </label>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reverse Logistics Live Tracking Notification for Seller */}
      {isReverseReturnStage && (
        <div
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '12px',
            background: order.fulfilmentStatus === 'return_picked_up' ? '#eff6ff' : '#fff7ed',
            border: `1.5px solid ${order.fulfilmentStatus === 'return_picked_up' ? '#3b82f6' : '#f97316'}`,
          }}
        >
          <strong style={{ fontSize: '0.88rem', color: order.fulfilmentStatus === 'return_picked_up' ? '#1e40af' : '#9a3412' }}>
            {order.fulfilmentStatus === 'return_picked_up'
              ? '🚚 Return item picked up from customer, agent is arriving at your location'
              : order.fulfilmentStatus === 'return_partner_assigned'
                ? `🛵 Reverse Pickup Partner (${order.deliveryPartner?.name || 'Agent'}) assigned to collect return from Customer`
                : order.fulfilmentStatus === 'return_delivered_to_seller'
                  ? '📦 Return package handed over to your shop (RETURN_DELIVERED_TO_SELLER)'
                  : `🔄 Reverse Return Status: ${order.fulfilmentStatus.replaceAll('_', ' ').toUpperCase()}`}
          </strong>
        </div>
      )}

      {/* Live Incoming Delivery Partner Status Banner */}
      {order.deliveryPartner?.name && !isReverseReturnStage && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.75rem 1rem',
            borderRadius: '12px',
            background: order.fulfilmentStatus === 'out_for_pickup'
              ? 'rgba(6, 182, 212, 0.1)'
              : 'rgba(99, 102, 241, 0.08)',
            border: '1px solid rgba(99, 102, 241, 0.28)',
          }}
        >
          <div style={{ display: 'grid', gap: '0.15rem' }}>
            <strong style={{ fontSize: '0.9rem', color: '#1e3a8a' }}>
              {order.fulfilmentStatus === 'delivery_partner_assigned' && `🛵 Delivery Partner Assigned: ${order.deliveryPartner.name}`}
              {order.fulfilmentStatus === 'out_for_pickup' && `🚚 Partner En Route to Your Shop: ${order.deliveryPartner.name}`}
              {order.fulfilmentStatus === 'picked_up' && `📦 Package Picked Up by ${order.deliveryPartner.name}`}
              {order.fulfilmentStatus === 'out_for_delivery' && `🛵 Out for Delivery to Customer with ${order.deliveryPartner.name}`}
              {isCompletedStage && `✓ Delivered to Customer by ${order.deliveryPartner.name}`}
              {isReadyStage && `🛵 Assigned Partner: ${order.deliveryPartner.name}`}
            </strong>
            <small style={{ color: 'var(--muted, #5c4b56)' }}>
              {order.deliveryPartner.distanceKm != null ? `Proximity: ${order.deliveryPartner.distanceKm} km from your shop · ` : ''}
              {['ready_for_pickup', 'delivery_partner_assigned', 'out_for_pickup'].includes(order.fulfilmentStatus)
                ? `Estimated Pickup ETA: ~${etaMinutes} mins`
                : order.pickedUpAt
                  ? `Picked up at ${new Date(order.pickedUpAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
                  : 'Live dispatch sync active'}
            </small>
          </div>
          {order.deliveryPartner.phoneE164 && (
            <a
              href={`tel:${order.deliveryPartner.phoneE164}`}
              className="seller-secondary-action"
              style={{ textDecoration: 'none', fontWeight: 700, fontSize: '0.84rem' }}
            >
              📞 Call Partner ({order.deliveryPartner.phoneE164})
            </a>
          )}
        </div>
      )}

      {/* Expandable Order Details Body */}
      {expanded && (
        <div
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '12px',
            background: 'rgba(107, 33, 92, 0.03)',
            border: '1px solid rgba(107, 33, 92, 0.12)',
            display: 'grid',
            gap: '0.65rem',
          }}
        >
          <strong style={{ fontSize: '0.84rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--brand, #6b215c)' }}>
            Order Line Items & Timestamps
          </strong>
          <div style={{ display: 'grid', gap: '0.35rem' }}>
            {order.items.map((item, idx) => (
              <div key={`${item.productName}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                <span>{item.productName} × <strong>{item.quantity}</strong></span>
                <strong>{formatMoneyInr(item.lineTotalPaise)}</strong>
              </div>
            ))}
          </div>
          {order.statusHistory && order.statusHistory.length > 0 && (
            <div style={{ borderTop: '1px solid rgba(107, 33, 92, 0.12)', paddingTop: '0.5rem', fontSize: '0.8rem', color: 'var(--muted, #6a5864)' }}>
              <strong>Checkpoint Log:</strong>{' '}
              {order.statusHistory.map((h, i) => (
                <span key={`${h.status}-${i}`}>
                  {i > 0 ? ' → ' : ''}
                  {h.status.replaceAll('_', ' ')} ({new Date(h.changedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })})
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Streamlined Progressive-Disclosure Action Bar */}
      <footer
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
          paddingTop: '0.75rem',
          borderTop: '1px solid rgba(107, 33, 92, 0.12)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="seller-secondary-action"
            onClick={() => setExpanded((prev) => !prev)}
            style={{ fontSize: '0.84rem', padding: '0.42rem 0.8rem' }}
          >
            {expanded ? 'Hide Details ▲' : 'View Details ▼'}
          </button>
          <button
            type="button"
            className="seller-secondary-action"
            onClick={() => setShowSlip(true)}
            style={{ fontSize: '0.84rem', padding: '0.42rem 0.8rem', background: '#f8fafc', color: '#475569', border: '1px solid #cbd5e1' }}
          >
            🏷️ Meesho Slip & Bill
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.65rem' }}>
          {/* Stage 1: ORDER_CONFIRMED -> Primary CTA: Mark as Preparing */}
          {isConfirmedStage && (
            <button
              type="button"
              className="seller-primary-action"
              disabled={isUpdating}
              onClick={() => void handleActionClick('preparing')}
              style={{
                background: '#d97706',
                color: '#ffffff',
                fontWeight: 700,
                padding: '0.6rem 1.25rem',
                borderRadius: '10px',
                border: 'none',
                cursor: isUpdating ? 'wait' : 'pointer',
                boxShadow: '0 4px 12px rgba(217, 119, 6, 0.28)',
              }}
            >
              {isUpdating ? '⟳ Updating…' : '✓ Accept & Pack'}
            </button>
          )}

          {/* Stage 2: PREPARING -> Primary CTA: Mark as Ready for Pickup */}
          {isPreparingStage && (
            <button
              type="button"
              className="seller-primary-action"
              disabled={isUpdating}
              onClick={() => void handleActionClick('ready_for_pickup')}
              style={{
                background: '#1d6b43',
                color: '#ffffff',
                fontWeight: 700,
                padding: '0.6rem 1.25rem',
                borderRadius: '10px',
                border: 'none',
                cursor: isUpdating ? 'wait' : 'pointer',
                boxShadow: '0 4px 12px rgba(29, 107, 67, 0.28)',
              }}
            >
              {isUpdating ? '⟳ Notifying Fleet…' : '📦 Ready for Delivery Partner'}
            </button>
          )}

          {/* Stage 3: READY_FOR_PICKUP */}
          {isReadyStage && order.fulfilmentMethod === 'delivery' && (
            <div
              role="status"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 0.95rem',
                borderRadius: '999px',
                background: order.deliveryPartner?.name ? '#dbeafe' : '#fef3c7',
                color: order.deliveryPartner?.name ? '#1e40af' : '#92400e',
                border: `1.5px solid ${order.deliveryPartner?.name ? '#60a5fa' : '#f59e0b'}`,
                fontWeight: 700,
                fontSize: '0.85rem',
              }}
            >
              <span>{order.deliveryPartner?.name ? '🚚' : '⏳'}</span>
              <span>
                {order.deliveryPartner?.name
                  ? `Partner Dispatched (${order.deliveryPartner.name}) · Pickup ETA ~${etaMinutes} mins`
                  : 'Waiting for City Admin to Dispatch Partner'}
              </span>
            </div>
          )}

          {isReadyStage && order.fulfilmentMethod === 'pickup' && (
            <button
              type="button"
              className="seller-primary-action"
              disabled={isUpdating}
              onClick={() => void handleActionClick('completed')}
            >
              {isUpdating ? '⟳ Updating…' : 'Confirm Customer Pickup Completed'}
            </button>
          )}

          {/* Stage 4: Partner Assigned / En Route / Picked Up / Out for Delivery */}
          {isPartnerStage && (
            <div
              role="status"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 0.95rem',
                borderRadius: '999px',
                background: '#e0e7ff',
                color: '#3730a3',
                border: '1.5px solid #818cf8',
                fontWeight: 700,
                fontSize: '0.85rem',
              }}
            >
              <span>
                {order.fulfilmentStatus === 'delivery_partner_assigned' && `🛵 Partner Assigned (${order.deliveryPartner?.name || 'Partner'}) · Pickup ETA ~${etaMinutes} mins`}
                {order.fulfilmentStatus === 'out_for_pickup' && `🚚 Partner En Route for Pickup · ETA ~${etaMinutes} mins`}
                {order.fulfilmentStatus === 'picked_up' && '📦 Package Handed Over to Delivery Partner'}
                {order.fulfilmentStatus === 'out_for_delivery' && '🛵 Package Out for Delivery to Customer'}
              </span>
            </div>
          )}

          {/* Stage 5: Completed / Delivered */}
          {isCompletedStage && (
            <div
              role="status"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.48rem 0.9rem',
                borderRadius: '999px',
                background: '#dcfce7',
                color: '#166534',
                border: '1.5px solid #4ade80',
                fontWeight: 700,
                fontSize: '0.85rem',
              }}
            >
              ✓ Delivered to Customer{order.deliveredAt ? ` (${new Date(order.deliveredAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })})` : ''}
            </div>
          )}
        </div>
      </footer>
      {/* Meesho 2-in-1 Shipping Label & Tax Invoice Modal */}
      {showSlip && (
        <MeeshoSlipModal order={order} onClose={() => setShowSlip(false)} />
      )}
    </article>
  );
}
