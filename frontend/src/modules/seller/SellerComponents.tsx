import { useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useLoad, Loading, Notice, displayError } from '../../ui';
import type { SellerDashboard, SellerInventoryAdjustment } from '../../types';

function formatMoney(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format((paise || 0) / 100);
}

export function SellerSalesTrendChart({ rows }: { rows: SellerDashboard['salesTrend'] }): ReactNode {
  const maxSales = Math.max(...rows.map((row) => row.totalPaise), 1);
  return (
    <div className="seller-chart-wrap">
      <svg className="seller-sales-chart" viewBox="0 0 600 190" role="img" aria-label="Confirmed paid product sales over the last six months">
        {[0, 1, 2].map((line) => (
          <line key={line} x1="30" x2="590" y1={25 + line * 48} y2={25 + line * 48} className="seller-chart-gridline" />
        ))}
        {rows.map((row, index) => {
          const height = row.totalPaise === 0 ? 3 : Math.max(6, (row.totalPaise / maxSales) * 112);
          const x = 54 + index * 91;
          const y = 166 - height;
          return (
            <g key={`${row.month}-${index}`}>
              <title>{row.month}: {formatMoney(row.totalPaise)}</title>
              <rect x={x} y={y} width="42" height={height} rx="7" className="seller-chart-bar" />
              <text x={x + 21} y="183" textAnchor="middle" className="seller-chart-label">{row.month}</text>
            </g>
          );
        })}
      </svg>
      {!rows.some((row) => row.totalPaise > 0) && (
        <p className="seller-chart-empty">Confirmed paid sales will appear here when you receive your first order.</p>
      )}
    </div>
  );
}

export function SellerProfileView({
  profile,
  onSaved,
}: {
  profile: NonNullable<SellerDashboard['storeProfile']> | null;
  onSaved: () => Promise<void>;
}): ReactNode {
  const [shgName, setShgName] = useState(profile?.shgName ?? '');
  const [representative, setRepresentative] = useState(profile?.representative ?? '');
  const [registeredAddress, setRegisteredAddress] = useState(profile?.registeredAddress ?? '');
  const [storeDescription, setStoreDescription] = useState(profile?.storeDescription ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  if (!profile) {
    return (
      <section className="seller-panel">
        <Notice tone="error">
          We couldn’t find an approved store profile. Contact eSakhi Damoh City Admin to resolve your seller account.
        </Notice>
      </section>
    );
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api.updateSellerProfile({
        shgName: shgName.trim(),
        representative: representative.trim(),
        registeredAddress: registeredAddress.trim(),
        storeDescription: storeDescription.trim(),
      });
      setMessage('✓ Store profile updated successfully.');
      await onSaved();
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="seller-panel seller-store-profile" style={{ background: '#ffffff', borderRadius: '16px', padding: '1.5rem', border: '1.5px solid #e2e8f0' }}>
      <div className="seller-panel-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.35rem', color: '#0f172a' }}>Store Profile</h2>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.84rem', color: '#64748b' }}>
            Keep your group and pickup details up to date for customers and the Damoh City Admin delivery fleet.
          </p>
        </div>
        <span className="seller-verified-pill" style={{ background: '#dcfce7', color: '#166534', border: '1px solid #86efac', fontWeight: 700, padding: '0.3rem 0.75rem', borderRadius: '999px', fontSize: '0.82rem' }}>
          ✓ Verified NRLM SHG
        </span>
      </div>

      <form className="seller-profile-form" onSubmit={(e) => void save(e)}>
        {message && <Notice tone="success">{message}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          <label className="field">
            <span>Store / SHG Name</span>
            <input required minLength={2} maxLength={160} value={shgName} onChange={(e) => setShgName(e.target.value)} />
          </label>
          <label className="field">
            <span>Contact Person / Leader</span>
            <input required minLength={2} maxLength={120} value={representative} onChange={(e) => setRepresentative(e.target.value)} />
          </label>
        </div>

        <label className="field" style={{ marginTop: '0.85rem' }}>
          <span>About Your Craft & Group</span>
          <textarea rows={4} maxLength={1000} value={storeDescription} onChange={(e) => setStoreDescription(e.target.value)} placeholder="Tell customers about your artisan members and traditional craft heritage." />
        </label>

        <label className="field" style={{ marginTop: '0.85rem' }}>
          <span>Pickup & Registered Address</span>
          <textarea required minLength={5} maxLength={500} rows={2} value={registeredAddress} onChange={(e) => setRegisteredAddress(e.target.value)} />
        </label>

        <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0', marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
          <div><small style={{ color: '#64748b', display: 'block' }}>Phone</small><strong>{profile.phoneE164}</strong></div>
          <div><small style={{ color: '#64748b', display: 'block' }}>Email</small><strong>{profile.email || 'Not configured'}</strong></div>
          <div><small style={{ color: '#64748b', display: 'block' }}>Operating City</small><strong>{profile.assignedCity || profile.city}</strong></div>
          <div><small style={{ color: '#64748b', display: 'block' }}>Main Category</small><strong>{profile.primaryCategoryName ?? 'Handicrafts & Food'}</strong></div>
          <div><small style={{ color: '#64748b', display: 'block' }}>FSSAI Status</small><strong>{profile.fssaiStatus.replaceAll('_', ' ')}</strong></div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button className="seller-primary-action" type="submit" disabled={saving} style={{ background: '#4A0E4E', color: '#ffffff', fontWeight: 800, padding: '0.65rem 1.4rem' }}>
            {saving ? 'Saving…' : 'Save Store Profile'}
          </button>
          <Link className="seller-secondary-action" to="/help">Get Help</Link>
        </div>
      </form>
    </section>
  );
}

export function SellerInventoryHistoryPanel({ productId }: { productId: string }): ReactNode {
  const history = useLoad(() => api.sellerInventoryHistory(productId), [productId]);
  return (
    <div className="seller-history-panel" style={{ padding: '0.85rem 1rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', marginTop: '0.5rem' }}>
      <strong style={{ fontSize: '0.85rem', color: '#334155', display: 'block', marginBottom: '0.4rem' }}>
        Stock Adjustment History
      </strong>
      {history.loading ? (
        <Loading label="Loading stock history…" />
      ) : history.error ? (
        <Notice tone="error">{history.error}</Notice>
      ) : history.data?.data.length ? (
        <div style={{ display: 'grid', gap: '0.35rem' }}>
          {history.data.data.map((entry: SellerInventoryAdjustment) => (
            <div key={entry._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', background: '#ffffff', padding: '0.35rem 0.65rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <span style={{ fontWeight: 800, color: entry.quantityChange > 0 ? '#15803d' : '#dc2626' }}>
                {entry.quantityChange > 0 ? '+' : ''}{entry.quantityChange} units
              </span>
              <span style={{ color: '#475569' }}>{entry.reason}</span>
              <small style={{ color: '#94a3b8' }}>{new Date(entry.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</small>
            </div>
          ))}
        </div>
      ) : (
        <small style={{ color: '#64748b' }}>No manual adjustments recorded for this product.</small>
      )}
    </div>
  );
}

export function DamohCityAdminHelpModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }): ReactNode {
  if (!isOpen) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          maxWidth: '520px',
          width: '100%',
          padding: '1.75rem',
          boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
          display: 'grid',
          gap: '1rem',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.85rem' }}>
          <div>
            <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#4A0E4E', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Damoh City Admin Support Desk
            </div>
            <h3 style={{ margin: '0.2rem 0 0', fontSize: '1.35rem', color: '#0f172a' }}>
              📞 Damoh Seller Support Desk
            </h3>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#64748b' }}>
            ✕
          </button>
        </div>

        <p style={{ margin: 0, fontSize: '0.86rem', color: '#475569', lineHeight: 1.5 }}>
          If you need assistance with an active order, partner pickup dispatch, or bank settlement queries, contact the Damoh City Admin desk directly:
        </p>

        <div style={{ display: 'grid', gap: '0.65rem' }}>
          <div style={{ padding: '0.75rem 1rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '0.74rem', color: '#64748b' }}>Direct Helpline Phone</div>
              <strong style={{ fontSize: '1rem', color: '#0f172a' }}>+91 94251 00000</strong>
            </div>
            <a href="tel:+919425100000" className="seller-primary-action" style={{ textDecoration: 'none', background: '#15803d', color: '#ffffff', padding: '0.4rem 0.85rem', fontSize: '0.82rem' }}>
              Call Now 📞
            </a>
          </div>

          <div style={{ padding: '0.75rem 1rem', background: '#f0fdf4', borderRadius: '10px', border: '1px solid #bbf7d0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '0.74rem', color: '#166534' }}>WhatsApp Assistance</div>
              <strong style={{ fontSize: '0.92rem', color: '#166534' }}>+91 94251 00000</strong>
            </div>
            <a href="https://wa.me/919425100000" target="_blank" rel="noreferrer" className="seller-secondary-action" style={{ textDecoration: 'none', background: '#ffffff', color: '#166534', borderColor: '#86efac', padding: '0.4rem 0.85rem', fontSize: '0.82rem' }}>
              Chat on WhatsApp 💬
            </a>
          </div>

          <div style={{ padding: '0.75rem 1rem', background: '#fdf4ff', borderRadius: '10px', border: '1px solid #f0abfc' }}>
            <div style={{ fontSize: '0.74rem', color: '#701a75' }}>Damoh Operating Hub Office</div>
            <strong style={{ fontSize: '0.86rem', color: '#4a044e' }}>
              Zila Panchayat Parisar, Collectorate Road, Damoh, MP - 470661
            </strong>
            <div style={{ fontSize: '0.74rem', color: '#86198f', marginTop: '0.2rem' }}>
              Operating Hours: Monday to Saturday · 9:00 AM – 7:00 PM
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: '0.85rem' }}>
          <button type="button" className="seller-secondary-action" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
