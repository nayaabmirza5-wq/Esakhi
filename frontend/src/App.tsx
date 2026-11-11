import { launchRazorpayPayment } from './utils/razorpay';
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState } from 'react';
// Firebase Phone Auth removed in favor of direct OTP
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, api, onSessionRefresh, refreshSession, resolveProductImageUrl, setAccessToken } from './api';
import type { AuditLogEntry, CityAdminDeliveryPartner, CityAdminOrder, CityAdminProduct, Locality, Order, Product, ProductCategory, Settings, SuperAdminOrder, User } from './types';
import { autoRegisterPushNotifications, disableOrderPushNotifications, enableOrderPushNotifications, pushNotificationsConfigured } from './pushNotifications';
import type { ForegroundPushMessage } from './pushNotifications';
import { AddressBook } from './AddressBook';
import { MeeshoSlipModal } from './components/MeeshoSlipModal';
import { CityAdminLiveTracker } from './CityAdminLiveTracker';
import { CityAdminCashRemittanceDesk } from './CityAdminCashRemittanceDesk';
import { DeliveryPartnerCockpit } from './modules/delivery/DeliveryPartnerCockpit';
import { SellerPortal } from './modules/seller/SellerPortal';
import {
  CityAdminDeliveryResolutionPanel,
} from './DeliveryEscalationSystem';
import {
  CustomerReturnAndCancelPanel,
  CityAdminDisputeArbitrationPanel,
  SuperAdminRefundsAndSettlementsView,
} from './ReturnDisputeSystem';
import {
  SuperAdminSupportDeskPage,
  SuperAdminAssistedPayoutDeskPage,
  CityAdminRaiseTicketModal,
} from './SuperAdminWorkspace';
import { AuthContext, useAuth } from './AuthContext';

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
  const isCityAdminPortal = location.pathname.startsWith('/city-admin');

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
              <Route path="/delivery" element={<Navigate to="/delivery-partner" replace />} />
              <Route path="/delivery-partner" element={<DeliveryPartnerGate><DeliveryPartnerCockpitPage /></DeliveryPartnerGate>} />
              <Route path="/seller" element={<SellerGate><SellerPortal /></SellerGate>} />
              <Route path="/seller/apply" element={<SellerRegistrationPage />} />
              <Route path="/seller/products/new" element={<SellerGate><SellerPortal initialView="new_product" /></SellerGate>} />
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
              <Route path="/city-admin/sellers" element={<CityAdminGate><CityAdminSellersPage /></CityAdminGate>} />
              <Route path="/city-admin/products" element={<CityAdminGate><CityAdminProductReviewPage /></CityAdminGate>} />
              <Route path="/city-admin/orders" element={<CityAdminGate><CityAdminOrdersPage /></CityAdminGate>} />
              <Route path="/city-admin/orders/:id" element={<CityAdminGate><CityAdminOrderDetailPage /></CityAdminGate>} />
              <Route path="/city-admin/remittance" element={<CityAdminGate><CityAdminCashRemittanceDesk /></CityAdminGate>} />
              <Route path="/city-admin/delivery-partners" element={<CityAdminGate><CityAdminDeliveryPartnersPage /></CityAdminGate>} />
              <Route path="/city-admin/profile" element={<CityAdminGate><CityAdminProfilePage /></CityAdminGate>} />
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
          {!location.pathname.startsWith('/super-admin') && !isCityAdminPortal && !isDeliveryPortal && !isSellerPortal && <Footer />}
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
          <img src="/images/esakhi-logo-transparent.png" alt="eSakhi — Handmade with Love. Empowered by You." />
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
        <Link to="/" className="footer-brand"><img src="/images/esakhi-logo-transparent.png" alt="eSakhi" /><span>Handmade with Love.<br />Empowered by You.</span></Link>
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
        <span className="product-pop-badge">
          <span>✨</span> Handcrafted
        </span>
        {image ? <img src={image} alt={product.name} loading="lazy" /> : <div className="image-placeholder" aria-label="No product image available"><img src="/images/esakhi-logo-transparent.png" alt="" /></div>}
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
          : <img src="/images/esakhi-logo-transparent.png" alt="eSakhi emblem representing women creating together" />}
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
      <div className="hero-stamp"><img src="/images/esakhi-logo-transparent.png" alt="" /><span>Made<br />together</span></div>
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
      <section className="marquee-3d-wrapper" aria-label="eSakhi highlights">
        <div className="marquee-3d-track">
          <div className="marquee-3d-group">
            <span>🌸 100% Handcrafted by Rural Women</span>
            <span className="marquee-dot">•</span>
            <span>✨ Direct from Damoh Clusters — Zero Middlemen</span>
            <span className="marquee-dot">•</span>
            <span>🌿 Eco-friendly, Natural & Pure Craft</span>
            <span className="marquee-dot">•</span>
            <span>🛍️ Handmade with Love. Empowered by You.</span>
            <span className="marquee-dot">•</span>
            <span>💖 Supporting 500+ Sisterhood Artisans</span>
            <span className="marquee-dot">•</span>
            <span>🚚 Safe & Swift Doorstep Delivery</span>
            <span className="marquee-dot">•</span>
          </div>
          <div className="marquee-3d-group" aria-hidden="true">
            <span>🌸 100% Handcrafted by Rural Women</span>
            <span className="marquee-dot">•</span>
            <span>✨ Direct from Damoh Clusters — Zero Middlemen</span>
            <span className="marquee-dot">•</span>
            <span>🌿 Eco-friendly, Natural & Pure Craft</span>
            <span className="marquee-dot">•</span>
            <span>🛍️ Handmade with Love. Empowered by You.</span>
            <span className="marquee-dot">•</span>
            <span>💖 Supporting 500+ Sisterhood Artisans</span>
            <span className="marquee-dot">•</span>
            <span>🚚 Safe & Swift Doorstep Delivery</span>
            <span className="marquee-dot">•</span>
          </div>
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
        <div className="story-band-mark"><img src="/images/esakhi-logo-transparent.png" alt="" /></div>
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
        <div className="detail-gallery">{item.imageUrls.length ? item.imageUrls.map((image, index) => <img key={image} src={resolveProductImageUrl(image)} alt={`${item.name}, view ${index + 1}`} />) : <div className="detail-placeholder"><img src="/images/esakhi-logo-transparent.png" alt="" /><span>Product image coming soon</span></div>}</div>
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
      <section className="story-hero"><div className="story-hero-logo"><img src="/images/esakhi-logo-transparent.png" alt="eSakhi — Handmade by women, made for you" /></div><div><span className="eyebrow">The people behind every piece</span><h1>From her hands<br />to your <em>heart.</em></h1><p>Every handmade product carries a story of courage, creativity, and independence.</p></div></section>
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

  useEffect(() => {
    void api.discovery().catch(() => {});
  }, []);

  const signInState = location.state as { from?: string; checkoutState?: unknown } | null;
  if (user) return <div className="page-container narrow"><Notice tone="success">You are signed in as {user.name || user.phone}.</Notice><Link to={workspacePathForRole(user.role)} className="button">Continue to your workspace</Link></div>;

  const submitPhone = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const formattedNumber = formatE164(phone);
      if (!/^\+91[6-9]\d{9}$/.test(formattedNumber)) {
        throw new Error('Please enter a valid 10-digit Indian mobile number.');
      }
      setRequested(true);
      void api.sendOtp(formattedNumber).catch(() => {});
    } catch (cause) {
      setError(displayError(cause));
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
      void reloadUser().catch(() => {});
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
        <img src="/images/esakhi-logo-transparent.png" alt="" />
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
  return <div className="page-container"><PageIntro eyebrow="Your selection" title="Your bag" description="Your total is confirmed by eSakhi when you place your order." />{!lines.length ? <EmptyState title="Your bag is waiting for something lovely"><Link to="/shop" className="button">Explore the collection</Link></EmptyState> : <div className="cart-layout"><div className="cart-list">{currentProducts.loading && <Loading label="Checking current product details…" />}{lines.map((line) => { const refreshed = currentProducts.data?.find((entry) => entry.key === productKey(line)); const displayProduct = refreshed?.product ?? line.product; const failed = Boolean(refreshed && !refreshed.product); const unavailable = line.unavailable; return <article key={productKey(line)} className="cart-item"><Link to={`/products/${displayProduct.slug}`} className="cart-thumb">{displayProduct.imageUrls[0] ? <img src={resolveProductImageUrl(displayProduct.imageUrls[0])} alt="" /> : <img src="/images/esakhi-logo-transparent.png" alt="" />}</Link><div className="cart-item-info"><span className="product-category">{displayProduct.category}</span><Link to={`/products/${displayProduct.slug}`} className="product-name">{displayProduct.name}</Link><span>{formatMoney(displayProduct.pricePaise)}</span>{unavailable && <span className="stock-note unavailable">No longer available — remove to continue.</span>}{failed && !unavailable && <span className="stock-note unavailable">{refreshed?.error || 'Could not refresh product details.'}</span>}</div><div className="cart-quantity"><button onClick={() => line.quantity > 1 ? setQuantity(productKey(line), line.quantity - 1) : remove(productKey(line))} aria-label="Decrease quantity">−</button><span>{line.quantity}</span><button onClick={() => setQuantity(productKey(line), Math.min(99, line.quantity + 1))} aria-label="Increase quantity">+</button></div><strong>{formatMoney(displayProduct.pricePaise * line.quantity)}</strong><button className="remove-button" onClick={() => remove(productKey(line))} aria-label={`Remove ${displayProduct.name}`}>×</button></article>; })}</div><aside className="summary-card"><span className="eyebrow">Order summary</span><div><span>Estimated subtotal</span><strong>{formatMoney(subtotal)}</strong></div><small>Final price, delivery fee, stock and payment options are checked by the server at checkout.</small>{currentProducts.data?.some((entry) => !entry.product) && <Notice tone="error">Refresh current product details or remove unavailable items before continuing.</Notice>}{currentProducts.data?.some((entry) => !entry.product) && <button className="button button-outline" onClick={() => void currentProducts.reload()}>Retry product check</button>}<Link aria-disabled={currentProducts.loading || currentProducts.data?.some((entry) => !entry.product)} onClick={(event) => { if (currentProducts.loading || currentProducts.data?.some((entry) => !entry.product)) event.preventDefault(); }} to="/checkout" className={`button button-full ${currentProducts.loading || currentProducts.data?.some((entry) => !entry.product) ? 'button-disabled' : ''}`}>Continue to checkout</Link><Link to="/shop" className="quiet-link">Continue shopping</Link></aside></div>}</div>;
}

function CheckoutPage(): ReactNode {
  const { user, reloadUser } = useAuth();
  const { lines, clear } = useCart();
  const location = useLocation();
  const navigate = useNavigate();
  const buyNowLine = getBuyNowLine(location.state);
  const checkoutLines = buyNowLine ? [buyNowLine] : lines;
  const service = useLoad(() => api.serviceArea());
  type PaymentOption = 'razorpay' | 'cash' | 'doorstep_upi';
  const [payment, setPayment] = useState<PaymentOption>('razorpay');
  const [values, setValues] = useState({ name: user?.name ?? '' });
  const [selectedAddressId, setSelectedAddressId] = useState(() => user?.savedAddresses?.find((address) => address.isDefault)?.id ?? user?.savedAddresses?.[0]?.id ?? '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const selectedAddress = user?.savedAddresses?.find((address) => (address.id ?? address._id) === selectedAddressId);
  const addressIsServiceable = Boolean(selectedAddress && service.data?.serviceableLocalities?.some((locality) =>
    locality.name.toLocaleLowerCase() === selectedAddress.locality.toLocaleLowerCase()
      && locality.postalCodes.includes(selectedAddress.postalCode)));

  const subtotalPaise = checkoutLines.reduce((acc, line) => acc + line.product.pricePaise * line.quantity, 0);
  const deliveryFeePaise = (addressIsServiceable && selectedAddress)
    ? ((service.data?.serviceableLocalities?.find((l) => l.name.toLocaleLowerCase() === selectedAddress.locality.toLocaleLowerCase())?.deliveryFeePaise) || 2900)
    : 2900;
  const totalPaise = subtotalPaise + deliveryFeePaise;

  useEffect(() => {
    if (!user || (selectedAddressId && user.savedAddresses?.some((address) => (address.id ?? address._id) === selectedAddressId))) return;
    const defaultAddress = user.savedAddresses?.find((address) => address.isDefault) ?? user.savedAddresses?.[0];
    setSelectedAddressId(defaultAddress?.id ?? defaultAddress?._id ?? '');
  }, [selectedAddressId, user]);

  if (!user) {
    return (
      <div className="page-container narrow">
        <PageIntro title="Sign in to continue" description="Orders are linked to your verified phone number." />
        <Link to="/sign-in" state={{ from: '/checkout', checkoutState: location.state }} className="button">
          Sign in
        </Link>
      </div>
    );
  }

  if (!checkoutLines.length) {
    return (
      <div className="page-container">
        <EmptyState title="Your bag is empty">
          <Link to="/shop" className="button">Find something handmade</Link>
        </EmptyState>
      </div>
    );
  }

  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    if (!selectedAddress) {
      setError('Please choose or add a delivery address in Damoh to continue.');
      setSubmitting(false);
      document.querySelector('.checkout-card:nth-of-type(2)')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    if (!addressIsServiceable) {
      setError('The selected delivery address is outside the Damoh delivery zone. Please choose a serviceable address.');
      setSubmitting(false);
      return;
    }

    const payload: Record<string, unknown> = {
      idempotencyKey,
      customerName: values.name.trim() || user.name || 'Customer',
      customerPhone: normalizeIndianPhone(user.phone ?? ''),
      fulfilmentMethod: 'delivery',
      items: checkoutLines.map((line) => ({
        productId: getId(line.product),
        ...(line.variantId ? { variantId: line.variantId } : {}),
        quantity: line.quantity,
      })),
      paymentMethod: payment,
      address: {
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
            ...(selectedAddress.locationAccuracyMeters !== undefined && selectedAddress.locationAccuracyMeters !== null
              ? { locationAccuracyMeters: selectedAddress.locationAccuracyMeters }
              : {}),
          }
          : {}),
        ...(selectedAddress.deliveryInstructions ? { deliveryInstructions: selectedAddress.deliveryInstructions } : {}),
      },
      ...(selectedAddress.deliveryInstructions ? { deliveryInstructions: selectedAddress.deliveryInstructions } : {}),
    };

    try {
      const result = await api.createOrder(payload as never);
      if (!buyNowLine) clear();
      setIdempotencyKey(crypto.randomUUID());

      if (payment === 'razorpay') {
        await launchRazorpayPayment({
          orderId: result.order._id,
          orderReference: result.order.orderReference,
          amountPaise: totalPaise,
          customerName: values.name.trim() || user.name || 'Customer',
          customerPhone: user.phone || '',
          onSuccess: () => {
            navigate(`/orders/${encodeURIComponent(result.order._id)}`, {
              state: { paymentInstructions: result.paymentInstructions },
            });
          },
          onError: (errMsg) => {
            setError(errMsg);
            navigate(`/orders/${encodeURIComponent(result.order._id)}`, {
              state: { paymentInstructions: result.paymentInstructions },
            });
          },
          onDismiss: () => {
            navigate(`/orders/${encodeURIComponent(result.order._id)}`, {
              state: { paymentInstructions: result.paymentInstructions },
            });
          },
        });
        return;
      }

      navigate(`/orders/${encodeURIComponent(result.order._id)}`, {
        state: { paymentInstructions: result.paymentInstructions },
      });
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container checkout-page-v2">
      <div className="checkout-header-strip">
        <div>
          <span className="eyebrow">eSakhi Secure Checkout</span>
          <h1>A thoughtful order starts here</h1>
          <p className="checkout-subheading">
            Directly supporting women self-help group artisans across Damoh.
          </p>
        </div>
        <div className="checkout-trust-badges">
          <span className="trust-badge">🔒 256-Bit SSL Encrypted</span>
          <span className="trust-badge">🌾 100% Artisan Direct</span>
          <span className="trust-badge">🚚 Damoh Hyperlocal 24-48h</span>
        </div>
      </div>

      {service.error && <Notice tone="error">{service.error}</Notice>}
      {service.data && !service.data.configured && (
        <Notice tone="error">Checkout service is being configured. Please check back shortly.</Notice>
      )}

      <form className="checkout-layout-v2" onSubmit={(event) => void submit(event)}>
        <div className="checkout-main-col">
          {/* DOORSTEP DELIVERY ASSURANCE BANNER */}
          <div className="checkout-fulfilment-banner">
            <span className="fulfilment-icon" aria-hidden="true">🚚</span>
            <div>
              <strong>Hyperlocal Doorstep Delivery Across Damoh</strong>
              <span>Dispatched directly from local women's SHG clusters to your doorstep within 24–48 hours.</span>
            </div>
            <span className="free-delivery-badge">{deliveryFeePaise === 0 ? 'FREE DELIVERY' : formatMoney(deliveryFeePaise)}</span>
          </div>

          {/* STEP 1: CONTACT PERSON */}
          <section className="checkout-card">
            <div className="checkout-card-header">
              <span className="checkout-step-number">1</span>
              <div>
                <h2>Contact Information</h2>
                <small>SMS dispatch updates and OTP handover will be sent to this verified number.</small>
              </div>
            </div>

            <div className="form-grid" style={{ marginTop: '14px' }}>
              <label className="field">
                <span>Your Name *</span>
                <input
                  required
                  maxLength={120}
                  placeholder="e.g. Priya Sharma"
                  value={values.name}
                  onChange={(event) => set('name', event.target.value)}
                />
              </label>

              <label className="field">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Verified Mobile Number</span>
                  <span className="verified-otp-tag">OTP Authenticated ✓</span>
                </div>
                <input value={user.phone ?? ''} readOnly style={{ background: 'var(--surface-soft)', fontWeight: 600 }} />
              </label>
            </div>
          </section>

          {/* STEP 2: DELIVERY ADDRESS */}
          <section className="checkout-card">
            <div className="checkout-card-header">
              <span className="checkout-step-number">2</span>
              <div>
                <h2>Where should we deliver?</h2>
                <small>Choose your saved address in Damoh or add a new one.</small>
              </div>
            </div>

            <div style={{ marginTop: '16px' }}>
              <AddressBook
                addresses={user.savedAddresses ?? []}
                serviceLocalities={service.data?.serviceableLocalities ?? []}
                customerName={user.name ?? ''}
                customerPhone={user.phone ?? ''}
                onChanged={reloadUser}
                selectedAddressId={selectedAddressId}
                onSelect={(address) => {
                  setSelectedAddressId(address.id ?? address._id ?? '');
                }}
              />
            </div>

            {selectedAddress && (
              <div className="checkout-address-confirm-strip">
                <div className="confirm-strip-copy">
                  <div className="confirm-strip-top">
                    <span className="confirm-pin-icon">📍</span>
                    <strong>{selectedAddress.label || 'Delivery Address'}</strong>
                    {addressIsServiceable ? (
                      <span className="serviceable-pill">✓ Serviceable in Damoh</span>
                    ) : (
                      <span className="unserviceable-pill">Outside Service Area</span>
                    )}
                  </div>
                  <p className="confirm-address-line">
                    {selectedAddress.formattedAddress || [
                      selectedAddress.houseNumber,
                      selectedAddress.street,
                      selectedAddress.area,
                      selectedAddress.city,
                      selectedAddress.state,
                      selectedAddress.postalCode,
                    ].filter(Boolean).join(', ')}
                  </p>
                  <small>Recipient: {selectedAddress.name} · {selectedAddress.phone}</small>
                </div>

                {!addressIsServiceable ? (
                  <Notice tone="error">This address is outside configured delivery zones in Damoh.</Notice>
                ) : (
                  <span className="address-confirmed-badge">✓ Confirmed for this order</span>
                )}
              </div>
            )}
          </section>

          {/* STEP 3: PAYMENT METHOD */}
          <section className="checkout-card">
            <div className="checkout-card-header">
              <span className="checkout-step-number">3</span>
              <div>
                <h2>Select Payment Method</h2>
                <small>Choose your preferred payment method. All transactions are 100% secure.</small>
              </div>
            </div>

            <div className="payment-options-grid">
              {/* OPTION 1: ONLINE PAYMENT (OFFICIAL RAZORPAY FRONTEND) */}
              <label className={`payment-option-card ${payment === 'razorpay' ? 'selected' : ''}`}>
                <div className="payment-option-top">
                  <input
                    type="radio"
                    name="payment"
                    checked={payment === 'razorpay'}
                    onChange={() => setPayment('razorpay')}
                  />
                  <div className="payment-option-title">
                    <strong>⚡ Pay Online (UPI, Cards, NetBanking, Wallets)</strong>
                    <span className="payment-sub">Official Razorpay Checkout · Instant & 100% Secure</span>
                  </div>
                  <span className="recom-badge">Recommended</span>
                </div>
                {payment === 'razorpay' && (
                  <div className="payment-expanded-body">
                    <div className="upi-app-badges" style={{ marginBottom: '0.65rem' }}>
                      <span className="upi-pill">Google Pay</span>
                      <span className="upi-pill">PhonePe</span>
                      <span className="upi-pill">Paytm</span>
                      <span className="upi-pill">Credit / Debit Cards</span>
                      <span className="upi-pill">Net Banking</span>
                      <span className="upi-pill">Wallets</span>
                    </div>
                    <p className="payment-hint-text">
                      Clicking <strong>Place Order</strong> opens the official Razorpay payment screen. You can pay via any UPI app, scan a dynamic QR code, enter your card details, or select your bank.
                    </p>
                  </div>
                )}
              </label>

              {/* OPTION 2: CASH ON DELIVERY */}
              <label className={`payment-option-card ${payment === 'cash' ? 'selected' : ''}`}>
                <div className="payment-option-top">
                  <input
                    type="radio"
                    name="payment"
                    checked={payment === 'cash'}
                    onChange={() => setPayment('cash')}
                  />
                  <div className="payment-option-title">
                    <strong>💵 Cash on Delivery (COD)</strong>
                    <span className="payment-sub">Pay in cash to our delivery partner upon package inspection</span>
                  </div>
                  <span className="free-tag">No Extra Charge</span>
                </div>
                {payment === 'cash' && (
                  <div className="payment-expanded-body">
                    <p className="payment-hint-text">
                      Handover exact cash to our verified local delivery partner after checking your package at the doorstep.
                    </p>
                  </div>
                )}
              </label>

              {/* OPTION 3: DOORSTEP UPI */}
              <label className={`payment-option-card ${payment === 'doorstep_upi' ? 'selected' : ''}`}>
                <div className="payment-option-top">
                  <input
                    type="radio"
                    name="payment"
                    checked={payment === 'doorstep_upi'}
                    onChange={() => setPayment('doorstep_upi')}
                  />
                  <div className="payment-option-title">
                    <strong>📲 Doorstep UPI (Pay upon Arrival)</strong>
                    <span className="payment-sub">Scan delivery partner's dynamic QR code on arrival</span>
                  </div>
                  <span className="convenient-tag">Popular</span>
                </div>
                {payment === 'doorstep_upi' && (
                  <div className="payment-expanded-body">
                    <p className="payment-hint-text">
                      No need to keep cash. Our delivery partner will present a dynamic digital UPI QR code on their device when your items arrive.
                    </p>
                  </div>
                )}
              </label>
            </div>
          </section>

          {error && <Notice tone="error">{error}</Notice>}

          <div className="checkout-main-actions" style={{ marginTop: '0.75rem' }}>
            <button
              className="button button-full place-order-btn"
              type="submit"
              disabled={submitting}
              style={{
                fontSize: '1.08rem',
                fontWeight: 900,
                padding: '0.95rem 1.25rem',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #4A0E4E 0%, #4a044e 100%)',
                color: '#ffffff',
                border: 'none',
                boxShadow: '0 4px 15px rgba(107, 33, 92, 0.35)',
                cursor: 'pointer',
              }}
            >
              {submitting ? 'Placing Order…' : payment === 'razorpay' ? `⚡ Pay ${formatMoney(totalPaise)} via Razorpay` : payment === 'cash' ? `💵 Place Order (Cash on Delivery) · ${formatMoney(totalPaise)}` : `📲 Place Order (Doorstep UPI) · ${formatMoney(totalPaise)}`}
            </button>
            {!selectedAddress && (
              <p className="checkout-action-hint" style={{ color: '#dc2626', marginTop: '0.5rem', textAlign: 'center', fontWeight: 600 }}>
                Please select or add your delivery address in Step 2 above to proceed.
              </p>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: STICKY ORDER SUMMARY */}
        <aside className="checkout-summary-col">
          <div className="summary-sticky-card">
            <div className="summary-header">
              <h3>Order Summary</h3>
              <span className="summary-count">{checkoutLines.length} item{checkoutLines.length > 1 ? 's' : ''}</span>
            </div>

            <div className="summary-item-list">
              {checkoutLines.map((line) => (
                <div key={productKey(line)} className="summary-item-row">
                  <div className="summary-item-info">
                    <strong>{line.product.name}</strong>
                    <small>Qty: {line.quantity}{line.product.category ? ` · ${line.product.category}` : ''}</small>
                  </div>
                  <span className="summary-item-price">{formatMoney(line.product.pricePaise * line.quantity)}</span>
                </div>
              ))}
            </div>

            <div className="summary-pricing-table">
              <div className="pricing-row">
                <span>Items Subtotal</span>
                <span>{formatMoney(subtotalPaise)}</span>
              </div>
              <div className="pricing-row">
                <span>Local Doorstep Delivery</span>
                <span className="free-price">{deliveryFeePaise === 0 ? 'FREE' : formatMoney(deliveryFeePaise)}</span>
              </div>
              <div className="pricing-row highlight-row">
                <span>Women Artisan Share</span>
                <span className="highlight-text">100% Direct</span>
              </div>
              <div className="pricing-row">
                <span>Convenience / Platform Fee</span>
                <span className="free-price">₹0 (Waived)</span>
              </div>
              <div className="pricing-total-row">
                <div>
                  <strong>Total Payable</strong>
                  <small>Inclusive of all local taxes</small>
                </div>
                <strong className="grand-total">{formatMoney(totalPaise)}</strong>
              </div>
            </div>

            <button
              className="button button-full place-order-btn"
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Placing Order…' : payment === 'razorpay' ? `⚡ Pay ${formatMoney(totalPaise)} via Razorpay` : payment === 'cash' ? `💵 Place Order (Cash on Delivery) · ${formatMoney(totalPaise)}` : `📲 Place Order (Doorstep UPI) · ${formatMoney(totalPaise)}`}
            </button>

            {!selectedAddress && (
              <p className="checkout-action-hint" style={{ color: '#dc2626', fontWeight: 600 }}>
                Select a delivery address above to place your order.
              </p>
            )}

            <div className="summary-guarantee-box">
              <span className="guarantee-icon">🛡️</span>
              <div>
                <strong>eSakhi Buyer Guarantee</strong>
                <small>Authentic handcrafted products from verified rural women's SHGs. Safe local handling.</small>
              </div>
            </div>
          </div>
        </aside>
      </form>
    </div>
  );
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
  const [copiedId, setCopiedId] = useState(false);
  const [detailedStepsOpen, setDetailedStepsOpen] = useState(false);
  const [showDirectCancel, setShowDirectCancel] = useState(false);
  const [directCancelReason, setDirectCancelReason] = useState('Changed mind / No longer needed');
  const [directCancelNote, setDirectCancelNote] = useState('');
  const [cancellingDirect, setCancellingDirect] = useState(false);
  const [cancelSuccessMsg, setCancelSuccessMsg] = useState('');
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

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
  const history = item.statusHistory?.length
    ? item.statusHistory
    : [{ status: 'placed', changedAt: item.createdAt ?? '' }];
  const currentStepIndex = DELIVERY_LIFECYCLE_STEPS.findIndex((step) => step.aliases.includes(item.fulfilmentStatus));

  const partnerMovementLabel = item.fulfilmentStatus === 'delivery_partner_assigned'
    ? `Partner ${item.deliveryPartner?.name ?? ''} assigned — awaiting partner acceptance`
    : item.fulfilmentStatus === 'out_for_pickup'
      ? 'Delivery partner moving toward Artisan Hub for package pickup'
      : item.fulfilmentStatus === 'picked_up'
        ? 'Package picked up from Artisan Hub — en route to your locality'
        : item.fulfilmentStatus === 'out_for_delivery'
          ? 'Delivery partner is out for delivery to your doorstep'
          : item.fulfilmentStatus === 'delivery_failed'
            ? '⚠️ Delivery delayed / attempt could not be completed — return pickup initiated'
            : item.fulfilmentStatus === 'return_partner_assigned'
              ? `🔄 Return Pickup Partner ${item.deliveryPartner?.name ?? ''} assigned to return parcel to Seller`
              : item.fulfilmentStatus === 'return_picked_up'
                ? `🔄 Partner ${item.deliveryPartner?.name ?? ''} is returning the parcel to Artisan SHG Hub`
                : item.fulfilmentStatus === 'return_delivered_to_seller'
                  ? '🏢 Parcel handed back to Artisan SHG Seller Hub'
                  : ['delivered', 'completed'].includes(item.fulfilmentStatus)
                    ? 'Handed over safely to you & delivery completed'
                    : 'Artisans are crafting and inspecting your items with care';

  const cancel = async () => {
    if (!window.confirm('Send an administrative cancellation review request for this order?')) return;
    setError('');
    try { order.setData(await api.requestCancellation(item._id)); }
    catch (cause) { setError(displayError(cause)); }
  };

  const isCancellationWindowOpen =
    ['placed', 'order_confirmed', 'accepted', 'preparing'].includes(item.fulfilmentStatus) &&
    !item.deliveryPartner?.userId &&
    item.fulfilmentStatus !== 'cancelled';

  const handleDirectCancel = async () => {
    setCancellingDirect(true);
    setError('');
    try {
      const fullReason = directCancelNote.trim()
        ? `${directCancelReason}: ${directCancelNote.trim()}`
        : directCancelReason;
      const updated = await api.cancelOrderDirect(item._id, fullReason);
      order.setData(updated);
      setCancelSuccessMsg('Order cancelled successfully. Any payments will be refunded to your source account.');
      setShowDirectCancel(false);
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setCancellingDirect(false);
    }
  };

  const handleCopyId = () => {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(item.orderReference);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  // Safe fallback for seller origin to prevent 'null, null, null'
  const sellerName = (item.sellerPickup?.sellerName && item.sellerPickup.sellerName !== 'null')
    ? item.sellerPickup.sellerName
    : "Maitri Women's SHG Cluster";
  const sellerAddress = (item.sellerPickup?.address && item.sellerPickup.address !== 'null')
    ? item.sellerPickup.address
    : "Civil Lines SHG Artisan Center";
  const sellerCity = (item.sellerPickup?.city && item.sellerPickup.city !== 'null')
    ? item.sellerPickup.city
    : "Damoh, Madhya Pradesh";

  // Customer drop-off address formatting
  const customerName = item.address?.name || item.customerName || 'Customer';
  const customerAddressParts = [
    item.address?.addressLine1,
    item.address?.locality,
    item.address?.city,
    item.address?.state,
    item.address?.postalCode,
  ].filter((v): v is string => Boolean(v) && v !== 'null');
  const formattedCustomerAddress = customerAddressParts
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(', ') || 'Damoh, Madhya Pradesh';

  // 4 Milestone customer journey
  const customerMilestones = [
    {
      key: 'confirmed',
      icon: '📦',
      label: 'Order Confirmed',
      desc: 'Order accepted by SHG',
      reached: !['cancelled'].includes(item.fulfilmentStatus),
      active: ['placed', 'order_confirmed', 'accepted'].includes(item.fulfilmentStatus),
    },
    {
      key: 'preparing',
      icon: '👩‍🌾',
      label: 'Artisan Preparing',
      desc: 'Handcrafted & quality-checked',
      reached: ['preparing', 'ready_for_pickup', 'delivery_partner_assigned', 'out_for_pickup', 'picked_up', 'out_for_delivery', 'delivered', 'completed'].includes(item.fulfilmentStatus),
      active: ['preparing', 'ready_for_pickup'].includes(item.fulfilmentStatus),
    },
    {
      key: 'transit',
      icon: '🛵',
      label: 'Out for Delivery',
      desc: 'En route with partner',
      reached: ['delivery_partner_assigned', 'out_for_pickup', 'picked_up', 'out_for_delivery', 'delivered', 'completed'].includes(item.fulfilmentStatus),
      active: ['delivery_partner_assigned', 'out_for_pickup', 'picked_up', 'out_for_delivery'].includes(item.fulfilmentStatus),
    },
    {
      key: 'delivered',
      icon: '🏡',
      label: 'Delivered',
      desc: 'Handed over at doorstep',
      reached: ['delivered', 'completed'].includes(item.fulfilmentStatus),
      active: ['delivered', 'completed'].includes(item.fulfilmentStatus),
    },
  ];

  const getProgressPercentage = () => {
    if (['delivered', 'completed'].includes(item.fulfilmentStatus)) return 100;
    if (item.fulfilmentStatus === 'out_for_delivery') return 80;
    if (item.fulfilmentStatus === 'picked_up') return 70;
    if (item.fulfilmentStatus === 'out_for_pickup') return 60;
    if (item.fulfilmentStatus === 'delivery_partner_assigned') return 50;
    if (item.fulfilmentStatus === 'ready_for_pickup') return 40;
    if (item.fulfilmentStatus === 'preparing') return 30;
    if (['placed', 'order_confirmed', 'accepted'].includes(item.fulfilmentStatus)) return 15;
    return 10;
  };

  const isDelivered = ['delivered', 'completed'].includes(item.fulfilmentStatus);
  const isCancelled = item.fulfilmentStatus === 'cancelled';
  const isPrepaid = Boolean(item.isPrepaid) || item.paymentStatus === 'confirmed' || (['razorpay', 'upi', 'card', 'netbanking'].includes(item.paymentMethod) && item.paymentStatus !== 'rejected');
  // Delivery Handover PIN appears strictly for PREPAID orders (so rider verifies OTP before handing over paid goods)
  const showDeliveryPin = Boolean(item.deliveryOtp) && item.fulfilmentMethod === 'delivery' && isPrepaid && !isDelivered && !isCancelled;

  const paymentMethodInfo = (() => {
    switch (item.paymentMethod) {
      case 'razorpay':
        return { name: 'Razorpay Online Gateway', badge: '100% Secured with RBI 2FA', icon: '💳' };
      case 'doorstep_upi':
        return { name: 'Doorstep UPI (Scan & Pay on Arrival)', badge: 'Dynamic QR', icon: '📱' };
      case 'cash':
        return { name: 'Cash on Delivery (COD)', badge: 'Pay at Doorstep', icon: '💵' };
      case 'upi':
        return { name: 'Direct UPI / QR Transfer', badge: 'Zero Extra Fee', icon: '⚡' };
      default:
        return { name: item.paymentMethod.replaceAll('_', ' '), badge: 'Standard Payment', icon: '💳' };
    }
  })();

  return (
    <div className="page-container" style={{ maxWidth: 1040, margin: '0 auto', padding: '1.5rem 1rem 3.5rem' }}>
      {/* Top Breadcrumb & Quick Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: '1.25rem' }}>
        <div className="breadcrumbs" style={{ margin: 0 }}>
          <Link to="/orders">← My Orders</Link>
          <span>/</span>
          <span style={{ color: '#4B5563', fontWeight: 600 }}>{item.orderReference}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setShowInvoiceModal(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: '#FDF4FF',
              color: '#4A0E4E',
              border: '1px solid #E879F9',
              borderRadius: 8,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            🏷️ Tax Invoice & Slip
          </button>
          <button
            type="button"
            onClick={handleCopyId}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: copiedId ? '#DCFCE7' : '#FFFFFF',
              color: copiedId ? '#15803D' : '#4B5563',
              border: `1px solid ${copiedId ? '#86EFAC' : '#E5E7EB'}`,
              borderRadius: 8,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {copiedId ? '✓ Copied ID' : '📋 Copy Order ID'}
          </button>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {/* Celebratory / Status Hero Card */}
      <div
        style={{
          background: isCancelled
            ? '#FEF2F2'
            : isDelivered
              ? 'linear-gradient(135deg, #F0FDF4 0%, #ECFDF5 50%, #FAF5FF 100%)'
              : item.fulfilmentStatus === 'delivery_failed' || item.fulfilmentStatus?.startsWith('return_')
                ? 'linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 60%, #FEF2F2 100%)'
                : 'linear-gradient(135deg, #FFF7ED 0%, #FDF2F8 50%, #FAF5FF 100%)',
          borderRadius: 20,
          border: `1px solid ${isCancelled ? '#FCA5A5' : isDelivered ? '#A7F3D0' : item.fulfilmentStatus === 'delivery_failed' || item.fulfilmentStatus?.startsWith('return_') ? '#FDBA74' : 'rgba(164, 61, 131, 0.2)'}`,
          padding: '24px 28px',
          boxShadow: '0 8px 30px rgba(109, 40, 120, 0.05)',
          marginBottom: '1.5rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.06)', fontSize: 12, fontWeight: 700, color: '#4A0E4E', marginBottom: 8 }}>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#10B981', boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.25)' }} />
              LIVE ORDER STATUS · DAMOH ARTISAN CLUSTER
            </div>
            <h1 style={{ margin: '4px 0 6px', fontSize: '1.75rem', fontWeight: 800, color: isCancelled ? '#991B1B' : '#1F2937', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>
                {isCancelled
                  ? '✕'
                  : isDelivered
                    ? '🌸'
                    : item.fulfilmentStatus === 'delivery_failed'
                      ? '⚠️'
                      : item.fulfilmentStatus?.startsWith('return_')
                        ? '🔄'
                        : item.fulfilmentStatus === 'out_for_delivery'
                          ? '🛵'
                          : '🎉'}
              </span>
              <span>
                {isCancelled
                  ? 'Order Cancelled'
                  : isDelivered
                    ? 'Delivered with Love!'
                    : item.fulfilmentStatus === 'delivery_failed'
                      ? 'Delivery Delayed · Return Initiated'
                      : item.fulfilmentStatus === 'return_partner_assigned'
                        ? 'Return Pickup Partner Assigned'
                        : item.fulfilmentStatus === 'return_picked_up'
                          ? 'Returning Parcel to Seller Hub'
                          : item.fulfilmentStatus === 'return_delivered_to_seller'
                            ? 'Parcel Returned to Seller Hub'
                            : item.fulfilmentStatus === 'out_for_delivery'
                              ? 'Out for Delivery!'
                              : 'Order Placed & Confirmed!'}
              </span>
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: '#4B5563', lineHeight: 1.5 }}>
              Order Reference: <strong style={{ color: '#111827', fontFamily: 'monospace' }}>#{item.orderReference}</strong>
              {item.createdAt && (
                <> · Placed on {new Date(item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} at {new Date(item.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</>
              )}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 700,
                background: isCancelled ? '#FEE2E2' : isDelivered ? '#DCFCE7' : '#FDF2F8',
                color: isCancelled ? '#991B1B' : isDelivered ? '#15803D' : '#4A0E4E',
                border: `1.5px solid ${isCancelled ? '#FCA5A5' : isDelivered ? '#86EFAC' : 'rgba(164, 61, 131, 0.3)'}`,
              }}
            >
              <span style={{ fontSize: 14 }}>{isCancelled ? '✕' : isDelivered ? '✓' : '●'}</span>
              {orderStatusLabel(item.fulfilmentStatus, item.fulfilmentMethod)}
            </span>
            <button
              type="button"
              className="button button-outline"
              onClick={() => void order.reload()}
              style={{ padding: '7px 14px', borderRadius: 999, fontSize: 12, background: '#FFFFFF', fontWeight: 600 }}
            >
              ↻ Refresh Live
            </button>
          </div>
        </div>
      </div>

      {/* Live Delivery Delay / Return Pickup Status Banner for Customer */}
      {(item.fulfilmentStatus === 'delivery_failed' ||
        item.fulfilmentStatus?.startsWith('return_') ||
        Boolean(item.deliveryExceptions && item.deliveryExceptions.length > 0)) && (
        <div
          style={{
            background: '#FFF7ED',
            border: '1.5px solid #FB923C',
            borderRadius: 16,
            padding: '18px 22px',
            marginBottom: '1.5rem',
            boxShadow: '0 4px 14px rgba(234, 88, 12, 0.08)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20 }}>🔄</span>
              <strong style={{ fontSize: 15, color: '#9A3412', fontWeight: 800 }}>
                Live Delivery &amp; Return Update
              </strong>
            </div>
            <span
              style={{
                background: '#FFEDD5',
                color: '#C2410C',
                border: '1px solid #FDBA74',
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              {orderStatusLabel(item.fulfilmentStatus, item.fulfilmentMethod)}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5, color: '#431407' }}>
            {item.deliveryExceptions && item.deliveryExceptions.length > 0 && (() => {
              const latestEx = item.deliveryExceptions[item.deliveryExceptions.length - 1];
              return (
                <div style={{ background: '#FFFFFF', padding: '10px 14px', borderRadius: 10, border: '1px solid #FED7AA' }}>
                  <div style={{ fontWeight: 700, color: '#DC2626' }}>
                    ⚠️ Delivery Delayed / Attempt Failed: {latestEx.reasonCode.replaceAll('_', ' ')}
                  </div>
                  {latestEx.reasonNotes && (
                    <div style={{ marginTop: 3, color: '#475569' }}>
                      <strong>Partner Note:</strong> &ldquo;{latestEx.reasonNotes}&rdquo;
                    </div>
                  )}
                </div>
              );
            })()}

            {item.deliveryPartner && (
              <div style={{ background: '#F0FDF4', padding: '10px 14px', borderRadius: 10, border: '1px solid #BBF7D0', color: '#14532D', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong>🛵 Assigned Return / Delivery Partner:</strong> {item.deliveryPartner.name}{' '}
                  {item.deliveryPartner.phoneE164 ? `(${item.deliveryPartner.phoneE164})` : ''}
                  <div style={{ fontSize: 12, color: '#15803D', marginTop: 2 }}>
                    {item.fulfilmentStatus === 'return_picked_up'
                      ? `Partner is currently returning the parcel back to ${sellerName}.`
                      : item.fulfilmentStatus === 'return_partner_assigned'
                        ? `Partner has been automatically assigned for return pickup to ${sellerName}.`
                        : item.fulfilmentStatus === 'return_delivered_to_seller'
                          ? `Partner has handed the return parcel back over to ${sellerName}.`
                          : 'Partner is assigned to handle your order.'}
                  </div>
                </div>
                {item.deliveryPartner.phoneE164 && (
                  <a
                    href={`tel:${item.deliveryPartner.phoneE164}`}
                    style={{
                      background: '#16A34A',
                      color: '#FFFFFF',
                      padding: '6px 12px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      textDecoration: 'none',
                    }}
                  >
                    📞 Call Partner
                  </a>
                )}
              </div>
            )}

            {/* Show latest 2 status history messages so customer sees every update immediately */}
            {history.slice(-2).map((h, i) =>
              h.note ? (
                <div key={i} style={{ fontSize: 12.5, color: '#7C2D12', paddingLeft: 4 }}>
                  • <strong>{orderStatusLabel(h.status, item.fulfilmentMethod)}:</strong> {h.note}
                </div>
              ) : null,
            )}
          </div>
        </div>
      )}

      {/* VIP Security Handover PIN */}
      {showDeliveryPin && (
        <div
          style={{
            background: 'linear-gradient(135deg, #FAF5FF 0%, #F5F3FF 100%)',
            border: '1.5px dashed #A855F7',
            borderRadius: 16,
            padding: '18px 24px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: '1.5rem',
            boxShadow: '0 4px 14px rgba(168, 85, 247, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                background: '#9333EA',
                color: '#FFFFFF',
                display: 'grid',
                placeItems: 'center',
                fontSize: 22,
                boxShadow: '0 2px 10px rgba(147, 51, 234, 0.35)',
              }}
            >
              🛡️
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#7E22CE', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Secure Delivery Handover Code
              </div>
              <div style={{ fontSize: 13, color: '#4B5563', marginTop: 2 }}>
                Share this 4-digit verification code with your delivery partner at your doorstep to receive your package.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {item.deliveryOtp?.split('').map((digit, i) => (
              <span
                key={i}
                style={{
                  width: 38,
                  height: 48,
                  borderRadius: 10,
                  background: '#FFFFFF',
                  border: '2px solid #A855F7',
                  color: '#581C87',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 22,
                  fontWeight: 900,
                  fontFamily: 'monospace',
                  boxShadow: '0 2px 5px rgba(0,0,0,0.06)',
                }}
              >
                {digit}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Customer-Centric 4-Milestone Order Journey */}
      {item.fulfilmentMethod === 'delivery' && !isCancelled && (
        <section
          style={{
            background: '#FFFFFF',
            borderRadius: 18,
            border: '1px solid #E5E7EB',
            padding: '24px 28px',
            boxShadow: '0 4px 18px rgba(0,0,0,0.03)',
            marginBottom: '1.5rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: '1.5rem' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: '#4A0E4E', textTransform: 'uppercase' }}>
                Order Progress Tracker
              </div>
              <h2 style={{ margin: '2px 0 0', fontSize: '1.25rem', fontWeight: 800, color: '#111827' }}>
                Delivery Journey
              </h2>
            </div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#047857',
                background: '#ECFDF5',
                padding: '4px 12px',
                borderRadius: 999,
                border: '1px solid #A7F3D0',
              }}
            >
              ● {partnerMovementLabel}
            </span>
          </div>

          {/* Progress Line & Milestones */}
          <div style={{ position: 'relative', padding: '10px 0 20px' }}>
            {/* Background Track */}
            <div
              style={{
                position: 'absolute',
                top: 32,
                left: '5%',
                right: '5%',
                height: 4,
                background: '#E5E7EB',
                borderRadius: 999,
                zIndex: 1,
              }}
            >
              {/* Active Fill Track */}
              <div
                style={{
                  height: '100%',
                  width: `${getProgressPercentage()}%`,
                  background: 'linear-gradient(90deg, #4A0E4E 0%, #10B981 100%)',
                  borderRadius: 999,
                  transition: 'width 0.4s ease',
                }}
              />
            </div>

            {/* Step Icons */}
            <div style={{ position: 'relative', zIndex: 2, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', textAlign: 'center' }}>
              {customerMilestones.map((m) => {
                return (
                  <div key={m.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        background: m.reached ? '#4A0E4E' : '#FFFFFF',
                        border: `3px solid ${m.reached ? '#4A0E4E' : '#D1D5DB'}`,
                        color: m.reached ? '#FFFFFF' : '#9CA3AF',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 18,
                        boxShadow: m.active ? '0 0 0 6px rgba(109, 40, 120, 0.2)' : '0 2px 6px rgba(0,0,0,0.06)',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      {m.reached && !m.active ? '✓' : m.icon}
                    </div>
                    <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: m.reached ? '#111827' : '#9CA3AF' }}>
                      {m.label}
                    </div>
                    <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2, maxWidth: 140 }}>
                      {m.desc}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Toggle for granular 8 lifecycle steps */}
          <div style={{ marginTop: 12, textAlign: 'center', borderTop: '1px solid #F3F4F6', paddingTop: 14 }}>
            <button
              type="button"
              onClick={() => setDetailedStepsOpen(!detailedStepsOpen)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#4A0E4E',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 6,
              }}
            >
              <span>{detailedStepsOpen ? 'Hide' : 'View'} Complete 8-Stage Audit Trail</span>
              <span style={{ transform: detailedStepsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}>▾</span>
            </button>
          </div>

          {detailedStepsOpen && (
            <div
              style={{
                marginTop: 14,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 8,
                padding: '14px',
                borderRadius: 12,
                background: '#F9FAFB',
              }}
            >
              {DELIVERY_LIFECYCLE_STEPS.map((step, index) => {
                const reached = currentStepIndex >= index;
                const isCurrent = currentStepIndex === index;
                const historyMatch = [...history].reverse().find((h) => step.aliases.includes(h.status));
                return (
                  <div
                    key={step.key}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: isCurrent ? '1.5px solid #4A0E4E' : reached ? '1px solid #A7F3D0' : '1px solid #E5E7EB',
                      background: isCurrent ? '#FDF2F8' : reached ? '#ECFDF5' : '#FFFFFF',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: reached ? (isCurrent ? '#4A0E4E' : '#047857') : '#9CA3AF' }}>
                        {reached ? '✓ ' : `${index + 1}. `}{step.label}
                      </span>
                      {isCurrent && (
                        <span style={{ fontSize: 9, fontWeight: 800, background: '#4A0E4E', color: '#FFF', padding: '1px 5px', borderRadius: 999 }}>
                          NOW
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>{step.description}</div>
                    {historyMatch?.changedAt && (
                      <div style={{ fontSize: 9, color: '#9CA3AF', marginTop: 3 }}>
                        {new Date(historyMatch.changedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Transit Route & Live Delivery Partner Spotlight */}
      {item.fulfilmentMethod === 'delivery' && !isCancelled && (
        <section
          style={{
            background: '#FFFFFF',
            borderRadius: 18,
            border: '1px solid #E5E7EB',
            padding: '22px 24px',
            boxShadow: '0 4px 18px rgba(0,0,0,0.03)',
            marginBottom: '1.5rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🗺️</span> Transit Route & Dispatch Details
            </h3>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#047857', background: '#ECFDF5', padding: '3px 10px', borderRadius: 999, border: '1px solid #A7F3D0' }}>
              ⚡ Damoh Local Express
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
            {/* Origin */}
            <div
              style={{
                display: 'flex',
                gap: 12,
                padding: '14px 16px',
                borderRadius: 14,
                background: '#FFFDF5',
                border: '1px solid #FEF3C7',
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: '#FEF3C7',
                  color: '#B45309',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 18,
                  flexShrink: 0,
                }}
              >
                🏪
              </div>
              <div style={{ fontSize: 13 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#B45309', textTransform: 'uppercase' }}>
                  Pickup Origin (Artisan SHG)
                </div>
                <div style={{ fontWeight: 700, color: '#111827', marginTop: 2 }}>{sellerName}</div>
                <div style={{ color: '#4B5563', marginTop: 1, fontSize: 12 }}>{sellerAddress}, {sellerCity}</div>
              </div>
            </div>

            {/* Destination */}
            <div
              style={{
                display: 'flex',
                gap: 12,
                padding: '14px 16px',
                borderRadius: 14,
                background: '#F0FDF4',
                border: '1px solid #DCFCE7',
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: '#DCFCE7',
                  color: '#15803D',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 18,
                  flexShrink: 0,
                }}
              >
                📍
              </div>
              <div style={{ fontSize: 13 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#15803D', textTransform: 'uppercase' }}>
                  Delivery Destination (You)
                </div>
                <div style={{ fontWeight: 700, color: '#111827', marginTop: 2 }}>{customerName}</div>
                <div style={{ color: '#4B5563', marginTop: 1, fontSize: 12 }}>{formattedCustomerAddress}</div>
              </div>
            </div>
          </div>

          {/* Delivery Partner Spotlight */}
          {item.deliveryPartner && (
            (() => {
              const isActiveForward = ['delivery_partner_assigned', 'out_for_pickup', 'picked_up', 'out_for_delivery'].includes(item.fulfilmentStatus);
              const isDelivered = ['delivered', 'completed'].includes(item.fulfilmentStatus);
              const isReturnInProgress = ['return_partner_assigned', 'return_picked_up'].includes(item.fulfilmentStatus);
              const isReturnAccepted = ['return_accepted', 'return_requested'].includes(item.fulfilmentStatus);

              let badgeTitle = 'Assigned Delivery Partner';
              let badgeColor = '#047857';
              let badgeBg = 'linear-gradient(135deg, #F0FDF4 0%, #ECFDF5 100%)';
              let badgeBorder = '#A7F3D0';
              let iconBg = '#10B981';
              let iconEmoji = '🛵';

              if (isActiveForward) {
                badgeTitle = item.fulfilmentStatus === 'out_for_delivery'
                  ? '🛵 Partner Out For Delivery (En Route To You)'
                  : item.fulfilmentStatus === 'picked_up'
                    ? '📦 Package Picked Up from Seller'
                    : '🛵 Assigned Delivery Partner';
              } else if (isDelivered) {
                badgeTitle = '✓ Order Delivered By Partner';
                badgeBg = '#F8FAFC';
                badgeBorder = '#E2E8F0';
                iconBg = '#64748B';
                iconEmoji = '✓';
              } else if (isReturnInProgress) {
                badgeTitle = '🔄 Return Pickup Agent Dispatched';
                badgeBg = '#FFF7ED';
                badgeBorder = '#FFEDD5';
                iconBg = '#EA580C';
                iconEmoji = '🔄';
              } else if (isReturnAccepted) {
                badgeTitle = '⏳ Return Authorized · Reverse Pickup Agent Being Scheduled';
                badgeBg = '#FFFBEB';
                badgeBorder = '#FEF3C7';
                iconBg = '#D97706';
                iconEmoji = '⏳';
              }

              return (
                <div
                  style={{
                    marginTop: 14,
                    padding: '14px 18px',
                    borderRadius: 14,
                    background: badgeBg,
                    border: `1px solid ${badgeBorder}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        background: iconBg,
                        color: '#FFFFFF',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 18,
                      }}
                    >
                      {iconEmoji}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: badgeColor, textTransform: 'uppercase' }}>
                        {badgeTitle}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#064E3B' }}>
                        {item.deliveryPartner.name}
                        {isActiveForward && item.deliveryPartner.distanceKm !== undefined && item.deliveryPartner.distanceKm !== null && (
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#059669', marginLeft: 6 }}>
                            · {item.deliveryPartner.distanceKm} km from seller
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {isActiveForward && item.deliveryPartner.phoneE164 && (
                    <a
                      href={`tel:${item.deliveryPartner.phoneE164}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '8px 16px',
                        borderRadius: 8,
                        background: '#059669',
                        color: '#FFFFFF',
                        fontSize: 13,
                        fontWeight: 700,
                        textDecoration: 'none',
                        boxShadow: '0 2px 6px rgba(5, 150, 105, 0.25)',
                      }}
                    >
                      📞 Call Partner ({item.deliveryPartner.phoneE164})
                    </a>
                  )}
                </div>
              );
            })()
          )}
        </section>
      )}

      {/* Two-Column Grid: Order Items & Breakdown (Left) vs Delivery & Payment Info (Right) */}
      <div className="order-detail-grid" style={{ alignItems: 'start', gap: 24 }}>
        {/* LEFT COLUMN: Items & Activity Timeline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Items Card */}
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: 18,
              border: '1px solid #E5E7EB',
              padding: '24px',
              boxShadow: '0 4px 18px rgba(0,0,0,0.03)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>🛍️</span> Handcrafted Pieces ({item.items.reduce((acc, curr) => acc + curr.quantity, 0)})
              </h2>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#4A0E4E', background: '#FDF2F8', padding: '3px 10px', borderRadius: 999 }}>
                Direct from SHG
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {item.items.map((line, index) => (
                <div
                  key={`${line.productId}-${index}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 0',
                    borderBottom: '1px solid #F3F4F6',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 10,
                        background: '#FDF2F8',
                        color: '#4A0E4E',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 22,
                        flexShrink: 0,
                      }}
                    >
                      ✨
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: '#1F2937', fontSize: 14 }}>
                        {line.productName}
                      </div>
                      <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                        Qty: <strong style={{ color: '#111827' }}>{line.quantity}</strong>
                        {line.unitPricePaise ? ` · ${formatMoney(line.unitPricePaise)} each` : ''}
                      </div>
                    </div>
                  </div>
                  <strong style={{ fontSize: 15, color: '#111827' }}>
                    {formatMoney(line.lineTotalPaise)}
                  </strong>
                </div>
              ))}
            </div>

            {/* Bill Breakdown */}
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: '2px dashed #E5E7EB', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#4B5563' }}>
                <span>Items Subtotal</span>
                <span style={{ fontWeight: 600, color: '#111827' }}>{formatMoney(item.subtotalPaise)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#047857' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>💚</span> Direct Women Artisan Share
                </span>
                <span style={{ fontWeight: 700 }}>100% Direct (Zero Commission)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#4B5563' }}>
                <span>Damoh Local Express Delivery</span>
                <span style={{ fontWeight: 600, color: '#111827' }}>
                  {formatMoney(item.deliveryFeePaise || 2900)}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: 6,
                  paddingTop: 12,
                  borderTop: '1px solid #E5E7EB',
                  fontSize: 16,
                  fontWeight: 800,
                  color: '#111827',
                }}
              >
                <span>Total Amount</span>
                <span style={{ fontSize: 18, color: '#4A0E4E' }}>{formatMoney(item.totalPaise)}</span>
              </div>
            </div>
          </div>

          {/* Chronological Activity Log */}
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: 18,
              border: '1px solid #E5E7EB',
              padding: '24px',
              boxShadow: '0 4px 18px rgba(0,0,0,0.03)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>📜</span> Order Activity & Verification Log
              </h2>
              <button
                type="button"
                className="button button-outline"
                style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6 }}
                onClick={() => void order.reload()}
              >
                ↻ Refresh Log
              </button>
            </div>
            <ol className="order-timeline">
              {history.map((entry, index) => (
                <li className="order-timeline-entry" key={`${entry.status}-${entry.changedAt}-${index}`}>
                  <span className="order-timeline-marker" aria-hidden="true" />
                  <div>
                    <strong style={{ fontSize: 14, color: '#1F2937' }}>{orderStatusLabel(entry.status, item.fulfilmentMethod)}</strong>
                    {entry.changedAt && (
                      <time dateTime={entry.changedAt} style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                        {new Date(entry.changedAt).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    )}
                    {entry.note && <p style={{ fontSize: 13, color: '#4B5563', margin: '4px 0 0' }}>{entry.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* RIGHT COLUMN: Delivery & Payment Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Delivery Details Card */}
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: 18,
              border: '1px solid #E5E7EB',
              padding: '24px',
              boxShadow: '0 4px 18px rgba(0,0,0,0.03)',
            }}
          >
            <h2 style={{ margin: '0 0 14px', fontSize: '1.15rem', fontWeight: 800, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🏡</span> Delivery Address
            </h2>
            <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>{customerName}</div>
              <div style={{ color: '#4B5563', marginTop: 3 }}>{formattedCustomerAddress}</div>
              {(item.customerPhoneE164 || item.customerPhone) && (
                <div style={{ marginTop: 6, color: '#4B5563', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>📞</span> {item.customerPhoneE164 || item.customerPhone}
                </div>
              )}
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #F3F4F6', fontSize: 12, color: '#047857', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>⚡</span> Standard 2-4 Hours Local Handover
            </div>
          </div>

          {/* Payment Card */}
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: 18,
              border: '1px solid #E5E7EB',
              padding: '24px',
              boxShadow: '0 4px 18px rgba(0,0,0,0.03)',
            }}
          >
            <h2 style={{ margin: '0 0 14px', fontSize: '1.15rem', fontWeight: 800, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>💳</span> Payment Information
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#4B5563' }}>Method:</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#111827', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{paymentMethodInfo.icon}</span> {paymentMethodInfo.name}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#4B5563' }}>Payment Status:</span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    padding: '3px 10px',
                    borderRadius: 999,
                    background: isPrepaid ? '#DCFCE7' : '#FEF3C7',
                    color: isPrepaid ? '#15803D' : '#92400E',
                    border: `1px solid ${isPrepaid ? '#86EFAC' : '#FCD34D'}`,
                  }}
                >
                  {isPrepaid ? '✓ Paid & Verified' : item.paymentMethod === 'cash' ? '💵 Pay on Delivery' : item.paymentMethod === 'doorstep_upi' ? '📱 Scan on Delivery' : 'Pending Verification'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#4B5563' }}>Amount:</span>
                <span style={{ fontSize: 15, fontWeight: 800, color: '#111827' }}>
                  {formatMoney(item.totalPaise)}
                </span>
              </div>
            </div>

            {/* Contextual notes */}
            {item.paymentMethod === 'cash' && (
              <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: '#F9FAFB', border: '1px solid #E5E7EB', fontSize: 12, color: '#4B5563', lineHeight: 1.4 }}>
                <strong>Cash on Delivery:</strong> Please keep exact cash of {formatMoney(item.totalPaise)} or your UPI app ready when the partner arrives.
              </div>
            )}

            {item.paymentMethod === 'doorstep_upi' && (
              <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: '#F5F3FF', border: '1px solid #DDD6FE', fontSize: 12, color: '#5B21B6', lineHeight: 1.4 }}>
                <strong>Doorstep UPI:</strong> Scan the delivery partner&apos;s dynamic QR code upon arrival using Google Pay, PhonePe, or Paytm.
              </div>
            )}

            {paymentInstructions?.instructions && (
              <div style={{ marginTop: 10, padding: '6px 10px', borderRadius: 8, background: '#F3F4F6', fontSize: 11, color: '#6B7280' }}>
                ℹ️ {paymentInstructions.instructions}
              </div>
            )}

            {paymentInstructions?.qrImageUrl && (
              <div style={{ marginTop: 14, textAlign: 'center', padding: 12, background: '#F9FAFB', borderRadius: 12, border: '1px solid #E5E7EB' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>UPI Payment QR Code</div>
                <img src={paymentInstructions.qrImageUrl} alt="UPI Payment QR" style={{ width: 140, height: 140, objectFit: 'contain', margin: '0 auto', display: 'block', borderRadius: 8, border: '1px solid #D1D5DB' }} />
                {paymentInstructions.upiId && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#6B7280' }}>
                    UPI ID: <strong>{paymentInstructions.upiId}</strong>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowInvoiceModal(true)}
              style={{
                marginTop: 14,
                width: '100%',
                background: '#4A0E4E',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                boxShadow: '0 4px 12px rgba(107, 33, 92, 0.2)',
              }}
            >
              <span>🧾</span>
              <span>View / Print Tax Invoice & Package Slip</span>
            </button>
          </div>

          {/* Dedicated Order Cancellation Window */}
          {cancelSuccessMsg && <Notice tone="success">{cancelSuccessMsg}</Notice>}

          {isCancellationWindowOpen ? (
            <div
              style={{
                background: '#FFFDF5',
                borderRadius: 18,
                border: '1.5px solid #FDE68A',
                padding: '20px 22px',
                boxShadow: '0 4px 14px rgba(180, 83, 9, 0.06)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11,
                    fontWeight: 800,
                    color: '#92400E',
                    textTransform: 'uppercase',
                    background: '#FEF3C7',
                    padding: '3px 10px',
                    borderRadius: 999,
                    border: '1px solid #FCD34D',
                  }}
                >
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#16A34A' }} />
                  Cancellation Window Open
                </span>
                <span style={{ fontSize: 11, color: '#B45309', fontWeight: 600 }}>Zero cancellation fee</span>
              </div>

              <h3 style={{ margin: '0 0 6px', fontSize: '1rem', fontWeight: 800, color: '#78350F' }}>
                Cancel this order?
              </h3>
              <p style={{ margin: 0, fontSize: 12, color: '#92400E', lineHeight: 1.5 }}>
                The seller is currently preparing your handcrafted pieces. You can cancel instantly until the package is marked <strong>Ready for Pickup</strong>.
              </p>

              {!showDirectCancel ? (
                <button
                  type="button"
                  onClick={() => setShowDirectCancel(true)}
                  style={{
                    marginTop: 14,
                    width: '100%',
                    background: '#FFFFFF',
                    border: '1.5px solid #DC2626',
                    color: '#DC2626',
                    borderRadius: 10,
                    padding: '10px 16px',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 2px 4px rgba(220, 38, 38, 0.08)',
                  }}
                >
                  ✕ Cancel Order Instantly
                </button>
              ) : (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #FDE68A', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#78350F' }}>
                    Select reason:
                    <select
                      value={directCancelReason}
                      onChange={(e) => setDirectCancelReason(e.target.value)}
                      style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 13 }}
                    >
                      <option value="Changed mind / No longer needed">Changed mind / No longer needed</option>
                      <option value="Ordered by mistake">Ordered by mistake</option>
                      <option value="Incorrect delivery address or contact number">Incorrect delivery address or contact number</option>
                      <option value="Found alternative handcrafted product">Found alternative handcrafted product</option>
                      <option value="Other">Other</option>
                    </select>
                  </label>
                  <input
                    type="text"
                    placeholder="Optional note for artisan..."
                    value={directCancelNote}
                    onChange={(e) => setDirectCancelNote(e.target.value)}
                    style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 13 }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button
                      type="button"
                      disabled={cancellingDirect}
                      onClick={() => void handleDirectCancel()}
                      style={{
                        flex: 1,
                        background: '#DC2626',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: 8,
                        padding: '9px 16px',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: cancellingDirect ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {cancellingDirect ? 'Cancelling…' : 'Confirm Cancellation'}
                    </button>
                    <button
                      type="button"
                      className="button button-outline"
                      style={{ padding: '8px 14px', fontSize: 13 }}
                      onClick={() => setShowDirectCancel(false)}
                    >
                      Keep
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : isCancelled ? (
            <div style={{ padding: '16px 20px', borderRadius: 16, background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B' }}>
              <strong style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                <span>✕</span> Order Cancelled
              </strong>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#B91C1C' }}>
                This order has been cancelled {item.cancellationReason ? `(${item.cancellationReason})` : ''}. Any applicable refund has been queued back to your source account.
              </p>
            </div>
          ) : !isDelivered ? (
            <div style={{ padding: '16px 20px', borderRadius: 16, background: '#F9FAFB', border: '1px solid #E5E7EB', color: '#4B5563' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#374151' }}>
                <span>🔒</span> Cancellation Window Closed
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6B7280', lineHeight: 1.4 }}>
                This order has been sealed and marked <strong>Ready for Pickup</strong> (or assigned to a delivery partner). Instant cancellation is closed.
              </p>
              {item.cancellationRequest?.requestedAt ? (
                <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 8, background: '#EFF6FF', fontSize: 12, color: '#1E40AF' }}>
                  Cancellation review request: <strong>{item.cancellationRequest.decision || 'Under team review'}</strong>
                </div>
              ) : (
                <button
                  type="button"
                  className="button button-outline"
                  style={{ marginTop: 10, width: '100%', fontSize: 12, padding: '7px 12px' }}
                  onClick={() => void cancel()}
                >
                  Request City Admin Cancellation Review
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Return & Dispute Panel */}
      <CustomerReturnAndCancelPanel order={item} onOrderUpdated={(updated) => order.setData(updated)} />

      {/* Meesho 2-in-1 Shipping Label & Tax Invoice Slip Modal */}
      {showInvoiceModal && (
        <MeeshoSlipModal order={item} onClose={() => setShowInvoiceModal(false)} />
      )}
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
          <img src="/images/esakhi-logo-transparent.png" alt="" />
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
            <thead><tr><th>City</th><th>State</th><th>City Admin</th><th>Sellers</th><th>Partners</th><th>Zones</th><th>Orders</th><th>Configured</th><th>Service Zones Action</th></tr></thead>
            <tbody>{citiesResult.data.map((record) => (
              <tr key={record.city}>
                <td><Link to={`/super-admin/cities/${encodeURIComponent(record.city)}`}><strong>{record.city}</strong></Link></td>
                <td>{record.state || '—'}</td>
                <td>{record.cityAdminName || 'Unassigned'} <small>{record.cityAdminCount} account(s)</small></td>
                <td>{record.sellerCount}</td><td>{record.deliveryPartnerCount}</td><td>{record.serviceZoneCount}</td><td>{record.orderCount}</td>
                <td><StatusBadge value={record.configured ? 'active' : 'observed'} /></td>
                <td>
                  <Link
                    to={`/super-admin/cities/${encodeURIComponent(record.city)}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      color: '#0284c7',
                      fontWeight: 600,
                      fontSize: '12px',
                      textDecoration: 'none',
                      background: '#f0f9ff',
                      padding: '4px 10px',
                      borderRadius: '4px',
                      border: '1px solid #bae6fd'
                    }}
                  >
                    Manage &amp; Add Zones ({record.serviceZoneCount}) →
                  </Link>
                </td>
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

  // Service Zone Modal State
  const [zoneModalOpen, setZoneModalOpen] = useState(false);
  const [editingZoneIndex, setEditingZoneIndex] = useState<number | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [coveredLocalitiesInput, setCoveredLocalitiesInput] = useState('');
  const [postalCodesInput, setPostalCodesInput] = useState('470661');
  const [deliveryFeeRupees, setDeliveryFeeRupees] = useState('29');
  const [savingZone, setSavingZone] = useState(false);
  const [zoneActionError, setZoneActionError] = useState('');

  const openAddZone = () => {
    setEditingZoneIndex(null);
    setZoneName('');
    setCoveredLocalitiesInput('');
    setPostalCodesInput('470661');
    setDeliveryFeeRupees('29');
    setZoneActionError('');
    setZoneModalOpen(true);
  };

  const openEditZone = (zone: Locality, index: number) => {
    setEditingZoneIndex(index);
    setZoneName(zone.name);
    setCoveredLocalitiesInput((zone.coveredLocalities || []).join(', '));
    setPostalCodesInput((zone.postalCodes || []).join(', '));
    setDeliveryFeeRupees(zone.deliveryFeePaise !== undefined ? (zone.deliveryFeePaise / 100).toFixed(0) : '29');
    setZoneActionError('');
    setZoneModalOpen(true);
  };

  const handleSaveZone = async (e: FormEvent) => {
    e.preventDefault();
    if (!zoneName.trim()) {
      setZoneActionError('Zone / Sector name is required.');
      return;
    }
    setSavingZone(true);
    setZoneActionError('');

    const localities = coveredLocalitiesInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const postalCodes = postalCodesInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const feePaise = Math.round(parseFloat(deliveryFeeRupees || '0') * 100);

    try {
      if (editingZoneIndex !== null) {
        await api.superAdminUpdateCityZone(city, editingZoneIndex, {
          name: zoneName.trim(),
          coveredLocalities: localities.length ? localities : [zoneName.trim()],
          postalCodes: postalCodes.length ? postalCodes : ['470661'],
          deliveryFeePaise: isNaN(feePaise) ? 2900 : feePaise,
        });
      } else {
        await api.superAdminAddCityZone(city, {
          name: zoneName.trim(),
          coveredLocalities: localities.length ? localities : [zoneName.trim()],
          postalCodes: postalCodes.length ? postalCodes : ['470661'],
          deliveryFeePaise: isNaN(feePaise) ? 2900 : feePaise,
        });
      }
      setZoneModalOpen(false);
      void result.reload(false);
    } catch (err) {
      setZoneActionError(err instanceof Error ? err.message : 'Failed to save service zone.');
    } finally {
      setSavingZone(false);
    }
  };

  const handleDeleteZone = async (index: number, name: string) => {
    if (!window.confirm(`Are you sure you want to delete service zone "${name}"?`)) return;
    try {
      await api.superAdminDeleteCityZone(city, index);
      void result.reload(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete service zone.');
    }
  };

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
      <section className="super-admin-panel">
        <div className="super-admin-panel-heading">
          <div>
            <h2>Service zones</h2>
            <p>Configured delivery sectors, covered localities, and flat delivery fees for {record.city}.</p>
          </div>
          <button
            type="button"
            className="super-admin-btn-primary"
            onClick={openAddZone}
            style={{
              background: '#0f172a',
              color: '#ffffff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>+</span> Add Service Zone
          </button>
        </div>
        {record.serviceableLocalities.length ? (
          <div className="super-admin-table-wrap">
            <table className="super-admin-table">
              <thead>
                <tr>
                  <th>Zone / Sector</th>
                  <th>Covered Localities</th>
                  <th>Postal codes</th>
                  <th>Delivery fee</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {record.serviceableLocalities.map((zone, idx) => (
                  <tr key={`${zone.name}-${idx}`}>
                    <td><strong>{zone.name}</strong></td>
                    <td>
                      {zone.coveredLocalities && zone.coveredLocalities.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {zone.coveredLocalities.map((loc) => (
                            <span
                              key={loc}
                              style={{
                                background: '#f1f5f9',
                                border: '1px solid #cbd5e1',
                                borderRadius: '4px',
                                padding: '2px 8px',
                                fontSize: '12px',
                                color: '#1e293b'
                              }}
                            >
                              {loc}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: '#64748b' }}>{zone.name}</span>
                      )}
                    </td>
                    <td>{zone.postalCodes.join(', ') || '470661'}</td>
                    <td>{zone.deliveryFeePaise === undefined ? '₹29.00' : formatMoney(zone.deliveryFeePaise)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => openEditZone(zone, idx)}
                          style={{ color: '#0284c7', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void handleDeleteZone(idx, zone.name)}
                          style={{ color: '#dc2626', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="super-admin-empty">No serviceable localities are configured for this city. Click "+ Add Service Zone" to create one.</div>
        )}
      </section>

      {/* ADD / EDIT SERVICE ZONE MODAL */}
      {zoneModalOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.65)',
          zIndex: 9999,
          display: 'grid',
          placeItems: 'center',
          padding: '20px'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '12px',
            maxWidth: '560px',
            width: '100%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            overflow: 'hidden'
          }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '17px', color: '#0f172a' }}>
                {editingZoneIndex !== null ? `Edit Service Zone: ${zoneName}` : `Add New Service Zone for ${record.city}`}
              </h3>
              <button
                type="button"
                onClick={() => setZoneModalOpen(false)}
                style={{ border: 'none', background: 'transparent', fontSize: '18px', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveZone} style={{ padding: '24px' }}>
              {zoneActionError && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 14px', borderRadius: '6px', fontSize: '13px', marginBottom: '16px' }}>
                  {zoneActionError}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', textTransform: 'uppercase', marginBottom: '6px' }}>
                    Zone / Sector Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={zoneName}
                    onChange={(e) => setZoneName(e.target.value)}
                    placeholder="e.g. Damoh Civil Lines & Station Area"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
                  />
                  <small style={{ color: '#64748b', fontSize: '12px', marginTop: '4px', display: 'block' }}>
                    Descriptive name of the operational zone or delivery sector.
                  </small>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', textTransform: 'uppercase', marginBottom: '6px' }}>
                    Covered Localities (Comma Separated) *
                  </label>
                  <textarea
                    rows={3}
                    value={coveredLocalitiesInput}
                    onChange={(e) => setCoveredLocalitiesInput(e.target.value)}
                    placeholder="e.g. Civil Lines, Station Road, Collectorate, Mission Compound, Police Lines"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
                  />
                  <small style={{ color: '#64748b', fontSize: '12px', marginTop: '4px', display: 'block' }}>
                    Comma-separated list of colonies, mohallas, and landmarks inside this delivery sector.
                  </small>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', textTransform: 'uppercase', marginBottom: '6px' }}>
                      Postal / PIN Codes
                    </label>
                    <input
                      type="text"
                      value={postalCodesInput}
                      onChange={(e) => setPostalCodesInput(e.target.value)}
                      placeholder="e.g. 470661"
                      style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', textTransform: 'uppercase', marginBottom: '6px' }}>
                      Express Delivery Fee (₹)
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={deliveryFeeRupees}
                      onChange={(e) => setDeliveryFeeRupees(e.target.value)}
                      placeholder="e.g. 29"
                      style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
                <button
                  type="button"
                  onClick={() => setZoneModalOpen(false)}
                  disabled={savingZone}
                  style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: '#475569' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingZone}
                  style={{ padding: '8px 20px', borderRadius: '6px', border: 'none', background: '#0f172a', color: '#ffffff', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
                >
                  {savingZone ? 'Saving...' : editingZoneIndex !== null ? 'Update Zone' : 'Create Zone'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
  const [form, setForm] = useState({
    phone: '',
    name: '',
    email: '',
    city: '',
    residentialAddress: '',
    aadhaarNumber: '',
    compensationRate: '5% commission on completed city orders',
    payerText: 'Super Admin / eSakhi Platform',
    accountHolderName: '',
    accountNumber: '',
    confirmAccountNumber: '',
    ifscCode: '',
    bankName: '',
    upiId: '',
  });
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

    if (!form.phone.trim()) {
      setError('Please enter a valid phone number.');
      setSaving(false); return;
    }
    if (!form.name.trim()) {
      setError('City administrator full name is required.');
      setSaving(false); return;
    }
    if (!form.city.trim()) {
      setError('Assigned operational city is required.');
      setSaving(false); return;
    }
    if (!form.residentialAddress.trim()) {
      setError('Residential / Living address of the City Admin is required.');
      setSaving(false); return;
    }
    if (!form.accountHolderName.trim()) {
      setError('Bank Account Holder Name is mandatory.');
      setSaving(false); return;
    }
    const cleanAcc = form.accountNumber.trim();
    if (!/^\d{9,18}$/.test(cleanAcc)) {
      setError('Bank Account Number must be between 9 and 18 digits.');
      setSaving(false); return;
    }
    if (cleanAcc !== form.confirmAccountNumber.trim()) {
      setError('Bank Account Numbers do not match. Please verify double-entry.');
      setSaving(false); return;
    }
    const cleanIfsc = form.ifscCode.trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIfsc)) {
      setError('Enter a valid 11-character Indian IFSC code (e.g. SBIN0000358).');
      setSaving(false); return;
    }
    if (!form.bankName.trim()) {
      setError('Bank Name (e.g. State Bank of India, HDFC Bank) is mandatory.');
      setSaving(false); return;
    }

    try {
      await api.createCityAdmin({
        phone: form.phone,
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        city: form.city.trim(),
        residentialAddress: form.residentialAddress.trim() || undefined,
        aadhaarNumber: form.aadhaarNumber.trim() || undefined,
        compensationRate: form.compensationRate.trim() || undefined,
        payerText: form.payerText.trim() || undefined,
        bankAccount: {
          accountHolderName: form.accountHolderName.trim(),
          accountNumber: cleanAcc,
          ifscCode: cleanIfsc,
          bankName: form.bankName.trim(),
          upiId: form.upiId.trim() || undefined,
        },
      });
      setForm({
        phone: '',
        name: '',
        email: '',
        city: form.city,
        residentialAddress: '',
        aadhaarNumber: '',
        compensationRate: '5% commission on completed city orders',
        payerText: 'Super Admin / eSakhi Platform',
        accountHolderName: '',
        accountNumber: '',
        confirmAccountNumber: '',
        ifscCode: '',
        bankName: '',
        upiId: '',
      });
      setMessage('City administrator appointed successfully with verified identity and banking coordinates.');
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
        <div><p className="super-admin-eyebrow">Operations</p><h1>City Administrators</h1><p>Add and appoint City Admin accounts with mandatory address, ID, bank details, and operational city scope.</p></div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      <div className="super-admin-lower-grid">
        <section className="super-admin-panel super-admin-recent-orders">
          <div className="super-admin-panel-heading"><div><h2>Add city admin</h2><p>Provision a user with City Admin role, verified credentials, and locked banking coordinates.</p></div></div>
          <form className="stack-form" onSubmit={(event) => void submit(event)}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <label className="field"><span>Phone number (Contact / Login) *</span><input required aria-label="City admin phone" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="+91xxxxxxxxxx" /></label>
              <label className="field"><span>Full Name (As per Govt ID) *</span><input required aria-label="City admin name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Ramesh Patel" /></label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <label className="field"><span>Email (Optional)</span><input aria-label="City admin email" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="admin@city.in" /></label>
              <label className="field"><span>Assigned City Scope *</span><input aria-label="Assigned city" list="super-admin-city-options" value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} required placeholder="e.g. Damoh" /></label>
            </div>
            <datalist id="super-admin-city-options">{citiesResult.data?.map((record) => <option key={record.city} value={record.city} />)}</datalist>

            {/* IDENTITY & ADDRESS DETAILS */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginTop: '4px' }}>
              <label className="field"><span>Aadhaar / Government ID Number</span><input aria-label="Aadhaar number" value={form.aadhaarNumber} onChange={(event) => setForm((current) => ({ ...current, aadhaarNumber: event.target.value }))} placeholder="e.g. 1234 5678 9012" /></label>
              <label className="field"><span>Who Is Paying (Disbursing Entity)</span><input aria-label="Paying entity" value={form.payerText} onChange={(event) => setForm((current) => ({ ...current, payerText: event.target.value }))} placeholder="Super Admin / eSakhi Platform" /></label>
            </div>

            <label className="field">
              <span>Residential / Living Address (Where person lives) *</span>
              <input required aria-label="Residential address" value={form.residentialAddress} onChange={(event) => setForm((current) => ({ ...current, residentialAddress: event.target.value }))} placeholder="e.g. House No. 12, Civil Lines, Near Circuit House, Damoh" />
            </label>

            <label className="field">
              <span>Payment Structure / Pay Terms (What they get)</span>
              <input aria-label="Compensation terms" value={form.compensationRate} onChange={(event) => setForm((current) => ({ ...current, compensationRate: event.target.value }))} placeholder="e.g. 5% commission on completed city orders" />
            </label>

            {/* MANDATORY BANK DETAILS CARD */}
            <div style={{ marginTop: '14px', padding: '14px 16px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, fontSize: '13px', color: '#0f172a', marginBottom: '12px' }}>
                <span>🏦</span> MANDATORY DISBURSEMENT BANK ACCOUNT
              </div>
              <p style={{ fontSize: '12px', color: '#64748b', marginTop: 0, marginBottom: '12px' }}>
                City Admin will receive their compensation into this account. Profile is locked as read-only for City Admins to prevent unauthorized edits.
              </p>
              <label className="field" style={{ marginBottom: '10px' }}>
                <span>Account Holder Name (As per Bank Passbook) *</span>
                <input required value={form.accountHolderName} onChange={(e) => setForm((c) => ({ ...c, accountHolderName: e.target.value }))} placeholder="e.g. Ramesh Patel" />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '10px' }}>
                <label className="field">
                  <span>Bank Name *</span>
                  <input required value={form.bankName} onChange={(e) => setForm((c) => ({ ...c, bankName: e.target.value }))} placeholder="e.g. State Bank of India" />
                </label>
                <label className="field">
                  <span>IFSC Code (11 Chars) *</span>
                  <input required maxLength={11} style={{ textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700 }} value={form.ifscCode} onChange={(e) => setForm((c) => ({ ...c, ifscCode: e.target.value.toUpperCase().trim() }))} placeholder="e.g. SBIN0000358" />
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '10px' }}>
                <label className="field">
                  <span>Bank Account Number *</span>
                  <input required type="password" inputMode="numeric" maxLength={18} value={form.accountNumber} onChange={(e) => setForm((c) => ({ ...c, accountNumber: e.target.value.replace(/\D/g, '') }))} placeholder="Enter account number" />
                </label>
                <label className="field">
                  <span>Confirm Account Number *</span>
                  <input required inputMode="numeric" maxLength={18} value={form.confirmAccountNumber} onChange={(e) => setForm((c) => ({ ...c, confirmAccountNumber: e.target.value.replace(/\D/g, '') }))} placeholder="Re-type to match" />
                </label>
              </div>
              <label className="field" style={{ marginBottom: 0 }}>
                <span>UPI VPA ID (Optional — e.g. name@okhdfcbank)</span>
                <input value={form.upiId} onChange={(e) => setForm((c) => ({ ...c, upiId: e.target.value.trim() }))} placeholder="Optional for fast UPI QR payments" />
              </label>
            </div>

            <button style={{ marginTop: '14px' }} className="button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create City Admin with Verified Details'}</button>
          </form>
        </section>
        <section className="super-admin-panel super-admin-attention-panel">
          <div className="super-admin-panel-heading"><div><h2>City admin directory</h2><p>All City Admin accounts and linked disbursement accounts.</p></div></div>
          {result.error && <div className="super-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
          {result.loading ? <Loading label="Loading city administrators…" /> : result.data?.data.length ? <div className="super-admin-table-wrap"><table className="super-admin-table"><thead><tr><th>Name</th><th>Phone</th><th>City</th><th>Disbursement Bank</th><th>Status</th><th>Actions</th></tr></thead><tbody>{result.data.data.map((admin) => <tr key={getId(admin)}><td><Link to={`/super-admin/city-administrators/${getId(admin)}`}>{admin.name || 'City Admin'}</Link></td><td>{admin.phoneE164 || admin.phone || '—'}</td><td>{admin.assignedCity ? <Link to={`/super-admin/cities/${encodeURIComponent(admin.assignedCity)}`}>{admin.assignedCity}</Link> : '—'}</td><td>{admin.bankAccount?.accountNumber ? <span style={{ fontSize: '12px', fontWeight: 600, color: '#047857' }}>✓ {admin.bankAccount.bankName || 'Bank'} (••••{admin.bankAccount.accountNumber.slice(-4)})</span> : <span style={{ fontSize: '12px', color: '#b45309', fontWeight: 600 }}>⚠️ Pending Setup</span>}</td><td><StatusBadge value={admin.status ?? 'active'} /></td><td><button className="text-button" onClick={() => void toggleStatus(admin)}>{admin.status === 'disabled' ? 'Activate' : 'Disable'}</button></td></tr>)}</tbody></table></div> : <div className="super-admin-empty">No city administrators have been created yet.</div>}
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
      <div className="super-admin-page-heading"><div><p className="super-admin-eyebrow"><Link to="/super-admin/city-administrators">City Administrators</Link> / Profile</p><h1>{admin.name || 'City Administrator'}</h1><p>City-scoped administrator account details and banking coordinates.</p></div></div>
      <div className="super-admin-metrics">
        <SuperAdminMetric label="Role" value="City Admin" icon="administrators" />
        <SuperAdminMetric label="Assigned city" value={admin.assignedCity || 'Unassigned'} icon="cities" />
        <SuperAdminMetric label="Account status" value={admin.status || 'active'} icon="security" />
        <SuperAdminMetric label="Registered" value={admin.createdAt ? new Date(admin.createdAt).toLocaleDateString('en-IN') : '—'} icon="overview" />
      </div>
      <section className="super-admin-panel super-admin-profile-panel">
        <div className="super-admin-panel-heading"><div><h2>Administrator profile</h2><p>Identity and scope recorded on the account.</p></div></div>
        <dl className="super-admin-definition-list">
          <div><dt>Phone (Login &amp; Verified)</dt><dd><strong>{admin.phoneE164 || admin.phone || '—'}</strong></dd></div>
          <div><dt>Email</dt><dd>{admin.email || '—'}</dd></div>
          <div><dt>Living / Residence Address</dt><dd>{admin.residentialAddress || 'Not recorded'}</dd></div>
          <div><dt>Aadhaar / ID Card</dt><dd><code>{admin.aadhaarNumber || 'Not recorded'}</code></dd></div>
          <div><dt>Assigned City Jurisdiction</dt><dd>{admin.assignedCity ? <Link to={`/super-admin/cities/${encodeURIComponent(admin.assignedCity)}`}>{admin.assignedCity}</Link> : 'Not assigned'}</dd></div>
          <div><dt>Payment Terms (Pay)</dt><dd><strong>{admin.compensationRate || '5% commission on completed city orders'}</strong></dd></div>
          <div><dt>Who Is Paying</dt><dd>{admin.payerText || 'Super Admin / eSakhi Platform'}</dd></div>
          <div><dt>Account ID</dt><dd><code>{getId(admin)}</code></dd></div>
        </dl>
      </section>

      {/* VERIFIED BANKING COORDINATES (READ ONLY FOR CITY ADMIN) */}
      <section className="super-admin-panel" style={{ marginTop: '20px' }}>
        <div className="super-admin-panel-heading">
          <div>
            <h2>Verified Disbursement Bank Account</h2>
            <p>Non-tamperable banking coordinates where 5% city commissions are disbursed. Read-only for City Admin.</p>
          </div>
        </div>
        {admin.bankAccount?.accountNumber ? (
          <dl className="super-admin-definition-list">
            <div><dt>Account Holder</dt><dd><strong>{admin.bankAccount.accountHolderName || admin.name}</strong></dd></div>
            <div><dt>Bank Name</dt><dd>{admin.bankAccount.bankName || 'State Bank of India'}</dd></div>
            <div><dt>Account Number</dt><dd><code>••••••••{admin.bankAccount.accountNumber.slice(-4)}</code></dd></div>
            <div><dt>IFSC Code</dt><dd><code>{admin.bankAccount.ifscCode}</code></dd></div>
            <div><dt>UPI VPA ID</dt><dd>{admin.bankAccount.upiId || '— (IMPS Mode)'}</dd></div>
            <div><dt>Verification Status</dt><dd><span style={{ color: '#047857', fontWeight: 700 }}>✓ Verified by Super Admin</span></dd></div>
          </dl>
        ) : (
          <div style={{ padding: '16px', background: '#fef3c7', borderRadius: '8px', color: '#92400e', fontWeight: 600, fontSize: '13px' }}>
            ⚠️ No banking coordinates recorded yet. Payouts for this City Admin cannot proceed until valid bank details are updated.
          </div>
        )}
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
  return <SuperAdminSupportDeskPage />;
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
  return <SuperAdminAssistedPayoutDeskPage initialTab="sellers" />;
}

function SuperAdminPayoutsPage(): ReactNode {
  return <SuperAdminAssistedPayoutDeskPage initialTab="partners" />;
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            <Link
              to="/super-admin/support"
              style={{
                textDecoration: 'none',
                background: 'linear-gradient(135deg, #312e81 0%, #4338ca 100%)',
                color: '#ffffff',
                padding: '20px 24px',
                borderRadius: '14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: '0 4px 12px rgba(49, 46, 129, 0.2)',
              }}
            >
              <div>
                <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', color: '#c7d2fe', textTransform: 'uppercase' }}>
                  City Escalations Desk
                </span>
                <div style={{ fontSize: '18px', fontWeight: 800, marginTop: '2px', color: '#ffffff' }}>
                  Support & Area Disputes
                </div>
                <div style={{ fontSize: '12px', color: '#e0e7ff', marginTop: '4px' }}>
                  Arbitrate City Admin escalations, customer return claims & delivery disputes ➔
                </div>
              </div>
              <div style={{ fontSize: '28px', backgroundColor: 'rgba(255,255,255,0.15)', padding: '10px 16px', borderRadius: '12px' }}>
                🛡️
              </div>
            </Link>

            <Link
              to="/super-admin/settlements"
              style={{
                textDecoration: 'none',
                background: 'linear-gradient(135deg, #064e3b 0%, #047857 100%)',
                color: '#ffffff',
                padding: '20px 24px',
                borderRadius: '14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: '0 4px 12px rgba(6, 78, 59, 0.2)',
              }}
            >
              <div>
                <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', color: '#a7f3d0', textTransform: 'uppercase' }}>
                  Assisted Payout Desk
                </span>
                <div style={{ fontSize: '18px', fontWeight: 800, marginTop: '2px', color: '#ffffff' }}>
                  Financial Settlements & Salaries
                </div>
                <div style={{ fontSize: '12px', color: '#d1fae5', marginTop: '4px' }}>
                  Disburse locked 5% City Admin fees, 90% artisan shares & ₹29 rider trips via UPI/Bank ➔
                </div>
              </div>
              <div style={{ fontSize: '28px', backgroundColor: 'rgba(255,255,255,0.15)', padding: '10px 16px', borderRadius: '12px' }}>
                💳
              </div>
            </Link>
          </div>
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
        <div><p className="super-admin-eyebrow">Operations</p><h1>Orders & Assignments</h1><p>Track real-time customer orders, assigned delivery riders, and fulfilment states across all cities.</p></div>
      </div>
      {result.error && <div className="super-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
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

function renderOrderPaymentBadge(order: {
  paymentMethod: string;
  paymentStatus: string;
  doorstepPayment?: {
    mode?: string;
    remittedToCityAdmin?: boolean;
    remittedReceiptNumber?: string;
    upiUtr?: string;
  };
  fulfilmentStatus?: string;
}): ReactNode {
  const isPrepaid = order.paymentMethod !== 'cash';
  if (isPrepaid) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start' }}>
        <span style={{
          background: '#dcfce7',
          color: '#15803d',
          fontWeight: 700,
          fontSize: '11px',
          padding: '2px 8px',
          borderRadius: '999px',
          letterSpacing: '0.03em',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px'
        }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#16a34a' }} />
          PREPAID · UPI
        </span>
        <small style={{ color: '#16a34a', fontWeight: 600, fontSize: '11px' }}>Payment Confirmed</small>
      </div>
    );
  }

  const isDigitalDoorstep = order.doorstepPayment?.mode === 'upi_qr' || order.doorstepPayment?.mode === 'prepaid_online';
  const isRemitted = Boolean(order.doorstepPayment?.remittedToCityAdmin);
  const isDelivered = order.fulfilmentStatus === 'delivered' || order.fulfilmentStatus === 'completed';

  if (isDigitalDoorstep) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start' }}>
        <span style={{
          background: '#e0f2fe',
          color: '#0369a1',
          fontWeight: 700,
          fontSize: '11px',
          padding: '2px 8px',
          borderRadius: '999px',
          letterSpacing: '0.03em',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px'
        }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#0284c7' }} />
          COD · DIGITAL UPI
        </span>
        <small style={{ color: '#0284c7', fontWeight: 600, fontSize: '11px' }}>
          Paid via QR at Doorstep (₹0 Cash)
        </small>
      </div>
    );
  }

  if (isRemitted) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start' }}>
        <span style={{
          background: '#ede9fe',
          color: '#6d28d9',
          fontWeight: 700,
          fontSize: '11px',
          padding: '2px 8px',
          borderRadius: '999px',
          letterSpacing: '0.03em',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px'
        }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#7c3aed' }} />
          COD · CASH SETTLED
        </span>
        <small style={{ color: '#6d28d9', fontWeight: 600, fontSize: '11px' }}>
          {order.doorstepPayment?.remittedReceiptNumber ? `Voucher: ${order.doorstepPayment.remittedReceiptNumber}` : 'Remitted to Hub'}
        </small>
      </div>
    );
  }

  if (isDelivered) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start' }}>
        <span style={{
          background: '#fef3c7',
          color: '#b45309',
          fontWeight: 700,
          fontSize: '11px',
          padding: '2px 8px',
          borderRadius: '999px',
          letterSpacing: '0.03em',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px'
        }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f59e0b' }} />
          COD CASH · WITH FLEET
        </span>
        <small style={{ color: '#d97706', fontWeight: 600, fontSize: '11px' }}>
          Pending Hub Drop (PIN)
        </small>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start' }}>
      <span style={{
        background: '#f1f5f9',
        color: '#475569',
        fontWeight: 700,
        fontSize: '11px',
        padding: '2px 8px',
        borderRadius: '999px',
        letterSpacing: '0.03em',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px'
      }}>
        COD · DUE ON DELIVERY
      </span>
      <small style={{ color: '#64748b', fontSize: '11px' }}>Collect at Doorstep</small>
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
            <td>{renderOrderPaymentBadge(order)}</td>
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
      { label: 'Cash Remittance Desk', icon: 'payments', path: '/city-admin/remittance' },
      { label: 'Delivery Partners', icon: 'delivery', path: '/city-admin/delivery-partners' },
    ],
  },
  {
    label: 'Account',
    items: [
      { label: 'My Profile', icon: 'roles', path: '/city-admin/profile' },
    ],
  },
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
        <Link to="/city-admin" className="city-admin-brand"><img src="/images/esakhi-logo-transparent.png" alt="" /><span>eSakhi<small>CITY ADMIN</small></span></Link>
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
          <span>
            <strong>{displayName}</strong>
            <small>City Administrator</small>
          </span>
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
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.4rem 0.85rem', fontSize: '0.8rem', borderRadius: '6px' }}
              >
                <span aria-hidden="true">🔔</span> Ready for Pickup ({unassignedReadyOrders.length}) — Assign Partner
              </button>
            )}
            <span className="city-admin-live-badge">
              <span className="pulse-dot-green" style={{ width: '7px', height: '7px' }} />
              Live Operations · {user?.assignedCity ?? 'Damoh'}
            </span>
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
                border: '2px solid var(--brand, #4A0E4E)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <p className="city-admin-eyebrow" style={{ color: 'var(--brand, #4A0E4E)', fontWeight: 700 }}>🔔 SELLER READY FOR PICKUP NOTIFICATION</p>
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
  const [raiseTicketModalOpen, setRaiseTicketModalOpen] = useState(false);
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
  const activePartnersCount = metrics?.activeDeliveryPartners ?? (partners.data?.data.filter((p) => p.status === 'active' && p.isOnline).length || 4);
  const partnerAppsCount = metrics?.partnerApplications ?? 0;
  const openTicketsCount = metrics?.openSupportTickets ?? 0;

  return (
    <div className="city-admin-page">
      <div className="city-admin-page-heading">
        <div>
          <p className="city-admin-eyebrow">{dashboard?.city ?? 'City'} CITY OPERATIONS</p>
          <h1>City Operations Overview</h1>
          <p>Monitor city-scoped orders and delivery activity for your assigned city.</p>
        </div>
        <div className="city-admin-page-actions">
          <button
            className="city-admin-secondary-button"
            type="button"
            onClick={() => setRaiseTicketModalOpen(true)}
          >
            📢 Escalate to Super Admin
          </button>
          <Link className="city-admin-primary-button" to="/city-admin/orders">
            View all orders <span aria-hidden="true">›</span>
          </Link>
        </div>
      </div>
      {result.error && <div className="city-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
      <CityAdminRaiseTicketModal isOpen={raiseTicketModalOpen} onClose={() => setRaiseTicketModalOpen(false)} onSubmitted={() => void result.reload(false)} />
      {result.loading ? <Loading label="Loading city operations…" /> : dashboard && metrics ? (
        <>
          <div className="city-admin-metrics">
            <CityAdminMetric label="Today’s Orders" value={metrics.todayOrders} icon="orders" to="/city-admin/orders" />
            <CityAdminMetric label="Awaiting Assignment" value={metrics.awaitingAssignment} icon="delivery" alert={metrics.awaitingAssignment > 0} to="/city-admin/orders?unassignedOnly=true" />
            <CityAdminMetric label="Out for Delivery" value={metrics.outForDelivery} icon="providers" to="/city-admin/orders?fulfilmentStatus=out_for_delivery" />
            <CityAdminMetric label="Delivered Today" value={metrics.deliveredToday} icon="overview" to="/city-admin/orders?fulfilmentStatus=delivered" />
            <CityAdminMetric label="Active Fleet" value={`${activePartnersCount} Online`} icon="delivery" to="/city-admin/delivery-partners" />
            <CityAdminMetric label="Partner Applications" value={partnerAppsCount} icon="administrators" alert={partnerAppsCount > 0} to="/city-admin/delivery-partners" />
            <CityAdminMetric label="Registered Sellers" value={(metrics as any).totalSellers ?? metrics.sellerApplicationsToReview ?? 0} icon="sellers" to="/city-admin/sellers" />
            <CityAdminMetric label="Open Support Tickets" value={openTicketsCount} icon="support" alert={openTicketsCount > 0} />
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

          <div className="city-admin-lower-grid">
            <section className="city-admin-panel city-admin-recent">
              <div className="city-admin-panel-heading"><div><h2>Recent orders</h2><p>Latest marketplace orders in {dashboard.city}</p></div><Link to="/city-admin/orders">View all <span aria-hidden="true">→</span></Link></div>
              {dashboard.recentOrders.length ? <CityAdminOrderTable orders={dashboard.recentOrders} /> : <div className="city-admin-empty">No orders have been recorded for this city yet.</div>}
            </section>
            <section className="city-admin-panel">
              <div className="city-admin-panel-heading">
                <div>
                  <h2>Assignment exceptions</h2>
                  <p>Orders needing manual attention</p>
                </div>
                <Link to="/city-admin/orders?unassignedOnly=true">View queue</Link>
              </div>
              {dashboard.assignmentExceptions.length ? (
                <div className="city-admin-exceptions">
                  {dashboard.assignmentExceptions.map((exception) => (
                    <div className="city-admin-exception" key={exception._id}>
                      <span className="city-admin-exception-mark">!</span>
                      <span>
                        <Link to={`/city-admin/orders/${exception._id}`}>
                          <strong>#{exception.orderReference} · {exception.fulfilmentStatus === 'ready_for_pickup' ? 'Ready for pickup — Assign partner' : 'Awaiting assignment'}</strong>
                        </Link>
                        <small>{exception.address?.locality ?? 'Locality not recorded'} · Created {formatElapsed(exception.createdAt)} ago</small>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="city-admin-empty">No unassigned delivery orders need attention.</div>
              )}
              <div className="city-admin-queue-summary">
                <Link to="/city-admin/orders?paymentStatus=pending_verification"><span>Payments awaiting review</span><strong>{metrics.paymentsToReview}</strong></Link>
                <Link to="/city-admin/orders"><span>Orders needing fulfilment action</span><strong>{metrics.ordersNeedingAction}</strong></Link>
              </div>
            </section>
          </div>
          <p className="city-admin-data-note">
            Counts use the assigned city recorded for your account and the city on each delivery address.
          </p>
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

  const data = result.data;
  const admin = data?.assignedAdministrator;

  return (
    <div className="city-admin-page">
      <div className="city-admin-page-heading">
        <div>
          <p className="city-admin-eyebrow">Local Operations · {data?.city ?? 'Damoh'}</p>
          <h1>My Service Zones</h1>
          <p>Operational jurisdiction, assigned city administrator, and serviceable delivery sectors.</p>
        </div>
        <button className="city-admin-secondary-button" type="button" onClick={() => setRequestOpen((open) => !open)}>
          <span>✏️</span> Request Zone Change
        </button>
      </div>

      {result.error && <div className="city-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
      {error && <div className="city-admin-error" role="alert">{error}</div>}
      {message && <Notice tone="success">{message}</Notice>}

      {requestOpen && (
        <form className="city-admin-panel city-admin-zone-request" style={{ marginBottom: '24px' }} onSubmit={(event) => void submitChangeRequest(event)}>
          <div className="city-admin-panel-heading">
            <div>
              <h2>Request a service-zone change</h2>
              <p>Your request will be submitted directly to Super Admin for approval.</p>
            </div>
          </div>
          <div style={{ padding: '20px' }}>
            <label className="field">
              <span>Describe the requested change</span>
              <textarea
                required
                minLength={10}
                maxLength={1000}
                rows={4}
                value={requestText}
                onChange={(event) => setRequestText(event.target.value)}
                placeholder="Include the locality, PIN code, and the modification requested."
              />
            </label>
            <div className="city-admin-zone-request-actions" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '14px' }}>
              <button className="city-admin-secondary-button" type="button" disabled={saving} onClick={() => setRequestOpen(false)}>Cancel</button>
              <button className="city-admin-primary-button" type="submit" disabled={saving}>{saving ? 'Submitting…' : 'Submit request'}</button>
            </div>
          </div>
        </form>
      )}

      {/* 4 EXECUTIVE KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
          <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em', display: 'block' }}>Operational City</span>
          <strong style={{ fontSize: '18px', color: '#0f172a', display: 'block', marginTop: '6px' }}>{data?.city ?? 'Damoh'}, {data?.state ?? 'Madhya Pradesh'}</strong>
          <small style={{ color: '#0284c7', fontWeight: 600, display: 'block', marginTop: '4px' }}>Active Platform Hub</small>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
          <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em', display: 'block' }}>Designated Administrator</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
            <span style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#f3e8f7', color: '#4A0E4E', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: '13px' }}>
              {(admin?.name || 'A').slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong style={{ fontSize: '15px', color: '#0f172a', display: 'block', lineHeight: 1.2 }}>{admin?.name || 'City Administrator'}</strong>
              <small style={{ color: '#64748b', fontSize: '12px' }}>{admin?.phoneE164 || ''}</small>
            </div>
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
          <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em', display: 'block' }}>Coverage Network</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
            <span className="pulse-dot-green" style={{ width: '8px', height: '8px' }} />
            <strong style={{ fontSize: '15px', color: '#059669' }}>Active Service Coverage</strong>
          </div>
          <small style={{ color: '#64748b', fontSize: '12px', display: 'block', marginTop: '4px' }}>Local delivery partner fleet ready</small>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
          <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em', display: 'block' }}>Standard Delivery Fee</span>
          <strong style={{ fontSize: '20px', color: '#0f172a', display: 'block', marginTop: '4px' }}>₹29.00</strong>
          <small style={{ color: '#64748b', fontSize: '12px', display: 'block', marginTop: '2px' }}>Flat express rate across all sectors</small>
        </div>
      </div>

      {/* SERVICEABLE LOCALITIES TABLE */}
      <section className="city-admin-panel" style={{ borderRadius: '12px', border: '1px solid #e2e8f0', background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
        <div className="city-admin-panel-heading" style={{ padding: '18px 20px', borderBottom: '1px solid #f1f5f9' }}>
          <div>
            <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#0f172a', margin: 0 }}>Serviceable Localities &amp; Delivery Sectors</h2>
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13px' }}>Active delivery sectors served by your local delivery partner fleet under PIN 470661.</p>
          </div>
          <span className="city-admin-period">Live Operations</span>
        </div>
        {result.loading ? (
          <Loading label="Loading service zones…" />
        ) : data?.zones && data.zones.length > 0 ? (
          <div className="city-admin-table-wrap">
            <table className="city-admin-table">
              <thead>
                <tr>
                  <th style={{ padding: '12px 20px' }}>Sector / Zone</th>
                  <th style={{ padding: '12px 16px' }}>Covered Localities</th>
                  <th style={{ padding: '12px 16px' }}>PIN Codes</th>
                  <th style={{ padding: '12px 16px' }}>Delivery Fee</th>
                  <th style={{ padding: '12px 16px' }}>Active Orders</th>
                  <th style={{ padding: '12px 20px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.zones.map((zone) => (
                  <tr key={zone.name}>
                    <td style={{ padding: '14px 20px' }}>
                      <strong style={{ fontSize: '14px', color: '#0f172a' }}>{zone.name}</strong>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {zone.coveredLocalities.map((loc) => (
                          <span key={loc} style={{ background: '#f1f5f9', color: '#334155', padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 500 }}>
                            {loc}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <code style={{ background: '#f8fafc', padding: '3px 6px', borderRadius: '4px', border: '1px solid #e2e8f0', fontSize: '12px' }}>
                        {zone.postalCodes.join(', ')}
                      </code>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ fontWeight: 650, color: '#0f172a' }}>
                        {zone.deliveryFeePaise !== undefined ? formatMoney(zone.deliveryFeePaise) : '₹29.00'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ fontWeight: 600, color: '#0f172a' }}>{zone.activeDeliveryCount}</span>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <StatusBadge value={zone.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="city-admin-empty" style={{ padding: '32px 20px' }}>City-wide service coverage is active for {data?.city ?? 'your city'}.</div>
        )}
      </section>
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
  const [paymentFilterTab, setPaymentFilterTab] = useState<'all' | 'prepaid_upi' | 'cod_fleet' | 'cod_doorstep_online' | 'cod_settled'>('all');
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
  const remittance = useLoad(() => api.cityAdminRemittanceSummary(), []);
  const sellers = useLoad(() => api.cityAdminSellers(new URLSearchParams({ page: '1', limit: '100' })), []);
  useEffect(() => {
    const refresh = () => {
      void result.reload(false);
      void remittance.reload(false);
    };
    window.addEventListener('city-admin-order-updated', refresh);
    return () => window.removeEventListener('city-admin-order-updated', refresh);
  }, [result.reload, remittance.reload]);
  const partners = useLoad(() => api.cityAdminDeliveryPartners(1, 100), []);
  useEffect(() => {
    const refresh = () => {
      void partners.reload(false);
    };
    window.addEventListener('city-admin-order-updated', refresh);
    return () => window.removeEventListener('city-admin-order-updated', refresh);
  }, [partners.reload]);

  const rawOrders = result.data?.data || [];
  const prepaidTotalPaise = rawOrders.filter((o) => o.paymentMethod !== 'cash').reduce((acc, o) => acc + o.totalPaise, 0);
  const codOnlineTotalPaise = rawOrders.filter((o) => o.paymentMethod === 'cash' && (o.doorstepPayment?.mode === 'upi_qr' || o.doorstepPayment?.mode === 'prepaid_online')).reduce((acc, o) => acc + o.totalPaise, 0);
  const codSettledTotalPaise = rawOrders.filter((o) => o.paymentMethod === 'cash' && Boolean(o.doorstepPayment?.remittedToCityAdmin)).reduce((acc, o) => acc + o.totalPaise, 0);
  const unremittedCashDisplay = remittance.data?.totalOutstandingRupees || formatMoney(
    rawOrders.filter((o) => o.paymentMethod === 'cash' && !o.doorstepPayment?.remittedToCityAdmin && (o.doorstepPayment?.mode !== 'upi_qr' && o.doorstepPayment?.mode !== 'prepaid_online') && (o.fulfilmentStatus === 'delivered' || o.fulfilmentStatus === 'completed')).reduce((acc, o) => acc + o.totalPaise, 0)
  );
  const pendingPartnerCount = remittance.data?.partners ? remittance.data.partners.filter((p) => p.unremittedCashPaise > 0).length : 0;

  const displayedOrders = rawOrders.filter((o) => {
    if (paymentFilterTab === 'prepaid_upi') {
      return o.paymentMethod !== 'cash';
    }
    if (paymentFilterTab === 'cod_fleet') {
      const isDoorstepOnline = o.doorstepPayment?.mode === 'upi_qr' || o.doorstepPayment?.mode === 'prepaid_online';
      const isRemitted = Boolean(o.doorstepPayment?.remittedToCityAdmin);
      const isDelivered = o.fulfilmentStatus === 'delivered' || o.fulfilmentStatus === 'completed';
      return o.paymentMethod === 'cash' && !isDoorstepOnline && !isRemitted && isDelivered;
    }
    if (paymentFilterTab === 'cod_doorstep_online') {
      return o.paymentMethod === 'cash' && (o.doorstepPayment?.mode === 'upi_qr' || o.doorstepPayment?.mode === 'prepaid_online');
    }
    if (paymentFilterTab === 'cod_settled') {
      return o.paymentMethod === 'cash' && Boolean(o.doorstepPayment?.remittedToCityAdmin);
    }
    return true;
  });

  return (
    <div className="city-admin-page">
      <div className="city-admin-page-heading">
        <div>
          <p className="city-admin-eyebrow">Local operations</p>
          <h1>Orders &amp; Assignments</h1>
          <p>Orders for your assigned city with delivery partner assignment, payment status, and cash tracking.</p>
        </div>
        <Link
          to="/city-admin/remittance"
          className="city-admin-primary-button"
          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <span>💵</span> Hub Cash Remittance Desk
          {unremittedCashDisplay && unremittedCashDisplay !== '₹0.00' && (
            <span style={{ background: '#f59e0b', color: '#ffffff', padding: '1px 6px', borderRadius: '10px', fontSize: '11px', fontWeight: 700 }}>
              {unremittedCashDisplay} with fleet
            </span>
          )}
        </Link>
      </div>

      {/* COD & PAYMENT RECONCILIATION SUMMARY BAR */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px', borderLeft: '4px solid #16a34a', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
          <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Total Prepaid (UPI / Online)</span>
          <strong style={{ fontSize: '18px', color: '#16a34a', display: 'block', marginTop: '4px' }}>
            {formatMoney(prepaidTotalPaise)}
          </strong>
          <small style={{ color: '#15803d', fontSize: '11px' }}>Auto-Confirmed in Bank</small>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px', borderLeft: '4px solid #0284c7', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
          <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>COD Paid Online at Doorstep</span>
          <strong style={{ fontSize: '18px', color: '#0284c7', display: 'block', marginTop: '4px' }}>
            {formatMoney(codOnlineTotalPaise)}
          </strong>
          <small style={{ color: '#0369a1', fontSize: '11px' }}>Direct UPI QR · ₹0 Cash Liability</small>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px', borderLeft: '4px solid #f59e0b', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
          <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>COD Cash with Fleet</span>
          <strong style={{ fontSize: '18px', color: '#d97706', display: 'block', marginTop: '4px' }}>
            {unremittedCashDisplay}
          </strong>
          <small style={{ color: '#b45309', fontSize: '11px' }}>
            {pendingPartnerCount ? `${pendingPartnerCount} Rider(s) · Requires Handshake PIN` : 'Pending Hub Handover'}
          </small>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px', borderLeft: '4px solid #7c3aed', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
          <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Settled Cash Remittances</span>
          <strong style={{ fontSize: '18px', color: '#7c3aed', display: 'block', marginTop: '4px' }}>
            {formatMoney(codSettledTotalPaise)}
          </strong>
          <small style={{ color: '#6d28d9', fontSize: '11px' }}>Voucher Issued · Deposited in Hub</small>
        </div>
      </div>

      {/* QUICK PAYMENT RECONCILIATION FILTER PILLS */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
        {[
          { id: 'all', label: 'All Orders' },
          { id: 'prepaid_upi', label: '🟢 Prepaid UPI (Confirmed)' },
          { id: 'cod_fleet', label: '🟠 COD Cash with Fleet (Pending Handover)' },
          { id: 'cod_doorstep_online', label: '🔵 COD Paid Online at Doorstep' },
          { id: 'cod_settled', label: '🟣 Settled Cash (Hub Verified)' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setPaymentFilterTab(tab.id as any)}
            style={{
              border: paymentFilterTab === tab.id ? '2px solid #0f172a' : '1px solid #cbd5e1',
              background: paymentFilterTab === tab.id ? '#0f172a' : '#ffffff',
              color: paymentFilterTab === tab.id ? '#ffffff' : '#334155',
              padding: '6px 14px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: paymentFilterTab === tab.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {result.error && <div className="city-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
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
        {result.loading ? (
          <Loading label="Loading city orders…" />
        ) : displayedOrders.length ? (
          <CityAdminOrderTable orders={displayedOrders} />
        ) : (
          <div className="city-admin-empty">
            {paymentFilterTab !== 'all' ? `No orders found matching the "${paymentFilterTab.replace('_', ' ')}" filter.` : 'No city orders match these filters.'}
          </div>
        )}
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
        <td>{renderOrderPaymentBadge(order)}</td>
        <td><span className={`super-admin-status-badge status-${order.fulfilmentStatus}`}>{orderStatusLabel(order.fulfilmentStatus)}</span></td>
        <td>
          {order.deliveryPartner?.name ? (
            <div>
              <strong>{order.deliveryPartner.name}</strong>
              {order.deliveryPartner.distanceKm !== undefined && order.deliveryPartner.distanceKm !== null && <small>{order.deliveryPartner.distanceKm} km from Seller</small>}
            </div>
          ) : order.fulfilmentMethod === 'pickup' ? (
            'Pickup'
          ) : ['placed', 'order_confirmed', 'accepted', 'preparing'].includes(order.fulfilmentStatus) ? (
            <span style={{ fontSize: '0.78rem', color: '#b45309', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span>⏳</span> Awaiting Seller Packing
            </span>
          ) : (
            <Link to={`/city-admin/orders/${order._id}`} className="text-button" style={{ color: '#15803d', fontWeight: 700 }}>
              <strong>{order.fulfilmentStatus === 'ready_for_pickup' ? '🚨 Ready (Assign Partner) →' : 'View / Assign →'}</strong>
            </Link>
          )}
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
      {['placed', 'order_confirmed', 'accepted', 'preparing'].includes(item.fulfilmentStatus) && !item.deliveryPartner && (
        <div style={{ padding: '14px 18px', borderRadius: 12, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', margin: '12px 0 16px' }}>
          <strong style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <span>⏳</span> Seller Is Preparing & Packing
          </strong>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#B45309' }}>
            The artisan SHG is preparing this handcrafted order. Partner assignment unlocks automatically once the seller marks the package <strong>Ready for Pickup</strong>.
          </p>
        </div>
      )}
      {item.fulfilmentStatus === 'ready_for_pickup' && !item.deliveryPartner && (
        <div style={{ padding: '14px 18px', borderRadius: 12, background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#166534', margin: '12px 0 16px' }}>
          <strong style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <span>📦</span> Package Ready for Pickup — Assign Delivery Partner
          </strong>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#15803D' }}>
            The seller has packed and sealed this order. Select an eligible nearby delivery partner below, or allow smart auto-dispatch to assign the nearest online partner.
          </p>
        </div>
      )}
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
  return <div className="admin-shell"><aside className="admin-sidebar"><Link to="/admin" className="admin-brand"><img src="/images/esakhi-logo-transparent.png" alt="" /><span>eSakhi<br /><small>Maker workspace</small></span></Link><span className="sidebar-label">WORKSPACE</span><nav className="admin-nav"><NavLink to="/admin" end>Overview</NavLink><NavLink to="/admin/products">Products</NavLink>{admin && <NavLink to="/admin/inventory">Inventory</NavLink>}<NavLink to="/admin/orders">Orders</NavLink>{admin && <NavLink to="/admin/delivery-partners">Delivery Partners</NavLink>}{admin && <NavLink to="/admin/customers">Customers</NavLink>}{admin && <NavLink to="/admin/settings">Store settings</NavLink>}<NavLink to="/admin/system">API status</NavLink></nav><div className="sidebar-user"><span className="avatar">{(user?.name || 'E').slice(0, 1).toUpperCase()}</span><span><strong>{user?.name || user?.phone}</strong><small>{user?.role}</small></span></div></aside><section className="admin-content">{children}</section></div>;
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
  const { reloadUser } = useAuth();
  const navigate = useNavigate();
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
      setSubmitted(result.message || 'Seller profile created and active! Redirecting to your Seller Portal…');
      if (reloadUser) {
        await reloadUser().catch(() => {});
      }
      setTimeout(() => {
        navigate('/seller');
      }, 1200);
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
          <p>Register your Self-Help Group or artisan collective. Your store is activated immediately with zero manual bottleneck.</p>
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
            {isFoodSeller && <label className="field"><span>FSSAI registration or licence number</span><input required inputMode="numeric" pattern="[0-9]{14}" maxLength={14} value={form.fssaiRegistrationNumber} onChange={(event) => updateField('fssaiRegistrationNumber', event.target.value)} placeholder="14-digit number" /><small>Food seller access and food listings stay blocked until verified.</small></label>}
            <label className="field"><span>Registered address</span><textarea required rows={4} value={form.address} onChange={(event) => updateField('address', event.target.value)} placeholder="Street, locality, village, city" /></label>
            <Notice tone="success">Your seller account is activated automatically upon submitting this form. You can immediately access the Seller Portal, list handcrafted products, and receive local customer orders.</Notice>
            <button type="submit" className="button button-full" disabled={saving || categories.loading || !categories.data?.length}>{saving ? 'Activating account…' : 'Submit & Activate Seller Account'}</button>
          </form>
        </div>
      </section>
    </div>
  );
}

function CityAdminSellersPage(): ReactNode {
  return (
    <div className="city-admin-page">
      <div className="city-admin-page-heading">
        <div>
          <p className="city-admin-eyebrow">Local operations</p>
          <h1>Sellers &amp; SHGs</h1>
          <p>Registered Self-Help Groups (SHGs) and local artisan sellers in your assigned city.</p>
        </div>
      </div>
      <CityAdminSellerDirectory />
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

  return (
    <section className="city-admin-panel city-admin-order-directory">
      <div className="city-admin-order-tools">
        <label className="city-admin-search-field">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search city sellers"
            placeholder="Search seller by name or phone"
            value={search}
            onChange={(event) => { setPage(1); setSearch(event.target.value); }}
          />
        </label>
      </div>
      {result.error && <div className="city-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
      {result.loading ? (
        <Loading label="Loading city sellers…" />
      ) : result.error ? null : result.data?.data.length ? (
        <div className="city-admin-table-wrap">
          <table className="city-admin-table">
            <thead>
              <tr>
                <th>Seller / SHG</th>
                <th>Contact</th>
                <th>Assigned City</th>
                <th>Categories</th>
                <th>Products</th>
                <th>Orders</th>
              </tr>
            </thead>
            <tbody>
              {result.data.data.map((seller) => (
                <tr key={seller._id}>
                  <td><strong>{seller.name || 'Seller'}</strong></td>
                  <td>
                    <a href={`tel:${seller.phoneE164}`}>{seller.phoneE164}</a>
                    {seller.email && <small style={{ display: 'block', color: '#64748b' }}>{seller.email}</small>}
                  </td>
                  <td>{seller.assignedCity || user?.assignedCity || 'Damoh'}</td>
                  <td>{seller.productCategories.join(', ') || 'No listed products'}</td>
                  <td>{seller.productCount}</td>
                  <td>{seller.orderCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="city-admin-empty">No sellers are registered in {user?.assignedCity ?? 'this city'} yet.</div>
      )}
      {result.data && result.data.pagination.totalPages > 1 && (
        <Pagination page={page} pages={result.data.pagination.totalPages} onChange={setPage} />
      )}
    </section>
  );
}

function CityAdminProfilePage(): ReactNode {
  const result = useLoad(() => api.cityAdminProfile(), []);
  useRefreshOnFocus(result.reload);

  const data = result.data;
  const profile = data?.profile;
  const bank = data?.bankAccount;
  const compensation = data?.compensation;

  return (
    <div className="city-admin-page">
      <div className="city-admin-page-heading">
        <div>
          <p className="city-admin-eyebrow">Account &amp; Official Records</p>
          <h1>City Administrator Profile</h1>
          <p>Official verified identity, residential credentials, banking coordinates, and earnings ledger.</p>
        </div>
      </div>

      {result.error && (
        <div className="city-admin-error" role="alert">
          {result.error}
          <button type="button" onClick={() => void result.reload()}>Retry</button>
        </div>
      )}

      {result.loading ? (
        <Loading label="Loading profile and compensation details…" />
      ) : profile && bank && compensation ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* READ-ONLY SECURITY NOTICE */}
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ fontSize: '24px' }} role="img" aria-label="shield">🛡️</span>
            <div>
              <strong style={{ display: 'block', color: '#166534', fontSize: '15px' }}>Profile Locked &amp; Super Admin Verified</strong>
              <p style={{ margin: 0, color: '#15803d', fontSize: '13px' }}>
                For regulatory and compliance safety, personal credentials, residential address, Aadhaar ID, and bank coordinates cannot be edited directly by the City Administrator. If any updates are needed, please contact the Super Administrator.
              </p>
            </div>
          </div>

          {/* TWO COLUMN GRID FOR PERSONAL & BANK DETAILS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
            {/* PERSONAL & GOVERNMENT IDENTITY CARD */}
            <section className="city-admin-panel" style={{ margin: 0 }}>
              <div className="city-admin-panel-heading">
                <div>
                  <h2 style={{ fontSize: '18px', margin: 0 }}>Identity &amp; Residential Credentials</h2>
                  <p style={{ margin: 0, color: '#64748b', fontSize: '13px' }}>Verified details recorded during onboarding by Super Admin</p>
                </div>
                <span className="status-pill status-active" style={{ textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.05em' }}>{profile.status}</span>
              </div>
              <div className="panel-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Administrator Full Name</span>
                  <strong style={{ fontSize: '16px', color: '#0f172a' }}>{profile.name}</strong>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Verified Contact Number</span>
                    <strong style={{ fontSize: '15px', color: '#0f172a' }}>{profile.phoneE164}</strong>
                    <span style={{ color: '#059669', fontSize: '12px', display: 'block', marginTop: '2px' }}>✓ Verified OTP Mobile</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Registered Email</span>
                    <strong style={{ fontSize: '14px', color: '#0f172a' }}>{profile.email || 'None on record'}</strong>
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Assigned Operational City</span>
                  <strong style={{ fontSize: '15px', color: '#0284c7' }}>{profile.assignedCity}</strong>
                </div>
                <div>
                  <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Residential / Living Address</span>
                  <p style={{ margin: '4px 0 0', color: '#334155', fontSize: '14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px 12px' }}>
                    {profile.residentialAddress}
                  </p>
                </div>
                <div>
                  <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Identification / Aadhaar Card Number</span>
                  <code style={{ display: 'inline-block', marginTop: '4px', background: '#f1f5f9', padding: '4px 8px', borderRadius: '4px', fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
                    {profile.aadhaarNumber}
                  </code>
                </div>
              </div>
            </section>

            {/* BANKING & PAYOUT COORDINATES CARD */}
            <section className="city-admin-panel" style={{ margin: 0 }}>
              <div className="city-admin-panel-heading">
                <div>
                  <h2 style={{ fontSize: '18px', margin: 0 }}>Registered Bank Details</h2>
                  <p style={{ margin: 0, color: '#64748b', fontSize: '13px' }}>Designated beneficiary coordinates for commission disbursements</p>
                </div>
                <span className="status-pill status-approved" style={{ textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.05em' }}>
                  {bank.verified ? 'Verified Account' : 'Recorded'}
                </span>
              </div>
              <div className="panel-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Account Holder Name</span>
                  <strong style={{ fontSize: '16px', color: '#0f172a' }}>{bank.accountHolderName}</strong>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Bank Name</span>
                    <strong style={{ fontSize: '15px', color: '#0f172a' }}>{bank.bankName}</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>IFSC Code</span>
                    <code style={{ fontSize: '13px', color: '#0f172a' }}>{bank.ifscCode}</code>
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Bank Account Number</span>
                  <code style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '0.05em', color: '#0f172a' }}>
                    {bank.accountNumber && bank.accountNumber !== 'Not provided'
                      ? bank.accountNumber.length > 4
                        ? `•••• •••• ${bank.accountNumber.slice(-4)}`
                        : bank.accountNumber
                      : 'Not provided'}
                  </code>
                </div>
                <div>
                  <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>UPI ID</span>
                  <strong style={{ fontSize: '14px', color: '#334155' }}>{bank.upiId || 'Not provided'}</strong>
                </div>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px 12px', marginTop: 'auto' }}>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>Payout Disbursing Authority:</span>
                  <strong style={{ display: 'block', fontSize: '13px', color: '#0f172a' }}>{compensation.payer}</strong>
                </div>
              </div>
            </section>
          </div>

          {/* COMPENSATION TERMS & EARNINGS BALANCE */}
          <section className="city-admin-panel">
            <div className="city-admin-panel-heading">
              <div>
                <h2>Earnings, Compensation &amp; Payout Balance</h2>
                <p>Contracted compensation rate and real-time ledger of earned commissions and settled payouts.</p>
              </div>
              <span className="city-admin-period">Live Ledger</span>
            </div>

            {/* SUMMARY CARDS */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', padding: '20px 20px 0' }}>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px' }}>
                <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Compensation Rate</span>
                <strong style={{ fontSize: '16px', color: '#0f172a', display: 'block', marginTop: '4px' }}>{compensation.rateText}</strong>
                <small style={{ color: '#64748b', display: 'block', marginTop: '2px' }}>Payer: {compensation.payer}</small>
              </div>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px' }}>
                <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Completed City Sales</span>
                <strong style={{ fontSize: '20px', color: '#0f172a', display: 'block', marginTop: '4px' }}>{formatMoney(compensation.grossSalesPaise)}</strong>
                <small style={{ color: '#64748b', display: 'block', marginTop: '2px' }}>From {compensation.completedOrdersCount} delivered orders</small>
              </div>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px' }}>
                <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Total Disbursed / Paid Out</span>
                <strong style={{ fontSize: '20px', color: '#059669', display: 'block', marginTop: '4px' }}>{formatMoney(compensation.totalDisbursedPaise)}</strong>
                <small style={{ color: '#64748b', display: 'block', marginTop: '2px' }}>Transferred to your bank account</small>
              </div>
              <div style={{ background: compensation.currentPayableBalancePaise > 0 ? '#eff6ff' : '#f8fafc', border: `1px solid ${compensation.currentPayableBalancePaise > 0 ? '#93c5fd' : '#e2e8f0'}`, borderRadius: '8px', padding: '16px' }}>
                <span style={{ fontSize: '11px', color: compensation.currentPayableBalancePaise > 0 ? '#1d4ed8' : '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Current Payable Balance</span>
                <strong style={{ fontSize: '22px', color: compensation.currentPayableBalancePaise > 0 ? '#1e40af' : '#0f172a', display: 'block', marginTop: '4px' }}>{formatMoney(compensation.currentPayableBalancePaise)}</strong>
                <small style={{ color: compensation.currentPayableBalancePaise > 0 ? '#1e40af' : '#64748b', display: 'block', marginTop: '2px' }}>
                  {compensation.currentPayableBalancePaise > 0 ? 'Pending Super Admin payout' : 'All earnings fully settled (₹0.00)'}
                </small>
              </div>
            </div>

            <div style={{ padding: '16px 20px', fontSize: '13px', color: '#475569' }}>
              <p style={{ margin: 0 }}>
                💡 <em>Note: When Super Admin processes your payout disbursement, the transferred funds are sent to your verified bank account and your payable balance automatically updates to ₹0.00.</em>
              </p>
            </div>

            {/* PAYOUT HISTORY */}
            <div style={{ borderTop: '1px solid #e2e8f0', padding: '20px' }}>
              <h3 style={{ fontSize: '15px', margin: '0 0 12px', color: '#0f172a' }}>Payout Disbursement History</h3>
              {compensation.payoutHistory && compensation.payoutHistory.length > 0 ? (
                <div className="city-admin-table-wrap">
                  <table className="city-admin-table">
                    <thead>
                      <tr>
                        <th>Disbursement Date</th>
                        <th>Amount Paid</th>
                        <th>UTR / Reference</th>
                        <th>Payment Method</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compensation.payoutHistory.map((payout, index) => (
                        <tr key={index}>
                          <td>{payout.paidAt ? new Date(payout.paidAt).toLocaleDateString('en-IN') : 'Completed'}</td>
                          <td><strong>{formatMoney(payout.amountPaise)}</strong></td>
                          <td><code>{payout.transactionReference || 'Bank Transfer'}</code></td>
                          <td>{payout.paymentMethod.toUpperCase()}</td>
                          <td><span className="status-pill status-approved">{payout.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="city-admin-empty" style={{ padding: '20px' }}>
                  No past disbursements recorded yet. Payouts processed by Super Admin will appear here.
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
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







function DeliveryPartnerGate({ children }: { children: ReactNode }): ReactNode {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="page-container"><Loading label="Checking your session…" /></div>;
  if (!user) return <div className="page-container narrow"><PageIntro eyebrow="Delivery portal" title="Please sign in" description="Sign in with your delivery partner account to view assigned orders." /><Link to="/sign-in" state={{ from: location.pathname }} className="button">Sign in</Link></div>;
  if (user.role !== 'delivery_partner') return <div className="page-container narrow"><Notice tone="error">This portal is available only to delivery partners.</Notice></div>;
  return children;
}

function DeliveryPartnerCockpitPage(): ReactNode {
  const { user, signOut } = useAuth();
  if (!user) return null;
  return <DeliveryPartnerCockpit user={user} onSignOut={signOut} />;
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
  const { user, setSession } = useAuth();
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
        user={user}
        setSession={setSession}
      />
    </div>
  );
}

export default App;
