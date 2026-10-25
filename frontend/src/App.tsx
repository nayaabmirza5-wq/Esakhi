import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, api, refreshSession, resolveProductImageUrl, setAccessToken } from './api';
import type { Address, Order, Product, Settings, User } from './types';
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

  // Keep the rest of your original App() code here, unchanged.
  return (
    <AuthContext.Provider value={authValue}>
      <CartContext.Provider value={cartValue}>
        <div className="app-shell">
          <Header theme={theme} setTheme={setTheme} />
          <main id="main-content">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/shop" element={<ShopPage />} />
              <Route path="/products/:slug" element={<ProductPage />} />
              <Route path="/our-story" element={<StoryPage />} />
              <Route path="/signin" element={<SignInPage />} />
              <Route path="/cart" element={<CartPage />} />
              <Route path="/checkout" element={<CheckoutPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/orders/:id" element={<CustomerOrderPage />} />
              <Route path="/delivery-partner" element={<DeliveryPartnerGate><DeliveryPartnerPage /></DeliveryPartnerGate>} />
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
          <Footer />
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
          {user && (user.role === 'admin' || user.role === 'staff') && <NavLink to="/admin">Workspace</NavLink>}
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
          ) : <Link className="button button-small button-outline" to="/signin" state={{ from: location.pathname }}>Sign in</Link>}
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
        <div><strong>Explore</strong><Link to="/shop">Shop handmade</Link><Link to="/our-story">Our story</Link><Link to="/cart">Your bag</Link></div>
        <div><strong>Your account</strong><Link to="/account">Profile</Link><Link to="/orders">Order history</Link><Link to="/signin">Sign in</Link></div>
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

function HomePage(): ReactNode {
  const products = useLoad(() => api.products(new URLSearchParams({ page: '1', limit: '4' })));
  const service = useLoad(() => api.serviceArea());
  const categories = useLoad(() => api.categories());
  const heroProduct = products.data?.data.find((product) => product.imageUrls?.[0]);
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
          <div className="hero-photo">
            {heroProduct?.imageUrls[0] ? <img src={resolveProductImageUrl(heroProduct.imageUrls[0])} alt={`Handmade ${heroProduct.category.toLowerCase()} from the eSakhi catalogue`} /> : <img src="/images/esakhi-emblem.png" alt="eSakhi emblem representing women creating together" />}
          </div>
          <div className="hero-stamp"><img src="/images/esakhi-emblem.png" alt="" /><span>Made<br />together</span></div>
          <div className="hero-note"><span className="note-flower">✿</span><span>Thoughtful craft.<br />A community of makers.</span></div>
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
        <ProductGrid products={products.data?.data ?? []} loading={products.loading} error={products.error} reload={products.reload} />
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
  if (user) return <div className="page-container narrow"><Notice tone="success">You are signed in as {user.name || user.phone}.</Notice><Link to={user.role === 'admin' || user.role === 'staff' ? '/admin' : '/account'} className="button">Continue</Link></div>;
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
      navigate(signInState?.from || (session.user.role === 'admin' || session.user.role === 'staff' ? '/admin' : session.user.role === 'delivery_partner' ? '/delivery-partner' : '/account'), { replace: true, state: signInState?.checkoutState });
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
  if (!user) return <div className="page-container narrow"><PageIntro title="Sign in to continue" description="Orders are linked to your verified phone number." /><Link to="/signin" state={{ from: '/checkout', checkoutState: location.state }} className="button">Sign in</Link></div>;
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
  return <div className="page-container narrow"><PageIntro eyebrow="Your account" title={`Hello${user.name ? `, ${user.name}` : ''}`} description="Manage your profile and find your past orders." /><div className="account-role"><span className="status-dot" /> Signed in as {user.role}</div>{error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}<form className="stack-form panel" onSubmit={(event) => void submit(event)}><label className="field"><span>Your name</span><input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field"><span>Verified phone</span><input value={user.phone ?? ''} disabled /></label><button className="button">Save profile</button></form>{user.role === 'customer' && <section className="panel push-notification-settings"><h2>Order notifications</h2><p>Get a browser notification when your order status changes. Notifications are optional and require browser permission.</p>{pushNotificationsConfigured ? <button className="button button-outline" onClick={() => void togglePush()}>{pushEnabled ? 'Disable on this device' : 'Enable order notifications'}</button> : <Notice>Push notifications are not configured for this app yet.</Notice>}</section>}<div className="account-links"><Link to="/orders" className="button button-outline">View order history</Link>{user.role === 'delivery_partner' && <Link to="/delivery-partner" className="button button-outline">Open delivery portal</Link>}{(user.role === 'admin' || user.role === 'staff') && <Link to="/admin" className="button button-outline">Open workspace</Link>}</div><AddressEditor onSaved={reloadUser} /></div>;
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
  return <div className="page-container narrow"><PageIntro title="Sign in to see your account" description="Your details and orders are available after phone verification." /><Link to="/signin" className="button">Sign in</Link></div>;
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

function AdminGate({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }): ReactNode {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="page-container"><Loading label="Checking your session…" /></div>;
  if (!user) return <div className="page-container narrow"><PageIntro eyebrow="Protected workspace" title="Please sign in" description="Use your authorized eSakhi account to continue." /><Link to="/signin" state={{ from: location.pathname }} className="button">Sign in</Link></div>;
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

function DeliveryPartnerGate({ children }: { children: ReactNode }): ReactNode {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="page-container"><Loading label="Checking your session…" /></div>;
  if (!user) return <div className="page-container narrow"><PageIntro eyebrow="Delivery portal" title="Please sign in" description="Sign in with your delivery partner account to view assigned orders." /><Link to="/signin" state={{ from: location.pathname }} className="button">Sign in</Link></div>;
  if (user.role !== 'delivery_partner') return <div className="page-container narrow"><Notice tone="error">This portal is available only to delivery partners.</Notice></div>;
  return children;
}

function DeliveryPartnerPage(): ReactNode {
  const { user } = useAuth();
  const orders = useLoad(() => api.partnerOrders(), []);
  useRefreshOnFocus(orders.reload);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const updateStatus = async (id: string, status: 'out_for_delivery' | 'delivered' | 'delivery_failed') => {
    setError('');
    setMessage('');
    try {
      await api.updatePartnerOrderStatus(id, status, note.trim() || undefined);
      setNote('');
      setMessage('Delivery status updated.');
      await orders.reload(false);
    } catch (cause) {
      setError(displayError(cause));
    }
  };
  return <div className="page-container">
    <PageIntro eyebrow="Delivery partner portal" title={`Hello${user?.name ? `, ${user.name}` : ''}`} description={`${user?.email ? `${user.email} · ` : ''}${user?.phone ?? ''} · Showing only orders assigned to this account.`} />
    {error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}
    <label className="field"><span>Delivery update note (optional)</span><textarea rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label>
    {orders.loading ? <Loading /> : orders.data?.length ? <div className="order-list">{orders.data.map((order) => <article className="panel delivery-partner-card" key={order._id}>
      <div className="panel-heading"><div><span className="eyebrow">{order.orderReference}</span><h2>{order.customerName}</h2></div><StatusBadge value={order.fulfilmentStatus} fulfilmentMethod={order.fulfilmentMethod} /></div>
      <a href={`tel:${order.customerPhoneE164}`}>Call customer {order.customerPhoneE164}</a>
      {order.address && <address>{order.address.addressLine1}{order.address.addressLine2 ? `, ${order.address.addressLine2}` : ''}, {order.address.locality}, {order.address.city}, {order.address.state} {order.address.postalCode}</address>}
      {order.items.map((item, index) => <span key={`${item.productId}-${index}`}>{item.productName} × {item.quantity}</span>)}
      <small>Assigned {order.deliveryPartner?.assignedAt ? new Date(order.deliveryPartner.assignedAt).toLocaleString('en-IN') : ''}</small>
      {['preparing', 'ready_for_pickup'].includes(order.fulfilmentStatus) && <button className="button" onClick={() => void updateStatus(order._id, 'out_for_delivery')}>Mark out for delivery</button>}
      {order.fulfilmentStatus === 'out_for_delivery' && <div className="button-row"><button className="button" onClick={() => void updateStatus(order._id, 'delivered')}>Mark delivered</button><button className="button button-outline" onClick={() => void updateStatus(order._id, 'delivery_failed')}>Report delivery failed</button></div>}
    </article>)}</div> : !orders.error && <EmptyState title="No orders assigned yet">Assigned delivery orders will appear here.</EmptyState>}
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
  return <div className="admin-page"><div className="breadcrumbs"><Link to="/admin/customers">Customers</Link><span>/</span>Customer profile</div><PageIntro eyebrow="Customer profile" title={record.name || 'Customer'} description={`${record.phone ?? record.phoneE164} · ${record.orderCount} orders`} /><div className="panel user-actions"><div><span>Account status</span><StatusBadge value={record.status ?? 'active'} /></div><div className="button-row"><button className="button button-outline" onClick={() => void change(() => api.updateUserStatus(id, record.status === 'disabled' ? 'active' : 'disabled'), `${record.status === 'disabled' ? 'Enable' : 'Disable'} account`)}>{record.status === 'disabled' ? 'Enable account' : 'Disable account'}</button><button className="button button-outline" onClick={() => void change(() => api.updateRole(id, 'staff'), 'Grant staff access')}>Grant staff access</button><button className="button button-outline" onClick={() => void promoteToPartner()}>Grant delivery partner access</button><button className="button button-outline" onClick={() => void change(() => api.updateRole(id, 'customer'), 'Set role to customer')}>Set as customer</button></div></div>{error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}<section className="admin-panel"><div className="panel-heading"><div><span className="eyebrow">Customer history</span><h2>Orders</h2></div></div>{orders.error && <Notice tone="error">{orders.error}</Notice>}{orders.loading ? <Loading /> : orders.data?.data.length ? <><div className="order-list">{orders.data.data.map((order) => <OrderCard key={order._id} order={order} to={`/admin/orders/${order._id}`} />)}</div>{orders.data.pagination.totalPages > 1 && <Pagination page={page} pages={orders.data.pagination.totalPages} onChange={setPage} />}</> : <EmptyState title="No orders recorded for this customer" />}</section></div>;
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
