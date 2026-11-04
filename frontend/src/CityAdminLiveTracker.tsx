import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import { Link } from 'react-router-dom';
import { api } from './api';
import type { CityAdminOrder, PartnerLiveTrackingResponse } from './types';

const ACTIVE_TRACKING_STATUSES = new Set([
  'delivery_partner_assigned',
  'out_for_pickup',
  'picked_up',
  'out_for_delivery',
  'return_partner_assigned',
  'return_picked_up',
]);

const COMPLETED_STATUSES = new Set([
  'delivered',
  'completed',
  'return_delivered_to_seller',
  'ready_for_refund',
  'refund_completed',
]);

function createMarkerIcon(label: string, bgColor: string, pulse = false): L.DivIcon {
  return L.divIcon({
    className: 'esakhi-live-marker',
    html: `<div style="
      display:flex;
      align-items:center;
      justify-content:center;
      width:36px;
      height:36px;
      border-radius:999px;
      background:${bgColor};
      color:#fff;
      font-weight:700;
      font-size:15px;
      border:3px solid #ffffff;
      box-shadow:${pulse ? `0 0 0 6px ${bgColor}33, 0 6px 16px rgba(0,0,0,0.28)` : '0 4px 12px rgba(0,0,0,0.25)'};
    ">${label}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function MapBoundsUpdater({ points }: { points: Array<[number, number]> }): null {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView(points[0], 15);
      return;
    }
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [38, 38], maxZoom: 16 });
  }, [map, points]);
  return null;
}

export function isOrderActiveForLiveTracking(status: string, hasPartner: boolean): boolean {
  return hasPartner && ACTIVE_TRACKING_STATUSES.has(status);
}

export function CityAdminLiveTracker({
  orderId,
  orderStatus,
  hasPartner = true,
  onOrderDelivered,
}: {
  orderId: string;
  orderStatus: string;
  hasPartner?: boolean;
  onOrderDelivered?: () => void;
}): ReactNode {
  const [tracking, setTracking] = useState<PartnerLiveTrackingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [networkError, setNetworkError] = useState('');
  const [streamDisconnected, setStreamDisconnected] = useState(() => COMPLETED_STATUSES.has(orderStatus));
  const timerRef = useRef<number | null>(null);
  const deliveredNotifiedRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fetchTrackingSnapshot = useCallback(async (showSpinner = false) => {
    if (!orderId || !hasPartner) {
      setLoading(false);
      return;
    }
    if (showSpinner) setLoading(true);
    try {
      const snapshot = await api.trackOrderPartner(orderId);
      setTracking(snapshot);
      setNetworkError('');

      if (
        snapshot.streamStatus === 'GPS_STREAM_INACTIVE' ||
        !snapshot.active ||
        COMPLETED_STATUSES.has(snapshot.fulfilmentStatus)
      ) {
        setStreamDisconnected(true);
        stopPolling();
        if (COMPLETED_STATUSES.has(snapshot.fulfilmentStatus) && !deliveredNotifiedRef.current) {
          deliveredNotifiedRef.current = true;
          onOrderDelivered?.();
        }
      } else {
        setStreamDisconnected(false);
      }
    } catch (cause) {
      setNetworkError(cause instanceof Error ? cause.message : 'GPS telemetry temporarily unreachable.');
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [hasPartner, onOrderDelivered, orderId, stopPolling]);

  useEffect(() => {
    if (COMPLETED_STATUSES.has(orderStatus)) {
      setStreamDisconnected(true);
      stopPolling();
      void fetchTrackingSnapshot(false);
      return () => stopPolling();
    }

    if (!ACTIVE_TRACKING_STATUSES.has(orderStatus) || !hasPartner) {
      stopPolling();
      setLoading(false);
      return () => stopPolling();
    }

    void fetchTrackingSnapshot(true);
    timerRef.current = window.setInterval(() => {
      void fetchTrackingSnapshot(false);
    }, 3_000);

    return () => stopPolling();
  }, [fetchTrackingSnapshot, hasPartner, orderStatus, stopPolling]);

  const sellerIcon = useMemo(() => createMarkerIcon('S', '#6b215c', false), []);
  const customerIcon = useMemo(() => createMarkerIcon('C', '#1d6b43', false), []);
  const partnerIcon = useMemo(
    () => createMarkerIcon('🛵', streamDisconnected ? '#64748b' : '#2563eb', !streamDisconnected),
    [streamDisconnected],
  );

  if (!hasPartner && !COMPLETED_STATUSES.has(orderStatus)) {
    return (
      <section className="city-admin-panel" style={{ border: '1px dashed rgba(107, 33, 92, 0.28)' }}>
        <div className="city-admin-panel-heading">
          <div>
            <p className="city-admin-eyebrow">CONDITIONAL LIVE GPS TRACKER</p>
            <h2>Live GPS Stream Standby (`GPS_STREAM_STANDBY`)</h2>
            <p>Live partner location tracking activates automatically as soon as a Delivery Partner is assigned to this order.</p>
          </div>
        </div>
      </section>
    );
  }

  if (loading && !tracking) {
    return (
      <section className="city-admin-panel">
        <div className="city-admin-panel-heading">
          <div>
            <p className="city-admin-eyebrow">CONDITIONAL LIVE GPS TRACKER</p>
            <h2>Connecting to Delivery Partner GPS Stream…</h2>
          </div>
        </div>
        <div style={{ height: '280px', borderRadius: '14px', background: 'rgba(107, 33, 92, 0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>
          Initializing live telemetry…
        </div>
      </section>
    );
  }

  if (!tracking) return null;

  const { sellerNode, customerNode, partnerLocation } = tracking;
  const partnerPos: [number, number] = partnerLocation
    ? [partnerLocation.latitude, partnerLocation.longitude]
    : [sellerNode.latitude, sellerNode.longitude];
  const sellerPos: [number, number] = [sellerNode.latitude, sellerNode.longitude];
  const customerPos: [number, number] = [customerNode.latitude, customerNode.longitude];
  const allPoints: Array<[number, number]> = [sellerPos, partnerPos, customerPos];

  return (
    <section
      className="city-admin-panel"
      style={{
        border: streamDisconnected
          ? '2px solid rgba(29, 107, 67, 0.4)'
          : '2px solid rgba(37, 99, 235, 0.45)',
      }}
    >
      <div className="city-admin-panel-heading" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <p className="city-admin-eyebrow" style={{ color: streamDisconnected ? '#1d6b43' : '#2563eb', fontWeight: 700 }}>
            {streamDisconnected ? '● GPS_STREAM_INACTIVE · ORDER DELIVERED' : '◉ GPS_STREAM_ACTIVE · LIVE PARTNER TELEMETRY (3S POLL)'}
          </p>
          <h2>
            {streamDisconnected
              ? `Delivery Completed — Live GPS Stream Terminated (#${tracking.orderReference})`
              : `Live Delivery Route Tracker (#${tracking.orderReference})`}
          </h2>
          <p>
            {streamDisconnected
              ? 'The Delivery Partner confirmed payment and marked the order DELIVERED. Live GPS broadcasting has automatically disconnected to conserve device battery and data.'
              : `Tracking ${partnerLocation?.name || 'Delivery Partner'} from Seller (${sellerNode.sellerName}) to Customer (${customerNode.name}).`}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: '999px',
              fontSize: '0.78rem',
              fontWeight: 700,
              background: streamDisconnected ? 'rgba(29, 107, 67, 0.12)' : 'rgba(37, 99, 235, 0.12)',
              color: streamDisconnected ? '#1d6b43' : '#1d4ed8',
            }}
          >
            {tracking.streamStatus}
          </span>
          {!streamDisconnected && (
            <button
              type="button"
              className="city-admin-secondary-button"
              onClick={() => void fetchTrackingSnapshot(false)}
            >
              Sync GPS Now
            </button>
          )}
        </div>
      </div>

      {/* Fallback / Intermittent Signal Warning */}
      {(networkError || tracking.signalQuality === 'fallback_checkpoint') && !streamDisconnected && (
        <div
          role="status"
          style={{
            marginBottom: '0.85rem',
            padding: '0.65rem 0.9rem',
            borderRadius: '10px',
            background: 'rgba(217, 145, 22, 0.12)',
            border: '1px solid rgba(217, 145, 22, 0.4)',
            fontSize: '0.86rem',
            color: '#7c4a03',
          }}
        >
          <strong>⚠ GPS Fallback Mode Active:</strong>{' '}
          {networkError
            ? `${networkError} Showing last verified partner coordinates.`
            : 'Partner device GPS signal is intermittent — estimating coordinates from current route checkpoint.'}
        </div>
      )}

      {/* Telemetry Metrics Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
          gap: '0.75rem',
          marginBottom: '1rem',
        }}
      >
        <div style={{ padding: '0.75rem', borderRadius: '12px', background: 'rgba(107, 33, 92, 0.05)', border: '1px solid rgba(107, 33, 92, 0.16)' }}>
          <small style={{ display: 'block', color: 'var(--muted, #6a5864)', fontWeight: 600 }}>SELLER NODE (ORIGIN)</small>
          <strong>{sellerNode.sellerName}</strong>
          <small style={{ display: 'block' }}>{sellerNode.latitude.toFixed(4)}, {sellerNode.longitude.toFixed(4)}</small>
        </div>

        <div style={{ padding: '0.75rem', borderRadius: '12px', background: 'rgba(37, 99, 235, 0.06)', border: '1px solid rgba(37, 99, 235, 0.2)' }}>
          <small style={{ display: 'block', color: '#1d4ed8', fontWeight: 600 }}>
            {streamDisconnected ? 'PARTNER MARKER (FROZEN)' : 'LIVE PARTNER POSITION'}
          </small>
          <strong>{partnerLocation?.name || 'Assigned Partner'}</strong>
          <small style={{ display: 'block' }}>
            {partnerPos[0].toFixed(4)}, {partnerPos[1].toFixed(4)}
            {partnerLocation?.updatedAt ? ` · ${new Date(partnerLocation.updatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
          </small>
        </div>

        <div style={{ padding: '0.75rem', borderRadius: '12px', background: 'rgba(29, 107, 67, 0.06)', border: '1px solid rgba(29, 107, 67, 0.2)' }}>
          <small style={{ display: 'block', color: '#1d6b43', fontWeight: 600 }}>CUSTOMER NODE (DROP-OFF)</small>
          <strong>{customerNode.name} ({customerNode.locality})</strong>
          <small style={{ display: 'block' }}>{customerNode.latitude.toFixed(4)}, {customerNode.longitude.toFixed(4)}</small>
        </div>

        <div style={{ padding: '0.75rem', borderRadius: '12px', background: 'var(--surface-subtle, #fdf8fb)', border: '1px solid rgba(120, 80, 100, 0.16)' }}>
          <small style={{ display: 'block', color: 'var(--muted, #6a5864)', fontWeight: 600 }}>DISTANCE & LIVE ETA</small>
          <strong>
            {streamDisconnected
              ? '0.00 km · Delivered'
              : `${tracking.distanceToCustomerKm} km to Customer · ~${tracking.estimatedEtaMinutes} min ETA`}
          </strong>
          <small style={{ display: 'block' }}>
            {streamDisconnected ? 'Stream disconnected on DELIVERED' : `${tracking.distanceToSellerKm} km from Seller`}
          </small>
        </div>
      </div>

      {/* Interactive Leaflet Map with Seller Node, Customer Node, and Moving Partner Marker */}
      <div style={{ height: '340px', width: '100%', borderRadius: '14px', overflow: 'hidden', border: '1px solid rgba(107, 33, 92, 0.2)' }}>
        <MapContainer center={partnerPos} zoom={14} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapBoundsUpdater points={allPoints} />

          {/* Route Polyline: Seller -> Partner -> Customer */}
          <Polyline
            positions={[sellerPos, partnerPos]}
            pathOptions={{ color: '#6b215c', weight: 4, dashArray: '6 6', opacity: 0.8 }}
          />
          <Polyline
            positions={[partnerPos, customerPos]}
            pathOptions={{ color: streamDisconnected ? '#1d6b43' : '#2563eb', weight: 4, opacity: 0.9 }}
          />

          {/* Seller Origin Marker */}
          <Marker position={sellerPos} icon={sellerIcon}>
            <Popup>
              <strong>Seller Pickup Node: {sellerNode.sellerName}</strong>
              <br />
              {sellerNode.address}, {sellerNode.city}
              <br />
              GPS: {sellerNode.latitude.toFixed(4)}, {sellerNode.longitude.toFixed(4)}
            </Popup>
          </Marker>

          {/* Customer Destination Marker */}
          <Marker position={customerPos} icon={customerIcon}>
            <Popup>
              <strong>Customer Drop-off Node: {customerNode.name}</strong>
              <br />
              {customerNode.address}
              <br />
              GPS: {customerNode.latitude.toFixed(4)}, {customerNode.longitude.toFixed(4)}
            </Popup>
          </Marker>

          {/* Delivery Partner Moving / Frozen Marker */}
          <Marker position={partnerPos} icon={partnerIcon}>
            <Popup>
              <strong>
                {streamDisconnected ? '🔒 Partner Final Delivery Coordinate (Frozen)' : '🛵 Live Delivery Partner'}
              </strong>
              <br />
              {partnerLocation?.name} ({partnerLocation?.phoneE164})
              <br />
              Status: {tracking.fulfilmentStatus.replaceAll('_', ' ').toUpperCase()}
              <br />
              GPS: {partnerPos[0].toFixed(4)}, {partnerPos[1].toFixed(4)}
            </Popup>
          </Marker>
        </MapContainer>
      </div>
    </section>
  );
}

export function CityAdminLiveFleetOverview({ orders }: { orders: CityAdminOrder[] }): ReactNode {
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const activeTrackingOrders = useMemo(
    () => orders.filter((o) => Boolean(o.deliveryPartner) && ACTIVE_TRACKING_STATUSES.has(o.fulfilmentStatus)),
    [orders],
  );
  const completedOrders = useMemo(
    () => orders.filter((o) => COMPLETED_STATUSES.has(o.fulfilmentStatus)),
    [orders],
  );
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');

  useEffect(() => {
    if (activeTrackingOrders.length && !activeTrackingOrders.some((o) => o._id === selectedOrderId)) {
      setSelectedOrderId(activeTrackingOrders[0]._id);
    } else if (!activeTrackingOrders.length) {
      setSelectedOrderId('');
    }
  }, [activeTrackingOrders, selectedOrderId]);

  const selectedOrder = activeTrackingOrders.find((o) => o._id === selectedOrderId) ?? activeTrackingOrders[0];

  return (
    <section className="city-admin-panel" style={{ marginBottom: '1.25rem' }}>
      <div className="city-admin-panel-heading" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <p className="city-admin-eyebrow">CONDITIONAL LIVE GPS FLEET MONITOR</p>
          <h2>Active Live Tracking vs. Completed Deliveries</h2>
          <p>Orders with assigned partners stream live GPS coordinates until marked DELIVERED, when they automatically disconnect and move to Completed Deliveries.</p>
        </div>
        <div className="city-admin-tabs" role="tablist" aria-label="Live GPS tracking tabs" style={{ margin: 0 }}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'active'}
            className={tab === 'active' ? 'active' : ''}
            onClick={() => setTab('active')}
          >
            ◉ Active Tracking ({activeTrackingOrders.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'completed'}
            className={tab === 'completed' ? 'active' : ''}
            onClick={() => setTab('completed')}
          >
            ✓ Completed Deliveries ({completedOrders.length})
          </button>
        </div>
      </div>

      {tab === 'active' ? (
        activeTrackingOrders.length > 0 ? (
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.86rem', fontWeight: 600 }}>Select active order on map:</span>
              {activeTrackingOrders.map((o) => (
                <button
                  key={o._id}
                  type="button"
                  className={selectedOrder?._id === o._id ? 'city-admin-primary-button' : 'city-admin-secondary-button'}
                  onClick={() => setSelectedOrderId(o._id)}
                  style={{ padding: '0.38rem 0.8rem', fontSize: '0.84rem' }}
                >
                  #{o.orderReference} · {o.deliveryPartner?.name} ({o.fulfilmentStatus.replaceAll('_', ' ')})
                </button>
              ))}
            </div>
            {selectedOrder && (
              <CityAdminLiveTracker
                key={selectedOrder._id}
                orderId={selectedOrder._id}
                orderStatus={selectedOrder.fulfilmentStatus}
                hasPartner={Boolean(selectedOrder.deliveryPartner)}
                onOrderDelivered={() => {
                  window.dispatchEvent(new Event('city-admin-order-updated'));
                  setTab('completed');
                }}
              />
            )}
          </div>
        ) : (
          <div className="city-admin-empty">
            No orders are currently in active partner transit (`DELIVERY_PARTNER_ASSIGNED` → `OUT_FOR_DELIVERY`). As soon as a partner is assigned to a Ready-for-Pickup order, live GPS tracking will activate here automatically.
          </div>
        )
      ) : completedOrders.length > 0 ? (
        <div className="city-admin-table-wrap">
          <table className="city-admin-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Seller Origin</th>
                <th>Delivered By</th>
                <th>GPS Stream State</th>
                <th>Final Coordinate</th>
              </tr>
            </thead>
            <tbody>
              {completedOrders.map((order) => (
                <tr key={order._id}>
                  <td><Link to={`/city-admin/orders/${order._id}`}><strong>#{order.orderReference}</strong></Link></td>
                  <td>{order.customerName}<small>{order.address?.locality}</small></td>
                  <td>{order.sellerPickup?.sellerName || 'City Seller'}</td>
                  <td>{order.deliveryPartner?.name || 'Completed'}</td>
                  <td>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '0.25rem 0.6rem',
                        borderRadius: '999px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        background: 'rgba(100, 116, 139, 0.14)',
                        color: '#334155',
                      }}
                    >
                      GPS_STREAM_INACTIVE
                    </span>
                  </td>
                  <td>
                    <small>
                      {order.address?.latitude !== undefined && order.address?.longitude !== undefined
                        ? `${order.address.latitude.toFixed(4)}, ${order.address.longitude.toFixed(4)} (Frozen)`
                        : 'Delivered'}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="city-admin-empty">No completed deliveries recorded yet.</div>
      )}
    </section>
  );
}
