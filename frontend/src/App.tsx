import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState } from 'react';
// Firebase Phone Auth removed in favor of direct OTP
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, api, onSessionRefresh, refreshSession, resolveProductImageUrl, setAccessToken } from './api';
import type { AuditLogEntry, CityAdminDeliveryPartner, CityAdminOrder, CityAdminProduct, Order, Product, ProductCategory, SellerDashboard, SellerInventoryAdjustment, SellerOrder, Settings, SuperAdminOrder, User } from './types';
import { autoRegisterPushNotifications, disableOrderPushNotifications, enableOrderPushNotifications, pushNotificationsConfigured } from './pushNotifications';
import type { ForegroundPushMessage } from './pushNotifications';
import { AddressBook } from './AddressBook';
import { CityAdminLiveFleetOverview, CityAdminLiveTracker } from './CityAdminLiveTracker';
import { SellerOrderCard, SellerOrderSkeleton } from './SellerOrderCard';
import {
  CityAdminDeliveryEscalationQueue,
  CityAdminDeliveryResolutionPanel,
  DeliveryFailureReportModal,
} from './DeliveryEscalationSystem';
import {
  CustomerReturnAndCancelPanel,
  CityAdminDisputeArbitrationPanel,
  SellerSettlementsLedgerPanel,
  DeliveryPartnerPaySlipPanel,
  SuperAdminRefundsAndSettlementsView,
} from './ReturnDisputeSystem';

type AuthContextValue = {
  user: User | null;
  ready: boolean;
  setSession: (user: User, token: string) => void;
  signOut: () => Promise<void>;
  reloadUser: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('Auth context is unavailable.');
  return context;
}

type CartLine = { product: Product; quantity: number; variantId?: string; unavailable?: boolean };
type CartContextValue = {
  lines: CartLine[];
  add: (product: Product, quantity?: number, variantId?: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  syncProduct: (key: string, product: Product | null, unavailable: boolean) => void;
};
const CartContext = createContext<CartContextValue | null>(null);

function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('Cart context is unavailable.');
  return context;
}

function productKey(line: Pick<CartLine, 'product' | 'variantId'>): string {
  return `${line.product._id ?? line.product.id}:${line.variantId ?? 'base'}`;
}

function isCartLine(value: unknown): value is CartLine {
  if (!value || typeof value !== 'object') return false;
  const line = value as Partial<CartLine>;
  const product = line.product;
  return typeof line.quantity === 'number'
    && Number.isInteger(line.quantity)
    && line.quantity > 0
    && Boolean(product)
    && typeof product?.slug === 'string'
    && typeof product.name === 'string'
    && typeof product.pricePaise === 'number';
}

function getBuyNowLine(state: unknown): CartLine | null {
  if (!state || typeof state !== 'object') return null;
  const buyNow = (state as { buyNow?: unknown }).buyNow;
  return isCartLine(buyNow) ? buyNow : null;
}

function formatMoney(paise?: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((paise ?? 0) / 100);
}

function normalizeIndianPhone(phone: string): string {
  const compact = phone.replace(/[\s()-]/g, '');
  return /^[6-9]\d{9}$/.test(compact) ? `+91${compact}` : compact;
}

function displayError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return error.message;
    const summary = `${error.message}${error.code ? ` (${error.code})` : ''}`;
    const details = Object.entries(error.fields ?? {})
      .flatMap(([field, messages]) => messages.map((message) => `${field}: ${message}`))
      .join('; ');
    return details ? `${summary}: ${details}` : summary;
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function getId(item: { _id?: string; id?: string }): string {
  return item._id ?? item.id ?? '';
}

function workspacePathForRole(role: User['role']): string {
  if (role === 'super_admin') return '/super-admin';
  if (role === 'city_admin') return '/city-admin';
  if (role === 'admin' || role === 'staff') return '/admin';
  if (role === 'delivery_partner') return '/delivery-partner';
  if (role === 'seller') return '/seller';
  return '/account';
}

const EMPTY_DEPENDENCIES: unknown[] = [];

function useLoad<T>(load: () => Promise<T>, dependencies: unknown[] = EMPTY_DEPENDENCIES): {
  data: T | null;
  error: string;
  loading: boolean;
  reload: (showLoading?: boolean) => Promise<void>;
  setData: (data: T) => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      setData(await load());
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      if (showLoading) setLoading(false);
    }
  // dependencies intentionally identify the request inputs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

function useRefreshOnFocus(reload: (showLoading?: boolean) => Promise<void>): void {
  useEffect(() => {
    const refresh = () => { void reload(false); };
    const timer = window.setInterval(refresh, 5_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [reload]);
}

function App(): ReactNode {
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('esakhi-theme') || 'system');
  const [lines, setLines] = useState<CartLine[]>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem('esakhi-cart') || '[]');
      return Array.isArray(stored) ? stored.filter(isCartLine) : [];
    } catch {
      return [];
    }
  });

  const reloadUser = useCallback(async () => {
    const me = await api.me();
    setUser(me);
    if (me?.id) {
      try { localStorage.setItem('esakhi.session.userId', me.id); } catch { /* ignore */ }
    }
  }, []);

  const setSession = useCallback((nextUser: User, token: string) => {
    setAccessToken(token);
    setUser(nextUser);
    if (nextUser?.id) {
      try { localStorage.setItem('esakhi.session.userId', nextUser.id); } catch { /* ignore */ }
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setAccessToken(null);
      setUser(null);
      try { localStorage.removeItem('esakhi.session.userId'); } catch { /* ignore */ }
    }
  }, []);

  const add = useCallback((product: Product, quantity = 1, variantId?: string) => {
    setLines((existing) => {
      const key = `${getId(product)}:${variantId ?? 'base'}`;
      const found = existing.find((line) => productKey(line) === key);
      if (!found) return [...existing, { product, quantity, variantId }];
      return existing.map((line) =>
        productKey(line) === key
          ? { ...line, quantity: Math.min(99, line.quantity + quantity) }
          : line
      );
    });
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setLines((existing) =>
      existing.map((line) =>
        productKey(line) === key ? { ...line, quantity } : line
      )
    );
  }, []);

  const remove = useCallback(
    (key: string) =>
      setLines((existing) => existing.filter((line) => productKey(line) !== key)),
    []
  );

  const clear = useCallback(() => setLines([]), []);

  const syncProduct = useCallback(
    (key: string, product: Product | null, unavailable: boolean) => {
      setLines((existing) => {
        let changed = false;

        const next = existing.map((line) => {
          if (productKey(line) !== key) return line;

          if (product) {
            if (line.product === product && !line.unavailable) return line;
            changed = true;
            return { ...line, product, unavailable: false };
          }

          if (!unavailable || line.unavailable) return line;

          changed = true;
          return { ...line, unavailable: true };
        });

        return changed ? next : existing;
      });
    },
    []
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('esakhi-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('esakhi-cart', JSON.stringify(lines));
  }, [lines]);

  useEffect(() => {
    let active = true;

    const syncCurrentSession = async () => {
      if (await refreshSession()) {
        try {
          const me = await api.me();
          if (active) {
            setUser(me);
            if (me?.id) {
              try { localStorage.setItem('esakhi.session.userId', me.id); } catch { /* ignore */ }
            }
          }
        } catch {
          setAccessToken(null);
          if (active) setUser(null);
        }
      } else if (active) {
        setUser(null);
      }
      if (active) setReady(true);
    };

    void syncCurrentSession();

    const unsubscribeRefresh = onSessionRefresh((refreshed) => {
      if (!active) return;
      if (!refreshed) {
        setUser(null);
        return;
      }
      void api.me().then((me) => {
        if (active) setUser(me);
      }).catch(() => {
        if (active) setUser(null);
      });
    });

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'esakhi.session.userId') {
        void syncCurrentSession();
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      active = false;
      unsubscribeRefresh();
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const [pushToast, setPushToast] = useState<ForegroundPushMessage | null>(null);
  const signedInUserId = user?.id;
  useEffect(() => {
    if (!signedInUserId) return;
    void autoRegisterPushNotifications(api.registerPushToken, setPushToast);
  }, [signedInUserId]);
  useEffect(() => {
    if (!pushToast) return;
    const timer = window.setTimeout(() => setPushToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [pushToast]);

  const authValue = useMemo(
    () => ({ user, ready, setSession, signOut, reloadUser }),
    [user, ready, setSession, signOut, reloadUser]
  );

  const cartValue = useMemo(
    () => ({ lines, add, setQuantity, remove, clear, syncProduct }),
    [lines, add, setQuantity, remove, clear, syncProduct]
  );
  const isDeliveryPortal = location.pathname.startsWith('/delivery-partner');
  const isSellerPortal = location.pathname.startsWith('/seller');

  // Keep the rest of your original App() code here, unchanged.
  return (
    <AuthContext.Provider value={authValue}>
      <CartContext.Provider value={cartValue}>
        <div className="app-shell">
          {pushToast && (
            <div role="status" aria-live="polite" onClick={() => setPushToast(null)} style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 10000, maxWidth: '340px', padding: '0.85rem 1rem', borderRadius: '12px', background: '#0f172a', color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.25)', cursor: 'pointer' }}>
              <strong style={{ display: 'block' }}>{pushToast.title}</strong>
              <span style={{ fontSize: '0.88rem' }}>{pushToast.body}</span>
            </div>
          )}
          {!location.pathname.startsWith('/super-admin') && !location.pathname.startsWith('/city-admin') && !isDeliveryPortal && !isSellerPortal && <Header theme={theme} setTheme={setTheme} />}
          <main id="main-content">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/shop" element={<ShopPage />} />
              <Route path="/products/:slug" element={<ProductPage />} />
              <Route path="/our-story" element={<StoryPage />} />
              <Route path="/service-area" element={<ServiceAreaPage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="/sign-in" element={<SignInPage />} />
              <Route path="/signin" element={<Navigate to="/sign-in" replace />} />
              <Route path="/cart" element={<CartPage />} />
              <Route path="/checkout" element={<CheckoutPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/account/profile" element={<AccountProfilePage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/orders/:id" element={<CustomerOrderPage />} />
              <Route path="/delivery-partner/apply" element={<DeliveryPartnerApplicationPage />} />
              <Route path="/delivery-partner" element={<DeliveryPartnerGate><DeliveryPartnerPage /></DeliveryPartnerGate>} />
              <Route path="/seller" element={<SellerGate><SellerPortalPage /></SellerGate>} />
              <Route path="/seller/apply" element={<SellerRegistrationPage />} />
              <Route path="/seller/products/new" element={<SellerGate><SellerPortalPage initialView="new_product" /></SellerGate>} />
              <Route path="/super-admin" element={<SuperAdminGate><SuperAdminOverviewPage /></SuperAdminGate>} />
              <Route path="/super-admin/cities" element={<SuperAdminGate><SuperAdminCitiesPage /></SuperAdminGate>} />
              <Route path="/super-admin/cities/:city" element={<SuperAdminGate><SuperAdminCityDetailPage /></SuperAdminGate>} />
              <Route path="/super-admin/city-administrators" element={<SuperAdminGate><SuperAdminCityAdministratorsPage /></SuperAdminGate>} />
              <Route path="/super-admin/city-administrators/:id" element={<SuperAdminGate><SuperAdminCityAdminDetailPage /></SuperAdminGate>} />
              <Route path="/super-admin/sellers" element={<SuperAdminGate><SuperAdminSellersPage /></SuperAdminGate>} />
              <Route path="/super-admin/sellers/:id" element={<SuperAdminGate><SuperAdminSellerDetailPage /></SuperAdminGate>} />
              <Route path="/super-admin/products" element={<SuperAdminGate><SuperAdminProductsPage /></SuperAdminGate>} />
              <Route path="/super-admin/products/:id" element={<SuperAdminGate><SuperAdminProductDetailPage /></SuperAdminGate>} />
              <Route path="/super-admin/orders" element={<SuperAdminGate><SuperAdminOrdersPage /></SuperAdminGate>} />
              <Route path="/super-admin/orders/:id" element={<SuperAdminGate><SuperAdminOrderDetailPage /></SuperAdminGate>} />
              <Route path="/super-admin/delivery-partners" element={<SuperAdminGate><SuperAdminDeliveryPartnersPage /></SuperAdminGate>} />
              <Route path="/super-admin/delivery-partners/:id" element={<SuperAdminGate><SuperAdminDeliveryPartnerDetailPage /></SuperAdminGate>} />
              <Route path="/super-admin/external-delivery-providers" element={<SuperAdminGate><SuperAdminExternalDeliveryProvidersPage /></SuperAdminGate>} />
              <Route path="/super-admin/customers" element={<SuperAdminGate><SuperAdminCustomersPage /></SuperAdminGate>} />
              <Route path="/super-admin/customers/:id" element={<SuperAdminGate><SuperAdminCustomerDetailPage /></SuperAdminGate>} />
              <Route path="/super-admin/support" element={<SuperAdminGate><SuperAdminSupportPage /></SuperAdminGate>} />
              <Route path="/super-admin/payments" element={<SuperAdminGate><SuperAdminPaymentsPage /></SuperAdminGate>} />
              <Route path="/super-admin/refunds" element={<SuperAdminGate><SuperAdminRefundsPage /></SuperAdminGate>} />
              <Route path="/super-admin/settlements" element={<SuperAdminGate><SuperAdminSettlementsPage /></SuperAdminGate>} />
              <Route path="/super-admin/payouts" element={<SuperAdminGate><SuperAdminPayoutsPage /></SuperAdminGate>} />
              <Route path="/super-admin/reports" element={<SuperAdminGate><SuperAdminReportsPage /></SuperAdminGate>} />
              <Route path="/super-admin/settings" element={<SuperAdminGate><SuperAdminSettingsPage /></SuperAdminGate>} />
              <Route path="/super-admin/roles" element={<SuperAdminGate><SuperAdminRolesPage /></SuperAdminGate>} />
              <Route path="/super-admin/security" element={<SuperAdminGate><SuperAdminSecurityPage /></SuperAdminGate>} />
              <Route path="/city-admin" element={<CityAdminGate><CityAdminDashboardPage /></CityAdminGate>} />
              <Route path="/city-admin/service-zones" element={<CityAdminGate><CityAdminServiceZonesPage /></CityAdminGate>} />
              <Route path="/city-admin/sellers" element={<CityAdminGate><CityAdminSellerApplicationsPage /></CityAdminGate>} />
              <Route path="/city-admin/products" element={<CityAdminGate><CityAdminProductReviewPage /></CityAdminGate>} />
              <Route path="/city-admin/orders" element={<CityAdminGate><CityAdminOrdersPage /></CityAdminGate>} />
              <Route path="/city-admin/orders/:id" element={<CityAdminGate><CityAdminOrderDetailPage /></CityAdminGate>} />
              <Route path="/city-admin/delivery-partners" element={<CityAdminGate><CityAdminDeliveryPartnersPage /></CityAdminGate>} />
              <Route path="/admin" element={<AdminGate><AdminDashboardPage /></AdminGate>} />
              <Route path="/admin/products" element={<AdminGate><AdminProductsPage /></AdminGate>} />
              <Route path="/admin/inventory" element={<AdminGate adminOnly><AdminInventoryPage /></AdminGate>} />
              <Route path="/admin/orders" element={<AdminGate><AdminOrdersPage /></AdminGate>} />
              <Route path="/admin/orders/:id" element={<AdminGate><AdminOrderPage /></AdminGate>} />
              <Route path="/admin/delivery-partners" element={<AdminGate adminOnly><AdminDeliveryPartnersPage /></AdminGate>} />
              <Route path="/admin/delivery-partners/:id" element={<AdminGate adminOnly><AdminDeliveryPartnerPage /></AdminGate>} />
              <Route path="/admin/customers" element={<AdminGate adminOnly><AdminCustomersPage /></AdminGate>} />
              <Route path="/admin/customers/:id" element={<AdminGate adminOnly><AdminCustomerPage /></AdminGate>} />
              <Route path="/admin/settings" element={<AdminGate adminOnly><AdminSettingsPage /></AdminGate>} />
              <Route path="/admin/system" element={<AdminGate><SystemPage /></AdminGate>} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </main>
          {!location.pathname.startsWith('/super-admin') && !isDeliveryPortal && !isSellerPortal && <Footer />}
        </div>
      </CartContext.Provider>
    </AuthContext.Provider>
  );
}

function Header({ theme, setTheme }: { theme: string; setTheme: (value: string) => void }): ReactNode {
  const { user, signOut } = useAuth();
  const { lines } = useCart();
  const navigate = useNavigate();
  const location = useLocation();
  const count = lines.reduce((total, line) => total + line.quantity, 0);
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link to="/" className="brand" aria-label="eSakhi home">
          <img src="/images/maitri-sisterhood-logo.png" alt="eSakhi — Handmade by women, made for you" />
        </Link>
        <nav className="main-nav" aria-label="Main navigation">
          <NavLink to="/shop">Shop</NavLink>
          <NavLink to="/our-story">Our story</NavLink>
          {user && user.role !== 'seller' && <NavLink to="/orders">My orders</NavLink>}
          {user?.role === 'seller' && <NavLink to="/seller">Seller dashboard</NavLink>}
          {user?.role === 'city_admin' && <NavLink to="/city-admin">City Admin</NavLink>}
          {user && (user.role === 'admin' || user.role === 'staff') && <NavLink to="/admin">Workspace</NavLink>}
          {user?.role === 'super_admin' && <NavLink to="/super-admin">Super Admin</NavLink>}
          {user?.role === 'delivery_partner' && <NavLink to="/delivery-partner">Delivery portal</NavLink>}
        </nav>
        <div className="header-actions">
          <label className="theme-select">
            <span className="sr-only">Color theme</span>
            <select aria-label="Color theme" value={theme} onChange={(event) => setTheme(event.target.value)}>
              <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
            </select>
          </label>
          <Link className="icon-link" to="/cart" aria-label={`Cart, ${count} items`}><span aria-hidden="true">Bag</span><b>{count}</b></Link>
          {user ? (
            <div className="account-actions">
              <Link className="account-link" to="/account">{user.name || user.phone || 'Account'}</Link>
              <button className="text-button" onClick={() => void signOut().then(() => navigate('/'))}>Sign out</button>
            </div>
          ) : <Link className="button button-small button-outline" to="/sign-in" state={{ from: location.pathname }}>Sign in</Link>}
        </div>
      </div>
    </header>
  );
}

function Footer(): ReactNode {
  const { data, loading } = useLoad(() => api.health());
  return (
    <footer className="site-footer">
      <div className="footer-main">
        <Link to="/" className="footer-brand"><img src="/images/maitri-sisterhood-logo.png" alt="" /><span>Handmade with love.<br />Empowered by you.</span></Link>
        <div><strong>Explore</strong><Link to="/shop">Shop handmade</Link><Link to="/our-story">Our story</Link><Link to="/service-area">Service area</Link><Link to="/help">Help & policies</Link><Link to="/cart">Your bag</Link></div>
        <div><strong>Your account</strong><Link to="/account">Profile</Link><Link to="/orders">Order history</Link><Link to="/sign-in">Sign in</Link></div>
      </div>
      <div className="footer-bottom"><span>eSakhi · Made together, with care.</span><span className={`api-status ${loading ? '' : data ? 'online' : 'offline'}`}><i />{loading ? 'Checking store connection' : data ? 'Store API online' : 'Store connection issue'}</span></div>
    </footer>
  );
}

function PageIntro({ eyebrow, title, description, children }: { eyebrow?: string; title: string; description?: string; children?: ReactNode }): ReactNode {
  return <div className="page-intro"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{children}</div>;
}

function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'success' }): ReactNode {
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

function Loading({ label = 'Loading…' }: { label?: string }): ReactNode {
  return <div className="loading-state" role="status"><span className="spinner" />{label}</div>;
}

function EmptyState({ title, children }: { title: string; children?: ReactNode }): ReactNode {
  return <div className="empty-state"><span className="empty-mark" aria-hidden="true">✿</span><h3>{title}</h3>{children}</div>;
}

function ProductCard({ product }: { product: Product }): ReactNode {
  const { add } = useCart();
  const navigate = useNavigate();
  const image = product.imageUrls?.[0] ? resolveProductImageUrl(product.imageUrls[0]) : undefined;
  const stock = product.variants?.length
    ? product.variants.reduce((total, variant) => total + variant.stock, 0)
    : product.stock;
  const available = stock > 0;
  return (
    <article className="product-card">
      <Link to={`/products/${encodeURIComponent(product.slug)}`} className="product-image">
        {image ? <img src={image} alt={product.name} loading="lazy" /> : <div className="image-placeholder" aria-label="No product image available"><img src="/images/maitri-sisterhood-logo.png" alt="" /></div>}
        {!available && <span className="image-badge">Out of stock</span>}
      </Link>
      <div className="product-card-body">
        <div className="product-category">{product.categoryName} · {product.subcategoryName}</div>
        <Link to={`/products/${encodeURIComponent(product.slug)}`} className="product-name">{product.name}</Link>
        <p className="product-seller">{product.sellerName || 'Seller details unavailable'}</p>
        <div className="product-availability"><span className={available ? 'stock-indicator' : 'stock-indicator unavailable'}>{available ? 'In stock' : 'Out of stock'}</span></div>
        <div className="product-card-bottom"><strong>{formatMoney(product.pricePaise)}</strong><button className="add-button" disabled={!available} onClick={() => {
          if (product.variants.length) navigate(`/products/${encodeURIComponent(product.slug)}`);
          else { add(product); navigate('/cart'); }
        }} aria-label={product.variants.length ? `Choose options for ${product.name}` : `Add ${product.name} to bag`}>{product.variants.length ? 'View options' : 'Add +'}</button></div>
      </div>
    </article>
  );
}

function ProductGrid({ products, loading, error, reload, emptyTitle = 'No pieces to show just yet' }: { products: Product[]; loading: boolean; error: string; reload?: () => void; emptyTitle?: string }): ReactNode {
  if (loading) return <Loading label="Finding pieces made with care…" />;
  if (error) return <div className="section-state"><Notice tone="error">{error}</Notice>{reload && <button className="button button-outline" onClick={() => void reload()}>Try again</button>}</div>;
  if (!products.length) return <EmptyState title={emptyTitle}>Please check back soon as the catalogue is updated.</EmptyState>;
  return <div className="product-grid">{products.map((product) => <ProductCard key={getId(product) || product.slug} product={product} />)}</div>;
}

function HeroCarousel({ products }: { products: Product[] }): ReactNode {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const activeProduct = products[activeIndex];
  const image = activeProduct?.imageUrls?.[0];

  useEffect(() => {
    setActiveIndex(0);
  }, [products]);

  useEffect(() => {
    if (products.length < 2 || paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % products.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [paused, products.length]);

  const showProduct = (index: number) => setActiveIndex((index + products.length) % products.length);

  return (
    <div
      className="hero-carousel"
      aria-label="Customer favourite products"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <Link
        to={activeProduct ? `/products/${encodeURIComponent(activeProduct.slug)}` : '/shop'}
        className="hero-photo"
        aria-label={activeProduct ? `View ${activeProduct.name}` : 'Browse handmade products'}
      >
        {image
          ? <img src={resolveProductImageUrl(image)} alt={activeProduct.name} />
          : <img src="/images/maitri-sisterhood-logo.png" alt="eSakhi emblem representing women creating together" />}
      </Link>
      {products.length > 1 && (
        <div className="hero-carousel-controls" aria-label="Featured product slides">
          <button className="hero-carousel-arrow" onClick={() => showProduct(activeIndex - 1)} aria-label="Previous product">‹</button>
          <div className="hero-carousel-dots">
            {products.map((product, index) => (
              <button
                key={getId(product) || product.slug}
                className={`hero-carousel-dot${index === activeIndex ? ' active' : ''}`}
                onClick={() => showProduct(index)}
                aria-label={`Show ${product.name}`}
                aria-current={index === activeIndex ? 'true' : undefined}
              />
            ))}
          </div>
          <button className="hero-carousel-arrow" onClick={() => showProduct(activeIndex + 1)} aria-label="Next product">›</button>
        </div>
      )}
      <div className="hero-stamp"><img src="/images/maitri-sisterhood-logo.png" alt="" /><span>Made<br />together</span></div>
      <div className="hero-note">
        <span className="note-flower" aria-hidden="true">✿</span>
        <span>
          {activeProduct
            ? <><span className="hero-product-category">Customer favourite · {activeProduct.categoryName}</span><strong>{activeProduct.name}</strong><span>{formatMoney(activeProduct.pricePaise)}</span></>
            : <>Thoughtful craft.<br />A community of makers.</>}
        </span>
      </div>
    </div>
  );
}

function HomePage(): ReactNode {
  const products = useLoad(() => api.bestSellingProducts(8));
  const service = useLoad(() => api.serviceArea());
  const categories = useLoad(() => api.categories());
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><span className="eyebrow-dot" /> A story made by many hands</span>
          <h1>From her hands<br />to your <em>heart.</em></h1>
          <p>Every handmade piece carries a story of courage, creativity, and women building a brighter future together.</p>
          <div className="hero-actions"><Link to="/shop" className="button">Discover handmade <span aria-hidden="true">↗</span></Link><Link to="/our-story" className="quiet-link">Meet the makers <span aria-hidden="true">→</span></Link></div>
          <div className="hero-caption"><span className="caption-rule" /> Handmade by women, made for you</div>
          <div className="hero-join-links"><span>Be part of eSakhi</span><Link to="/seller/apply">Become a seller</Link><Link to="/delivery-partner/apply">Join as a delivery partner</Link></div>
        </div>
        <div className="hero-art">
          <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
          <HeroCarousel products={products.data ?? []} />
        </div>
      </section>
      <section className="section section-categories">
        <div className="section-heading"><div><span className="eyebrow">Find your favorite</span><h2>Made to be <em>treasured.</em></h2></div><Link to="/shop" className="quiet-link">Explore everything →</Link></div>
        {categories.error && <div className="section-state"><Notice tone="error">{categories.error}</Notice><button className="button button-outline" onClick={() => void categories.reload()}>Retry categories</button></div>}
        <div className="category-grid">
          {(categories.data ?? []).map((category, index) => <CategoryCard key={category.categoryId} category={category} index={index} />)}
          {!categories.loading && !categories.error && categories.data?.length === 0 && <EmptyState title="Categories are not available right now" />}
          {categories.loading && <Loading label="Loading categories…" />}
        </div>
      </section>
      <section className="section section-products">
        <div className="section-heading"><div><span className="eyebrow">Selected with care</span><h2>Pieces with a <em>purpose.</em></h2></div><Link to="/shop" className="quiet-link">Shop all pieces →</Link></div>
        <ProductGrid products={(products.data ?? []).slice(0, 4)} loading={products.loading} error={products.error} reload={products.reload} />
      </section>
      <section className="story-band">
        <div className="story-band-mark"><img src="/images/maitri-sisterhood-logo.png" alt="" /></div>
        <div><span className="eyebrow">More than a purchase</span><h2>Every order helps<br />a story <em>continue.</em></h2><p>When you choose eSakhi, you celebrate skill, support a community, and help handmade traditions find a place in modern homes.</p><Link to="/our-story" className="button button-light">Read our story <span>→</span></Link></div>
        <div className="story-band-side"><span>01</span><span>Skill</span><span>02</span><span>Community</span><span>03</span><span>Independence</span></div>
      </section>
      <section className="service-strip">
        <span className="service-icon" aria-hidden="true">⌖</span>
        <div><strong>{service.data?.configured ? `Serving ${service.data.city ?? 'your community'}` : 'Local, thoughtful fulfilment'}</strong><span>{service.data?.configured ? 'See service and payment options at checkout.' : 'Service area and ordering options are being configured.'}</span></div>
        {service.error && <span className="service-error" title={service.error}>Service details unavailable</span>}
      </section>
    </>
  );
}

function CategoryCard({ category, index }: { category: ProductCategory; index: number }): ReactNode {
  const categoryIcons: Record<string, string> = {
    home: '⌂',
    women: '✿',
    men: '◈',
    care: '✧',
    food: '❋',
    kids: '☆',
  };
  return <Link className={`category-tile category-${index % 6}`} to={`/shop?categoryId=${encodeURIComponent(category.categoryId)}`}>
    <span className="category-icon" aria-hidden="true">{categoryIcons[category.icon] ?? '✿'}</span>
    <span className="category-number">{String(index + 1).padStart(2, '0')}</span>
    <span>{category.categoryName}</span>
    <small>{category.subcategories.length} collections</small>
    <b aria-hidden="true">↗</b>
  </Link>;
}

function ShopPage(): ReactNode {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') || '1');
  const [search, setSearch] = useState(params.get('q') || '');
  const categoryId = params.get('categoryId') || '';
  const subcategoryId = params.get('subcategoryId') || '';
  const sort = params.get('sort') || 'newest';
  const categories = useLoad(() => api.categories());
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (categoryId) query.set('categoryId', categoryId);
  if (subcategoryId) query.set('subcategoryId', subcategoryId);
  if (search.trim()) query.set('q', search.trim());
  if (sort) query.set('sort', sort);
  const result = useLoad(() => api.products(query), [page, categoryId, subcategoryId, search, sort]);
  const selectedCategory = categories.data?.find((category) => category.categoryId === categoryId);
  const selectedSubcategory = selectedCategory?.subcategories.find((subcategory) => subcategory.subcategoryId === subcategoryId);
  const updateFilters = (updates: { categoryId?: string; subcategoryId?: string; sort?: string; q?: string }) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (updates.categoryId !== undefined) {
        if (updates.categoryId) next.set('categoryId', updates.categoryId); else next.delete('categoryId');
        next.delete('subcategoryId');
      }
      if (updates.subcategoryId !== undefined) {
        if (updates.subcategoryId) next.set('subcategoryId', updates.subcategoryId); else next.delete('subcategoryId');
      }
      if (updates.sort !== undefined) {
        if (updates.sort) next.set('sort', updates.sort); else next.delete('sort');
      }
      if (updates.q !== undefined) {
        if (updates.q.trim()) next.set('q', updates.q.trim()); else next.delete('q');
      }
      next.delete('page');
      return next;
    });
  };
  return (
    <div className="page-container">
      <PageIntro eyebrow="The eSakhi collection" title="Made by hand. Chosen by you." description="Explore pieces shaped by patience, skill, and a community of women makers." />
      {categories.error && <div className="section-state"><Notice tone="error">{categories.error}</Notice><button className="button button-outline" onClick={() => void categories.reload()}>Retry categories</button></div>}
      {!categoryId && categories.data && <section className="shop-category-section" aria-label="Browse marketplace categories">
        <div className="section-heading"><div><span className="eyebrow">Explore the marketplace</span><h2>Shop by category</h2></div></div>
        <div className="category-grid">{categories.data.map((category, index) => <CategoryCard key={category.categoryId} category={category} index={index} />)}</div>
      </section>}
      <nav className="breadcrumbs shop-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/shop">Shop</Link>
        {selectedCategory && <><span>/</span><Link to={`/shop?categoryId=${encodeURIComponent(selectedCategory.categoryId)}`}>{selectedCategory.categoryName}</Link></>}
        {selectedSubcategory && <><span>/</span><span>{selectedSubcategory.subcategoryName}</span></>}
      </nav>
      <div className="shop-toolbar">
        <label className="field shop-filter"><span>Main category</span><select value={categoryId} onChange={(event) => updateFilters({ categoryId: event.target.value })}><option value="">All categories</option>{(categories.data ?? []).map((category) => <option key={category.categoryId} value={category.categoryId}>{category.categoryName}</option>)}</select></label>
        <label className="field shop-filter"><span>Subcategory</span><select value={subcategoryId} disabled={!selectedCategory} onChange={(event) => updateFilters({ subcategoryId: event.target.value })}><option value="">All subcategories</option>{(selectedCategory?.subcategories ?? []).map((subcategory) => <option key={subcategory.subcategoryId} value={subcategory.subcategoryId}>{subcategory.subcategoryName}</option>)}</select></label>
        <label className="field shop-filter"><span>Sort by</span><select value={sort} onChange={(event) => updateFilters({ sort: event.target.value })}><option value="newest">Newest listings</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option></select></label>
        <label className="search-field shop-search"><span className="sr-only">Search products by name</span><input value={search} onChange={(event) => { setSearch(event.target.value); updateFilters({ q: event.target.value }); }} placeholder="Search products by name" /><span aria-hidden="true">⌕</span></label>
      </div>
      <ProductGrid products={result.data?.data ?? []} loading={result.loading} error={result.error} reload={result.reload} emptyTitle={selectedSubcategory ? `No approved products in ${selectedSubcategory.subcategoryName}` : selectedCategory ? `No approved products in ${selectedCategory.categoryName}` : 'No approved products yet'} />
      {result.data?.pagination && result.data.pagination.totalPages > 1 && <Pagination page={result.data.pagination.page} pages={result.data.pagination.totalPages} onChange={(next) => setParams((previous) => { const params = new URLSearchParams(previous); params.set('page', String(next)); return params; })} />}
    </div>
  );
}

function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange: (page: number) => void }): ReactNode {
  return <div className="pagination"><button type="button" className="button button-outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button type="button" className="button button-outline" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button></div>;
}

function ProductPage(): ReactNode {
  const { slug = '' } = useParams();
  const product = useLoad(() => api.product(slug), [slug]);
  const { add } = useCart();
  const navigate = useNavigate();
  const [quantity, setQuantity] = useState(1);
  const [variantId, setVariantId] = useState('');
  const item = product.data;
  const variant = item?.variants.find((option) => option._id === variantId);
  const stock = variant?.stock ?? (item?.variants.length
    ? item.variants.reduce((total, option) => total + option.stock, 0)
    : item?.stock ?? 0);
  if (product.loading) return <div className="page-container"><Loading /></div>;
  if (product.error || !item) return <div className="page-container"><Notice tone="error">{product.error || 'Product not found.'}</Notice><Link to="/shop" className="button button-outline">Back to shop</Link></div>;
  return (
    <div className="page-container product-detail">
      <div className="breadcrumbs"><Link to="/shop">Shop</Link><span>/</span><Link to={`/shop?categoryId=${encodeURIComponent(item.categoryId)}`}>{item.categoryName}</Link><span>/</span><Link to={`/shop?categoryId=${encodeURIComponent(item.categoryId)}&subcategoryId=${encodeURIComponent(item.subcategoryId)}`}>{item.subcategoryName}</Link></div>
      <div className="detail-grid">
        <div className="detail-gallery">{item.imageUrls.length ? item.imageUrls.map((image, index) => <img key={image} src={resolveProductImageUrl(image)} alt={`${item.name}, view ${index + 1}`} />) : <div className="detail-placeholder"><img src="/images/maitri-sisterhood-logo.png" alt="" /><span>Product image coming soon</span></div>}</div>
        <div className="detail-copy"><span className="eyebrow">{item.categoryName} · {item.subcategoryName}</span><h1>{item.name}</h1><p className="detail-price">{formatMoney(item.pricePaise)}</p><p className="detail-description">{item.description}</p>
          <p className="detail-seller">Seller / SHG: <strong>{item.sellerName || 'Seller details unavailable'}</strong></p>
          {item.variants.length > 0 && <label className="field"><span>Choose an option</span><select value={variantId} onChange={(event) => setVariantId(event.target.value)}><option value="">Select an option</option>{item.variants.map((option) => <option key={option._id} value={option._id}>{Object.values(option.attributes).join(' · ') || option.sku || 'Option'}{option.stock <= 0 ? ' — unavailable' : ''}</option>)}</select></label>}
          <p className={stock > 0 ? 'stock-note' : 'stock-note unavailable'}>{stock > 0 ? variant || item.variants.length === 0 ? 'In stock' : 'Options available — choose an option' : 'Out of stock'}</p>
          {stock > 0 && <div className="detail-buy"><label className="quantity-control"><span className="sr-only">Quantity</span><button onClick={() => setQuantity(Math.max(1, quantity - 1))} aria-label="Decrease quantity">−</button><input value={quantity} type="number" min="1" max={Math.min(stock, 99)} onChange={(event) => setQuantity(Math.max(1, Math.min(stock, Number(event.target.value) || 1)))} /><button onClick={() => setQuantity(Math.min(stock, 99, quantity + 1))} aria-label="Increase quantity">+</button></label><button className="button" disabled={item.variants.length > 0 && !variantId} onClick={() => { add(item, quantity, variantId || undefined); navigate('/cart'); }}>Add to cart</button><button className="button button-outline" disabled={item.variants.length > 0 && !variantId} onClick={() => navigate('/checkout', { state: { buyNow: { product: item, quantity, ...(variantId ? { variantId } : {}) } } })}>Buy now</button></div>}
          <div className="detail-promise"><span>Made with care</span><span>Local fulfilment options at checkout</span></div>
        </div>
      </div>
    </div>
  );
}

function StoryPage(): ReactNode {
  return (
    <div className="story-page">
      <section className="story-hero"><div className="story-hero-logo"><img src="/images/maitri-sisterhood-logo.png" alt="eSakhi — Handmade by women, made for you" /></div><div><span className="eyebrow">The people behind every piece</span><h1>From her hands<br />to your <em>heart.</em></h1><p>Every handmade product carries a story of courage, creativity, and independence.</p></div></section>
      <article className="story-article">
        <div className="story-article-aside"><span className="story-aside-mark">✿</span><span>Made together,<br />with care.</span></div>
        <div className="story-article-copy"><p className="story-lead">Meet Sita, a woman from a small town in Madhya Pradesh. Like many women in her community, she had creative skills but limited opportunities to earn an income of her own.</p><p>Her journey changed when she joined a Self-Help Group with other women in her community. Together, they began making beautiful bangles, jewellery, and traditional dupattas using their skills, patience, and creativity.</p><p>Initially, reaching customers beyond their local neighbourhood was difficult. Their products were made with care, but finding the right market was a challenge.</p><p>With the support of her group, Sita continued improving her craft and learning how to present and sell her products. Every order became a reason to feel proud, and every sale brought her one step closer to financial independence.</p><p>Today, her work represents more than handmade products. It represents the strength of women working together, supporting their families, preserving traditional skills, and building a brighter future.</p></div>
      </article>
      <section className="story-quote"><span className="eyebrow">The story behind every purchase</span><blockquote>“When you buy from eSakhi, you are not simply buying a product. You are appreciating a woman's skill, supporting a community, and helping handmade traditions find a place in modern homes.”</blockquote><Link to="/shop" className="button">Explore the collection <span>→</span></Link></section>
    </div>
  );
}

function ServiceAreaPage(): ReactNode {
  const service = useLoad(() => api.serviceArea());
  const data = service.data;

  return (
    <div className="page-container">
      <PageIntro eyebrow="Local fulfilment" title="Service area" description="Coverage and delivery options shown here come from eSakhi store settings." />
      {service.loading ? <Loading label="Loading service-area settings…" /> : service.error ? (
        <><Notice tone="error">{service.error}</Notice><button className="button button-outline" onClick={() => void service.reload()}>Retry</button></>
      ) : data ? (
        <>
          {!data.configured && <Notice>Service-area settings are not configured yet. Ordering options will appear here when the store is ready.</Notice>}
          <div className="service-info-grid">
            <section className="panel">
              <h2>{data.city && data.state ? `${data.city}, ${data.state}` : 'Coverage'}</h2>
              <p>{data.deliveryEnabled ? 'Delivery is enabled for the localities listed below.' : 'Delivery is not currently enabled.'}</p>
              {data.pickupEnabled && <p>Pickup is enabled.{data.pickupInstructions ? ` ${data.pickupInstructions}` : ''}</p>}
              {(data.serviceableLocalities ?? []).length > 0 ? (
                <ul className="service-area-list">
                  {data.serviceableLocalities?.map((locality) => (
                    <li key={locality.name}>
                      <strong>{locality.name}</strong>
                      <span>PIN {locality.postalCodes.join(', ')}</span>
                      {locality.deliveryFeePaise !== undefined && <span>Delivery fee: {formatMoney(locality.deliveryFeePaise)}</span>}
                    </li>
                  ))}
                </ul>
              ) : <p>No delivery localities are currently published.</p>}
            </section>
            <section className="panel">
              <h2>Payment options</h2>
              {data.paymentMethods?.upi || data.paymentMethods?.cash ? (
                <ul className="service-area-list">
                  {data.paymentMethods.upi && <li><strong>UPI</strong>{data.paymentMethods.upi.instructions && <span>{data.paymentMethods.upi.instructions}</span>}</li>}
                  {data.paymentMethods.cash && <li><strong>Cash</strong>{data.paymentMethods.cash.instructions && <span>{data.paymentMethods.cash.instructions}</span>}</li>}
                </ul>
              ) : <p>No payment methods are currently available.</p>}
            </section>
          </div>
          <p className="service-area-footnote">Availability is confirmed again by the server during checkout.</p>
        </>
      ) : null}
    </div>
  );
}

function HelpPage(): ReactNode {
  const service = useLoad(() => api.serviceArea());
  const data = service.data;
  const policies = Object.entries(data?.policies ?? {}).filter(([, content]) => content.trim());

  return (
    <div className="page-container">
      <PageIntro eyebrow="We're here to help" title="Help & policies" description="Contact details and store policies are shown only when configured by an administrator." />
      {service.loading ? <Loading label="Loading help information…" /> : service.error ? (
        <><Notice tone="error">{service.error}</Notice><button className="button button-outline" onClick={() => void service.reload()}>Retry</button></>
      ) : data ? (
        <div className="help-content">
          <section className="panel">
            <h2>Contact</h2>
            {data.phone && <p><strong>Phone:</strong> {data.phone}</p>}
            {data.whatsapp && <p><strong>WhatsApp:</strong> {data.whatsapp}</p>}
            {data.address && <p><strong>Address:</strong> {data.address}</p>}
            {!data.phone && !data.whatsapp && !data.address && <p>Contact information has not been configured yet.</p>}
          </section>
          <section className="panel">
            <h2>Store policies</h2>
            {policies.length ? (
              <div className="policy-list">
                {policies.map(([name, content]) => (
                  <article key={name}>
                    <h3>{name.replace(/[_-]/g, ' ')}</h3>
                    <p>{content}</p>
                  </article>
                ))}
              </div>
            ) : <p>Store policies have not been published yet.</p>}
          </section>
        </div>
      ) : null}
      <p className="service-area-footnote"><Link className="quiet-link" to="/service-area">View current service-area settings</Link></p>
    </div>
  );
}

function formatE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (phone.trim().startsWith('+')) return `+${digits}`;
  return `+91${digits}`;
}

function SignInPage(): ReactNode {
  const { setSession, user, reloadUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [requested, setRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const signInState = location.state as { from?: string; checkoutState?: unknown } | null;
  if (user) return <div className="page-container narrow"><Notice tone="success">You are signed in as {user.name || user.phone}.</Notice><Link to={workspacePathForRole(user.role)} className="button">Continue to your workspace</Link></div>;

  const submitPhone = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const formattedNumber = formatE164(phone);
      if (!/^\+91[6-9]\d{9}$/.test(formattedNumber)) {
        throw new Error('Please enter a valid 10-digit Indian mobile number.');
      }
      await api.sendOtp(formattedNumber);
      setRequested(true);
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setLoading(false);
    }
  };

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const formattedNumber = formatE164(phone);
      const session = await api.verifyOtp(formattedNumber, code);
      const token = session.token || session.accessToken;
      if (token) {
        localStorage.setItem('token', token);
      }
      setSession(session.user, token);
      try {
        await reloadUser();
      } catch (err) {
        console.warn('reloadUser failed, continuing navigation:', err);
      }
      navigate(signInState?.from || '/', { replace: true, state: signInState?.checkoutState });
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-layout">
      <div className="auth-art">
        <img src="/images/maitri-sisterhood-logo.png" alt="" />
        <span>Handmade by women,<br />made for you.</span>
      </div>
      <section className="auth-card">
        <span className="eyebrow">Welcome to eSakhi</span>
        <h1>{requested ? 'Enter your code.' : 'A little care goes a long way.'}</h1>
        <p>{requested ? 'Enter the six-digit verification code (Dev OTP: 246810).' : 'Sign in with your Indian mobile number to see your orders and check out.'}</p>
        {error && <Notice tone="error">{error}</Notice>}
        {!requested ? (
          <form onSubmit={(event) => void submitPhone(event)} className="stack-form">
            <label className="field">
              <span>Mobile number</span>
              <input autoComplete="tel" inputMode="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91 98765 43210" />
            </label>
            <button className="button" disabled={loading}>{loading ? 'Requesting…' : 'Send verification code'}</button>
          </form>
        ) : (
          <form onSubmit={(event) => void submitCode(event)} className="stack-form">
            <label className="field">
              <span>Six-digit code</span>
              <input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="246810" />
            </label>
            <button className="button" disabled={loading}>{loading ? 'Verifying…' : 'Verify and continue'}</button>
            <button className="text-button" type="button" onClick={() => { setRequested(false); setCode(''); }}>Use another number</button>
          </form>
        )}
        <small>New here? Your customer account is created securely after successful phone verification.</small>
      </section>
    </div>
  );
}

function CartPage(): ReactNode {
  const { lines, setQuantity, remove, syncProduct } = useCart();
  const signature = lines.map((line) => line.product.slug).join('|');
  const currentProducts = useLoad(async () => Promise.all(lines.map(async (line) => {
    try { return { key: productKey(line), product: await api.product(line.product.slug), error: '' }; }
    catch (cause) { return { key: productKey(line), product: null, cause, error: displayError(cause) }; }
  })), [signature]);
  useEffect(() => {
    if (!currentProducts.data) return;
    for (const entry of currentProducts.data) syncProduct(entry.key, entry.product, entry.cause instanceof ApiError && entry.cause.status === 404);
  }, [currentProducts.data, syncProduct]);
  const subtotal = lines.reduce((sum, line) => {
    const fresh = currentProducts.data?.find((entry) => entry.key === productKey(line))?.product;
    return sum + (fresh?.pricePaise ?? line.product.pricePaise) * line.quantity;
  }, 0);
  return <div className="page-container"><PageIntro eyebrow="Your selection" title="Your bag" description="Your total is confirmed by eSakhi when you place your order." />{!lines.length ? <EmptyState title="Your bag is waiting for something lovely"><Link to="/shop" className="button">Explore the collection</Link></EmptyState> : <div className="cart-layout"><div className="cart-list">{currentProducts.loading && <Loading label="Checking current product details…" />}{lines.map((line) => { const refreshed = currentProducts.data?.find((entry) => entry.key === productKey(line)); const displayProduct = refreshed?.product ?? line.product; const failed = Boolean(refreshed && !refreshed.product); const unavailable = line.unavailable; return <article key={productKey(line)} className="cart-item"><Link to={`/products/${displayProduct.slug}`} className="cart-thumb">{displayProduct.imageUrls[0] ? <img src={resolveProductImageUrl(displayProduct.imageUrls[0])} alt="" /> : <img src="/images/maitri-sisterhood-logo.png" alt="" />}</Link><div className="cart-item-info"><span className="product-category">{displayProduct.category}</span><Link to={`/products/${displayProduct.slug}`} className="product-name">{displayProduct.name}</Link><span>{formatMoney(displayProduct.pricePaise)}</span>{unavailable && <span className="stock-note unavailable">No longer available — remove to continue.</span>}{failed && !unavailable && <span className="stock-note unavailable">{refreshed?.error || 'Could not refresh product details.'}</span>}</div><div className="cart-quantity"><button onClick={() => line.quantity > 1 ? setQuantity(productKey(line), line.quantity - 1) : remove(productKey(line))} aria-label="Decrease quantity">−</button><span>{line.quantity}</span><button onClick={() => setQuantity(productKey(line), Math.min(99, line.quantity + 1))} aria-label="Increase quantity">+</button></div><strong>{formatMoney(displayProduct.pricePaise * line.quantity)}</strong><button className="remove-button" onClick={() => remove(productKey(line))} aria-label={`Remove ${displayProduct.name}`}>×</button></article>; })}</div><aside className="summary-card"><span className="eyebrow">Order summary</span><div><span>Estimated subtotal</span><strong>{formatMoney(subtotal)}</strong></div><small>Final price, delivery fee, stock and payment options are checked by the server at checkout.</small>{currentProducts.data?.some((entry) => !entry.product) && <Notice tone="error">Refresh current product details or remove unavailable items before continuing.</Notice>}{currentProducts.data?.some((entry) => !entry.product) && <button className="button button-outline" onClick={() => void currentProducts.reload()}>Retry product check</button>}<Link aria-disabled={currentProducts.loading || currentProducts.data?.some((entry) => !entry.product)} onClick={(event) => { if (currentProducts.loading || currentProducts.data?.some((entry) => !entry.product)) event.preventDefault(); }} to="/checkout" className={`button button-full ${currentProducts.loading || currentProducts.data?.some((entry) => !entry.product) ? 'button-disabled' : ''}`}>Continue to checkout</Link><Link to="/shop" className="quiet-link">Continue shopping</Link></aside></div>}</div>;
}

function CheckoutPage(): ReactNode {
  const { user, reloadUser } = useAuth();
  const { lines, clear } = useCart();
  const location = useLocation();
  const navigate = useNavigate();
  const buyNowLine = getBuyNowLine(location.state);
  const checkoutLines = buyNowLine ? [buyNowLine] : lines;
  const service = useLoad(() => api.serviceArea());
  const [method, setMethod] = useState<'delivery' | 'pickup'>('delivery');
  const [payment, setPayment] = useState<'upi' | 'cash'>('upi');
  const [values, setValues] = useState({ name: user?.name ?? '' });
  const [selectedAddressId, setSelectedAddressId] = useState(() => user?.savedAddresses?.find((address) => address.isDefault)?.id ?? user?.savedAddresses?.[0]?.id ?? '');
  const [addressConfirmed, setAddressConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const availablePayments = service.data?.paymentMethods;
  const selectedAddress = user?.savedAddresses?.find((address) => address.id === selectedAddressId || address._id === selectedAddressId);
  const addressIsServiceable = Boolean(selectedAddress && service.data?.serviceableLocalities?.some((locality) =>
    locality.name.toLocaleLowerCase() === selectedAddress.locality.toLocaleLowerCase()
      && locality.postalCodes.includes(selectedAddress.postalCode)));
  useEffect(() => { if (service.data?.pickupEnabled && !service.data.deliveryEnabled) setMethod('pickup'); }, [service.data]);
  useEffect(() => {
    if (!user || selectedAddressId && user.savedAddresses?.some((address) => (address.id ?? address._id) === selectedAddressId)) return;
    const defaultAddress = user.savedAddresses?.find((address) => address.isDefault) ?? user.savedAddresses?.[0];
    setSelectedAddressId(defaultAddress?.id ?? defaultAddress?._id ?? '');
    setAddressConfirmed(false);
  }, [selectedAddressId, user]);
  useEffect(() => {
    if (availablePayments?.upi) setPayment('upi');
    else if (availablePayments?.cash) setPayment('cash');
  }, [availablePayments]);
  if (!user) return <div className="page-container narrow"><PageIntro title="Sign in to continue" description="Orders are linked to your verified phone number." /><Link to="/sign-in" state={{ from: '/checkout', checkoutState: location.state }} className="button">Sign in</Link></div>;
  if (!checkoutLines.length) return <div className="page-container"><EmptyState title="Your bag is empty"><Link to="/shop" className="button">Find something handmade</Link></EmptyState></div>;
  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSubmitting(true);
    const payload: Record<string, unknown> = {
      idempotencyKey,
      customerName: values.name,
      customerPhone: normalizeIndianPhone(user.phone ?? ''),
      fulfilmentMethod: method,
      items: checkoutLines.map((line) => ({ productId: getId(line.product), ...(line.variantId ? { variantId: line.variantId } : {}), quantity: line.quantity })),
      paymentMethod: payment,
    };
    if (method === 'delivery') {
      if (!selectedAddress || !addressConfirmed || !addressIsServiceable) {
        setError('Choose and confirm a saved address within a configured delivery locality and PIN code.');
        setSubmitting(false);
        return;
      }
      payload.address = {
        name: selectedAddress.name,
        phone: normalizeIndianPhone(selectedAddress.phone),
        addressLine1: selectedAddress.addressLine1,
        ...(selectedAddress.addressLine2 ? { addressLine2: selectedAddress.addressLine2 } : {}),
        locality: selectedAddress.locality,
        postalCode: selectedAddress.postalCode,
        ...(selectedAddress.houseNumber ? { houseNumber: selectedAddress.houseNumber } : {}),
        ...(selectedAddress.street ? { street: selectedAddress.street } : {}),
        ...(selectedAddress.area ? { area: selectedAddress.area } : {}),
        ...(selectedAddress.landmark ? { landmark: selectedAddress.landmark } : {}),
        ...(selectedAddress.villageOrCity ? { villageOrCity: selectedAddress.villageOrCity } : {}),
        ...(selectedAddress.district ? { district: selectedAddress.district } : {}),
        ...(selectedAddress.city ? { city: selectedAddress.city } : {}),
        ...(selectedAddress.state ? { state: selectedAddress.state } : {}),
        ...(selectedAddress.latitude !== undefined && selectedAddress.latitude !== null && selectedAddress.longitude !== undefined && selectedAddress.longitude !== null
          ? {
            latitude: selectedAddress.latitude,
            longitude: selectedAddress.longitude,
            ...(selectedAddress.locationAccuracyMeters !== undefined && selectedAddress.locationAccuracyMeters !== null ? { locationAccuracyMeters: selectedAddress.locationAccuracyMeters } : {}),
          }
          : {}),
        ...(selectedAddress.deliveryInstructions ? { deliveryInstructions: selectedAddress.deliveryInstructions } : {}),
      };
      if (selectedAddress.deliveryInstructions) payload.deliveryInstructions = selectedAddress.deliveryInstructions;
    }
    try {
      const result = await api.createOrder(payload);
      if (!buyNowLine) clear();
      setIdempotencyKey(crypto.randomUUID());
      navigate(`/orders/${encodeURIComponent(result.order._id)}`, { state: { paymentInstructions: result.paymentInstructions } });
    } catch (cause) { setError(displayError(cause)); }
    finally { setSubmitting(false); }
  };
  return <div className="page-container"><PageIntro eyebrow="Almost yours" title="A thoughtful order starts here" description="The server rechecks current stock, service options, and final totals when you place the order." />{service.error && <Notice tone="error">{service.error}</Notice>}{service.data && !service.data.configured && <Notice tone="error">Checkout is not configured yet. Please try again later.</Notice>}{service.data?.deliveryUnavailableReason && <Notice tone="error">Currently delivering only within Damoh, Madhya Pradesh. {service.data.deliveryUnavailableReason}</Notice>}{service.data?.configured && !availablePayments?.upi && !availablePayments?.cash && <Notice tone="error">No payment method is enabled for checkout yet.</Notice>}{service.data?.configured && <form className="checkout-layout" onSubmit={(event) => void submit(event)}><div className="checkout-form"><section className="form-section"><h2>Contact</h2><div className="form-grid"><label className="field"><span>Your name</span><input required maxLength={120} value={values.name} onChange={(event) => set('name', event.target.value)} /></label><label className="field"><span>Verified mobile number</span><input value={user.phone ?? ''} readOnly /><small>Order updates are sent to your verified account number.</small></label></div></section><section className="form-section"><h2>How would you like to receive it?</h2><div className="choice-row">{service.data.deliveryEnabled && <label className={method === 'delivery' ? 'choice selected' : 'choice'}><input type="radio" name="fulfilment" checked={method === 'delivery'} onChange={() => setMethod('delivery')} /><span><b>Local delivery</b><small>Choose a configured delivery locality and PIN code.</small></span></label>}{service.data.pickupEnabled && <label className={method === 'pickup' ? 'choice selected' : 'choice'}><input type="radio" name="fulfilment" checked={method === 'pickup'} onChange={() => setMethod('pickup')} /><span><b>Pickup</b><small>{service.data.pickupInstructions || 'Pickup details confirmed after your order'}</small></span></label>}</div></section>{method === 'delivery' && <section className="form-section"><h2>Where should we deliver?</h2><p>Select a saved address or add a new one. The default address is preselected when available.</p><AddressBook addresses={user.savedAddresses ?? []} serviceLocalities={service.data.serviceableLocalities ?? []} customerName={user.name ?? ''} customerPhone={user.phone ?? ''} onChanged={reloadUser} selectedAddressId={selectedAddressId} onSelect={(address) => { setSelectedAddressId(address.id ?? address._id ?? ''); setAddressConfirmed(false); }} />{selectedAddress && <div className="checkout-address-confirmation"><div><strong>{selectedAddress.label || 'Delivery address'}</strong><p>{selectedAddress.formattedAddress || [selectedAddress.addressLine1, selectedAddress.area, selectedAddress.city, selectedAddress.state, selectedAddress.postalCode].filter(Boolean).join(', ')}</p><small>Recipient: {selectedAddress.name} · {selectedAddress.phone}</small>{selectedAddress.deliveryInstructions && <small>Instructions: {selectedAddress.deliveryInstructions}</small>}</div>{!addressIsServiceable && <Notice tone="error">This address is outside the configured service area. Delivery requires a matching configured locality and six-digit PIN; selecting a map pin cannot bypass this check.</Notice>}{!addressConfirmed && <button type="button" className="button button-outline" disabled={!addressIsServiceable} onClick={() => setAddressConfirmed(true)}>Confirm this delivery address</button>}{addressConfirmed && <Notice tone="success">Delivery address confirmed for this order.</Notice>}</div>}</section>}<section className="form-section"><h2>Payment method</h2><div className="choice-row">{availablePayments?.upi && <label className={payment === 'upi' ? 'choice selected' : 'choice'}><input type="radio" name="payment" checked={payment === 'upi'} onChange={() => setPayment('upi')} /><span><b>UPI</b><small>Instructions provided after placing the order</small></span></label>}{availablePayments?.cash && <label className={payment === 'cash' ? 'choice selected' : 'choice'}><input type="radio" name="payment" checked={payment === 'cash'} onChange={() => setPayment('cash')} /><span><b>Cash</b><small>Payment is manually confirmed</small></span></label>}</div></section>{error && <Notice tone="error">{error}</Notice>}<button className="button" disabled={submitting || service.loading || !service.data.configured || (!availablePayments?.upi && !availablePayments?.cash) || method === 'delivery' && (!selectedAddress || !addressIsServiceable || !addressConfirmed)}>{submitting ? 'Placing order…' : 'Place order'}</button></div><aside className="summary-card checkout-summary"><span className="eyebrow">Your items</span>{checkoutLines.map((line) => <div key={productKey(line)}><span>{line.product.name} × {line.quantity}</span><strong>{formatMoney(line.product.pricePaise * line.quantity)}</strong></div>)}<small>Totals are calculated and confirmed by eSakhi when the order is placed.</small></aside></form>}</div>;
}

function AccountPage(): ReactNode {
  const { user } = useAuth();
  if (!user) return <SignInPrompt />;
  if (user.role === 'customer') return <CustomerDashboardPage />;
  return <AccountProfilePage />;
}

function CustomerDashboardPage(): ReactNode {
  const { user } = useAuth();
  const { lines } = useCart();
  const orders = useLoad(() => api.myOrders(1, 3), [user?.id]);
  useRefreshOnFocus(orders.reload);
  if (!user) return <SignInPrompt />;
  const recentOrders = orders.data?.data ?? [];
  const itemCount = lines.reduce((total, line) => total + line.quantity, 0);

  return (
    <div className="page-container customer-dashboard">
      <section className="customer-dashboard-welcome">
        <div>
          <span className="customer-dashboard-kicker">Your eSakhi account</span>
          <h1>Welcome back{user.name ? `, ${user.name}` : ''}</h1>
          <p>Your orders, saved details, and handmade finds, all in one place.</p>
        </div>
        <Link to="/shop" className="customer-dashboard-shop-link">Explore handmade <span aria-hidden="true">→</span></Link>
        <span className="customer-dashboard-flower" aria-hidden="true">✿</span>
      </section>

      <div className="customer-dashboard-shortcuts" aria-label="Account overview">
        <Link to="/orders" className="customer-dashboard-stat">
          <span className="customer-dashboard-stat-icon" aria-hidden="true">↗</span>
          <span><small>Your orders</small><strong>{orders.loading ? '…' : (orders.data?.pagination.total ?? 0).toLocaleString('en-IN')}</strong><small>View order history</small></span>
        </Link>
        <Link to="/account/profile#saved-address" className="customer-dashboard-stat">
          <span className="customer-dashboard-stat-icon" aria-hidden="true">⌖</span>
          <span><small>Saved addresses</small><strong>{(user.savedAddresses?.length ?? 0).toLocaleString('en-IN')}</strong><small>Manage delivery details</small></span>
        </Link>
        <Link to="/cart" className="customer-dashboard-stat">
          <span className="customer-dashboard-stat-icon" aria-hidden="true">♡</span>
          <span><small>Your bag</small><strong>{itemCount.toLocaleString('en-IN')}</strong><small>{itemCount === 1 ? 'piece' : 'pieces'} ready to view</small></span>
        </Link>
      </div>

      <div className="customer-dashboard-content">
        <section className="customer-dashboard-panel customer-dashboard-recent">
          <div className="customer-dashboard-panel-heading">
            <div><span className="customer-dashboard-kicker">Your purchases</span><h2>Recent orders</h2></div>
            <Link to="/orders">All orders <span aria-hidden="true">→</span></Link>
          </div>
          {orders.loading ? <Loading label="Loading your orders…" /> : orders.error ? <div className="customer-dashboard-panel-state"><Notice tone="error">{orders.error}</Notice><button className="button button-outline" onClick={() => void orders.reload()}>Try again</button></div> : recentOrders.length ? (
            <div className="customer-dashboard-order-list">
              {recentOrders.map((order) => <OrderCard key={order._id} order={order} to={`/orders/${encodeURIComponent(order._id)}`} />)}
            </div>
          ) : <div className="customer-dashboard-empty"><span aria-hidden="true">✿</span><h3>Your next favorite is waiting</h3><p>Your orders will appear here after you find something made with care.</p><Link to="/shop" className="button">Discover handmade</Link></div>}
        </section>

        <aside className="customer-dashboard-side">
          <section className="customer-dashboard-panel customer-dashboard-profile">
            <div className="customer-dashboard-panel-heading"><div><span className="customer-dashboard-kicker">A little about you</span><h2>Account details</h2></div><Link to="/account/profile">Edit</Link></div>
            <div className="customer-dashboard-profile-detail"><span className="customer-dashboard-profile-avatar" aria-hidden="true">{(user.name?.trim().charAt(0) || 'S').toLocaleUpperCase('en-IN')}</span><span><strong>{user.name || 'Add your name'}</strong><small>{user.phone || 'Verified phone account'}</small></span></div>
            <div className="customer-dashboard-address">
              <span className="customer-dashboard-kicker">Delivery address</span>
              {user.savedAddresses?.[0] ? <p>{user.savedAddresses[0].addressLine1}, {user.savedAddresses[0].locality}, {user.savedAddresses[0].city}</p> : <p>No saved address yet. Add one to make checkout easier.</p>}
              <Link to="/account/profile#saved-address">{user.savedAddresses?.length ? 'Manage saved address' : 'Add an address'} <span aria-hidden="true">→</span></Link>
            </div>
          </section>
          <section className="customer-dashboard-community">
            <span className="customer-dashboard-community-mark" aria-hidden="true">✿</span>
            <div><span className="customer-dashboard-kicker">Made together</span><h2>Every order supports a maker.</h2><p>Discover thoughtful pieces from women-led local businesses.</p><Link to="/shop">Meet your next handmade find <span aria-hidden="true">→</span></Link></div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function AccountProfilePage(): ReactNode {
  const { user, reloadUser } = useAuth();
  const service = useLoad(() => api.serviceArea(), [user?.id]);
  const [name, setName] = useState(user?.name ?? '');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pushEnabled, setPushEnabled] = useState(() => localStorage.getItem('esakhi-push-enabled') === 'true');
  useEffect(() => { setName(user?.name ?? ''); }, [user?.name]);
  if (!user) return <SignInPrompt />;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setMessage('');
    try { await api.updateMe(name); await reloadUser(); setMessage('Your profile has been updated.'); }
    catch (cause) { setError(displayError(cause)); }
  };
  const togglePush = async () => {
    setError('');
    setMessage('');
    try {
      if (pushEnabled) {
        await disableOrderPushNotifications(api.removePushToken);
        localStorage.removeItem('esakhi-push-enabled');
        setPushEnabled(false);
        setMessage('Order notifications are disabled on this device.');
      } else {
        await enableOrderPushNotifications(api.registerPushToken);
        localStorage.setItem('esakhi-push-enabled', 'true');
        setPushEnabled(true);
        setMessage('Order notifications are enabled on this device.');
      }
    } catch (cause) {
      setError(displayError(cause));
    }
  };
  return <div className="page-container narrow"><PageIntro eyebrow="Your account" title={`Hello${user.name ? `, ${user.name}` : ''}`} description="Manage your profile and find your past orders." />{user.role === 'customer' && <p><Link className="quiet-link" to="/account">← Back to your dashboard</Link></p>}<div className="account-role"><span className="status-dot" /> Signed in as {user.role}</div>{error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}<form className="stack-form panel" onSubmit={(event) => void submit(event)}><label className="field"><span>Your name</span><input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field"><span>Verified phone</span><input value={user.phone ?? ''} disabled /></label><button className="button">Save profile</button></form>{user.role === 'customer' && <section className="panel push-notification-settings"><h2>Order notifications</h2><p>Get a browser notification when your order status changes. Notifications are optional and require browser permission.</p>{pushNotificationsConfigured ? <button className="button button-outline" onClick={() => void togglePush()}>{pushEnabled ? 'Disable on this device' : 'Enable order notifications'}</button> : <Notice>Push notifications are not configured for this app yet.</Notice>}</section>}{user.role === 'customer' && <section id="saved-address" className="panel saved-addresses-panel"><h2>Saved delivery addresses</h2>{service.error && <Notice tone="error">{service.error}</Notice>}{service.loading ? <Loading label="Loading delivery options…" /> : <AddressBook addresses={user.savedAddresses ?? []} serviceLocalities={service.data?.serviceableLocalities ?? []} customerName={user.name ?? ''} customerPhone={user.phone ?? ''} onChanged={reloadUser} />}</section>}<div className="account-links"><Link to="/orders" className="button button-outline">View order history</Link>{user.role === 'delivery_partner' && <Link to="/delivery-partner" className="button button-outline">Open delivery portal</Link>}{user.role === 'city_admin' && <Link to="/city-admin" className="button button-outline">Open City Admin dashboard</Link>}{(user.role === 'admin' || user.role === 'staff') && <Link to="/admin" className="button button-outline">Open workspace</Link>}</div></div>;
}

function SignInPrompt(): ReactNode {
  return <div className="page-container narrow"><PageIntro title="Sign in to see your account" description="Your details and orders are available after phone verification." /><Link to="/sign-in" className="button">Sign in</Link></div>;
}

function OrdersPage(): ReactNode {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const result = useLoad(() => api.myOrders(page), [page, user?.id]);
  useEffect(() => {
    if (!user) return;
    const refresh = () => void result.reload(false);
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [result.reload, user]);
  if (!user) return <SignInPrompt />;
  if (user.role === 'seller') return <Navigate to="/seller" replace />;
  return <div className="page-container"><PageIntro eyebrow="Your purchases" title="Order history" description="Follow your orders from confirmation through fulfilment." />{result.loading ? <Loading /> : result.error ? <Notice tone="error">{result.error}</Notice> : result.data?.data.length ? <><div className="order-list">{result.data.data.map((order) => <OrderCard key={order._id} order={order} to={`/orders/${order._id}`} />)}</div>{result.data.pagination.totalPages > 1 && <Pagination page={page} pages={result.data.pagination.totalPages} onChange={setPage} />}</> : <EmptyState title="No orders yet"><Link to="/shop" className="button">Find your first piece</Link></EmptyState>}</div>;
}

function OrderCard({ order, to }: { order: Order; to: string }): ReactNode {
  return <Link className="order-card" to={to}><div><span className="eyebrow">{order.orderReference}</span><strong>{order.items.map((item) => item.productName).join(', ')}</strong>{order.deliveryPartner && <small>Delivery partner: {order.deliveryPartner.name}</small>}<small>{order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN') : ''}</small></div><div className="order-card-meta"><StatusBadge value={order.fulfilmentStatus} fulfilmentMethod={order.fulfilmentMethod} /><strong>{formatMoney(order.totalPaise)}</strong><span>View order →</span></div></Link>;
}

function orderStatusLabel(value: string, fulfilmentMethod?: Order['fulfilmentMethod']): string {
  const labels: Record<string, string> = {
    placed: 'Order Confirmed',
    order_confirmed: 'Order Confirmed',
    accepted: 'Accepted',
    preparing: 'Preparing',
    ready_for_pickup: 'Ready for Pickup',
    delivery_partner_assigned: 'Partner Assigned',
    out_for_pickup: 'Out for Pickup',
    picked_up: 'Picked Up',
    out_for_delivery: 'Out for Delivery',
    delivered: 'Delivered',
    completed: fulfilmentMethod === 'delivery' ? 'Delivered' : 'Completed',
    cancelled: 'Order Cancelled',
    delivery_failed: 'Delivery Failed',
    return_requested: 'Return Requested',
    return_rejected: 'Return Rejected',
    return_accepted: 'Return Accepted',
    return_partner_assigned: 'Return Agent Assigned',
    return_picked_up: 'Return Picked Up',
    return_delivered_to_seller: 'Returned to Seller',
    ready_for_refund: 'Ready for Refund',
    refund_completed: 'Refund Completed',
  };
  return labels[value] ?? value.replaceAll('_', ' ');
}

function StatusBadge({ value, fulfilmentMethod }: { value: string; fulfilmentMethod?: Order['fulfilmentMethod'] }): ReactNode {
  return <span className={`status-badge status-${value}`}>{orderStatusLabel(value, fulfilmentMethod)}</span>;
}

const DELIVERY_LIFECYCLE_STEPS: Array<{ key: string; label: string; aliases: string[]; description: string }> = [
  { key: 'order_confirmed', label: 'Confirmed', aliases: ['placed', 'order_confirmed', 'accepted'], description: 'Order placed & confirmed with Seller' },
  { key: 'preparing', label: 'Preparing', aliases: ['preparing'], description: 'Seller is preparing & packing your items' },
  { key: 'ready_for_pickup', label: 'Ready for Pickup', aliases: ['ready_for_pickup'], description: 'Packed & awaiting Delivery Partner assignment' },
  { key: 'delivery_partner_assigned', label: 'Partner Assigned', aliases: ['delivery_partner_assigned'], description: 'City Admin assigned a nearby Delivery Partner' },
  { key: 'out_for_pickup', label: 'Out for Pickup', aliases: ['out_for_pickup'], description: 'Delivery Partner accepted & moving toward Seller' },
  { key: 'picked_up', label: 'Picked Up', aliases: ['picked_up'], description: 'Package picked up from Seller shop' },
  { key: 'out_for_delivery', label: 'Out for Delivery', aliases: ['out_for_delivery'], description: 'Delivery Partner is on the way to Customer' },
  { key: 'delivered', label: 'Delivered', aliases: ['delivered', 'completed'], description: 'Package handed over & payment settled' },
];

function CustomerOrderPage(): ReactNode {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const order = useLoad(() => api.myOrder(id), [id, user?.id]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!user || !id) return;
    const refresh = () => void order.reload(false);
    const timer = window.setInterval(refresh, 5_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [id, order.reload, user]);
  if (!user) return <SignInPrompt />;
  if (order.loading) return <div className="page-container"><Loading /></div>;
  if (order.error || !order.data) return <div className="page-container"><Notice tone="error">{order.error || 'Order not found.'}</Notice></div>;
  const item = order.data;
  const paymentInstructions = (location.state as { paymentInstructions?: { method?: string; upiId?: string; qrImageUrl?: string; instructions?: string } } | null)?.paymentInstructions;
  const canCancel = ['placed', 'order_confirmed', 'accepted'].includes(item.fulfilmentStatus) && !item.cancellationRequest?.requestedAt;
  const history = item.statusHistory?.length
    ? item.statusHistory
    : [{ status: 'placed', changedAt: item.createdAt ?? '' }];
  const currentStepIndex = DELIVERY_LIFECYCLE_STEPS.findIndex((step) => step.aliases.includes(item.fulfilmentStatus));
  const partnerMovementLabel = item.fulfilmentStatus === 'delivery_partner_assigned'
    ? `Partner ${item.deliveryPartner?.name ?? ''} assigned — awaiting partner acceptance`
    : item.fulfilmentStatus === 'out_for_pickup'
      ? `Moving toward Seller (${item.sellerPickup?.sellerName ?? 'Seller shop'}) for pickup`
      : item.fulfilmentStatus === 'picked_up'
        ? `Picked up from Seller (${item.sellerPickup?.sellerName ?? 'Seller shop'}) — preparing route to you`
        : item.fulfilmentStatus === 'out_for_delivery'
          ? `On the way to Customer (${item.address?.locality ?? 'your address'})`
          : ['delivered', 'completed'].includes(item.fulfilmentStatus)
            ? 'Delivered to Customer & payment settled'
            : 'Seller is preparing your order for dispatch';

  const cancel = async () => {
    if (!window.confirm('Send a cancellation request for this order? The team must review it.')) return;
    setError('');
    try { order.setData(await api.requestCancellation(item._id)); }
    catch (cause) { setError(displayError(cause)); }
  };
  return (
    <div className="page-container">
      <div className="breadcrumbs"><Link to="/orders">Orders</Link><span>/</span>{item.orderReference}</div>
      <PageIntro eyebrow="Order details · Live sync enabled" title={item.orderReference} description={item.createdAt ? `Placed ${new Date(item.createdAt).toLocaleString('en-IN')}` : undefined}>
        <StatusBadge value={item.fulfilmentStatus} fulfilmentMethod={item.fulfilmentMethod} />
      </PageIntro>
      {error && <Notice tone="error">{error}</Notice>}
      {paymentInstructions && <Notice tone="success"><strong>Payment instructions ({paymentInstructions.method ?? item.paymentMethod})</strong><br />{paymentInstructions.upiId && <span>UPI ID: {paymentInstructions.upiId}<br /></span>}{paymentInstructions.instructions}{paymentInstructions.qrImageUrl && <p><img className="payment-qr" src={paymentInstructions.qrImageUrl} alt="UPI payment QR code" /></p>}</Notice>}
      {item.fulfilmentMethod === 'delivery' && item.fulfilmentStatus !== 'cancelled' && (
        <section className="panel" style={{ marginBottom: '1.25rem' }}>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">LIVE DELIVERY TRACKER</span>
              <h2>End-to-end order lifecycle</h2>
            </div>
            <button className="button button-outline" onClick={() => void order.reload()}>Refresh live status</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))', gap: '0.6rem', margin: '1rem 0' }}>
            {DELIVERY_LIFECYCLE_STEPS.map((step, index) => {
              const reached = currentStepIndex >= index;
              const isCurrent = currentStepIndex === index;
              const historyMatch = [...history].reverse().find((h) => step.aliases.includes(h.status));
              return (
                <div
                  key={step.key}
                  style={{
                    padding: '0.65rem 0.75rem',
                    borderRadius: '12px',
                    border: isCurrent ? '2px solid var(--brand, #6b215c)' : reached ? '1px solid rgba(29, 107, 67, 0.35)' : '1px solid rgba(120, 80, 100, 0.16)',
                    background: isCurrent ? 'rgba(107, 33, 92, 0.08)' : reached ? 'rgba(29, 107, 67, 0.06)' : 'rgba(120, 80, 100, 0.03)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: reached ? 'var(--brand, #6b215c)' : 'var(--muted, #7a6874)' }}>
                    {reached ? '✓ ' : `${index + 1}. `}{step.label}
                  </div>
                  <div style={{ fontSize: '0.73rem', color: 'var(--muted, #6a5864)', marginTop: '0.2rem' }}>{step.description}</div>
                  {historyMatch?.changedAt && (
                    <small style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.7rem', color: 'var(--brand, #6b215c)' }}>
                      {new Date(historyMatch.changedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </small>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'grid', gap: '0.75rem', padding: '0.9rem 1rem', borderRadius: '12px', background: 'var(--surface-subtle, #fdf8fb)', border: '1px solid rgba(107, 33, 92, 0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              <div>
                <strong style={{ color: 'var(--brand, #6b215c)' }}>🛵 Live Partner Movement:</strong>{' '}
                <span>{partnerMovementLabel}</span>
              </div>
              {item.deliveryPartner && (
                <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>
                  Partner: {item.deliveryPartner.name} ({item.deliveryPartner.phoneE164})
                  {item.deliveryPartner.distanceKm !== undefined && item.deliveryPartner.distanceKm !== null ? ` · ${item.deliveryPartner.distanceKm} km from Seller` : ''}
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem', fontSize: '0.86rem' }}>
              {item.sellerPickup && (
                <div>
                  <strong>Pickup Origin (Seller):</strong> {item.sellerPickup.sellerName}<br />
                  <span>{item.sellerPickup.address}, {item.sellerPickup.city}</span>
                  {item.sellerPickup.latitude !== undefined && item.sellerPickup.longitude !== undefined && (
                    <small style={{ display: 'block', color: 'var(--muted, #6a5864)' }}>
                      GPS: {item.sellerPickup.latitude.toFixed(4)}, {item.sellerPickup.longitude.toFixed(4)}
                    </small>
                  )}
                </div>
              )}
              {item.address && (
                <div>
                  <strong>Drop-off Destination (Customer):</strong> {item.address.name}<br />
                  <span>{item.address.formattedAddress || `${item.address.addressLine1}, ${item.address.locality}, ${item.address.postalCode}`}</span>
                  {item.address.latitude !== undefined && item.address.longitude !== undefined && (
                    <small style={{ display: 'block', color: 'var(--muted, #6a5864)' }}>
                      GPS: {item.address.latitude.toFixed(4)}, {item.address.longitude.toFixed(4)}
                    </small>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}
      <section className="panel order-timeline-panel">
        <div className="panel-heading"><h2>Chronological status log</h2><button className="button button-outline" onClick={() => void order.reload()}>Refresh status</button></div>
        <ol className="order-timeline">
          {history.map((entry, index) => (
            <li className="order-timeline-entry" key={`${entry.status}-${entry.changedAt}-${index}`}>
              <span className="order-timeline-marker" aria-hidden="true" />
              <div><strong>{orderStatusLabel(entry.status, item.fulfilmentMethod)}</strong>{entry.changedAt && <time dateTime={entry.changedAt}>{new Date(entry.changedAt).toLocaleString('en-IN')}</time>}{entry.note && <p>{entry.note}</p>}</div>
            </li>
          ))}
        </ol>
      </section>
      <div className="order-detail-grid">
        <section className="panel"><h2>Your items</h2>{item.items.map((line, index) => <div key={`${line.productId}-${index}`} className="order-line"><span>{line.productName} × {line.quantity}</span><strong>{formatMoney(line.lineTotalPaise)}</strong></div>)}<div className="order-line"><span>Subtotal</span><strong>{formatMoney(item.subtotalPaise)}</strong></div><div className="order-line"><span>Delivery</span><strong>{formatMoney(item.deliveryFeePaise)}</strong></div><div className="order-line total-line"><span>Total</span><strong>{formatMoney(item.totalPaise)}</strong></div></section>
        <aside className="panel"><h2>Payment & delivery</h2><p>Payment <StatusBadge value={item.paymentStatus} /></p><p>Fulfilment <StatusBadge value={item.fulfilmentStatus} fulfilmentMethod={item.fulfilmentMethod} /></p>
          {item.fulfilmentMethod === 'pickup' ? <><p>Pickup order</p>{item.pickupInstructions && <Notice>{item.pickupInstructions}</Notice>}</> : <><p>{item.address ? `${item.address.addressLine1}, ${item.address.locality}, ${item.address.postalCode}` : 'Delivery'}</p>{item.deliveryPartner && <div className="delivery-partner-card"><strong>Your delivery partner</strong><span>{item.deliveryPartner.name}</span><a href={`tel:${item.deliveryPartner.phoneE164}`}>Call {item.deliveryPartner.phoneE164}</a></div>}</>}
          {item.cancellationRequest?.requestedAt && <Notice>Cancellation request: {item.cancellationRequest.decision || 'awaiting review'}</Notice>}
          {canCancel && <button className="button button-outline" onClick={() => void cancel()}>Request cancellation</button>}
        </aside>
      </div>
      <CustomerReturnAndCancelPanel order={item} onOrderUpdated={(updated) => order.setData(updated)} />
    </div>
  );
}

const superAdminNavGroups = [
  {
    label: 'Main',
    items: [{ label: 'Overview', icon: 'overview', path: '/super-admin' }],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Cities & Service Zones', icon: 'cities', path: '/super-admin/cities' },
      { label: 'City Administrators', icon: 'administrators', path: '/super-admin/city-administrators' },
      { label: 'Sellers & SHGs', icon: 'sellers', path: '/super-admin/sellers' },
      { label: 'Products & Inventory', icon: 'products', path: '/super-admin/products' },
      { label: 'Orders & Assignments', icon: 'orders', path: '/super-admin/orders' },
      { label: 'Delivery Partners', icon: 'delivery', path: '/super-admin/delivery-partners' },
      { label: 'External Delivery Providers', icon: 'providers', path: '/super-admin/external-delivery-providers' },
      { label: 'Customers', icon: 'customers', path: '/super-admin/customers' },
      { label: 'Support & Disputes', icon: 'support', path: '/super-admin/support' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Payments & Reconciliation', icon: 'payments', path: '/super-admin/payments' },
      { label: 'Refunds', icon: 'refunds', path: '/super-admin/refunds' },
      { label: 'Seller Settlements', icon: 'settlements', path: '/super-admin/settlements' },
      { label: 'Delivery Partner Payouts', icon: 'payouts', path: '/super-admin/payouts' },
      { label: 'City Admin Compensation', icon: 'compensation', path: '/super-admin/reports' },
    ],
  },
  {
    label: 'Management',
    items: [
      { label: 'Reports & Analytics', icon: 'reports', path: '/super-admin/reports' },
      { label: 'Platform Settings', icon: 'settings', path: '/super-admin/settings' },
      { label: 'Roles & Permissions', icon: 'roles', path: '/super-admin/roles' },
      { label: 'Security & Audit Logs', icon: 'security', path: '/super-admin/security' },
    ],
  },
];

function SuperAdminGate({ children }: { children: ReactNode }): ReactNode {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) return <div className="page-container"><Loading label="Checking your session…" /></div>;
  if (!user) {
    return (
      <div className="page-container narrow">
        <PageIntro eyebrow="Protected workspace" title="Super Admin sign-in required" description="Continue with the account provisioned for platform administration." />
        <Link to="/sign-in" state={{ from: location.pathname }} className="button">Sign in</Link>
      </div>
    );
  }
  if (user.role !== 'super_admin') {
    return (
      <div className="page-container narrow">
        <Notice tone="error">This workspace requires an explicitly provisioned Super Admin account.</Notice>
        <Link to="/" className="button button-outline">Return to the store</Link>
      </div>
    );
  }
  return <SuperAdminLayout>{children}</SuperAdminLayout>;
}

function SuperAdminLayout({ children }: { children: ReactNode }): ReactNode {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const pageTitle = {
    '/super-admin': 'Overview',
    '/super-admin/cities': 'Cities & Service Zones',
    '/super-admin/city-administrators': 'City Administrators',
    '/super-admin/sellers': 'Sellers & SHGs',
    '/super-admin/products': 'Products & Inventory',
    '/super-admin/orders': 'Orders & Assignments',
    '/super-admin/delivery-partners': 'Delivery Partners',
    '/super-admin/external-delivery-providers': 'External Delivery Providers',
    '/super-admin/customers': 'Customers',
    '/super-admin/support': 'Support & Disputes',
    '/super-admin/payments': 'Payments & Reconciliation',
    '/super-admin/refunds': 'Refunds',
    '/super-admin/settlements': 'Seller Settlements',
    '/super-admin/payouts': 'Delivery Partner Payouts',
    '/super-admin/reports': 'Reports & Analytics',
    '/super-admin/settings': 'Platform Settings',
    '/super-admin/roles': 'Roles & Permissions',
    '/super-admin/security': 'Security & Audit Logs',
  }[pathname] ?? (
    pathname.startsWith('/super-admin/cities/') ? 'City details'
      : pathname.startsWith('/super-admin/city-administrators/') ? 'City Admin details'
        : pathname.startsWith('/super-admin/sellers/') ? 'Seller details'
          : pathname.startsWith('/super-admin/products/') ? 'Product details'
          : pathname.startsWith('/super-admin/orders/') ? 'Order details'
            : pathname.startsWith('/super-admin/delivery-partners/') ? 'Delivery partner details'
              : pathname.startsWith('/super-admin/customers/') ? 'Customer details'
                : 'Overview'
  );

  async function handleSignOut(): Promise<void> {
    setSignOutError('');
    try {
      await signOut();
      navigate('/');
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Unable to sign out. Please try again.');
    }
  }

  return (
    <div className={`super-admin-shell${collapsed ? ' is-collapsed' : ''}`}>
      {mobileOpen && <button className="super-admin-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`super-admin-sidebar${mobileOpen ? ' is-open' : ''}`}>
        <Link to="/super-admin" className="super-admin-brand">
          <img src="/images/maitri-sisterhood-logo.png" alt="" />
          <span>eSakhi<small>Super Admin Portal</small></span>
        </Link>
        <nav className="super-admin-nav" aria-label="Super Admin navigation">
          {superAdminNavGroups.map((group) => (
            <div className="super-admin-nav-group" key={group.label}>
              <span className="super-admin-nav-label">{group.label}</span>
              {group.items.map((item) => item.path ? (
                <NavLink
                  to={item.path}
                  end={item.path === '/super-admin'}
                  key={item.label}
                  title={collapsed ? item.label : undefined}
                  onClick={() => setMobileOpen(false)}
                >
                  <SuperAdminIcon name={item.icon} />
                  <span>{item.label}</span>
                </NavLink>
              ) : (
                <span className="super-admin-nav-disabled" key={item.label} title={collapsed ? `${item.label} — unavailable` : undefined} aria-disabled="true">
                  <SuperAdminIcon name={item.icon} />
                  <span>{item.label}</span>
                  <small>Planned</small>
                </span>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-user">
          <span className="avatar">{(user?.name || 'S').slice(0, 1).toUpperCase()}</span>
          <span><strong>{user?.name || user?.phone}</strong><small>Super Admin</small></span>
          <button className="super-admin-signout" onClick={() => void handleSignOut()} title="Sign out" aria-label="Sign out">↗</button>
        </div>
      </aside>
      <section className="super-admin-content">
        <div className="super-admin-topbar">
          <div className="super-admin-breadcrumb">
            <button
              className="super-admin-menu-toggle"
              onClick={() => {
                if (window.matchMedia('(max-width: 850px)').matches) setMobileOpen((open) => !open);
                else setCollapsed((value) => !value);
              }}
              aria-label={mobileOpen ? 'Close navigation' : collapsed ? 'Expand navigation' : 'Collapse navigation'}
              title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            >☰</button>
            <span>Platform</span><b>/</b><strong>{pageTitle}</strong>
          </div>
          <div className="super-admin-topbar-actions">
            <span className="super-admin-date">{new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <span className="super-admin-profile"><span className="avatar">{(user?.name || 'S').slice(0, 1).toUpperCase()}</span><span>{user?.name || 'Super Admin'}<small>Super Admin</small></span></span>
            <button className="super-admin-mobile-signout" onClick={() => void handleSignOut()}>Sign out</button>
          </div>
        </div>
        {signOutError && <div className="super-admin-signout-error" role="alert">{signOutError}</div>}
        {children}
      </section>
    </div>
  );
}

function SuperAdminModulePage({
  eyebrow,
  title,
  description,
  metrics,
  note,
}: {
  eyebrow: string;
  title: string;
  description: string;
  metrics: Array<{ label: string; value: string | number; detail?: string; icon?: string }>;
  note?: string;
}): ReactNode {
  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading">
        <div>
          <p className="super-admin-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      <div className="super-admin-metrics">
        {metrics.map((metric) => (
          <SuperAdminMetric
            key={metric.label}
            label={metric.label}
            value="—"
            icon={metric.icon ?? 'overview'}
            detail="No live record is tracked by the current backend."
          />
        ))}
      </div>
      <section className="super-admin-panel super-admin-unavailable-panel">
        <div className="super-admin-panel-heading"><div><h2>Live data unavailable</h2><p>This section has no corresponding records or workflow endpoint in the current eSakhi backend.</p></div></div>
        <p>{note || 'No information is shown here until the relevant backend workflow is implemented.'}</p>
      </section>
    </div>
  );
}

const indianStatesAndTerritories = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
  'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal',
];

function SuperAdminCitiesPage(): ReactNode {
  const settingsResult = useLoad(() => api.settings(), []);
  const citiesResult = useLoad(() => api.superAdminCities(), []);
  const placesResult = useLoad(() => import('./data/indiaPopulatedPlaces.json').then((module) => module.default), []);
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (settingsResult.data) {
      setCity(settingsResult.data.city);
      setState(settingsResult.data.state);
    }
  }, [settingsResult.data]);

  const cityOptions = Array.from(new Set([
    ...(placesResult.data ?? []).filter((place) => place.state === state).map((place) => place.city),
    ...(state === settingsResult.data?.state && settingsResult.data?.city && !(placesResult.data ?? []).some((place) => place.city.toLocaleLowerCase() === settingsResult.data?.city.toLocaleLowerCase())
      ? [settingsResult.data.city]
      : []),
  ])).sort((left, right) => left.localeCompare(right));
  const selectedCityIsListedForState = (placesResult.data ?? []).some((place) =>
    place.state === state && place.city.toLocaleLowerCase() === city.toLocaleLowerCase(),
  );
  const selectedCityIsLegacyCurrentCity = Boolean(
    placesResult.data && settingsResult.data &&
    state === settingsResult.data.state && city === settingsResult.data.city &&
    !placesResult.data.some((place) => place.city.toLocaleLowerCase() === city.toLocaleLowerCase()),
  );
  const canSaveCity = selectedCityIsListedForState || selectedCityIsLegacyCurrentCity;

  const saveCity = async (event: FormEvent) => {
    event.preventDefault();
    if (!settingsResult.data || !canSaveCity) return;
    setSaving(true); setError(''); setMessage('');
    try {
      await api.saveSettings({ ...settingsResult.data, city: city.trim(), state: state.trim() });
      setMessage('Platform city and state updated successfully.');
      await settingsResult.reload(false);
      await citiesResult.reload(false);
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading">
        <div><p className="super-admin-eyebrow">Operations</p><h1>Cities & Service Zones</h1><p>Select the state first, then choose a city already present in platform records.</p></div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      <div className="super-admin-metrics">
        <SuperAdminMetric label="Configured city" value={settingsResult.data?.city ?? city} icon="cities" detail="Current business city" />
        <SuperAdminMetric label="Cities in records" value={citiesResult.data?.length ?? '—'} icon="overview" detail="Observed in settings, users, and orders" />
        <SuperAdminMetric label="Orders" value={citiesResult.data?.reduce((total, record) => total + record.orderCount, 0) ?? '—'} icon="orders" detail="Across listed cities" />
        <SuperAdminMetric label="Service zones" value={settingsResult.data?.serviceableLocalities?.length ?? 0} icon="reports" detail="Configured localities" />
      </div>
      <div className="super-admin-lower-grid">
        <section className="super-admin-panel super-admin-recent-orders">
          <div className="super-admin-panel-heading"><div><h2>City configuration</h2><p>Update the active platform city and state.</p></div></div>
          <form className="stack-form" onSubmit={(event) => void saveCity(event)}>
            <label className="field"><span>State / Union Territory</span><select aria-label="State or Union Territory" required value={state} onChange={(event) => { setState(event.target.value); setCity(''); }}>
              {!indianStatesAndTerritories.includes(state) && state && <option value={state}>{state}</option>}
              {indianStatesAndTerritories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select></label>
            <label className="field"><span>City</span><select aria-label="City" required value={city} onChange={(event) => setCity(event.target.value)}>
              <option value="">{placesResult.loading ? 'Loading cities…' : placesResult.error ? 'City list unavailable' : 'Select a city'}</option>
              {cityOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select></label>
            {placesResult.error && <div className="super-admin-error" role="alert">{placesResult.error}<button type="button" onClick={() => void placesResult.reload()}>Retry</button></div>}
            <p className="super-admin-data-note">Place names: <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames cities15000</a>, CC BY 4.0 (places above 15,000 population or administrative seats). This list does not define service coverage.</p>
            <button className="button" type="submit" disabled={saving || !settingsResult.data || !city.trim() || !state || !canSaveCity}>{saving ? 'Saving…' : 'Save city details'}</button>
          </form>
        </section>
      </div>
      <section className="super-admin-panel super-admin-order-directory">
        <div className="super-admin-panel-heading"><div><h2>City directory</h2><p>City records are derived from configured settings, user assignments, and customer delivery addresses.</p></div></div>
        {citiesResult.error && <div className="super-admin-error" role="alert">{citiesResult.error}<button onClick={() => void citiesResult.reload()}>Retry</button></div>}
        {citiesResult.loading ? <Loading label="Loading cities…" /> : citiesResult.data?.length ? (
          <div className="super-admin-table-wrap"><table className="super-admin-table">
            <thead><tr><th>City</th><th>State</th><th>City Admin</th><th>Sellers</th><th>Partners</th><th>Zones</th><th>Orders</th><th>Configured</th></tr></thead>
            <tbody>{citiesResult.data.map((record) => (
              <tr key={record.city}>
                <td><Link to={`/super-admin/cities/${encodeURIComponent(record.city)}`}>{record.city}</Link></td>
                <td>{record.state || '—'}</td>
                <td>{record.cityAdminName || 'Unassigned'} <small>{record.cityAdminCount} account(s)</small></td>
                <td>{record.sellerCount}</td><td>{record.deliveryPartnerCount}</td><td>{record.serviceZoneCount}</td><td>{record.orderCount}</td>
                <td><StatusBadge value={record.configured ? 'active' : 'observed'} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className="super-admin-empty">No city records exist yet. Configure a platform city or add city-scoped users and orders to populate this directory.</div>}
      </section>
    </div>
  );
}

function SuperAdminCityDetailPage(): ReactNode {
  const { city = '' } = useParams();
  const result = useLoad(() => api.superAdminCity(city), [city]);
  const record = result.data;
  if (result.loading) return <div className="super-admin-page"><Loading label="Loading city details…" /></div>;
  if (!record) return <div className="super-admin-page"><Notice tone="error">{result.error || 'City not found.'}</Notice><Link className="super-admin-text-link" to="/super-admin/cities">← Back to cities</Link></div>;
  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading">
        <div><p className="super-admin-eyebrow"><Link to="/super-admin/cities">Cities & Service Zones</Link> / City profile</p><h1>{record.city}</h1><p>{record.state || 'State not configured'} · {record.configured ? 'Configured platform city' : 'Observed from live records'}</p></div>
      </div>
      <div className="super-admin-metrics">
        <SuperAdminMetric label="City Admins" value={record.metrics.cityAdmins} icon="administrators" />
        <SuperAdminMetric label="Sellers & SHGs" value={record.metrics.sellers} icon="sellers" />
        <SuperAdminMetric label="Delivery partners" value={record.metrics.deliveryPartners} icon="delivery" detail="Associated through city orders" />
        <SuperAdminMetric label="Orders" value={record.metrics.orders} icon="orders" />
      </div>
      {record.configured ? (
        <section className="super-admin-panel">
          <div className="super-admin-panel-heading"><div><h2>Service zones</h2><p>Configured localities and postal codes for this platform city.</p></div></div>
          {record.serviceableLocalities.length ? <div className="super-admin-table-wrap"><table className="super-admin-table"><thead><tr><th>Locality</th><th>Postal codes</th><th>Delivery fee</th></tr></thead><tbody>{record.serviceableLocalities.map((zone) => <tr key={zone.name}><td>{zone.name}</td><td>{zone.postalCodes.join(', ') || '—'}</td><td>{zone.deliveryFeePaise === undefined ? '—' : formatMoney(zone.deliveryFeePaise)}</td></tr>)}</tbody></table></div> : <div className="super-admin-empty">No serviceable localities are configured for this city.</div>}
        </section>
      ) : <p className="super-admin-data-note">The current settings schema stores one configured platform city and its service zones. This city is visible because it appears in live user or order records.</p>}
      <div className="super-admin-detail-grid">
        <SuperAdminRecordTable title="City administrators" description="Administrators assigned to this city." empty="No City Admin is assigned." headers={['Name', 'Phone', 'Status']} rows={record.cityAdmins.map((admin) => [
          <Link key="name" to={`/super-admin/city-administrators/${getId(admin)}`}>{admin.name || 'City Admin'}</Link>,
          admin.phoneE164 || '—',
          <StatusBadge key="status" value={admin.status || 'active'} />,
        ])} />
        <SuperAdminRecordTable title="Sellers & SHGs" description="Seller accounts assigned to this city." empty="No seller accounts are assigned." headers={['Name', 'Phone', 'Status']} rows={record.sellers.map((seller) => [
          <Link key="name" to={`/super-admin/sellers/${getId(seller)}`}>{seller.name || 'Seller'}</Link>,
          seller.phoneE164 || '—',
          <StatusBadge key="status" value={seller.status || 'active'} />,
        ])} />
        <SuperAdminRecordTable title="Delivery partners" description="Partners associated through current or historical deliveries in this city." empty="No delivery partner is associated with a city order." headers={['Name', 'Phone', 'Status']} rows={record.deliveryPartners.map((partner) => [
          <Link key="name" to={`/super-admin/delivery-partners/${getId(partner)}`}>{partner.name || 'Delivery Partner'}</Link>,
          partner.phoneE164 || '—',
          <StatusBadge key="status" value={partner.status || 'active'} />,
        ])} />
      </div>
      <section className="super-admin-panel super-admin-order-directory">
        <div className="super-admin-panel-heading"><div><h2>Recent city orders</h2><p>Latest orders delivered or placed in {record.city}.</p></div></div>
        {record.recentOrders.length ? <SuperAdminOrderTable orders={record.recentOrders} /> : <div className="super-admin-empty">No orders are recorded for this city.</div>}
      </section>
    </div>
  );
}

function SuperAdminCityAdministratorsPage(): ReactNode {
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ phone: '', name: '', email: '', city: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const result = useLoad(() => api.superAdminCityAdmins(page, 20), [page]);
  const settingsResult = useLoad(() => api.settings(), []);
  const citiesResult = useLoad(() => api.superAdminCities(), []);

  useEffect(() => {
    if (settingsResult.data?.city) setForm((current) => current.city ? current : { ...current, city: settingsResult.data?.city ?? '' });
  }, [settingsResult.data]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setError(''); setMessage('');
    try {
      await api.createCityAdmin({
        phone: form.phone,
        name: form.name.trim() || undefined,
        email: form.email.trim() || undefined,
        city: form.city.trim() || undefined,
      });
      setForm({ phone: '', name: '', email: '', city: form.city });
      setMessage('City administrator created successfully.');
      await result.reload(false);
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (admin: User) => {
    const id = admin._id ?? admin.id;
    if (!id) return;
    const nextStatus = admin.status === 'disabled' ? 'active' : 'disabled';
    setError(''); setMessage('');
    try {
      await api.updateCityAdmin(id, { city: admin.assignedCity, status: nextStatus, name: admin.name, email: admin.email });
      setMessage(`City admin ${nextStatus === 'active' ? 'activated' : 'disabled'} successfully.`);
      await result.reload(false);
    } catch (cause) {
      setError(displayError(cause));
    }
  };

  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading">
        <div><p className="super-admin-eyebrow">Operations</p><h1>City Administrators</h1><p>Add an approved City Admin account and assign them to a city from the existing database.</p></div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      <div className="super-admin-lower-grid">
        <section className="super-admin-panel super-admin-recent-orders">
          <div className="super-admin-panel-heading"><div><h2>Add city admin</h2><p>Provision a user with the City Admin role.</p></div></div>
          <form className="stack-form" onSubmit={(event) => void submit(event)}>
            <label className="field"><span>Phone number</span><input aria-label="City admin phone" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="+91xxxxxxxxxx" /></label>
            <label className="field"><span>Name</span><input aria-label="City admin name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
            <label className="field"><span>Email</span><input aria-label="City admin email" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></label>
            <label className="field"><span>Assigned city</span><input aria-label="Assigned city" list="super-admin-city-options" value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} required /></label>
            <datalist id="super-admin-city-options">{citiesResult.data?.map((record) => <option key={record.city} value={record.city} />)}</datalist>
            <button className="button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create city admin'}</button>
          </form>
        </section>
        <section className="super-admin-panel super-admin-attention-panel">
          <div className="super-admin-panel-heading"><div><h2>City admin directory</h2><p>All City Admin accounts in the system.</p></div></div>
          {result.error && <div className="super-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
          {result.loading ? <Loading label="Loading city administrators…" /> : result.data?.data.length ? <div className="super-admin-table-wrap"><table className="super-admin-table"><thead><tr><th>Name</th><th>Phone</th><th>City</th><th>Status</th><th>Actions</th></tr></thead><tbody>{result.data.data.map((admin) => <tr key={getId(admin)}><td><Link to={`/super-admin/city-administrators/${getId(admin)}`}>{admin.name || 'City Admin'}</Link></td><td>{admin.phoneE164 || admin.phone || '—'}</td><td>{admin.assignedCity ? <Link to={`/super-admin/cities/${encodeURIComponent(admin.assignedCity)}`}>{admin.assignedCity}</Link> : '—'}</td><td><StatusBadge value={admin.status ?? 'active'} /></td><td><button className="text-button" onClick={() => void toggleStatus(admin)}>{admin.status === 'disabled' ? 'Activate' : 'Disable'}</button></td></tr>)}</tbody></table></div> : <div className="super-admin-empty">No city administrators have been created yet.</div>}
          {result.data && result.data.pagination.totalPages > 1 && <Pagination page={page} pages={result.data.pagination.totalPages} onChange={setPage} />}
        </section>
      </div>
    </div>
  );
}

function SuperAdminCityAdminDetailPage(): ReactNode {
  const { id = '' } = useParams();
  const result = useLoad(() => api.superAdminCityAdmin(id), [id]);
  const admin = result.data;
  if (result.loading) return <div className="super-admin-page"><Loading label="Loading City Admin profile…" /></div>;
  if (!admin) return <div className="super-admin-page"><Notice tone="error">{result.error || 'City Admin not found.'}</Notice><Link className="super-admin-text-link" to="/super-admin/city-administrators">← Back to City Admins</Link></div>;
  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading"><div><p className="super-admin-eyebrow"><Link to="/super-admin/city-administrators">City Administrators</Link> / Profile</p><h1>{admin.name || 'City Administrator'}</h1><p>City-scoped administrator account details.</p></div></div>
      <div className="super-admin-metrics">
        <SuperAdminMetric label="Role" value="City Admin" icon="administrators" />
        <SuperAdminMetric label="Assigned city" value={admin.assignedCity || 'Unassigned'} icon="cities" />
        <SuperAdminMetric label="Account status" value={admin.status || 'active'} icon="security" />
        <SuperAdminMetric label="Registered" value={admin.createdAt ? new Date(admin.createdAt).toLocaleDateString('en-IN') : '—'} icon="overview" />
      </div>
      <section className="super-admin-panel super-admin-profile-panel">
        <div className="super-admin-panel-heading"><div><h2>Administrator profile</h2><p>Identity and scope recorded on the account.</p></div></div>
        <dl className="super-admin-definition-list">
          <div><dt>Phone</dt><dd>{admin.phoneE164 || admin.phone || '—'}</dd></div>
          <div><dt>Email</dt><dd>{admin.email || '—'}</dd></div>
          <div><dt>City scope</dt><dd>{admin.assignedCity ? <Link to={`/super-admin/cities/${encodeURIComponent(admin.assignedCity)}`}>{admin.assignedCity}</Link> : 'Not assigned'}</dd></div>
          <div><dt>Account ID</dt><dd><code>{getId(admin)}</code></dd></div>
        </dl>
      </section>
    </div>
  );
}

function SuperAdminSellersPage(): ReactNode {
  const [page, setPage] = useState(1);
  const result = useLoad(() => api.superAdminSellers(page, 20), [page]);
  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading">
        <div><p className="super-admin-eyebrow">Operations</p><h1>Sellers & SHGs</h1><p>View all seller records and their city assignment and status.</p></div>
      </div>
      <div className="super-admin-metrics">
        <SuperAdminMetric label="Sellers" value={result.data?.pagination.total ?? 0} icon="sellers" detail="Registered seller users" />
        <SuperAdminMetric label="Active" value={result.data?.data.filter((seller) => seller.status !== 'disabled').length ?? 0} icon="overview" detail="Approved and active sellers" />
        <SuperAdminMetric label="Disabled" value={result.data?.data.filter((seller) => seller.status === 'disabled').length ?? 0} icon="security" detail="Restricted sellers" />
        <SuperAdminMetric label="Cities" value={new Set(result.data?.data.map((seller) => seller.assignedCity).filter(Boolean)).size ?? 0} icon="cities" detail="Assigned city distribution" />
      </div>
      <section className="super-admin-panel super-admin-recent-orders">
        <div className="super-admin-panel-heading"><div><h2>Seller directory</h2><p>All sellers and SHGs currently stored in the platform.</p></div></div>
        {result.error && <div className="super-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
        {result.loading ? <Loading label="Loading sellers…" /> : result.data?.data.length ? <div className="super-admin-table-wrap"><table className="super-admin-table"><thead><tr><th>Name</th><th>Phone</th><th>City</th><th>Email</th><th>Status</th></tr></thead><tbody>{result.data.data.map((seller) => <tr key={getId(seller)}><td><Link to={`/super-admin/sellers/${getId(seller)}`}>{seller.name || 'Seller'}</Link></td><td>{seller.phoneE164 || seller.phone || '—'}</td><td>{seller.assignedCity ? <Link to={`/super-admin/cities/${encodeURIComponent(seller.assignedCity)}`}>{seller.assignedCity}</Link> : '—'}</td><td>{seller.email || '—'}</td><td><StatusBadge value={seller.status ?? 'active'} /></td></tr>)}</tbody></table></div> : <div className="super-admin-empty">No sellers are registered in the database yet.</div>}
        {result.data && result.data.pagination.totalPages > 1 && <Pagination page={page} pages={result.data.pagination.totalPages} onChange={setPage} />}
      </section>
    </div>
  );
}

function SuperAdminSellerDetailPage(): ReactNode {
  const { id = '' } = useParams();
  const [page, setPage] = useState(1);
  const sellerResult = useLoad(() => api.superAdminSeller(id), [id]);
  const productsResult = useLoad(() => api.adminProducts(new URLSearchParams({ sellerId: id, page: String(page), limit: '20', archived: 'false' })), [id, page]);
  const seller = sellerResult.data;
  if (sellerResult.loading) return <div className="super-admin-page"><Loading label="Loading seller profile…" /></div>;
  if (!seller) return <div className="super-admin-page"><Notice tone="error">{sellerResult.error || 'Seller not found.'}</Notice><Link className="super-admin-text-link" to="/super-admin/sellers">← Back to Sellers</Link></div>;
  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading"><div><p className="super-admin-eyebrow"><Link to="/super-admin/sellers">Sellers & SHGs</Link> / Profile</p><h1>{seller.name || 'Seller'}</h1><p>Seller account and linked product catalogue.</p></div></div>
      <div className="super-admin-metrics">
        <SuperAdminMetric label="Products" value={productsResult.data?.pagination.total ?? '—'} icon="products" />
        <SuperAdminMetric label="Active products" value={productsResult.data?.data.filter((product) => product.isActive).length ?? '—'} icon="overview" detail="On the loaded page" />
        <SuperAdminMetric label="Assigned city" value={seller.assignedCity || 'Unassigned'} icon="cities" />
        <SuperAdminMetric label="Account status" value={seller.status || 'active'} icon="security" />
      </div>
      <section className="super-admin-panel super-admin-profile-panel">
        <div className="super-admin-panel-heading"><div><h2>Seller profile</h2><p>Account details stored in eSakhi.</p></div></div>
        <dl className="super-admin-definition-list">
          <div><dt>Phone</dt><dd>{seller.phoneE164 || seller.phone || '—'}</dd></div>
          <div><dt>Email</dt><dd>{seller.email || '—'}</dd></div>
          <div><dt>City</dt><dd>{seller.assignedCity ? <Link to={`/super-admin/cities/${encodeURIComponent(seller.assignedCity)}`}>{seller.assignedCity}</Link> : 'Not assigned'}</dd></div>
          <div><dt>Account ID</dt><dd><code>{getId(seller)}</code></dd></div>
        </dl>
      </section>
      <section className="super-admin-panel super-admin-order-directory">
        <div className="super-admin-panel-heading"><div><h2>Seller products</h2><p>Inventory records linked to this seller.</p></div></div>
        {productsResult.error && <div className="super-admin-error" role="alert">{productsResult.error}<button onClick={() => void productsResult.reload()}>Retry</button></div>}
        {productsResult.loading ? <Loading label="Loading seller products…" /> : productsResult.data?.data.length ? <div className="super-admin-table-wrap"><table className="super-admin-table"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th></tr></thead><tbody>{productsResult.data.data.map((product) => <tr key={product._id}><td>{product.name}</td><td>{product.categoryName}<small>{product.subcategoryName}</small></td><td>{formatMoney(product.pricePaise)}</td><td>{product.variants?.length ? product.variants.reduce((total, variant) => total + variant.stock, 0) : product.stock}</td><td><StatusBadge value={product.isActive ? 'active' : product.isArchived ? 'archived' : 'inactive'} /></td></tr>)}</tbody></table></div> : <div className="super-admin-empty">No products are linked to this seller.</div>}
        {productsResult.data && productsResult.data.pagination.totalPages > 1 && <Pagination page={page} pages={productsResult.data.pagination.totalPages} onChange={setPage} />}
      </section>
    </div>
  );
}

function SuperAdminProductsPage(): ReactNode {
  const categories = useLoad(() => api.categories());
  const [page, setPage] = useState(1);
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const query = new URLSearchParams({ page: String(page), limit: '20', archived: 'false' });
  if (categoryId) query.set('categoryId', categoryId);
  if (subcategoryId) query.set('subcategoryId', subcategoryId);
  const result = useLoad(() => api.adminProducts(query), [page, categoryId, subcategoryId]);

  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading">
        <div><p className="super-admin-eyebrow">Operations</p><h1>Products & Inventory</h1><p>Review published products and stock data across all sellers.</p></div>
      </div>
      <div className="super-admin-metrics">
        <SuperAdminMetric label="Products" value={result.data?.pagination.total ?? 0} icon="products" detail="Live catalog entries" />
        <SuperAdminMetric label="Active" value={result.data?.data.filter((product) => product.isActive).length ?? 0} icon="overview" detail="Published products" />
        <SuperAdminMetric label="Low stock" value={result.data?.data.filter((product) => product.variants?.length ? product.variants.some((variant) => variant.stock <= product.lowStockThreshold) : product.stock <= product.lowStockThreshold).length ?? 0} icon="products" detail="At or below threshold" />
        <SuperAdminMetric label="Archived" value={result.data?.data.filter((product) => product.isArchived).length ?? 0} icon="security" detail="Hidden from catalogue" />
      </div>
      <section className="super-admin-panel super-admin-recent-orders">
        <div className="super-admin-panel-heading"><div><h2>Product inventory</h2><p>Product metadata and stock visibility for the marketplace.</p></div></div>
        {result.error && <div className="super-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
        {categories.error && <div className="super-admin-error" role="alert">{categories.error}<button onClick={() => void categories.reload()}>Retry categories</button></div>}
        <div className="admin-toolbar"><select aria-label="Filter products by main category" value={categoryId} onChange={(event) => { setPage(1); setCategoryId(event.target.value); setSubcategoryId(''); }}><option value="">All categories</option>{(categories.data ?? []).map((category) => <option key={category.categoryId} value={category.categoryId}>{category.categoryName}</option>)}</select><select aria-label="Filter products by subcategory" value={subcategoryId} disabled={!categoryId} onChange={(event) => { setPage(1); setSubcategoryId(event.target.value); }}><option value="">All subcategories</option>{(categories.data?.find((category) => category.categoryId === categoryId)?.subcategories ?? []).map((subcategory) => <option key={subcategory.subcategoryId} value={subcategory.subcategoryId}>{subcategory.subcategoryName}</option>)}</select></div>
        {result.loading ? <Loading label="Loading products…" /> : result.data?.data.length ? <div className="super-admin-table-wrap"><table className="super-admin-table"><thead><tr><th>Product</th><th>Seller</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th></tr></thead><tbody>{result.data.data.map((product) => <tr key={product._id}><td><Link to={`/super-admin/products/${product._id}`}>{product.name}</Link></td><td>{product.sellerId ? <Link to={`/super-admin/sellers/${product.sellerId}`}>{product.sellerId.slice(-6)}</Link> : 'Unassigned'}</td><td>{product.categoryName}<small>{product.subcategoryName}</small></td><td>{formatMoney(product.pricePaise)}</td><td>{product.variants?.length ? product.variants.reduce((sum, variant) => sum + variant.stock, 0) : product.stock}</td><td><StatusBadge value={product.isActive ? 'active' : product.isArchived ? 'archived' : 'inactive'} /></td></tr>)}</tbody></table></div> : !result.error && <div className="super-admin-empty">No products have been added to the catalog yet.</div>}
        {result.data && result.data.pagination.totalPages > 1 && <Pagination page={page} pages={result.data.pagination.totalPages} onChange={setPage} />}
      </section>
    </div>
  );
}

function SuperAdminProductDetailPage(): ReactNode {
  const { id = '' } = useParams();
  const result = useLoad(() => api.adminProduct(id), [id]);
  const product = result.data;
  if (result.loading) return <div className="super-admin-page"><Loading label="Loading product details…" /></div>;
  if (!product) return <div className="super-admin-page"><Notice tone="error">{result.error || 'Product not found.'}</Notice><Link className="super-admin-text-link" to="/super-admin/products">← Back to products</Link></div>;
  const stock = product.variants?.length ? product.variants.reduce((total, variant) => total + variant.stock, 0) : product.stock;
  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading"><div><p className="super-admin-eyebrow"><Link to="/super-admin/products">Products & Inventory</Link> / Product</p><h1>{product.name}</h1><p>{product.categoryName} · {product.subcategoryName} · product ID {product._id}</p></div></div>
      <div className="super-admin-metrics">
        <SuperAdminMetric label="Price" value={formatMoney(product.pricePaise)} icon="payments" />
        <SuperAdminMetric label="Stock" value={stock} icon="products" detail={`Low-stock threshold: ${product.lowStockThreshold}`} />
        <SuperAdminMetric label="Publication" value={product.isActive ? 'Published' : 'Not published'} icon="overview" />
        <SuperAdminMetric label="Archive status" value={product.isArchived ? 'Archived' : 'Available'} icon="security" />
      </div>
      <section className="super-admin-panel super-admin-profile-panel">
        <div className="super-admin-panel-heading"><div><h2>Product details</h2><p>Catalog data and seller ownership.</p></div></div>
        <dl className="super-admin-definition-list">
          <div><dt>Seller</dt><dd>{product.sellerId ? <Link to={`/super-admin/sellers/${product.sellerId}`}>{product.sellerId}</Link> : 'Not assigned'}</dd></div>
          <div><dt>Product ID</dt><dd><code>{product._id}</code></dd></div>
          <div><dt>Slug</dt><dd>{product.slug}</dd></div>
          <div><dt>Category</dt><dd>{product.categoryName} · {product.subcategoryName}</dd></div>
          <div><dt>Description</dt><dd>{product.description}</dd></div>
        </dl>
      </section>
      {product.variants.length > 0 && <section className="super-admin-panel super-admin-order-directory"><div className="super-admin-panel-heading"><div><h2>Variants & inventory</h2><p>Stock records by product variant.</p></div></div><div className="super-admin-table-wrap"><table className="super-admin-table"><thead><tr><th>SKU</th><th>Attributes</th><th>Stock</th></tr></thead><tbody>{product.variants.map((variant) => <tr key={variant._id}><td>{variant.sku || '—'}</td><td>{Object.entries(variant.attributes).map(([name, value]) => `${name}: ${value}`).join(', ') || '—'}</td><td>{variant.stock}</td></tr>)}</tbody></table></div></section>}
    </div>
  );
}

function SuperAdminDeliveryPartnersPage(): ReactNode {
  const [page, setPage] = useState(1);
  const result = useLoad(() => api.deliveryPartners(page, 20), [page]);
  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading"><div><p className="super-admin-eyebrow">Operations</p><h1>Delivery Partners</h1><p>Review partner accounts and their active assignment workload.</p></div></div>
      <div className="super-admin-metrics">
        <SuperAdminMetric label="Partner accounts" value={result.data?.pagination.total ?? '—'} icon="delivery" />
        <SuperAdminMetric label="Active on this page" value={result.data?.data.filter((partner) => partner.status === 'active').length ?? '—'} icon="overview" detail="Current page records" />
        <SuperAdminMetric label="Assigned orders" value={result.data?.data.reduce((total, partner) => total + partner.assignedCount, 0) ?? '—'} icon="orders" detail="Current page workload" />
        <SuperAdminMetric label="Disabled on this page" value={result.data?.data.filter((partner) => partner.status === 'disabled').length ?? '—'} icon="security" detail="Current page records" />
      </div>
      <section className="super-admin-panel super-admin-order-directory">
        <div className="super-admin-panel-heading"><div><h2>Partner directory</h2><p>Internal eSakhi delivery partner accounts.</p></div></div>
        {result.error && <div className="super-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
        {result.loading ? <Loading label="Loading delivery partners…" /> : result.data?.data.length ? <div className="super-admin-table-wrap"><table className="super-admin-table"><thead><tr><th>Partner</th><th>Phone</th><th>Email</th><th>Open assignments</th><th>Status</th></tr></thead><tbody>{result.data.data.map((partner) => <tr key={getId(partner)}><td><Link to={`/super-admin/delivery-partners/${getId(partner)}`}>{partner.name || 'Delivery Partner'}</Link></td><td>{partner.phoneE164 || '—'}</td><td>{partner.email || '—'}</td><td>{partner.assignedCount}</td><td><StatusBadge value={partner.status || 'active'} /></td></tr>)}</tbody></table></div> : <div className="super-admin-empty">No internal delivery partners are registered.</div>}
        {result.data && result.data.pagination.totalPages > 1 && <Pagination page={page} pages={result.data.pagination.totalPages} onChange={setPage} />}
      </section>
    </div>
  );
}

function SuperAdminDeliveryPartnerDetailPage(): ReactNode {
  const { id = '' } = useParams();
  const [page, setPage] = useState(1);
  const result = useLoad(() => api.deliveryPartner(id, page, 20), [id, page]);
  const details = result.data;
  const partner = details?.partner;
  if (result.loading) return <div className="super-admin-page"><Loading label="Loading delivery partner…" /></div>;
  if (!details || !partner) return <div className="super-admin-page"><Notice tone="error">{result.error || 'Delivery partner not found.'}</Notice><Link className="super-admin-text-link" to="/super-admin/delivery-partners">← Back to delivery partners</Link></div>;
  const cities = [...new Set(details.orders.data.map((order) => order.address?.city).filter((value): value is string => Boolean(value)))];
  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading"><div><p className="super-admin-eyebrow"><Link to="/super-admin/delivery-partners">Delivery Partners</Link> / Profile</p><h1>{partner.name || 'Delivery Partner'}</h1><p>Partner account and linked order assignments.</p></div></div>
      <div className="super-admin-metrics">
        <SuperAdminMetric label="Status" value={partner.status || 'active'} icon="security" />
        <SuperAdminMetric label="Active assignments" value={partner.assignedCount} icon="orders" />
        <SuperAdminMetric label="Orders on this page" value={details.orders.data.length} icon="delivery" />
        <SuperAdminMetric label="Cities on this page" value={cities.length} icon="cities" />
      </div>
      <section className="super-admin-panel super-admin-profile-panel">
        <div className="super-admin-panel-heading"><div><h2>Partner profile</h2><p>Account details and observed delivery locations.</p></div></div>
        <dl className="super-admin-definition-list">
          <div><dt>Phone</dt><dd>{partner.phoneE164 || partner.phone || '—'}</dd></div>
          <div><dt>Email</dt><dd>{partner.email || '—'}</dd></div>
          <div><dt>Account ID</dt><dd><code>{getId(partner)}</code></dd></div>
          <div><dt>Observed cities</dt><dd>{cities.length ? cities.map((city) => <Link key={city} to={`/super-admin/cities/${encodeURIComponent(city)}`}>{city}</Link>).reduce((prev, item) => <>{prev}, {item}</>, null as ReactNode) : 'No city on loaded orders'}</dd></div>
        </dl>
      </section>
      <section className="super-admin-panel super-admin-order-directory">
        <div className="super-admin-panel-heading"><div><h2>Partner orders</h2><p>Order records currently associated with this partner.</p></div></div>
        {details.orders.data.length ? <div className="super-admin-table-wrap"><table className="super-admin-table"><thead><tr><th>Order</th><th>Customer</th><th>City</th><th>Amount</th><th>Payment</th><th>Delivery status</th></tr></thead><tbody>{details.orders.data.map((order) => <tr key={order._id}><td><Link to={`/super-admin/orders/${order._id}`}>{order.orderReference}</Link></td><td>{order.customerId ? <Link to={`/super-admin/customers/${order.customerId}`}>{order.customerName}</Link> : order.customerName}</td><td>{order.address?.city ? <Link to={`/super-admin/cities/${encodeURIComponent(order.address.city)}`}>{order.address.city}</Link> : 'Pickup'}</td><td>{formatMoney(order.totalPaise)}</td><td>{order.paymentMethod.toUpperCase()} · {order.paymentStatus.replaceAll('_', ' ')}</td><td><StatusBadge value={order.fulfilmentStatus} /></td></tr>)}</tbody></table></div> : <div className="super-admin-empty">No orders are associated with this partner.</div>}
        {details.orders.pagination.totalPages > 1 && <Pagination page={page} pages={details.orders.pagination.totalPages} onChange={setPage} />}
      </section>
    </div>
  );
}

function SuperAdminExternalDeliveryProvidersPage(): ReactNode {
  return (
    <SuperAdminModulePage
      eyebrow="Operations"
      title="External Delivery Providers"
      description="Manage provider configurations, integration health, service coverage, and operational status."
      metrics={[
        { label: 'Configured Providers', value: '0', detail: 'Approved integrations', icon: 'providers' },
        { label: 'Active Providers', value: '0', detail: 'Operationally enabled', icon: 'overview' },
        { label: 'Needs Attention', value: '0', detail: 'Health or configuration issues', icon: 'support' },
        { label: 'Updated Today', value: '0', detail: 'Recently changed provider records', icon: 'reports' },
      ]}
      note="Integration state and operational status are tracked separately to avoid assuming a connected provider is active or serviceable."
    />
  );
}

function SuperAdminCustomersPage(): ReactNode {
  const [page, setPage] = useState(1);
  const result = useLoad(() => api.customers(page, 20), [page]);
  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading"><div><p className="super-admin-eyebrow">Operations</p><h1>Customers</h1><p>Customer accounts and real order history from the marketplace.</p></div></div>
      <div className="super-admin-metrics">
        <SuperAdminMetric label="Customer accounts" value={result.data?.pagination.total ?? '—'} icon="customers" />
        <SuperAdminMetric label="Active on this page" value={result.data?.data.filter((customer) => customer.status === 'active').length ?? '—'} icon="overview" detail="Current page records" />
        <SuperAdminMetric label="Disabled on this page" value={result.data?.data.filter((customer) => customer.status === 'disabled').length ?? '—'} icon="security" detail="Current page records" />
        <SuperAdminMetric label="Page" value={result.data?.pagination.page ?? '—'} icon="reports" />
      </div>
      <section className="super-admin-panel super-admin-order-directory">
        <div className="super-admin-panel-heading"><div><h2>Customer directory</h2><p>Select a customer to review their account and order activity.</p></div></div>
        {result.error && <div className="super-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
        {result.loading ? <Loading label="Loading customers…" /> : result.data?.data.length ? <div className="super-admin-table-wrap"><table className="super-admin-table"><thead><tr><th>Customer</th><th>Phone</th><th>Account status</th><th>Joined</th><th>Details</th></tr></thead><tbody>{result.data.data.map((customer) => <tr key={getId(customer)}><td><Link to={`/super-admin/customers/${getId(customer)}`}>{customer.name || 'Customer'}</Link></td><td>{customer.phoneE164 || customer.phone || '—'}</td><td><StatusBadge value={customer.status || 'active'} /></td><td>{customer.createdAt ? new Date(customer.createdAt).toLocaleDateString('en-IN') : '—'}</td><td><Link to={`/super-admin/customers/${getId(customer)}`}>View activity →</Link></td></tr>)}</tbody></table></div> : <div className="super-admin-empty">No customer accounts are registered yet.</div>}
        {result.data && result.data.pagination.totalPages > 1 && <Pagination page={page} pages={result.data.pagination.totalPages} onChange={setPage} />}
      </section>
    </div>
  );
}

function SuperAdminCustomerDetailPage(): ReactNode {
  const { id = '' } = useParams();
  const [page, setPage] = useState(1);
  const customerResult = useLoad(() => api.customer(id), [id]);
  const ordersResult = useLoad(() => api.customerOrders(id, page, 20), [id, page]);
  const customer = customerResult.data;
  if (customerResult.loading) return <div className="super-admin-page"><Loading label="Loading customer profile…" /></div>;
  if (!customer) return <div className="super-admin-page"><Notice tone="error">{customerResult.error || 'Customer not found.'}</Notice><Link className="super-admin-text-link" to="/super-admin/customers">← Back to customers</Link></div>;
  const visibleOrderValue = ordersResult.data?.data.filter((order) => order.fulfilmentStatus !== 'cancelled').reduce((total, order) => total + order.totalPaise, 0) ?? 0;
  const lastOrder = ordersResult.data?.data[0];
  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading"><div><p className="super-admin-eyebrow"><Link to="/super-admin/customers">Customers</Link> / Profile</p><h1>{customer.name || 'Customer'}</h1><p>{customer.phoneE164 || customer.phone || 'No phone on record'} · customer account activity</p></div></div>
      <div className="super-admin-metrics">
        <SuperAdminMetric label="Total orders" value={customer.orderCount} icon="orders" />
        <SuperAdminMetric label="Order value on this page" value={formatMoney(visibleOrderValue)} icon="payments" detail="Non-cancelled order totals · current page" />
        <SuperAdminMetric label="Last order" value={lastOrder?.createdAt ? new Date(lastOrder.createdAt).toLocaleDateString('en-IN') : '—'} icon="overview" />
        <SuperAdminMetric label="Account status" value={customer.status || 'active'} icon="security" />
      </div>
      <section className="super-admin-panel super-admin-profile-panel">
        <div className="super-admin-panel-heading"><div><h2>Customer profile</h2><p>Account identity and registration details.</p></div></div>
        <dl className="super-admin-definition-list">
          <div><dt>Phone</dt><dd>{customer.phoneE164 || customer.phone || '—'}</dd></div>
          <div><dt>Account ID</dt><dd><code>{getId(customer)}</code></dd></div>
          <div><dt>Joined</dt><dd>{customer.createdAt ? new Date(customer.createdAt).toLocaleString('en-IN') : '—'}</dd></div>
          <div><dt>Status</dt><dd><StatusBadge value={customer.status || 'active'} /></dd></div>
        </dl>
      </section>
      <section className="super-admin-panel super-admin-order-directory">
        <div className="super-admin-panel-heading"><div><h2>Order activity</h2><p>Orders, payment state, fulfilment state, and recorded status history.</p></div></div>
        {ordersResult.error && <div className="super-admin-error" role="alert">{ordersResult.error}<button onClick={() => void ordersResult.reload()}>Retry</button></div>}
        {ordersResult.loading ? <Loading label="Loading customer orders…" /> : ordersResult.data?.data.length ? (
          <div className="super-admin-activity-list">{ordersResult.data.data.map((order) => (
            <article className="super-admin-activity-card" key={order._id}>
              <div className="super-admin-activity-heading">
                <div><Link to={`/super-admin/orders/${order._id}`}>{order.orderReference}</Link><small>{order.createdAt ? new Date(order.createdAt).toLocaleString('en-IN') : 'Date unavailable'}</small></div>
                <strong>{formatMoney(order.totalPaise)}</strong>
              </div>
              <p>{order.items.map((item) => `${item.productName} × ${item.quantity}`).join(', ') || 'No item details'} · {order.paymentMethod.toUpperCase()} · {order.paymentStatus.replaceAll('_', ' ')}</p>
              <div className="super-admin-activity-heading"><span><StatusBadge value={order.fulfilmentStatus} /> {order.address?.city && <Link to={`/super-admin/cities/${encodeURIComponent(order.address.city)}`}>{order.address.city}</Link>}</span></div>
              {order.statusHistory?.length ? <details><summary>Order status history ({order.statusHistory.length})</summary><ol>{order.statusHistory.map((event, index) => <li key={`${event.status}-${event.changedAt}-${index}`}><strong>{orderStatusLabel(event.status)}</strong><small>{new Date(event.changedAt).toLocaleString('en-IN')}{event.note ? ` · ${event.note}` : ''}</small></li>)}</ol></details> : <small>No status changes recorded.</small>}
            </article>
          ))}</div>
        ) : <div className="super-admin-empty">No orders are recorded for this customer.</div>}
        {ordersResult.data && ordersResult.data.pagination.totalPages > 1 && <Pagination page={page} pages={ordersResult.data.pagination.totalPages} onChange={setPage} />}
      </section>
    </div>
  );
}

function SuperAdminSupportPage(): ReactNode {
  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading">
        <div>
          <p className="super-admin-eyebrow">Operations</p>
          <h1>Support, Return Disputes & Refunds</h1>
          <p>Track return disputes, 1-click customer refund disbursements, and monthly penalty deductions across the marketplace.</p>
        </div>
      </div>
      <SuperAdminRefundsAndSettlementsView />
    </div>
  );
}

function SuperAdminPaymentsPage(): ReactNode {
  const [page, setPage] = useState(1);
  const [paymentStatus, setPaymentStatus] = useState('');
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (paymentStatus) query.set('paymentStatus', paymentStatus);
  const result = useLoad(() => api.superAdminOrders(query), [page, paymentStatus]);
  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading"><div><p className="super-admin-eyebrow">Finance</p><h1>Payments & Reconciliation</h1><p>Review payment method and verification state recorded on each order.</p></div></div>
      <section className="super-admin-panel super-admin-order-directory">
        <div className="super-admin-order-tools">
          <label className="super-admin-search"><span aria-hidden="true">⌕</span><span>Filter payment status</span></label>
          <select aria-label="Filter by payment status" value={paymentStatus} onChange={(event) => { setPage(1); setPaymentStatus(event.target.value); }}>
            <option value="">All payment states</option><option value="pending_verification">Awaiting verification</option><option value="confirmed">Confirmed</option><option value="rejected">Rejected</option>
          </select>
        </div>
        {result.error && <div className="super-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
        {result.loading ? <Loading label="Loading payment records…" /> : result.data?.data.length ? <div className="super-admin-table-wrap"><table className="super-admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Method</th><th>Amount</th><th>Payment status</th><th>Order status</th><th>City</th></tr></thead><tbody>{result.data.data.map((order) => <tr key={order._id}><td><Link to={`/super-admin/orders/${order._id}`}>{order.orderReference}</Link></td><td>{order.customerId ? <Link to={`/super-admin/customers/${order.customerId}`}>{order.customerName}</Link> : order.customerName}</td><td>{order.paymentMethod.toUpperCase()}</td><td>{formatMoney(order.totalPaise)}</td><td><StatusBadge value={order.paymentStatus} /></td><td><StatusBadge value={order.fulfilmentStatus} /></td><td>{order.address?.city ? <Link to={`/super-admin/cities/${encodeURIComponent(order.address.city)}`}>{order.address.city}</Link> : 'Pickup'}</td></tr>)}</tbody></table></div> : <div className="super-admin-empty">No order payment records match this filter. Refunds, deposits, and COD reconciliation are not stored separately.</div>}
        {result.data && result.data.pagination.totalPages > 1 && <Pagination page={page} pages={result.data.pagination.totalPages} onChange={setPage} />}
      </section>
    </div>
  );
}

function SuperAdminRefundsPage(): ReactNode {
  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading">
        <div>
          <p className="super-admin-eyebrow">Finance</p>
          <h1>1-Click Refunds & Dispute Escalations</h1>
          <p>Disburse refunds directly to linked Customer Bank Accounts for READY_FOR_REFUND orders and manage penalty ledgers.</p>
        </div>
      </div>
      <SuperAdminRefundsAndSettlementsView />
    </div>
  );
}

function SuperAdminSettlementsPage(): ReactNode {
  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading">
        <div>
          <p className="super-admin-eyebrow">Finance</p>
          <h1>Seller Monthly Settlements & Penalty Deductions</h1>
          <p>Review Gross Monthly Payout − Accumulated Penalty Deductions = Final Net Monthly Settlement by seller or SHG.</p>
        </div>
      </div>
      <SuperAdminRefundsAndSettlementsView />
    </div>
  );
}

function SuperAdminPayoutsPage(): ReactNode {
  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading">
        <div>
          <p className="super-admin-eyebrow">Finance</p>
          <h1>Delivery Partner Payouts & Transit Penalty Ledger</h1>
          <p>Track partner delivery earnings, transit damage penalty deductions, and monthly pay slip settlement balances.</p>
        </div>
      </div>
      <SuperAdminRefundsAndSettlementsView />
    </div>
  );
}

function SuperAdminReportsPage(): ReactNode {
  const overviewResult = useLoad(() => api.superAdminOverview(30), []);
  const citiesResult = useLoad(() => api.superAdminCities(), []);
  const overview = overviewResult.data;
  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading"><div><p className="super-admin-eyebrow">Management</p><h1>Reports & Analytics</h1><p>Platform-level order activity from the current reporting API.</p></div></div>
      {overviewResult.error && <div className="super-admin-error" role="alert">{overviewResult.error}<button onClick={() => void overviewResult.reload()}>Retry</button></div>}
      {overviewResult.loading ? <Loading label="Loading platform reports…" /> : overview && (
        <>
          <div className="super-admin-metrics">
            <SuperAdminMetric label="Total orders" value={overview.metrics.totalOrders} icon="orders" />
            <SuperAdminMetric label="Order value" value={formatMoney(overview.metrics.orderValuePaise)} icon="payments" detail="Non-cancelled order totals, not revenue" />
            <SuperAdminMetric label="Active customers" value={overview.metrics.activeCustomers} icon="customers" />
            <SuperAdminMetric label="Cities in records" value={citiesResult.data?.length ?? '—'} icon="cities" />
          </div>
          <div className="super-admin-overview-grid">
            <section className="super-admin-panel super-admin-performance"><div className="super-admin-panel-heading"><div><h2>Order activity</h2><p>Orders created over the last 30 days.</p></div></div><SuperAdminOrdersChart data={overview.ordersOverTime} /></section>
            <section className="super-admin-panel super-admin-status-panel"><div className="super-admin-panel-heading"><div><h2>Fulfilment breakdown</h2><p>Current order states.</p></div></div><SuperAdminStatusBreakdown statuses={overview.ordersByFulfilmentStatus} /></section>
          </div>
          <p className="super-admin-data-note">Financial ledgers, refunds, settlements, provider performance, and support case reporting are not available in the current backend.</p>
        </>
      )}
    </div>
  );
}

function SuperAdminSettingsPage(): ReactNode {
  return <AdminSettingsPage />;
}

function SuperAdminRolesPage(): ReactNode {
  const rows: ReactNode[][] = [
    ['Super Admin', 'Platform-wide', 'Global operations and platform configuration', <Link key="access" to="/super-admin">Open workspace</Link>],
    ['City Admin', 'Assigned city', 'City-scoped order operations; cannot grant broader roles', <Link key="access" to="/super-admin/city-administrators">City Admin directory</Link>],
    ['Seller', 'Own account', 'Own products and seller order items', <Link key="access" to="/super-admin/sellers">Seller directory</Link>],
    ['Delivery Partner', 'Own assignments', 'Assigned delivery updates and history', <Link key="access" to="/super-admin/delivery-partners">Partner directory</Link>],
    ['Customer', 'Own account', 'Own profile, addresses, and orders', <Link key="access" to="/super-admin/customers">Customer directory</Link>],
  ];
  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading"><div><p className="super-admin-eyebrow">Management</p><h1>Roles & Permissions</h1><p>Current application roles and their backend-enforced scope. Permissions are not editable from this screen.</p></div></div>
      <section className="super-admin-panel super-admin-order-directory">
        <div className="super-admin-table-wrap"><table className="super-admin-table"><thead><tr><th>Role</th><th>Scope</th><th>Current access summary</th><th>Related page</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${String(row[0])}-${index}`}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>
      </section>
      <p className="super-admin-data-note">The role labels summarize existing route authorization. They are not a configurable permission matrix; server middleware remains authoritative.</p>
    </div>
  );
}

function SuperAdminSecurityPage(): ReactNode {
  const [page, setPage] = useState(1);
  const result = useLoad(() => api.superAdminAuditLogs(page, 20), [page]);
  const affectedRecordLink = (entry: AuditLogEntry): string | null => {
    if (entry.resourceType === 'order') return `/super-admin/orders/${encodeURIComponent(entry.resourceId)}`;
    if (entry.resourceType === 'user' && (entry.action.includes('city_admin') || entry.metadata?.role === 'city_admin')) return `/super-admin/city-administrators/${encodeURIComponent(entry.resourceId)}`;
    if (entry.resourceType === 'user' && entry.metadata?.role === 'seller') return `/super-admin/sellers/${encodeURIComponent(entry.resourceId)}`;
    return null;
  };
  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading"><div><p className="super-admin-eyebrow">Management</p><h1>Security & Audit Logs</h1><p>Recent recorded actions, actor identities, and affected database records.</p></div></div>
      <div className="super-admin-metrics"><SuperAdminMetric label="Audit entries" value={result.data?.pagination.total ?? '—'} icon="security" detail="Persisted audit log records" /></div>
      <section className="super-admin-panel super-admin-order-directory">
        {result.error && <div className="super-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
        {result.loading ? <Loading label="Loading audit logs…" /> : result.data?.data.length ? <div className="super-admin-table-wrap"><table className="super-admin-table"><thead><tr><th>Timestamp</th><th>Actor</th><th>Role</th><th>Action</th><th>Affected record</th></tr></thead><tbody>{result.data.data.map((entry) => {
          const target = affectedRecordLink(entry);
          const actor = entry.actorId;
          return <tr key={entry._id}>
            <td>{new Date(entry.createdAt).toLocaleString('en-IN')}</td>
            <td>{actor?.name || actor?.phoneE164 || (entry.actorType === 'system' ? 'System' : 'Unknown')}</td>
            <td>{actor?.role || entry.actorType}</td>
            <td>{entry.action.replaceAll('.', ' ')}</td>
            <td>{target ? <Link to={target}>{entry.resourceType} · {entry.resourceId}</Link> : <span>{entry.resourceType} · {entry.resourceId}</span>}</td>
          </tr>;
        })}</tbody></table></div> : <div className="super-admin-empty">No audit records are available.</div>}
        {result.data && result.data.pagination.totalPages > 1 && <Pagination page={page} pages={result.data.pagination.totalPages} onChange={setPage} />}
      </section>
      <p className="super-admin-data-note">The current audit schema does not record IP addresses or a standardized success/result field, so those values are not displayed.</p>
    </div>
  );
}

function SuperAdminOverviewPage(): ReactNode {
  const [days, setDays] = useState(30);
  const result = useLoad(() => api.superAdminOverview(days), [days]);
  useRefreshOnFocus(result.reload);
  const overview = result.data;
  const metrics = overview?.metrics;

  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading">
        <div><p className="super-admin-eyebrow">Dashboard</p><h1>Platform Overview</h1><p>Monitor eSakhi operations and platform activity.</p></div>
        <Link className="super-admin-primary-action" to="/super-admin/cities">＋ Manage Cities</Link>
      </div>
      {result.error && <div className="super-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
      {result.loading ? <Loading label="Loading global overview…" /> : overview && metrics ? (
        <>
          <div className="super-admin-live-caption"><span className="super-admin-live-dot" /> Live database data <span>Updated {new Date(overview.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span></div>
          <div className="super-admin-metrics">
            <SuperAdminMetric label="Total Orders" value={metrics.totalOrders} icon="orders" />
            <SuperAdminMetric label="Order Value" value={formatMoney(metrics.orderValuePaise)} icon="payments" detail="Non-cancelled order totals · not revenue" />
            <SuperAdminMetric label="Active Customers" value={metrics.activeCustomers} icon="customers" />
            <SuperAdminMetric label="Delivery Partners" value={metrics.activeDeliveryPartners} icon="delivery" />
            <SuperAdminMetric label="Orders Needing Action" value={metrics.ordersNeedingAction} icon="support" />
            <SuperAdminMetric label="Payments to Review" value={metrics.pendingPayments} icon="payments" />
            <SuperAdminMetric label="Unassigned Deliveries" value={metrics.unassignedDeliveryOrders} icon="providers" />
            <SuperAdminMetric label="Low-Stock Items" value={metrics.lowStockItems} icon="products" />
          </div>
          <div className="super-admin-insight-grid">
            <section className="super-admin-panel super-admin-performance">
              <div className="super-admin-panel-heading">
                <div><h2>Order Activity</h2><p>Orders created over time</p></div>
                <select aria-label="Order activity date range" value={days} onChange={(event) => setDays(Number(event.target.value))}>
                  <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option>
                </select>
              </div>
              <SuperAdminOrdersChart data={overview.ordersOverTime} />
            </section>
            <section className="super-admin-panel super-admin-status-panel">
              <div className="super-admin-panel-heading"><div><h2>Order Status</h2><p>Current fulfilment breakdown</p></div></div>
              <SuperAdminStatusBreakdown statuses={overview.ordersByFulfilmentStatus} />
            </section>
          </div>
          <div className="super-admin-lower-grid">
            <section className="super-admin-panel super-admin-recent-orders">
              <div className="super-admin-panel-heading"><div><h2>Recent Orders</h2><p>Latest orders recorded on the platform</p></div><Link to="/super-admin/orders" className="super-admin-text-link">View all <span aria-hidden="true">→</span></Link></div>
              {overview.recentOrders.length ? <SuperAdminOrderTable orders={overview.recentOrders} /> : <div className="super-admin-empty">No orders have been recorded yet.</div>}
            </section>
            <section className="super-admin-panel super-admin-attention-panel">
              <div className="super-admin-panel-heading"><div><h2>Needs Attention</h2><p>Live work queues and inventory alerts</p></div></div>
              <div className="super-admin-attention-list">
                <Link to="/super-admin/orders?paymentStatus=pending_verification" className="super-admin-attention-row"><span className="super-admin-attention-icon is-amber">₨</span><span><strong>Payments to review</strong><small>Awaiting verification</small></span><b>{metrics.pendingPayments}</b></Link>
                <Link to="/super-admin/orders" className="super-admin-attention-row"><span className="super-admin-attention-icon is-purple">↗</span><span><strong>Orders needing action</strong><small>Open fulfilment work</small></span><b>{metrics.ordersNeedingAction}</b></Link>
                <Link to="/super-admin/orders" className="super-admin-attention-row"><span className="super-admin-attention-icon is-blue">⇄</span><span><strong>Unassigned deliveries</strong><small>Delivery orders without a partner</small></span><b>{metrics.unassignedDeliveryOrders}</b></Link>
                <div className="super-admin-attention-row is-unavailable"><span className="super-admin-attention-icon is-red">!</span><span><strong>Low-stock items</strong><small>Inventory detail page is not available</small></span><b>{metrics.lowStockItems}</b></div>
              </div>
            </section>
          </div>
          <SuperAdminRefundsAndSettlementsView />
          <p className="super-admin-data-note">Order value is a sum of non-cancelled order totals; it is not platform revenue, verified collections, or a settlement balance.</p>
        </>
      ) : null}
    </div>
  );
}

function SuperAdminOrdersPage(): ReactNode {
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [queryText, setQueryText] = useState('');
  const [paymentStatus, setPaymentStatus] = useState(() => searchParams.get('paymentStatus') ?? '');
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (queryText.trim()) query.set('q', queryText.trim());
  if (paymentStatus) query.set('paymentStatus', paymentStatus);
  const result = useLoad(() => api.superAdminOrders(query), [page, queryText, paymentStatus]);
  useRefreshOnFocus(result.reload);

  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading">
        <div><p className="super-admin-eyebrow">Operations</p><h1>Orders & Assignments</h1><p>Read-only order records, 1-click refund queue, and current payment and fulfilment states.</p></div>
      </div>
      {result.error && <div className="super-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
      <SuperAdminRefundsAndSettlementsView />
      <section className="super-admin-panel super-admin-order-directory">
        <div className="super-admin-order-tools">
          <label className="super-admin-search"><span aria-hidden="true">⌕</span><input aria-label="Search order reference or customer" placeholder="Search order or customer" value={queryText} onChange={(event) => { setPage(1); setQueryText(event.target.value); }} /></label>
          <select aria-label="Filter by payment status" value={paymentStatus} onChange={(event) => { setPage(1); setPaymentStatus(event.target.value); }}>
            <option value="">All payment states</option><option value="pending_verification">Awaiting review</option><option value="confirmed">Confirmed</option><option value="rejected">Rejected</option>
          </select>
        </div>
        {result.loading ? <Loading label="Loading orders…" /> : result.data?.data.length ? <SuperAdminOrderTable orders={result.data.data} /> : <div className="super-admin-empty">No orders match these filters.</div>}
        {result.data && result.data.pagination.totalPages > 1 && <Pagination page={page} pages={result.data.pagination.totalPages} onChange={setPage} />}
      </section>
    </div>
  );
}

function SuperAdminOrderDetailPage(): ReactNode {
  const { id = '' } = useParams();
  const result = useLoad(() => api.adminOrder(id), [id]);
  useRefreshOnFocus(result.reload);
  const order = result.data;
  if (result.loading) return <div className="super-admin-page"><Loading label="Loading order details…" /></div>;
  if (!order) return <div className="super-admin-page"><Notice tone="error">{result.error || 'Order not found.'}</Notice><Link className="super-admin-text-link" to="/super-admin/orders">← Back to orders</Link></div>;
  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading"><div><p className="super-admin-eyebrow"><Link to="/super-admin/orders">Orders & Assignments</Link> / Order</p><h1>{order.orderReference}</h1><p>{order.createdAt ? new Date(order.createdAt).toLocaleString('en-IN') : 'Date unavailable'} · {order.items.length} line item(s)</p></div></div>
      <div className="super-admin-metrics">
        <SuperAdminMetric label="Total" value={formatMoney(order.totalPaise)} icon="payments" />
        <SuperAdminMetric label="Payment" value={order.paymentStatus.replaceAll('_', ' ')} icon="payments" detail={order.paymentMethod.toUpperCase()} />
        <SuperAdminMetric label="Fulfilment" value={orderStatusLabel(order.fulfilmentStatus)} icon="orders" />
        <SuperAdminMetric label="Delivery" value={order.deliveryPartner?.name || 'Unassigned'} icon="delivery" />
      </div>
      <div className="super-admin-detail-grid">
        <section className="super-admin-panel super-admin-profile-panel">
          <div className="super-admin-panel-heading"><div><h2>Customer, Seller & Governance</h2><p>Read-only multi-role order participants and locations.</p></div></div>
          <dl className="super-admin-definition-list">
            <div><dt>Customer</dt><dd>{order.customerId ? <Link to={`/super-admin/customers/${order.customerId}`}>{order.customerName}</Link> : order.customerName}</dd></div>
            <div><dt>Customer phone</dt><dd>{order.customerPhoneE164 || order.customerPhone || '—'}</dd></div>
            <div><dt>Seller / SHG</dt><dd>{order.sellerPickup?.sellerId ? <Link to={`/super-admin/sellers/${order.sellerPickup.sellerId}`}>{order.sellerPickup.sellerName}</Link> : order.sellerPickup?.sellerName || '—'}</dd></div>
            <div><dt>Seller pickup address</dt><dd>{order.sellerPickup ? `${order.sellerPickup.address}, ${order.sellerPickup.city}${order.sellerPickup.latitude !== undefined && order.sellerPickup.longitude !== undefined ? ` (${order.sellerPickup.latitude.toFixed(4)}, ${order.sellerPickup.longitude.toFixed(4)})` : ''}` : '—'}</dd></div>
            <div><dt>City</dt><dd>{order.address?.city ? <Link to={`/super-admin/cities/${encodeURIComponent(order.address.city)}`}>{order.address.city}</Link> : 'Pickup'}</dd></div>
            <div><dt>City Admin responsible</dt><dd>{order.cityAdminDetails?.id ? <Link to={`/super-admin/city-admins/${order.cityAdminDetails.id}`}>{order.cityAdminDetails.name}</Link> : order.cityAdminDetails?.name || '—'}{order.cityAdminDetails?.phoneE164 ? ` · ${order.cityAdminDetails.phoneE164}` : ''}</dd></div>
            <div><dt>Locality</dt><dd>{order.address?.locality || '—'}</dd></div>
            <div><dt>Delivery partner</dt><dd>{order.deliveryPartner?.userId ? <Link to={`/super-admin/delivery-partners/${order.deliveryPartner.userId}`}>{order.deliveryPartner.name}</Link> : order.deliveryPartner?.name || 'Not assigned'}{order.deliveryPartner?.distanceKm !== undefined && order.deliveryPartner?.distanceKm !== null ? ` (${order.deliveryPartner.distanceKm} km from Seller)` : ''}</dd></div>
          </dl>
        </section>
        <section className="super-admin-panel super-admin-profile-panel">
          <div className="super-admin-panel-heading"><div><h2>Payment and fulfilment</h2><p>Current states recorded on the order.</p></div></div>
          <dl className="super-admin-definition-list">
            <div><dt>Payment method</dt><dd>{order.paymentMethod.toUpperCase()}</dd></div>
            <div><dt>Payment status</dt><dd><StatusBadge value={order.paymentStatus} /></dd></div>
            <div><dt>Fulfilment method</dt><dd>{order.fulfilmentMethod}</dd></div>
            <div><dt>Fulfilment status</dt><dd><StatusBadge value={order.fulfilmentStatus} /></dd></div>
            <div><dt>Subtotal</dt><dd>{formatMoney(order.subtotalPaise)}</dd></div>
            <div><dt>Delivery fee</dt><dd>{formatMoney(order.deliveryFeePaise)}</dd></div>
          </dl>
        </section>
      </div>
      <section className="super-admin-panel">
        <div className="super-admin-panel-heading"><div><h2>Items</h2><p>Product snapshots recorded when the order was placed.</p></div></div>
        <div className="super-admin-table-wrap"><table className="super-admin-table"><thead><tr><th>Product</th><th>Quantity</th><th>Unit price</th><th>Line total</th></tr></thead><tbody>{order.items.map((item, index) => <tr key={`${item.productId}-${index}`}><td>{item.productName}</td><td>{item.quantity}</td><td>{formatMoney(item.unitPricePaise)}</td><td>{formatMoney(item.lineTotalPaise)}</td></tr>)}</tbody></table></div>
      </section>
      <section className="super-admin-panel">
        <div className="super-admin-panel-heading"><div><h2>Order activity</h2><p>Recorded fulfilment and payment events.</p></div></div>
        <div className="super-admin-timeline">
          {order.statusHistory?.map((event, index) => <div className="super-admin-timeline-item" key={`${event.status}-${event.changedAt}-${index}`}><span className="super-admin-timeline-dot" /><div><strong>{orderStatusLabel(event.status)}</strong><small>{new Date(event.changedAt).toLocaleString('en-IN')}{event.note ? ` · ${event.note}` : ''}</small></div></div>)}
          {order.paymentEvents?.map((event, index) => <div className="super-admin-timeline-item" key={`payment-${event.createdAt}-${index}`}><span className="super-admin-timeline-dot is-payment" /><div><strong>Payment {event.status.replaceAll('_', ' ')}</strong><small>{new Date(event.createdAt).toLocaleString('en-IN')} · {event.note}</small></div></div>)}
          {!order.statusHistory?.length && !order.paymentEvents?.length && <div className="super-admin-empty">No activity events are recorded on this order.</div>}
        </div>
      </section>
    </div>
  );
}

function SuperAdminIcon({ name }: { name: string }): ReactNode {
  const paths: Record<string, string> = {
    overview: 'M3 3h7v7H3z M14 3h7v4h-7z M14 11h7v10h-7z M3 14h7v7H3z',
    cities: 'M3 21h18 M5 21V7l7-4 7 4v14 M9 9h1 M14 9h1 M9 13h1 M14 13h1 M11 21v-4h2v4',
    administrators: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 8v6 M17 11h6',
    sellers: 'M3 10h18 M5 10l1-6h12l1 6 M5 10v10h14V10 M9 20v-6h6v6',
    products: 'M4 5h16l1 4H3l1-4z M5 9v11h14V9 M9 13h6 M9 17h6',
    orders: 'M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h5',
    delivery: 'M3 6h11v11H3z M14 10h4l3 3v4h-7z M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
    providers: 'M12 3v18 M3 12h18 M5.6 5.6l12.8 12.8 M18.4 5.6 5.6 18.4',
    customers: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 8v6',
    support: 'M12 18h.01 M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
    payments: 'M3 6h18v12H3z M3 10h18 M7 15h4',
    refunds: 'M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5',
    settlements: 'M4 5h16v14H4z M8 9h8 M8 13h5',
    payouts: 'M12 3v13 M7 11l5 5 5-5 M4 21h16',
    compensation: 'M12 2v20 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
    reports: 'M4 19V5 M4 19h17 M8 15l4-4 3 2 5-7',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.6 2.8-.2-.1a1.7 1.7 0 0 0-1.9.3l-.1.1h-3.2l-.1-.2a1.7 1.7 0 0 0-1.7-1l-.2.1-2.8-1.6.1-.2a1.7 1.7 0 0 0-.3-1.9l-.1-.1v-3.2l.2-.1a1.7 1.7 0 0 0 1-1.7l-.1-.2 1.6-2.8.2.1a1.7 1.7 0 0 0 1.9-.3l.1-.1h3.2l.1.2a1.7 1.7 0 0 0 1.7 1l.2-.1 2.8 1.6-.1.2a1.7 1.7 0 0 0 .3 1.9l.1.1v3.2z',
    roles: 'M12 15l-3 1.6.6-3.4-2.5-2.4 3.4-.5L12 7l1.5 3.3 3.4.5-2.5 2.4.6 3.4z M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
    security: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z M9 12l2 2 4-4',
  };
  return <svg className="super-admin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.overview} /></svg>;
}

function SuperAdminMetric({ label, value, icon, detail }: { label: string; value: string | number; icon: string; detail?: string }): ReactNode {
  return <article className="super-admin-metric"><div className="super-admin-metric-top"><span>{label}</span><SuperAdminIcon name={icon} /></div><strong>{typeof value === 'number' ? value.toLocaleString('en-IN') : value}</strong><small>{detail ?? 'Live database count'}</small></article>;
}

function SuperAdminRecordTable({
  title,
  description,
  empty,
  headers,
  rows,
}: {
  title: string;
  description: string;
  empty: string;
  headers: string[];
  rows: ReactNode[][];
}): ReactNode {
  return (
    <section className="super-admin-panel super-admin-order-directory">
      <div className="super-admin-panel-heading"><div><h2>{title}</h2><p>{description}</p></div></div>
      {rows.length ? <div className="super-admin-table-wrap"><table className="super-admin-table"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div> : <div className="super-admin-empty">{empty}</div>}
    </section>
  );
}

function SuperAdminOrdersChart({ data }: { data: Array<{ day: string; count: number }> }): ReactNode {
  if (!data.length) return <div className="super-admin-empty">No order activity is available for this period.</div>;
  const max = Math.max(...data.map(({ count }) => count), 1);
  const points = data.map(({ count }, index) => {
    const x = data.length === 1 ? 300 : 34 + (index / (data.length - 1)) * 532;
    const y = 174 - (count / max) * 142;
    return { x, y, day: data[index].day, count };
  });
  const line = points.map(({ x, y }, index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ');
  const area = `${line} L ${points[points.length - 1].x} 182 L ${points[0].x} 182 Z`;
  const labelIndexes = data.length <= 7
    ? data.map((_, index) => index)
    : [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])];
  return (
    <div className="super-admin-chart">
      <svg viewBox="0 0 600 220" role="img" aria-label={`Orders per day over the last ${data.length} days`}>
        {[40, 85, 130, 175].map((y, index) => <g key={y}><line x1="34" y1={y} x2="566" y2={y} className="super-admin-chart-grid" /><text x="27" y={y + 3} textAnchor="end">{Math.round(max * (3 - index) / 3)}</text></g>)}
        <path d={area} className="super-admin-chart-area" />
        <path d={line} className="super-admin-chart-line" />
        {points.map(({ x, y, day, count }) => <circle key={day} cx={x} cy={y} r={data.length > 10 ? 2.5 : 4} className="super-admin-chart-point"><title>{`${day}: ${count} orders`}</title></circle>)}
        {labelIndexes.map((index) => <text key={index} x={points[index].x} y="210" textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>{new Date(`${points[index].day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</text>)}
      </svg>
    </div>
  );
}

function SuperAdminStatusBreakdown({ statuses }: { statuses: Array<{ status: string; count: number }> }): ReactNode {
  const total = statuses.reduce((sum, item) => sum + item.count, 0);
  const colors: Record<string, string> = {
    placed: '#d99116', order_confirmed: '#d99116', accepted: '#7351a6', preparing: '#ce6d3d', ready_for_pickup: '#3e81ae',
    delivery_partner_assigned: '#2563eb', out_for_pickup: '#0891b2', picked_up: '#7c3aed',
    out_for_delivery: '#a43d83', delivered: '#21865b', completed: '#597e70', cancelled: '#c4c6ce', delivery_failed: '#d94b4b',
  };
  let offset = 0;
  const segments = statuses.filter(({ count }) => count > 0).map(({ status, count }) => {
    const start = offset;
    offset += total ? (count / total) * 100 : 0;
    return `${colors[status] ?? '#9ca3af'} ${start}% ${offset}%`;
  });
  return (
    <div className="super-admin-status-content">
      {total ? <div className="super-admin-donut" style={{ background: `conic-gradient(${segments.join(', ')})` }} role="img" aria-label={`Fulfilment status breakdown for ${total} orders`}><span><strong>{total.toLocaleString('en-IN')}</strong><small>Orders</small></span></div> : <div className="super-admin-donut is-empty"><span><strong>0</strong><small>Orders</small></span></div>}
      <div className="super-admin-status-legend">
        {statuses.length ? statuses.map(({ status, count }) => <div key={status}><span><i style={{ backgroundColor: colors[status] ?? '#9ca3af' }} />{orderStatusLabel(status)}</span><strong>{count.toLocaleString('en-IN')}</strong></div>) : <p>No fulfilment records yet.</p>}
      </div>
    </div>
  );
}

function SuperAdminOrderTable({ orders }: { orders: SuperAdminOrder[] }): ReactNode {
  return (
    <div className="super-admin-table-wrap">
      <table className="super-admin-table">
        <thead><tr><th>Order</th><th>Customer</th><th>Seller</th><th>City & Admin</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>Assigned partner</th><th>Timestamps</th></tr></thead>
        <tbody>{orders.map((order) => (
          <tr key={order._id}>
            <td><Link to={`/super-admin/orders/${order._id}`}>{order.orderReference}</Link><small>{order._id}</small></td>
            <td>{order.customerId ? <Link to={`/super-admin/customers/${order.customerId}`}>{order.customerName}</Link> : order.customerName}</td>
            <td>{order.sellerDetails?.sellerName || order.sellerPickup?.sellerName || '—'}<small>{order.sellerDetails?.phoneE164 || order.sellerPickup?.phoneE164 || ''}</small></td>
            <td>
              {order.address?.city ? <Link to={`/super-admin/cities/${encodeURIComponent(order.address.city)}`}>{order.address.city}</Link> : 'Pickup'}
              <small>{order.cityAdminDetails?.name ? `Admin: ${order.cityAdminDetails.name}` : '—'}</small>
            </td>
            <td className="super-admin-order-items">{order.items.map((item) => item.productName).slice(0, 2).join(', ')}{order.items.length > 2 ? ` +${order.items.length - 2}` : ''}</td>
            <td>{formatMoney(order.totalPaise)}</td>
            <td><span className="super-admin-payment">{order.paymentMethod.toUpperCase()}</span><small>{order.paymentStatus.replaceAll('_', ' ')}</small></td>
            <td><span className={`super-admin-status-badge status-${order.fulfilmentStatus}`}>{orderStatusLabel(order.fulfilmentStatus)}</span></td>
            <td>
              {order.deliveryPartner?.userId ? <Link to={`/super-admin/delivery-partners/${order.deliveryPartner.userId}`}>{order.deliveryPartner.name}</Link> : order.deliveryPartner?.name || '—'}
              {order.deliveryPartner?.distanceKm !== undefined && order.deliveryPartner?.distanceKm !== null && <small>{order.deliveryPartner.distanceKm} km from Seller</small>}
            </td>
            <td>
              <small>Placed: {new Date(order.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</small>
              {order.updatedAt && <small>Updated: {new Date(order.updatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</small>}
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function CityAdminGate({ children }: { children: ReactNode }): ReactNode {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) return <div className="page-container"><Loading label="Checking your session…" /></div>;
  if (!user) {
    return <div className="page-container narrow"><PageIntro eyebrow="Protected workspace" title="City Admin sign-in required" description="Sign in with the account assigned to this city." /><Link to="/sign-in" state={{ from: location.pathname }} className="button">Sign in</Link></div>;
  }
  if (user.role !== 'city_admin') {
    return <div className="page-container narrow"><Notice tone="error">This workspace requires a City Admin account. Other role permissions cannot access this city dashboard.</Notice><Link to="/" className="button button-outline">Return to the store</Link></div>;
  }
  if (!user.assignedCity) {
    return <div className="page-container narrow"><Notice tone="error">This account has no assigned city. Contact a Super Admin to configure its city scope.</Notice></div>;
  }
  return <CityAdminLayout>{children}</CityAdminLayout>;
}

const cityAdminNavGroups = [
  { label: 'Main', items: [{ label: 'Overview', icon: 'overview', path: '/city-admin' }] },
  {
    label: 'Local Operations',
    items: [
      { label: 'My Service Zones', icon: 'cities', path: '/city-admin/service-zones' },
      { label: 'Sellers & SHGs', icon: 'sellers', path: '/city-admin/sellers' },
      { label: 'Products & Inventory', icon: 'products', path: '/city-admin/products' },
      { label: 'Orders & Assignments', icon: 'orders', path: '/city-admin/orders' },
      { label: 'Delivery Partners', icon: 'delivery', path: '/city-admin/delivery-partners' },
      { label: 'Customers', icon: 'customers' },
      { label: 'Support & Disputes', icon: 'support' },
    ],
  },
  { label: 'Finance', items: [{ label: 'Payment Issues', icon: 'payments' }, { label: 'Refund Requests', icon: 'refunds' }] },
  { label: 'Reporting', items: [{ label: 'City Reports & Analytics', icon: 'reports' }] },
  { label: 'Account', items: [{ label: 'My Profile', icon: 'roles' }, { label: 'Notifications', icon: 'support' }] },
];

function computeDistanceKm(
  lat1?: number,
  lon1?: number,
  lat2?: number,
  lon2?: number,
): number | null {
  if (
    typeof lat1 !== 'number' || !Number.isFinite(lat1) ||
    typeof lon1 !== 'number' || !Number.isFinite(lon1) ||
    typeof lat2 !== 'number' || !Number.isFinite(lat2) ||
    typeof lon2 !== 'number' || !Number.isFinite(lon2)
  ) {
    return null;
  }
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

function partnerAvailabilityBadge(partner: CityAdminDeliveryPartner): string {
  if (!partner.isOnline || partner.availabilityStatus === 'offline') return 'OFFLINE';
  if (partner.availabilityStatus === 'busy' || partner.activeDeliveries > 0) return 'ONLINE · ON DELIVERY';
  return 'ONLINE & AVAILABLE';
}

function CityAdminLayout({ children }: { children: ReactNode }): ReactNode {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const displayName = user?.name || 'City Administrator';
  const readyPickupQuery = useMemo(() => new URLSearchParams({ page: '1', limit: '20', fulfilmentStatus: 'ready_for_pickup', unassignedOnly: 'true' }), []);
  const readyOrders = useLoad(() => api.cityAdminOrders(readyPickupQuery), [user?.id, user?.assignedCity]);
  const readyPartners = useLoad(() => api.cityAdminDeliveryPartners(1, 100), [user?.id, user?.assignedCity]);
  const [dismissedReadyIds, setDismissedReadyIds] = useState<string[]>([]);
  const [manualPopupOpen, setManualPopupOpen] = useState(false);
  const [selectedPartners, setSelectedPartners] = useState<Record<string, string>>({});
  const [assigningOrderId, setAssigningOrderId] = useState('');
  const [popupError, setPopupError] = useState('');
  const [popupMessage, setPopupMessage] = useState('');

  useEffect(() => {
    const refreshReady = () => {
      void readyOrders.reload(false);
      void readyPartners.reload(false);
    };
    const timer = window.setInterval(refreshReady, 5_000);
    window.addEventListener('focus', refreshReady);
    window.addEventListener('city-admin-order-updated', refreshReady);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshReady);
      window.removeEventListener('city-admin-order-updated', refreshReady);
    };
  }, [readyOrders.reload, readyPartners.reload]);

  const unassignedReadyOrders = readyOrders.data?.data ?? [];
  const hasNewReadyOrder = unassignedReadyOrders.some((order) => !dismissedReadyIds.includes(order._id));
  const showReadyPopup = manualPopupOpen || hasNewReadyOrder;
  const activeCityPartners = (readyPartners.data?.data ?? []).filter((partner) => partner.status === 'active');

  function getEligiblePartnersForOrder(order: CityAdminOrder): Array<CityAdminDeliveryPartner & { computedDistanceKm: number | null }> {
    const orderLocality = order.address?.locality ?? '';
    const sellerLat = order.sellerPickup?.latitude ?? 23.8388;
    const sellerLng = order.sellerPickup?.longitude ?? 79.4422;
    return activeCityPartners
      .filter((partner) =>
        (!orderLocality || !partner.serviceableLocalities?.length || partner.serviceableLocalities.some((loc) => loc.toLocaleLowerCase() === orderLocality.toLocaleLowerCase()))
        && partner.isOnline !== false
        && partner.availabilityStatus === 'available',
      )
      .map((partner) => ({
        ...partner,
        computedDistanceKm: computeDistanceKm(
          sellerLat,
          sellerLng,
          partner.currentLocation?.latitude,
          partner.currentLocation?.longitude,
        ) ?? partner.distanceKm ?? null,
      }))
      .sort((a, b) => (a.computedDistanceKm ?? 9999) - (b.computedDistanceKm ?? 9999));
  }

  async function assignPartnerFromPopup(order: CityAdminOrder): Promise<void> {
    const eligibleForOrder = getEligiblePartnersForOrder(order);
    const chosenPartnerId = selectedPartners[order._id] || eligibleForOrder[0]?._id || '';
    if (!chosenPartnerId) {
      setPopupError('Please select an ONLINE & AVAILABLE delivery partner to assign.');
      return;
    }
    setAssigningOrderId(order._id);
    setPopupError('');
    setPopupMessage('');
    try {
      await api.assignCityAdminDeliveryPartner(order._id, { partnerId: chosenPartnerId });
      const chosenPartner = eligibleForOrder.find((p) => p._id === chosenPartnerId);
      const partnerName = chosenPartner?.name || 'Delivery Partner';
      const distText = chosenPartner?.computedDistanceKm !== null && chosenPartner?.computedDistanceKm !== undefined
        ? ` (${chosenPartner.computedDistanceKm} km from Seller)`
        : '';
      setPopupMessage(`Assigned ${partnerName}${distText} to order #${order.orderReference}! Status is now DELIVERY_PARTNER_ASSIGNED.`);
      await Promise.all([readyOrders.reload(false), readyPartners.reload(false)]);
      window.dispatchEvent(new Event('city-admin-order-updated'));
    } catch (cause) {
      setPopupError(displayError(cause));
    } finally {
      setAssigningOrderId('');
    }
  }

  function closeReadyPopup(): void {
    setManualPopupOpen(false);
    setDismissedReadyIds(unassignedReadyOrders.map((order) => order._id));
  }

  async function handleSignOut(): Promise<void> {
    await signOut();
    navigate('/');
  }

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const query = new URLSearchParams();
    if (search.trim()) query.set('q', search.trim());
    navigate(`/city-admin/orders${query.size ? `?${query}` : ''}`);
  }

  return (
    <div className="city-admin-shell">
      {mobileOpen && <button className="city-admin-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`city-admin-sidebar${mobileOpen ? ' is-open' : ''}`}>
        <Link to="/city-admin" className="city-admin-brand"><img src="/images/maitri-sisterhood-logo.png" alt="" /><span>eSakhi<small>CITY ADMIN</small></span></Link>
        <div className="city-admin-assigned-city"><span>ASSIGNED CITY</span><strong>{user?.assignedCity}</strong><small>City Admin scope</small></div>
        <nav className="city-admin-nav" aria-label="City Admin navigation">
          {cityAdminNavGroups.map((group) => (
            <div className="city-admin-nav-group" key={group.label}>
              <span className="city-admin-nav-label">{group.label}</span>
              {group.items.map((item) => item.path ? (
                <NavLink to={item.path} end={item.path === '/city-admin'} key={item.label} onClick={() => setMobileOpen(false)}>
                  <SuperAdminIcon name={item.icon} /><span>{item.label}</span>
                </NavLink>
              ) : (
                <span className="city-admin-nav-disabled" key={item.label} aria-disabled="true" title={`${item.label} is not available yet`}>
                  <SuperAdminIcon name={item.icon} /><span>{item.label}</span><small>Planned</small>
                </span>
              ))}
            </div>
          ))}
        </nav>
        <div className="city-admin-user">
          <span className="city-admin-avatar">{displayName.slice(0, 1).toUpperCase()}</span>
          <span><strong>{displayName}</strong><small>City Administrator</small></span>
          <button onClick={() => void handleSignOut()} aria-label="Sign out" title="Sign out">↗</button>
        </div>
      </aside>
      <main className="city-admin-main">
        <header className="city-admin-topbar">
          <div className="city-admin-topbar-leading">
            <button className="city-admin-menu-toggle" onClick={() => setMobileOpen((open) => !open)} aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}>☰</button>
            <form className="city-admin-search" onSubmit={submitSearch}><span aria-hidden="true">⌕</span><input aria-label="Search orders" placeholder="Search orders, customers…" value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>⌘ K</kbd></form>
          </div>
          <div className="city-admin-topbar-actions">
            {unassignedReadyOrders.length > 0 && (
              <button
                type="button"
                className="city-admin-primary-button"
                onClick={() => { setPopupError(''); setPopupMessage(''); setManualPopupOpen(true); }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.45rem 0.85rem', fontSize: '0.85rem' }}
              >
                <span aria-hidden="true">🔔</span> Ready for Pickup ({unassignedReadyOrders.length}) — Assign Partner
              </button>
            )}
            <span className="city-admin-live-label"><i /> Live operations</span>
            <button
              className="city-admin-notifications"
              type="button"
              onClick={() => { setPopupError(''); setPopupMessage(''); setManualPopupOpen(true); }}
              title={unassignedReadyOrders.length ? `${unassignedReadyOrders.length} order(s) ready for pickup awaiting partner assignment` : 'Check orders ready for pickup'}
              aria-label="Open Ready for Pickup partner assignment popup"
            >
              <SuperAdminIcon name="delivery" />
            </button>
            <Link to="/help" className="city-admin-help" aria-label="Help">?</Link>
            <button className="city-admin-mobile-signout" onClick={() => void handleSignOut()}>Sign out</button>
          </div>
        {popupMessage && !showReadyPopup && (
          <div style={{ margin: '1rem 1.5rem 0' }}>
            <Notice tone="success">{popupMessage}</Notice>
          </div>
        )}
        {showReadyPopup && (
          <div
            className="city-admin-ready-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="city-admin-ready-popup-title"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1200,
              background: 'rgba(28, 16, 24, 0.58)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '1.25rem',
            }}
          >
            <div
              className="city-admin-panel city-admin-ready-modal"
              style={{
                width: '100%',
                maxWidth: '680px',
                maxHeight: '88vh',
                overflowY: 'auto',
                background: 'var(--surface, #fff)',
                borderRadius: '18px',
                padding: '1.5rem',
                boxShadow: '0 24px 60px rgba(25, 10, 20, 0.28)',
                border: '2px solid var(--brand, #6b215c)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <p className="city-admin-eyebrow" style={{ color: 'var(--brand, #6b215c)', fontWeight: 700 }}>🔔 SELLER READY FOR PICKUP NOTIFICATION</p>
                  <h2 id="city-admin-ready-popup-title" style={{ margin: '0.25rem 0', fontSize: '1.35rem' }}>
                    {unassignedReadyOrders.length
                      ? `Order Ready for Pickup — Assign a Delivery Partner (${unassignedReadyOrders.length})`
                      : 'All Ready-for-Pickup Orders Assigned'}
                  </h2>
                  <p style={{ margin: 0, color: 'var(--muted, #6a5864)', fontSize: '0.92rem' }}>
                    The seller has packed and marked the order as <strong>Ready for pickup</strong>. Select and assign a suitable delivery partner below.
                  </p>
                </div>
                <button
                  type="button"
                  className="city-admin-secondary-button"
                  onClick={closeReadyPopup}
                  aria-label="Close popup"
                >
                  Close ✕
                </button>
              </div>
              {popupError && <div className="city-admin-error" role="alert" style={{ marginBottom: '0.85rem' }}>{popupError}</div>}
              {popupMessage && <div style={{ marginBottom: '0.85rem' }}><Notice tone="success">{popupMessage}</Notice></div>}
              {unassignedReadyOrders.length === 0 ? (
                <div className="city-admin-empty">No orders are currently awaiting delivery partner assignment in Ready for Pickup status.</div>
              ) : (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {unassignedReadyOrders.map((order) => {
                    const orderLocality = order.address?.locality ?? '';
                    const eligibleForOrder = getEligiblePartnersForOrder(order);
                    const currentPartnerId = selectedPartners[order._id] ?? eligibleForOrder[0]?._id ?? '';
                    return (
                      <article
                        key={order._id}
                        style={{
                          border: '1px solid var(--border, rgba(107, 33, 92, 0.2))',
                          borderRadius: '14px',
                          padding: '1.1rem',
                          background: 'var(--surface-subtle, #fdf9fc)',
                          display: 'grid',
                          gap: '0.85rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                          <div>
                            <strong style={{ fontSize: '1.05rem' }}>#{order.orderReference}</strong>
                            <span style={{ marginLeft: '0.6rem' }}><StatusBadge value={order.fulfilmentStatus} fulfilmentMethod="delivery" /></span>
                          </div>
                          <strong>{formatMoney(order.totalPaise)} ({order.paymentMethod === 'cash' ? 'COD' : 'UPI'})</strong>
                        </div>
                        <div style={{ display: 'grid', gap: '0.35rem', fontSize: '0.9rem' }}>
                          <div><strong>Items:</strong> {order.items.map((item) => `${item.productName}${item.quantity ? ` × ${item.quantity}` : ''}`).join(', ')}</div>
                          <div>
                            <strong>Seller Pickup (Origin):</strong> {order.sellerPickup?.sellerName || Array.from(new Set(order.items.map((item) => item.sellerName).filter(Boolean))).join(', ') || 'Assigned Seller'}
                            {order.sellerPickup?.address ? ` — ${order.sellerPickup.address}, ${order.sellerPickup.city}` : ''}
                            {order.sellerPickup?.latitude !== undefined && order.sellerPickup?.longitude !== undefined ? ` (GPS: ${order.sellerPickup.latitude.toFixed(4)}, ${order.sellerPickup.longitude.toFixed(4)})` : ''}
                          </div>
                          <div><strong>Customer Drop-off (Destination):</strong> {order.customerName}{order.customerPhoneE164 ? ` · ${order.customerPhoneE164}` : ''} — {order.address?.formattedAddress || [order.address?.addressLine1, order.address?.locality, order.address?.city, order.address?.postalCode].filter(Boolean).join(', ') || 'Damoh'}{order.address?.latitude !== undefined && order.address?.longitude !== undefined ? ` (GPS: ${order.address.latitude.toFixed(4)}, ${order.address.longitude.toFixed(4)})` : ''}</div>
                        </div>
                        {eligibleForOrder.length > 0 ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end', paddingTop: '0.4rem' }}>
                            <label className="field" style={{ flex: '1 1 280px', margin: 0 }}>
                              <span style={{ fontWeight: 600 }}>Nearest ONLINE & AVAILABLE Partner ({orderLocality || user?.assignedCity})</span>
                              <select
                                aria-label={`Select delivery partner for order ${order.orderReference}`}
                                value={currentPartnerId}
                                onChange={(event) => setSelectedPartners((prev) => ({ ...prev, [order._id]: event.target.value }))}
                              >
                                {eligibleForOrder.map((partner, idx) => (
                                  <option key={partner._id} value={partner._id}>
                                    {idx === 0 ? '★ Nearest: ' : ''}{partner.name || 'Delivery Partner'} · {partner.computedDistanceKm !== null ? `${partner.computedDistanceKm} km from Seller` : 'In city'} · ONLINE & AVAILABLE · {partner.phoneE164}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              className="city-admin-primary-button"
                              disabled={assigningOrderId === order._id || !currentPartnerId}
                              onClick={() => void assignPartnerFromPopup(order)}
                            >
                              {assigningOrderId === order._id ? 'Assigning…' : 'Assign Delivery Partner'}
                            </button>
                            <Link
                              to={`/city-admin/orders/${order._id}`}
                              className="city-admin-secondary-button"
                              onClick={closeReadyPopup}
                            >
                              View Order Details
                            </Link>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                            <span style={{ color: 'var(--danger, #a12626)', fontSize: '0.9rem' }}>
                              No ONLINE & AVAILABLE delivery partner is currently free in {orderLocality || user?.assignedCity}.
                            </span>
                            <Link to="/city-admin/delivery-partners" className="city-admin-secondary-button" onClick={closeReadyPopup}>
                              Check Partner Availability →
                            </Link>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
        </header>
        {children}
      </main>
    </div>
  );
}

function CityAdminDashboardPage(): ReactNode {
  const result = useLoad(() => api.cityAdminDashboard());
  const partners = useLoad(() => api.cityAdminDeliveryPartners(1, 100), []);
  useRefreshOnFocus(result.reload);
  useRefreshOnFocus(partners.reload);
  const dashboard = result.data;
  useEffect(() => {
    const refresh = () => {
      void result.reload(false);
      void partners.reload(false);
    };
    window.addEventListener('city-admin-order-updated', refresh);
    return () => window.removeEventListener('city-admin-order-updated', refresh);
  }, [result.reload, partners.reload]);
  const metrics = dashboard?.metrics;

  return (
    <div className="city-admin-page">
      <div className="city-admin-page-heading">
        <div><p className="city-admin-eyebrow">{dashboard?.city ?? 'City'} CITY OPERATIONS</p><h1>City Operations Overview</h1><p>Monitor city-scoped orders and delivery activity for your assigned city.</p></div>
        <div className="city-admin-page-actions"><button className="city-admin-secondary-button" type="button" disabled title="City reports are not available yet">Export report</button><Link className="city-admin-primary-button" to="/city-admin/orders">View all orders <span aria-hidden="true">›</span></Link></div>
      </div>
      {result.error && <div className="city-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
      {result.loading ? <Loading label="Loading city operations…" /> : dashboard && metrics ? (
        <>
          <CityAdminDisputeArbitrationPanel
            orders={dashboard.recentOrders}
            partners={partners.data?.data ?? []}
            onRefresh={() => {
              void result.reload(false);
              void partners.reload(false);
              window.dispatchEvent(new Event('city-admin-order-updated'));
            }}
          />
          <div className="city-admin-metrics">
            <CityAdminMetric label="Today’s Orders" value={metrics.todayOrders} icon="orders" to="/city-admin/orders" />
            <CityAdminMetric label="Awaiting Assignment" value={metrics.awaitingAssignment} icon="delivery" alert to="/city-admin/orders?unassignedOnly=true" />
            <CityAdminMetric label="Out for Delivery" value={metrics.outForDelivery} icon="providers" to="/city-admin/orders?fulfilmentStatus=out_for_delivery" />
            <CityAdminMetric label="Delivered Today" value={metrics.deliveredToday} icon="overview" to="/city-admin/orders?fulfilmentStatus=delivered" />
            <CityAdminMetric label="Active Partners" value="Unavailable" icon="delivery" unavailable />
            <CityAdminMetric label="Partner Applications" value="Unavailable" icon="administrators" unavailable />
            <CityAdminMetric label="Sellers Awaiting Review" value={metrics.sellerApplicationsToReview} icon="sellers" alert={metrics.sellerApplicationsToReview > 0} />
            <CityAdminMetric label="Open Support Tickets" value="Unavailable" icon="support" unavailable />
          </div>
          <div className="city-admin-insight-grid">
            <section className="city-admin-panel">
              <div className="city-admin-panel-heading"><div><h2>Daily order trend</h2><p>Orders received over the last 7 days</p></div><span className="city-admin-period">Last 7 days</span></div>
              <SuperAdminOrdersChart data={dashboard.ordersOverTime} />
            </section>
            <section className="city-admin-panel">
              <div className="city-admin-panel-heading"><div><h2>Order status</h2><p>Today’s {metrics.todayOrders.toLocaleString('en-IN')} city orders</p></div></div>
              <SuperAdminStatusBreakdown statuses={dashboard.ordersByStatus} />
            </section>
          </div>
          <CityAdminLiveFleetOverview orders={dashboard.recentOrders} />
          <div className="city-admin-lower-grid">
            <section className="city-admin-panel city-admin-recent">
              <div className="city-admin-panel-heading"><div><h2>Recent orders</h2><p>Latest marketplace orders in {dashboard.city}</p></div><Link to="/city-admin/orders">View all <span aria-hidden="true">→</span></Link></div>
              {dashboard.recentOrders.length ? <CityAdminOrderTable orders={dashboard.recentOrders} /> : <div className="city-admin-empty">No orders have been recorded for this city yet.</div>}
            </section>
            <section className="city-admin-panel">
              <div className="city-admin-panel-heading"><div><h2>Assignment exceptions</h2><p>Orders needing manual attention</p></div><Link to="/city-admin/orders?unassignedOnly=true">View queue</Link></div>
              {dashboard.assignmentExceptions.length ? <div className="city-admin-exceptions">{dashboard.assignmentExceptions.map((exception) => (
                <div className="city-admin-exception" key={exception._id}>
                  <span className="city-admin-exception-mark">!</span>
                  <span><Link to={`/city-admin/orders/${exception._id}`}><strong>#{exception.orderReference} · {exception.fulfilmentStatus === 'ready_for_pickup' ? 'Ready for pickup — Assign partner' : 'Awaiting assignment'}</strong></Link><small>{exception.address?.locality ?? 'Locality not recorded'} · Created {formatElapsed(exception.createdAt)} ago</small></span>
                </div>
              ))}</div> : <div className="city-admin-empty">No unassigned delivery orders need attention.</div>}
              <div className="city-admin-queue-summary">
                <Link to="/city-admin/orders?paymentStatus=pending_verification"><span>Payments awaiting review</span><strong>{metrics.paymentsToReview}</strong></Link>
                <Link to="/city-admin/orders"><span>Orders needing fulfilment action</span><strong>{metrics.ordersNeedingAction}</strong></Link>
              </div>
            </section>
          </div>
          <p className="city-admin-data-note">Counts use the assigned city recorded for your account and the city on each delivery address. Partner availability, seller reviews, support tickets, city inventory, and report exports are not available in the current backend.</p>
        </>
      ) : null}
    </div>
  );
}

function CityAdminServiceZonesPage(): ReactNode {
  const result = useLoad(() => api.cityAdminServiceZones());
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestText, setRequestText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function submitChangeRequest(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const request = await api.requestCityAdminServiceZoneChange(requestText.trim());
      setMessage(`Change request submitted for ${request.city}. Request ID: ${request.id}.`);
      setRequestText('');
      setRequestOpen(false);
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="city-admin-page">
      <div className="city-admin-page-heading">
        <div><p className="city-admin-eyebrow">Local operations</p><h1>My Service Zones</h1><p>Read-only coverage details for {result.data?.city ?? 'your assigned city'}.</p></div>
        <button className="city-admin-secondary-button" type="button" onClick={() => setRequestOpen((open) => !open)}>Request change</button>
      </div>
      {result.error && <div className="city-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
      {error && <div className="city-admin-error" role="alert">{error}</div>}
      {message && <Notice tone="success">{message}</Notice>}
      {requestOpen && <form className="city-admin-panel city-admin-zone-request" onSubmit={(event) => void submitChangeRequest(event)}>
        <div className="city-admin-panel-heading"><div><h2>Request a service-zone change</h2><p>Your request is sent for review. It will not change service rules automatically.</p></div></div>
        <label className="field"><span>Describe the requested change</span><textarea required minLength={10} maxLength={1000} rows={4} value={requestText} onChange={(event) => setRequestText(event.target.value)} placeholder="Include the locality or PIN code and the change requested." /></label>
        <div className="city-admin-zone-request-actions"><button className="city-admin-secondary-button" type="button" disabled={saving} onClick={() => setRequestOpen(false)}>Cancel</button><button className="city-admin-primary-button" type="submit" disabled={saving}>{saving ? 'Submitting…' : 'Submit request'}</button></div>
      </form>}
      <section className="city-admin-panel city-admin-order-directory">
        <div className="city-admin-panel-heading"><div><h2>Configured coverage</h2><p>{result.data?.state ? `${result.data.state} · ` : ''}{result.data?.city ?? 'Assigned city'}</p></div>{result.data?.configured && <span className="city-admin-period">Read only</span>}</div>
        {result.loading ? <Loading label="Loading service zones…" /> : result.data?.configured ? result.data.zones.length ? <div className="city-admin-table-wrap"><table className="city-admin-table"><thead><tr><th>Zone</th><th>Covered localities</th><th>PIN codes</th><th>Delivery fee</th><th>Eligible partners</th><th>Active deliveries</th><th>Status</th></tr></thead><tbody>{result.data.zones.map((zone) => <tr key={zone.name}><td><strong>{zone.name}</strong></td><td>{zone.coveredLocalities.join(', ')}</td><td>{zone.postalCodes.join(', ')}</td><td>{zone.deliveryFeePaise === undefined ? 'Not configured' : formatMoney(zone.deliveryFeePaise)}</td><td>{zone.eligiblePartnerCount === null ? 'Not tracked' : zone.eligiblePartnerCount}</td><td>{zone.activeDeliveryCount}</td><td><StatusBadge value={zone.status} /></td></tr>)}</tbody></table></div> : <div className="city-admin-empty">No serviceable localities are configured for {result.data.city}.</div> : <div className="city-admin-empty">Service zones are not configured for {result.data?.city ?? 'your assigned city'}. Other cities’ settings are not shown.</div>}
      </section>
      <p className="city-admin-data-note">The current backend stores one platform city with locality and PIN-code coverage. Partner eligibility by zone is not recorded.</p>
    </div>
  );
}

function CityAdminOrdersPage(): ReactNode {
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [queryText, setQueryText] = useState(() => searchParams.get('q') ?? '');
  const [status, setStatus] = useState(() => searchParams.get('fulfilmentStatus') ?? '');
  const [paymentStatus, setPaymentStatus] = useState(() => searchParams.get('paymentStatus') ?? '');
  const [sellerId, setSellerId] = useState(() => searchParams.get('sellerId') ?? '');
  const [deliveryPartnerId, setDeliveryPartnerId] = useState(() => searchParams.get('deliveryPartnerId') ?? '');
  const [from, setFrom] = useState(() => searchParams.get('from') ?? '');
  const [to, setTo] = useState(() => searchParams.get('to') ?? '');
  const unassignedOnly = searchParams.get('unassignedOnly') === 'true';
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (queryText.trim()) query.set('q', queryText.trim());
  if (status) query.set('fulfilmentStatus', status);
  if (paymentStatus) query.set('paymentStatus', paymentStatus);
  if (sellerId) query.set('sellerId', sellerId);
  if (deliveryPartnerId) query.set('deliveryPartnerId', deliveryPartnerId);
  if (from) query.set('from', new Date(`${from}T00:00:00`).toISOString());
  if (to) query.set('to', new Date(`${to}T23:59:59.999`).toISOString());
  if (unassignedOnly) query.set('unassignedOnly', 'true');
  const result = useLoad(() => api.cityAdminOrders(query), [page, queryText, status, paymentStatus, sellerId, deliveryPartnerId, from, to, unassignedOnly]);
  const sellers = useLoad(() => api.cityAdminSellers(new URLSearchParams({ page: '1', limit: '100' })), []);
  useEffect(() => {
    const refresh = () => void result.reload(false);
    window.addEventListener('city-admin-order-updated', refresh);
    return () => window.removeEventListener('city-admin-order-updated', refresh);
  }, [result.reload]);
  const partners = useLoad(() => api.cityAdminDeliveryPartners(1, 100), []);
  useEffect(() => {
    const refresh = () => {
      void partners.reload(false);
    };
    window.addEventListener('city-admin-order-updated', refresh);
    return () => window.removeEventListener('city-admin-order-updated', refresh);
  }, [partners.reload]);

  return (
    <div className="city-admin-page">
      <div className="city-admin-page-heading"><div><p className="city-admin-eyebrow">Local operations</p><h1>Orders & Assignments</h1><p>Orders for your assigned city, with authorized partner assignment and return dispute arbitration actions.</p></div></div>
      {result.error && <div className="city-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
      {result.data?.data && (
        <CityAdminDisputeArbitrationPanel
          orders={result.data.data}
          partners={partners.data?.data ?? []}
          onRefresh={() => {
            void result.reload(false);
            void partners.reload(false);
            window.dispatchEvent(new Event('city-admin-order-updated'));
          }}
        />
      )}
      {result.data?.data && <CityAdminLiveFleetOverview orders={result.data.data} />}
      {result.data?.data && (
        <CityAdminDeliveryEscalationQueue
          orders={result.data.data}
          onRefresh={() => {
            void result.reload(false);
            void partners.reload(false);
            window.dispatchEvent(new Event('city-admin-order-updated'));
          }}
        />
      )}
      <section className="city-admin-panel city-admin-order-directory">
        {unassignedOnly && <div className="city-admin-filter-note">Showing delivery orders awaiting a partner. <Link to="/city-admin/orders">Clear filter</Link></div>}
        <div className="city-admin-order-tools">
          <label className="city-admin-search-field"><span aria-hidden="true">⌕</span><input aria-label="Search order reference or customer" placeholder="Search order or customer" value={queryText} onChange={(event) => { setPage(1); setQueryText(event.target.value); }} /></label>
          <select aria-label="Filter by fulfilment status" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}>
            <option value="">All fulfilment states</option><option value="placed">Order Confirmed</option><option value="preparing">Preparing</option><option value="ready_for_pickup">Ready for pickup</option><option value="delivery_partner_assigned">Partner Assigned</option><option value="out_for_pickup">Out for Pickup</option><option value="picked_up">Picked Up</option><option value="out_for_delivery">Out for delivery</option><option value="delivered">Delivered</option><option value="completed">Completed</option><option value="return_requested">Return Requested</option><option value="return_accepted">Return Accepted</option><option value="return_partner_assigned">Return Partner Assigned</option><option value="return_picked_up">Return Picked Up</option><option value="return_delivered_to_seller">Returned to Seller</option><option value="ready_for_refund">Ready for Refund</option><option value="refund_completed">Refund Completed</option><option value="cancelled">Cancelled</option><option value="delivery_failed">Delivery failed</option>
          </select>
          <select aria-label="Filter by payment status" value={paymentStatus} onChange={(event) => { setPage(1); setPaymentStatus(event.target.value); }}>
            <option value="">All payment states</option><option value="pending_verification">Awaiting review</option><option value="confirmed">Confirmed</option><option value="rejected">Rejected</option>
          </select>
          <select aria-label="Filter by seller" value={sellerId} onChange={(event) => { setPage(1); setSellerId(event.target.value); }}><option value="">All city sellers</option>{(sellers.data?.data ?? []).map((seller) => <option key={seller._id} value={seller._id}>{seller.name || seller.phoneE164}</option>)}</select>
          <select aria-label="Filter by delivery partner" value={deliveryPartnerId} onChange={(event) => { setPage(1); setDeliveryPartnerId(event.target.value); }}><option value="">All delivery partners</option>{(partners.data?.data ?? []).map((partner) => <option key={partner._id} value={partner._id}>{partner.name || partner.phoneE164}</option>)}</select>
          <label className="city-admin-date-filter"><span>From</span><input aria-label="Orders from date" type="date" value={from} onChange={(event) => { setPage(1); setFrom(event.target.value); }} /></label>
          <label className="city-admin-date-filter"><span>To</span><input aria-label="Orders to date" type="date" value={to} onChange={(event) => { setPage(1); setTo(event.target.value); }} /></label>
        </div>
        {result.loading ? <Loading label="Loading city orders…" /> : result.data?.data.length ? <CityAdminOrderTable orders={result.data.data} /> : <div className="city-admin-empty">No city orders match these filters.</div>}
        {result.data && result.data.pagination.totalPages > 1 && <Pagination page={page} pages={result.data.pagination.totalPages} onChange={setPage} />}
      </section>
    </div>
  );
}

function CityAdminMetric({ label, value, icon, alert = false, unavailable = false, to }: { label: string; value: number | string; icon: string; alert?: boolean; unavailable?: boolean; to?: string }): ReactNode {
  const className = `city-admin-metric${alert ? ' is-alert' : ''}${unavailable ? ' is-unavailable' : ''}${to ? ' is-link' : ''}`;
  const content = <><div><span>{label}</span><SuperAdminIcon name={icon} /></div><strong>{typeof value === 'number' ? value.toLocaleString('en-IN') : value}</strong><small>{unavailable ? 'Not tracked by city scope' : alert ? 'Needs attention' : 'Live city-scoped data'}</small></>;
  return to ? <Link to={to} className={className} aria-label={`${label}: ${value}. Open related city orders.`}>{content}</Link> : <article className={className}>{content}</article>;
}

function CityAdminOrderTable({ orders }: { orders: CityAdminOrder[] }): ReactNode {
  return (
    <div className="city-admin-table-wrap"><table className="city-admin-table">
      <thead><tr><th>Order</th><th>Customer</th><th>Seller</th><th>Items</th><th>Total</th><th>Payment</th><th>Checkpoint Status</th><th>Partner & Proximity</th><th>Created</th></tr></thead>
      <tbody>{orders.map((order) => <tr key={order._id}>
        <td><Link to={`/city-admin/orders/${order._id}`}><strong>#{order.orderReference}</strong></Link><small>{order.address?.locality ?? 'Pickup order'}</small></td>
        <td>{order.customerName}</td>
        <td>{order.sellerPickup?.sellerName || Array.from(new Set(order.items.map((item) => item.sellerName).filter((name): name is string => Boolean(name)))).join(', ') || 'Seller not linked'}</td>
        <td className="city-admin-items">{order.items.map((item) => item.productName).slice(0, 2).join(', ')}{order.items.length > 2 ? ` +${order.items.length - 2}` : ''}</td>
        <td>{formatMoney(order.totalPaise)}</td>
        <td><span className={`city-admin-payment ${order.paymentStatus}`}>{order.paymentMethod === 'cash' ? 'COD' : 'UPI'}</span><small>{order.paymentStatus.replaceAll('_', ' ')}</small></td>
        <td><span className={`super-admin-status-badge status-${order.fulfilmentStatus}`}>{orderStatusLabel(order.fulfilmentStatus)}</span></td>
        <td>
          {order.deliveryPartner?.name ? (
            <div>
              <strong>{order.deliveryPartner.name}</strong>
              {order.deliveryPartner.distanceKm !== undefined && order.deliveryPartner.distanceKm !== null && <small>{order.deliveryPartner.distanceKm} km from Seller</small>}
            </div>
          ) : (order.fulfilmentMethod === 'pickup' ? 'Pickup' : <Link to={`/city-admin/orders/${order._id}`} className="text-button"><strong>{order.fulfilmentStatus === 'ready_for_pickup' ? 'Assign partner (Ready) →' : 'View / Assign →'}</strong></Link>)}
        </td>
        <td>{new Date(order.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
      </tr>)}</tbody>
    </table></div>
  );
}

function CityAdminOrderDetailPage(): ReactNode {
  const { id = '' } = useParams();
  const order = useLoad(() => api.cityAdminOrder(id), [id]);
  const partners = useLoad(() => api.cityAdminDeliveryPartners(1, 100, { orderId: id }), [id]);
  const [partnerId, setPartnerId] = useState('');
  const [reassignmentReason, setReassignmentReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useRefreshOnFocus(order.reload);
  useRefreshOnFocus(partners.reload);

  const orderLocality = order.data?.address?.locality ?? '';
  const eligiblePartners = (partners.data?.data ?? []).filter((partner) =>
    partner.status === 'active'
    && (!orderLocality || !partner.serviceableLocalities?.length || partner.serviceableLocalities.some((locality) => locality.toLocaleLowerCase() === orderLocality.toLocaleLowerCase()))
    && partner.isOnline !== false
    && (partner.availabilityStatus === 'available' || partner._id === order.data?.deliveryPartner?.userId),
  );
  const assignmentAllowed = order.data && order.data.fulfilmentMethod === 'delivery'
    && ['ready_for_pickup', 'delivery_partner_assigned', 'out_for_pickup', 'picked_up', 'out_for_delivery', 'delivery_failed'].includes(order.data.fulfilmentStatus)
    && (!order.data.deliveryPartner || order.data.fulfilmentStatus === 'delivery_failed');
  const needsReassignmentReason = Boolean(order.data?.deliveryPartner);

  useEffect(() => {
    setPartnerId(order.data?.deliveryPartner?.userId || eligiblePartners[0]?._id || '');
  }, [order.data?.deliveryPartner?.userId, eligiblePartners.length]);

  async function assignPartner(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!order.data || !partnerId || !assignmentAllowed) return;
    if (needsReassignmentReason && reassignmentReason.trim().length < 10) return;
    const action = needsReassignmentReason ? 'Reassign delivery partner' : 'Assign delivery partner';
    if (!window.confirm(`${action} for order ${order.data.orderReference}?`)) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api.assignCityAdminDeliveryPartner(id, {
        partnerId,
        ...(reassignmentReason.trim() ? { reassignmentReason: reassignmentReason.trim() } : {}),
      });
      setMessage(needsReassignmentReason ? 'Delivery partner reassigned.' : 'Delivery partner assigned (Status: Partner Assigned).');
      setReassignmentReason('');
      await Promise.all([order.reload(), partners.reload(false)]);
      window.dispatchEvent(new Event('city-admin-order-updated'));
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setSaving(false);
    }
  }

  if (order.loading) return <div className="city-admin-page"><Loading label="Loading city order…" /></div>;
  if (!order.data) return <div className="city-admin-page"><Notice tone="error">{order.error || 'Order not found in your assigned city.'}</Notice><Link to="/city-admin/orders" className="city-admin-secondary-button">Back to orders</Link></div>;
  const item = order.data;

  return <div className="city-admin-page">
    <div className="breadcrumbs"><Link to="/city-admin/orders">Orders & Assignments</Link><span>/</span>{item.orderReference}</div>
    <div className="city-admin-page-heading"><div><p className="city-admin-eyebrow">City order · {item.address?.city ?? 'City unavailable'}</p><h1>{item.orderReference}</h1><p>{item.customerName} · {item.address?.locality ?? 'Pickup order'} · {item.createdAt ? new Date(item.createdAt).toLocaleString('en-IN') : 'Date unavailable'}</p></div><StatusBadge value={item.fulfilmentStatus} /></div>
    {error && <div className="city-admin-error" role="alert">{error}</div>}{message && <Notice tone="success">{message}</Notice>}
    <CityAdminDisputeArbitrationPanel
      orders={[item]}
      partners={partners.data?.data ?? []}
      onRefresh={() => {
        void order.reload(false);
        void partners.reload(false);
        window.dispatchEvent(new Event('city-admin-order-updated'));
      }}
    />
    {item.fulfilmentMethod === 'delivery' && (
      <div style={{ marginBottom: '1.25rem' }}>
        <CityAdminLiveTracker
          orderId={item._id}
          orderStatus={item.fulfilmentStatus}
          hasPartner={Boolean(item.deliveryPartner)}
          onOrderDelivered={() => void order.reload(false)}
        />
      </div>
    )}
    <CityAdminDeliveryResolutionPanel
      order={item}
      partners={partners.data?.data ?? []}
      onResolved={() => {
        void order.reload(false);
        void partners.reload(false);
        window.dispatchEvent(new Event('city-admin-order-updated'));
      }}
    />
    <div className="city-admin-lower-grid">
      <section className="city-admin-panel">
        <div className="city-admin-panel-heading"><div><h2>Items & sellers</h2><p>Order snapshots and assigned city sellers</p></div></div>
        <div className="city-admin-table-wrap"><table className="city-admin-table"><thead><tr><th>Product</th><th>Seller</th><th>Qty</th><th>Line total</th></tr></thead><tbody>{item.items.map((line, index) => <tr key={`${line.productId}-${index}`}><td>{line.productName}</td><td>{line.sellerName || item.sellerPickup?.sellerName || 'Seller not linked to this city'}</td><td>{line.quantity}</td><td>{formatMoney(line.lineTotalPaise)}</td></tr>)}</tbody></table></div>
        <div className="city-admin-order-summary"><span>Subtotal <strong>{formatMoney(item.subtotalPaise)}</strong></span><span>Delivery <strong>{formatMoney(item.deliveryFeePaise)}</strong></span><span>Total <strong>{formatMoney(item.totalPaise)}</strong></span></div>
      </section>
      <section className="city-admin-panel">
        <div className="city-admin-panel-heading"><div><h2>Pickup & Drop-off GPS Locations</h2><p>Seller origin and Customer destination</p></div></div>
        <dl className="city-admin-order-details">
          <div><dt>Payment</dt><dd>{item.paymentMethod.toUpperCase()} · <StatusBadge value={item.paymentStatus} /></dd></div>
          <div><dt>Fulfilment</dt><dd>{item.fulfilmentMethod} · <StatusBadge value={item.fulfilmentStatus} /></dd></div>
          <div><dt>Seller Pickup (Origin)</dt><dd>{item.sellerPickup ? <><strong>{item.sellerPickup.sellerName}</strong>{item.sellerPickup.phoneE164 ? ` · ${item.sellerPickup.phoneE164}` : ''}<br />{item.sellerPickup.address}, {item.sellerPickup.city}{item.sellerPickup.latitude !== undefined && item.sellerPickup.longitude !== undefined && <><br /><small>GPS: {item.sellerPickup.latitude.toFixed(4)}, {item.sellerPickup.longitude.toFixed(4)}</small></>}</> : 'Seller pickup info recorded'}</dd></div>
          <div><dt>Customer Drop-off</dt><dd>{item.address ? <>{item.address.formattedAddress || [item.address.addressLine1, item.address.addressLine2, item.address.area, item.address.landmark, item.address.villageOrCity || item.address.city, item.address.district, item.address.state, item.address.postalCode].filter(Boolean).join(', ')}<br />Recipient: {item.address.name} · {item.address.phoneE164}{item.address.latitude !== undefined && item.address.longitude !== undefined && <><br /><small>GPS: {item.address.latitude.toFixed(4)}, {item.address.longitude.toFixed(4)} · </small><a href={`https://www.google.com/maps/dir/?api=1&destination=${item.address.latitude},${item.address.longitude}`} target="_blank" rel="noreferrer">Open delivery pin in Maps ↗</a></>}</> : 'Pickup order'}</dd></div>
        </dl>
      </section>
    </div>
    <section className="city-admin-panel city-admin-assignment-panel">
      <div className="city-admin-panel-heading"><div><h2>Delivery Partner Assignment (Proximity & Availability)</h2><p>Filtered by: 1. Proximity (Nearest to Seller GPS) · 2. Availability (ONLINE & AVAILABLE). Note: Preparation stages (Preparing / Ready for Pickup) are controlled exclusively by the Seller.</p></div></div>
      {item.deliveryPartner && <div className="city-admin-current-assignment"><strong>Currently assigned</strong><span>{item.deliveryPartner.name} · {item.deliveryPartner.phoneE164}{item.deliveryPartner.distanceKm !== undefined && item.deliveryPartner.distanceKm !== null ? ` · ${item.deliveryPartner.distanceKm} km from Seller` : ''}</span></div>}
      {assignmentAllowed ? <form className="city-admin-zone-request" onSubmit={(event) => void assignPartner(event)}>
        {partners.error && <div className="city-admin-error" role="alert">{partners.error}<button type="button" onClick={() => void partners.reload()}>Retry</button></div>}
        {eligiblePartners.length ? <label className="field"><span>Eligible ONLINE & AVAILABLE partner (sorted nearest to Seller)</span><select required value={partnerId} onChange={(event) => setPartnerId(event.target.value)}><option value="">Select a partner</option>{eligiblePartners.map((partner, idx) => <option key={partner._id} value={partner._id}>{idx === 0 ? '★ Nearest: ' : ''}{partner.name || 'Delivery Partner'} · {partner.distanceKm !== null && partner.distanceKm !== undefined ? `${partner.distanceKm} km from Seller` : 'In city'} · {partnerAvailabilityBadge(partner)} · {partner.phoneE164}</option>)}</select></label> : <div className="city-admin-empty">No ONLINE & AVAILABLE partner covers this locality right now.</div>}
        {needsReassignmentReason && <label className="field"><span>Reason for reassignment (required)</span><textarea required minLength={10} maxLength={1000} rows={3} value={reassignmentReason} onChange={(event) => setReassignmentReason(event.target.value)} /></label>}
        <div className="city-admin-zone-request-actions"><button className="city-admin-primary-button" type="submit" disabled={saving || !partnerId || (needsReassignmentReason && reassignmentReason.trim().length < 10)}>{saving ? 'Saving…' : needsReassignmentReason ? 'Reassign partner' : 'Assign partner'}</button></div>
      </form> : !item.deliveryPartner && <div className="city-admin-empty">{['placed', 'order_confirmed', 'accepted', 'preparing'].includes(item.fulfilmentStatus) ? 'Awaiting Seller to pack items and mark order READY_FOR_PICKUP before partner assignment.' : 'No assignment action is available for this order status.'}</div>}
      {item.deliveryPartnerHistory?.length ? <div className="city-admin-assignment-history"><h3>Assignment history</h3>{item.deliveryPartnerHistory.map((entry, index) => <p key={`${entry.userId ?? entry.phoneE164}-${index}`}>{entry.name} · {entry.phoneE164} · {new Date(entry.assignedAt).toLocaleString('en-IN')} to {new Date(entry.unassignedAt).toLocaleString('en-IN')}{entry.changeReason ? ` · ${entry.changeReason}` : ''}</p>)}</div> : null}
    </section>
    <section className="city-admin-panel city-admin-assignment-panel"><div className="city-admin-panel-heading"><div><h2>Order activity</h2><p>Recorded fulfilment and payment events</p></div></div><div className="city-admin-timeline">
      {[...(item.statusHistory ?? []).map((entry) => ({ kind: 'Order', status: entry.status, createdAt: entry.changedAt, note: entry.note })), ...(item.paymentEvents ?? []).map((entry) => ({ kind: 'Payment', status: entry.status, createdAt: entry.createdAt, note: entry.note }))].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).map((entry, index) => <div key={`${entry.kind}-${entry.createdAt}-${index}`}><strong>{entry.kind}: {orderStatusLabel(entry.status)}</strong><small>{new Date(entry.createdAt).toLocaleString('en-IN')}{entry.note ? ` · ${entry.note}` : ''}</small></div>)}
      {!item.statusHistory?.length && !item.paymentEvents?.length && <div className="city-admin-empty">No order events recorded.</div>}
    </div></section>
  </div>;
}

function formatElapsed(timestamp: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function AdminGate({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }): ReactNode {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="page-container"><Loading label="Checking your session…" /></div>;
  if (!user) return <div className="page-container narrow"><PageIntro eyebrow="Protected workspace" title="Please sign in" description="Use your authorized eSakhi account to continue." /><Link to="/sign-in" state={{ from: location.pathname }} className="button">Sign in</Link></div>;
  if (adminOnly && user.role !== 'admin' && user.role !== 'super_admin') return <div className="page-container narrow"><Notice tone="error">This workspace action requires an administrator account.</Notice><Link to="/admin" className="button button-outline">Back to workspace</Link></div>;
  if (!adminOnly && user.role !== 'admin' && user.role !== 'staff' && user.role !== 'super_admin') return <div className="page-container narrow"><Notice tone="error">Your account does not have workspace access.</Notice></div>;
  return <AdminLayout>{children}</AdminLayout>;
}

function AdminLayout({ children }: { children: ReactNode }): ReactNode {
  const { user } = useAuth();
  const admin = user?.role === 'admin' || user?.role === 'super_admin';
  return <div className="admin-shell"><aside className="admin-sidebar"><Link to="/admin" className="admin-brand"><img src="/images/maitri-sisterhood-logo.png" alt="" /><span>eSakhi<br /><small>Maker workspace</small></span></Link><span className="sidebar-label">WORKSPACE</span><nav className="admin-nav"><NavLink to="/admin" end>Overview</NavLink><NavLink to="/admin/products">Products</NavLink>{admin && <NavLink to="/admin/inventory">Inventory</NavLink>}<NavLink to="/admin/orders">Orders</NavLink>{admin && <NavLink to="/admin/delivery-partners">Delivery Partners</NavLink>}{admin && <NavLink to="/admin/customers">Customers</NavLink>}{admin && <NavLink to="/admin/settings">Store settings</NavLink>}<NavLink to="/admin/system">API status</NavLink></nav><div className="sidebar-user"><span className="avatar">{(user?.name || 'E').slice(0, 1).toUpperCase()}</span><span><strong>{user?.name || user?.phone}</strong><small>{user?.role}</small></span></div></aside><section className="admin-content">{children}</section></div>;
}

function AdminDashboardPage(): ReactNode {
  const result = useLoad(() => api.dashboard());
  const dashboard = result.data;
  useEffect(() => {
    const refresh = () => void result.reload(false);
    window.addEventListener('city-admin-order-updated', refresh);
    return () => window.removeEventListener('city-admin-order-updated', refresh);
  }, [result.reload]);
  return <div className="admin-page"><PageIntro eyebrow="Maker workspace" title="Good work starts with a clear view." description="Live operational data from your eSakhi store." />{result.error && <Notice tone="error">{result.error}</Notice>}{result.loading ? <Loading /> : dashboard && <><div className="metric-grid"><Metric label="Orders needing action" value={dashboard.ordersNeedingAction} /><Metric label="Payments to review" value={dashboard.pendingPayments} /><Metric label="Low-stock items" value={dashboard.lowStockItems} /></div><div className="admin-panel"><div className="panel-heading"><div><span className="eyebrow">Latest activity</span><h2>Recent orders</h2></div><Link to="/admin/orders" className="quiet-link">Open orders →</Link></div>{dashboard.recentOrders.length ? <div className="admin-table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Fulfilment</th></tr></thead><tbody>{dashboard.recentOrders.map((order) => <tr key={order._id}><td><Link to={`/admin/orders/${order._id}`}>{order.orderReference}</Link></td><td>{order.customerName}</td><td>{formatMoney(order.totalPaise)}</td><td><StatusBadge value={order.paymentStatus} /></td><td><StatusBadge value={order.fulfilmentStatus} /></td></tr>)}</tbody></table></div> : <EmptyState title="No orders to show yet">New orders will appear here when customers check out.</EmptyState>}</div></>}{result.error && <button className="button button-outline" onClick={() => void result.reload()}>Retry</button>}</div>;
}

function Metric({ label, value }: { label: string; value: number }): ReactNode {
  return <article className="metric-card"><span>{label}</span><strong>{value.toLocaleString('en-IN')}</strong><i aria-hidden="true">✿</i></article>;
}

function AdminProductsPage(): ReactNode {
  const categories = useLoad(() => api.categories());
  const [queryText, setQueryText] = useState('');
  const [active, setActive] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Product | null | false>(false);
  const query = new URLSearchParams({ page: String(page), limit: '20', archived: 'false' });
  if (queryText.trim()) query.set('q', queryText.trim());
  if (active) query.set('active', active);
  if (categoryId) query.set('categoryId', categoryId);
  if (subcategoryId) query.set('subcategoryId', subcategoryId);
  const products = useLoad(() => api.adminProducts(query), [page, queryText, active, categoryId, subcategoryId]);
  const { user } = useAuth();
  const refresh = () => void products.reload();
  return <div className="admin-page"><PageIntro eyebrow="Your collection" title="Product catalogue" description="Product details and prices are managed by the store. Stock is adjusted separately." />{products.error && <Notice tone="error">{products.error}</Notice>}{categories.error && <Notice tone="error">{categories.error}</Notice>}<div className="admin-toolbar"><label className="search-field"><span className="sr-only">Search products</span><input placeholder="Search products" value={queryText} onChange={(event) => { setPage(1); setQueryText(event.target.value); }} /><span>⌕</span></label><select aria-label="Filter by main category" value={categoryId} onChange={(event) => { setPage(1); setCategoryId(event.target.value); setSubcategoryId(''); }}><option value="">All categories</option>{(categories.data ?? []).map((category) => <option key={category.categoryId} value={category.categoryId}>{category.categoryName}</option>)}</select><select aria-label="Filter by subcategory" value={subcategoryId} disabled={!categoryId} onChange={(event) => { setPage(1); setSubcategoryId(event.target.value); }}><option value="">All subcategories</option>{(categories.data?.find((category) => category.categoryId === categoryId)?.subcategories ?? []).map((subcategory) => <option key={subcategory.subcategoryId} value={subcategory.subcategoryId}>{subcategory.subcategoryName}</option>)}</select><select aria-label="Filter by active status" value={active} onChange={(event) => { setPage(1); setActive(event.target.value); }}><option value="">All active states</option><option value="true">Active</option><option value="false">Inactive</option></select>{user?.role === 'admin' && <button className="button" onClick={() => setEditor(null)}>Add product +</button>}</div>{products.loading ? <Loading /> : products.data?.data.length ? <div className="admin-table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Visibility</th><th>Actions</th></tr></thead><tbody>{products.data.data.map((item) => <tr key={getId(item)}><td><div className="table-product">{item.imageUrls?.[0] ? <img src={resolveProductImageUrl(item.imageUrls[0])} alt="" /> : <span className="table-image-placeholder">✿</span>}<span><strong>{item.name}</strong><small>{item.slug}</small></span></div></td><td>{item.categoryName}<small>{item.subcategoryName}</small></td><td>{formatMoney(item.pricePaise)}</td><td>{item.variants?.length ? `${item.variants.length} options` : item.stock}</td><td><StatusBadge value={item.isActive ? 'active' : 'inactive'} />{user?.role === 'admin' && <button className="text-button danger-text" aria-label={`Delete ${item.name}`} onClick={() => void archive(item, refresh)}>Delete</button>}</td><td className="table-actions">{user?.role === 'admin' ? <button className="text-button" onClick={() => setEditor(item)}>Edit</button> : <span>Read only</span>}</td></tr>)}</tbody></table></div> : !products.loading && <EmptyState title="No products match these filters" />}{products.data?.pagination.totalPages && products.data.pagination.totalPages > 1 && <Pagination page={page} pages={products.data.pagination.totalPages} onChange={setPage} />}{editor !== false && <ProductEditor product={editor} onClose={() => setEditor(false)} onSaved={refresh} />}</div>;
}

async function archive(product: Product, refresh: () => void): Promise<void> {
  if (!window.confirm(`Delete “${product.name}” from the store? It will disappear from the customer catalogue, inventory, and this product list. Existing order history will be kept.`)) return;
  try { await api.archiveProduct(getId(product)); refresh(); }
  catch (error) { window.alert(displayError(error)); }
}

function ProductEditor({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: () => void }): ReactNode {
  const categories = useLoad(() => api.categories());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: product?.name ?? '',
    slug: product?.slug ?? '',
    description: product?.description ?? '',
    categoryId: product?.categoryId ?? 'home-and-living',
    subcategoryId: product?.subcategoryId ?? 'home-textiles',
    productType: product?.productType ?? '',
    price: product ? String(product.pricePaise / 100) : '',
    images: product?.imageUrls ?? [],
    stock: String(product?.stock ?? 0),
    lowStockThreshold: String(product?.lowStockThreshold ?? 5),
    isActive: product?.isActive ?? false,
  });
  const [files, setFiles] = useState<File[]>([]);
  const update = (key: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const selectedCategory = categories.data?.find((category) => category.categoryId === form.categoryId);
  const selectedSubcategory = selectedCategory?.subcategories.find((subcategory) => subcategory.subcategoryId === form.subcategoryId);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const imageUrls = [...form.images];
      for (const file of files) {
        const uploaded = await api.uploadProductImage(file);
        imageUrls.push(uploaded.imageUrl);
      }
      const payload: Record<string, unknown> = {
        name: form.name, slug: form.slug, description: form.description,
        categoryId: form.categoryId, subcategoryId: form.subcategoryId, productType: form.productType,
        pricePaise: Math.round(Number(form.price) * 100),
        imageUrls,
        lowStockThreshold: Number(form.lowStockThreshold), isActive: form.isActive,
      };
      if (!product) payload.stock = Number(form.stock);
      if (product) await api.updateProduct(getId(product), payload);
      else await api.createProduct(payload);
      onSaved(); onClose();
    } catch (cause) { setError(displayError(cause)); }
    finally { setSaving(false); }
  };
  const chooseImages = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (form.images.length + files.length + selected.length > 10) {
      setError('A product can have up to 10 images.');
      return;
    }
    const invalid = selected.find((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024);
    if (invalid) {
      setError('Choose JPEG, PNG, or WebP images that are 5 MB or smaller.');
      return;
    }
    setError('');
    setFiles((current) => [...current, ...selected]);
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="product-editor-title">
      <div className="modal-heading"><h2 id="product-editor-title">{product ? 'Edit product' : 'Add a product'}</h2><button className="close-button" onClick={onClose} aria-label="Close">×</button></div>
      <p>Choose up to 10 JPEG, PNG, or WebP images (5 MB max each). Stock changes use Inventory.</p>
      {error && <Notice tone="error">{error}</Notice>}
      {categories.error && <Notice tone="error">{categories.error}</Notice>}
      <form className="stack-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid">
          <label className="field"><span>Product name</span><input required maxLength={160} value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
          <label className="field"><span>URL slug</span><input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={form.slug} onChange={(event) => update('slug', event.target.value)} /></label>
          <label className="field"><span>Main category</span><select required value={form.categoryId} onChange={(event) => {
            const nextCategory = categories.data?.find((category) => category.categoryId === event.target.value);
            setForm((current) => ({ ...current, categoryId: event.target.value, subcategoryId: nextCategory?.subcategories[0]?.subcategoryId ?? '', productType: '' }));
          }}>{(categories.data ?? []).map((category) => <option key={category.categoryId} value={category.categoryId}>{category.categoryName}</option>)}</select></label>
          <label className="field"><span>Subcategory</span><select required value={form.subcategoryId} onChange={(event) => setForm((current) => ({ ...current, subcategoryId: event.target.value, productType: '' }))}>{(selectedCategory?.subcategories ?? []).map((subcategory) => <option key={subcategory.subcategoryId} value={subcategory.subcategoryId}>{subcategory.subcategoryName}</option>)}</select></label>
          <label className="field span-two"><span>Product type</span><input required list="admin-product-types" value={form.productType} onChange={(event) => update('productType', event.target.value)} /><datalist id="admin-product-types">{(selectedSubcategory?.productTypes ?? []).filter((item) => item.classificationStatus === 'classified').map((item) => <option key={item.productTypeId} value={item.productType} />)}</datalist></label>
          <label className="field"><span>Price (INR)</span><input required type="number" min="0.01" step="0.01" value={form.price} onChange={(event) => update('price', event.target.value)} /></label>
          <label className="field"><span>Low stock threshold</span><input type="number" min="0" value={form.lowStockThreshold} onChange={(event) => update('lowStockThreshold', event.target.value)} /></label>
          {!product && <label className="field"><span>Initial stock</span><input type="number" min="0" value={form.stock} onChange={(event) => update('stock', event.target.value)} /></label>}
          <label className="field span-two"><span>Description</span><textarea required maxLength={5000} rows={4} value={form.description} onChange={(event) => update('description', event.target.value)} /></label>
          <div className="field span-two"><span>Product images</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={chooseImages} disabled={saving || form.images.length + files.length >= 10} /><div className="image-upload-list">{form.images.map((image) => <div className="image-upload-item" key={image}><img src={resolveProductImageUrl(image)} alt="" /><span>{image.split('/').pop()}</span><button type="button" className="text-button danger-text" onClick={() => setForm((current) => ({ ...current, images: current.images.filter((item) => item !== image) }))} disabled={saving}>Remove</button></div>)}{files.map((file, index) => <div className="image-upload-item" key={`${file.name}-${index}`}><span>{file.name}</span><button type="button" className="text-button danger-text" onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} disabled={saving}>Remove</button></div>)}</div></div>
          <label className="checkbox-field span-two"><input type="checkbox" checked={form.isActive} onChange={(event) => update('isActive', event.target.checked)} /><span>Visible in public catalogue</span></label>
        </div>
        {form.categoryId === 'food-items' && <Notice>Food listings stay unpublished until the seller's FSSAI details have been verified.</Notice>}
        <div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button className="button" disabled={saving || categories.loading || !categories.data?.length}>{saving ? 'Uploading and saving…' : 'Save product'}</button></div>
      </form>
    </section>
  </div>;
}

function AdminInventoryPage(): ReactNode {
  const categories = useLoad(() => api.categories());
  const [page, setPage] = useState(1);
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const query = new URLSearchParams({ page: String(page), limit: '100', archived: 'false' });
  if (categoryId) query.set('categoryId', categoryId);
  if (subcategoryId) query.set('subcategoryId', subcategoryId);
  const products = useLoad(() => api.adminProducts(query), [page, categoryId, subcategoryId]);
  const [selection, setSelection] = useState('');
  const [quantityChange, setQuantityChange] = useState('');
  const [reason, setReason] = useState('');
  const [variantId, setVariantId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const selected = products.data?.data.find((product) => getId(product) === selection);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setMessage(''); setSaving(true);
    try {
      await api.adjustInventory(selection, { quantityChange: Number(quantityChange), reason, ...(variantId ? { variantId } : {}) });
      setMessage('Inventory adjustment recorded.');
      setQuantityChange(''); setReason('');
      await products.reload();
    } catch (cause) { setError(displayError(cause)); }
    finally { setSaving(false); }
  };
  return <div className="admin-page"><PageIntro eyebrow="Stock control" title="Inventory" description="Every adjustment is recorded with a reason. Product edit screens do not change stock." />{products.error && <Notice tone="error">{products.error}</Notice>}{categories.error && <Notice tone="error">{categories.error}</Notice>}<div className="admin-toolbar"><select aria-label="Filter inventory by main category" value={categoryId} onChange={(event) => { setPage(1); setCategoryId(event.target.value); setSubcategoryId(''); }}><option value="">All categories</option>{(categories.data ?? []).map((category) => <option key={category.categoryId} value={category.categoryId}>{category.categoryName}</option>)}</select><select aria-label="Filter inventory by subcategory" value={subcategoryId} disabled={!categoryId} onChange={(event) => { setPage(1); setSubcategoryId(event.target.value); }}><option value="">All subcategories</option>{(categories.data?.find((category) => category.categoryId === categoryId)?.subcategories ?? []).map((subcategory) => <option key={subcategory.subcategoryId} value={subcategory.subcategoryId}>{subcategory.subcategoryName}</option>)}</select></div>{products.loading ? <Loading /> : <><div className="admin-panel"><div className="panel-heading"><div><span className="eyebrow">Current inventory</span><h2>Stock at a glance</h2></div></div>{products.data?.data.length ? <div className="admin-table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Stock</th><th>Low stock at</th><th>Variants</th></tr></thead><tbody>{products.data.data.map((product) => <tr key={getId(product)}><td>{product.name}</td><td>{product.categoryName}<small>{product.subcategoryName}</small></td><td>{product.variants.length ? 'By option' : product.stock}</td><td>{product.lowStockThreshold}</td><td>{product.variants.length || '—'}</td></tr>)}</tbody></table></div> : <EmptyState title="No products in inventory" />}{products.data?.pagination.totalPages && products.data.pagination.totalPages > 1 && <Pagination page={page} pages={products.data.pagination.totalPages} onChange={setPage} />}</div><form className="panel stock-form" onSubmit={(event) => void submit(event)}><span className="eyebrow">Record a change</span><h2>Adjust stock</h2>{error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}<div className="form-grid"><label className="field span-two"><span>Product (current page)</span><select required value={selection} onChange={(event) => { setSelection(event.target.value); setVariantId(''); }}><option value="">Choose a product</option>{(products.data?.data ?? []).map((product) => <option key={getId(product)} value={getId(product)}>{product.name}</option>)}</select></label>{Boolean(selected?.variants.length) && <label className="field span-two"><span>Variant</span><select required value={variantId} onChange={(event) => setVariantId(event.target.value)}><option value="">Choose option</option>{selected?.variants.map((variant) => <option key={variant._id} value={variant._id}>{Object.values(variant.attributes).join(' · ') || variant.sku}</option>)}</select></label>}<label className="field"><span>Quantity change (+/-)</span><input required type="number" min="-100000" max="100000" value={quantityChange} onChange={(event) => setQuantityChange(event.target.value)} /></label><label className="field"><span>Reason</span><input required maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Restock, correction…" /></label></div><button className="button" disabled={saving || !selection}>{saving ? 'Recording…' : 'Record adjustment'}</button></form></>}</div>;
}

function AdminOrdersPage(): ReactNode {
  const { user } = useAuth();
  const [queryText, setQueryText] = useState('');
  const [payment, setPayment] = useState('');
  const [fulfilment, setFulfilment] = useState('');
  const [cancellationRequest, setCancellationRequest] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (queryText.trim()) query.set('q', queryText.trim());
  if (payment) query.set('paymentStatus', payment);
  if (fulfilment) query.set('fulfilmentStatus', fulfilment);
  if (cancellationRequest) query.set('cancellationRequest', cancellationRequest);
  if (from) query.set('from', new Date(from).toISOString());
  if (to) query.set('to', new Date(to).toISOString());
  const result = useLoad(() => api.adminOrders(query), [page, queryText, payment, fulfilment, cancellationRequest, from, to]);
  useRefreshOnFocus(result.reload);
  const notificationFailures = useLoad(
    () => user?.role === 'admin'
      ? api.failedNotifications()
      : Promise.resolve({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }),
    [user?.role],
  );
  const retryNotification = async (id: string) => {
    try {
      await api.retryNotification(id);
      await notificationFailures.reload();
    } catch (cause) {
      window.alert(displayError(cause));
    }
  };
  return (
    <div className="admin-page">
      <PageIntro eyebrow="Customer care" title="Orders" description="Search live orders and handle fulfilment, payment review, and cancellation requests." />
      {result.error && <Notice tone="error">{result.error}</Notice>}
      {user?.role === 'admin' && notificationFailures.error && <Notice tone="error">{notificationFailures.error}</Notice>}
      {user?.role === 'admin' && notificationFailures.data?.data.length ? <section className="admin-panel">
        <div className="panel-heading"><div><span className="eyebrow">Push delivery</span><h2>Failed customer notifications</h2></div></div>
        <div className="notification-retry-list">{notificationFailures.data.data.map((notification) => <div className="notification-retry-item" key={notification._id}>
          <span>{notification.orderReference} · {orderStatusLabel(notification.status)} · {notification.lastErrorCode || 'Delivery failed'}</span>
          <button className="text-button" onClick={() => void retryNotification(notification._id)}>Retry</button>
        </div>)}</div>
      </section> : null}
      <div className="admin-toolbar">
        <label className="search-field"><span className="sr-only">Search orders</span><input value={queryText} onChange={(event) => { setPage(1); setQueryText(event.target.value); }} placeholder="Order, customer, or phone" /><span>⌕</span></label>
        <select aria-label="Filter payment status" value={payment} onChange={(event) => { setPage(1); setPayment(event.target.value); }}><option value="">All payment states</option><option value="pending_verification">Pending verification</option><option value="confirmed">Confirmed</option><option value="rejected">Rejected</option></select>
        <select aria-label="Filter fulfilment status" value={fulfilment} onChange={(event) => { setPage(1); setFulfilment(event.target.value); }}><option value="">All fulfilment states</option>{['placed', 'accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'completed', 'cancelled'].map((state) => <option key={state} value={state}>{orderStatusLabel(state)}</option>)}</select>
        <select aria-label="Filter cancellation requests" value={cancellationRequest} onChange={(event) => { setPage(1); setCancellationRequest(event.target.value); }}><option value="">All cancellation requests</option><option value="pending">Pending review</option><option value="reviewed">Reviewed</option></select>
        <label className="date-filter"><span>From</span><input type="datetime-local" value={from} onChange={(event) => { setPage(1); setFrom(event.target.value); }} /></label>
        <label className="date-filter"><span>To</span><input type="datetime-local" value={to} onChange={(event) => { setPage(1); setTo(event.target.value); }} /></label>
      </div>
      {result.loading ? <Loading /> : result.data?.data.length ? <><div className="admin-table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Delivery location</th><th>Placed</th><th>Total</th><th>Payment</th><th>Fulfilment</th><th>Delivery partner</th><th>Cancellation</th></tr></thead><tbody>{result.data.data.map((order) => <tr key={order._id}><td><Link to={`/admin/orders/${order._id}`}>{order.orderReference}</Link></td><td>{order.customerName}<small>{order.customerPhoneE164}</small></td><td>{order.fulfilmentMethod === 'pickup' ? 'Pickup' : order.address ? <>{order.address.locality}, {order.address.city}<small>{order.address.state} {order.address.postalCode}</small></> : 'Address unavailable'}</td><td>{order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN') : '—'}</td><td>{formatMoney(order.totalPaise)}</td><td><StatusBadge value={order.paymentStatus} /></td><td><StatusBadge value={order.fulfilmentStatus} fulfilmentMethod={order.fulfilmentMethod} /></td><td>{order.deliveryPartner?.name ?? (order.fulfilmentMethod === 'delivery' ? 'Not assigned' : '—')}</td><td>{order.cancellationRequest?.requestedAt ? <Link to={`/admin/orders/${order._id}`}>{order.cancellationRequest.decision ? `Reviewed: ${order.cancellationRequest.decision}` : 'Pending review'}</Link> : '—'}</td></tr>)}</tbody></table></div>{result.data.pagination.totalPages > 1 && <Pagination page={page} pages={result.data.pagination.totalPages} onChange={setPage} />}</> : !result.error && <EmptyState title="No orders match these filters" />}
    </div>
  );
}

function AdminOrderPage(): ReactNode {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const order = useLoad(() => api.adminOrder(id), [id]);
  const [note, setNote] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [partnerPage, setPartnerPage] = useState(1);
  const [partnerName, setPartnerName] = useState('');
  const [partnerPhone, setPartnerPhone] = useState('');
  const [partnerNotes, setPartnerNotes] = useState('');
  const [cancellationNote, setCancellationNote] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const admin = user?.role === 'admin' || user?.role === 'super_admin';
  const partners = useLoad(() => admin
    ? api.deliveryPartners(partnerPage, 100)
    : Promise.resolve({ data: [], pagination: { page: 1, limit: 100, total: 0, totalPages: 0 } }), [admin, partnerPage]);
  const reload = async () => { await order.reload(); };
  useEffect(() => {
    if (!order.data?.deliveryPartner) return;
    setPartnerId(order.data.deliveryPartner.userId ?? '');
    setPartnerName(order.data.deliveryPartner.name);
    setPartnerPhone(order.data.deliveryPartner.phoneE164);
    setPartnerNotes(order.data.deliveryPartner.internalNotes ?? '');
  }, [order.data?.deliveryPartner]);
  if (order.loading) return <div className="admin-page"><Loading /></div>;
  if (!order.data) return <div className="admin-page"><Notice tone="error">{order.error || 'Order not found.'}</Notice></div>;
  const item = order.data;
  const nextStatus = item.fulfilmentStatus === 'placed' ? 'accepted'
    : item.fulfilmentStatus === 'accepted' ? 'preparing'
      : item.fulfilmentStatus === 'preparing' ? item.fulfilmentMethod === 'pickup' ? 'ready_for_pickup' : 'out_for_delivery'
        : item.fulfilmentStatus === 'ready_for_pickup' ? 'completed'
          : item.fulfilmentStatus === 'out_for_delivery' ? 'delivered'
            : '';
  const statusActionLabel: Record<string, string> = {
    accepted: 'Confirm order',
    preparing: 'Mark as packed',
    ready_for_pickup: 'Mark ready for pickup',
    out_for_delivery: 'Mark as Out for Delivery',
    delivered: 'Mark as Delivered',
    completed: 'Confirm pickup completed',
  };
  const canAssignPartner = item.fulfilmentMethod === 'delivery'
    && ['preparing', 'out_for_delivery', 'delivery_failed'].includes(item.fulfilmentStatus)
    && (!item.deliveryPartner || item.fulfilmentStatus === 'delivery_failed');
  const selectedPartner = partners.data?.data.find((partner) => getId(partner) === partnerId);
  const act = async (operation: () => Promise<unknown>, success: string) => {
    setError(''); setMessage('');
    try { await operation(); setMessage(success); await reload(); }
    catch (cause) { setError(displayError(cause)); }
  };
  const assignPartner = (event: FormEvent) => {
    event.preventDefault();
    void act(
      async () => {
        const assigned = await api.assignDeliveryPartner(id, {
          ...(partnerId ? { partnerId } : { name: partnerName, phone: partnerPhone }),
          ...(partnerNotes.trim() ? { internalNotes: partnerNotes.trim() } : {}),
        });
        await partners.reload(false);
        return assigned;
      },
      item.deliveryPartner ? 'Delivery partner updated.' : 'Delivery partner assigned.',
    );
  };
  return (
    <div className="admin-page">
      <div className="breadcrumbs"><Link to="/admin/orders">Orders</Link><span>/</span>{item.orderReference}</div>
      <PageIntro eyebrow="Order workspace" title={item.orderReference} description={`${item.customerName} · ${item.customerPhoneE164}`}>
        <StatusBadge value={item.fulfilmentStatus} fulfilmentMethod={item.fulfilmentMethod} />
      </PageIntro>
      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      <div className="order-detail-grid">
        <section className="panel">
          <h2>Order items</h2>
          {item.items.map((line, index) => <div key={`${line.productId}-${index}`} className="order-line"><span>{line.productName} × {line.quantity}</span><strong>{formatMoney(line.lineTotalPaise)}</strong></div>)}
          <div className="order-line"><span>Subtotal</span><strong>{formatMoney(item.subtotalPaise)}</strong></div>
          <div className="order-line"><span>Delivery</span><strong>{formatMoney(item.deliveryFeePaise)}</strong></div>
          <div className="order-line total-line"><span>Total</span><strong>{formatMoney(item.totalPaise)}</strong></div>
          <h3>Delivery & payment</h3>
          <p>{item.fulfilmentMethod}: {item.address ? `${item.address.addressLine1}, ${item.address.locality}, ${item.address.postalCode}` : 'Pickup'}</p>
          <p>Payment status: <StatusBadge value={item.paymentStatus} /></p>
          {item.paymentEvents?.length ? <div className="order-history-admin"><h3>Payment review history</h3>{item.paymentEvents.map((event, index) => <p key={`${event.status}-${event.createdAt}-${index}`}><StatusBadge value={event.status} /> {new Date(event.createdAt).toLocaleString('en-IN')} · {event.note}</p>)}</div> : null}
          {item.statusHistory?.length ? <div className="order-history-admin"><h3>Status history</h3>{item.statusHistory.map((entry, index) => <p key={`${entry.status}-${entry.changedAt}-${index}`}><StatusBadge value={entry.status} fulfilmentMethod={item.fulfilmentMethod} /> {new Date(entry.changedAt).toLocaleString('en-IN')}{entry.note ? ` · ${entry.note}` : ''}</p>)}</div> : null}
        </section>
        <aside className="panel action-panel">
          <h2>Actions</h2>
          <p>Fulfilment: <StatusBadge value={item.fulfilmentStatus} fulfilmentMethod={item.fulfilmentMethod} /></p>
          {canAssignPartner && <form className="stack-form delivery-partner-form" onSubmit={assignPartner}>
            <h3>Delivery Assignment</h3>
            {admin && <label className="field"><span>Select an existing delivery partner</span><select value={partnerId} onChange={(event) => {
              const selectedId = event.target.value;
              const selected = partners.data?.data.find((partner) => getId(partner) === selectedId);
              setPartnerId(selectedId);
              if (selected) {
                setPartnerName(selected.name ?? '');
                setPartnerPhone(selected.phoneE164 ?? selected.phone ?? '');
              }
            }}><option value="">Manual assignment (legacy)</option>{item.deliveryPartner?.userId && !partners.data?.data.some((partner) => getId(partner) === item.deliveryPartner?.userId) && <option value={item.deliveryPartner.userId}>{item.deliveryPartner.name} · {item.deliveryPartner.phoneE164} · currently assigned</option>}{partners.data?.data.map((partner) => <option key={getId(partner)} value={getId(partner)} disabled={partner.status === 'disabled' && getId(partner) !== item.deliveryPartner?.userId}>{partner.name || 'Delivery Partner'} · {partner.phoneE164 ?? partner.phone} · {partner.status}</option>)}</select></label>}
            {partners.error && admin && <Notice tone="error">{partners.error}</Notice>}
            {selectedPartner && <div className="delivery-partner-card"><strong>Selected partner details</strong><span>{selectedPartner.name || 'Delivery Partner'}</span><a href={`tel:${selectedPartner.phoneE164 ?? selectedPartner.phone}`}>{selectedPartner.phoneE164 ?? selectedPartner.phone}</a>{selectedPartner.email && <span>{selectedPartner.email}</span>}<small>Account {getId(selectedPartner)} · {selectedPartner.status} · {selectedPartner.assignedCount} active orders</small></div>}
            {admin && partners.data && partners.data.pagination.totalPages > 1 && <Pagination page={partnerPage} pages={partners.data.pagination.totalPages} onChange={setPartnerPage} />}
            {!partnerId && <><label className="field"><span>Partner name</span><input required maxLength={120} value={partnerName} onChange={(event) => setPartnerName(event.target.value)} /></label>
            <label className="field"><span>Indian mobile number</span><input required inputMode="tel" pattern="(\\+91)?[6-9][0-9]{9}" value={partnerPhone} onChange={(event) => setPartnerPhone(event.target.value)} /></label></>}
            <label className="field"><span>Internal delivery notes (optional)</span><textarea maxLength={500} rows={2} value={partnerNotes} onChange={(event) => setPartnerNotes(event.target.value)} /></label>
            <button className="button button-outline button-full">{item.deliveryPartner ? 'Save reassignment' : 'Assign partner'}</button>
          </form>}
          {nextStatus && <><label className="field"><span>Customer-visible status note (optional)</span><textarea maxLength={500} rows={2} value={statusNote} onChange={(event) => setStatusNote(event.target.value)} /></label>
            <button className="button button-full" disabled={nextStatus === 'out_for_delivery' && item.fulfilmentMethod === 'delivery' && !item.deliveryPartner} onClick={() => void act(() => api.fulfilOrder(id, nextStatus, statusNote), `${orderStatusLabel(nextStatus, item.fulfilmentMethod)} status recorded.`)}>{statusActionLabel[nextStatus]}</button>
          </>}
          <section className="delivery-partner-card"><strong>Delivery Assignment</strong>{item.deliveryPartner ? <><span>Assignment status: Assigned</span><span>{item.deliveryPartner.name}</span><a href={`tel:${item.deliveryPartner.phoneE164}`}>{item.deliveryPartner.phoneE164}</a><small>Assigned {new Date(item.deliveryPartner.assignedAt).toLocaleString('en-IN')}</small>{item.deliveryPartner.userId && <Link to={`/admin/delivery-partners/${item.deliveryPartner.userId}`}>View partner profile and other orders</Link>}</> : <><span>Not assigned</span>{canAssignPartner && <span>Assign an existing partner above to enable delivery progress.</span>}</>}</section>
          {item.deliveryPartnerHistory?.length ? <div className="delivery-partner-card"><strong>Previous assignments</strong>{item.deliveryPartnerHistory.map((assignment, index) => <span key={`${assignment.userId ?? assignment.name}-${index}`}>{assignment.name} · {assignment.phoneE164} · {new Date(assignment.assignedAt).toLocaleString('en-IN')} to {new Date(assignment.unassignedAt).toLocaleString('en-IN')}</span>)}</div> : null}
          <label className="field"><span>Internal note</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Only staff and admins can see this" /></label>
          <button className="button button-outline button-full" disabled={!note.trim()} onClick={() => void act(() => api.addOrderNote(id, note), 'Internal note added.')}>Add note</button>
          {item.internalNotes?.map((entry, index) => <p className="internal-note" key={`${index}-${entry}`}>{entry}</p>)}
          {admin && item.paymentStatus === 'pending_verification' && <><hr /><h3>Review payment status</h3><p>Confirm only after verifying payment. This review is recorded and cannot be changed here afterward.</p><label className="field"><span>Required review note</span><textarea minLength={1} maxLength={1000} rows={2} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></label><div className="button-row"><button className="button" disabled={!reviewNote.trim()} onClick={() => void act(() => api.reviewPayment(id, 'confirmed', reviewNote), 'Payment confirmed.')}>Confirm received payment</button><button className="button button-danger" disabled={!reviewNote.trim()} onClick={() => void act(() => api.reviewPayment(id, 'rejected', reviewNote), 'Payment marked rejected.')}>Mark payment rejected</button></div></>}
          {admin && item.cancellationRequest?.requestedAt && <><hr /><h3>Cancellation request</h3><p>Received {new Date(item.cancellationRequest.requestedAt).toLocaleString('en-IN')}</p><p>{item.cancellationRequest.customerNote || 'No customer note provided.'}</p>{item.cancellationRequest.decision ? <Notice>Request {item.cancellationRequest.decision}{item.cancellationRequest.adminNote ? `: ${item.cancellationRequest.adminNote}` : ''}</Notice> : <><label className="field"><span>Response note (optional)</span><textarea maxLength={500} rows={2} value={cancellationNote} onChange={(event) => setCancellationNote(event.target.value)} /></label><div className="button-row"><button className="button" onClick={() => void act(() => api.reviewCancellation(id, 'approved', cancellationNote), 'Cancellation approved.')}>Approve</button><button className="button button-outline" onClick={() => void act(() => api.reviewCancellation(id, 'rejected', cancellationNote), 'Cancellation declined.')}>Decline</button></div></>}</>}
        </aside>
      </div>
    </div>
  );
}

function AdminDeliveryPartnersPage(): ReactNode {
  const [partnerPage, setPartnerPage] = useState(1);
  const [orderPage, setOrderPage] = useState(1);
  const partners = useLoad(() => api.deliveryPartners(partnerPage, 100), [partnerPage]);
  const orders = useLoad(() => api.adminOrders(new URLSearchParams({ page: String(orderPage), limit: '100' })), [orderPage]);
  useRefreshOnFocus(partners.reload);
  useRefreshOnFocus(orders.reload);
  const [selectedPartnerId, setSelectedPartnerId] = useState('');
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [internalNotes, setInternalNotes] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const eligibleOrders = orders.data?.data.filter((order) =>
    order.fulfilmentMethod === 'delivery'
      && ['preparing', 'out_for_delivery', 'delivery_failed'].includes(order.fulfilmentStatus)
      && (!order.deliveryPartner || order.fulfilmentStatus === 'delivery_failed'),
  ) ?? [];
  const selectedPartner = partners.data?.data.find((partner) => getId(partner) === selectedPartnerId);

  const toggleOrder = (orderId: string) => {
    if (!selectedOrderIds.includes(orderId) && selectedOrderIds.length >= 100) {
      setError('Bulk assignment is limited to 100 orders per request.');
      return;
    }
    setError('');
    setSelectedOrderIds((current) => current.includes(orderId)
      ? current.filter((id) => id !== orderId)
      : [...current, orderId]);
  };
  const assignSelectedOrders = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPartnerId || !selectedOrderIds.length) return;
    if (!window.confirm(`Assign ${selectedOrderIds.length} order(s) to ${selectedPartner?.name || 'this delivery partner'}?`)) return;
    setError('');
    setMessage('');
    try {
      await api.bulkAssignDeliveryPartner({
        partnerId: selectedPartnerId,
        orderIds: selectedOrderIds,
        ...(internalNotes.trim() ? { internalNotes: internalNotes.trim() } : {}),
      });
      setSelectedOrderIds([]);
      setInternalNotes('');
      setMessage('Selected orders were assigned.');
      await Promise.all([partners.reload(false), orders.reload(false)]);
    } catch (cause) {
      setError(displayError(cause));
    }
  };

  return <div className="admin-page">
    <PageIntro eyebrow="Fulfilment" title="Delivery Partners" description="Review partner accounts and workload, assign multiple eligible orders, and open individual order assignments." />
    {(partners.error || orders.error || error) && <Notice tone="error">{error || partners.error || orders.error}</Notice>}
    {message && <Notice tone="success">{message}</Notice>}
    <section className="admin-panel">
      <div className="panel-heading"><div><span className="eyebrow">Partner accounts</span><h2>Delivery partner directory</h2></div></div>
      {partners.loading ? <Loading /> : partners.data?.data.length ? <div className="admin-table-wrap"><table><thead><tr><th>Partner</th><th>Mobile</th><th>Email</th><th>Account ID</th><th>Status</th><th>Active orders</th><th>Details</th></tr></thead><tbody>{partners.data.data.map((partner) => <tr key={getId(partner)}><td>{partner.name || 'Delivery Partner'}</td><td><a href={`tel:${partner.phoneE164 ?? partner.phone}`}>{partner.phoneE164 ?? partner.phone}</a></td><td>{partner.email || '—'}</td><td><code>{getId(partner)}</code></td><td><StatusBadge value={partner.status ?? 'active'} /></td><td>{partner.assignedCount}</td><td><Link to={`/admin/delivery-partners/${getId(partner)}`}>View details and orders</Link></td></tr>)}</tbody></table></div> : !partners.error && <EmptyState title="No delivery partner accounts found">Create or promote an account through the existing account workflow; orders do not create partner accounts.</EmptyState>}
      {partners.data && partners.data.pagination.totalPages > 1 && <Pagination page={partnerPage} pages={partners.data.pagination.totalPages} onChange={(page) => { setSelectedPartnerId(''); setPartnerPage(page); }} />}
    </section>
    <section className="admin-panel">
      <div className="panel-heading"><div><span className="eyebrow">Order assignment</span><h2>Assign eligible orders</h2></div></div>
      <form className="stack-form" onSubmit={(event) => void assignSelectedOrders(event)}>
        <label className="field"><span>Delivery partner</span><select required value={selectedPartnerId} onChange={(event) => setSelectedPartnerId(event.target.value)}><option value="">Select an active partner</option>{partners.data?.data.filter((partner) => partner.status === 'active').map((partner) => <option key={getId(partner)} value={getId(partner)}>{partner.name || 'Delivery Partner'} · {partner.phoneE164 ?? partner.phone}</option>)}</select></label>
        {selectedPartner && <div className="delivery-partner-card"><strong>Selected partner</strong><span>{selectedPartner.name || 'Delivery Partner'}</span><a href={`tel:${selectedPartner.phoneE164 ?? selectedPartner.phone}`}>{selectedPartner.phoneE164 ?? selectedPartner.phone}</a>{selectedPartner.email && <span>{selectedPartner.email}</span>}<small>{selectedPartner.assignedCount} active assigned order(s)</small></div>}
        <label className="field"><span>Internal assignment note (optional)</span><textarea maxLength={500} rows={2} value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} /></label>
        {orders.loading ? <Loading /> : eligibleOrders.length ? <div className="admin-table-wrap"><table><thead><tr><th>Select</th><th>Order</th><th>Customer</th><th>Delivery status</th><th>Assigned partner</th></tr></thead><tbody>{eligibleOrders.map((order) => <tr key={order._id}><td><input type="checkbox" aria-label={`Select order ${order.orderReference}`} checked={selectedOrderIds.includes(order._id)} disabled={!selectedOrderIds.includes(order._id) && selectedOrderIds.length >= 100} onChange={() => toggleOrder(order._id)} /></td><td><Link to={`/admin/orders/${order._id}`}>{order.orderReference}</Link></td><td>{order.customerName}<small>{order.customerPhoneE164}</small></td><td><StatusBadge value={order.fulfilmentStatus} fulfilmentMethod={order.fulfilmentMethod} /></td><td>{order.deliveryPartner?.name || 'Not assigned'}</td></tr>)}</tbody></table></div> : !orders.error && <EmptyState title="No eligible delivery orders on this page" />}
        {orders.data && orders.data.pagination.totalPages > 1 && <Pagination page={orderPage} pages={orders.data.pagination.totalPages} onChange={setOrderPage} />}
        <button className="button" disabled={!selectedPartnerId || !selectedOrderIds.length}>{`Assign ${selectedOrderIds.length || ''} selected order${selectedOrderIds.length === 1 ? '' : 's'}`}</button>
      </form>
    </section>
  </div>;
}

function AdminDeliveryPartnerPage(): ReactNode {
  const { id = '' } = useParams();
  const [page, setPage] = useState(1);
  const result = useLoad(() => api.deliveryPartner(id, page), [id, page]);
  useRefreshOnFocus(result.reload);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const details = result.data;
  const partner = details?.partner;
  const toggleStatus = async () => {
    if (!partner) return;
    const status = partner.status === 'disabled' ? 'active' : 'disabled';
    setError('');
    setMessage('');
    try {
      await api.updateDeliveryPartnerStatus(id, status);
      await result.reload(false);
      setMessage(`Partner account ${status === 'active' ? 'activated' : 'deactivated'}.`);
    } catch (cause) {
      setError(displayError(cause));
    }
  };
  if (result.loading) return <div className="admin-page"><Loading /></div>;
  if (!details || !partner) return <div className="admin-page"><Notice tone="error">{result.error || 'Delivery partner not found.'}</Notice></div>;
  return <div className="admin-page">
    <div className="breadcrumbs"><Link to="/admin/delivery-partners">Delivery Partners</Link><span>/</span>Partner details</div>
    <PageIntro eyebrow="Delivery partner profile" title={partner.name || 'Delivery Partner'} description="Account details and orders currently assigned to this partner." />
    {error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}
    <section className="panel delivery-partner-card"><strong>Partner details</strong><span>Mobile: <a href={`tel:${partner.phoneE164 ?? partner.phone}`}>{partner.phoneE164 ?? partner.phone}</a></span><span>Email: {partner.email || 'Not available'}</span><span>Account ID: <code>{getId(partner)}</code></span><span>Status: <StatusBadge value={partner.status ?? 'active'} /></span><span>Assigned orders on this list: {details.orders.pagination.total}</span><button className="button button-outline" onClick={() => void toggleStatus()}>{partner.status === 'disabled' ? 'Activate partner' : 'Deactivate partner'}</button></section>
    <section className="admin-panel"><div className="panel-heading"><div><span className="eyebrow">Current assignments</span><h2>Orders assigned to this partner</h2></div></div>
      {details.orders.data.length ? <div className="admin-table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Delivery status</th><th>Assigned at</th><th>Open</th></tr></thead><tbody>{details.orders.data.map((order) => <tr key={order._id}><td>{order.orderReference}</td><td>{order.customerName}<small>{order.customerPhoneE164}</small></td><td><StatusBadge value={order.fulfilmentStatus} fulfilmentMethod={order.fulfilmentMethod} /></td><td>{order.deliveryPartner?.assignedAt ? new Date(order.deliveryPartner.assignedAt).toLocaleString('en-IN') : '—'}</td><td><Link to={`/admin/orders/${order._id}`}>Open order</Link></td></tr>)}</tbody></table></div> : <EmptyState title="No current orders assigned" />}
      {details.orders.pagination.totalPages > 1 && <Pagination page={page} pages={details.orders.pagination.totalPages} onChange={setPage} />}
    </section>
  </div>;
}

function SellerRegistrationPage(): ReactNode {
  const categories = useLoad(() => api.categories());
  const [submitted, setSubmitted] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    shgName: '',
    representative: '',
    phone: '',
    city: 'Damoh',
    address: '',
    categoryId: 'womens-apparel-accessories',
    subcategoryId: 'jewellery-accessories',
    productType: '',
    fssaiRegistrationNumber: '',
  });

  function updateField(field: keyof typeof form, value: string): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  const selectedCategory = categories.data?.find((category) => category.categoryId === form.categoryId);
  const selectedSubcategory = selectedCategory?.subcategories.find((subcategory) => subcategory.subcategoryId === form.subcategoryId);
  const isFoodSeller = form.categoryId === 'food-items';

  async function submitApplication(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    setSubmitted('');
    setSaving(true);
    try {
      const { fssaiRegistrationNumber, ...application } = form;
      const result = await api.submitSellerApplication({
        ...application,
        ...(isFoodSeller ? { fssaiRegistrationNumber } : {}),
      });
      setSubmitted(result.message);
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-container narrow">
      <div className="page-intro">
        <div>
          <span className="eyebrow">Seller onboarding</span>
          <h1>Start as a new seller</h1>
        </div>
        <Link to="/seller" className="button button-outline">Back to seller portal</Link>
      </div>
      <section className="panel seller-application-card">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">SHG application</span>
            <h2>Basic seller profile</h2>
          </div>
        </div>
        <div className="panel-body compact-form">
          {submitted && <Notice tone="success">{submitted}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          {categories.error && <div className="section-state"><Notice tone="error">{categories.error}</Notice><button type="button" className="button button-outline" onClick={() => void categories.reload()}>Retry categories</button></div>}
          <form className="stack-form" onSubmit={(event) => void submitApplication(event)}>
            <label className="field"><span>SHG or seller name</span><input required value={form.shgName} onChange={(event) => updateField('shgName', event.target.value)} placeholder="Example: Sakhi Craft Collective" /></label>
            <label className="field"><span>Authorized representative</span><input required value={form.representative} onChange={(event) => updateField('representative', event.target.value)} placeholder="Full name" /></label>
            <label className="field"><span>Phone number</span><input required type="tel" inputMode="tel" pattern="(\\+91)?[6-9][0-9]{9}" title="Enter a valid 10-digit Indian mobile number, optionally with +91." maxLength={13} value={form.phone} onChange={(event) => updateField('phone', event.target.value)} placeholder="+919876543210" /></label>
            <div className="form-grid two-up">
              <label className="field"><span>City</span><select value={form.city} onChange={(event) => updateField('city', event.target.value)}><option>Damoh</option></select></label>
              <label className="field"><span>Main category</span><select required disabled={categories.loading || !categories.data?.length} value={form.categoryId} onChange={(event) => {
                const nextCategory = categories.data?.find((category) => category.categoryId === event.target.value);
                setForm((current) => ({ ...current, categoryId: event.target.value, subcategoryId: nextCategory?.subcategories[0]?.subcategoryId ?? '', productType: '', fssaiRegistrationNumber: '' }));
              }}>{(categories.data ?? []).map((category) => <option key={category.categoryId} value={category.categoryId}>{category.categoryName}</option>)}</select></label>
            </div>
            <label className="field"><span>Subcategory</span><select required disabled={!selectedCategory} value={form.subcategoryId} onChange={(event) => {
              setForm((current) => ({ ...current, subcategoryId: event.target.value, productType: '' }));
            }}>{(selectedCategory?.subcategories ?? []).map((subcategory) => <option key={subcategory.subcategoryId} value={subcategory.subcategoryId}>{subcategory.subcategoryName}</option>)}</select></label>
            <label className="field"><span>Primary product type</span><input required list="seller-application-product-types" value={form.productType} onChange={(event) => updateField('productType', event.target.value)} placeholder="Describe the product type" /><datalist id="seller-application-product-types">{(selectedSubcategory?.productTypes ?? []).map((type) => <option key={type.productTypeId} value={type.productType} />)}</datalist></label>
            {isFoodSeller && <label className="field"><span>FSSAI registration or licence number</span><input required inputMode="numeric" pattern="[0-9]{14}" maxLength={14} value={form.fssaiRegistrationNumber} onChange={(event) => updateField('fssaiRegistrationNumber', event.target.value)} placeholder="14-digit number" /><small>Food seller access and food listings stay blocked until a City Admin verifies this number.</small></label>}
            <label className="field"><span>Registered address</span><textarea required rows={4} value={form.address} onChange={(event) => updateField('address', event.target.value)} placeholder="Street, locality, village, city" /></label>
            <Notice>Only product-relevant information is requested here. GST, HSN, and tax choices are reviewed by the City Admin after approval, not by the seller at onboarding.</Notice>
            <button type="submit" className="button button-full" disabled={saving || categories.loading || !categories.data?.length}>{saving ? 'Submitting…' : 'Submit seller application'}</button>
          </form>
        </div>
      </section>
    </div>
  );
}

function CityAdminSellerApplicationsPage(): ReactNode {
  const [tab, setTab] = useState<'applications' | 'sellers'>('applications');
  const [status, setStatus] = useState('pending');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [verifiedFssai, setVerifiedFssai] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const query = new URLSearchParams({ page: '1', limit: '50', status });
  const result = useLoad(() => api.cityAdminSellerApplications(query), [status]);

  async function review(applicationId: string, decision: 'approved' | 'rejected' | 'needs_info', fssaiDecision?: 'verified'): Promise<void> {
    setError('');
    setMessage('');
    try {
      await api.reviewSellerApplication(applicationId, decision, notes[applicationId]?.trim(), fssaiDecision);
      setMessage(decision === 'approved' ? 'Application approved and seller account access granted.' : decision === 'rejected' ? 'Application rejected.' : 'Application returned for more information.');
      await result.reload();
    } catch (cause) {
      setError(displayError(cause));
    }
  }

  return (
    <div className="city-admin-page">
      <div className="city-admin-page-heading"><div><p className="city-admin-eyebrow">Seller onboarding</p><h1>Sellers & SHGs</h1><p>Review applications for your assigned city. Seller access is granted only after approval.</p></div></div>
      {error && <div className="city-admin-error" role="alert">{error}</div>}
      {message && <Notice tone="success">{message}</Notice>}
      <div className="city-admin-tabs" role="tablist" aria-label="Seller views">
        <button type="button" role="tab" aria-selected={tab === 'applications'} className={tab === 'applications' ? 'active' : ''} onClick={() => setTab('applications')}>Applications</button>
        <button type="button" role="tab" aria-selected={tab === 'sellers'} className={tab === 'sellers' ? 'active' : ''} onClick={() => setTab('sellers')}>Approved sellers</button>
      </div>
      {tab === 'sellers' ? <CityAdminSellerDirectory /> : <>
      <section className="city-admin-panel city-admin-order-directory">
        <div className="city-admin-order-tools">
          <select aria-label="Filter seller applications by status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="pending">Awaiting review</option><option value="needs_info">Needs more information</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
          </select>
        </div>
        {result.loading ? <Loading label="Loading seller applications…" /> : result.data?.data.length ? <div className="city-admin-review-grid">
          {result.data.data.map((application) => <article key={application._id} className="city-admin-review-card panel">
            <div className="panel-heading"><div><span className="eyebrow">{application.city} · {new Date(application.createdAt).toLocaleDateString('en-IN')}</span><h2>{application.shgName}</h2></div><span className={`status-pill status-${application.status.replaceAll('_', '-')}`}>{application.status.replaceAll('_', ' ')}</span></div>
            <div className="panel-body">
              <dl className="review-field-grid">
                <div><dt>Representative</dt><dd>{application.representative}</dd></div>
                <div><dt>Phone</dt><dd><a href={`tel:${application.phoneE164}`}>{application.phoneE164}</a></dd></div>
                <div><dt>Primary product type</dt><dd>{application.primaryProductType}</dd></div>
                <div><dt>Category</dt><dd>{application.primaryCategoryName || 'Not recorded'}{application.primarySubcategoryName ? ` · ${application.primarySubcategoryName}` : ''}</dd></div>
                {application.primaryCategoryId === 'food-items' && <div><dt>FSSAI registration / licence</dt><dd>{application.fssaiRegistrationNumber || 'Not provided'} · {application.fssaiStatus.replaceAll('_', ' ')}</dd></div>}
                <div><dt>Registered address</dt><dd>{application.registeredAddress}</dd></div>
                {application.reviewNote && <div><dt>Previous review note</dt><dd>{application.reviewNote}</dd></div>}
              </dl>
              {application.status === 'pending' || application.status === 'needs_info' ? <>
                <label className="field"><span>Review note (required to reject)</span><textarea rows={2} maxLength={1000} value={notes[application._id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [application._id]: event.target.value }))} /></label>
                {application.primaryCategoryId === 'food-items' && <label className="checkbox-field"><input type="checkbox" checked={verifiedFssai[application._id] ?? false} onChange={(event) => setVerifiedFssai((current) => ({ ...current, [application._id]: event.target.checked }))} /><span>I reviewed the submitted FSSAI details and confirm they are verified.</span></label>}
                <div className="button-row review-actions">
                  <button type="button" className="button" disabled={application.primaryCategoryId === 'food-items' && !(verifiedFssai[application._id] ?? false)} onClick={() => void review(application._id, 'approved', application.primaryCategoryId === 'food-items' ? 'verified' : undefined)}>Approve seller</button>
                  <button type="button" className="button button-outline" onClick={() => void review(application._id, 'needs_info')}>Request information</button>
                  <button type="button" className="button button-light" disabled={!notes[application._id]?.trim()} onClick={() => void review(application._id, 'rejected')}>Reject</button>
                </div>
              </> : application.reviewedAt && <p className="city-admin-data-note">Reviewed {new Date(application.reviewedAt).toLocaleString('en-IN')}</p>}
            </div>
          </article>)}
        </div> : <div className="city-admin-empty">No seller applications in this queue.</div>}
      </section>
      </>}
    </div>
  );
}

function CityAdminSellerDirectory(): ReactNode {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (search.trim()) query.set('q', search.trim());
  const result = useLoad(() => api.cityAdminSellers(query), [page, search]);
  useRefreshOnFocus(result.reload);

  return <section className="city-admin-panel city-admin-order-directory">
    <div className="city-admin-order-tools">
      <label className="city-admin-search-field"><span aria-hidden="true">⌕</span><input aria-label="Search city sellers" placeholder="Search seller or phone" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} /></label>
    </div>
    {result.error && <div className="city-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
    {result.loading ? <Loading label="Loading city sellers…" /> : result.error ? null : result.data?.data.length ? <div className="city-admin-table-wrap"><table className="city-admin-table"><thead><tr><th>Seller / SHG</th><th>Contact</th><th>Categories</th><th>Products</th><th>Orders</th><th>Verification</th><th>Account</th></tr></thead><tbody>{result.data.data.map((seller) => <tr key={seller._id}>
      <td><strong>{seller.name || 'Seller'}</strong></td>
      <td><a href={`tel:${seller.phoneE164}`}>{seller.phoneE164}</a>{seller.email && <small>{seller.email}</small>}</td>
      <td>{seller.productCategories.join(', ') || 'No listed products'}</td>
      <td>{seller.productCount}</td>
      <td>{seller.orderCount}</td>
      <td>Not tracked</td>
      <td><StatusBadge value={seller.status} /></td>
    </tr>)}</tbody></table></div> : <div className="city-admin-empty">No approved sellers are assigned to {user?.assignedCity ?? 'this city'} yet.</div>}
    {result.data && result.data.pagination.totalPages > 1 && <Pagination page={page} pages={result.data.pagination.totalPages} onChange={setPage} />}
  </section>;
}

type SellerProductDraft = {
  categoryId: string;
  subcategoryId: string;
  productType: string;
  name: string;
  slug: string;
  slugEdited: boolean;
  description: string;
  price: string;
  stock: string;
  lowStockThreshold: string;
  imageUrl: string;
};

function readSellerProductDraft(key: string): SellerProductDraft | null {
  try {
    const saved = window.localStorage.getItem(key);
    if (!saved) return null;
    const parsed: unknown = JSON.parse(saved);
    if (!parsed || typeof parsed !== 'object') return null;
    const value = parsed as Partial<SellerProductDraft>;
    const fields: Array<keyof SellerProductDraft> = ['categoryId', 'subcategoryId', 'productType', 'name', 'slug', 'description', 'price', 'stock', 'lowStockThreshold', 'imageUrl'];
    if (!fields.every((field) => typeof value[field] === 'string')) return null;
    return { ...value, slugEdited: value.slugEdited === true } as SellerProductDraft;
  } catch (cause) {
    console.warn('Could not restore the saved seller product draft.', cause);
    return null;
  }
}

function SellerCatalogueListingPage({ onCancel, onSubmitted, onDraftSaved }: { onCancel: () => void; onSubmitted: () => void; onDraftSaved?: (draft: SellerProductDraft | null) => void }): ReactNode {
  const { user } = useAuth();
  const categories = useLoad(() => api.categories());
  const draftKey = `esakhi.seller.productDraft:${user?.id ?? 'seller'}`;
  const [draft] = useState(() => readSellerProductDraft(draftKey));
  const [categoryId, setCategoryId] = useState(draft?.categoryId ?? 'womens-apparel-accessories');
  const [subcategoryId, setSubcategoryId] = useState(draft?.subcategoryId ?? 'jewellery-accessories');
  const [productType, setProductType] = useState(draft?.productType ?? '');
  const [name, setName] = useState(draft?.name ?? '');
  const [slug, setSlug] = useState(draft?.slug ?? '');
  const [slugEdited, setSlugEdited] = useState(draft?.slugEdited ?? false);
  const [description, setDescription] = useState(draft?.description ?? '');
  const [price, setPrice] = useState(draft?.price ?? '');
  const [stock, setStock] = useState(draft?.stock ?? '');
  const [lowStockThreshold, setLowStockThreshold] = useState(draft?.lowStockThreshold ?? '5');
  const [imageUrl, setImageUrl] = useState(draft?.imageUrl ?? '');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const selectedCategory = categories.data?.find((category) => category.categoryId === categoryId);
  const selectedSubcategory = selectedCategory?.subcategories.find((subcategory) => subcategory.subcategoryId === subcategoryId);
  const slugFromName = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  useEffect(() => {
    if (!categories.data?.length) return;
    const validCategory = categories.data.find((category) => category.categoryId === categoryId) ?? categories.data[0];
    if (validCategory.categoryId !== categoryId) setCategoryId(validCategory.categoryId);
    if (!validCategory.subcategories.some((subcategory) => subcategory.subcategoryId === subcategoryId)) {
      setSubcategoryId(validCategory.subcategories[0]?.subcategoryId ?? '');
    }
  }, [categories.data, categoryId, subcategoryId]);

  const currentDraft: SellerProductDraft = {
    categoryId, subcategoryId, productType, name, slug, slugEdited,
    description, price, stock, lowStockThreshold, imageUrl,
  };

  function saveDraft(): void {
    setError('');
    try {
      window.localStorage.setItem(draftKey, JSON.stringify(currentDraft));
      onDraftSaved?.(currentDraft);
      setSaved('Draft saved on this device. It will be available when you return on this browser.');
    } catch (cause) {
      setError(displayError(cause));
    }
  }

  async function uploadImage(file: File): Promise<void> {
    setUploadingImage(true);
    setError('');
    setSaved('');
    try {
      const uploaded = await api.uploadSellerProductImage(file);
      setImageUrl(uploaded.imageUrl);
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setUploadingImage(false);
    }
  }

  async function submitProduct(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSaved('');
    try {
      await api.createSellerProduct({
        name: name.trim(),
        slug: slug.trim() || slugFromName(name),
        description: description.trim(),
        categoryId,
        subcategoryId,
        productType: productType.trim(),
        pricePaise: Math.round(Number(price) * 100),
        stock: Number(stock),
        lowStockThreshold: Number(lowStockThreshold),
        ...(imageUrl.trim() ? { imageUrls: [imageUrl.trim()] } : {}),
      });
      setSaved('Your product was submitted for City Admin review and is not yet published.');
      try {
        window.localStorage.removeItem(draftKey);
        onDraftSaved?.(null);
      } catch (cause) {
        console.warn('Could not remove the submitted seller product draft.', cause);
      }
      onSubmitted();
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="seller-panel seller-product-editor">
      <div className="seller-panel-heading"><div><h2>Product details</h2><p>Products are published after City Admin review.</p></div><button className="seller-secondary-action" type="button" onClick={onCancel}>Cancel</button></div>
      <div className="seller-product-editor-body">
          {saved && <Notice tone="success">{saved}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          {categories.error && <div className="seller-panel-state"><Notice tone="error">{categories.error}</Notice><button type="button" className="seller-secondary-action" onClick={() => void categories.reload()}>Retry categories</button></div>}
          <form className="seller-product-form" onSubmit={(event) => void submitProduct(event)}>
            <div className="form-grid two-up">
              <label className="field"><span>Main category</span><select required disabled={categories.loading || !categories.data?.length} value={categoryId} onChange={(event) => {
                const nextCategory = categories.data?.find((category) => category.categoryId === event.target.value);
                setCategoryId(event.target.value);
                setSubcategoryId(nextCategory?.subcategories[0]?.subcategoryId ?? '');
                setProductType('');
              }}>{(categories.data ?? []).map((category) => <option key={category.categoryId} value={category.categoryId}>{category.categoryName}</option>)}</select></label>
              <label className="field"><span>Subcategory</span><select required disabled={!selectedCategory} value={subcategoryId} onChange={(event) => { setSubcategoryId(event.target.value); setProductType(''); }}>{(selectedCategory?.subcategories ?? []).map((subcategory) => <option key={subcategory.subcategoryId} value={subcategory.subcategoryId}>{subcategory.subcategoryName}</option>)}</select></label>
            </div>
            <label className="field"><span>Product type</span><input required list="seller-product-types" value={productType} onChange={(event) => setProductType(event.target.value)} placeholder="Describe the product type" /><datalist id="seller-product-types">{(selectedSubcategory?.productTypes ?? []).map((type) => <option key={type.productTypeId} value={type.productType} />)}</datalist></label>
            <label className="field"><span>Product name</span><input required maxLength={160} value={name} onChange={(event) => { setName(event.target.value); if (!slugEdited) setSlug(slugFromName(event.target.value)); }} /></label>
            <label className="field"><span>Product page address</span><input required maxLength={180} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={slug} onChange={(event) => { setSlugEdited(true); setSlug(event.target.value); }} /><small>Use lowercase letters, numbers, and hyphens.</small></label>
            <label className="field"><span>Description</span><textarea required minLength={1} maxLength={5000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <div className="seller-image-upload">
              <label className="field"><span>Product image</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploadingImage} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(file); event.currentTarget.value = ''; }} /><small>JPEG, PNG, or WebP. Maximum file size: 5 MB.</small></label>
              {imageUrl && <div className="seller-image-preview"><img src={resolveProductImageUrl(imageUrl)} alt="Product preview" /><div><strong>Image ready</strong><button type="button" className="seller-secondary-action" onClick={() => setImageUrl('')}>Remove image</button></div></div>}
              {uploadingImage && <Loading label="Uploading product image…" />}
            </div>
            <div className="form-grid two-up">
              <label className="field"><span>Price (₹)</span><input required type="number" min="0.01" max="1000000" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
              <label className="field"><span>Available stock</span><input required type="number" min="0" max="100000" step="1" value={stock} onChange={(event) => setStock(event.target.value)} /></label>
              <label className="field"><span>Low-stock alert at</span><input required type="number" min="0" max="100000" step="1" value={lowStockThreshold} onChange={(event) => setLowStockThreshold(event.target.value)} /><small>We’ll flag stock at or below this number.</small></label>
            </div>
            {categoryId === 'food-items' && <Notice>Food listings require an approved seller account with verified FSSAI details. Listings remain unpublished until City Admin approval.</Notice>}
            {saved && <Notice tone="success">{saved}</Notice>}
            {error && <Notice tone="error">{error}</Notice>}
            <div className="seller-product-form-actions"><button type="button" className="seller-secondary-action" onClick={saveDraft} disabled={saving || uploadingImage}>Save draft on this device</button><button type="submit" className="seller-primary-action" disabled={saving || uploadingImage || categories.loading || !categories.data?.length}>{saving ? 'Submitting…' : 'Submit for approval'}</button></div>
          </form>
      </div>
    </section>
  );
}

function CityAdminProductReviewPage(): ReactNode {
  const categories = useLoad(() => api.categories());
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [approvalStatus, setApprovalStatus] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [stockStatus, setStockStatus] = useState('all');
  const [listingStatus, setListingStatus] = useState('all');
  const [flaggingProductId, setFlaggingProductId] = useState('');
  const [flagReason, setFlagReason] = useState('');
  const [reviewingProductId, setReviewingProductId] = useState('');
  const [reviewCategoryId, setReviewCategoryId] = useState('');
  const [reviewSubcategoryId, setReviewSubcategoryId] = useState('');
  const [reviewProductType, setReviewProductType] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [savingFlag, setSavingFlag] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const query = new URLSearchParams({ page: String(page), limit: '20', stockStatus, listingStatus });
  if (search.trim()) query.set('q', search.trim());
  if (categoryId) query.set('categoryId', categoryId);
  if (subcategoryId) query.set('subcategoryId', subcategoryId);
  if (approvalStatus) query.set('approvalStatus', approvalStatus);
  if (sellerId) query.set('sellerId', sellerId);
  const result = useLoad(() => api.cityAdminProducts(query), [page, search, categoryId, subcategoryId, approvalStatus, sellerId, stockStatus, listingStatus]);
  const sellersResult = useLoad(() => api.cityAdminSellers(new URLSearchParams({ page: '1', limit: '100' })), []);
  const selectedCategory = categories.data?.find((category) => category.categoryId === reviewCategoryId);
  const selectedSubcategory = selectedCategory?.subcategories.find((subcategory) => subcategory.subcategoryId === reviewSubcategoryId);
  useRefreshOnFocus(result.reload);

  async function submitFlag(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!flaggingProductId) return;
    setSavingFlag(true);
    setError('');
    setMessage('');
    try {
      await api.flagCityAdminProduct(flaggingProductId, flagReason.trim());
      setMessage('Listing concern recorded and sent for review. Price, stock, and listing status were not changed.');
      setFlaggingProductId('');
      setFlagReason('');
      await result.reload();
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setSavingFlag(false);
    }
  }

  function beginProductReview(product: CityAdminProduct): void {
    if (reviewingProductId === product._id) {
      setReviewingProductId('');
      return;
    }
    const category = categories.data?.find((item) => item.categoryId === product.categoryId) ?? categories.data?.[0];
    const subcategory = category?.subcategories.find((item) => item.subcategoryId === product.subcategoryId) ?? category?.subcategories[0];
    setError('');
    setMessage('');
    setFlaggingProductId('');
    setReviewingProductId(product._id);
    setReviewCategoryId(category?.categoryId ?? '');
    setReviewSubcategoryId(subcategory?.subcategoryId ?? '');
    setReviewProductType(product.productType || product.name);
    setReviewNote('');
  }

  async function quickApproveProduct(product: CityAdminProduct): Promise<void> {
    setSavingReview(true);
    setError('');
    setMessage('');
    try {
      await api.reviewCityAdminProduct(product._id, {
        decision: 'approved',
        ...(product.categoryId && product.subcategoryId && product.productType ? {
          categoryId: product.categoryId,
          subcategoryId: product.subcategoryId,
          productType: product.productType,
        } : {}),
      });
      setMessage(`"${product.name}" has been approved and published.`);
      if (reviewingProductId === product._id) setReviewingProductId('');
      await result.reload(false);
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setSavingReview(false);
    }
  }

  async function reviewProduct(decision: 'approved' | 'rejected'): Promise<void> {
    if (!reviewingProductId) return;
    setSavingReview(true);
    setError('');
    setMessage('');
    try {
      await api.reviewCityAdminProduct(reviewingProductId, {
        decision,
        ...(reviewNote.trim() ? { note: reviewNote.trim() } : {}),
        categoryId: reviewCategoryId,
        subcategoryId: reviewSubcategoryId,
        productType: reviewProductType.trim(),
      });
      setMessage(decision === 'approved' ? 'Product classification saved and listing approved.' : 'Product classification saved and listing rejected.');
      setReviewingProductId('');
      await result.reload(false);
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setSavingReview(false);
    }
  }

  return (
    <div className="city-admin-page">
      <div className="city-admin-page-heading"><div><p className="city-admin-eyebrow">Local operations</p><h1>Products & Inventory</h1><p>Review listings from sellers assigned to your city. Price and inventory remain seller-owned.</p></div></div>
      {error && <div className="city-admin-error" role="alert">{error}</div>}
      {message && <Notice tone="success">{message}</Notice>}
      {categories.error && <div className="city-admin-error" role="alert">Category master unavailable: {categories.error}<button onClick={() => void categories.reload()}>Retry</button></div>}
      <section className="city-admin-panel city-admin-order-directory">
        <div className="city-admin-order-tools city-admin-product-tools">
          <label className="city-admin-search-field"><span aria-hidden="true">⌕</span><input aria-label="Search products" placeholder="Search product name" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} /></label>
          <select aria-label="Filter by main category" value={categoryId} onChange={(event) => { setPage(1); setCategoryId(event.target.value); setSubcategoryId(''); }}><option value="">All categories</option>{(categories.data ?? []).map((category) => <option key={category.categoryId} value={category.categoryId}>{category.categoryName}</option>)}</select>
          <select aria-label="Filter by subcategory" value={subcategoryId} disabled={!categoryId} onChange={(event) => { setPage(1); setSubcategoryId(event.target.value); }}><option value="">All subcategories</option>{(categories.data?.find((category) => category.categoryId === categoryId)?.subcategories ?? []).map((subcategory) => <option key={subcategory.subcategoryId} value={subcategory.subcategoryId}>{subcategory.subcategoryName}</option>)}</select>
          <select aria-label="Filter by approval status" value={approvalStatus} onChange={(event) => { setPage(1); setApprovalStatus(event.target.value); }}><option value="">All approval states</option><option value="pending">Awaiting review</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>
          <select aria-label="Filter by seller" value={sellerId} onChange={(event) => { setPage(1); setSellerId(event.target.value); }}><option value="">All city sellers</option>{(sellersResult.data?.data ?? []).map((seller) => <option key={seller._id} value={seller._id}>{seller.name || seller.phoneE164}</option>)}</select>
          <select aria-label="Filter by stock" value={stockStatus} onChange={(event) => { setPage(1); setStockStatus(event.target.value); }}><option value="all">All stock</option><option value="low_stock">Low stock</option><option value="out_of_stock">Out of stock</option></select>
          <select aria-label="Filter by listing status" value={listingStatus} onChange={(event) => { setPage(1); setListingStatus(event.target.value); }}><option value="all">All listing states</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select>
        </div>
        {sellersResult.error && <div className="city-admin-error" role="alert">Seller filter unavailable: {sellersResult.error}<button onClick={() => void sellersResult.reload()}>Retry</button></div>}
        {result.error && <div className="city-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
        {result.loading ? <Loading label="Loading city products…" /> : result.error ? null : result.data?.data.length ? <div className="city-admin-table-wrap"><table className="city-admin-table"><thead><tr><th>Product</th><th>Seller</th><th>Category</th><th>Price</th><th>Available</th><th>Reserved</th><th>Classification / compliance</th><th>Approval</th><th>Listing</th><th>Flags</th><th>Action</th></tr></thead><tbody>{result.data.data.map((product) => <Fragment key={product._id}>
          <tr>
            <td><strong>{product.name}</strong></td><td>{product.sellerName}</td><td>{product.categoryName || product.category || 'Uncategorized'}<small>{product.subcategoryName || 'Needs classification'}</small></td><td>{formatMoney(product.pricePaise)}</td><td>{product.availableStock}</td><td>{product.reservedStock}</td><td>{product.classificationStatus.replaceAll('_', ' ')}<small>{product.isFoodProduct ? `Food · FSSAI ${product.foodComplianceStatus.replaceAll('_', ' ')}` : product.productType}</small></td><td><StatusBadge value={product.approvalStatus} /></td><td><StatusBadge value={product.isArchived ? 'archived' : product.isActive ? 'active' : 'inactive'} /></td><td>{product.openFlagCount ?? 0}</td>
            <td>
              <div className="seller-table-actions">
                {product.approvalStatus !== 'approved' && product.classificationStatus === 'classified' && (!product.isFoodProduct || product.foodComplianceStatus === 'verified') && (
                  <button type="button" className="text-button" disabled={savingReview} onClick={() => void quickApproveProduct(product)}>Approve</button>
                )}
                <button type="button" className="text-button" disabled={!categories.data?.length} onClick={() => beginProductReview(product)}>{reviewingProductId === product._id ? 'Close review' : 'Review'}</button>
                <button type="button" className="text-button" onClick={() => { setError(''); setMessage(''); setReviewingProductId(''); setFlaggingProductId(flaggingProductId === product._id ? '' : product._id); setFlagReason(''); }}>{flaggingProductId === product._id ? 'Close flag' : product.openFlagCount ? 'Add flag' : 'Flag listing'}</button>
              </div>
            </td>
          </tr>
          {flaggingProductId === product._id && <tr><td colSpan={11}><form className="city-admin-panel city-admin-zone-request" onSubmit={(event) => void submitFlag(event)}>
            <div className="city-admin-panel-heading"><div><h2>Flag listing: {product.name}</h2><p>Report a concern for review. This does not change the seller’s listing or inventory.</p></div></div>
            <label className="field"><span>Reason</span><textarea required minLength={10} maxLength={1000} rows={3} value={flagReason} onChange={(event) => setFlagReason(event.target.value)} placeholder="Describe the listing concern (at least 10 characters)" /></label>
            <div className="city-admin-zone-request-actions"><button className="city-admin-secondary-button" type="button" disabled={savingFlag} onClick={() => setFlaggingProductId('')}>Cancel</button><button className="city-admin-primary-button" type="submit" disabled={savingFlag || flagReason.trim().length < 10}>{savingFlag ? 'Submitting…' : 'Submit flag'}</button></div>
          </form></td></tr>}
          {reviewingProductId === product._id && <tr><td colSpan={11}><section className="city-admin-panel city-admin-zone-request">
            <div className="city-admin-panel-heading"><div><h2>Classify and review: {product.name}</h2><p>Confirm the category and product type before approving a listing. Food listings require a verified FSSAI seller application.</p></div></div>
            <div className="form-grid two-up">
              <label className="field"><span>Main category</span><select required value={reviewCategoryId} onChange={(event) => {
                const nextCategory = categories.data?.find((category) => category.categoryId === event.target.value);
                setReviewCategoryId(event.target.value);
                setReviewSubcategoryId(nextCategory?.subcategories[0]?.subcategoryId ?? '');
              }}>{(categories.data ?? []).map((category) => <option key={category.categoryId} value={category.categoryId}>{category.categoryName}</option>)}</select></label>
              <label className="field"><span>Subcategory</span><select required value={reviewSubcategoryId} onChange={(event) => setReviewSubcategoryId(event.target.value)}>{(selectedCategory?.subcategories ?? []).map((subcategory) => <option key={subcategory.subcategoryId} value={subcategory.subcategoryId}>{subcategory.subcategoryName}</option>)}</select></label>
            </div>
            <label className="field"><span>Product type / classification</span><input required list="city-admin-product-types" value={reviewProductType} onChange={(event) => setReviewProductType(event.target.value)} /><datalist id="city-admin-product-types">{(selectedSubcategory?.productTypes ?? []).map((type) => <option key={type.productTypeId} value={type.productType} />)}</datalist></label>
            <label className="field"><span>Review note (required to reject)</span><textarea rows={2} maxLength={1000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Add an optional approval note or required rejection reason" /></label>
            <div className="city-admin-zone-request-actions"><button className="city-admin-secondary-button" type="button" disabled={savingReview} onClick={() => setReviewingProductId('')}>Cancel</button><button className="city-admin-secondary-button" type="button" disabled={savingReview || !reviewNote.trim()} onClick={() => void reviewProduct('rejected')}>{savingReview ? 'Saving…' : 'Reject listing'}</button><button className="city-admin-primary-button" type="button" disabled={savingReview || !reviewCategoryId || !reviewSubcategoryId || !reviewProductType.trim()} onClick={() => void reviewProduct('approved')}>{savingReview ? 'Saving…' : 'Approve & publish'}</button></div>
          </section></td></tr>}
        </Fragment>)}</tbody></table></div> : <div className="city-admin-empty">No products from sellers assigned to this city match these filters.</div>}
        {result.data && result.data.pagination.totalPages > 1 && <Pagination page={page} pages={result.data.pagination.totalPages} onChange={setPage} />}
      </section>
      <p className="city-admin-data-note">Reserved stock is calculated from active, unexpired unconfirmed order reservations. Food products cannot be published without verified FSSAI seller details.</p>
    </div>
  );
}

function SellerGate({ children }: { children: ReactNode }): ReactNode {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="page-container"><Loading label="Checking your session…" /></div>;
  if (!user) return <div className="page-container narrow"><PageIntro eyebrow="Seller workspace" title="Please sign in" description="Sign in with an approved seller account to view your store." /><Link to="/sign-in" state={{ from: location.pathname }} className="button">Sign in</Link></div>;
  if (user.role !== 'seller') return <div className="page-container narrow"><Notice tone="error">This workspace is available only to approved seller accounts.</Notice></div>;
  return children;
}

function SellerSalesTrendChart({ rows }: { rows: SellerDashboard['salesTrend'] }): ReactNode {
  const maxSales = Math.max(...rows.map((row) => row.totalPaise), 1);
  return <div className="seller-chart-wrap">
    <svg className="seller-sales-chart" viewBox="0 0 600 190" role="img" aria-label="Confirmed paid product sales over the last six months">
      {[0, 1, 2].map((line) => <line key={line} x1="30" x2="590" y1={25 + line * 48} y2={25 + line * 48} className="seller-chart-gridline" />)}
      {rows.map((row, index) => {
        const height = row.totalPaise === 0 ? 3 : Math.max(6, (row.totalPaise / maxSales) * 112);
        const x = 54 + index * 91;
        const y = 166 - height;
        return <g key={`${row.month}-${index}`}>
          <title>{row.month}: {formatMoney(row.totalPaise)}</title>
          <rect x={x} y={y} width="42" height={height} rx="7" className="seller-chart-bar" />
          <text x={x + 21} y="183" textAnchor="middle" className="seller-chart-label">{row.month}</text>
        </g>;
      })}
    </svg>
    {!rows.some((row) => row.totalPaise > 0) && <p className="seller-chart-empty">Confirmed paid sales will appear here when you receive your first order.</p>}
  </div>;
}

function SellerProfileView({ profile, onSaved }: { profile: NonNullable<SellerDashboard['storeProfile']> | null; onSaved: () => Promise<void> }): ReactNode {
  const [shgName, setShgName] = useState(profile?.shgName ?? '');
  const [representative, setRepresentative] = useState(profile?.representative ?? '');
  const [registeredAddress, setRegisteredAddress] = useState(profile?.registeredAddress ?? '');
  const [storeDescription, setStoreDescription] = useState(profile?.storeDescription ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  if (!profile) return <section className="seller-panel"><Notice tone="error">We couldn’t find an approved store profile. Contact eSakhi support to resolve your seller account.</Notice></section>;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api.updateSellerProfile({ shgName: shgName.trim(), representative: representative.trim(), registeredAddress: registeredAddress.trim(), storeDescription: storeDescription.trim() });
      setMessage('Your store profile has been saved.');
      await onSaved();
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setSaving(false);
    }
  };

  return <section className="seller-panel seller-store-profile">
    <div className="seller-panel-heading"><div><h2>My Store Profile</h2><p>Keep your shop information up to date for customers and the eSakhi team.</p></div><span className="seller-verified-pill">✓ Seller approved</span></div>
    <form className="seller-profile-form" onSubmit={(event) => void save(event)}>
      {message && <Notice tone="success">{message}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <label><span>Store or SHG name</span><input required minLength={2} maxLength={160} value={shgName} onChange={(event) => setShgName(event.target.value)} /></label>
      <label><span>Contact person</span><input required minLength={2} maxLength={120} value={representative} onChange={(event) => setRepresentative(event.target.value)} /></label>
      <label className="seller-profile-wide"><span>About your store</span><textarea rows={4} maxLength={1000} value={storeDescription} onChange={(event) => setStoreDescription(event.target.value)} placeholder="Tell customers about your work and the people behind it." /></label>
      <label className="seller-profile-wide"><span>Pickup / registered address</span><textarea required minLength={5} maxLength={500} rows={2} value={registeredAddress} onChange={(event) => setRegisteredAddress(event.target.value)} /></label>
      <div className="seller-profile-readonly"><span><small>Phone</small><strong>{profile.phoneE164}</strong></span><span><small>Email</small><strong>{profile.email || 'Not added to your account'}</strong></span><span><small>Assigned city</small><strong>{profile.assignedCity || profile.city}</strong></span><span><small>Service zones</small><strong>{profile.serviceableLocalities.length ? profile.serviceableLocalities.join(', ') : 'Not assigned'}</strong></span><span><small>Main category</small><strong>{profile.primaryCategoryName ?? 'Under review'}</strong></span><span><small>FSSAI status</small><strong>{profile.fssaiStatus.replaceAll('_', ' ')}</strong></span></div>
      <Notice>Phone, email, city, service zones, category, and verification are managed by eSakhi. Contact support to request changes to these details.</Notice>
      <div className="seller-profile-actions"><button className="seller-primary-action" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save store profile'}</button><Link className="seller-secondary-action" to="/help">Get help</Link></div>
    </form>
  </section>;
}

function SellerInventoryHistoryPanel({ productId }: { productId: string }): ReactNode {
  const history = useLoad(() => api.sellerInventoryHistory(productId), [productId]);
  return <div className="seller-history-panel">
    <strong>Stock update history</strong>
    {history.loading ? <Loading label="Loading stock history…" /> : history.error ? <Notice tone="error">{history.error}</Notice> : history.data?.data.length ? history.data.data.map((entry: SellerInventoryAdjustment) => <div key={entry._id}><span className={entry.quantityChange > 0 ? 'is-increase' : 'is-decrease'}>{entry.quantityChange > 0 ? '+' : ''}{entry.quantityChange} units</span><span>{entry.reason}</span><small>{new Date(entry.createdAt).toLocaleString('en-IN')}</small></div>) : <small>No stock adjustments have been recorded for this product.</small>}
  </div>;
}

function SellerUnavailablePanel({ title, description }: { title: string; description: string }): ReactNode {
  return <section className="seller-panel seller-unavailable-panel">
    <div className="seller-unavailable-icon" aria-hidden="true">✦</div>
    <h2>{title}</h2><p>{description}</p>
    <p className="seller-unavailable-note">This information is not tracked by the current seller system. No estimates or amounts are shown here.</p>
    <Link className="seller-secondary-action" to="/help">Contact eSakhi support</Link>
  </section>;
}

function SellerPortalPage({ initialView = 'overview' }: { initialView?: 'overview' | 'products' | 'inventory' | 'orders' | 'profile' | 'new_product' }): ReactNode {
  const { user, signOut } = useAuth();
  const [view, setView] = useState<'overview' | 'products' | 'inventory' | 'orders' | 'profile' | 'new_product' | 'finance' | 'payments' | 'reviews' | 'support' | 'notifications' | 'settings' | 'help'>(initialView);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const draftKey = `esakhi.seller.productDraft:${user?.id ?? 'seller'}`;
  const [savedDraft, setSavedDraft] = useState<SellerProductDraft | null>(() => readSellerProductDraft(draftKey));
  useEffect(() => {
    setSavedDraft(readSellerProductDraft(draftKey));
  }, [draftKey]);
  const discardDraft = () => {
    try { window.localStorage.removeItem(draftKey); } catch { /* ignore */ }
    setSavedDraft(null);
  };
  const dashboard = useLoad(() => api.sellerDashboard(), [user?.id]);
  const [productPage, setProductPage] = useState(1);
  const [productSearch, setProductSearch] = useState('');
  const [productApprovalStatus, setProductApprovalStatus] = useState('');
  const [productStockStatus, setProductStockStatus] = useState(initialView === 'inventory' ? 'low_stock' : 'all');
  const products = useLoad(() => {
    const query = new URLSearchParams({ page: String(productPage), limit: '20' });
    if (productSearch.trim()) query.set('q', productSearch.trim());
    if (productApprovalStatus) query.set('approvalStatus', productApprovalStatus);
    if (productStockStatus !== 'all') query.set('stockStatus', productStockStatus);
    return api.sellerProducts(query);
  }, [user?.id, productPage, productSearch, productApprovalStatus, productStockStatus]);
  const [orderPage, setOrderPage] = useState(1);
  const [inventoryProductId, setInventoryProductId] = useState('');
  const [inventoryVariantId, setInventoryVariantId] = useState('');
  const [inventoryQuantityChange, setInventoryQuantityChange] = useState('');
  const [inventoryReason, setInventoryReason] = useState('');
  const [savingInventory, setSavingInventory] = useState(false);
  const [inventoryError, setInventoryError] = useState('');
  const [inventoryMessage, setInventoryMessage] = useState('');
  const [historyProductId, setHistoryProductId] = useState('');
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

  const updateSellerOrderStatus = async (order: SellerOrder, nextStatus: 'accepted' | 'preparing' | 'ready_for_pickup' | 'completed') => {
    setUpdatingOrderId(order._id);
    setOrderActionError('');
    setOrderActionMessage('');
    try {
      await api.updateSellerOrderStatus(order._id, nextStatus);
      const confirmation = nextStatus === 'ready_for_pickup'
        ? (order.fulfilmentMethod === 'delivery'
          ? `Order #${order.orderReference} is now Ready for Pickup! A popup notification has been sent to the City Admin portal to assign a suitable delivery partner.`
          : `Order #${order.orderReference} is now Ready for Pickup! The customer has been notified.`)
        : nextStatus === 'accepted'
          ? `Order #${order.orderReference} accepted. You can now start preparing the items or mark it Ready for Pickup.`
          : nextStatus === 'preparing'
            ? `Order #${order.orderReference} marked as Preparing.`
            : `Order #${order.orderReference} marked as Completed.`;
      setOrderActionMessage(confirmation);
      await Promise.all([orders.reload(false), dashboard.reload(false)]);
    } catch (cause) {
      setOrderActionError(displayError(cause));
    } finally {
      setUpdatingOrderId('');
    }
  };

  const submitInventoryAdjustment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const quantityChange = Number(inventoryQuantityChange);
    if (!inventoryProductId || !Number.isInteger(quantityChange) || quantityChange === 0) {
      setInventoryError('Enter a non-zero whole number of units to add or remove.');
      return;
    }
    setSavingInventory(true);
    setInventoryError('');
    setInventoryMessage('');
    try {
      await api.adjustSellerInventory(inventoryProductId, {
        quantityChange,
        reason: inventoryReason.trim(),
        ...(inventoryVariantId ? { variantId: inventoryVariantId } : {}),
      });
      setInventoryProductId('');
      setInventoryVariantId('');
      setInventoryQuantityChange('');
      setInventoryReason('');
      setInventoryMessage('Inventory updated and recorded.');
      await Promise.all([products.reload(false), dashboard.reload(false)]);
    } catch (cause) {
      setInventoryError(displayError(cause));
    } finally {
      setSavingInventory(false);
    }
  };

  const navItem = (key: typeof view, label: string, icon: string, badge?: number, selected = view === key, onSelect: () => void = () => setView(key)) => <button className={selected ? 'active' : ''} onClick={onSelect} key={`${key}-${label}`}><span aria-hidden="true">{icon}</span>{label}{badge ? <small>{badge}</small> : null}</button>;
  const title: Record<typeof view, string> = {
    overview: 'Overview', profile: 'My Store Profile', products: 'Products', inventory: 'Inventory',
    orders: 'Orders', new_product: 'Add a product', finance: 'Earnings & Settlements',
    payments: 'Payment History', reviews: 'Reviews & Feedback', support: 'Support Requests',
    notifications: 'Notifications', settings: 'Settings', help: 'Help & Support',
  };
  const orderRows = (rows: SellerOrder[]) => rows.length ? (
    <div className="seller-order-list" style={{ display: 'grid', gap: '1rem' }}>
      {rows.map((order) => (
        <SellerOrderCard
          key={order._id}
          order={order}
          isUpdating={updatingOrderId === order._id}
          onTransitionStatus={updateSellerOrderStatus}
        />
      ))}
    </div>
  ) : <div className="seller-empty"><span aria-hidden="true">✿</span><strong>No orders to show</strong><small>Orders containing your products will appear here.</small></div>;

  const allOrders = orders.data?.data ?? [];
  const visibleOrders = orderStatus === 'all'
    ? allOrders
    : allOrders.filter((order) => orderViewStatus[orderStatus]?.includes(order.fulfilmentStatus));
  const setOrderView = (status: typeof orderStatus) => {
    setView('orders');
    setOrderStatus(status);
    setOrderPage(1);
  };
  const viewInventory = (stockStatus = 'all') => {
    setProductStockStatus(stockStatus);
    setProductPage(1);
    setView('inventory');
  };
  const currentStore = data?.storeProfile?.shgName || user?.name || 'Your store';
  const productRows = (isInventory: boolean) => (
    <section className="seller-panel seller-products-panel">
      <div className="seller-panel-heading"><div><h2>{isInventory ? 'Inventory at a glance' : 'Your products'}</h2><p>{isInventory ? 'Available stock for your listings. Reserved quantities stay controlled by eSakhi orders.' : 'Find a listing, check its review status, and keep product availability up to date.'}</p></div></div>
      {inventoryMessage && <Notice tone="success">{inventoryMessage}</Notice>}
      {inventoryError && <Notice tone="error">{inventoryError}</Notice>}
      {!isInventory && savedDraft && (savedDraft.name || savedDraft.description || savedDraft.price || savedDraft.imageUrl) && (
        <div className="seller-draft-banner Notice">
          <div>
            <strong>Saved draft on this device: {savedDraft.name || 'Untitled product'}</strong>
            <p>{savedDraft.productType ? `${savedDraft.productType} · ` : ''}{savedDraft.price ? `₹${savedDraft.price}` : 'Price not set'}{savedDraft.stock ? ` · ${savedDraft.stock} units` : ''}</p>
          </div>
          <div className="seller-table-actions">
            <button type="button" className="seller-primary-action" onClick={() => setView('new_product')}>Continue editing draft</button>
            <button type="button" className="seller-secondary-action" onClick={discardDraft}>Discard draft</button>
          </div>
        </div>
      )}
      {products.error && <div className="seller-panel-state"><Notice tone="error">{products.error}</Notice><button className="seller-secondary-action" onClick={() => void products.reload()}>Try again</button></div>}
      <div className="seller-product-tools">
        <label><span>Search products</span><input type="search" value={productSearch} onChange={(event) => { setProductPage(1); setProductSearch(event.target.value); }} placeholder="Search by product name" /></label>
        <label><span>Review status</span><select value={productApprovalStatus} onChange={(event) => { setProductPage(1); setProductApprovalStatus(event.target.value); }}><option value="">All statuses</option><option value="pending">Awaiting review</option><option value="approved">Approved</option><option value="rejected">Changes requested</option></select></label>
        <label><span>Stock status</span><select value={productStockStatus} onChange={(event) => { setProductPage(1); setProductStockStatus(event.target.value); }}><option value="all">All stock</option><option value="low_stock">Low stock</option><option value="out_of_stock">Out of stock</option><option value="in_stock">In stock</option></select></label>
      </div>
      {products.loading ? <Loading label="Loading your products…" /> : products.error ? null : products.data?.data.length ? <>
        <div className="seller-products-table-wrap"><table className="seller-products-table"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Available stock</th><th>Listing / review</th><th>Updated</th><th>Actions</th></tr></thead><tbody>
          {products.data.data.map((product) => {
            const stock = product.variants.length ? product.variants.reduce((sum, variant) => sum + variant.stock, 0) : product.stock;
            const stockLabel = stock === 0 ? 'Out of stock' : stock <= product.lowStockThreshold ? 'Low stock' : 'In stock';
            const isAdjusting = inventoryProductId === product._id;
            return <Fragment key={product._id}>
              <tr>
                <td><span className="seller-table-product"><span className="seller-product-image">{product.imageUrls[0] ? <img src={resolveProductImageUrl(product.imageUrls[0])} alt="" /> : '✿'}</span><span><strong>{product.name}</strong><small>{product.productType}</small></span></span></td>
                <td>{product.categoryName}<small>{product.subcategoryName}</small></td>
                <td>{formatMoney(product.pricePaise)}</td>
                <td><span className={`seller-stock-label${stock === 0 ? ' is-empty' : stock <= product.lowStockThreshold ? ' is-low' : ''}`}>{stockLabel}</span><small>{stock} units</small></td>
                <td><span className={`seller-approval-status status-${product.approvalStatus}`}>{product.approvalStatus === 'pending' ? 'Awaiting review' : product.approvalStatus === 'approved' ? 'Approved' : 'Changes requested'}</span><small>{product.isActive ? 'Published' : 'Not published'}{product.isFoodProduct ? ` · FSSAI ${product.foodComplianceStatus.replaceAll('_', ' ')}` : ''}</small>{product.classificationStatus === 'needs_review' && <small>Category review needed</small>}</td>
                <td>{product.updatedAt ? new Date(product.updatedAt).toLocaleDateString('en-IN') : '—'}</td>
                <td><div className="seller-table-actions"><button onClick={() => { setInventoryError(''); setInventoryProductId(isAdjusting ? '' : product._id); setInventoryVariantId(product.variants[0]?._id ?? ''); setInventoryQuantityChange(''); setInventoryReason(''); }}>{isAdjusting ? 'Close' : 'Update stock'}</button><button onClick={() => setHistoryProductId(historyProductId === product._id ? '' : product._id)}>{historyProductId === product._id ? 'Hide history' : 'History'}</button></div></td>
              </tr>
              {isAdjusting && <tr><td colSpan={7}><form className="seller-inventory-form" onSubmit={(event) => void submitInventoryAdjustment(event)}>
                {product.variants.length > 0 && <label><span>Variant</span><select required value={inventoryVariantId} onChange={(event) => setInventoryVariantId(event.target.value)}>{product.variants.map((variant) => <option key={variant._id} value={variant._id}>{Object.entries(variant.attributes).map(([key, value]) => `${key}: ${value}`).join(', ') || variant.sku || 'Variant'} · {variant.stock} available</option>)}</select></label>}
                <label><span>Units to add or remove</span><input required type="number" step="1" min="-100000" max="100000" value={inventoryQuantityChange} onChange={(event) => setInventoryQuantityChange(event.target.value)} placeholder="e.g. 10 or -2" /></label>
                <label><span>Reason for adjustment</span><input required minLength={3} maxLength={300} value={inventoryReason} onChange={(event) => setInventoryReason(event.target.value)} placeholder="e.g. New handmade stock received" /></label>
                <button className="seller-primary-action" type="submit" disabled={savingInventory}>{savingInventory ? 'Saving…' : 'Save stock update'}</button>
              </form></td></tr>}
              {historyProductId === product._id && <tr><td colSpan={7}><SellerInventoryHistoryPanel productId={product._id} /></td></tr>}
            </Fragment>;
          })}
        </tbody></table></div>
      </> : <div className="seller-empty"><span>◇</span><strong>{productSearch || productApprovalStatus || productStockStatus !== 'all' ? 'No products match these filters' : 'No products yet'}</strong><small>{productSearch || productApprovalStatus || productStockStatus !== 'all' ? 'Try a different search or status.' : 'Add your first product to start building your shop.'}</small>{!productSearch && !productApprovalStatus && productStockStatus === 'all' && <button className="seller-primary-action" onClick={() => setView('new_product')}>＋ Add your first product</button>}</div>}
      {products.data && products.data.pagination.totalPages > 1 && <div className="seller-pagination"><button className="seller-secondary-action" disabled={productPage <= 1} onClick={() => setProductPage((page) => page - 1)}>Previous</button><span>Page {productPage} of {products.data.pagination.totalPages}</span><button className="seller-secondary-action" disabled={productPage >= products.data.pagination.totalPages} onClick={() => setProductPage((page) => page + 1)}>Next</button></div>}
    </section>
  );
  const orderTabs: Array<{ key: typeof orderStatus; label: string }> = [
    { key: 'all', label: 'All orders' }, { key: 'new', label: 'New' }, { key: 'processing', label: 'Preparing' },
    { key: 'ready', label: 'Ready for pickup' }, { key: 'completed', label: 'Completed' }, { key: 'cancelled', label: 'Cancelled' },
  ];

  return <div className="seller-portal">
    <aside className="seller-sidebar">
      <Link to="/" className="seller-brand"><img src="/images/maitri-sisterhood-logo.png" alt="" /><span><strong>eSakhi</strong><small>SELLER WORKSPACE</small></span></Link>
      <div className="seller-account-summary"><span>{(currentStore.trim().charAt(0) || 'S').toLocaleUpperCase('en-IN')}</span><div><strong>{currentStore}</strong><small>{data?.storeProfile?.city || user?.assignedCity || 'Seller account'}</small></div></div>
      <nav className="seller-navigation" aria-label="Seller workspace">
        <span className="seller-nav-heading">MAIN</span>{navItem('overview', 'Overview', '⌂')}
        <span className="seller-nav-heading">MY BUSINESS</span>{navItem('profile', 'My Store Profile', '◯')}{navItem('products', 'Products', '◇', metrics?.totalProducts)}{navItem('inventory', 'Inventory', '▦', metrics?.lowStockProducts, view === 'inventory', () => viewInventory())}
        <span className="seller-nav-heading">ORDERS</span>{navItem('orders', 'New Orders', '＋', metrics?.newOrders, view === 'orders' && orderStatus === 'new', () => setOrderView('new'))}{navItem('orders', 'Processing', '◷', metrics?.ordersToPrepare, view === 'orders' && orderStatus === 'processing', () => setOrderView('processing'))}{navItem('orders', 'Ready for Pickup', '↗', metrics?.readyOrders, view === 'orders' && orderStatus === 'ready', () => setOrderView('ready'))}{navItem('orders', 'Completed Orders', '✓', metrics?.completedOrders, view === 'orders' && orderStatus === 'completed', () => setOrderView('completed'))}{navItem('orders', 'Cancelled Orders', '×', undefined, view === 'orders' && orderStatus === 'cancelled', () => setOrderView('cancelled'))}
        <span className="seller-nav-heading">FINANCE</span>{navItem('finance', 'Earnings & Settlements', '₹')}{navItem('payments', 'Payment History', '▤')}
        <span className="seller-nav-heading">CUSTOMER SERVICE</span>{navItem('reviews', 'Reviews & Feedback', '☆')}{navItem('support', 'Support Requests', '?')}
        <span className="seller-nav-heading">ACCOUNT</span>{navItem('notifications', 'Notifications', '♧')}{navItem('settings', 'Settings', '⚙')}{navItem('help', 'Help & Support', '♡')}
      </nav>
      <div className="seller-support-note"><strong>We’re here to help</strong><small>Need help with your store or an order?</small><Link to="/help">Visit Help & Support →</Link></div>
    </aside>
    <main className="seller-main">
      <header className="seller-topbar"><Link to="/" className="seller-topbar-brand">eSakhi <small>SELLER</small></Link><div><span>{currentStore}</span><button className="seller-topbar-profile" onClick={() => setView('profile')}>My store</button><button onClick={() => void signOut()}>Sign out</button></div></header>
      <div className="seller-page">
        <div className="seller-page-heading"><div><span className="seller-kicker">{data?.storeProfile?.verificationStatus === 'approved' ? '✓ VERIFIED SELLER' : 'SELLER WORKSPACE'}</span><h1>{view === 'overview' ? `Namaste, ${currentStore}` : title[view]}</h1><p>{view === 'overview' ? 'Here’s what’s happening with your shop today.' : view === 'orders' ? 'Check order status and the payment state for your items.' : 'Your seller workspace, built around your store.'}</p></div>
          {(view === 'products' || view === 'overview') && <button className="seller-primary-action" onClick={() => setView('new_product')}>＋ Add a product</button>}
        </div>
        {dashboard.error && <div className="seller-panel-state"><Notice tone="error">{dashboard.error}</Notice><button className="seller-secondary-action" onClick={() => void dashboard.reload()}>Retry dashboard</button></div>}
        {view === 'overview' && <>
          {dashboard.loading && !data ? <Loading label="Preparing your seller dashboard…" /> : <>
            {metrics?.pendingProducts ? <button className="seller-pending-banner" onClick={() => { setProductApprovalStatus('pending'); setView('products'); }}><span aria-hidden="true">◷</span><span><strong>{metrics.pendingProducts} product{metrics.pendingProducts === 1 ? '' : 's'} awaiting approval</strong><small>Your new listings will appear in the marketplace after City Admin review.</small></span><b>View products →</b></button> : null}
            <section className="seller-metrics">
              <button onClick={() => setOrderView('new')}><SellerMetric label="New orders" value={metrics?.newOrders} icon="＋" unavailable={!metrics} /></button>
              <button onClick={() => setOrderView('processing')}><SellerMetric label="Orders to prepare" value={metrics?.ordersToPrepare} icon="◷" unavailable={!metrics} /></button>
              <button onClick={() => setView('products')}><SellerMetric label="Active products" value={metrics?.activeProducts} icon="◇" unavailable={!metrics} /></button>
              <button onClick={() => viewInventory('low_stock')}><SellerMetric label="Low stock" value={metrics?.lowStockProducts} icon="!" alert={Boolean(metrics?.lowStockProducts)} unavailable={!metrics} /></button>
              <SellerMetric label="Sales this month" value={metrics ? formatMoney(metrics.grossPaidProductSalesThisMonthPaise) : undefined} icon="↗" unavailable={!metrics} />
              <button onClick={() => setView('finance')}><SellerMetric label="Settlement & Penalties" value="View Ledger →" icon="₹" /></button>
            </section>
            <SellerSettlementsLedgerPanel />
            <div className="seller-dashboard-grid">
              <section className="seller-panel seller-chart-panel"><div className="seller-panel-heading"><div><h2>Sales trend</h2><p>Confirmed paid product sales · last six months</p></div><span className="seller-trend-total">{metrics ? formatMoney(metrics.grossPaidProductSalesThisMonthPaise) : '—'} <small>this month</small></span></div>{data ? <SellerSalesTrendChart rows={data.salesTrend} /> : <Loading label="Loading sales trend…" />}<p className="seller-chart-footnote">Gross product sales only—not commission-adjusted earnings or settlement balance.</p></section>
              <section className="seller-panel seller-checklist-panel"><div className="seller-panel-heading"><div><h2>Your shop checklist</h2><p>A few small steps to keep your store ready.</p></div></div><div className="seller-checklist">
                <button onClick={() => setView('profile')}><span className="seller-check-complete">✓</span><span><strong>Seller account approved</strong><small>Your seller profile is active.</small></span></button>
                <button onClick={() => setView('profile')}><span className={data?.storeProfile?.storeDescription ? 'seller-check-complete' : 'seller-check-pending'}>{data?.storeProfile?.storeDescription ? '✓' : '2'}</span><span><strong>Add a store introduction</strong><small>{data?.storeProfile?.storeDescription ? 'Your story is on your profile.' : 'Tell shoppers about your group and craft.'}</small></span></button>
                <button onClick={() => setView('products')}><span className={metrics?.activeProducts ? 'seller-check-complete' : 'seller-check-pending'}>{metrics?.activeProducts ? '✓' : '3'}</span><span><strong>Publish your first product</strong><small>{metrics?.activeProducts ? 'Your products are live.' : 'Approved products appear in the marketplace.'}</small></span></button>
              </div></section>
              <section className="seller-panel"><div className="seller-panel-heading"><div><h2>Recent orders</h2><p>Update preparation status or mark orders Ready for Pickup.</p></div><button onClick={() => setOrderView('all')}>See all orders →</button></div>{orderActionMessage && <Notice tone="success">{orderActionMessage}</Notice>}{orderActionError && <Notice tone="error">{orderActionError}</Notice>}{orders.loading ? <SellerOrderSkeleton count={2} /> : orders.error ? <Notice tone="error">{orders.error}</Notice> : orderRows(data?.recentOrders ?? [])}</section>
              <section className="seller-panel"><div className="seller-panel-heading"><div><h2>Top-selling products</h2><p>By units sold in confirmed orders.</p></div><button onClick={() => setView('products')}>Your products →</button></div>{data?.topSellingProducts.length ? <div className="seller-top-products">{data.topSellingProducts.map((item, index) => <div key={item._id}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.productName}</strong><small>{item.unitsSold} sold</small><b>{formatMoney(item.grossSalesPaise)}</b></div>)}</div> : <div className="seller-panel-empty">Your top sellers will show here after confirmed paid orders.</div>}</section>
              <section className="seller-panel seller-low-stock-panel"><div className="seller-panel-heading"><div><h2>Stock needing attention</h2><p>Items at or below their low-stock threshold.</p></div><button onClick={() => viewInventory('low_stock')}>View inventory →</button></div>{data?.lowStockProducts.length ? <div className="seller-low-stock-list">{data.lowStockProducts.map((item) => <div key={item._id}><span className={item.availableStock === 0 ? 'is-out' : ''}>{item.availableStock}</span><strong>{item.name}</strong><small>{item.availableStock === 0 ? 'Out of stock' : 'Low stock'}</small></div>)}</div> : <div className="seller-panel-empty">All your products are above their low-stock threshold.</div>}</section>
              <section className="seller-panel"><div className="seller-panel-heading"><div><h2>Customer feedback</h2><p>Reviews are not available yet.</p></div></div><div className="seller-feedback-empty"><span>☆</span><strong>No reviews to show</strong><small>eSakhi does not currently collect customer reviews.</small><Link to="/help">Need help? Contact support →</Link></div></section>
            </div>
          </>}
        </>}
        {view === 'products' && productRows(false)}
        {view === 'inventory' && productRows(true)}
        {view === 'profile' && <SellerProfileView profile={data?.storeProfile ?? null} onSaved={() => dashboard.reload(false)} />}
        {view === 'orders' && <section className="seller-panel seller-orders-panel"><div className="seller-panel-heading"><div><h2>Your orders</h2><p>Manage order preparation and mark orders Ready for Pickup so the City Admin can assign a delivery partner.</p></div></div>
          {orderActionMessage && <Notice tone="success">{orderActionMessage}</Notice>}
          {orderActionError && <Notice tone="error">{orderActionError}</Notice>}
          <div className="seller-order-tabs" role="tablist" aria-label="Filter orders">{orderTabs.map((tab) => <button key={tab.key} role="tab" aria-selected={orderStatus === tab.key} className={orderStatus === tab.key ? 'active' : ''} onClick={() => { setOrderStatus(tab.key); setOrderPage(1); }}>{tab.label}</button>)}</div>
          {orders.loading ? <SellerOrderSkeleton count={3} /> : orders.error ? <Notice tone="error">{orders.error}</Notice> : orderRows(visibleOrders)}
          {orders.data && orders.data.pagination.totalPages > 1 && <div className="seller-pagination"><button className="seller-secondary-action" disabled={orderPage <= 1} onClick={() => setOrderPage((page) => page - 1)}>Previous</button><span>Page {orderPage} of {orders.data.pagination.totalPages} · {orders.data.pagination.total} orders</span><button className="seller-secondary-action" disabled={orderPage >= orders.data.pagination.totalPages} onClick={() => setOrderPage((page) => page + 1)}>Next</button></div>}
          <p className="seller-data-note">Once you mark a delivery order Ready for Pickup, the City Admin receives a popup notification in their portal to assign a suitable delivery partner.</p>
        </section>}
        {view === 'finance' && <SellerSettlementsLedgerPanel />}
        {view === 'payments' && <SellerSettlementsLedgerPanel />}
        {view === 'reviews' && <SellerUnavailablePanel title="Customer reviews are not available yet" description="The marketplace does not currently collect product ratings or written reviews." />}
        {view === 'support' && <SellerUnavailablePanel title="Support requests are handled by eSakhi" description="Seller support tickets are not tracked in the dashboard yet. Use the help centre to contact the team." />}
        {view === 'notifications' && <SellerUnavailablePanel title="Seller notifications are not configured yet" description="Order and product updates are visible in this dashboard. Seller-specific notification preferences are not currently available." />}
        {view === 'settings' && <section className="seller-panel seller-settings-panel"><div className="seller-panel-heading"><div><h2>Account settings</h2><p>Manage your sign-in and seller profile.</p></div></div><div className="seller-settings-actions"><button onClick={() => setView('profile')}>Edit store profile <span>→</span></button><Link to="/account/profile">Update account name <span>→</span></Link><button onClick={() => void signOut()}>Sign out <span>→</span></button></div></section>}
        {view === 'help' && <section className="seller-panel seller-help-panel"><div className="seller-panel-heading"><div><h2>Help & Support</h2><p>We’re here to help you run your store.</p></div></div><p>For help with products, orders, your account, or an assigned service area, contact the eSakhi team through the Help & policies page.</p><Link className="seller-primary-action" to="/help">Open Help & Support →</Link></section>}
        {view === 'new_product' && <SellerCatalogueListingPage onCancel={() => setView('products')} onSubmitted={() => { setView('products'); void products.reload(false); void dashboard.reload(false); }} onDraftSaved={setSavedDraft} />}
      </div>
      <nav className="seller-mobile-nav" aria-label="Seller navigation">
        {navItem('overview', 'Overview', '⌂')}
        {navItem('products', 'Products', '◇')}
        {navItem('orders', 'Orders', '▤')}
        {navItem('profile', 'Store', '◯')}
        <button className={mobileMenuOpen || !['overview', 'products', 'orders', 'profile'].includes(view) ? 'active' : ''} aria-expanded={mobileMenuOpen} aria-controls="seller-mobile-more" onClick={() => setMobileMenuOpen((open) => !open)}><span aria-hidden="true">⋯</span><small>More</small></button>
        {mobileMenuOpen && <div className="seller-mobile-more" id="seller-mobile-more">
          {navItem('inventory', 'Inventory', '▦', undefined, view === 'inventory', () => { viewInventory(); setMobileMenuOpen(false); })}
          {navItem('finance', 'Earnings & Settlements', '₹', undefined, view === 'finance', () => { setView('finance'); setMobileMenuOpen(false); })}
          {navItem('payments', 'Payment History', '▤', undefined, view === 'payments', () => { setView('payments'); setMobileMenuOpen(false); })}
          {navItem('reviews', 'Reviews & Feedback', '☆', undefined, view === 'reviews', () => { setView('reviews'); setMobileMenuOpen(false); })}
          {navItem('support', 'Support Requests', '?', undefined, view === 'support', () => { setView('support'); setMobileMenuOpen(false); })}
          {navItem('notifications', 'Notifications', '♧', undefined, view === 'notifications', () => { setView('notifications'); setMobileMenuOpen(false); })}
          {navItem('settings', 'Settings', '⚙', undefined, view === 'settings', () => { setView('settings'); setMobileMenuOpen(false); })}
          {navItem('help', 'Help & Support', '♡', undefined, view === 'help', () => { setView('help'); setMobileMenuOpen(false); })}
        </div>}
      </nav>
    </main>
  </div>;
}

function SellerMetric({ label, value, icon, unavailable = false, alert = false }: { label: string; value?: string | number; icon: string; unavailable?: boolean; alert?: boolean }): ReactNode {
  return <article className={`seller-metric${unavailable ? ' is-unavailable' : ''}${alert ? ' is-alert' : ''}`}><span className="seller-metric-icon">{icon}</span><span><small>{label}</small><strong>{value === undefined ? '…' : typeof value === 'number' ? value.toLocaleString('en-IN') : value}</strong><small>{unavailable ? 'Not available in seller data' : alert ? 'Needs attention' : 'Seller-scoped data'}</small></span></article>;
}

function DeliveryPartnerGate({ children }: { children: ReactNode }): ReactNode {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="page-container"><Loading label="Checking your session…" /></div>;
  if (!user) return <div className="page-container narrow"><PageIntro eyebrow="Delivery portal" title="Please sign in" description="Sign in with your delivery partner account to view assigned orders." /><Link to="/sign-in" state={{ from: location.pathname }} className="button">Sign in</Link></div>;
  if (user.role !== 'delivery_partner') return <div className="page-container narrow"><Notice tone="error">This portal is available only to delivery partners.</Notice></div>;
  return children;
}

function DeliveryPartnerPage(): ReactNode {
  const { user, signOut } = useAuth();
  const [view, setView] = useState<'overview' | 'deliveries' | 'history' | 'profile'>('overview');
  const orders = useLoad(() => api.partnerOrders(), [user?.id]);
  const history = useLoad(() => api.partnerOrderHistory(), [user?.id]);
  const profile = useLoad(() => api.partnerProfile(), [user?.id]);
  useRefreshOnFocus(orders.reload);
  useRefreshOnFocus(history.reload);
  useRefreshOnFocus(profile.reload);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [updatingAvailability, setUpdatingAvailability] = useState(false);
  const [reportingFailureOrder, setReportingFailureOrder] = useState<Order | null>(null);

  const toggleOnlineAvailability = async (nextOnline: boolean, nextStatus?: 'available' | 'busy' | 'offline') => {
    setUpdatingAvailability(true);
    setError('');
    setMessage('');
    try {
      await api.updatePartnerAvailability({
        isOnline: nextOnline,
        availabilityStatus: nextStatus ?? (nextOnline ? 'available' : 'offline'),
      });
      setMessage(nextOnline ? 'You are now ONLINE & AVAILABLE for nearby order assignments.' : 'You are now OFFLINE.');
      await profile.reload(false);
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setUpdatingAvailability(false);
    }
  };

  const refreshLiveGpsLocation = () => {
    setUpdatingAvailability(true);
    setError('');
    setMessage('');
    const saveCoords = async (lat: number, lng: number) => {
      try {
        await api.updatePartnerAvailability({
          isOnline: true,
          latitude: lat,
          longitude: lng,
        });
        setMessage(`Live GPS location updated (${lat.toFixed(4)}, ${lng.toFixed(4)}).`);
        await profile.reload(false);
      } catch (cause) {
        setError(displayError(cause));
      } finally {
        setUpdatingAvailability(false);
      }
    };
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => void saveCoords(pos.coords.latitude, pos.coords.longitude),
        () => void saveCoords(23.8388, 79.4422),
        { timeout: 5000 },
      );
    } else {
      void saveCoords(23.8388, 79.4422);
    }
  };

  const updateStatus = async (
    id: string,
    status: 'out_for_pickup' | 'picked_up' | 'out_for_delivery' | 'delivered' | 'delivery_failed' | 'return_picked_up' | 'return_delivered_to_seller',
    orderReference: string,
    paymentCollected?: boolean,
  ) => {
    const confirmationMap: Record<typeof status, string> = {
      out_for_pickup: `Accept assignment for #${orderReference} and start Route to Seller (OUT_FOR_PICKUP)?`,
      picked_up: `Confirm you reached the Seller and picked up package #${orderReference} (PICKED_UP)?`,
      out_for_delivery: `Start Route to Customer for #${orderReference} (OUT_FOR_DELIVERY)?`,
      delivered: `Confirm payment collected/settled and package #${orderReference} handed over to Customer (DELIVERED)? Your status will revert to AVAILABLE.`,
      delivery_failed: `Report delivery failed for #${orderReference}?`,
      return_picked_up: `Confirm you reached the Customer and picked up the return package #${orderReference} (RETURN_PICKED_UP)?`,
      return_delivered_to_seller: `Confirm you handed over the return package #${orderReference} back to the Seller (RETURN_DELIVERED_TO_SELLER)? Your active task will end and status will revert to AVAILABLE.`,
    };
    if (!window.confirm(confirmationMap[status])) return;
    setError('');
    setMessage('');
    try {
      await api.updatePartnerOrderStatus(id, status, note.trim() || undefined, paymentCollected);
      setNote('');
      setMessage(
        status === 'delivered'
          ? `Order #${orderReference} marked DELIVERED & payment settled! Your availability reverted to AVAILABLE.`
          : status === 'return_delivered_to_seller'
            ? `Reverse return #${orderReference} handed over to Seller (RETURN_DELIVERED_TO_SELLER)! Your availability reverted to AVAILABLE.`
            : `Order #${orderReference} updated to ${orderStatusLabel(status)}.`,
      );
      await Promise.all([orders.reload(false), history.reload(false), profile.reload(false)]);
    } catch (cause) {
      setError(displayError(cause));
    }
  };
  const activeOrders = orders.data ?? [];
  const deliveryHistory = history.data ?? [];
  const activeDelivery = activeOrders.find((order) =>
    ['out_for_pickup', 'picked_up', 'out_for_delivery', 'delivery_partner_assigned', 'return_partner_assigned', 'return_picked_up'].includes(order.fulfilmentStatus),
  ) ?? activeOrders[0];
  const [gpsStreamState, setGpsStreamState] = useState<'GPS_STREAM_ACTIVE' | 'GPS_STREAM_INACTIVE'>('GPS_STREAM_INACTIVE');

  useEffect(() => {
    const activeId = activeDelivery?._id;
    const status = activeDelivery?.fulfilmentStatus ?? '';
    const isTransitActive = Boolean(
      activeId && ['delivery_partner_assigned', 'out_for_pickup', 'picked_up', 'out_for_delivery', 'return_partner_assigned', 'return_picked_up'].includes(status),
    );
    if (!isTransitActive || !activeId) {
      setGpsStreamState('GPS_STREAM_INACTIVE');
      return;
    }

    setGpsStreamState('GPS_STREAM_ACTIVE');
    let cancelled = false;
    let watchId: number | null = null;

    const sendPing = async (lat: number, lng: number) => {
      if (cancelled) return;
      try {
        const res = await api.broadcastPartnerOrderLocation(activeId, lat, lng);
        if (res.streamStatus === 'GPS_STREAM_INACTIVE' || !res.active) {
          setGpsStreamState('GPS_STREAM_INACTIVE');
          if (watchId !== null && navigator.geolocation) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
          }
        }
      } catch {
        // Ignore transient network hiccups; next ping will retry while order remains in transit
      }
    };

    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => void sendPing(pos.coords.latitude, pos.coords.longitude),
        () => {
          const fallbackLat = status === 'picked_up'
            ? (activeDelivery?.sellerPickup?.latitude ?? 23.8388)
            : status === 'out_for_delivery'
              ? ((activeDelivery?.sellerPickup?.latitude ?? 23.8388) + (activeDelivery?.address?.latitude ?? 23.8342)) / 2
              : 23.8402;
          const fallbackLng = status === 'picked_up'
            ? (activeDelivery?.sellerPickup?.longitude ?? 79.4422)
            : status === 'out_for_delivery'
              ? ((activeDelivery?.sellerPickup?.longitude ?? 79.4422) + (activeDelivery?.address?.longitude ?? 79.4385)) / 2
              : 79.4438;
          void sendPing(fallbackLat, fallbackLng);
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 6000 },
      );
    }

    return () => {
      cancelled = true;
      if (watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [activeDelivery?._id, activeDelivery?.fulfilmentStatus, activeDelivery?.sellerPickup?.latitude, activeDelivery?.sellerPickup?.longitude, activeDelivery?.address?.latitude, activeDelivery?.address?.longitude]);
  const completedToday = deliveryHistory.filter((order) => {
    if (!['delivered', 'completed'].includes(order.fulfilmentStatus)) return false;
    const completedAt = [...(order.statusHistory ?? [])].reverse().find((event) => ['delivered', 'completed'].includes(event.status))?.changedAt;
    return completedAt ? new Date(completedAt).toDateString() === new Date().toDateString() : false;
  }).length;
  const isOnline = profile.data?.isOnline ?? true;
  const availabilityStatus = profile.data?.availabilityStatus ?? (activeOrders.length > 0 ? 'busy' : 'available');
  const partnerCoords = profile.data?.currentLocation;
  const title = view === 'history' ? 'Delivery history' : view === 'deliveries' ? 'My deliveries' : view === 'profile' ? 'Partner profile' : 'Ready to deliver?';
  const selectView = (next: typeof view) => setView(next);

  const renderOrders = (items: Order[], isHistory = false) => items.length ? (
    <div className="delivery-order-list">{items.map((order) => {
      const seller = order.sellerPickup;
      const destination = order.address;
      const sellerMapUrl = seller?.latitude !== undefined && seller?.longitude !== undefined
        ? `https://www.google.com/maps/dir/?api=1&destination=${seller.latitude},${seller.longitude}`
        : seller?.address
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${seller.address}, ${seller.city}`)}`
          : '';
      const customerMapQuery = destination
        ? encodeURIComponent([destination.addressLine1, destination.locality, destination.city, destination.postalCode].filter(Boolean).join(', '))
        : '';
      const customerMapUrl = destination
        ? (destination.latitude !== undefined && destination.longitude !== undefined
          ? `https://www.google.com/maps/dir/?api=1&destination=${destination.latitude},${destination.longitude}`
          : `https://www.google.com/maps/search/?api=1&query=${customerMapQuery}`)
        : '';

      const checkpointSteps = [
        { key: 'assigned', label: '1. Assigned', active: ['delivery_partner_assigned', 'ready_for_pickup', 'preparing', 'out_for_pickup', 'picked_up', 'out_for_delivery', 'delivered', 'completed'].includes(order.fulfilmentStatus) },
        { key: 'out_for_pickup', label: '2. Route to Seller (Out for Pickup)', active: ['out_for_pickup', 'picked_up', 'out_for_delivery', 'delivered', 'completed'].includes(order.fulfilmentStatus) },
        { key: 'picked_up', label: '3. Picked Up from Seller', active: ['picked_up', 'out_for_delivery', 'delivered', 'completed'].includes(order.fulfilmentStatus) },
        { key: 'out_for_delivery', label: '4. Route to Customer (Out for Delivery)', active: ['out_for_delivery', 'delivered', 'completed'].includes(order.fulfilmentStatus) },
        { key: 'delivered', label: '5. Delivered & Settled', active: ['delivered', 'completed'].includes(order.fulfilmentStatus) },
      ];

      return <article className="delivery-order-card" key={order._id}>
        <div className="delivery-order-heading">
          <div>
            <span className="delivery-section-kicker">ORDER #{order.orderReference} · {order.paymentMethod === 'cash' ? 'CASH ON DELIVERY' : 'ONLINE / UPI'} ({formatMoney(order.totalPaise)})</span>
            <h3>{order.customerName}</h3>
          </div>
          <StatusBadge value={order.fulfilmentStatus} fulfilmentMethod={order.fulfilmentMethod} />
        </div>

        {/* Visual Route Checkpoints */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: '0.45rem', margin: '0.75rem 0' }}>
          {checkpointSteps.map((cp) => (
            <div
              key={cp.key}
              style={{
                padding: '0.45rem 0.6rem',
                borderRadius: '8px',
                fontSize: '0.78rem',
                fontWeight: 600,
                background: cp.active ? 'rgba(29, 107, 67, 0.12)' : 'rgba(120, 80, 100, 0.06)',
                color: cp.active ? 'var(--success, #1d6b43)' : 'var(--muted, #6a5864)',
                border: cp.active ? '1px solid rgba(29, 107, 67, 0.35)' : '1px solid rgba(120, 80, 100, 0.14)',
              }}
            >
              {cp.active ? '✓ ' : '○ '}{cp.label}
            </div>
          ))}
        </div>

        {/* Visual Route Summary Bar */}
        <div className="delivery-route">
          <span className="delivery-route-point pickup"><i />Seller Pickup: {seller?.sellerName || 'Seller Shop'} ({seller?.city || 'Damoh'})</span>
          <span className="delivery-route-line" />
          <span className="delivery-route-point"><i />Customer Drop-off: {destination ? `${destination.locality}, ${destination.villageOrCity || destination.city}` : 'Customer Address'}</span>
        </div>

        {/* Full Seller Pickup & Customer Drop-off GPS Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '0.85rem', margin: '0.75rem 0' }}>
          <div style={{ padding: '0.85rem', borderRadius: '12px', background: 'rgba(107, 33, 92, 0.05)', border: '1px solid rgba(107, 33, 92, 0.18)' }}>
            <strong style={{ display: 'block', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--brand, #6b215c)' }}>
              📍 Step A · Route to Seller (Pickup Address & GPS)
            </strong>
            <div style={{ marginTop: '0.35rem', fontSize: '0.92rem' }}>
              <strong>{seller?.sellerName || 'Assigned Seller SHG'}</strong>
              {seller?.phoneE164 && <> · <a href={`tel:${seller.phoneE164}`}>{seller.phoneE164}</a></>}
              <address style={{ fontStyle: 'normal', marginTop: '0.2rem' }}>
                {seller ? `${seller.address}, ${seller.city}` : 'Damoh Seller Center'}
              </address>
              {seller?.latitude !== undefined && seller?.longitude !== undefined && (
                <small style={{ display: 'block', marginTop: '0.2rem', color: 'var(--muted, #6a5864)' }}>
                  Seller GPS: {seller.latitude.toFixed(4)}, {seller.longitude.toFixed(4)}
                  {order.deliveryPartner?.distanceKm !== undefined && order.deliveryPartner?.distanceKm !== null ? ` (${order.deliveryPartner.distanceKm} km from your location)` : ''}
                </small>
              )}
              {!isHistory && sellerMapUrl && (
                <a className="delivery-map-link" style={{ display: 'inline-block', marginTop: '0.35rem' }} href={sellerMapUrl} target="_blank" rel="noreferrer">
                  Navigate to Seller in Maps <span aria-hidden="true">↗</span>
                </a>
              )}
            </div>
          </div>

          <div style={{ padding: '0.85rem', borderRadius: '12px', background: 'rgba(29, 107, 67, 0.05)', border: '1px solid rgba(29, 107, 67, 0.2)' }}>
            <strong style={{ display: 'block', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--success, #1d6b43)' }}>
              🏁 Step B · Route to Customer (Drop-off Address & GPS)
            </strong>
            <div style={{ marginTop: '0.35rem', fontSize: '0.92rem' }}>
              <strong>{destination?.name || order.customerName}</strong>
              {destination?.phoneE164 && <> · <a href={`tel:${destination.phoneE164}`}>{destination.phoneE164}</a></>}
              {destination && (
                <address style={{ fontStyle: 'normal', marginTop: '0.2rem' }}>
                  {destination.formattedAddress || [destination.addressLine1, destination.addressLine2, destination.area, destination.landmark, destination.villageOrCity || destination.city, destination.district, destination.state, destination.postalCode].filter(Boolean).join(', ')}
                </address>
              )}
              {destination?.latitude !== undefined && destination?.longitude !== undefined && (
                <small style={{ display: 'block', marginTop: '0.2rem', color: 'var(--muted, #6a5864)' }}>
                  Customer GPS: {destination.latitude.toFixed(4)}, {destination.longitude.toFixed(4)}
                </small>
              )}
              {!isHistory && customerMapUrl && (
                <a className="delivery-map-link" style={{ display: 'inline-block', marginTop: '0.35rem' }} href={customerMapUrl} target="_blank" rel="noreferrer">
                  Navigate to Customer in Maps <span aria-hidden="true">↗</span>
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="delivery-order-items">{order.items.map((item, index) => <span key={`${item.productId}-${index}`}>{item.productName} × {item.quantity}</span>)}</div>
        <div className="delivery-order-meta">
          <span>Assigned {order.deliveryPartner?.assignedAt ? new Date(order.deliveryPartner.assignedAt).toLocaleString('en-IN') : '—'}</span>
          <span>Payment: <strong>{order.paymentMethod.toUpperCase()} ({formatMoney(order.totalPaise)}) · {order.paymentStatus.replaceAll('_', ' ')}</strong></span>
          {destination?.phoneE164 && <a href={`tel:${destination.phoneE164}`}>Call customer ({destination.phoneE164})</a>}
        </div>

        {!isHistory && <div className="delivery-order-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginTop: '0.75rem' }}>
          {['delivery_partner_assigned', 'ready_for_pickup', 'preparing'].includes(order.fulfilmentStatus) && (
            <button className="delivery-primary-action" onClick={() => void updateStatus(order._id, 'out_for_pickup', order.orderReference)}>
              Accept & Start Pickup (OUT_FOR_PICKUP)
            </button>
          )}
          {order.fulfilmentStatus === 'out_for_pickup' && (
            <button className="delivery-primary-action" onClick={() => void updateStatus(order._id, 'picked_up', order.orderReference)}>
              Confirm Picked Up from Seller (PICKED_UP)
            </button>
          )}
          {order.fulfilmentStatus === 'picked_up' && (
            <>
              <button className="delivery-primary-action" onClick={() => void updateStatus(order._id, 'out_for_delivery', order.orderReference)}>
                Start Route to Customer (OUT_FOR_DELIVERY)
              </button>
              <button
                type="button"
                className="delivery-secondary-action"
                style={{ color: '#b91c1c', borderColor: '#fca5a5', fontSize: '0.82rem' }}
                onClick={() => setReportingFailureOrder(order)}
              >
                ⚠️ Report Issue / Unassign
              </button>
            </>
          )}
          {order.fulfilmentStatus === 'out_for_delivery' && (
            <>
              <button className="delivery-primary-action" onClick={() => void updateStatus(order._id, 'delivered', order.orderReference, true)}>
                Confirm Payment ({order.paymentMethod === 'cash' ? `Collect Cash ${formatMoney(order.totalPaise)}` : 'Online Paid'}) & Mark DELIVERED
              </button>
              <button
                type="button"
                className="delivery-secondary-action"
                style={{ color: '#b91c1c', borderColor: '#fca5a5' }}
                onClick={() => setReportingFailureOrder(order)}
              >
                ⚠️ Report Delivery Issue
              </button>
            </>
          )}
          {['return_partner_assigned', 'return_accepted'].includes(order.fulfilmentStatus) && (
            <button
              className="delivery-primary-action"
              style={{ background: '#EA580C', borderColor: '#EA580C' }}
              onClick={() => void updateStatus(order._id, 'return_picked_up', order.orderReference)}
            >
              🔄 Confirm Return Picked Up from Customer (RETURN_PICKED_UP)
            </button>
          )}
          {order.fulfilmentStatus === 'return_picked_up' && (
            <button
              className="delivery-primary-action"
              style={{ background: '#16A34A', borderColor: '#16A34A' }}
              onClick={() => void updateStatus(order._id, 'return_delivered_to_seller', order.orderReference)}
            >
              ✓ Confirm Return Handed Over to Seller (RETURN_DELIVERED_TO_SELLER)
            </button>
          )}
        </div>}
      </article>;
    })}</div>
  ) : <div className="delivery-empty"><span aria-hidden="true">✿</span><h3>{isHistory ? 'No completed deliveries yet' : 'No active deliveries right now'}</h3><p>{isHistory ? 'Completed delivery records will appear here.' : 'Ensure your status is ONLINE & AVAILABLE so City Admin can assign nearby orders to you.'}</p></div>;

  const nav = (
    <>
      <button className={view === 'overview' ? 'active' : ''} onClick={() => selectView('overview')}><span aria-hidden="true">⌂</span>Overview</button>
      <button className={view === 'deliveries' ? 'active' : ''} onClick={() => selectView('deliveries')}><span aria-hidden="true">▣</span>Active Requests ({activeOrders.length})</button>
      <button className={view === 'history' ? 'active' : ''} onClick={() => selectView('history')}><span aria-hidden="true">◷</span>Delivery history</button>
      <button className={view === 'profile' ? 'active' : ''} onClick={() => selectView('profile')}><span aria-hidden="true">○</span>Profile & Pay Slip</button>
    </>
  );
  return <div className="delivery-portal">
    <header className="delivery-portal-header">
      <Link to="/" className="delivery-portal-brand"><img src="/images/maitri-sisterhood-logo.png" alt="" /><span><strong>eSakhi</strong><small>DELIVERY PARTNER</small></span></Link>
      <div className="delivery-header-user"><span>{user?.name || 'Delivery partner'}</span><button onClick={() => void signOut()} className="delivery-signout">Sign out</button></div>
    </header>
    <div className="delivery-portal-layout">
      <aside className="delivery-sidebar"><span className="delivery-sidebar-label">WORKSPACE</span><nav>{nav}</nav><div className="delivery-sidebar-note"><strong>Live GPS & Dispatch</strong><span>Stay ONLINE & AVAILABLE to receive nearby Seller pickup requests.</span></div></aside>
      <main className="delivery-main">
        <div className="delivery-page-heading"><div><span className="delivery-section-kicker">E SAKHI · DELIVERY PARTNER</span><h1>{title}</h1><p>{view === 'overview' ? 'Accept assigned orders, navigate to the Seller for pickup, and deliver to the Customer.' : view === 'profile' ? 'Your account details, live GPS coordinates, monthly pay slip, and availability controls.' : 'Orders and records connected to your partner account.'}</p></div><button className="delivery-refresh" onClick={() => void Promise.all([orders.reload(), history.reload(), profile.reload()])}>Refresh</button></div>
        {error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}
        {view === 'overview' && <>
          <section className="delivery-welcome">
            <div>
              <span className="delivery-section-kicker">GOOD DAY{user?.name ? `, ${user.name.split(' ')[0].toLocaleUpperCase('en-IN')}` : ''}</span>
              <h2>Your delivery workspace</h2>
              <p>
                Status: <strong>{isOnline ? (availabilityStatus === 'busy' ? 'ONLINE · ON DELIVERY' : 'ONLINE & AVAILABLE') : 'OFFLINE'}</strong>
                {partnerCoords ? ` · GPS: ${partnerCoords.latitude.toFixed(4)}, ${partnerCoords.longitude.toFixed(4)}` : ''}
                {' · '}
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: gpsStreamState === 'GPS_STREAM_ACTIVE' ? '#2563eb' : '#64748b' }}>
                  {gpsStreamState === 'GPS_STREAM_ACTIVE' ? '◉ Live GPS Broadcast Active' : '○ GPS Broadcast Idle (Battery Saver)'}
                </span>
              </p>
            </div>
            <div className="delivery-availability" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              <button
                type="button"
                className={isOnline ? 'delivery-secondary-action' : 'delivery-primary-action'}
                disabled={updatingAvailability}
                onClick={() => void toggleOnlineAvailability(!isOnline)}
              >
                {isOnline ? 'Go Offline' : 'Go Online & Available'}
              </button>
              {isOnline && availabilityStatus !== 'available' && activeOrders.length === 0 && (
                <button
                  type="button"
                  className="delivery-primary-action"
                  disabled={updatingAvailability}
                  onClick={() => void toggleOnlineAvailability(true, 'available')}
                >
                  Mark Idle / Available
                </button>
              )}
              <button
                type="button"
                className="delivery-secondary-action"
                disabled={updatingAvailability}
                onClick={refreshLiveGpsLocation}
              >
                📍 Update GPS
              </button>
            </div>
          </section>
          <section className="delivery-metrics" aria-label="Delivery summary">
            <article><span className="delivery-metric-icon">▣</span><small>Active deliveries</small><strong>{orders.loading ? '…' : activeOrders.length}</strong><span>Assigned to you</span></article>
            <article><span className="delivery-metric-icon">✓</span><small>Completed today</small><strong>{history.loading ? '…' : completedToday}</strong><span>From delivery history</span></article>
            <article><span className="delivery-metric-icon">◎</span><small>Availability</small><strong>{isOnline ? (availabilityStatus === 'busy' ? 'On Delivery' : 'Available') : 'Offline'}</strong><span>Live City Admin visibility</span></article>
            <article><span className="delivery-metric-icon">📍</span><small>Current GPS</small><strong>{partnerCoords ? `${partnerCoords.latitude.toFixed(3)}, ${partnerCoords.longitude.toFixed(3)}` : 'Damoh'}</strong><span>Used for Seller proximity</span></article>
          </section>
          <DeliveryPartnerPaySlipPanel />
          <div className="delivery-content-grid">
            <section className="delivery-panel" style={{ gridColumn: '1 / -1' }}>
              <div className="delivery-panel-heading"><div><span className="delivery-section-kicker">{activeDelivery ? 'ACTIVE REQUEST & ROUTE CHECKPOINTS' : 'YOUR ASSIGNMENTS'}</span><h2>{activeDelivery ? 'Active pickup & delivery route' : 'Assigned deliveries'}</h2></div><button onClick={() => selectView('deliveries')}>View all ({activeOrders.length}) <span aria-hidden="true">→</span></button></div>
              {orders.loading ? <Loading label="Loading assigned deliveries…" /> : orders.error ? <div className="delivery-panel-state"><Notice tone="error">{orders.error}</Notice><button className="delivery-secondary-action" onClick={() => void orders.reload()}>Try again</button></div> : renderOrders(activeOrders)}
            </section>
          </div>
          <section className="delivery-panel delivery-recent-history"><div className="delivery-panel-heading"><div><span className="delivery-section-kicker">RECENT ACTIVITY</span><h2>Delivery history</h2></div><button onClick={() => selectView('history')}>View history <span aria-hidden="true">→</span></button></div>{history.loading ? <Loading label="Loading delivery history…" /> : history.error ? <Notice tone="error">{history.error}</Notice> : renderOrders(deliveryHistory.slice(0, 2), true)}</section>
        </>}
        {view === 'deliveries' && <section className="delivery-panel"><div className="delivery-panel-heading"><div><span className="delivery-section-kicker">ACTIVE REQUESTS</span><h2>My assigned deliveries</h2></div></div>{orders.loading ? <Loading label="Loading assigned deliveries…" /> : orders.error ? <div className="delivery-panel-state"><Notice tone="error">{orders.error}</Notice><button className="delivery-secondary-action" onClick={() => void orders.reload()}>Try again</button></div> : renderOrders(activeOrders)}</section>}
        {view === 'history' && <section className="delivery-panel"><div className="delivery-panel-heading"><div><span className="delivery-section-kicker">COMPLETED & CLOSED</span><h2>Delivery history</h2></div></div>{history.loading ? <Loading label="Loading delivery history…" /> : history.error ? <Notice tone="error">{history.error}</Notice> : renderOrders(deliveryHistory, true)}</section>}
        {view === 'profile' && <><section className="delivery-panel delivery-profile-panel"><div className="delivery-panel-heading"><div><span className="delivery-section-kicker">YOUR ACCOUNT & GPS</span><h2>Partner profile</h2></div><Link to="/account/profile">Edit profile <span aria-hidden="true">→</span></Link></div><dl><div><dt>Name</dt><dd>{user?.name || 'Not provided'}</dd></div><div><dt>Phone</dt><dd>{user?.phone || 'Not available'}</dd></div><div><dt>Account</dt><dd>Delivery partner</dd></div><div><dt>Approved Localities</dt><dd>{profile.data?.serviceableLocalities?.join(', ') || 'Damoh'}</dd></div><div><dt>Availability</dt><dd>{isOnline ? `ONLINE (${availabilityStatus.toUpperCase()})` : 'OFFLINE'}</dd></div><div><dt>Live GPS Coordinates</dt><dd>{partnerCoords ? `${partnerCoords.latitude.toFixed(4)}, ${partnerCoords.longitude.toFixed(4)}` : '23.8388, 79.4422 (Damoh)'}</dd></div></dl></section><DeliveryPartnerPaySlipPanel /></>}
        <p className="delivery-data-note">Follow the checkpoint buttons in order: Accept (OUT_FOR_PICKUP) → Picked Up from Seller (PICKED_UP) → Out for Delivery (OUT_FOR_DELIVERY) → Confirm Payment & Mark Delivered (DELIVERED). When an order is marked DELIVERED, your status automatically reverts to AVAILABLE.</p>
      </main>
      {reportingFailureOrder && (
        <DeliveryFailureReportModal
          order={reportingFailureOrder}
          onClose={() => setReportingFailureOrder(null)}
          onSuccess={(msg) => {
            setMessage(msg);
            void Promise.all([orders.reload(false), history.reload(false), profile.reload(false)]);
          }}
        />
      )}
      <nav className="delivery-mobile-nav" aria-label="Delivery portal navigation">
        <button className={view === 'overview' ? 'active' : ''} onClick={() => selectView('overview')}><span>⌂</span>Home</button>
        <button className={view === 'deliveries' ? 'active' : ''} onClick={() => selectView('deliveries')}><span>▣</span>Deliveries</button>
        <button className={view === 'history' ? 'active' : ''} onClick={() => selectView('history')}><span>◷</span>History</button>
        <button className={view === 'profile' ? 'active' : ''} onClick={() => selectView('profile')}><span>○</span>Profile</button>
      </nav>
    </div>
  </div>;
}

function AdminCustomersPage(): ReactNode {
  const [page, setPage] = useState(1);
  const result = useLoad(() => api.customers(page), [page]);
  return <div className="admin-page"><PageIntro eyebrow="Community" title="Customers" description="Customer details are shown only to authorized administrators." />{result.error && <Notice tone="error">{result.error}</Notice>}{result.loading ? <Loading /> : result.data?.data.length ? <><div className="admin-table-wrap"><table><thead><tr><th>Customer</th><th>Phone</th><th>Account</th><th>Joined</th><th>Orders</th></tr></thead><tbody>{result.data.data.map((customer) => <tr key={getId(customer)}><td><Link to={`/admin/customers/${getId(customer)}`}>{customer.name || 'Customer'}</Link></td><td>{customer.phone ?? customer.phoneE164}</td><td><StatusBadge value={customer.status ?? 'active'} /></td><td>{customer.createdAt ? new Date(customer.createdAt).toLocaleDateString('en-IN') : '—'}</td><td><Link to={`/admin/customers/${getId(customer)}`}>View →</Link></td></tr>)}</tbody></table></div>{result.data.pagination.totalPages > 1 && <Pagination page={page} pages={result.data.pagination.totalPages} onChange={setPage} />}</> : <EmptyState title="No customers yet" />}</div>;
}

function AdminCustomerPage(): ReactNode {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const customer = useLoad(() => api.customer(id), [id]);
  const orders = useLoad(() => api.customerOrders(id, page), [id, page]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  if (customer.loading) return <div className="admin-page"><Loading /></div>;
  if (!customer.data) return <div className="admin-page"><Notice tone="error">{customer.error || 'Customer not found.'}</Notice></div>;
  const record = customer.data;
  const change = async (call: () => Promise<User>, label: string) => {
    if (!window.confirm(`${label} Continue?`)) return;
    setError(''); setMessage('');
    try { await call(); await customer.reload(); setMessage(label); }
    catch (cause) { setError(displayError(cause)); }
  };
  const promoteToPartner = async () => {
    if (!window.confirm('Grant delivery partner access to this existing account?')) return;
    setError('');
    setMessage('');
    try {
      await api.updateRole(id, 'delivery_partner');
      navigate(`/admin/delivery-partners/${id}`, { replace: true });
    } catch (cause) {
      setError(displayError(cause));
    }
  };
  const promoteToSeller = async () => {
    if (!window.confirm('Confirm that this seller application has completed the required review and approval before granting seller access. Continue?')) return;
    setError('');
    setMessage('');
    try {
      await api.updateRole(id, 'seller');
      navigate('/admin/customers', { replace: true });
    } catch (cause) {
      setError(displayError(cause));
    }
  };
  return <div className="admin-page"><div className="breadcrumbs"><Link to="/admin/customers">Customers</Link><span>/</span>Customer profile</div><PageIntro eyebrow="Customer profile" title={record.name || 'Customer'} description={`${record.phone ?? record.phoneE164} · ${record.orderCount} orders`} /><div className="panel user-actions"><div><span>Account status</span><StatusBadge value={record.status ?? 'active'} /></div><div className="button-row"><button className="button button-outline" onClick={() => void change(() => api.updateUserStatus(id, record.status === 'disabled' ? 'active' : 'disabled'), `${record.status === 'disabled' ? 'Enable' : 'Disable'} account`)}>{record.status === 'disabled' ? 'Enable account' : 'Disable account'}</button><button className="button button-outline" onClick={() => void change(() => api.updateRole(id, 'staff'), 'Grant staff access')}>Grant staff access</button><button className="button button-outline" onClick={() => void promoteToSeller()}>Approve and grant seller access</button><button className="button button-outline" onClick={() => void promoteToPartner()}>Grant delivery partner access</button><button className="button button-outline" onClick={() => void change(() => api.updateRole(id, 'customer'), 'Set role to customer')}>Set as customer</button></div></div>{error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}<section className="admin-panel"><div className="panel-heading"><div><span className="eyebrow">Customer history</span><h2>Orders</h2></div></div>{orders.error && <Notice tone="error">{orders.error}</Notice>}{orders.loading ? <Loading /> : orders.data?.data.length ? <><div className="order-list">{orders.data.data.map((order) => <OrderCard key={order._id} order={order} to={`/admin/orders/${order._id}`} />)}</div>{orders.data.pagination.totalPages > 1 && <Pagination page={page} pages={orders.data.pagination.totalPages} onChange={setPage} />}</> : <EmptyState title="No orders recorded for this customer" />}</section></div>;
}

const blankSettings: Settings = {
  businessName: '', city: '', state: '', serviceableLocalities: [],
  pickupEnabled: false, deliveryEnabled: false, staffEnabled: false,
  upiEnabled: false, cashEnabled: false, stockReservationHours: null,
  policies: {}, lowStockThreshold: 5,
};

function AdminSettingsPage(): ReactNode {
  const result = useLoad(() => api.settings());
  const [form, setForm] = useState<Settings>(blankSettings);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [localitiesJson, setLocalitiesJson] = useState('[]');
  const [policiesJson, setPoliciesJson] = useState('{}');
  const [localitiesError, setLocalitiesError] = useState('');
  const [policiesError, setPoliciesError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (result.data) {
      setForm(result.data);
      setLocalitiesJson(JSON.stringify(result.data.serviceableLocalities, null, 2));
      setPoliciesJson(JSON.stringify(result.data.policies, null, 2));
    }
  }, [result.data]);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm((previous) => ({ ...previous, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(''); setMessage('');
    if (localitiesError || policiesError) {
      setError([localitiesError, policiesError].filter(Boolean).join(' '));
      setSaving(false);
      return;
    }
    try { const saved = await api.saveSettings(form); setForm(saved); setMessage('Store settings saved.'); }
    catch (cause) { setError(displayError(cause)); }
    finally { setSaving(false); }
  };
  return <div className="admin-page"><PageIntro eyebrow="Store configuration" title="Settings" description="Service area, fulfilment and payment details shown to customers are controlled here." />{result.loading ? <Loading /> : <form className="settings-form" onSubmit={(event) => void submit(event)}>{!result.data && <Notice>Settings are not configured yet. Complete all required values before enabling checkout.</Notice>}{error && <Notice tone="error">{error}</Notice>}{localitiesError && <Notice tone="error">{localitiesError}</Notice>}{policiesError && <Notice tone="error">{policiesError}</Notice>}{message && <Notice tone="success">{message}</Notice>}<section className="panel form-section"><h2>Business details</h2><div className="form-grid"><TextInput label="Business name" value={form.businessName} onChange={(value) => update('businessName', value)} required /><TextInput label="Phone" value={form.phone ?? ''} onChange={(value) => update('phone', value)} /><TextInput label="WhatsApp" value={form.whatsapp ?? ''} onChange={(value) => update('whatsapp', value)} /><TextInput label="Address" value={form.address ?? ''} onChange={(value) => update('address', value)} /><TextInput label="City" value={form.city} onChange={(value) => update('city', value)} required /><TextInput label="State" value={form.state} onChange={(value) => update('state', value)} required /></div></section><section className="panel form-section"><h2>Service area & fulfilment</h2><p>Edit locality records as JSON. Each item uses a name, six-digit postalCodes list, and optional deliveryFeePaise integer.</p><label className="field"><span>Serviceable localities</span><textarea rows={6} value={localitiesJson} onChange={(event) => { setLocalitiesJson(event.target.value); try { const value: unknown = JSON.parse(event.target.value); if (!Array.isArray(value)) throw new Error('Localities must be a JSON array.'); update('serviceableLocalities', value as Settings['serviceableLocalities']); setLocalitiesError(''); } catch (cause) { setLocalitiesError(cause instanceof Error ? `Localities: ${cause.message}` : 'Localities must be valid JSON.'); } }} /></label><div className="toggle-grid"><Toggle label="Enable local delivery" checked={form.deliveryEnabled} onChange={(checked) => update('deliveryEnabled', checked)} /><Toggle label="Enable pickup" checked={form.pickupEnabled} onChange={(checked) => update('pickupEnabled', checked)} /><Toggle label="Enable staff accounts" checked={form.staffEnabled} onChange={(checked) => update('staffEnabled', checked)} /></div><TextInput label="Pickup instructions" value={form.pickupInstructions ?? ''} onChange={(value) => update('pickupInstructions', value)} /></section><section className="panel form-section"><h2>Payment options</h2><div className="toggle-grid"><Toggle label="Enable UPI" checked={form.upiEnabled} onChange={(checked) => update('upiEnabled', checked)} /><Toggle label="Enable cash" checked={form.cashEnabled} onChange={(checked) => update('cashEnabled', checked)} /></div><div className="form-grid"><TextInput label="UPI ID" value={form.upiId ?? ''} onChange={(value) => update('upiId', value)} /><TextInput label="UPI QR image HTTPS URL" value={form.upiQrUrl ?? ''} onChange={(value) => update('upiQrUrl', value)} /><TextInput label="UPI instructions" value={form.upiInstructions ?? ''} onChange={(value) => update('upiInstructions', value)} /><TextInput label="Cash instructions" value={form.cashInstructions ?? ''} onChange={(value) => update('cashInstructions', value)} /></div></section><section className="panel form-section"><h2>Stock & policies</h2><div className="form-grid"><label className="field"><span>Low-stock threshold</span><input type="number" min="0" value={form.lowStockThreshold} onChange={(event) => update('lowStockThreshold', Number(event.target.value))} /></label><label className="field"><span>Reservation expiry (hours; blank = manual)</span><input type="number" min="1" max="720" value={form.stockReservationHours ?? ''} onChange={(event) => update('stockReservationHours', event.target.value ? Number(event.target.value) : null)} /></label><label className="field span-two"><span>Customer-facing policies (JSON key/value)</span><textarea rows={5} value={policiesJson} onChange={(event) => { setPoliciesJson(event.target.value); try { const parsed: unknown = JSON.parse(event.target.value); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== 'string')) throw new Error('Policies must be a JSON object containing string values.'); update('policies', parsed as Record<string, string>); setPoliciesError(''); } catch (cause) { setPoliciesError(cause instanceof Error ? `Policies: ${cause.message}` : 'Policies must be valid JSON.'); } }} /></label></div></section><button className="button" disabled={saving}>{saving ? 'Saving…' : 'Save store settings'}</button></form>}</div>;
}

function TextInput({ label, value, onChange, required = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }): ReactNode {
  return <label className="field"><span>{label}</span><input required={required} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }): ReactNode {
  return <label className="toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

function SystemPage(): ReactNode {
  const result = useLoad(async () => {
    const checks = await Promise.allSettled([
      api.root(), api.discovery(), api.health(), api.ready(), api.categories(), api.categoryAlias(),
    ]);
    return checks.map((check, index) => ({
      name: ['API root', 'API discovery', 'Liveness', 'Database readiness', 'Categories', 'Product category alias'][index] || 'Endpoint',
      ok: check.status === 'fulfilled',
      detail: check.status === 'fulfilled' ? 'Reachable' : displayError(check.reason),
    }));
  });
  return <div className="admin-page"><PageIntro eyebrow="Integration checks" title="API status" description="Checks non-mutating public endpoints through the frontend's local API connection." />{result.error && <Notice tone="error">{result.error}</Notice>}{result.loading ? <Loading /> : <><div className="connection-list">{(result.data ?? []).map((check) => <div className="connection-row" key={check.name}><span><i className={check.ok ? 'connection-dot ok' : 'connection-dot'} />{check.name}</span><strong>{check.detail}</strong></div>)}</div><button className="button button-outline" onClick={() => void result.reload()}>Run checks again</button></>}</div>;
}

function NotFoundPage(): ReactNode {
  return <div className="page-container not-found"><span className="eyebrow">That page has wandered off</span><h1>Let's find your way back.</h1><Link to="/" className="button">Return home</Link></div>;
}

import { CityAdminRiderAuditPanel } from './CityAdminRiderAudit';
import { RiderOnboardingForm } from './RiderOnboardingForm';

function CityAdminDeliveryPartnersPage(): ReactNode {
  const { user } = useAuth();
  const [tab, setTab] = useState<'directory' | 'applications' | 'audit'>('directory');
  const [status, setStatus] = useState('pending');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const partners = useLoad(() => api.cityAdminDeliveryPartners(1, 100), []);
  useEffect(() => {
    const refresh = () => {
      void partners.reload(false);
    };
    window.addEventListener('city-admin-order-updated', refresh);
    return () => window.removeEventListener('city-admin-order-updated', refresh);
  }, [partners.reload]);
  const query = new URLSearchParams({ page: '1', limit: '50', status });
  const applications = useLoad(() => api.cityAdminDeliveryPartnerApplications(query), [status]);
  useRefreshOnFocus(partners.reload);
  useRefreshOnFocus(applications.reload);

  async function review(applicationId: string, decision: 'approved' | 'rejected' | 'needs_info'): Promise<void> {
    setError('');
    setMessage('');
    try {
      await api.reviewDeliveryPartnerApplication(applicationId, decision, notes[applicationId]?.trim());
      setMessage(decision === 'approved' ? 'Partner approved for the requested configured localities.' : decision === 'rejected' ? 'Partner application rejected.' : 'Partner application returned for more information.');
      await Promise.all([applications.reload(), partners.reload()]);
    } catch (cause) {
      setError(displayError(cause));
    }
  }

  return <div className="city-admin-page">
    <div className="city-admin-page-heading"><div><p className="city-admin-eyebrow">Local operations</p><h1>Delivery Partners</h1><p>Review partner applications and approved city-locality eligibility.</p></div><Link className="city-admin-secondary-button" to="/delivery-partner/apply">Open application form</Link></div>
    {error && <div className="city-admin-error" role="alert">{error}</div>}{message && <Notice tone="success">{message}</Notice>}
    <div className="city-admin-tabs" role="tablist" aria-label="Delivery partner views"><button type="button" role="tab" aria-selected={tab === 'directory'} className={tab === 'directory' ? 'active' : ''} onClick={() => setTab('directory')}>Partner directory</button><button type="button" role="tab" aria-selected={tab === 'applications'} className={tab === 'applications' ? 'active' : ''} onClick={() => setTab('applications')}>Applications</button><button type="button" role="tab" aria-selected={tab === 'audit'} className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>Biodata & Vehicle Audit</button></div>
    {tab === 'audit' ? (
      <section className="city-admin-panel" style={{ marginTop: '1rem' }}>
        <CityAdminRiderAuditPanel
          applications={applications.data?.data ?? []}
          onApplicationUpdated={() => {
            void applications.reload();
            void partners.reload();
          }}
        />
      </section>
    ) : tab === 'directory' ? <section className="city-admin-panel city-admin-order-directory">
      {partners.error && <div className="city-admin-error" role="alert">{partners.error}<button onClick={() => void partners.reload()}>Retry</button></div>}
      {partners.loading ? <Loading label="Loading city delivery partners…" /> : partners.error ? null : partners.data?.data.length ? <div className="city-admin-table-wrap"><table className="city-admin-table"><thead><tr><th>Partner</th><th>Phone</th><th>Approved localities</th><th>Active deliveries</th><th>Completed</th><th>Failed</th><th>Live Availability</th><th>GPS Location / Distance</th><th>Account</th></tr></thead><tbody>{partners.data.data.map((partner) => <tr key={partner._id}><td><strong>{partner.name || 'Delivery Partner'}</strong></td><td><a href={`tel:${partner.phoneE164}`}>{partner.phoneE164}</a></td><td>{partner.serviceableLocalities.join(', ')}</td><td>{partner.activeDeliveries}</td><td>{partner.completedDeliveries}</td><td>{partner.failedDeliveries}</td><td><span className={`status-badge status-${partner.availabilityStatus === 'available' && partner.isOnline ? 'delivered' : partner.availabilityStatus === 'busy' ? 'preparing' : 'cancelled'}`}>{partnerAvailabilityBadge(partner)}</span></td><td>{partner.currentLocation ? <small>{partner.currentLocation.latitude.toFixed(4)}, {partner.currentLocation.longitude.toFixed(4)}{partner.distanceKm !== null && partner.distanceKm !== undefined ? ` (${partner.distanceKm} km)` : ''}</small> : '—'}</td><td><StatusBadge value={partner.status ?? 'active'} /></td></tr>)}</tbody></table></div> : <div className="city-admin-empty">No approved delivery partners are assigned to {user?.assignedCity ?? 'this city'}.</div>}
    </section> : <section className="city-admin-panel city-admin-order-directory">
      <div className="city-admin-order-tools"><select aria-label="Filter partner applications by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="pending">Awaiting review</option><option value="needs_info">Needs more information</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></div>
      {applications.error && <div className="city-admin-error" role="alert">{applications.error}<button onClick={() => void applications.reload()}>Retry</button></div>}
      {applications.loading ? <Loading label="Loading partner applications…" /> : applications.error ? null : applications.data?.data.length ? <div className="city-admin-review-grid">{applications.data.data.map((application) => <article key={application._id} className="city-admin-review-card panel">
        <div className="panel-heading"><div><span className="eyebrow">{application.city} · {new Date(application.createdAt).toLocaleDateString('en-IN')}</span><h2>{application.name}</h2></div><span className={`status-pill status-${application.status.replaceAll('_', '-')}`}>{application.status.replaceAll('_', ' ')}</span></div>
        <div className="panel-body"><dl className="review-field-grid"><div><dt>Phone</dt><dd><a href={`tel:${application.phoneE164}`}>{application.phoneE164}</a></dd></div><div><dt>Requested localities</dt><dd>{application.requestedLocalities.join(', ')}</dd></div><div><dt>Note</dt><dd>{application.applicantNote || 'No note provided'}</dd></div>{application.reviewNote && <div><dt>Review note</dt><dd>{application.reviewNote}</dd></div>}</dl>
          {application.status === 'pending' || application.status === 'needs_info' ? <><label className="field"><span>Review note (required to reject)</span><textarea rows={2} maxLength={1000} value={notes[application._id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [application._id]: event.target.value }))} /></label><div className="button-row review-actions"><button type="button" className="button" onClick={() => void review(application._id, 'approved')}>Approve for localities</button><button type="button" className="button button-outline" onClick={() => void review(application._id, 'needs_info')}>Request information</button><button type="button" className="button button-light" disabled={!notes[application._id]?.trim()} onClick={() => void review(application._id, 'rejected')}>Reject</button></div></> : application.reviewedAt && <p className="city-admin-data-note">Reviewed {new Date(application.reviewedAt).toLocaleString('en-IN')}</p>}
        </div>
      </article>)}</div> : <div className="city-admin-empty">No partner applications in this queue.</div>}
    </section>}
  </div>;
}

function DeliveryPartnerApplicationPage(): ReactNode {
  const service = useLoad(() => api.serviceArea(), []);
  return (
    <div className="page-container narrow">
      <div className="page-intro">
        <div>
          <span className="eyebrow">Delivery Partner Onboarding</span>
          <h1>Join the eSakhi Hyperlocal Delivery Fleet</h1>
          <p>Flexible deliveries for Self-Help Groups (SHGs) with instant per-delivery payouts.</p>
        </div>
        <Link to="/" className="button button-outline">Back to store</Link>
      </div>

      <RiderOnboardingForm
        assignedCity={service.data?.city ?? 'Jaipur'}
        availableLocalities={service.data?.serviceableLocalities?.map((l) => l.name) ?? []}
      />
    </div>
  );
}

export default App;
