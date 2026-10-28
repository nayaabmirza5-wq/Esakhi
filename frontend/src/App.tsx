import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, api, refreshSession, resolveProductImageUrl, setAccessToken } from './api';
import type { Address, AuditLogEntry, CityAdminOrder, Order, Product, SellerOrder, Settings, SuperAdminCity, SuperAdminCitySummary, SuperAdminOrder, User } from './types';
import { disableOrderPushNotifications, enableOrderPushNotifications, pushNotificationsConfigured } from './pushNotifications';

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
    const timer = window.setInterval(refresh, 30_000);
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
  }, []);

  const setSession = useCallback((nextUser: User, token: string) => {
    setAccessToken(token);
    setUser(nextUser);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setAccessToken(null);
      setUser(null);
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

    void (async () => {
      if (await refreshSession()) {
        try {
          const me = await api.me();
          if (active) setUser(me);
        } catch {
          setAccessToken(null);
        }
      }

      if (active) setReady(true);
    })();

    return () => {
      active = false;
    };
  }, []);

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
              <Route path="/delivery-partner" element={<DeliveryPartnerGate><DeliveryPartnerPage /></DeliveryPartnerGate>} />
              <Route path="/seller" element={<SellerGate><SellerPortalPage /></SellerGate>} />
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
              <Route path="/city-admin/orders" element={<CityAdminGate><CityAdminOrdersPage /></CityAdminGate>} />
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
          <img src="/images/esakhi-emblem.png" alt="eSakhi — Handmade by women, made for you" />
        </Link>
        <nav className="main-nav" aria-label="Main navigation">
          <NavLink to="/shop">Shop</NavLink>
          <NavLink to="/our-story">Our story</NavLink>
          {user && <NavLink to="/orders">My orders</NavLink>}
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
        <Link to="/" className="footer-brand"><img src="/images/esakhi-emblem.png" alt="" /><span>Handmade with love.<br />Empowered by you.</span></Link>
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
  return (
    <article className="product-card">
      <Link to={`/products/${encodeURIComponent(product.slug)}`} className="product-image">
        {image ? <img src={image} alt={product.name} loading="lazy" /> : <div className="image-placeholder" aria-label="No product image available"><img src="/images/esakhi-emblem.png" alt="" /></div>}
        {(product.stock ?? 0) <= 0 && <span className="image-badge">Unavailable</span>}
      </Link>
      <div className="product-card-body">
        <div className="product-category">{product.category}</div>
        <Link to={`/products/${encodeURIComponent(product.slug)}`} className="product-name">{product.name}</Link>
        <div className="product-card-bottom"><strong>{formatMoney(product.pricePaise)}</strong><button className="add-button" disabled={!product.stock} onClick={() => { add(product); navigate('/cart'); }} aria-label={`Add ${product.name} to bag`}>Add +</button></div>
      </div>
    </article>
  );
}

function ProductGrid({ products, loading, error, reload }: { products: Product[]; loading: boolean; error: string; reload?: () => void }): ReactNode {
  if (loading) return <Loading label="Finding pieces made with care…" />;
  if (error) return <div className="section-state"><Notice tone="error">{error}</Notice>{reload && <button className="button button-outline" onClick={() => void reload()}>Try again</button>}</div>;
  if (!products.length) return <EmptyState title="No pieces to show just yet">Please check back soon as the catalogue is updated.</EmptyState>;
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
          : <img src="/images/esakhi-emblem.png" alt="eSakhi emblem representing women creating together" />}
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
      <div className="hero-stamp"><img src="/images/esakhi-emblem.png" alt="" /><span>Made<br />together</span></div>
      <div className="hero-note">
        <span className="note-flower" aria-hidden="true">✿</span>
        <span>
          {activeProduct
            ? <><span className="hero-product-category">Customer favourite · {activeProduct.category}</span><strong>{activeProduct.name}</strong><span>{formatMoney(activeProduct.pricePaise)}</span></>
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
        </div>
        <div className="hero-art">
          <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
          <HeroCarousel products={products.data ?? []} />
        </div>
      </section>
      <section className="section section-categories">
        <div className="section-heading"><div><span className="eyebrow">Find your favorite</span><h2>Made to be <em>treasured.</em></h2></div><Link to="/shop" className="quiet-link">Explore everything →</Link></div>
        {categories.error && <Notice tone="error">{categories.error}</Notice>}
        <div className="category-grid">
          {(categories.data ?? []).map((category, index) => <Link key={category} className={`category-tile category-${index % 4}`} to={`/shop?category=${encodeURIComponent(category)}`}><span className="category-number">0{index + 1}</span><span>{category}</span><b aria-hidden="true">↗</b></Link>)}
          {!categories.loading && categories.data?.length === 0 && <EmptyState title="Categories are not available right now" />}
          {categories.loading && <Loading label="Loading categories…" />}
        </div>
      </section>
      <section className="section section-products">
        <div className="section-heading"><div><span className="eyebrow">Selected with care</span><h2>Pieces with a <em>purpose.</em></h2></div><Link to="/shop" className="quiet-link">Shop all pieces →</Link></div>
        <ProductGrid products={(products.data ?? []).slice(0, 4)} loading={products.loading} error={products.error} reload={products.reload} />
      </section>
      <section className="story-band">
        <div className="story-band-mark"><img src="/images/esakhi-emblem.png" alt="" /></div>
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

function ShopPage(): ReactNode {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') || '1');
  const [search, setSearch] = useState(params.get('q') || '');
  const [category, setCategory] = useState(params.get('category') || '');
  const categories = useLoad(() => api.categories());
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (category) query.set('category', category);
  if (search.trim()) query.set('q', search.trim());
  const result = useLoad(() => api.products(query), [page, category, search]);
  const setFilter = (nextCategory: string, nextSearch = search) => {
    setCategory(nextCategory);
    setSearch(nextSearch);
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (nextCategory) next.set('category', nextCategory); else next.delete('category');
      if (nextSearch.trim()) next.set('q', nextSearch.trim()); else next.delete('q');
      next.delete('page');
      return next;
    });
  };
  return (
    <div className="page-container">
      <PageIntro eyebrow="The eSakhi collection" title="Made by hand. Chosen by you." description="Explore pieces shaped by patience, skill, and a community of women makers." />
      <div className="shop-toolbar">
        <div className="filter-chips"><button className={!category ? 'chip active' : 'chip'} onClick={() => setFilter('')}>All pieces</button>{(categories.data ?? []).map((value) => <button key={value} className={category === value ? 'chip active' : 'chip'} onClick={() => setFilter(value)}>{value}</button>)}</div>
        <label className="search-field"><span className="sr-only">Search products</span><input value={search} onChange={(event) => setFilter(category, event.target.value)} placeholder="Search the collection" /><span aria-hidden="true">⌕</span></label>
      </div>
      <ProductGrid products={result.data?.data ?? []} loading={result.loading} error={result.error || categories.error} reload={result.reload} />
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
  const stock = variant?.stock ?? item?.stock ?? 0;
  if (product.loading) return <div className="page-container"><Loading /></div>;
  if (product.error || !item) return <div className="page-container"><Notice tone="error">{product.error || 'Product not found.'}</Notice><Link to="/shop" className="button button-outline">Back to shop</Link></div>;
  return (
    <div className="page-container product-detail">
      <div className="breadcrumbs"><Link to="/shop">Shop</Link><span>/</span><span>{item.category}</span></div>
      <div className="detail-grid">
        <div className="detail-gallery">{item.imageUrls.length ? item.imageUrls.map((image, index) => <img key={image} src={resolveProductImageUrl(image)} alt={`${item.name}, view ${index + 1}`} />) : <div className="detail-placeholder"><img src="/images/esakhi-emblem.png" alt="" /><span>Product image coming soon</span></div>}</div>
        <div className="detail-copy"><span className="eyebrow">{item.category} · Handmade</span><h1>{item.name}</h1><p className="detail-price">{formatMoney(item.pricePaise)}</p><p className="detail-description">{item.description}</p>
          {item.variants.length > 0 && <label className="field"><span>Choose an option</span><select value={variantId} onChange={(event) => setVariantId(event.target.value)}><option value="">Select an option</option>{item.variants.map((option) => <option key={option._id} value={option._id}>{Object.values(option.attributes).join(' · ') || option.sku || 'Option'}{option.stock <= 0 ? ' — unavailable' : ''}</option>)}</select></label>}
          <p className={stock > 0 ? 'stock-note' : 'stock-note unavailable'}>{stock > 0 ? 'Available to order' : 'Currently unavailable'}</p>
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
      <section className="story-hero"><div className="story-hero-logo"><img src="/images/esakhi-emblem.png" alt="eSakhi — Handmade by women, made for you" /></div><div><span className="eyebrow">The people behind every piece</span><h1>From her hands<br />to your <em>heart.</em></h1><p>Every handmade product carries a story of courage, creativity, and independence.</p></div></section>
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
  if (user) return <div className="page-container narrow"><Notice tone="success">You are signed in as {user.name || user.phone}.</Notice><Link to={user.role === 'city_admin' ? '/city-admin' : user.role === 'admin' || user.role === 'staff' ? '/admin' : '/account'} className="button">Continue</Link></div>;
  const submitPhone = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError('');
    try { await api.requestOtp(phone); setRequested(true); }
    catch (cause) { setError(displayError(cause)); }
    finally { setLoading(false); }
  };
  const submitCode = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const session = await api.verifyOtp(phone, code);
      setSession(session.user, session.accessToken);
      await reloadUser();
      navigate(signInState?.from || (session.user.role === 'super_admin' ? '/super-admin' : session.user.role === 'city_admin' ? '/city-admin' : session.user.role === 'admin' || session.user.role === 'staff' ? '/admin' : session.user.role === 'delivery_partner' ? '/delivery-partner' : session.user.role === 'seller' ? '/seller' : '/account'), { replace: true, state: signInState?.checkoutState });
    } catch (cause) { setError(displayError(cause)); }
    finally { setLoading(false); }
  };
  return <div className="auth-layout"><div className="auth-art"><img src="/images/esakhi-emblem.png" alt="" /><span>Handmade by women,<br />made for you.</span></div><section className="auth-card"><span className="eyebrow">Welcome to eSakhi</span><h1>{requested ? 'Enter your code.' : 'A little care goes a long way.'}</h1><p>{requested ? 'Enter the six-digit verification code sent to your phone.' : 'Sign in with your Indian mobile number to see your orders and check out.'}</p>{error && <Notice tone="error">{error}</Notice>}{!requested ? <form onSubmit={(event) => void submitPhone(event)} className="stack-form"><label className="field"><span>Mobile number</span><input autoComplete="tel" inputMode="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91 98765 43210" /></label><button className="button" disabled={loading}>{loading ? 'Requesting…' : 'Send verification code'}</button></form> : <form onSubmit={(event) => void submitCode(event)} className="stack-form"><label className="field"><span>Six-digit code</span><input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="••••••" /></label><button className="button" disabled={loading}>{loading ? 'Verifying…' : 'Verify and continue'}</button><button className="text-button" type="button" onClick={() => { setRequested(false); setCode(''); }}>Use another number</button></form>}<small>New here? Your customer account is created securely after successful phone verification.</small></section></div>;
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
  return <div className="page-container"><PageIntro eyebrow="Your selection" title="Your bag" description="Your total is confirmed by eSakhi when you place your order." />{!lines.length ? <EmptyState title="Your bag is waiting for something lovely"><Link to="/shop" className="button">Explore the collection</Link></EmptyState> : <div className="cart-layout"><div className="cart-list">{currentProducts.loading && <Loading label="Checking current product details…" />}{lines.map((line) => { const refreshed = currentProducts.data?.find((entry) => entry.key === productKey(line)); const displayProduct = refreshed?.product ?? line.product; const failed = Boolean(refreshed && !refreshed.product); const unavailable = line.unavailable; return <article key={productKey(line)} className="cart-item"><Link to={`/products/${displayProduct.slug}`} className="cart-thumb">{displayProduct.imageUrls[0] ? <img src={resolveProductImageUrl(displayProduct.imageUrls[0])} alt="" /> : <img src="/images/esakhi-emblem.png" alt="" />}</Link><div className="cart-item-info"><span className="product-category">{displayProduct.category}</span><Link to={`/products/${displayProduct.slug}`} className="product-name">{displayProduct.name}</Link><span>{formatMoney(displayProduct.pricePaise)}</span>{unavailable && <span className="stock-note unavailable">No longer available — remove to continue.</span>}{failed && !unavailable && <span className="stock-note unavailable">{refreshed?.error || 'Could not refresh product details.'}</span>}</div><div className="cart-quantity"><button onClick={() => line.quantity > 1 ? setQuantity(productKey(line), line.quantity - 1) : remove(productKey(line))} aria-label="Decrease quantity">−</button><span>{line.quantity}</span><button onClick={() => setQuantity(productKey(line), Math.min(99, line.quantity + 1))} aria-label="Increase quantity">+</button></div><strong>{formatMoney(displayProduct.pricePaise * line.quantity)}</strong><button className="remove-button" onClick={() => remove(productKey(line))} aria-label={`Remove ${displayProduct.name}`}>×</button></article>; })}</div><aside className="summary-card"><span className="eyebrow">Order summary</span><div><span>Estimated subtotal</span><strong>{formatMoney(subtotal)}</strong></div><small>Final price, delivery fee, stock and payment options are checked by the server at checkout.</small>{currentProducts.data?.some((entry) => !entry.product) && <Notice tone="error">Refresh current product details or remove unavailable items before continuing.</Notice>}{currentProducts.data?.some((entry) => !entry.product) && <button className="button button-outline" onClick={() => void currentProducts.reload()}>Retry product check</button>}<Link aria-disabled={currentProducts.loading || currentProducts.data?.some((entry) => !entry.product)} onClick={(event) => { if (currentProducts.loading || currentProducts.data?.some((entry) => !entry.product)) event.preventDefault(); }} to="/checkout" className={`button button-full ${currentProducts.loading || currentProducts.data?.some((entry) => !entry.product) ? 'button-disabled' : ''}`}>Continue to checkout</Link><Link to="/shop" className="quiet-link">Continue shopping</Link></aside></div>}</div>;
}

function CheckoutPage(): ReactNode {
  const { user } = useAuth();
  const { lines, clear } = useCart();
  const location = useLocation();
  const navigate = useNavigate();
  const buyNowLine = getBuyNowLine(location.state);
  const checkoutLines = buyNowLine ? [buyNowLine] : lines;
  const service = useLoad(() => api.serviceArea());
  const [method, setMethod] = useState<'delivery' | 'pickup'>('delivery');
  const [payment, setPayment] = useState<'upi' | 'cash'>('upi');
  const [values, setValues] = useState({ name: user?.name ?? '', phone: user?.phone ?? '', addressLine1: '', addressLine2: '', locality: '', postalCode: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const availablePayments = service.data?.paymentMethods;
  useEffect(() => { if (service.data?.pickupEnabled && !service.data.deliveryEnabled) setMethod('pickup'); }, [service.data]);
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
      customerPhone: normalizeIndianPhone(values.phone),
      fulfilmentMethod: method,
      items: checkoutLines.map((line) => ({ productId: getId(line.product), ...(line.variantId ? { variantId: line.variantId } : {}), quantity: line.quantity })),
      paymentMethod: payment,
    };
    if (method === 'delivery') payload.address = {
      name: values.name, phone: normalizeIndianPhone(values.phone), addressLine1: values.addressLine1,
      ...(values.addressLine2 ? { addressLine2: values.addressLine2 } : {}),
      locality: values.locality, postalCode: values.postalCode,
    };
    try {
      const result = await api.createOrder(payload);
      if (!buyNowLine) clear();
      setIdempotencyKey(crypto.randomUUID());
      navigate(`/orders/${encodeURIComponent(result.order._id)}`, { state: { paymentInstructions: result.paymentInstructions } });
    } catch (cause) { setError(displayError(cause)); }
    finally { setSubmitting(false); }
  };
  return <div className="page-container"><PageIntro eyebrow="Almost yours" title="A thoughtful order starts here" description="The server rechecks current stock, service options, and final totals when you place the order." />{service.error && <Notice tone="error">{service.error}</Notice>}{service.data && !service.data.configured && <Notice tone="error">Checkout is not configured yet. Please try again later.</Notice>}{service.data?.deliveryUnavailableReason && <Notice tone="error">Currently delivering only within Damoh, Madhya Pradesh. {service.data.deliveryUnavailableReason}</Notice>}{service.data?.configured && !availablePayments?.upi && !availablePayments?.cash && <Notice tone="error">No payment method is enabled for checkout yet.</Notice>}{service.data?.configured && <form className="checkout-layout" onSubmit={(event) => void submit(event)}><div className="checkout-form"><section className="form-section"><h2>Contact</h2><div className="form-grid"><label className="field"><span>Name</span><input required maxLength={120} value={values.name} onChange={(event) => set('name', event.target.value)} /></label><label className="field"><span>Indian mobile number</span><input required pattern="(\+91[6-9][0-9]{9}|[6-9][0-9]{9})" value={values.phone} onChange={(event) => set('phone', event.target.value)} /></label></div></section><section className="form-section"><h2>How would you like to receive it?</h2><div className="choice-row">{service.data.deliveryEnabled && <label className={method === 'delivery' ? 'choice selected' : 'choice'}><input type="radio" name="fulfilment" checked={method === 'delivery'} onChange={() => setMethod('delivery')} /><span><b>Local delivery</b><small>Currently delivering only within Damoh, Madhya Pradesh.</small></span></label>}{service.data.pickupEnabled && <label className={method === 'pickup' ? 'choice selected' : 'choice'}><input type="radio" name="fulfilment" checked={method === 'pickup'} onChange={() => setMethod('pickup')} /><span><b>Pickup</b><small>{service.data.pickupInstructions || 'Pickup details confirmed after your order'}</small></span></label>}</div></section>{method === 'delivery' && <section className="form-section"><h2>Delivery address</h2><div className="form-grid"><label className="field span-two"><span>Address line 1</span><input required value={values.addressLine1} onChange={(event) => set('addressLine1', event.target.value)} /></label><label className="field span-two"><span>Address line 2 (optional)</span><input value={values.addressLine2} onChange={(event) => set('addressLine2', event.target.value)} /></label><label className="field"><span>Locality</span><select required value={values.locality} onChange={(event) => set('locality', event.target.value)}><option value="">Choose locality</option>{(service.data.serviceableLocalities ?? []).map((locality) => <option key={locality.name} value={locality.name}>{locality.name} · {formatMoney(locality.deliveryFeePaise)}</option>)}</select></label><label className="field"><span>PIN code</span><input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={values.postalCode} onChange={(event) => set('postalCode', event.target.value)} /></label></div><small>City and state are validated by the configured service area. Your delivery phone must match your verified account.</small></section>}<section className="form-section"><h2>Payment method</h2><div className="choice-row">{availablePayments?.upi && <label className={payment === 'upi' ? 'choice selected' : 'choice'}><input type="radio" name="payment" checked={payment === 'upi'} onChange={() => setPayment('upi')} /><span><b>UPI</b><small>Instructions provided after placing the order</small></span></label>}{availablePayments?.cash && <label className={payment === 'cash' ? 'choice selected' : 'choice'}><input type="radio" name="payment" checked={payment === 'cash'} onChange={() => setPayment('cash')} /><span><b>Cash</b><small>Payment is manually confirmed</small></span></label>}</div></section>{error && <Notice tone="error">{error}</Notice>}<button className="button" disabled={submitting || service.loading || !service.data.configured || (!availablePayments?.upi && !availablePayments?.cash)}>{submitting ? 'Placing order…' : 'Place order'}</button></div><aside className="summary-card checkout-summary"><span className="eyebrow">Your items</span>{checkoutLines.map((line) => <div key={productKey(line)}><span>{line.product.name} × {line.quantity}</span><strong>{formatMoney(line.product.pricePaise * line.quantity)}</strong></div>)}<small>Totals are calculated and confirmed by eSakhi when the order is placed.</small></aside></form>}</div>;
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
  return <div className="page-container narrow"><PageIntro eyebrow="Your account" title={`Hello${user.name ? `, ${user.name}` : ''}`} description="Manage your profile and find your past orders." />{user.role === 'customer' && <p><Link className="quiet-link" to="/account">← Back to your dashboard</Link></p>}<div className="account-role"><span className="status-dot" /> Signed in as {user.role}</div>{error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}<form className="stack-form panel" onSubmit={(event) => void submit(event)}><label className="field"><span>Your name</span><input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field"><span>Verified phone</span><input value={user.phone ?? ''} disabled /></label><button className="button">Save profile</button></form>{user.role === 'customer' && <section className="panel push-notification-settings"><h2>Order notifications</h2><p>Get a browser notification when your order status changes. Notifications are optional and require browser permission.</p>{pushNotificationsConfigured ? <button className="button button-outline" onClick={() => void togglePush()}>{pushEnabled ? 'Disable on this device' : 'Enable order notifications'}</button> : <Notice>Push notifications are not configured for this app yet.</Notice>}</section>}<div className="account-links"><Link to="/orders" className="button button-outline">View order history</Link>{user.role === 'delivery_partner' && <Link to="/delivery-partner" className="button button-outline">Open delivery portal</Link>}{user.role === 'city_admin' && <Link to="/city-admin" className="button button-outline">Open City Admin dashboard</Link>}{(user.role === 'admin' || user.role === 'staff') && <Link to="/admin" className="button button-outline">Open workspace</Link>}</div><div id="saved-address"><AddressEditor onSaved={reloadUser} /></div></div>;
}

function AddressEditor({ onSaved }: { onSaved: () => Promise<void> }): ReactNode {
  const { user } = useAuth();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [address, setAddress] = useState<Address>(() => user?.savedAddresses?.[0] ?? {
    label: 'Primary',
    name: user?.name ?? '',
    phone: user?.phone ?? '',
    addressLine1: '',
    addressLine2: '',
    locality: '',
    city: 'Damoh',
    state: 'Madhya Pradesh',
    postalCode: '',
  });
  useEffect(() => {
    const primaryAddress = user?.savedAddresses?.[0];
    if (primaryAddress) {
      setAddress(primaryAddress);
      setSaved(true);
    }
  }, [user?.savedAddresses]);
  const field = (key: keyof Address, value: string) => {
    setSaved(false);
    setAddress((previous) => ({ ...previous, [key]: value }));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const phone = normalizeIndianPhone(address.phone);
      const savedAddress = {
        ...address,
        label: address.label?.trim() || 'Primary',
        phone,
      };
      const existingAddresses = user?.savedAddresses ?? [];
      const nextAddresses = savedAddress.id
        ? existingAddresses.map((existing) => existing.id === savedAddress.id ? savedAddress : existing)
        : [savedAddress, ...existingAddresses].slice(0, 10);
      const updatedAddresses = await api.replaceAddresses(nextAddresses);
      setAddress(updatedAddresses[0] ?? address);
      await onSaved();
      setSaved(true);
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setSaving(false);
    }
  };
  return <details className="address-details" open><summary>Save primary delivery address</summary><p>This address is saved to your account for checkout. You can update it any time.</p>{error && <Notice tone="error">{error}</Notice>}{saved && <Notice tone="success">Primary address saved to your account.</Notice>}<form className="stack-form" onSubmit={(event) => void submit(event)}><div className="form-grid">
    <label className="field"><span>Address label</span><input maxLength={40} value={address.label ?? 'Primary'} onChange={(event) => field('label', event.target.value)} /></label>
    <label className="field"><span>Recipient name</span><input autoComplete="name" required maxLength={120} value={address.name} onChange={(event) => field('name', event.target.value)} /></label>
    <label className="field"><span>Phone (+91)</span><input autoComplete="tel" inputMode="tel" required pattern="(\+91[6-9][0-9]{9}|[6-9][0-9]{9})" value={address.phone} onChange={(event) => field('phone', event.target.value)} /></label>
    <label className="field"><span>House / flat number and street</span><input autoComplete="address-line1" required maxLength={200} value={address.addressLine1} onChange={(event) => field('addressLine1', event.target.value)} /></label>
    <label className="field"><span>Landmark (optional)</span><input autoComplete="address-line2" maxLength={200} value={address.addressLine2 ?? ''} onChange={(event) => field('addressLine2', event.target.value)} /></label>
    <label className="field"><span>Locality</span><input autoComplete="address-level3" required maxLength={100} value={address.locality} onChange={(event) => field('locality', event.target.value)} /></label>
    <label className="field"><span>City</span><input autoComplete="address-level2" required maxLength={100} value={address.city} onChange={(event) => field('city', event.target.value)} /></label>
    <label className="field"><span>State</span><input autoComplete="address-level1" required maxLength={100} value={address.state} onChange={(event) => field('state', event.target.value)} /></label>
    <label className="field"><span>PIN code</span><input autoComplete="postal-code" inputMode="numeric" required pattern="[0-9]{6}" maxLength={6} value={address.postalCode} onChange={(event) => field('postalCode', event.target.value)} /></label>
  </div><button className="button button-outline" disabled={saving}>{saving ? 'Saving address…' : 'Save primary address'}</button></form></details>;
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
  return <div className="page-container"><PageIntro eyebrow="Your purchases" title="Order history" description="Follow your orders from confirmation through fulfilment." />{result.loading ? <Loading /> : result.error ? <Notice tone="error">{result.error}</Notice> : result.data?.data.length ? <><div className="order-list">{result.data.data.map((order) => <OrderCard key={order._id} order={order} to={`/orders/${order._id}`} />)}</div>{result.data.pagination.totalPages > 1 && <Pagination page={page} pages={result.data.pagination.totalPages} onChange={setPage} />}</> : <EmptyState title="No orders yet"><Link to="/shop" className="button">Find your first piece</Link></EmptyState>}</div>;
}

function OrderCard({ order, to }: { order: Order; to: string }): ReactNode {
  return <Link className="order-card" to={to}><div><span className="eyebrow">{order.orderReference}</span><strong>{order.items.map((item) => item.productName).join(', ')}</strong>{order.deliveryPartner && <small>Delivery partner: {order.deliveryPartner.name}</small>}<small>{order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN') : ''}</small></div><div className="order-card-meta"><StatusBadge value={order.fulfilmentStatus} fulfilmentMethod={order.fulfilmentMethod} /><strong>{formatMoney(order.totalPaise)}</strong><span>View order →</span></div></Link>;
}

function orderStatusLabel(value: string, fulfilmentMethod?: Order['fulfilmentMethod']): string {
  const labels: Record<string, string> = {
    placed: 'Placed',
    accepted: 'Confirmed',
    preparing: 'Packed',
    ready_for_pickup: 'Ready for pickup',
    out_for_delivery: 'Out for delivery',
    delivered: 'Delivered',
    completed: fulfilmentMethod === 'delivery' ? 'Delivered' : 'Completed',
    cancelled: 'Cancelled',
  };
  return labels[value] ?? value.replaceAll('_', ' ');
}

function StatusBadge({ value, fulfilmentMethod }: { value: string; fulfilmentMethod?: Order['fulfilmentMethod'] }): ReactNode {
  return <span className={`status-badge status-${value}`}>{orderStatusLabel(value, fulfilmentMethod)}</span>;
}

function CustomerOrderPage(): ReactNode {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const order = useLoad(() => api.myOrder(id), [id, user?.id]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!user || !id) return;
    const refresh = () => void order.reload(false);
    const timer = window.setInterval(refresh, 30_000);
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
  const canCancel = ['placed', 'accepted'].includes(item.fulfilmentStatus) && !item.cancellationRequest?.requestedAt;
  const history = item.statusHistory?.length
    ? item.statusHistory
    : [{ status: 'placed', changedAt: item.createdAt ?? '' }];
  const cancel = async () => {
    if (!window.confirm('Send a cancellation request for this order? The team must review it.')) return;
    setError('');
    try { order.setData(await api.requestCancellation(item._id)); }
    catch (cause) { setError(displayError(cause)); }
  };
  return (
    <div className="page-container">
      <div className="breadcrumbs"><Link to="/orders">Orders</Link><span>/</span>{item.orderReference}</div>
      <PageIntro eyebrow="Order details" title={item.orderReference} description={item.createdAt ? `Placed ${new Date(item.createdAt).toLocaleString('en-IN')}` : undefined}>
        <StatusBadge value={item.fulfilmentStatus} fulfilmentMethod={item.fulfilmentMethod} />
      </PageIntro>
      {error && <Notice tone="error">{error}</Notice>}
      {paymentInstructions && <Notice tone="success"><strong>Payment instructions ({paymentInstructions.method ?? item.paymentMethod})</strong><br />{paymentInstructions.upiId && <span>UPI ID: {paymentInstructions.upiId}<br /></span>}{paymentInstructions.instructions}{paymentInstructions.qrImageUrl && <p><img className="payment-qr" src={paymentInstructions.qrImageUrl} alt="UPI payment QR code" /></p>}</Notice>}
      <section className="panel order-timeline-panel">
        <div className="panel-heading"><h2>Order progress</h2><button className="button button-outline" onClick={() => void order.reload()}>Refresh status</button></div>
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
          <img src="/images/esakhi-emblem.png" alt="" />
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

function SuperAdminCitiesPage(): ReactNode {
  const settingsResult = useLoad(() => api.settings(), []);
  const citiesResult = useLoad(() => api.superAdminCities(), []);
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (settingsResult.data?.city) setCity(settingsResult.data.city);
  }, [settingsResult.data]);

  const saveCity = async (event: FormEvent) => {
    event.preventDefault();
    if (!settingsResult.data) return;
    setSaving(true); setError(''); setMessage('');
    try {
      await api.saveSettings({ ...settingsResult.data, city: city.trim() });
      setMessage('Platform city updated successfully.');
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
        <div><p className="super-admin-eyebrow">Operations</p><h1>Cities & Service Zones</h1><p>Configure the active city and assign the current City Admin coverage for it.</p></div>
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
          <div className="super-admin-panel-heading"><div><h2>City configuration</h2><p>Update the active platform city.</p></div></div>
          <form className="stack-form" onSubmit={(event) => void saveCity(event)}>
            <label className="field"><span>City name</span><input aria-label="City name" value={city} onChange={(event) => setCity(event.target.value)} /></label>
            <button className="button" type="submit" disabled={saving || !settingsResult.data}>{saving ? 'Saving…' : 'Save city'}</button>
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
        {productsResult.loading ? <Loading label="Loading seller products…" /> : productsResult.data?.data.length ? <div className="super-admin-table-wrap"><table className="super-admin-table"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th></tr></thead><tbody>{productsResult.data.data.map((product) => <tr key={product._id}><td>{product.name}</td><td>{product.category}</td><td>{formatMoney(product.pricePaise)}</td><td>{product.variants?.length ? product.variants.reduce((total, variant) => total + variant.stock, 0) : product.stock}</td><td><StatusBadge value={product.isActive ? 'active' : product.isArchived ? 'archived' : 'inactive'} /></td></tr>)}</tbody></table></div> : <div className="super-admin-empty">No products are linked to this seller.</div>}
        {productsResult.data && productsResult.data.pagination.totalPages > 1 && <Pagination page={page} pages={productsResult.data.pagination.totalPages} onChange={setPage} />}
      </section>
    </div>
  );
}

function SuperAdminProductsPage(): ReactNode {
  const [page, setPage] = useState(1);
  const result = useLoad(() => api.adminProducts(new URLSearchParams({ page: String(page), limit: '20', archived: 'false' })), [page]);

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
        {result.loading ? <Loading label="Loading products…" /> : result.data?.data.length ? <div className="super-admin-table-wrap"><table className="super-admin-table"><thead><tr><th>Product</th><th>Seller</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th></tr></thead><tbody>{result.data.data.map((product) => <tr key={product._id}><td><Link to={`/super-admin/products/${product._id}`}>{product.name}</Link></td><td>{product.sellerId ? <Link to={`/super-admin/sellers/${product.sellerId}`}>{product.sellerId.slice(-6)}</Link> : 'Unassigned'}</td><td>{product.category}</td><td>{formatMoney(product.pricePaise)}</td><td>{product.variants?.length ? product.variants.reduce((sum, variant) => sum + variant.stock, 0) : product.stock}</td><td><StatusBadge value={product.isActive ? 'active' : product.isArchived ? 'archived' : 'inactive'} /></td></tr>)}</tbody></table></div> : <div className="super-admin-empty">No products have been added to the catalog yet.</div>}
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
      <div className="super-admin-page-heading"><div><p className="super-admin-eyebrow"><Link to="/super-admin/products">Products & Inventory</Link> / Product</p><h1>{product.name}</h1><p>{product.category} · product ID {product._id}</p></div></div>
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
          <div><dt>Category</dt><dd>{product.category}</dd></div>
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
    <SuperAdminModulePage
      eyebrow="Operations"
      title="Support & Disputes"
      description="Track active support cases, dispute workflow, and service issues across the marketplace."
      metrics={[
        { label: 'Open Cases', value: '0', detail: 'Awaiting triage', icon: 'support' },
        { label: 'Priority', value: '0', detail: 'High-priority cases', icon: 'orders' },
        { label: 'Assignments', value: '0', detail: 'Cases assigned to staff', icon: 'administrators' },
        { label: 'Resolved Today', value: '0', detail: 'Closed in the current day', icon: 'overview' },
      ]}
      note="Support records should tie back to the original order, customer, seller, or partner without exposing private notes to unintended roles."
    />
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
    <SuperAdminModulePage
      eyebrow="Finance"
      title="Refunds"
      description="Track refund requests, decision status, and payment-backout processing for approved order cases."
      metrics={[
        { label: 'Refund Requests', value: '0', detail: 'Open cases', icon: 'refunds' },
        { label: 'Approved', value: '0', detail: 'Approved in the current cycle', icon: 'overview' },
        { label: 'Processing', value: '0', detail: 'In progress', icon: 'payments' },
        { label: 'Rejected', value: '0', detail: 'Needs reasoned closure', icon: 'security' },
      ]}
      note="Refund workflows remain independent from general payment status and should respect approved business policy before execution."
    />
  );
}

function SuperAdminSettlementsPage(): ReactNode {
  return (
    <SuperAdminModulePage
      eyebrow="Finance"
      title="Seller Settlements"
      description="Review shop earnings, withheld balances, and settlement liabilities by seller or SHG."
      metrics={[
        { label: 'Seller Liabilities', value: '₹0', detail: 'Outstanding settlement amount', icon: 'settlements' },
        { label: 'Settled This Period', value: '₹0', detail: 'Paid to sellers', icon: 'payments' },
        { label: 'Pending Review', value: '0', detail: 'Requires admin check', icon: 'support' },
        { label: 'Approved SHGs', value: '0', detail: 'Eligible seller accounts', icon: 'sellers' },
      ]}
      note="Seller settlements should reflect approved business rules and may be withheld until verification or required compliance steps are completed."
    />
  );
}

function SuperAdminPayoutsPage(): ReactNode {
  return (
    <SuperAdminModulePage
      eyebrow="Finance"
      title="Delivery Partner Payouts"
      description="Track partner earnings, payout readiness, and awaiting-disbursement records for delivery work."
      metrics={[
        { label: 'Due Payouts', value: '₹0', detail: 'Pending partner disbursements', icon: 'payouts' },
        { label: 'Approved', value: '₹0', detail: 'Ready for payout', icon: 'overview' },
        { label: 'Processing', value: '0', detail: 'In disbursement queue', icon: 'payments' },
        { label: 'Exceptions', value: '0', detail: 'Manual review required', icon: 'support' },
      ]}
      note="Payout liability must be tracked separately from order totals and should exclude amounts not yet approved or verified."
    />
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
    ['Admin', 'Marketplace-wide', 'Admin APIs for orders, customers, catalogue, and settings', <Link key="access" to="/admin">Admin workspace</Link>],
    ['City Admin', 'Assigned city', 'City-scoped order operations; cannot grant broader roles', <Link key="access" to="/super-admin/city-administrators">City Admin directory</Link>],
    ['Seller', 'Own account', 'Own products and seller order items', <Link key="access" to="/super-admin/sellers">Seller directory</Link>],
    ['Delivery Partner', 'Own assignments', 'Assigned delivery updates and history', <Link key="access" to="/super-admin/delivery-partners">Partner directory</Link>],
    ['Customer', 'Own account', 'Own profile, addresses, and orders', <Link key="access" to="/super-admin/customers">Customer directory</Link>],
    ['Staff', 'Admin workspace', 'Limited by staff-enabled setting and route-level policy', <Link key="access" to="/super-admin/settings">Platform settings</Link>],
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
          <p className="super-admin-data-note">Order value is a sum of non-cancelled order totals; it is not platform revenue, verified collections, or a settlement balance. Cities, seller records, refunds, payouts, and support cases are not yet available in the backend.</p>
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

  return (
    <div className="super-admin-page">
      <div className="super-admin-page-heading">
        <div><p className="super-admin-eyebrow">Operations</p><h1>Orders & Assignments</h1><p>Read-only order records and current payment and fulfilment states.</p></div>
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
          <div className="super-admin-panel-heading"><div><h2>Customer & destination</h2><p>Order-linked customer and delivery details.</p></div></div>
          <dl className="super-admin-definition-list">
            <div><dt>Customer</dt><dd>{order.customerId ? <Link to={`/super-admin/customers/${order.customerId}`}>{order.customerName}</Link> : order.customerName}</dd></div>
            <div><dt>Phone</dt><dd>{order.customerPhoneE164 || order.customerPhone || '—'}</dd></div>
            <div><dt>City</dt><dd>{order.address?.city ? <Link to={`/super-admin/cities/${encodeURIComponent(order.address.city)}`}>{order.address.city}</Link> : 'Pickup'}</dd></div>
            <div><dt>Locality</dt><dd>{order.address?.locality || '—'}</dd></div>
            <div><dt>Delivery partner</dt><dd>{order.deliveryPartner?.userId ? <Link to={`/super-admin/delivery-partners/${order.deliveryPartner.userId}`}>{order.deliveryPartner.name}</Link> : order.deliveryPartner?.name || 'Not assigned'}</dd></div>
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
    placed: '#d99116', accepted: '#7351a6', preparing: '#ce6d3d', ready_for_pickup: '#3e81ae',
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
        <thead><tr><th>Order</th><th>Customer</th><th>City</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>Assigned partner</th></tr></thead>
        <tbody>{orders.map((order) => (
          <tr key={order._id}>
            <td><Link to={`/super-admin/orders/${order._id}`}>{order.orderReference}</Link><small>{new Date(order.createdAt).toLocaleDateString('en-IN')}</small></td>
            <td>{order.customerId ? <Link to={`/super-admin/customers/${order.customerId}`}>{order.customerName}</Link> : order.customerName}</td>
            <td>{order.address?.city ? <Link to={`/super-admin/cities/${encodeURIComponent(order.address.city)}`}>{order.address.city}</Link> : 'Pickup'}</td>
            <td className="super-admin-order-items">{order.items.map((item) => item.productName).slice(0, 2).join(', ')}{order.items.length > 2 ? ` +${order.items.length - 2}` : ''}</td>
            <td>{formatMoney(order.totalPaise)}</td>
            <td><span className="super-admin-payment">{order.paymentMethod.toUpperCase()}</span><small>{order.paymentStatus.replaceAll('_', ' ')}</small></td>
            <td><span className={`super-admin-status-badge status-${order.fulfilmentStatus}`}>{orderStatusLabel(order.fulfilmentStatus)}</span></td>
            <td>{order.deliveryPartner?.userId ? <Link to={`/super-admin/delivery-partners/${order.deliveryPartner.userId}`}>{order.deliveryPartner.name}</Link> : order.deliveryPartner?.name || '—'}</td>
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
      { label: 'My Service Zones', icon: 'cities' },
      { label: 'Sellers & SHGs', icon: 'sellers' },
      { label: 'Products & Inventory', icon: 'products' },
      { label: 'Orders & Assignments', icon: 'orders', path: '/city-admin/orders' },
      { label: 'Delivery Partners', icon: 'delivery' },
      { label: 'Customers', icon: 'customers' },
      { label: 'Support & Disputes', icon: 'support' },
    ],
  },
  { label: 'Finance', items: [{ label: 'Payment Issues', icon: 'payments' }, { label: 'Refund Requests', icon: 'refunds' }] },
  { label: 'Reporting', items: [{ label: 'City Reports & Analytics', icon: 'reports' }] },
  { label: 'Account', items: [{ label: 'My Profile', icon: 'roles' }, { label: 'Notifications', icon: 'support' }] },
];

function CityAdminLayout({ children }: { children: ReactNode }): ReactNode {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const displayName = user?.name || 'City Administrator';

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
        <Link to="/city-admin" className="city-admin-brand"><img src="/images/esakhi-emblem.png" alt="" /><span>eSakhi<small>CITY ADMIN</small></span></Link>
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
          <div className="city-admin-topbar-actions"><span className="city-admin-live-label"><i /> Live operations</span><button className="city-admin-notifications" type="button" disabled title="Notification center is not available yet" aria-label="Notifications are not available yet"><SuperAdminIcon name="support" /></button><Link to="/help" className="city-admin-help" aria-label="Help">?</Link><button className="city-admin-mobile-signout" onClick={() => void handleSignOut()}>Sign out</button></div>
        </header>
        {children}
      </main>
    </div>
  );
}

function CityAdminDashboardPage(): ReactNode {
  const result = useLoad(() => api.cityAdminDashboard());
  useRefreshOnFocus(result.reload);
  const dashboard = result.data;
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
          <div className="city-admin-metrics">
            <CityAdminMetric label="Today’s Orders" value={metrics.todayOrders} icon="orders" />
            <CityAdminMetric label="Awaiting Assignment" value={metrics.awaitingAssignment} icon="delivery" alert />
            <CityAdminMetric label="Out for Delivery" value={metrics.outForDelivery} icon="providers" />
            <CityAdminMetric label="Delivered Today" value={metrics.deliveredToday} icon="overview" />
            <CityAdminMetric label="Active Partners" value="Unavailable" icon="delivery" unavailable />
            <CityAdminMetric label="Partner Applications" value="Unavailable" icon="administrators" unavailable />
            <CityAdminMetric label="Sellers Awaiting Review" value="Unavailable" icon="sellers" unavailable />
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
                  <span><strong>#{exception.orderReference} · Awaiting assignment</strong><small>{exception.address?.locality ?? 'Locality not recorded'} · Created {formatElapsed(exception.createdAt)} ago</small></span>
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

function CityAdminOrdersPage(): ReactNode {
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [queryText, setQueryText] = useState(() => searchParams.get('q') ?? '');
  const [status, setStatus] = useState(() => searchParams.get('fulfilmentStatus') ?? '');
  const [paymentStatus, setPaymentStatus] = useState(() => searchParams.get('paymentStatus') ?? '');
  const unassignedOnly = searchParams.get('unassignedOnly') === 'true';
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (queryText.trim()) query.set('q', queryText.trim());
  if (status) query.set('fulfilmentStatus', status);
  if (paymentStatus) query.set('paymentStatus', paymentStatus);
  if (unassignedOnly) query.set('unassignedOnly', 'true');
  const result = useLoad(() => api.cityAdminOrders(query), [page, queryText, status, paymentStatus, unassignedOnly]);

  return (
    <div className="city-admin-page">
      <div className="city-admin-page-heading"><div><p className="city-admin-eyebrow">Local operations</p><h1>Orders & Assignments</h1><p>Read-only orders placed for your assigned city. Other cities are excluded by the backend.</p></div></div>
      {result.error && <div className="city-admin-error" role="alert">{result.error}<button onClick={() => void result.reload()}>Retry</button></div>}
      <section className="city-admin-panel city-admin-order-directory">
        {unassignedOnly && <div className="city-admin-filter-note">Showing delivery orders awaiting a partner. <Link to="/city-admin/orders">Clear filter</Link></div>}
        <div className="city-admin-order-tools">
          <label className="city-admin-search-field"><span aria-hidden="true">⌕</span><input aria-label="Search order reference or customer" placeholder="Search order or customer" value={queryText} onChange={(event) => { setPage(1); setQueryText(event.target.value); }} /></label>
          <select aria-label="Filter by fulfilment status" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}>
            <option value="">All fulfilment states</option><option value="placed">Placed</option><option value="accepted">Accepted</option><option value="preparing">Preparing</option><option value="ready_for_pickup">Ready for pickup</option><option value="out_for_delivery">Out for delivery</option><option value="delivered">Delivered</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="delivery_failed">Delivery failed</option>
          </select>
          <select aria-label="Filter by payment status" value={paymentStatus} onChange={(event) => { setPage(1); setPaymentStatus(event.target.value); }}>
            <option value="">All payment states</option><option value="pending_verification">Awaiting review</option><option value="confirmed">Confirmed</option><option value="rejected">Rejected</option>
          </select>
        </div>
        {result.loading ? <Loading label="Loading city orders…" /> : result.data?.data.length ? <CityAdminOrderTable orders={result.data.data} /> : <div className="city-admin-empty">No city orders match these filters.</div>}
        {result.data && result.data.pagination.totalPages > 1 && <Pagination page={page} pages={result.data.pagination.totalPages} onChange={setPage} />}
      </section>
    </div>
  );
}

function CityAdminMetric({ label, value, icon, alert = false, unavailable = false }: { label: string; value: number | string; icon: string; alert?: boolean; unavailable?: boolean }): ReactNode {
  return <article className={`city-admin-metric${alert ? ' is-alert' : ''}${unavailable ? ' is-unavailable' : ''}`}><div><span>{label}</span><SuperAdminIcon name={icon} /></div><strong>{typeof value === 'number' ? value.toLocaleString('en-IN') : value}</strong><small>{unavailable ? 'Not tracked by city scope' : alert ? 'Needs attention' : 'Live city-scoped data'}</small></article>;
}

function CityAdminOrderTable({ orders }: { orders: CityAdminOrder[] }): ReactNode {
  return (
    <div className="city-admin-table-wrap"><table className="city-admin-table">
      <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>Partner</th><th>Created</th></tr></thead>
      <tbody>{orders.map((order) => <tr key={order._id}>
        <td><strong>#{order.orderReference}</strong><small>{order.address?.locality ?? 'Pickup order'}</small></td>
        <td>{order.customerName}</td>
        <td className="city-admin-items">{order.items.map((item) => item.productName).slice(0, 2).join(', ')}{order.items.length > 2 ? ` +${order.items.length - 2}` : ''}</td>
        <td>{formatMoney(order.totalPaise)}</td>
        <td><span className={`city-admin-payment ${order.paymentStatus}`}>{order.paymentMethod === 'cash' ? 'COD' : 'UPI'}</span><small>{order.paymentStatus.replaceAll('_', ' ')}</small></td>
        <td><span className={`super-admin-status-badge status-${order.fulfilmentStatus}`}>{orderStatusLabel(order.fulfilmentStatus)}</span></td>
        <td>{order.deliveryPartner?.name ?? 'Unassigned'}</td>
        <td>{new Date(order.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
      </tr>)}</tbody>
    </table></div>
  );
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
  if (adminOnly && user.role !== 'admin') return <div className="page-container narrow"><Notice tone="error">This workspace action requires an administrator account.</Notice><Link to="/admin" className="button button-outline">Back to workspace</Link></div>;
  if (!adminOnly && user.role !== 'admin' && user.role !== 'staff') return <div className="page-container narrow"><Notice tone="error">Your account does not have workspace access.</Notice></div>;
  return <AdminLayout>{children}</AdminLayout>;
}

function AdminLayout({ children }: { children: ReactNode }): ReactNode {
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  return <div className="admin-shell"><aside className="admin-sidebar"><Link to="/admin" className="admin-brand"><img src="/images/esakhi-emblem.png" alt="" /><span>eSakhi<br /><small>Maker workspace</small></span></Link><span className="sidebar-label">WORKSPACE</span><nav className="admin-nav"><NavLink to="/admin" end>Overview</NavLink><NavLink to="/admin/products">Products</NavLink>{admin && <NavLink to="/admin/inventory">Inventory</NavLink>}<NavLink to="/admin/orders">Orders</NavLink>{admin && <NavLink to="/admin/delivery-partners">Delivery Partners</NavLink>}{admin && <NavLink to="/admin/customers">Customers</NavLink>}{admin && <NavLink to="/admin/settings">Store settings</NavLink>}<NavLink to="/admin/system">API status</NavLink></nav><div className="sidebar-user"><span className="avatar">{(user?.name || 'E').slice(0, 1).toUpperCase()}</span><span><strong>{user?.name || user?.phone}</strong><small>{user?.role}</small></span></div></aside><section className="admin-content">{children}</section></div>;
}

function AdminDashboardPage(): ReactNode {
  const result = useLoad(() => api.dashboard());
  const dashboard = result.data;
  return <div className="admin-page"><PageIntro eyebrow="Maker workspace" title="Good work starts with a clear view." description="Live operational data from your eSakhi store." />{result.error && <Notice tone="error">{result.error}</Notice>}{result.loading ? <Loading /> : dashboard && <><div className="metric-grid"><Metric label="Orders needing action" value={dashboard.ordersNeedingAction} /><Metric label="Payments to review" value={dashboard.pendingPayments} /><Metric label="Low-stock items" value={dashboard.lowStockItems} /></div><div className="admin-panel"><div className="panel-heading"><div><span className="eyebrow">Latest activity</span><h2>Recent orders</h2></div><Link to="/admin/orders" className="quiet-link">Open orders →</Link></div>{dashboard.recentOrders.length ? <div className="admin-table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Fulfilment</th></tr></thead><tbody>{dashboard.recentOrders.map((order) => <tr key={order._id}><td><Link to={`/admin/orders/${order._id}`}>{order.orderReference}</Link></td><td>{order.customerName}</td><td>{formatMoney(order.totalPaise)}</td><td><StatusBadge value={order.paymentStatus} /></td><td><StatusBadge value={order.fulfilmentStatus} /></td></tr>)}</tbody></table></div> : <EmptyState title="No orders to show yet">New orders will appear here when customers check out.</EmptyState>}</div></>}{result.error && <button className="button button-outline" onClick={() => void result.reload()}>Retry</button>}</div>;
}

function Metric({ label, value }: { label: string; value: number }): ReactNode {
  return <article className="metric-card"><span>{label}</span><strong>{value.toLocaleString('en-IN')}</strong><i aria-hidden="true">✿</i></article>;
}

function AdminProductsPage(): ReactNode {
  const [queryText, setQueryText] = useState('');
  const [active, setActive] = useState('');
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Product | null | false>(false);
  const query = new URLSearchParams({ page: String(page), limit: '20', archived: 'false' });
  if (queryText.trim()) query.set('q', queryText.trim());
  if (active) query.set('active', active);
  const products = useLoad(() => api.adminProducts(query), [page, queryText, active]);
  const { user } = useAuth();
  const refresh = () => void products.reload();
  return <div className="admin-page"><PageIntro eyebrow="Your collection" title="Product catalogue" description="Product details and prices are managed by the store. Stock is adjusted separately." />{products.error && <Notice tone="error">{products.error}</Notice>}<div className="admin-toolbar"><label className="search-field"><span className="sr-only">Search products</span><input placeholder="Search products" value={queryText} onChange={(event) => { setPage(1); setQueryText(event.target.value); }} /><span>⌕</span></label><select aria-label="Filter by active status" value={active} onChange={(event) => { setPage(1); setActive(event.target.value); }}><option value="">All active states</option><option value="true">Active</option><option value="false">Inactive</option></select>{user?.role === 'admin' && <button className="button" onClick={() => setEditor(null)}>Add product +</button>}</div>{products.loading ? <Loading /> : products.data?.data.length ? <div className="admin-table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Visibility</th><th>Actions</th></tr></thead><tbody>{products.data.data.map((item) => <tr key={getId(item)}><td><div className="table-product">{item.imageUrls?.[0] ? <img src={resolveProductImageUrl(item.imageUrls[0])} alt="" /> : <span className="table-image-placeholder">✿</span>}<span><strong>{item.name}</strong><small>{item.slug}</small></span></div></td><td>{item.category}</td><td>{formatMoney(item.pricePaise)}</td><td>{item.variants?.length ? `${item.variants.length} options` : item.stock}</td><td><StatusBadge value={item.isActive ? 'active' : 'inactive'} />{user?.role === 'admin' && <button className="text-button danger-text" aria-label={`Delete ${item.name}`} onClick={() => void archive(item, refresh)}>Delete</button>}</td><td className="table-actions">{user?.role === 'admin' ? <button className="text-button" onClick={() => setEditor(item)}>Edit</button> : <span>Read only</span>}</td></tr>)}</tbody></table></div> : !products.loading && <EmptyState title="No products match these filters" />}{products.data?.pagination.totalPages && products.data.pagination.totalPages > 1 && <Pagination page={page} pages={products.data.pagination.totalPages} onChange={setPage} />}{editor !== false && <ProductEditor product={editor} onClose={() => setEditor(false)} onSaved={refresh} />}</div>;
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
    category: product?.category ?? 'Bangles',
    price: product ? String(product.pricePaise / 100) : '',
    images: product?.imageUrls ?? [],
    stock: String(product?.stock ?? 0),
    lowStockThreshold: String(product?.lowStockThreshold ?? 5),
    isActive: product?.isActive ?? false,
  });
  const [files, setFiles] = useState<File[]>([]);
  const update = (key: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const imageUrls = [...form.images];
      for (const file of files) {
        const uploaded = await api.uploadProductImage(file);
        imageUrls.push(uploaded.imageUrl);
      }
      const payload: Record<string, unknown> = {
        name: form.name, slug: form.slug, description: form.description, category: form.category,
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
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="product-editor-title"><div className="modal-heading"><h2 id="product-editor-title">{product ? 'Edit product' : 'Add a product'}</h2><button className="close-button" onClick={onClose} aria-label="Close">×</button></div><p>Choose up to 10 JPEG, PNG, or WebP images (5 MB max each). Stock changes use Inventory.</p>{error && <Notice tone="error">{error}</Notice>}{categories.error && <Notice tone="error">{categories.error}</Notice>}<form className="stack-form" onSubmit={(event) => void submit(event)}><div className="form-grid"><label className="field"><span>Product name</span><input required maxLength={160} value={form.name} onChange={(event) => update('name', event.target.value)} /></label><label className="field"><span>URL slug</span><input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={form.slug} onChange={(event) => update('slug', event.target.value)} /></label><label className="field"><span>Category</span><select required value={form.category} onChange={(event) => update('category', event.target.value)}>{!categories.data?.includes(form.category) && <option value={form.category}>{form.category}</option>}{(categories.data ?? []).map((category) => <option key={category} value={category}>{category}</option>)}</select></label><label className="field"><span>Price (INR)</span><input required type="number" min="0.01" step="0.01" value={form.price} onChange={(event) => update('price', event.target.value)} /></label><label className="field"><span>Low stock threshold</span><input type="number" min="0" value={form.lowStockThreshold} onChange={(event) => update('lowStockThreshold', event.target.value)} /></label>{!product && <label className="field"><span>Initial stock</span><input type="number" min="0" value={form.stock} onChange={(event) => update('stock', event.target.value)} /></label>}<label className="field span-two"><span>Description</span><textarea required maxLength={5000} rows={4} value={form.description} onChange={(event) => update('description', event.target.value)} /></label><div className="field span-two"><span>Product images</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={chooseImages} disabled={saving || form.images.length + files.length >= 10} /><div className="image-upload-list">{form.images.map((image) => <div className="image-upload-item" key={image}><img src={resolveProductImageUrl(image)} alt="" /><span>{image.split('/').pop()}</span><button type="button" className="text-button danger-text" onClick={() => setForm((current) => ({ ...current, images: current.images.filter((item) => item !== image) }))} disabled={saving}>Remove</button></div>)}{files.map((file, index) => <div className="image-upload-item" key={`${file.name}-${index}`}><span>{file.name}</span><button type="button" className="text-button danger-text" onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} disabled={saving}>Remove</button></div>)}</div></div><label className="checkbox-field span-two"><input type="checkbox" checked={form.isActive} onChange={(event) => update('isActive', event.target.checked)} /><span>Visible in public catalogue</span></label></div><div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button className="button" disabled={saving || categories.loading || !categories.data?.length}>{saving ? 'Uploading and saving…' : 'Save product'}</button></div></form></section></div>;
}

function AdminInventoryPage(): ReactNode {
  const [page, setPage] = useState(1);
  const products = useLoad(() => api.adminProducts(new URLSearchParams({ page: String(page), limit: '100', archived: 'false' })), [page]);
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
  return <div className="admin-page"><PageIntro eyebrow="Stock control" title="Inventory" description="Every adjustment is recorded with a reason. Product edit screens do not change stock." />{products.error && <Notice tone="error">{products.error}</Notice>}{products.loading ? <Loading /> : <><div className="admin-panel"><div className="panel-heading"><div><span className="eyebrow">Current inventory</span><h2>Stock at a glance</h2></div></div>{products.data?.data.length ? <div className="admin-table-wrap"><table><thead><tr><th>Product</th><th>Stock</th><th>Low stock at</th><th>Variants</th></tr></thead><tbody>{products.data.data.map((product) => <tr key={getId(product)}><td>{product.name}</td><td>{product.variants.length ? 'By option' : product.stock}</td><td>{product.lowStockThreshold}</td><td>{product.variants.length || '—'}</td></tr>)}</tbody></table></div> : <EmptyState title="No products in inventory" />}{products.data?.pagination.totalPages && products.data.pagination.totalPages > 1 && <Pagination page={page} pages={products.data.pagination.totalPages} onChange={setPage} />}</div><form className="panel stock-form" onSubmit={(event) => void submit(event)}><span className="eyebrow">Record a change</span><h2>Adjust stock</h2>{error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}<div className="form-grid"><label className="field span-two"><span>Product (current page)</span><select required value={selection} onChange={(event) => { setSelection(event.target.value); setVariantId(''); }}><option value="">Choose a product</option>{(products.data?.data ?? []).map((product) => <option key={getId(product)} value={getId(product)}>{product.name}</option>)}</select></label>{Boolean(selected?.variants.length) && <label className="field span-two"><span>Variant</span><select required value={variantId} onChange={(event) => setVariantId(event.target.value)}><option value="">Choose option</option>{selected?.variants.map((variant) => <option key={variant._id} value={variant._id}>{Object.values(variant.attributes).join(' · ') || variant.sku}</option>)}</select></label>}<label className="field"><span>Quantity change (+/-)</span><input required type="number" min="-100000" max="100000" value={quantityChange} onChange={(event) => setQuantityChange(event.target.value)} /></label><label className="field"><span>Reason</span><input required maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Restock, correction…" /></label></div><button className="button" disabled={saving || !selection}>{saving ? 'Recording…' : 'Record adjustment'}</button></form></>}</div>;
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
  const admin = user?.role === 'admin';
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

function SellerGate({ children }: { children: ReactNode }): ReactNode {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="page-container"><Loading label="Checking your session…" /></div>;
  if (!user) return <div className="page-container narrow"><PageIntro eyebrow="Seller workspace" title="Please sign in" description="Sign in with an approved seller account to view your store." /><Link to="/sign-in" state={{ from: location.pathname }} className="button">Sign in</Link></div>;
  if (user.role !== 'seller') return <div className="page-container narrow"><Notice tone="error">This workspace is available only to approved seller accounts.</Notice></div>;
  return children;
}

function SellerPortalPage(): ReactNode {
  const { user, signOut } = useAuth();
  const [view, setView] = useState<'overview' | 'products' | 'orders' | 'profile'>('overview');
  const dashboard = useLoad(() => api.sellerDashboard(), [user?.id]);
  const products = useLoad(() => api.sellerProducts(1, 100), [user?.id]);
  const orders = useLoad(() => api.sellerOrders(1, 100), [user?.id]);
  useRefreshOnFocus(dashboard.reload);
  useRefreshOnFocus(products.reload);
  useRefreshOnFocus(orders.reload);
  const data = dashboard.data;
  const metrics = data?.metrics;

  const sidebar = (
    <>
      <button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}><span>⌂</span>Overview</button>
      <button className={view === 'profile' ? 'active' : ''} onClick={() => setView('profile')}><span>◯</span>My Store Profile</button>
      <button className={view === 'products' ? 'active' : ''} onClick={() => setView('products')}><span>◇</span>Products</button>
      <button className="is-unavailable" disabled title="Seller inventory updates are not available yet"><span>▦</span>Inventory <small>Read only</small></button>
      <button className={view === 'orders' ? 'active' : ''} onClick={() => setView('orders')}><span>▤</span>Orders</button>
      <button className="is-unavailable" disabled title="Seller order preparation actions are not available yet"><span>◷</span>Processing <small>Read only</small></button>
      <button className="is-unavailable" disabled title="Settlements are not tracked yet"><span>₹</span>Earnings & Settlements <small>Unavailable</small></button>
      <button className="is-unavailable" disabled title="Seller reviews are not available yet"><span>☆</span>Reviews & Feedback <small>Unavailable</small></button>
    </>
  );
  const title = view === 'products' ? 'Products' : view === 'orders' ? 'Orders' : view === 'profile' ? 'My store profile' : 'Seller overview';
  const orderRows = (rows: SellerOrder[]) => rows.length ? (
    <div className="seller-order-list">{rows.map((order) => <article className="seller-order-row" key={order._id}>
      <div><span className="seller-kicker">{order.orderReference}</span><strong>{order.items.map((item) => `${item.productName} × ${item.quantity}`).join(', ')}</strong><small>{new Date(order.createdAt).toLocaleString('en-IN')} · {order.fulfilmentMethod}</small></div>
      <div><StatusBadge value={order.fulfilmentStatus} fulfilmentMethod={order.fulfilmentMethod} /><strong>{formatMoney(order.subtotalPaise)}</strong><small>Seller item subtotal</small></div>
    </article>)}</div>
  ) : <div className="seller-empty"><span aria-hidden="true">✿</span><strong>No orders to show</strong><small>Orders containing your products will appear here.</small></div>;

  return <div className="seller-portal">
    <aside className="seller-sidebar">
      <Link to="/" className="seller-brand"><span className="seller-brand-mark">ई</span><span><strong>E Sakhi</strong><small>SELLER</small></span></Link>
      <div className="seller-account-summary"><span>{(user?.name?.trim().charAt(0) || 'S').toLocaleUpperCase('en-IN')}</span><div><strong>{user?.name || 'Seller account'}</strong><small>Seller workspace</small></div></div>
      <span className="seller-nav-heading">MY BUSINESS</span>
      <nav>{sidebar}</nav>
      <div className="seller-support-note"><strong>Need help?</strong><small>For seller assistance, contact the eSakhi support team.</small><Link to="/help">Help & support →</Link></div>
    </aside>
    <main className="seller-main">
      <header className="seller-topbar"><Link to="/" className="seller-topbar-brand">E Sakhi</Link><div><span>{user?.name || 'Seller'}</span><Link to="/account/profile">Profile</Link><button onClick={() => void signOut()}>Sign out</button></div></header>
      <div className="seller-page">
        <div className="seller-page-heading"><div><span className="seller-kicker">✓ SELLER ACCOUNT</span><h1>{view === 'overview' ? `Namaste${user?.name ? `, ${user.name}` : ''}!` : title}</h1><p>{view === 'overview' ? 'Here is an overview of your products and orders.' : 'Seller workspace data is scoped to your account.'}</p></div>
          {view === 'products' && <button className="seller-secondary-action" disabled title="Product creation is not available in the seller API">＋ Add product · unavailable</button>}
        </div>
        {(dashboard.error || products.error || orders.error) && <Notice tone="error">{dashboard.error || products.error || orders.error}</Notice>}
        {view === 'overview' && <>
          <section className="seller-metrics">
            <SellerMetric label="New orders" value={metrics?.newOrders} icon="▤" unavailable={!metrics} />
            <SellerMetric label="Orders to prepare" value={metrics?.ordersToPrepare} icon="◷" unavailable={!metrics} />
            <SellerMetric label="Active products" value={metrics?.activeProducts} icon="◇" unavailable={!metrics} />
            <SellerMetric label="Low stock" value={metrics?.lowStockProducts} icon="!" alert />
            <SellerMetric label="Gross paid product sales · this month" value={metrics ? formatMoney(metrics.grossPaidProductSalesThisMonthPaise) : undefined} icon="↗" unavailable={!metrics} />
            <SellerMetric label="Settlement balance" value="Unavailable" icon="₹" unavailable />
          </section>
          <div className="seller-content-grid">
            <section className="seller-panel seller-sales-panel"><div className="seller-panel-heading"><div><h2>Sales overview</h2><p>Confirmed paid item totals for this month, before any settlement adjustments.</p></div></div><div className="seller-sales-value">{metrics ? formatMoney(metrics.grossPaidProductSalesThisMonthPaise) : <Loading label="Loading sales…" />}</div><Notice>Sales history, commission deductions, pending settlements, and payouts are not currently available.</Notice></section>
            <section className="seller-panel"><div className="seller-panel-heading"><div><h2>Store progress</h2><p>Manage your catalogue and profile.</p></div></div><div className="seller-progress-list"><button onClick={() => setView('profile')}>Review account profile <span>→</span></button><button onClick={() => setView('products')}>View your products <span>{products.data?.pagination.total ?? '…'}</span></button><button disabled title="Product creation is unavailable">Add product <span>Unavailable</span></button></div></section>
          </div>
          <section className="seller-panel seller-recent-orders"><div className="seller-panel-heading"><div><h2>Recent orders</h2><p>Orders that include your products.</p></div><button onClick={() => setView('orders')}>View orders →</button></div>{orders.loading ? <Loading label="Loading seller orders…" /> : orders.error ? null : orderRows(data?.recentOrders ?? [])}</section>
          <p className="seller-data-note">Product and order information is restricted to this seller account. Order totals show only your own items. Order acceptance/preparation actions and settlement calculations are not yet available.</p>
        </>}
        {view === 'products' && <section className="seller-panel"><div className="seller-panel-heading"><div><h2>Your products</h2><p>Read-only catalogue view for products assigned to your seller account.</p></div></div>{products.loading ? <Loading label="Loading products…" /> : products.data?.data.length ? <div className="seller-product-list">{products.data.data.map((product) => <article className="seller-product-row" key={product._id}><span className="seller-product-image">{product.imageUrls[0] ? <img src={resolveProductImageUrl(product.imageUrls[0])} alt="" /> : '✿'}</span><span><strong>{product.name}</strong><small>{product.category} · {product.isActive ? 'Active' : 'Inactive'}</small></span><span><strong>{formatMoney(product.pricePaise)}</strong><small>{product.variants.length ? `${product.variants.reduce((sum, variant) => sum + variant.stock, 0)} variant units` : `${product.stock} in stock`}</small></span></article>)}</div> : <div className="seller-empty"><span>◇</span><strong>No products are assigned to your account</strong><small>Products must be assigned through an approved seller workflow.</small></div>}</section>}
        {view === 'orders' && <section className="seller-panel"><div className="seller-panel-heading"><div><h2>Your orders</h2><p>Only items associated with your seller account are shown.</p></div></div>{orders.loading ? <Loading label="Loading seller orders…" /> : orders.error ? null : orderRows(orders.data?.data ?? [])}</section>}
        {view === 'profile' && <section className="seller-panel seller-profile-panel"><div className="seller-panel-heading"><div><h2>Seller account</h2><p>Account identity currently available to this workspace.</p></div></div><dl><div><dt>Account name</dt><dd>{user?.name || 'Not provided'}</dd></div><div><dt>Phone</dt><dd>{user?.phone || 'Not available'}</dd></div><div><dt>Email</dt><dd>{user?.email || 'Not provided'}</dd></div><div><dt>Seller verification</dt><dd>Application verification status is not stored in the current backend</dd></div></dl><Link className="seller-profile-link" to="/account/profile">Edit account name →</Link></section>}
      </div>
      <nav className="seller-mobile-nav" aria-label="Seller navigation"><button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>⌂<small>Overview</small></button><button className={view === 'products' ? 'active' : ''} onClick={() => setView('products')}>◇<small>Products</small></button><button className={view === 'orders' ? 'active' : ''} onClick={() => setView('orders')}>▤<small>Orders</small></button><button className={view === 'profile' ? 'active' : ''} onClick={() => setView('profile')}>◯<small>Profile</small></button></nav>
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
  useRefreshOnFocus(orders.reload);
  useRefreshOnFocus(history.reload);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const updateStatus = async (id: string, status: 'out_for_delivery' | 'delivered' | 'delivery_failed', orderReference: string) => {
    const confirmation = status === 'out_for_delivery'
      ? `Start delivery for ${orderReference}?`
      : status === 'delivered'
        ? `Confirm ${orderReference} was delivered to the customer?`
        : `Report delivery failed for ${orderReference}?`;
    if (!window.confirm(confirmation)) return;
    setError('');
    setMessage('');
    try {
      await api.updatePartnerOrderStatus(id, status, note.trim() || undefined);
      setNote('');
      setMessage('Delivery status updated.');
      await Promise.all([orders.reload(false), history.reload(false)]);
    } catch (cause) {
      setError(displayError(cause));
    }
  };
  const activeOrders = orders.data ?? [];
  const deliveryHistory = history.data ?? [];
  const activeDelivery = activeOrders.find((order) => order.fulfilmentStatus === 'out_for_delivery');
  const completedToday = deliveryHistory.filter((order) => {
    if (!['delivered', 'completed'].includes(order.fulfilmentStatus)) return false;
    const completedAt = [...(order.statusHistory ?? [])].reverse().find((event) => ['delivered', 'completed'].includes(event.status))?.changedAt;
    return completedAt ? new Date(completedAt).toDateString() === new Date().toDateString() : false;
  }).length;
  const title = view === 'history' ? 'Delivery history' : view === 'deliveries' ? 'My deliveries' : view === 'profile' ? 'Partner profile' : 'Ready to deliver?';
  const selectView = (next: typeof view) => setView(next);
  const renderOrders = (items: Order[], isHistory = false) => items.length ? (
    <div className="delivery-order-list">{items.map((order) => {
      const onRoute = order.fulfilmentStatus === 'out_for_delivery';
      const destination = order.address;
      const mapQuery = destination
        ? encodeURIComponent([destination.addressLine1, destination.locality, destination.city, destination.postalCode].filter(Boolean).join(', '))
        : '';
      return <article className="delivery-order-card" key={order._id}>
        <div className="delivery-order-heading">
          <div><span className="delivery-section-kicker">ORDER {order.orderReference}</span><h3>{onRoute ? order.customerName : 'Customer details after pickup'}</h3></div>
          <StatusBadge value={order.fulfilmentStatus} fulfilmentMethod={order.fulfilmentMethod} />
        </div>
        <div className="delivery-route">
          <span className="delivery-route-point pickup"><i />Pickup</span>
          <span className="delivery-route-line" />
          <span className="delivery-route-point"><i />{onRoute && destination ? `${destination.locality}, ${destination.city}` : 'Destination shown after dispatch'}</span>
        </div>
        {onRoute && destination && <address>{destination.addressLine1}{destination.addressLine2 ? `, ${destination.addressLine2}` : ''}, {destination.locality}, {destination.city}, {destination.state} {destination.postalCode}</address>}
        <div className="delivery-order-items">{order.items.map((item, index) => <span key={`${item.productId}-${index}`}>{item.productName} × {item.quantity}</span>)}</div>
        <div className="delivery-order-meta"><span>Assigned {order.deliveryPartner?.assignedAt ? new Date(order.deliveryPartner.assignedAt).toLocaleString('en-IN') : '—'}</span>{onRoute && order.customerPhoneE164 && <a href={`tel:${order.customerPhoneE164}`}>Call customer</a>}</div>
        {onRoute && mapQuery && <a className="delivery-map-link" href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`} target="_blank" rel="noreferrer">Open destination in Maps <span aria-hidden="true">↗</span></a>}
        {!isHistory && <div className="delivery-order-actions">
          {['preparing', 'ready_for_pickup'].includes(order.fulfilmentStatus) && <button className="delivery-primary-action" onClick={() => void updateStatus(order._id, 'out_for_delivery', order.orderReference)}>Start delivery</button>}
          {onRoute && <><button className="delivery-primary-action" onClick={() => void updateStatus(order._id, 'delivered', order.orderReference)}>Confirm delivered</button><button className="delivery-secondary-action" onClick={() => void updateStatus(order._id, 'delivery_failed', order.orderReference)}>Report a problem</button></>}
        </div>}
      </article>;
    })}</div>
  ) : <div className="delivery-empty"><span aria-hidden="true">✿</span><h3>{isHistory ? 'No completed deliveries yet' : 'No active deliveries right now'}</h3><p>{isHistory ? 'Completed delivery records will appear here.' : 'Orders assigned to your account will appear here when available.'}</p></div>;

  const nav = (
    <>
      <button className={view === 'overview' ? 'active' : ''} onClick={() => selectView('overview')}><span aria-hidden="true">⌂</span>Overview</button>
      <button className="is-unavailable" disabled title="Delivery offer acceptance is not available yet"><span aria-hidden="true">＋</span>Requests <small>Unavailable</small></button>
      <button className={view === 'deliveries' ? 'active' : ''} onClick={() => selectView('deliveries')}><span aria-hidden="true">▣</span>My deliveries</button>
      <button className={view === 'history' ? 'active' : ''} onClick={() => selectView('history')}><span aria-hidden="true">◷</span>Delivery history</button>
      <button className="is-unavailable" disabled title="Earnings and payout data are not tracked yet"><span aria-hidden="true">₹</span>Earnings & payouts<small>Unavailable</small></button>
      <button className={view === 'profile' ? 'active' : ''} onClick={() => selectView('profile')}><span aria-hidden="true">○</span>Profile</button>
    </>
  );
  return <div className="delivery-portal">
    <header className="delivery-portal-header">
      <Link to="/" className="delivery-portal-brand"><img src="/images/esakhi-emblem.png" alt="" /><span><strong>eSakhi</strong><small>DELIVERY PARTNER</small></span></Link>
      <div className="delivery-header-user"><span>{user?.name || 'Delivery partner'}</span><button onClick={() => void signOut()} className="delivery-signout">Sign out</button></div>
    </header>
    <div className="delivery-portal-layout">
      <aside className="delivery-sidebar"><span className="delivery-sidebar-label">WORKSPACE</span><nav>{nav}</nav><div className="delivery-sidebar-note"><strong>Assigned deliveries</strong><span>Only orders assigned to your account are shown here.</span></div></aside>
      <main className="delivery-main">
        <div className="delivery-page-heading"><div><span className="delivery-section-kicker">E SAKHI · DELIVERY PARTNER</span><h1>{title}</h1><p>{view === 'overview' ? 'Your assigned work and delivery activity.' : view === 'profile' ? 'Your account details and portal availability.' : 'Orders and records connected to your partner account.'}</p></div><button className="delivery-refresh" onClick={() => void Promise.all([orders.reload(), history.reload()])}>Refresh</button></div>
        {error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}
        {view === 'overview' && <>
          <section className="delivery-welcome">
            <div><span className="delivery-section-kicker">GOOD DAY{user?.name ? `, ${user.name.split(' ')[0].toLocaleUpperCase('en-IN')}` : ''}</span><h2>Your delivery workspace</h2><p>Here are the orders currently assigned to your account.</p></div>
            <div className="delivery-availability"><span className="delivery-status-dot" /><span><strong>Assigned orders only</strong><small>Availability controls are not enabled</small></span></div>
          </section>
          <section className="delivery-metrics" aria-label="Delivery summary">
            <article><span className="delivery-metric-icon">▣</span><small>Active deliveries</small><strong>{orders.loading ? '…' : activeOrders.length}</strong><span>Assigned to you</span></article>
            <article><span className="delivery-metric-icon">✓</span><small>Completed today</small><strong>{history.loading ? '…' : completedToday}</strong><span>From delivery history</span></article>
            <article className="unavailable"><span className="delivery-metric-icon">＋</span><small>Available requests</small><strong>Unavailable</strong><span>Offer system not connected</span></article>
            <article className="unavailable"><span className="delivery-metric-icon">₹</span><small>Today's earnings</small><strong>Unavailable</strong><span>Payout data not tracked</span></article>
          </section>
          <div className="delivery-content-grid">
            <section className="delivery-panel">
              <div className="delivery-panel-heading"><div><span className="delivery-section-kicker">{activeDelivery ? 'ACTIVE DELIVERY' : 'YOUR ASSIGNMENTS'}</span><h2>{activeDelivery ? 'Continue delivery' : 'Assigned deliveries'}</h2></div><button onClick={() => selectView('deliveries')}>View all <span aria-hidden="true">→</span></button></div>
              {orders.loading ? <Loading label="Loading assigned deliveries…" /> : orders.error ? <div className="delivery-panel-state"><Notice tone="error">{orders.error}</Notice><button className="delivery-secondary-action" onClick={() => void orders.reload()}>Try again</button></div> : renderOrders(activeDelivery ? [activeDelivery] : activeOrders.slice(0, 2))}
            </section>
            <aside className="delivery-panel delivery-earnings-panel">
              <div className="delivery-panel-heading"><div><span className="delivery-section-kicker">EARNINGS</span><h2>Earnings & payouts</h2></div></div>
              <div className="delivery-unavailable-block"><span aria-hidden="true">₹</span><strong>Not available yet</strong><p>Earnings and payout records are not currently connected to this portal. No estimate is shown.</p></div>
              <div className="delivery-unavailable-footnote">Offer acceptance, availability settings, zones, and payout history are not yet supported.</div>
            </aside>
          </div>
          <section className="delivery-panel delivery-recent-history"><div className="delivery-panel-heading"><div><span className="delivery-section-kicker">RECENT ACTIVITY</span><h2>Delivery history</h2></div><button onClick={() => selectView('history')}>View history <span aria-hidden="true">→</span></button></div>{history.loading ? <Loading label="Loading delivery history…" /> : history.error ? <Notice tone="error">{history.error}</Notice> : renderOrders(deliveryHistory.slice(0, 2), true)}</section>
        </>}
        {view === 'deliveries' && <section className="delivery-panel"><div className="delivery-panel-heading"><div><span className="delivery-section-kicker">ACTIVE WORK</span><h2>My assigned deliveries</h2></div></div>{orders.loading ? <Loading label="Loading assigned deliveries…" /> : orders.error ? <div className="delivery-panel-state"><Notice tone="error">{orders.error}</Notice><button className="delivery-secondary-action" onClick={() => void orders.reload()}>Try again</button></div> : renderOrders(activeOrders)}</section>}
        {view === 'history' && <section className="delivery-panel"><div className="delivery-panel-heading"><div><span className="delivery-section-kicker">COMPLETED & CLOSED</span><h2>Delivery history</h2></div></div>{history.loading ? <Loading label="Loading delivery history…" /> : history.error ? <Notice tone="error">{history.error}</Notice> : renderOrders(deliveryHistory, true)}</section>}
        {view === 'profile' && <section className="delivery-panel delivery-profile-panel"><div className="delivery-panel-heading"><div><span className="delivery-section-kicker">YOUR ACCOUNT</span><h2>Partner profile</h2></div><Link to="/account/profile">Edit profile <span aria-hidden="true">→</span></Link></div><dl><div><dt>Name</dt><dd>{user?.name || 'Not provided'}</dd></div><div><dt>Phone</dt><dd>{user?.phone || 'Not available'}</dd></div><div><dt>Account</dt><dd>Delivery partner</dd></div><div><dt>Service zones</dt><dd>Not tracked in the current system</dd></div><div><dt>Availability</dt><dd>Portal availability toggle is not connected</dd></div></dl></section>}
        <p className="delivery-data-note">Delivery status changes are saved to the order record. Customer address and phone are shown only after a delivery is out for delivery. This portal does not yet support offer acceptance, partner availability, service zones, or payout calculations.</p>
      </main>
      <nav className="delivery-mobile-nav" aria-label="Delivery portal navigation">
        <button className={view === 'overview' ? 'active' : ''} onClick={() => selectView('overview')}><span>⌂</span>Home</button>
        <button disabled title="Delivery offers unavailable"><span>＋</span>Requests</button>
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

export default App;
