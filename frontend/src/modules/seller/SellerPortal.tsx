import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, resolveProductImageUrl } from '../../api';
import { useAuth } from '../../AuthContext';
import { useLoad, useRefreshOnFocus, Loading, Notice, displayError } from '../../ui';
import type { SellerOrder, SellerProductDraft, SellerRecord, Product, Variant } from '../../types';
import { SellerOrderCard, SellerOrderSkeleton } from '../../SellerOrderCard';
import { SellerStockStepper } from './SellerStockStepper';
import { SellerBankPassbook } from './SellerBankPassbook';
import { SellerCatalogueListingPage } from './SellerCatalogueListingPage';
import {
  SellerSalesTrendChart,
  SellerProfileView,
  SellerInventoryHistoryPanel,
  DamohCityAdminHelpModal,
} from './SellerComponents';

function formatMoney(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format((paise || 0) / 100);
}

function readSellerProductDraft(key: string): SellerProductDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export type SellerPortalView = 'overview' | 'orders' | 'products' | 'passbook' | 'profile' | 'new_product' | 'settings';

interface SellerPortalProps {
  initialView?: SellerPortalView;
}

export function SellerPortal({ initialView = 'overview' }: SellerPortalProps): ReactNode {
  const { user, signOut } = useAuth();
  const [view, setView] = useState<SellerPortalView>(initialView);
  const [helpOpen, setHelpOpen] = useState(false);

  // Draft management
  const draftKey = `esakhi.seller.productDraft:${user?.id ?? 'seller'}`;
  const [savedDraft, setSavedDraft] = useState<SellerProductDraft | null>(() => readSellerProductDraft(draftKey));
  useEffect(() => {
    setSavedDraft(readSellerProductDraft(draftKey));
  }, [draftKey]);
  const discardDraft = () => {
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
    setSavedDraft(null);
  };

  // Dashboard & Seller Profile data
  const dashboard = useLoad(() => api.sellerDashboard(), [user?.id]);
  const [sellerRecord, setSellerRecord] = useState<SellerRecord | null>(null);

  useEffect(() => {
    api
      .getSellerProfile()
      .then((res) => {
        if (res.seller) setSellerRecord(res.seller);
      })
      .catch(() => undefined);
  }, [user?.id]);

  // Product listing query state
  const [productPage, setProductPage] = useState(1);
  const [productSearch, setProductSearch] = useState('');
  const [productApprovalStatus, setProductApprovalStatus] = useState('');
  const [productStockStatus, setProductStockStatus] = useState('all');

  const products = useLoad(() => {
    const query = new URLSearchParams({ page: String(productPage), limit: '20' });
    if (productSearch.trim()) query.set('q', productSearch.trim());
    if (productApprovalStatus) query.set('approvalStatus', productApprovalStatus);
    if (productStockStatus !== 'all') query.set('stockStatus', productStockStatus);
    return api.sellerProducts(query);
  }, [user?.id, productPage, productSearch, productApprovalStatus, productStockStatus]);

  // Orders query state
  const [orderPage, setOrderPage] = useState(1);
  const [orderStatus, setOrderStatus] = useState<'all' | 'new' | 'processing' | 'ready' | 'completed' | 'cancelled'>('all');
  const orders = useLoad(() => api.sellerOrders(orderPage, 20, orderStatus), [user?.id, orderPage, orderStatus]);

  const orderViewStatus: Partial<Record<typeof orderStatus, string[]>> = {
    new: ['placed', 'order_confirmed'],
    processing: ['accepted', 'preparing'],
    ready: ['ready_for_pickup', 'delivery_partner_assigned', 'out_for_pickup', 'picked_up', 'out_for_delivery', 'return_requested', 'return_accepted', 'return_partner_assigned', 'return_picked_up'],
    completed: ['delivered', 'completed', 'return_delivered_to_seller', 'ready_for_refund', 'refund_completed', 'return_rejected'],
    cancelled: ['cancelled', 'delivery_failed'],
  };

  useRefreshOnFocus(dashboard.reload);
  useRefreshOnFocus(products.reload);
  useRefreshOnFocus(orders.reload);

  const data = dashboard.data;
  const metrics = data?.metrics;
  const [updatingOrderId, setUpdatingOrderId] = useState('');
  const [orderActionMessage, setOrderActionMessage] = useState('');
  const [orderActionError, setOrderActionError] = useState('');
  const [historyProductId, setHistoryProductId] = useState('');

  // 1-Tap Order Status Progression
  const updateSellerOrderStatus = async (order: SellerOrder, nextStatus: 'preparing' | 'ready_for_pickup' | 'completed') => {
    setUpdatingOrderId(order._id);
    setOrderActionError('');
    setOrderActionMessage('');
    try {
      await api.updateSellerOrderStatus(order._id, nextStatus);
      const confirmation = nextStatus === 'ready_for_pickup'
        ? (order.fulfilmentMethod === 'delivery'
          ? `Order #${order.orderReference} is Ready for Pickup! Damoh City Admin dispatch desk has been notified to send a rider.`
          : `Order #${order.orderReference} is Ready for Pickup! Customer has been notified.`)
        : nextStatus === 'preparing'
          ? `Order #${order.orderReference} accepted! You can now start packing the items.`
          : `Order #${order.orderReference} marked as Completed.`;
      setOrderActionMessage(confirmation);
      await Promise.all([orders.reload(false), dashboard.reload(false)]);
    } catch (cause) {
      setOrderActionError(displayError(cause));
    } finally {
      setUpdatingOrderId('');
    }
  };

  const shgName = sellerRecord?.supplierDetails?.shgName || data?.storeProfile?.shgName || user?.name || 'Maitri Mahila Samooh';
  const shgLeader = sellerRecord?.supplierDetails?.shgLeaderName || data?.storeProfile?.representative || 'SHG Leader';
  const memberCount = sellerRecord?.supplierDetails?.numberOfMembers || 12;
  const shgCode = sellerRecord?.supplierDetails?.shgCode || 'MP-DMH-1042';

  const allOrders = orders.data?.data ?? [];
  const visibleOrders = orderStatus === 'all'
    ? allOrders
    : allOrders.filter((order: SellerOrder) => orderViewStatus[orderStatus]?.includes(order.fulfilmentStatus));

  const setOrderView = (status: typeof orderStatus) => {
    setView('orders');
    setOrderStatus(status);
    setOrderPage(1);
  };

  const orderRows = (rows: SellerOrder[]) =>
    rows.length ? (
      <div className="seller-order-list" style={{ display: 'grid', gap: '1rem' }}>
        {rows.map((order: SellerOrder) => (
          <SellerOrderCard
            key={order._id}
            order={order}
            isUpdating={updatingOrderId === order._id}
            onTransitionStatus={updateSellerOrderStatus}
          />
        ))}
      </div>
    ) : (
      <div className="seller-empty" style={{ textAlign: 'center', padding: '3.5rem 1rem', background: '#ffffff', borderRadius: '14px', border: '1.5px dashed #cbd5e1' }}>
        <span style={{ fontSize: '2.2rem', display: 'block', marginBottom: '0.5rem' }}>📦</span>
        <strong style={{ fontSize: '1.15rem', color: '#0f172a' }}>No orders to display</strong>
        <p style={{ fontSize: '0.86rem', color: '#64748b', margin: '0.3rem 0 0' }}>
          Customer orders containing your products will appear here automatically.
        </p>
      </div>
    );

  const orderTabs: Array<{ key: typeof orderStatus; label: string }> = [
    { key: 'all', label: 'All Orders' },
    { key: 'new', label: 'New Orders' },
    { key: 'processing', label: 'Preparing' },
    { key: 'ready', label: 'Ready for Pickup' },
    { key: 'completed', label: 'Completed' },
    { key: 'cancelled', label: 'Cancelled' },
  ];

  return (
    <div className="seller-dashboard-shell" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', width: '100%', background: '#f8fafc', color: '#1e293b' }}>
      {/* 1. SHG Sisterhood Hero Header (100% Width Full-Span) */}
      <header
        style={{
          width: '100%',
          background: 'linear-gradient(135deg, #4a1553 0%, #4A0E4E 100%)',
          color: '#ffffff',
          padding: '1.25rem 2rem',
          boxShadow: '0 4px 20px rgba(74, 21, 83, 0.2)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ maxWidth: '1440px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.25rem' }}>
          {/* Brand & SHG Identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
            <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none', color: '#ffffff' }}>
              <div
                style={{
                  width: '46px',
                  height: '46px',
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.16)',
                  backdropFilter: 'blur(6px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1.5px solid rgba(255, 255, 255, 0.3)',
                  fontWeight: 800,
                  fontSize: '1.4rem',
                }}
              >
                🌸
              </div>
              <div>
                <strong style={{ fontSize: '1.35rem', letterSpacing: '-0.02em', display: 'block' }}>eSakhi</strong>
                <small style={{ fontSize: '0.7rem', letterSpacing: '0.09em', textTransform: 'uppercase', opacity: 0.85 }}>
                  DAMOH ARTISAN PORTAL
                </small>
              </div>
            </Link>

            <div style={{ width: '1px', height: '36px', background: 'rgba(255, 255, 255, 0.25)' }} />

            {/* SHG Badge */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1.15rem', fontWeight: 800 }}>{shgName}</span>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    padding: '0.2rem 0.65rem',
                    borderRadius: '999px',
                    background: 'rgba(255, 255, 255, 0.2)',
                    color: '#ffffff',
                    border: '1px solid rgba(255, 255, 255, 0.35)',
                  }}
                >
                  ✓ {shgCode} · NRLM Verified
                </span>
              </div>
              <div style={{ fontSize: '0.8rem', opacity: 0.88, marginTop: '0.15rem' }}>
                {shgLeader} · <span style={{ color: '#fef08a', fontWeight: 700 }}>{memberCount} Women Artisans Empowered</span>
              </div>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setView('new_product')}
              style={{
                background: '#ffffff',
                color: '#4a1553',
                border: 'none',
                borderRadius: '9px',
                padding: '0.55rem 1.15rem',
                fontWeight: 800,
                fontSize: '0.86rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
              }}
            >
              <span>＋</span>
              <span>Add Product</span>
            </button>

            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              style={{
                background: 'rgba(255, 255, 255, 0.18)',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.35)',
                borderRadius: '9px',
                padding: '0.55rem 1rem',
                fontWeight: 700,
                fontSize: '0.86rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
              }}
            >
              <span>📞</span>
              <span>Damoh Helpline</span>
            </button>

            <button
              type="button"
              onClick={() => void signOut()}
              style={{
                background: 'transparent',
                color: 'rgba(255, 255, 255, 0.85)',
                border: 'none',
                padding: '0.55rem 0.85rem',
                fontSize: '0.86rem',
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* 2. Streamlined 4-Hub Primary Navigation Bar (100% Width Full-Span) */}
      <nav
        aria-label="Seller Hub Navigation"
        style={{
          width: '100%',
          background: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          padding: '0.55rem 2rem',
          position: 'sticky',
          top: '76px',
          zIndex: 90,
          boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
        }}
      >
        <div style={{ maxWidth: '1440px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', overflowX: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'nowrap' }}>
            {/* Hub 1: Overview */}
            <button
              type="button"
              onClick={() => setView('overview')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.6rem 1.15rem',
                borderRadius: '8px',
                border: 'none',
                fontWeight: view === 'overview' ? 800 : 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
                background: view === 'overview' ? '#4A0E4E' : 'transparent',
                color: view === 'overview' ? '#ffffff' : '#475569',
                transition: 'all 0.15s ease',
              }}
            >
              <span>🏠</span>
              <span>Overview</span>
            </button>

            {/* Hub 2: Orders */}
            <button
              type="button"
              onClick={() => setView('orders')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.6rem 1.15rem',
                borderRadius: '8px',
                border: 'none',
                fontWeight: view === 'orders' ? 800 : 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
                background: view === 'orders' ? '#4A0E4E' : 'transparent',
                color: view === 'orders' ? '#ffffff' : '#475569',
                transition: 'all 0.15s ease',
              }}
            >
              <span>📦</span>
              <span>Orders & Dispatch</span>
              {Boolean(metrics?.newOrders) && (
                <span style={{ background: '#d97706', color: '#ffffff', borderRadius: '999px', fontSize: '0.74rem', padding: '0.1rem 0.5rem', fontWeight: 800 }}>
                  {metrics?.newOrders}
                </span>
              )}
            </button>

            {/* Hub 3: Products & Stock */}
            <button
              type="button"
              onClick={() => setView('products')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.6rem 1.15rem',
                borderRadius: '8px',
                border: 'none',
                fontWeight: view === 'products' ? 800 : 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
                background: view === 'products' ? '#4A0E4E' : 'transparent',
                color: view === 'products' ? '#ffffff' : '#475569',
                transition: 'all 0.15s ease',
              }}
            >
              <span>🛍️</span>
              <span>Products & Stock</span>
              {Boolean(metrics?.lowStockProducts) && (
                <span style={{ background: '#ef4444', color: '#ffffff', borderRadius: '999px', fontSize: '0.74rem', padding: '0.1rem 0.5rem', fontWeight: 800 }}>
                  {metrics?.lowStockProducts}
                </span>
              )}
            </button>

            {/* Hub 4: Bank Passbook */}
            <button
              type="button"
              onClick={() => setView('passbook')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.6rem 1.15rem',
                borderRadius: '8px',
                border: 'none',
                fontWeight: view === 'passbook' ? 800 : 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
                background: view === 'passbook' ? '#4A0E4E' : 'transparent',
                color: view === 'passbook' ? '#ffffff' : '#475569',
                transition: 'all 0.15s ease',
              }}
            >
              <span>💰</span>
              <span>Bank Passbook & Earnings</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setView('profile')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.5rem 0.95rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: view === 'profile' ? '#f1f5f9' : '#ffffff',
              color: '#334155',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            <span>⚙️</span>
            <span>Store Profile</span>
          </button>
        </div>
      </nav>

      {/* 3. Main Workspace Container */}
      <main style={{ width: '100%', maxWidth: '1440px', margin: '1.75rem auto', padding: '0 2rem', display: 'grid', gap: '1.75rem', flex: 1 }}>
        {orderActionMessage && <Notice tone="success">{orderActionMessage}</Notice>}
        {orderActionError && <Notice tone="error">{orderActionError}</Notice>}

        {/* WORKSPACE 1: OVERVIEW DASHBOARD */}
        {view === 'overview' && (
          <div style={{ display: 'grid', gap: '1.75rem' }}>
            {/* Draft notice banner if exists */}
            {savedDraft && (savedDraft.name || savedDraft.price) && (
              <div
                style={{
                  background: '#fef3c7',
                  border: '1.5px solid #f59e0b',
                  borderRadius: '12px',
                  padding: '1rem 1.35rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.85rem',
                }}
              >
                <div>
                  <strong style={{ color: '#92400e', fontSize: '0.92rem' }}>
                    📝 Unsaved draft found on this device: {savedDraft.name || 'Untitled product'} (₹{savedDraft.price || '0'})
                  </strong>
                  <div style={{ fontSize: '0.8rem', color: '#b45309', marginTop: '0.15rem' }}>
                    You have an unsubmitted product draft saved locally on this browser.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.55rem' }}>
                  <button
                    type="button"
                    onClick={() => setView('new_product')}
                    className="seller-primary-action"
                    style={{ background: '#d97706', color: '#ffffff', fontSize: '0.84rem', padding: '0.4rem 0.85rem' }}
                  >
                    Continue Editing Draft
                  </button>
                  <button
                    type="button"
                    onClick={discardDraft}
                    className="seller-secondary-action"
                    style={{ fontSize: '0.84rem', padding: '0.4rem 0.85rem' }}
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}

            {/* 5 KPI Metric Cards */}
            <section
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '1.15rem',
              }}
            >
              <div
                onClick={() => setOrderView('new')}
                style={{
                  background: '#ffffff',
                  padding: '1.35rem',
                  borderRadius: '14px',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 2px 10px rgba(15, 23, 42, 0.04)',
                  cursor: 'pointer',
                  transition: 'box-shadow 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#64748b' }}>New Orders</span>
                  <span style={{ fontSize: '1.3rem' }}>🔔</span>
                </div>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: '#d97706', marginTop: '0.4rem' }}>
                  {metrics?.newOrders ?? 0}
                </div>
                <small style={{ color: '#94a3b8', fontSize: '0.76rem' }}>Click to review & accept</small>
              </div>

              <div
                onClick={() => setOrderView('processing')}
                style={{
                  background: '#ffffff',
                  padding: '1.35rem',
                  borderRadius: '14px',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 2px 10px rgba(15, 23, 42, 0.04)',
                  cursor: 'pointer',
                  transition: 'box-shadow 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#64748b' }}>Orders to Prepare</span>
                  <span style={{ fontSize: '1.3rem' }}>📦</span>
                </div>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: '#2563eb', marginTop: '0.4rem' }}>
                  {metrics?.ordersToPrepare ?? 0}
                </div>
                <small style={{ color: '#94a3b8', fontSize: '0.76rem' }}>Pack and mark ready</small>
              </div>

              <div
                onClick={() => setView('products')}
                style={{
                  background: '#ffffff',
                  padding: '1.35rem',
                  borderRadius: '14px',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 2px 10px rgba(15, 23, 42, 0.04)',
                  cursor: 'pointer',
                  transition: 'box-shadow 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#64748b' }}>Active Products</span>
                  <span style={{ fontSize: '1.3rem' }}>🛍️</span>
                </div>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: '#15803d', marginTop: '0.4rem' }}>
                  {metrics?.activeProducts ?? 0}
                </div>
                <small style={{ color: '#94a3b8', fontSize: '0.76rem' }}>Published in marketplace</small>
              </div>

              <div
                onClick={() => {
                  setProductStockStatus('low_stock');
                  setView('products');
                }}
                style={{
                  background: '#ffffff',
                  padding: '1.35rem',
                  borderRadius: '14px',
                  border: Boolean(metrics?.lowStockProducts) ? '1.5px solid #f87171' : '1px solid #e2e8f0',
                  boxShadow: '0 2px 10px rgba(15, 23, 42, 0.04)',
                  cursor: 'pointer',
                  transition: 'box-shadow 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#64748b' }}>Low Stock Items</span>
                  <span style={{ fontSize: '1.3rem' }}>⚠️</span>
                </div>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: Boolean(metrics?.lowStockProducts) ? '#dc2626' : '#64748b', marginTop: '0.4rem' }}>
                  {metrics?.lowStockProducts ?? 0}
                </div>
                <small style={{ color: '#94a3b8', fontSize: '0.76rem' }}>1-Tap restock available</small>
              </div>

              <div
                onClick={() => setView('passbook')}
                style={{
                  background: 'linear-gradient(135deg, #fdf4ff 0%, #fae8ff 100%)',
                  padding: '1.35rem',
                  borderRadius: '14px',
                  border: '1.5px solid #f0abfc',
                  boxShadow: '0 2px 10px rgba(112, 26, 117, 0.06)',
                  cursor: 'pointer',
                  transition: 'box-shadow 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#701a75' }}>Monthly Sales</span>
                  <span style={{ fontSize: '1.3rem' }}>₹</span>
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#701a75', marginTop: '0.4rem' }}>
                  {metrics ? formatMoney(metrics.grossPaidProductSalesThisMonthPaise) : '₹0'}
                </div>
                <small style={{ color: '#86198f', fontSize: '0.76rem' }}>Direct DBT to bank account →</small>
              </div>
            </section>

            {/* Overview Detail Grid: Recent Orders & Sales Trend */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.75rem' }}>
              {/* Recent Orders Overview */}
              <section style={{ background: '#ffffff', borderRadius: '16px', padding: '1.75rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(15, 23, 42, 0.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#0f172a' }}>Recent Orders</h3>
                    <div style={{ fontSize: '0.82rem', color: '#64748b' }}>1-Tap accept and mark ready for Damoh pickup fleet</div>
                  </div>
                  <button type="button" onClick={() => setView('orders')} className="seller-secondary-action" style={{ fontSize: '0.84rem' }}>
                    View All Orders →
                  </button>
                </div>
                {dashboard.loading && !data ? (
                  <SellerOrderSkeleton count={2} />
                ) : (
                  orderRows(data?.recentOrders ?? [])
                )}
              </section>

              {/* Sales Trend Chart */}
              <section style={{ background: '#ffffff', borderRadius: '16px', padding: '1.75rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(15, 23, 42, 0.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#0f172a' }}>Sales Trend</h3>
                    <div style={{ fontSize: '0.82rem', color: '#64748b' }}>Confirmed paid product sales over the last 6 months</div>
                  </div>
                  <span style={{ fontWeight: 800, color: '#4A0E4E', fontSize: '0.92rem' }}>
                    {metrics ? formatMoney(metrics.grossPaidProductSalesThisMonthPaise) : '₹0'} <small>this month</small>
                  </span>
                </div>
                {data ? <SellerSalesTrendChart rows={data.salesTrend} /> : <Loading label="Loading sales chart…" />}
              </section>
            </div>
          </div>
        )}

        {/* WORKSPACE 2: ORDERS & FULFILMENT */}
        {view === 'orders' && (
          <section style={{ background: '#ffffff', borderRadius: '16px', padding: '1.75rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(15, 23, 42, 0.03)', display: 'grid', gap: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#0f172a' }}>Orders & Fulfilment</h2>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.86rem', color: '#64748b' }}>
                  Accept incoming orders, pack them, and tap "Ready for Pickup" to alert the nearest Damoh delivery partner.
                </p>
              </div>
            </div>

            {/* Filter Tabs */}
            <div style={{ display: 'flex', gap: '0.55rem', overflowX: 'auto', paddingBottom: '0.35rem' }}>
              {orderTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setOrderStatus(tab.key);
                    setOrderPage(1);
                  }}
                  style={{
                    padding: '0.5rem 1.05rem',
                    borderRadius: '8px',
                    border: orderStatus === tab.key ? '1.5px solid #4A0E4E' : '1px solid #cbd5e1',
                    background: orderStatus === tab.key ? '#4A0E4E' : '#ffffff',
                    color: orderStatus === tab.key ? '#ffffff' : '#475569',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {orders.loading ? <SellerOrderSkeleton count={3} /> : orders.error ? <Notice tone="error">{orders.error}</Notice> : orderRows(visibleOrders)}

            {orders.data && orders.data.pagination.totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1.25rem', borderTop: '1px solid #e2e8f0' }}>
                <button
                  type="button"
                  className="seller-secondary-action"
                  disabled={orderPage <= 1}
                  onClick={() => setOrderPage((p) => p - 1)}
                >
                  ← Previous
                </button>
                <span style={{ fontSize: '0.86rem', color: '#64748b' }}>
                  Page {orderPage} of {orders.data.pagination.totalPages} ({orders.data.pagination.total} orders)
                </span>
                <button
                  type="button"
                  className="seller-secondary-action"
                  disabled={orderPage >= orders.data.pagination.totalPages}
                  onClick={() => setOrderPage((p) => p + 1)}
                >
                  Next →
                </button>
              </div>
            )}
          </section>
        )}

        {/* WORKSPACE 3: PRODUCTS & QUICK STOCK */}
        {view === 'products' && (
          <section style={{ background: '#ffffff', borderRadius: '16px', padding: '1.75rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(15, 23, 42, 0.03)', display: 'grid', gap: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.85rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#0f172a' }}>Products & Quick Stock</h2>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.86rem', color: '#64748b' }}>
                  Manage items, check approval review states, and update inventory with 1-tap steppers.
                </p>
              </div>
              <button
                type="button"
                className="seller-primary-action"
                onClick={() => setView('new_product')}
                style={{ background: '#4A0E4E', color: '#ffffff', fontWeight: 800, padding: '0.65rem 1.35rem' }}
              >
                ＋ Add New Product
              </button>
            </div>

            {/* Filter Tools */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0.85rem', background: '#f8fafc', padding: '1.15rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <label className="field" style={{ margin: 0 }}>
                <span>Search Products</span>
                <input
                  type="search"
                  value={productSearch}
                  onChange={(e) => {
                    setProductPage(1);
                    setProductSearch(e.target.value);
                  }}
                  placeholder="Search by craft name..."
                />
              </label>

              <label className="field" style={{ margin: 0 }}>
                <span>Review Status</span>
                <select
                  value={productApprovalStatus}
                  onChange={(e) => {
                    setProductPage(1);
                    setProductApprovalStatus(e.target.value);
                  }}
                >
                  <option value="">All Statuses</option>
                  <option value="pending">Awaiting Review</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Changes Requested</option>
                </select>
              </label>

              <label className="field" style={{ margin: 0 }}>
                <span>Stock Filter</span>
                <select
                  value={productStockStatus}
                  onChange={(e) => {
                    setProductPage(1);
                    setProductStockStatus(e.target.value);
                  }}
                >
                  <option value="all">All Stock Levels</option>
                  <option value="low_stock">Low Stock</option>
                  <option value="out_of_stock">Out of Stock</option>
                  <option value="in_stock">In Stock</option>
                </select>
              </label>
            </div>

            {products.loading ? (
              <Loading label="Loading products…" />
            ) : products.error ? (
              <Notice tone="error">{products.error}</Notice>
            ) : products.data?.data.length ? (
              <div style={{ display: 'grid', gap: '1.15rem' }}>
                {products.data.data.map((product: Product) => {
                  const stock = product.variants.length
                    ? product.variants.reduce((sum: number, v: Variant) => sum + v.stock, 0)
                    : product.stock;
                  const isHistoryOpen = historyProductId === product._id;

                  return (
                    <div
                      key={product._id}
                      style={{
                        padding: '1.35rem',
                        borderRadius: '14px',
                        border: '1.5px solid #e2e8f0',
                        background: '#ffffff',
                        display: 'grid',
                        gap: '0.95rem',
                        boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.85rem' }}>
                        <div style={{ display: 'flex', gap: '1.15rem', alignItems: 'center' }}>
                          <div
                            style={{
                              width: '68px',
                              height: '68px',
                              borderRadius: '10px',
                              overflow: 'hidden',
                              background: '#f1f5f9',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              border: '1px solid #e2e8f0',
                              flexShrink: 0,
                            }}
                          >
                            {product.imageUrls[0] ? (
                              <img
                                src={resolveProductImageUrl(product.imageUrls[0])}
                                alt=""
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            ) : (
                              <span style={{ fontSize: '1.5rem' }}>✿</span>
                            )}
                          </div>
                          <div>
                            <h4 style={{ margin: 0, fontSize: '1.1rem', color: '#0f172a' }}>{product.name}</h4>
                            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                              {product.categoryName} · {product.subcategoryName}
                            </div>
                            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#4A0E4E', marginTop: '0.2rem' }}>
                              {formatMoney(product.pricePaise)}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <span
                            style={{
                              fontSize: '0.78rem',
                              fontWeight: 700,
                              padding: '0.28rem 0.75rem',
                              borderRadius: '999px',
                              background: product.approvalStatus === 'approved' ? '#dcfce7' : product.approvalStatus === 'pending' ? '#fef3c7' : '#fee2e2',
                              color: product.approvalStatus === 'approved' ? '#166534' : product.approvalStatus === 'pending' ? '#92400e' : '#991b1b',
                            }}
                          >
                            {product.approvalStatus === 'approved' ? '✓ Approved' : product.approvalStatus === 'pending' ? '◷ Under Review' : 'Changes Requested'}
                          </span>

                          <button
                            type="button"
                            className="seller-secondary-action"
                            onClick={() => setHistoryProductId(isHistoryOpen ? '' : product._id)}
                            style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                          >
                            {isHistoryOpen ? 'Hide History ▲' : 'History ▼'}
                          </button>
                        </div>
                      </div>

                      {/* 1-Tap Quick Stock Stepper */}
                      <SellerStockStepper
                        productId={product._id}
                        variantId={product.variants[0]?._id}
                        productName={product.name}
                        currentStock={stock}
                        lowStockThreshold={product.lowStockThreshold}
                        onStockUpdated={() => {
                          void products.reload(false);
                          void dashboard.reload(false);
                        }}
                      />

                      {/* History Log Panel */}
                      {isHistoryOpen && <SellerInventoryHistoryPanel productId={product._id} />}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '3.5rem 1rem', background: '#f8fafc', borderRadius: '12px' }}>
                <span style={{ fontSize: '2.2rem', display: 'block' }}>◇</span>
                <strong style={{ fontSize: '1.1rem', color: '#0f172a' }}>No products found</strong>
                <p style={{ fontSize: '0.86rem', color: '#64748b' }}>
                  {productSearch || productApprovalStatus || productStockStatus !== 'all'
                    ? 'Try clearing your search or status filters.'
                    : 'Add your first handcrafted craft to start building your shop!'}
                </p>
                {!productSearch && (
                  <button
                    type="button"
                    className="seller-primary-action"
                    onClick={() => setView('new_product')}
                    style={{ marginTop: '0.75rem', background: '#4A0E4E', color: '#ffffff' }}
                  >
                    ＋ Add Your First Product
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {/* WORKSPACE 4: BANK EARNINGS & PASSBOOK */}
        {view === 'passbook' && (
          <SellerBankPassbook
            sellerRecord={sellerRecord}
            grossSalesMonthPaise={metrics?.grossPaidProductSalesThisMonthPaise ?? 0}
          />
        )}

        {/* WORKSPACE 5: STORE PROFILE */}
        {view === 'profile' && (
          <SellerProfileView
            profile={data?.storeProfile ?? null}
            onSaved={async () => {
              await Promise.all([dashboard.reload(false), api.getSellerProfile().then((res) => res.seller && setSellerRecord(res.seller))]);
            }}
          />
        )}

        {/* WORKSPACE 6: ADD PRODUCT */}
        {view === 'new_product' && (
          <SellerCatalogueListingPage
            onCancel={() => setView('products')}
            onSubmitted={() => {
              setView('products');
              void products.reload(false);
              void dashboard.reload(false);
            }}
            onDraftSaved={setSavedDraft}
          />
        )}
      </main>

      {/* Damoh City Admin Help Desk Modal */}
      <DamohCityAdminHelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
