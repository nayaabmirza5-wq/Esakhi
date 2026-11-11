import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { api } from '../../api';
import type { Order, User, PartnerProfile } from '../../types';
import { SwipeToConfirmSlider } from './SwipeToConfirmSlider';
import { DynamicUpiQrModal } from './DynamicUpiQrModal';
import { HubRemittanceModal } from './HubRemittanceModal';
import { DeliveryFailureReportModal } from '../../DeliveryEscalationSystem';
import { DeliveryPartnerPaySlipPanel } from '../../ReturnDisputeSystem';

interface DeliveryPartnerCockpitProps {
  user: User;
  onSignOut: () => void | Promise<void>;
}

export const DeliveryPartnerCockpit: React.FC<DeliveryPartnerCockpitProps> = ({
  user,
  onSignOut,
}) => {
  const [activeTab, setActiveTab] = useState<'focus' | 'all' | 'history' | 'payslip'>('focus');
  const [orders, setOrders] = useState<Order[]>([]);
  const [historyOrders, setHistoryOrders] = useState<Order[]>([]);
  const [profile, setProfile] = useState<PartnerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [updatingDuty, setUpdatingDuty] = useState(false);

  // Active delivery state & modals
  const [deliveryOtpInput, setDeliveryOtpInput] = useState('');
  const [selectedPaymentMode, setSelectedPaymentMode] = useState<'cash' | 'upi_qr'>('cash');
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const [showUpiModal, setShowUpiModal] = useState(false);
  const [reportingIssueOrder, setReportingIssueOrder] = useState<Order | null>(null);
  const [showRemittanceModal, setShowRemittanceModal] = useState(false);

  // GPS Telemetry stream
  const [gpsStreamState, setGpsStreamState] = useState<'GPS_STREAM_ACTIVE' | 'GPS_STREAM_INACTIVE'>('GPS_STREAM_INACTIVE');
  const watchIdRef = useRef<number | null>(null);
  const isExecutingTransitionRef = useRef(false);

  // Load partner data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [assigned, history, prof] = await Promise.all([
        api.partnerOrders(),
        api.partnerOrderHistory(),
        api.partnerProfile(),
      ]);
      setOrders(assigned);
      setHistoryOrders(history);
      setProfile(prof);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load delivery assignments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Current primary active delivery
  const activeDelivery = useMemo(() => {
    return (
      orders.find((o) =>
        [
          'delivery_partner_assigned',
          'out_for_pickup',
          'picked_up',
          'out_for_delivery',
          'return_partner_assigned',
          'return_picked_up',
        ].includes(o.fulfilmentStatus),
      ) ?? orders[0]
    );
  }, [orders]);

  // GPS Battery-Optimized Broadcast
  useEffect(() => {
    const activeId = activeDelivery?._id;
    const status = activeDelivery?.fulfilmentStatus;
    const isTransitActive = Boolean(
      activeId &&
        [
          'delivery_partner_assigned',
          'out_for_pickup',
          'picked_up',
          'out_for_delivery',
          'return_partner_assigned',
          'return_picked_up',
        ].includes(status || ''),
    );

    if (!isTransitActive || !activeId) {
      setGpsStreamState('GPS_STREAM_INACTIVE');
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    setGpsStreamState('GPS_STREAM_ACTIVE');
    let cancelled = false;
    let lastPingTime = 0;

    const throttledPing = async (lat: number, lng: number) => {
      const now = Date.now();
      if (cancelled || now - lastPingTime < 10000) return; // Adaptive 10s battery throttle
      lastPingTime = now;
      try {
        await api.broadcastPartnerOrderLocation(activeId, lat, lng);
      } catch {
        // Ignore transient mobile network drops
      }
    };

    if (navigator.geolocation) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => void throttledPing(pos.coords.latitude, pos.coords.longitude),
        () => {
          // Fallback coordinate ping
          void throttledPing(23.8415, 79.445);
        },
        { enableHighAccuracy: false, maximumAge: 10000, timeout: 8000 },
      );
    }

    return () => {
      cancelled = true;
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [activeDelivery?._id, activeDelivery?.fulfilmentStatus]);

  // Shift & Cash Ledger Totals
  const shiftMetrics = useMemo(() => {
    const todayStr = new Date().toDateString();
    const completedToday = historyOrders.filter((o) => {
      const deliveredTime = [...(o.statusHistory ?? [])].reverse().find((h) => ['delivered', 'completed'].includes(h.status))?.changedAt;
      return deliveredTime ? new Date(deliveredTime).toDateString() === todayStr : false;
    });

    let cashInHandPaise = 0;
    let doorstepUpiPaise = 0;

    for (const o of completedToday) {
      if (o.doorstepPayment?.remittedToCityAdmin === true) {
        continue; // Already settled with City Admin!
      }
      if (o.paymentMethod === 'cash' || o.doorstepPayment?.mode === 'cash') {
        cashInHandPaise += o.totalPaise || 0;
      } else if (o.doorstepPayment?.mode === 'upi_qr') {
        doorstepUpiPaise += o.totalPaise || 0;
      }
    }

    return {
      completedCount: completedToday.length,
      cashInHandRupees: (cashInHandPaise / 100).toFixed(2),
      doorstepUpiRupees: (doorstepUpiPaise / 100).toFixed(2),
    };
  }, [historyOrders]);

  // Duty Toggle (Online / Offline)
  const toggleDuty = async (nextOnline: boolean) => {
    if (!nextOnline && parseFloat(shiftMetrics.cashInHandRupees) > 0) {
      setError(`🔒 Cannot Go Offline: You currently hold ₹${shiftMetrics.cashInHandRupees} in unremitted cash in hand. In accordance with municipal protocol, all cash must be deposited at the City Admin Hub (using your Handshake PIN) or remitted via UPI before ending your shift.`);
      setShowRemittanceModal(true);
      return;
    }
    setUpdatingDuty(true);
    setError('');
    setSuccessMsg('');
    try {
      await api.updatePartnerAvailability({
        isOnline: nextOnline,
        availabilityStatus: nextOnline ? 'available' : 'offline',
      });
      setSuccessMsg(nextOnline ? '🟢 You are now ONLINE & AVAILABLE for assignments.' : '🔴 You are now OFFLINE.');
      await loadData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change online status.');
    } finally {
      setUpdatingDuty(false);
    }
  };

  // Status transitions
  const executeStatusTransition = async (
    targetStatus:
      | 'out_for_pickup'
      | 'picked_up'
      | 'out_for_delivery'
      | 'delivered'
      | 'return_picked_up'
      | 'return_delivered_to_seller',
    extraParams?: {
      deliveryOtp?: string;
      paymentMode?: 'cash' | 'upi_qr' | 'prepaid_online';
      upiUtr?: string;
      note?: string;
    },
  ) => {
    if (!activeDelivery || isExecutingTransitionRef.current) return;
    isExecutingTransitionRef.current = true;
    setError('');
    setSuccessMsg('');
    try {
      await api.updatePartnerOrderStatus(
        activeDelivery._id,
        targetStatus,
        extraParams?.note,
        true,
        extraParams?.deliveryOtp,
        extraParams?.paymentMode,
        extraParams?.upiUtr,
      );

      setDeliveryOtpInput('');
      setCashConfirmed(false);

      if (targetStatus === 'delivered') {
        setSuccessMsg(`✓ Order #${activeDelivery.orderReference} DELIVERED & payment settled successfully!`);
      } else if (targetStatus === 'return_delivered_to_seller') {
        setSuccessMsg(`✓ Return #${activeDelivery.orderReference} delivered back to Artisan SHG! Queued for Super Admin refund.`);
      } else {
        setSuccessMsg(`✓ Order updated to ${targetStatus.replaceAll('_', ' ').toUpperCase()}`);
      }

      await loadData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to update order status.');
    } finally {
      isExecutingTransitionRef.current = false;
    }
  };

  const isOnline = profile?.isOnline ?? true;

  function activeOrdersCount(items: Order[]): number {
    return items.filter((o) =>
      [
        'delivery_partner_assigned',
        'out_for_pickup',
        'picked_up',
        'out_for_delivery',
        'return_partner_assigned',
        'return_picked_up',
      ].includes(o.fulfilmentStatus),
    ).length;
  }

  const isReverseOrder = activeDelivery?.fulfilmentStatus?.startsWith('return_');
  const isPrepaid = Boolean(activeDelivery?.paymentStatus === 'confirmed' && activeDelivery?.paymentMethod !== 'cash');
  const amountToCollect = isPrepaid ? 0 : ((activeDelivery?.totalPaise || 0) / 100);

  // Active step calculation
  const isPickupStage = activeDelivery && ['delivery_partner_assigned', 'out_for_pickup'].includes(activeDelivery.fulfilmentStatus);
  const isDropStage = activeDelivery && ['picked_up', 'out_for_delivery'].includes(activeDelivery.fulfilmentStatus);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', color: '#0f172a', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Top Mobile Bar - Sleek Glassmorphism Gradient */}
      <header
        style={{
          background: 'linear-gradient(135deg, #3d0c45 0%, #4A0E4E 55%, #831843 100%)',
          color: '#ffffff',
          padding: '0.85rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: '0 4px 20px rgba(107, 33, 92, 0.35)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '20px',
              backgroundColor: 'rgba(255, 255, 255, 0.18)',
              border: '1.5px solid rgba(255, 255, 255, 0.35)',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 800,
              fontSize: '1.15rem',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
            }}
          >
            🛵
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '0.96rem', letterSpacing: '-0.01em', color: '#ffffff' }}>
                {profile?.name || user.name || 'Delivery Partner'}
              </strong>
              <span style={{ fontSize: '0.74rem', color: '#fbcfe8', fontWeight: 600 }}>
                ({user.phone || user.phoneE164 || profile?.phoneE164})
              </span>
              <span style={{ fontSize: '0.68rem', backgroundColor: '#dcfce7', color: '#15803d', fontWeight: 800, padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                ✓ Fleet
              </span>
            </div>
            <small style={{ fontSize: '0.74rem', color: '#fbcfe8', fontWeight: 600 }}>
              {profile?.assignedCity || 'Damoh'} Operations Hub
            </small>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {/* Duty Switch Button with Beacon */}
          <button
            type="button"
            disabled={updatingDuty}
            onClick={() => void toggleDuty(!isOnline)}
            style={{
              padding: '0.4rem 0.85rem',
              borderRadius: '999px',
              border: 'none',
              backgroundColor: isOnline ? '#16a34a' : '#475569',
              color: '#ffffff',
              fontSize: '0.76rem',
              fontWeight: 800,
              cursor: updatingDuty ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              boxShadow: isOnline ? '0 0 12px rgba(22, 163, 74, 0.5)' : 'none',
              transition: 'all 0.25s ease',
            }}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: isOnline ? '#bbf7d0' : '#cbd5e1',
                boxShadow: isOnline ? '0 0 6px #86efac' : 'none',
                display: 'inline-block',
              }}
            />
            {isOnline ? 'ONLINE' : 'OFFLINE'}
          </button>

          <button
            type="button"
            onClick={() => void onSignOut()}
            style={{
              background: 'rgba(255, 255, 255, 0.12)',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              color: '#ffffff',
              borderRadius: '8px',
              padding: '0.38rem 0.65rem',
              fontSize: '0.74rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
            title="Sign out"
          >
            Exit
          </button>
        </div>
      </header>

      {loading && (
        <div style={{ textAlign: 'center', padding: '0.85rem', color: '#4A0E4E', fontWeight: 800, fontSize: '0.86rem', background: '#fdf2f8' }}>
          ⚡ Syncing live Damoh dispatch & GPS telemetry…
        </div>
      )}

      {/* Main Container */}
      <main style={{ maxWidth: '640px', margin: '0 auto', padding: '1rem 1rem 5rem' }}>
        {/* Alerts Banner */}
        {error && (
          <div style={{ padding: '0.85rem 1rem', background: '#fee2e2', border: '1px solid #f87171', borderRadius: '12px', color: '#991b1b', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>⚠️</span>
            <div>{error}</div>
          </div>
        )}
        {successMsg && (
          <div style={{ padding: '0.85rem 1rem', background: '#dcfce7', border: '1px solid #86efac', borderRadius: '12px', color: '#166534', fontSize: '0.85rem', marginBottom: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>✓</span>
            <div>{successMsg}</div>
          </div>
        )}

        {/* Floating COD Guardrail Warning Banner (> ₹2,000) */}
        {parseFloat(shiftMetrics.cashInHandRupees) > 2000 && (
          <div
            style={{
              background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)',
              border: '2px solid #ef4444',
              borderRadius: '16px',
              padding: '1.15rem',
              marginBottom: '1.25rem',
              boxShadow: '0 8px 20px rgba(239, 68, 68, 0.18)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#991b1b', fontWeight: 900 }}>
              <span style={{ fontSize: '1.4rem' }}>🚨</span>
              <span style={{ fontSize: '1rem', letterSpacing: '0.01em' }}>
                COD LIMIT EXCEEDED (&gt; ₹2,000): ₹{shiftMetrics.cashInHandRupees} DUE
              </span>
            </div>
            <p style={{ margin: '0.45rem 0 0.85rem', fontSize: '0.82rem', color: '#7f1d1d', lineHeight: 1.5 }}>
              Safety Protocol: Unremitted cash has reached <strong>₹{shiftMetrics.cashInHandRupees}</strong>. New COD dispatches are paused until remitted. Deposit banknotes at the Damoh Hub desk (using your 60-second Auto-Rotating PIN) or remit online via instant UPI.
            </p>
            <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setShowRemittanceModal(true)}
                style={{
                  background: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.6rem 1.15rem',
                  borderRadius: '10px',
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  boxShadow: '0 3px 8px rgba(220, 38, 38, 0.35)',
                }}
              >
                🏢 Deposit at Damoh Hub Desk
              </button>
              <button
                type="button"
                onClick={() => setShowRemittanceModal(true)}
                style={{
                  background: '#ffffff',
                  color: '#dc2626',
                  border: '1.5px solid #f87171',
                  padding: '0.6rem 1.15rem',
                  borderRadius: '10px',
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                📲 Remit via Instant UPI
              </button>
            </div>
          </div>
        )}

        {/* Shift Metrics Strip - 3 Elevated Cards */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '0.65rem',
            marginBottom: '1rem',
          }}
        >
          {/* Card 1: Completed Orders */}
          <div
            style={{
              background: '#ffffff',
              padding: '0.85rem 0.6rem',
              borderRadius: '16px',
              border: '1px solid #e2e8f0',
              textAlign: 'center',
              boxShadow: '0 2px 6px rgba(0, 0, 0, 0.03)',
            }}
          >
            <span style={{ fontSize: '1.1rem', display: 'block', marginBottom: '0.2rem' }}>📦</span>
            <small style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 800, display: 'block', textTransform: 'uppercase' }}>
              Completed Today
            </small>
            <strong style={{ fontSize: '1.45rem', color: '#0f172a', fontWeight: 900 }}>
              {shiftMetrics.completedCount}
            </strong>
          </div>

          {/* Card 2: Cash in Hand (Interactive Remit Trigger) */}
          <div
            onClick={() => setShowRemittanceModal(true)}
            style={{
              background: parseFloat(shiftMetrics.cashInHandRupees) > 2000 ? '#fef2f2' : '#ffffff',
              padding: '0.85rem 0.6rem',
              borderRadius: '16px',
              border: parseFloat(shiftMetrics.cashInHandRupees) > 2000 ? '2px solid #ef4444' : '1px solid #e2e8f0',
              textAlign: 'center',
              cursor: 'pointer',
              boxShadow: parseFloat(shiftMetrics.cashInHandRupees) > 2000 ? '0 4px 14px rgba(239, 68, 68, 0.25)' : '0 2px 6px rgba(0, 0, 0, 0.03)',
              transition: 'transform 0.15s ease',
            }}
          >
            <span style={{ fontSize: '1.1rem', display: 'block', marginBottom: '0.2rem' }}>💵</span>
            <small style={{ fontSize: '0.68rem', color: parseFloat(shiftMetrics.cashInHandRupees) > 2000 ? '#dc2626' : '#15803d', fontWeight: 800, display: 'block', textTransform: 'uppercase' }}>
              Cash in Hand ⇗
            </small>
            <strong style={{ fontSize: '1.35rem', color: parseFloat(shiftMetrics.cashInHandRupees) > 2000 ? '#dc2626' : '#16a34a', fontWeight: 900 }}>
              ₹{shiftMetrics.cashInHandRupees}
            </strong>
            <span
              style={{
                display: 'inline-block',
                marginTop: '0.2rem',
                fontSize: '0.64rem',
                color: parseFloat(shiftMetrics.cashInHandRupees) > 2000 ? '#ffffff' : '#2563eb',
                backgroundColor: parseFloat(shiftMetrics.cashInHandRupees) > 2000 ? '#dc2626' : '#eff6ff',
                padding: '0.15rem 0.45rem',
                borderRadius: '999px',
                fontWeight: 800,
              }}
            >
              {parseFloat(shiftMetrics.cashInHandRupees) > 0 ? 'Clear at Hub ⇗' : 'All Clear ✓'}
            </span>
          </div>

          {/* Card 3: Doorstep UPI */}
          <div
            style={{
              background: '#ffffff',
              padding: '0.85rem 0.6rem',
              borderRadius: '16px',
              border: '1px solid #e2e8f0',
              textAlign: 'center',
              boxShadow: '0 2px 6px rgba(0, 0, 0, 0.03)',
            }}
          >
            <span style={{ fontSize: '1.1rem', display: 'block', marginBottom: '0.2rem' }}>📲</span>
            <small style={{ fontSize: '0.68rem', color: '#4A0E4E', fontWeight: 800, display: 'block', textTransform: 'uppercase' }}>
              Doorstep UPI
            </small>
            <strong style={{ fontSize: '1.35rem', color: '#4A0E4E', fontWeight: 900 }}>
              ₹{shiftMetrics.doorstepUpiRupees}
            </strong>
            <small style={{ display: 'block', fontSize: '0.62rem', color: '#16a34a', fontWeight: 700, marginTop: '0.15rem' }}>
              Zero cash risk ✓
            </small>
          </div>
        </section>

        {/* GPS Stream Status Indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: gpsStreamState === 'GPS_STREAM_ACTIVE' ? '#eff6ff' : '#f8fafc',
            border: `1px solid ${gpsStreamState === 'GPS_STREAM_ACTIVE' ? '#bfdbfe' : '#e2e8f0'}`,
            borderRadius: '12px',
            padding: '0.55rem 0.95rem',
            marginBottom: '1rem',
            fontSize: '0.78rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: gpsStreamState === 'GPS_STREAM_ACTIVE' ? '#2563eb' : '#94a3b8',
                display: 'inline-block',
                boxShadow: gpsStreamState === 'GPS_STREAM_ACTIVE' ? '0 0 8px #3b82f6' : 'none',
              }}
            />
            <span style={{ fontWeight: 700, color: gpsStreamState === 'GPS_STREAM_ACTIVE' ? '#1e40af' : '#475569' }}>
              {gpsStreamState === 'GPS_STREAM_ACTIVE'
                ? 'Damoh Dispatch Telemetry Active (10s Adaptive Stream)'
                : 'GPS Broadcast Standby (Inactive Transit)'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void loadData()}
            style={{
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              padding: '0.2rem 0.55rem',
              borderRadius: '6px',
              color: '#2563eb',
              fontWeight: 800,
              cursor: 'pointer',
              fontSize: '0.72rem',
            }}
          >
            Sync ⟳
          </button>
        </div>

        {/* Tab Switcher - Segmented Pill Control */}
        <div
          style={{
            display: 'flex',
            gap: '0.4rem',
            backgroundColor: '#e2e8f0',
            padding: '5px',
            borderRadius: '14px',
            marginBottom: '1.25rem',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('focus')}
            style={{
              flex: 1,
              padding: '0.6rem 0.4rem',
              borderRadius: '10px',
              border: 'none',
              backgroundColor: activeTab === 'focus' ? '#ffffff' : 'transparent',
              fontWeight: activeTab === 'focus' ? 800 : 600,
              fontSize: '0.82rem',
              color: activeTab === 'focus' ? '#0f172a' : '#64748b',
              cursor: 'pointer',
              boxShadow: activeTab === 'focus' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.35rem',
            }}
          >
            <span>⚡</span>
            <span>Active Task</span>
            <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '999px', backgroundColor: activeTab === 'focus' ? '#4A0E4E' : '#cbd5e1', color: activeTab === 'focus' ? '#ffffff' : '#475569', fontWeight: 800 }}>
              {activeOrdersCount(orders)}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('all')}
            style={{
              flex: 1,
              padding: '0.6rem 0.4rem',
              borderRadius: '10px',
              border: 'none',
              backgroundColor: activeTab === 'all' ? '#ffffff' : 'transparent',
              fontWeight: activeTab === 'all' ? 800 : 600,
              fontSize: '0.82rem',
              color: activeTab === 'all' ? '#0f172a' : '#64748b',
              cursor: 'pointer',
              boxShadow: activeTab === 'all' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.35rem',
            }}
          >
            <span>📋</span>
            <span>All Orders</span>
            <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '999px', backgroundColor: activeTab === 'all' ? '#0f172a' : '#cbd5e1', color: activeTab === 'all' ? '#ffffff' : '#475569', fontWeight: 800 }}>
              {orders.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            style={{
              flex: 1,
              padding: '0.6rem 0.4rem',
              borderRadius: '10px',
              border: 'none',
              backgroundColor: activeTab === 'history' ? '#ffffff' : 'transparent',
              fontWeight: activeTab === 'history' ? 800 : 600,
              fontSize: '0.82rem',
              color: activeTab === 'history' ? '#0f172a' : '#64748b',
              cursor: 'pointer',
              boxShadow: activeTab === 'history' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.35rem',
            }}
          >
            <span>📜</span>
            <span>History</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('payslip')}
            style={{
              flex: 1,
              padding: '0.6rem 0.4rem',
              borderRadius: '10px',
              border: 'none',
              backgroundColor: activeTab === 'payslip' ? '#ffffff' : 'transparent',
              fontWeight: activeTab === 'payslip' ? 800 : 600,
              fontSize: '0.82rem',
              color: activeTab === 'payslip' ? '#0f172a' : '#64748b',
              cursor: 'pointer',
              boxShadow: activeTab === 'payslip' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.35rem',
            }}
          >
            <span>💰</span>
            <span>Pay Slip</span>
          </button>
        </div>

        {/* TAB 1: FOCUS MODE (ACTIVE DELIVERY) */}
        {activeTab === 'focus' && (
          <div>
            {!activeDelivery ? (
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: '20px',
                  padding: '3rem 1.5rem',
                  textAlign: 'center',
                  border: '2px dashed #cbd5e1',
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.04)',
                }}
              >
                <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>☕🛵</div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#0f172a', margin: '0.35rem 0' }}>
                  No Active Deliveries Right Now
                </h3>
                <p style={{ fontSize: '0.88rem', color: '#64748b', maxWidth: '420px', margin: '0.5rem auto 0.75rem', lineHeight: 1.5 }}>
                  You are currently <strong>{isOnline ? 'ONLINE & READY FOR DISPATCH' : 'OFFLINE'}</strong> in Damoh. When an artisan marks an order ready, it will instantly alert your phone.
                </p>
                <div style={{ display: 'inline-block', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.4rem 0.85rem', marginBottom: '1.25rem', fontSize: '0.8rem', color: '#334155' }}>
                  Signed in as: <strong>{user.name || 'Delivery Partner'}</strong> · <strong>{user.phone || user.phoneE164 || profile?.phoneE164}</strong>
                </div>
                {!isOnline && (
                  <button
                    type="button"
                    onClick={() => void toggleDuty(true)}
                    style={{
                      background: 'linear-gradient(135deg, #15803d 0%, #16a34a 100%)',
                      color: '#ffffff',
                      border: 'none',
                      padding: '0.85rem 1.75rem',
                      borderRadius: '12px',
                      fontWeight: 800,
                      fontSize: '0.92rem',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(22, 163, 74, 0.3)',
                    }}
                  >
                    Go Online & Available Now
                  </button>
                )}
              </div>
            ) : (
              <article
                style={{
                  background: '#ffffff',
                  borderRadius: '20px',
                  border: isReverseOrder ? '2px solid #ea580c' : '2px solid #4A0E4E',
                  padding: '1.25rem',
                  boxShadow: '0 8px 28px rgba(0, 0, 0, 0.08)',
                  position: 'relative',
                }}
              >
                {/* Header Tag & Order Reference */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
                  <span
                    style={{
                      backgroundColor: isReverseOrder ? '#ffedd5' : '#fdf2f8',
                      color: isReverseOrder ? '#c2410c' : '#4A0E4E',
                      border: `1px solid ${isReverseOrder ? '#fed7aa' : '#fbcfe8'}`,
                      padding: '0.25rem 0.65rem',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 800,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {isReverseOrder ? '🔄 REVERSE RETURN PICKUP' : '📦 FORWARD ORDER DELIVERY'}
                  </span>

                  <span style={{ fontSize: '0.88rem', fontWeight: 900, color: '#0f172a', fontFamily: 'monospace' }}>
                    #{activeDelivery.orderReference}
                  </span>
                </div>

                {/* 2-Step Stage Progress Indicator */}
                {!isReverseOrder && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '0.5rem',
                      marginBottom: '1rem',
                      background: '#f8fafc',
                      padding: '0.5rem',
                      borderRadius: '12px',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div
                      style={{
                        padding: '0.5rem',
                        borderRadius: '8px',
                        textAlign: 'center',
                        background: isPickupStage ? '#fdf2f8' : '#ffffff',
                        border: isPickupStage ? '1.5px solid #4A0E4E' : '1px solid #cbd5e1',
                        color: isPickupStage ? '#4A0E4E' : '#64748b',
                      }}
                    >
                      <span style={{ fontSize: '0.72rem', fontWeight: 800, display: 'block', textTransform: 'uppercase' }}>
                        1. Artisan Pickup
                      </span>
                      <small style={{ fontSize: '0.68rem', fontWeight: isPickupStage ? 800 : 600 }}>
                        {isPickupStage ? '● CURRENT STAGE' : '✓ Picked Up'}
                      </small>
                    </div>

                    <div
                      style={{
                        padding: '0.5rem',
                        borderRadius: '8px',
                        textAlign: 'center',
                        background: isDropStage ? '#f0fdf4' : '#ffffff',
                        border: isDropStage ? '1.5px solid #16a34a' : '1px solid #cbd5e1',
                        color: isDropStage ? '#15803d' : '#64748b',
                      }}
                    >
                      <span style={{ fontSize: '0.72rem', fontWeight: 800, display: 'block', textTransform: 'uppercase' }}>
                        2. Customer Drop
                      </span>
                      <small style={{ fontSize: '0.68rem', fontWeight: isDropStage ? 800 : 600 }}>
                        {isDropStage ? '● OUT FOR DELIVERY' : 'Pending Pickup'}
                      </small>
                    </div>
                  </div>
                )}

                {/* VISUAL PAYMENT BANNER HERO */}
                {!isReverseOrder && (
                  <div style={{ marginBottom: '1.25rem' }}>
                    {isPrepaid ? (
                      // BLUE PREPAID BANNER
                      <div
                        style={{
                          background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)',
                          color: '#ffffff',
                          padding: '1.1rem 1.25rem',
                          borderRadius: '14px',
                          boxShadow: '0 6px 18px rgba(37, 99, 235, 0.25)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
                          <span style={{ fontSize: '1.35rem' }}>💳</span>
                          <strong style={{ fontSize: '1.12rem', letterSpacing: '0.01em' }}>
                            PREPAID ONLINE · ZERO CASH DUE (₹0.00)
                          </strong>
                        </div>
                        <p style={{ margin: 0, fontSize: '0.84rem', color: '#dbeafe', lineHeight: 1.4 }}>
                          Customer already paid online. <strong>Do not collect any cash.</strong> Ask for customer's 4-digit Delivery OTP.
                        </p>
                      </div>
                    ) : (
                      // GREEN COD BANNER WITH CASH VS UPI TOGGLE
                      <div
                        style={{
                          background: 'linear-gradient(135deg, #065f46 0%, #059669 100%)',
                          color: '#ffffff',
                          padding: '1.15rem 1.25rem',
                          borderRadius: '14px',
                          boxShadow: '0 6px 18px rgba(5, 150, 105, 0.25)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '1.35rem' }}>💵</span>
                            <strong style={{ fontSize: '1.12rem' }}>CASH ON DELIVERY DUE</strong>
                          </div>
                          <span style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-0.02em' }}>
                            ₹{amountToCollect.toFixed(2)}
                          </span>
                        </div>

                        {/* Payment Method Selector at Doorstep */}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: '0.5rem',
                            marginTop: '0.65rem',
                            backgroundColor: 'rgba(0, 0, 0, 0.18)',
                            padding: '4px',
                            borderRadius: '10px',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedPaymentMode('cash')}
                            style={{
                              padding: '0.55rem',
                              border: 'none',
                              borderRadius: '8px',
                              backgroundColor: selectedPaymentMode === 'cash' ? '#ffffff' : 'transparent',
                              color: selectedPaymentMode === 'cash' ? '#065f46' : '#ffffff',
                              fontWeight: 800,
                              fontSize: '0.8rem',
                              cursor: 'pointer',
                              boxShadow: selectedPaymentMode === 'cash' ? '0 2px 6px rgba(0,0,0,0.1)' : 'none',
                            }}
                          >
                            💵 Collect Paper Cash
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPaymentMode('upi_qr');
                              setShowUpiModal(true);
                            }}
                            style={{
                              padding: '0.55rem',
                              border: 'none',
                              borderRadius: '8px',
                              backgroundColor: selectedPaymentMode === 'upi_qr' ? '#4A0E4E' : 'transparent',
                              color: '#ffffff',
                              fontWeight: 800,
                              fontSize: '0.8rem',
                              cursor: 'pointer',
                              boxShadow: selectedPaymentMode === 'upi_qr' ? '0 2px 6px rgba(0,0,0,0.2)' : 'none',
                            }}
                          >
                            📲 Scan Customer UPI QR
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* STAGE A: ROUTE TO ARTISAN SELLER (PICKUP) */}
                {isPickupStage && (
                  <section style={{ background: '#fdf2f8', padding: '1.15rem', borderRadius: '14px', border: '1.5px solid #fbcfe8', marginBottom: '1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <strong style={{ fontSize: '0.84rem', color: '#4A0E4E', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        📍 STEP 1 · PICK UP FROM ARTISAN
                      </strong>
                      <span style={{ fontSize: '0.76rem', background: '#ffffff', padding: '0.2rem 0.6rem', borderRadius: '999px', color: '#4A0E4E', fontWeight: 800, border: '1px solid #fbcfe8' }}>
                        {activeDelivery.deliveryPartner?.distanceKm ? `${activeDelivery.deliveryPartner.distanceKm} km away` : 'Damoh Fleet Hub'}
                      </span>
                    </div>

                    <h4 style={{ fontSize: '1.1rem', fontWeight: 900, color: '#0f172a', margin: '0.25rem 0' }}>
                      {activeDelivery.sellerPickup?.sellerName || 'Maitri SHG Damoh'}
                    </h4>
                    <p style={{ fontSize: '0.86rem', color: '#475569', margin: '0.2rem 0 0.85rem', lineHeight: 1.45 }}>
                      {activeDelivery.sellerPickup?.address}, {activeDelivery.sellerPickup?.city || 'Damoh'}
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '1.1rem' }}>
                      {activeDelivery.sellerPickup?.phoneE164 && (
                        <a
                          href={`tel:${activeDelivery.sellerPickup.phoneE164}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.4rem',
                            padding: '0.7rem',
                            background: '#ffffff',
                            border: '1.5px solid #cbd5e1',
                            borderRadius: '10px',
                            color: '#0f172a',
                            fontWeight: 800,
                            fontSize: '0.84rem',
                            textDecoration: 'none',
                          }}
                        >
                          📞 Call Artisan
                        </a>
                      )}
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${activeDelivery.sellerPickup?.latitude ?? 23.8388},${activeDelivery.sellerPickup?.longitude ?? 79.4422}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.4rem',
                          padding: '0.7rem',
                          background: '#4A0E4E',
                          color: '#ffffff',
                          borderRadius: '10px',
                          fontWeight: 800,
                          fontSize: '0.84rem',
                          textDecoration: 'none',
                          boxShadow: '0 2px 8px rgba(107, 33, 92, 0.25)',
                        }}
                      >
                        🧭 Open Maps ↗
                      </a>
                    </div>

                    {/* Swipe to Confirm Picked Up */}
                    <SwipeToConfirmSlider
                      label="Swipe: Confirmed Picked Up from Seller"
                      confirmLabel="Package Picked Up!"
                      themeColor="#4A0E4E"
                      onConfirm={() => executeStatusTransition('picked_up')}
                    />
                  </section>
                )}

                {/* STAGE B: ROUTE TO CUSTOMER (DELIVERY AT DOORSTEP) */}
                {isDropStage && (
                  <section style={{ background: '#f0fdf4', padding: '1.15rem', borderRadius: '14px', border: '1.5px solid #bbf7d0', marginBottom: '1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <strong style={{ fontSize: '0.84rem', color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        🏁 STEP 2 · DELIVER TO CUSTOMER
                      </strong>
                      <span style={{ fontSize: '0.76rem', background: '#ffffff', padding: '0.2rem 0.6rem', borderRadius: '999px', color: '#15803d', fontWeight: 800, border: '1px solid #bbf7d0' }}>
                        {activeDelivery.address?.locality || 'Damoh'}
                      </span>
                    </div>

                    <h4 style={{ fontSize: '1.1rem', fontWeight: 900, color: '#0f172a', margin: '0.25rem 0' }}>
                      {activeDelivery.address?.name || activeDelivery.customerName}
                    </h4>
                    <p style={{ fontSize: '0.86rem', color: '#475569', margin: '0.2rem 0 0.85rem', lineHeight: 1.45 }}>
                      {activeDelivery.address?.formattedAddress || [activeDelivery.address?.addressLine1, activeDelivery.address?.locality, activeDelivery.address?.city, activeDelivery.address?.postalCode].filter(Boolean).join(', ')}
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '1.1rem' }}>
                      {activeDelivery.address?.phoneE164 && (
                        <a
                          href={`tel:${activeDelivery.address.phoneE164}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.35rem',
                            padding: '0.65rem',
                            background: '#ffffff',
                            border: '1.5px solid #cbd5e1',
                            borderRadius: '10px',
                            color: '#0f172a',
                            fontWeight: 800,
                            fontSize: '0.8rem',
                            textDecoration: 'none',
                          }}
                        >
                          📞 Call
                        </a>
                      )}
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${activeDelivery.address?.latitude ?? 23.8342},${activeDelivery.address?.longitude ?? 79.4385}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.35rem',
                          padding: '0.65rem',
                          background: '#16a34a',
                          color: '#ffffff',
                          borderRadius: '10px',
                          fontWeight: 800,
                          fontSize: '0.8rem',
                          textDecoration: 'none',
                          boxShadow: '0 2px 8px rgba(22, 163, 74, 0.25)',
                        }}
                      >
                        🧭 Maps ↗
                      </a>
                      <button
                        type="button"
                        onClick={() => setReportingIssueOrder(activeDelivery)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.35rem',
                          padding: '0.65rem',
                          background: '#fee2e2',
                          color: '#b91c1c',
                          border: '1.5px solid #f87171',
                          borderRadius: '10px',
                          fontWeight: 800,
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                        }}
                      >
                        ⚠️ Issue
                      </button>
                    </div>

                    {/* PREPAID DELIVERY OTP BOX */}
                    {isPrepaid && (
                      <div
                        style={{
                          background: '#eff6ff',
                          border: '2px solid #bfdbfe',
                          padding: '1rem',
                          borderRadius: '14px',
                          marginBottom: '1rem',
                        }}
                      >
                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#1e40af', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                          Enter Customer's 4-Digit Delivery OTP:
                        </label>
                        <input
                          type="text"
                          maxLength={6}
                          placeholder="• • • •"
                          value={deliveryOtpInput}
                          onChange={(e) => setDeliveryOtpInput(e.target.value.replace(/\D/g, ''))}
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            borderRadius: '10px',
                            border: '2px solid #93c5fd',
                            fontSize: '1.4rem',
                            fontWeight: 900,
                            letterSpacing: '0.35em',
                            textAlign: 'center',
                            color: '#1e3a8a',
                            fontFamily: 'monospace',
                            boxSizing: 'border-box',
                          }}
                        />
                        <small style={{ display: 'block', fontSize: '0.74rem', color: '#64748b', marginTop: '0.35rem', textAlign: 'center' }}>
                          Customer receives this 4-digit code on their phone screen.
                        </small>
                      </div>
                    )}

                    {/* CASH CONFIRMATION CHECKBOX FOR COD */}
                    {!isPrepaid && selectedPaymentMode === 'cash' && (
                      <div
                        style={{
                          background: cashConfirmed ? '#dcfce7' : '#fef3c7',
                          border: `2px solid ${cashConfirmed ? '#16a34a' : '#fde68a'}`,
                          padding: '0.85rem 1rem',
                          borderRadius: '12px',
                          marginBottom: '1rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                        onClick={() => setCashConfirmed(!cashConfirmed)}
                      >
                        <input
                          type="checkbox"
                          checked={cashConfirmed}
                          onChange={(e) => setCashConfirmed(e.target.checked)}
                          style={{ width: '22px', height: '22px', accentColor: '#16a34a', cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '0.86rem', fontWeight: 800, color: '#0f172a' }}>
                          I physically counted and collected ₹{amountToCollect.toFixed(2)} in banknotes.
                        </span>
                      </div>
                    )}

                    {/* Swipe to Confirm Delivered */}
                    <SwipeToConfirmSlider
                      label={
                        isPrepaid
                          ? 'Swipe to Verify OTP & Deliver'
                          : selectedPaymentMode === 'cash'
                            ? `Swipe: Confirm ₹${amountToCollect} Cash & Deliver`
                            : 'Swipe: Confirm Delivered'
                      }
                      confirmLabel="Order Delivered!"
                      themeColor="#16a34a"
                      disabled={
                        (isPrepaid && deliveryOtpInput.length < 4) ||
                        (!isPrepaid && selectedPaymentMode === 'cash' && !cashConfirmed)
                      }
                      onConfirm={() =>
                        executeStatusTransition('delivered', {
                          deliveryOtp: isPrepaid ? deliveryOtpInput.trim() : undefined,
                          paymentMode: isPrepaid ? 'prepaid_online' : selectedPaymentMode,
                        })
                      }
                    />
                  </section>
                )}

                {/* REVERSE LOGISTICS (CUSTOMER RETURN PICKUP) */}
                {isReverseOrder && (
                  <section style={{ background: '#fff7ed', padding: '1.15rem', borderRadius: '14px', border: '1.5px solid #fed7aa', marginBottom: '1.25rem' }}>
                    {activeDelivery.fulfilmentStatus === 'return_partner_assigned' ? (
                      <>
                        <strong style={{ fontSize: '0.84rem', color: '#ea580c', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '0.4rem' }}>
                          🔄 STEP 1 · COLLECT RETURN FROM CUSTOMER
                        </strong>
                        <h4 style={{ fontSize: '1.1rem', fontWeight: 900, color: '#0f172a', margin: '0.25rem 0' }}>
                          Customer: {activeDelivery.address?.name || activeDelivery.customerName}
                        </h4>
                        <p style={{ fontSize: '0.86rem', color: '#475569', margin: '0.2rem 0 0.85rem' }}>
                          {activeDelivery.address?.formattedAddress || activeDelivery.address?.addressLine1}
                        </p>
                        <SwipeToConfirmSlider
                          label="Swipe: Return Collected from Customer"
                          confirmLabel="Return Picked Up!"
                          themeColor="#ea580c"
                          onConfirm={() => executeStatusTransition('return_picked_up')}
                        />
                      </>
                    ) : (
                      <>
                        <strong style={{ fontSize: '0.84rem', color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '0.4rem' }}>
                          🏢 STEP 2 · HAND OVER RETURN TO ARTISAN SHG
                        </strong>
                        <h4 style={{ fontSize: '1.1rem', fontWeight: 900, color: '#0f172a', margin: '0.25rem 0' }}>
                          Return to: {activeDelivery.sellerPickup?.sellerName || 'Maitri SHG'}
                        </h4>
                        <p style={{ fontSize: '0.86rem', color: '#475569', margin: '0.2rem 0 0.85rem' }}>
                          {activeDelivery.sellerPickup?.address}, {activeDelivery.sellerPickup?.city}
                        </p>
                        <small style={{ display: 'block', color: '#15803d', fontWeight: 700, marginBottom: '0.85rem' }}>
                          ✓ Swiping hands over package & triggers automatic refund chain!
                        </small>
                        <SwipeToConfirmSlider
                          label="Swipe: Handed Over to Seller"
                          confirmLabel="Delivered to Seller!"
                          themeColor="#16a34a"
                          onConfirm={() => executeStatusTransition('return_delivered_to_seller')}
                        />
                      </>
                    )}
                  </section>
                )}

                {/* Items in Parcel */}
                <div style={{ marginTop: '1.15rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.85rem' }}>
                  <small style={{ fontSize: '0.74rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>
                    Items in Parcel ({activeDelivery.items?.length || 1})
                  </small>
                  <div style={{ marginTop: '0.4rem' }}>
                    {activeDelivery.items?.map((item, idx) => (
                      <div key={idx} style={{ fontSize: '0.86rem', color: '#334155', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.2rem 0' }}>
                        <span>•</span>
                        <strong>{item.productName}</strong>
                        <span style={{ color: '#64748b' }}>× {item.quantity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            )}
          </div>
        )}

        {/* TAB 2: ALL ASSIGNED ORDERS */}
        {activeTab === 'all' && (
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 900, marginBottom: '0.85rem', color: '#0f172a' }}>
              All Current Assigned Deliveries ({orders.length})
            </h3>
            {orders.length === 0 ? (
              <div style={{ background: '#ffffff', padding: '2.5rem', borderRadius: '16px', textAlign: 'center', border: '1px dashed #cbd5e1' }}>
                <p style={{ color: '#64748b', fontSize: '0.9rem', margin: 0 }}>No orders assigned currently.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '0.85rem' }}>
                {orders.map((o) => (
                  <div key={o._id} style={{ background: '#ffffff', padding: '1.15rem', borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: '0 2px 6px rgba(0,0,0,0.03)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                      <strong style={{ fontSize: '0.95rem', fontFamily: 'monospace' }}>#{o.orderReference}</strong>
                      <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#2563eb', backgroundColor: '#eff6ff', padding: '0.2rem 0.55rem', borderRadius: '999px' }}>
                        {o.fulfilmentStatus.replaceAll('_', ' ').toUpperCase()}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.85rem', color: '#475569', margin: '0 0 0.35rem' }}>
                      Customer: <strong>{o.customerName}</strong> · Locality: {o.address?.locality || 'Damoh'}
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px dashed #e2e8f0' }}>
                      <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                        {o.items?.length || 1} item(s)
                      </span>
                      <strong style={{ fontSize: '0.95rem', color: '#0f172a' }}>
                        ₹{((o.totalPaise || 0) / 100).toFixed(2)}
                      </strong>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: HISTORY */}
        {activeTab === 'history' && (
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 900, marginBottom: '0.85rem', color: '#0f172a' }}>
              Delivery Shift History ({historyOrders.length})
            </h3>
            {historyOrders.length === 0 ? (
              <div style={{ background: '#ffffff', padding: '2.5rem', borderRadius: '16px', textAlign: 'center', border: '1px dashed #cbd5e1' }}>
                <p style={{ color: '#64748b', fontSize: '0.9rem', margin: 0 }}>No completed orders in history yet.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {historyOrders.slice(0, 20).map((o) => (
                  <div key={o._id} style={{ background: '#ffffff', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                    <div>
                      <strong style={{ fontSize: '0.9rem', fontFamily: 'monospace' }}>#{o.orderReference}</strong>
                      <small style={{ display: 'block', color: '#64748b', fontSize: '0.76rem', marginTop: '0.15rem' }}>
                        {o.customerName} · {o.address?.locality || 'Damoh'}
                      </small>
                    </div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 900, color: '#16a34a', backgroundColor: '#f0fdf4', padding: '0.25rem 0.65rem', borderRadius: '8px' }}>
                      ✓ ₹{((o.totalPaise || 0) / 100).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: EARNINGS & PAYSLIP */}
        {activeTab === 'payslip' && (
          <div style={{ marginTop: '0.5rem' }}>
            <DeliveryPartnerPaySlipPanel />
          </div>
        )}
      </main>

      {/* Hub Remittance & Handshake Modal (with Auto-Refreshing TOTP PIN) */}
      {showRemittanceModal && (
        <HubRemittanceModal
          cashInHandRupees={shiftMetrics.cashInHandRupees}
          remittancePin={profile?.remittancePin || '8392'}
          assignedCity={profile?.assignedCity || 'Damoh'}
          onClose={() => setShowRemittanceModal(false)}
          onSettled={async () => {
            await loadData();
          }}
        />
      )}

      {/* Dynamic UPI QR Modal */}
      {showUpiModal && activeDelivery && (
        <DynamicUpiQrModal
          orderReference={activeDelivery.orderReference}
          amountRupees={amountToCollect}
          customerName={activeDelivery.customerName}
          onClose={() => setShowUpiModal(false)}
          onConfirmPayment={(utr) => {
            void executeStatusTransition('delivered', {
              paymentMode: 'upi_qr',
              upiUtr: utr,
            });
          }}
        />
      )}

      {/* Road Failure / Exception Reporting Modal */}
      {reportingIssueOrder && (
        <DeliveryFailureReportModal
          order={reportingIssueOrder}
          onClose={() => setReportingIssueOrder(null)}
          onSuccess={(msg) => {
            setSuccessMsg(msg);
            setReportingIssueOrder(null);
            void loadData();
          }}
        />
      )}
    </div>
  );
};
