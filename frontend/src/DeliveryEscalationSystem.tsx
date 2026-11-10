import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api';
import type {
  AdminResolutionAction,
  CityAdminDeliveryPartner,
  CityAdminOrder,
  DeliveryException,
  DeliveryExceptionReasonCode,
  Order,
  RiderRequestedAction,
} from './types';

export const REASON_CODE_LABELS: Record<DeliveryExceptionReasonCode, string> = {
  CUSTOMER_UNAVAILABLE: 'Customer Unavailable / Phone Unreachable',
  INCORRECT_ADDRESS: 'Incorrect or Incomplete Address',
  CUSTOMER_REFUSED: 'Customer Refused Delivery / Cancelled at Door',
  RIDER_VEHICLE_ISSUE: 'Vehicle Issue / Breakdown',
  WEATHER_OR_ROAD_BLOCK: 'Severe Weather or Road Block',
  RIDER_EMERGENCY: 'Personal or Medical Emergency',
  OTHER: 'Other Reason',
};

export const REQUESTED_ACTION_LABELS: Record<RiderRequestedAction, string> = {
  UNASSIGN_ME: 'Unassign Me & Escalate to City Admin',
  RETRY_LATER: 'I Will Retry Delivery Later',
  CANCEL_ORDER: 'Customer Requested Full Cancellation',
};

export const RESOLUTION_ACTION_LABELS: Record<AdminResolutionAction, string> = {
  REASSIGN_NEW_RIDER: 'Reassign to New Delivery Partner',
  REASSIGN_SAME_RIDER: 'Instruct Same Partner to Retry Delivery',
  RESCHEDULE_LATER: 'Reschedule Delivery for Later (Ready for Pickup)',
  TRIGGER_RTO: 'Trigger Return To Origin (RTO)',
};

/* ============================================================================
 * 1. DELIVERY FAILURE REPORTING MODAL (FOR DELIVERY PARTNER PAGE)
 * ============================================================================ */

interface DeliveryFailureReportModalProps {
  order: Order;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export const DeliveryFailureReportModal: React.FC<DeliveryFailureReportModalProps> = ({
  order,
  onClose,
  onSuccess,
}) => {
  const [reasonCode, setReasonCode] = useState<DeliveryExceptionReasonCode>('CUSTOMER_UNAVAILABLE');
  const [reasonNotes, setReasonNotes] = useState('');
  const [proofImageUrl, setProofImageUrl] = useState('');
  const [riderRequestedAction, setRiderRequestedAction] = useState<RiderRequestedAction>('UNASSIGN_ME');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reasonCode) {
      setError('Please select a reason code.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.reportPartnerDeliveryFailure(order._id, {
        reasonCode,
        reasonNotes: reasonNotes.trim() || undefined,
        proofImageUrl: proofImageUrl.trim() || undefined,
        riderRequestedAction,
      });

      const message =
        riderRequestedAction === 'UNASSIGN_ME'
          ? `Delivery failure recorded for #${order.orderReference}. You have been unassigned and order is escalated to City Admin.`
          : `Delivery failure recorded for #${order.orderReference} (${REQUESTED_ACTION_LABELS[riderRequestedAction]}).`;

      onSuccess(message);
      onClose();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Failed to record delivery failure report.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '540px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
        }}
      >
        <div
          style={{
            padding: '1.25rem 1.5rem',
            background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)',
            borderBottom: '1px solid #fecaca',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: '#991b1b',
              }}
            >
              Order #{order.orderReference} · Delivery Exception
            </span>
            <h2 style={{ margin: '0.2rem 0 0 0', fontSize: '1.25rem', color: '#7f1d1d' }}>
              Report Delivery Failure
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '1.5rem',
              color: '#991b1b',
              cursor: 'pointer',
              lineHeight: 1,
              padding: '0.25rem',
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '1.5rem', overflowY: 'auto' }}>
          {error && (
            <div
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                background: '#fef2f2',
                color: '#991b1b',
                border: '1px solid #fecaca',
                fontSize: '0.88rem',
                marginBottom: '1rem',
              }}
            >
              {error}
            </div>
          )}

          <div style={{ marginBottom: '1.15rem' }}>
            <label
              style={{
                display: 'block',
                fontWeight: 600,
                fontSize: '0.88rem',
                color: '#1e293b',
                marginBottom: '0.4rem',
              }}
            >
              Reason Code <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <select
              required
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value as DeliveryExceptionReasonCode)}
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.92rem',
                background: '#f8fafc',
              }}
            >
              {(Object.keys(REASON_CODE_LABELS) as DeliveryExceptionReasonCode[]).map((code) => (
                <option key={code} value={code}>
                  {REASON_CODE_LABELS[code]}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: '1.15rem' }}>
            <label
              style={{
                display: 'block',
                fontWeight: 600,
                fontSize: '0.88rem',
                color: '#1e293b',
                marginBottom: '0.4rem',
              }}
            >
              Requested Action from Rider <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <select
              required
              value={riderRequestedAction}
              onChange={(e) => setRiderRequestedAction(e.target.value as RiderRequestedAction)}
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.92rem',
                background: '#f8fafc',
              }}
            >
              <option value="UNASSIGN_ME">
                Unassign Me & Escalate to City Admin (Rider released to AVAILABLE)
              </option>
              <option value="RETRY_LATER">
                I Will Retry Delivery Later (Keep order assigned to me)
              </option>
              <option value="CANCEL_ORDER">
                Customer Requested Cancellation (Return package to Seller)
              </option>
            </select>
            <small style={{ display: 'block', marginTop: '0.35rem', color: '#64748b', fontSize: '0.8rem' }}>
              Selecting &quot;Unassign Me&quot; will immediately free you up so you can take other deliveries while City Admin handles this issue.
            </small>
          </div>

          <div style={{ marginBottom: '1.15rem' }}>
            <label
              style={{
                display: 'block',
                fontWeight: 600,
                fontSize: '0.88rem',
                color: '#1e293b',
                marginBottom: '0.4rem',
              }}
            >
              Incident Details / Rider Notes
            </label>
            <textarea
              rows={3}
              value={reasonNotes}
              onChange={(e) => setReasonNotes(e.target.value)}
              placeholder="Explain the situation (e.g. called customer 3 times, door locked, incorrect street name, vehicle tyre punctured)..."
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label
              style={{
                display: 'block',
                fontWeight: 600,
                fontSize: '0.88rem',
                color: '#1e293b',
                marginBottom: '0.4rem',
              }}
            >
              Proof Image URL (Optional)
            </label>
            <input
              type="url"
              value={proofImageUrl}
              onChange={(e) => setProofImageUrl(e.target.value)}
              placeholder="https://... photo of locked gate, closed premise, or punctured vehicle"
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: '0.65rem 1.25rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#f1f5f9',
                color: '#475569',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: '0.65rem 1.35rem',
                borderRadius: '8px',
                border: 'none',
                background: '#dc2626',
                color: '#ffffff',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(220, 38, 38, 0.25)',
              }}
            >
              {submitting ? 'Submitting Report…' : 'Submit Delivery Failure'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* ============================================================================
 * 2. CITY ADMIN FAILED-DELIVERY ESCALATION QUEUE PANEL (FOR ORDERS PAGE)
 * ============================================================================ */

interface EscalationQueueProps {
  orders: CityAdminOrder[];
  onRefresh?: () => void;
}

export const CityAdminDeliveryEscalationQueue: React.FC<EscalationQueueProps> = ({ orders }) => {
  const escalatedOrders = orders.filter(
    (o) =>
      o.deliveryStatus === 'DELIVERY_FAILED' ||
      o.deliveryStatus === 'ESCALATED_TO_ADMIN' ||
      o.fulfilmentStatus === 'delivery_failed'
  );

  if (escalatedOrders.length === 0) {
    return (
      <section
        style={{
          background: '#f0fdf4',
          border: '2px solid #86efac',
          borderRadius: '14px',
          padding: '1.25rem 1.5rem',
          marginBottom: '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                backgroundColor: '#16a34a',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '0.85rem',
              }}
            >
              ✓
            </span>
            <strong style={{ color: '#14532d', fontSize: '1rem' }}>
              Road Delivery Fleet Clear · Zero Unresolved Road Exceptions
            </strong>
            <span
              style={{
                background: '#dcfce7',
                color: '#166534',
                border: '1px solid #86efac',
                padding: '2px 8px',
                borderRadius: 999,
                fontSize: '11px',
                fontWeight: 800,
              }}
            >
              2-Fail Auto-RTO Shield Active
            </span>
          </div>
          <p style={{ margin: '6px 0 0', color: '#166534', fontSize: '0.84rem', lineHeight: 1.4 }}>
            All assigned deliveries are proceeding normally. If a customer is unreachable for &ge; 2 delivery attempts, the autonomous 2-Fail Auto-RTO engine triggers automatic return to seller without manual mediation.
          </p>
        </div>
        <span style={{ fontSize: '26px' }}>🛵</span>
      </section>
    );
  }

  return (
    <section
      style={{
        background: '#fff1f2',
        border: '1px solid #fecdd3',
        borderRadius: '14px',
        padding: '1.25rem',
        marginBottom: '1.5rem',
        boxShadow: '0 4px 6px -1px rgba(225, 29, 72, 0.05)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1rem',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: '#e11d48',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '1rem',
            }}
          >
            !
          </span>
          <div>
            <h3 style={{ margin: 0, color: '#9f1239', fontSize: '1.05rem', fontWeight: 700 }}>
              Failed-Delivery Escalation Queue ({escalatedOrders.length})
            </h3>
            <p style={{ margin: 0, color: '#be123c', fontSize: '0.82rem' }}>
              These orders experienced delivery failure or rider unassignment and require City Admin review or manual reassignment.
            </p>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '1rem',
        }}
      >
        {escalatedOrders.map((order) => {
          const lastException: DeliveryException | undefined =
            order.deliveryExceptions && order.deliveryExceptions.length > 0
              ? order.deliveryExceptions[order.deliveryExceptions.length - 1]
              : undefined;

          return (
            <div
              key={order._id}
              style={{
                background: '#ffffff',
                border: '1px solid #fda4af',
                borderRadius: '10px',
                padding: '1rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '0.5rem',
                  }}
                >
                  <Link
                    to={`/city-admin/orders/${order._id}`}
                    style={{ fontWeight: 700, fontSize: '0.98rem', color: '#be123c', textDecoration: 'none' }}
                  >
                    #{order.orderReference}
                  </Link>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px',
                      background: '#ffe4e6',
                      color: '#9f1239',
                      border: '1px solid #fecdd3',
                    }}
                  >
                    {order.deliveryStatus || 'DELIVERY_FAILED'}
                  </span>
                </div>

                <div style={{ fontSize: '0.85rem', color: '#334155', marginBottom: '0.5rem' }}>
                  <strong>Customer:</strong> {order.customerName} {order.customerPhoneE164 ? `(${order.customerPhoneE164})` : ''}
                  <br />
                  <strong>Locality:</strong> {order.address?.locality || 'Not specified'}
                </div>

                {lastException && (
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '6px',
                      padding: '0.6rem 0.75rem',
                      fontSize: '0.82rem',
                      marginBottom: '0.75rem',
                    }}
                  >
                    <div style={{ fontWeight: 600, color: '#dc2626' }}>
                      Reason: {REASON_CODE_LABELS[lastException.reasonCode] || lastException.reasonCode}
                    </div>
                    <div style={{ color: '#475569', marginTop: '0.2rem' }}>
                      <strong>Action requested:</strong> {REQUESTED_ACTION_LABELS[lastException.riderRequestedAction] || lastException.riderRequestedAction}
                    </div>
                    {lastException.reasonNotes && (
                      <div style={{ color: '#64748b', marginTop: '0.2rem', fontStyle: 'italic' }}>
                        &quot;{lastException.reasonNotes}&quot;
                      </div>
                    )}
                    {lastException.proofImageUrl && (
                      <div style={{ marginTop: '0.35rem' }}>
                        <a
                          href={lastException.proofImageUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: '#2563eb', textDecoration: 'underline' }}
                        >
                          View Rider Proof Photo ↗
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #f1f5f9' }}>
                <Link
                  to={`/city-admin/orders/${order._id}`}
                  style={{
                    display: 'block',
                    textAlign: 'center',
                    background: '#be123c',
                    color: '#ffffff',
                    fontWeight: 600,
                    fontSize: '0.84rem',
                    padding: '0.45rem 0.75rem',
                    borderRadius: '6px',
                    textDecoration: 'none',
                  }}
                >
                  Review & Reassign Rider →
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

/* ============================================================================
 * 3. CITY ADMIN DELIVERY RESOLUTION & REASSIGNMENT PANEL (FOR ORDER DETAIL PAGE)
 * ============================================================================ */

interface DeliveryResolutionPanelProps {
  order: Order | CityAdminOrder;
  partners: CityAdminDeliveryPartner[];
  onResolved: () => void;
}

export const CityAdminDeliveryResolutionPanel: React.FC<DeliveryResolutionPanelProps> = ({
  order,
  partners,
  onResolved,
}) => {
  const isFailedOrEscalated =
    order.deliveryStatus === 'DELIVERY_FAILED' ||
    order.deliveryStatus === 'ESCALATED_TO_ADMIN' ||
    order.fulfilmentStatus === 'delivery_failed';

  const hasExceptions = Boolean(order.deliveryExceptions && order.deliveryExceptions.length > 0);

  const [action, setAction] = useState<AdminResolutionAction>('REASSIGN_NEW_RIDER');
  const [newRiderId, setNewRiderId] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const eligiblePartners = partners.filter(
    (p) => p.status === 'active' && p.isOnline !== false && p.availabilityStatus === 'available'
  );

  const handleResolve = async (event: React.FormEvent) => {
    event.preventDefault();
    if (action === 'REASSIGN_NEW_RIDER' && !newRiderId) {
      setError('Please select a new delivery partner to reassign.');
      return;
    }
    const confirmMessage = `Confirm resolution action: ${RESOLUTION_ACTION_LABELS[action]} for order #${order.orderReference}?`;
    if (!window.confirm(confirmMessage)) return;

    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      await api.resolveCityAdminDeliveryFailure(order._id, {
        action,
        newRiderId: action === 'REASSIGN_NEW_RIDER' ? newRiderId : undefined,
        partnerId: action === 'REASSIGN_NEW_RIDER' ? newRiderId : undefined,
        adminNotes: adminNotes.trim() || undefined,
      });
      setMessage(`Delivery escalation resolved successfully: ${RESOLUTION_ACTION_LABELS[action]}.`);
      onResolved();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Failed to apply delivery resolution.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isFailedOrEscalated && !hasExceptions && !order.adminResolution) {
    return null;
  }

  return (
    <section
      style={{
        background: '#ffffff',
        border: '1px solid #f43f5e',
        borderRadius: '16px',
        overflow: 'hidden',
        marginBottom: '1.5rem',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
      }}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)',
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid #fecdd3',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <div>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: '#e11d48',
            }}
          >
            Delivery Failure Management
          </span>
          <h2 style={{ margin: '0.2rem 0 0 0', fontSize: '1.25rem', color: '#9f1239' }}>
            Delivery Failure Escalation & Reassignment Review
          </h2>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span
            style={{
              fontSize: '0.8rem',
              fontWeight: 700,
              padding: '0.3rem 0.65rem',
              borderRadius: '6px',
              background: '#f43f5e',
              color: '#ffffff',
            }}
          >
            {order.deliveryStatus || 'DELIVERY_FAILED'}
          </span>
        </div>
      </div>

      <div style={{ padding: '1.5rem' }}>
        {error && (
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              background: '#fef2f2',
              color: '#991b1b',
              border: '1px solid #fecaca',
              marginBottom: '1rem',
              fontSize: '0.88rem',
            }}
          >
            {error}
          </div>
        )}
        {message && (
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              background: '#f0fdf4',
              color: '#166534',
              border: '1px solid #bbf7d0',
              marginBottom: '1rem',
              fontSize: '0.88rem',
            }}
          >
            {message}
          </div>
        )}

        {/* Delivery Exceptions Timeline */}
        {hasExceptions && (
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', color: '#1e293b', marginBottom: '0.75rem' }}>
              Recorded Delivery Exceptions ({order.deliveryExceptions?.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {order.deliveryExceptions?.map((exception, idx) => (
                <div
                  key={idx}
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '0.85rem 1rem',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '0.35rem',
                      flexWrap: 'wrap',
                      gap: '0.5rem',
                    }}
                  >
                    <span style={{ fontWeight: 700, color: '#e11d48', fontSize: '0.9rem' }}>
                      {REASON_CODE_LABELS[exception.reasonCode] || exception.reasonCode}
                    </span>
                    <small style={{ color: '#64748b' }}>
                      {new Date(exception.attemptedAt).toLocaleString('en-IN')}
                    </small>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#334155' }}>
                    <strong>Rider Requested Action:</strong>{' '}
                    <span style={{ color: '#be123c', fontWeight: 600 }}>
                      {REQUESTED_ACTION_LABELS[exception.riderRequestedAction] || exception.riderRequestedAction}
                    </span>
                  </div>
                  {exception.reasonNotes && (
                    <div style={{ fontSize: '0.85rem', color: '#475569', marginTop: '0.3rem', fontStyle: 'italic' }}>
                      &quot;{exception.reasonNotes}&quot;
                    </div>
                  )}
                  {exception.proofImageUrl && (
                    <div style={{ marginTop: '0.4rem' }}>
                      <a
                        href={exception.proofImageUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#2563eb', fontSize: '0.85rem', textDecoration: 'underline' }}
                      >
                        View Proof Image ↗
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Prior Admin Resolution */}
        {order.adminResolution && (
          <div
            style={{
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '10px',
              padding: '1rem',
              marginBottom: '1.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#166534', fontWeight: 700 }}>
              <span>✓ Resolved by City Admin</span>
              <small style={{ color: '#15803d', fontWeight: 500 }}>
                ({new Date(order.adminResolution.resolvedAt).toLocaleString('en-IN')})
              </small>
            </div>
            <div style={{ marginTop: '0.4rem', fontSize: '0.9rem', color: '#14532d' }}>
              <strong>Action Applied:</strong> {RESOLUTION_ACTION_LABELS[order.adminResolution.action] || order.adminResolution.action}
            </div>
            {order.adminResolution.adminNotes && (
              <div style={{ marginTop: '0.3rem', fontSize: '0.85rem', color: '#166534' }}>
                <strong>Admin Notes:</strong> {order.adminResolution.adminNotes}
              </div>
            )}
          </div>
        )}

        {/* Resolution Action Form for City Admin */}
        {isFailedOrEscalated && (
          <form
            onSubmit={handleResolve}
            style={{
              background: '#fdf2f8',
              border: '1px solid #fbcfe8',
              borderRadius: '12px',
              padding: '1.25rem',
            }}
          >
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: '#831843' }}>
              Apply City Admin Resolution
            </h3>

            <div style={{ marginBottom: '1rem' }}>
              <label
                style={{
                  display: 'block',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  color: '#4c0519',
                  marginBottom: '0.35rem',
                }}
              >
                Resolution Action <span style={{ color: '#e11d48' }}>*</span>
              </label>
              <select
                required
                value={action}
                onChange={(e) => setAction(e.target.value as AdminResolutionAction)}
                style={{
                  width: '100%',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.92rem',
                  background: '#ffffff',
                }}
              >
                <option value="REASSIGN_NEW_RIDER">
                  1. Reassign to New Delivery Partner (Proximity & Availability)
                </option>
                <option value="REASSIGN_SAME_RIDER">
                  2. Instruct Same Partner to Retry Delivery (Out for Delivery)
                </option>
                <option value="RESCHEDULE_LATER">
                  3. Reschedule Delivery for Later (Reset to Ready for Pickup)
                </option>
                <option value="TRIGGER_RTO">
                  4. Trigger Return To Origin (RTO back to Seller)
                </option>
              </select>
            </div>

            {action === 'REASSIGN_NEW_RIDER' && (
              <div style={{ marginBottom: '1rem' }}>
                <label
                  style={{
                    display: 'block',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    color: '#4c0519',
                    marginBottom: '0.35rem',
                  }}
                >
                  Select New Delivery Partner (ONLINE & AVAILABLE) <span style={{ color: '#e11d48' }}>*</span>
                </label>
                {eligiblePartners.length > 0 ? (
                  <select
                    required
                    value={newRiderId}
                    onChange={(e) => setNewRiderId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.92rem',
                      background: '#ffffff',
                    }}
                  >
                    <option value="">Choose an available rider...</option>
                    {eligiblePartners.map((partner, index) => (
                      <option key={partner._id} value={partner._id}>
                        {index === 0 ? '★ Nearest: ' : ''}
                        {partner.name || 'Delivery Partner'} · {partner.phoneE164}
                        {partner.distanceKm !== undefined && partner.distanceKm !== null
                          ? ` (${partner.distanceKm} km from Seller)`
                          : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div
                    style={{
                      padding: '0.75rem',
                      borderRadius: '8px',
                      background: '#fff7ed',
                      border: '1px solid #fed7aa',
                      color: '#9a3412',
                      fontSize: '0.85rem',
                    }}
                  >
                    No other ONLINE & AVAILABLE delivery partner is active in this city right now. You may select &quot;Instruct Same Partner to Retry&quot; or &quot;Reschedule for Later&quot;.
                  </div>
                )}
              </div>
            )}

            <div style={{ marginBottom: '1.25rem' }}>
              <label
                style={{
                  display: 'block',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  color: '#4c0519',
                  marginBottom: '0.35rem',
                }}
              >
                Resolution Notes / Instructions (Optional)
              </label>
              <textarea
                rows={2}
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="Notes for rider or audit log (e.g. verified new customer phone, agreed to delivery at 6 PM)..."
                style={{
                  width: '100%',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.88rem',
                  background: '#ffffff',
                  resize: 'vertical',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={submitting || (action === 'REASSIGN_NEW_RIDER' && !newRiderId)}
              style={{
                background: '#be123c',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '0.65rem 1.5rem',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(190, 18, 60, 0.25)',
              }}
            >
              {submitting ? 'Applying Resolution…' : 'Apply Resolution Action'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
};
