import { useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import type { DeliveryPartnerApplication } from './types';

export function CityAdminRiderAuditPanel({
  applications,
  onApplicationUpdated,
}: {
  applications: DeliveryPartnerApplication[];
  onApplicationUpdated: () => void;
}): ReactNode {
  const [selectedApp, setSelectedApp] = useState<DeliveryPartnerApplication | null>(applications[0] ?? null);
  const [zoomImg, setZoomImg] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [flaggedFields, setFlaggedFields] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleDecision = async (decision: 'approved' | 'rejected' | 'action_required') => {
    if (!selectedApp) return;
    setSubmitting(true);
    setFeedback(null);

    try {
      await api.reviewDeliveryPartnerApplication(
        selectedApp._id,
        decision,
        reviewNote.trim() || undefined,
        flaggedFields,
      );

      setFeedback({
        type: 'success',
        message: decision === 'approved'
          ? `✓ Delivery Partner ${selectedApp.name} approved! Duty toggle unlocked.`
          : decision === 'action_required'
            ? `Application flagged as ACTION_REQUIRED for re-upload.`
            : `Application rejected.`,
      });

      onApplicationUpdated();
      setSelectedApp(null);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to submit review.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleFlagField = (field: string) => {
    setFlaggedFields((prev) => (prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]));
  };

  if (!applications.length) {
    return (
      <div className="city-admin-empty">
        No delivery partner applications currently in the audit queue.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) 2fr', gap: '1.25rem' }}>
      {/* 1. Pending Verification Queue */}
      <div className="panel" style={{ padding: '1rem', height: 'fit-content' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', color: '#64748b', marginBottom: '0.75rem' }}>
          Verification Queue ({applications.length})
        </h3>
        <div style={{ display: 'grid', gap: '0.65rem' }}>
          {applications.map((app) => {
            const isSelected = selectedApp?._id === app._id;
            return (
              <div
                key={app._id}
                onClick={() => {
                  setSelectedApp(app);
                  setReviewNote('');
                  setFlaggedFields(app.flaggedFields || []);
                }}
                style={{
                  padding: '0.75rem 0.9rem',
                  borderRadius: '10px',
                  border: `1.5px solid ${isSelected ? '#059669' : '#e2e8f0'}`,
                  background: isSelected ? '#ecfdf5' : '#ffffff',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '0.92rem', color: '#0f172a' }}>{app.name}</strong>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      padding: '0.2rem 0.5rem',
                      borderRadius: '999px',
                      background: app.vehicleType === 'MOTORCYCLE' ? '#ffedd5' : '#e0e7ff',
                      color: app.vehicleType === 'MOTORCYCLE' ? '#c2410c' : '#3730a3',
                    }}
                  >
                    {app.vehicleType || 'BICYCLE'}
                  </span>
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.25rem' }}>
                  {app.phoneE164} • {app.city}
                </div>
                <small style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                  Submitted {new Date(app.createdAt).toLocaleDateString('en-IN')}
                </small>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Split Audit Workspace */}
      {selectedApp ? (
        <div className="panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
            <div>
              <span className="eyebrow" style={{ color: '#059669' }}>Rider Physical Verification Audit</span>
              <h2 style={{ fontSize: '1.25rem', margin: 0 }}>{selectedApp.name}</h2>
              <small style={{ color: '#64748b' }}>Assigned Hub: {selectedApp.city}</small>
            </div>
            <span
              style={{
                padding: '0.3rem 0.75rem',
                borderRadius: '999px',
                fontSize: '0.78rem',
                fontWeight: 800,
                background: selectedApp.status === 'pending' ? '#fef08a' : '#e2e8f0',
                color: selectedApp.status === 'pending' ? '#854d0e' : '#334155',
              }}
            >
              {selectedApp.status.toUpperCase()}
            </span>
          </div>

          {feedback && (
            <div
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                marginBottom: '1rem',
                fontSize: '0.86rem',
                fontWeight: 700,
                background: feedback.type === 'success' ? '#ecfdf5' : '#fef2f2',
                color: feedback.type === 'success' ? '#065f46' : '#991b1b',
                border: `1px solid ${feedback.type === 'success' ? '#a7f3d0' : '#fecaca'}`,
              }}
            >
              {feedback.message}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
            {/* Left Column: Visual Evidences & Zoom Inspection */}
            <div style={{ display: 'grid', gap: '0.85rem' }}>
              <h4 style={{ margin: 0, fontSize: '0.82rem', textTransform: 'uppercase', color: '#64748b' }}>
                Visual Proofs & Documents
              </h4>

              {/* Applicant Live Selfie */}
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', padding: '0.65rem', background: '#f8fafc', borderRadius: '10px' }}>
                <img
                  src={selectedApp.selfieUrl || '/images/products/terracotta-diya.jpg'}
                  alt="Selfie"
                  style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover' }}
                />
                <div>
                  <strong style={{ fontSize: '0.85rem', display: 'block' }}>Live Applicant Selfie</strong>
                  <small style={{ color: '#64748b' }}>Face matched for doorstep OTP</small>
                </div>
              </div>

              {/* Government ID / DL front & back */}
              {selectedApp.vehicleType === 'MOTORCYCLE' ? (
                <div>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
                    Driving License Front & Back (High-Res Zoom)
                  </span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.35rem' }}>
                    <div
                      onClick={() => setZoomImg(selectedApp.dlFrontUrl || '/images/products/chanderi-silk-saree.jpg')}
                      style={{ height: '80px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #cbd5e1', cursor: 'zoom-in' }}
                    >
                      <img src={selectedApp.dlFrontUrl || '/images/products/chanderi-silk-saree.jpg'} alt="DL Front" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <div
                      onClick={() => setZoomImg(selectedApp.dlBackUrl || '/images/products/zardozi-clutch.jpg')}
                      style={{ height: '80px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #cbd5e1', cursor: 'zoom-in' }}
                    >
                      <img src={selectedApp.dlBackUrl || '/images/products/zardozi-clutch.jpg'} alt="DL Back" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
                    Government Photo ID (Bicycle Waiver Rule)
                  </span>
                  <div
                    onClick={() => setZoomImg(selectedApp.govIdUrl || '/images/products/bamboo-tokri.jpg')}
                    style={{ height: '90px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #cbd5e1', cursor: 'zoom-in', marginTop: '0.35rem' }}
                  >
                    <img src={selectedApp.govIdUrl || '/images/products/bamboo-tokri.jpg'} alt="Gov ID" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                </div>
              )}

              {/* Bank Proof */}
              <div>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
                  Bank Passbook / Cheque Proof
                </span>
                <div
                  onClick={() => setZoomImg(selectedApp.passbookDocUrl || '/images/products/chanderi-silk-saree.jpg')}
                  style={{ height: '90px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #cbd5e1', cursor: 'zoom-in', marginTop: '0.35rem' }}
                >
                  <img src={selectedApp.passbookDocUrl || '/images/products/chanderi-silk-saree.jpg'} alt="Passbook" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              </div>
            </div>

            {/* Right Column: Biodata, Emergency, and Bank Details */}
            <div style={{ display: 'grid', gap: '0.75rem', fontSize: '0.82rem' }}>
              <h4 style={{ margin: 0, fontSize: '0.82rem', textTransform: 'uppercase', color: '#64748b' }}>
                Biodata & Bank Verification
              </h4>

              <div style={{ padding: '0.75rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'grid', gap: '0.3rem' }}>
                <div><strong>Address:</strong> {selectedApp.residentialAddress || 'On file'} ({selectedApp.pincode || '302028'})</div>
                <div><strong>Emergency Contact:</strong> {selectedApp.emergencyContactName || 'Sanjay'} ({selectedApp.emergencyContactRel || 'Family'}) • {selectedApp.emergencyContactPhone || selectedApp.phoneE164}</div>
                <div><strong>Localities:</strong> {selectedApp.requestedLocalities.join(', ')}</div>
              </div>

              {selectedApp.vehicleType === 'MOTORCYCLE' && (
                <div style={{ padding: '0.75rem', background: '#fff7ed', borderRadius: '10px', border: '1px solid #fed7aa', display: 'grid', gap: '0.3rem' }}>
                  <div><strong>DL Number:</strong> <code style={{ fontWeight: 800 }}>{selectedApp.dlNumber || 'RJ14 20210088991'}</code></div>
                  <div><strong>DL Expiry:</strong> {selectedApp.dlExpiryDate ? new Date(selectedApp.dlExpiryDate).toLocaleDateString('en-IN') : 'Active'}</div>
                  <div><strong>Vehicle RC:</strong> <code style={{ fontWeight: 800 }}>{selectedApp.vehicleRcNumber || 'RJ14 AB 1234'}</code></div>
                </div>
              )}

              <div style={{ padding: '0.75rem', background: '#ecfdf5', borderRadius: '10px', border: '1px solid #a7f3d0', display: 'grid', gap: '0.3rem' }}>
                <div style={{ fontWeight: 800, color: '#065f46' }}>Settlement Account (₹40 Payout / Drop)</div>
                <div><strong>Bank:</strong> {selectedApp.bankDetails?.bankName || 'State Bank of India'}</div>
                <div><strong>IFSC:</strong> <code>{selectedApp.bankDetails?.ifscCode || 'SBIN0001234'}</code></div>
                <div><strong>Account:</strong> <code>{selectedApp.bankDetails?.accountNumberMasked || '••••••••4892'}</code> (Double-Entry Match)</div>
                {selectedApp.bankDetails?.upiVpa && <div><strong>UPI ID:</strong> {selectedApp.bankDetails.upiVpa}</div>}
              </div>

              {/* Review & Decision Actions */}
              <div style={{ marginTop: '0.5rem', display: 'grid', gap: '0.5rem' }}>
                <label className="field" style={{ margin: 0 }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>Decision Note / Rejection Reason</span>
                  <textarea
                    rows={2}
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    placeholder="Enter approval note or specific document rejection details..."
                  />
                </label>

                {/* Flag Specific Fields for Re-upload */}
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', fontSize: '0.75rem' }}>
                  {['DL_FRONT', 'DL_BACK', 'GOV_ID', 'BANK_PROOF', 'SELFIE'].map((f) => (
                    <label key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={flaggedFields.includes(f)} onChange={() => toggleFlagField(f)} />
                      <span>{f}</span>
                    </label>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    className="button"
                    disabled={submitting}
                    onClick={() => void handleDecision('approved')}
                    style={{ background: '#059669', color: '#fff', flex: 1, padding: '0.55rem' }}
                  >
                    ✓ Approve Rider
                  </button>
                  <button
                    type="button"
                    className="button button-outline"
                    disabled={submitting}
                    onClick={() => void handleDecision('action_required')}
                    style={{ flex: 1, padding: '0.55rem' }}
                  >
                    Request Re-upload
                  </button>
                  <button
                    type="button"
                    className="button button-light"
                    disabled={submitting || !reviewNote.trim()}
                    onClick={() => void handleDecision('rejected')}
                    style={{ color: '#b91c1c', padding: '0.55rem' }}
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Modal Zoom */}
      {zoomImg && (
        <div
          onClick={() => setZoomImg(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '2rem',
          }}
        >
          <div style={{ maxWidth: '800px', width: '100%', background: '#fff', borderRadius: '12px', padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <strong>Document Forensic Inspection (Click outside to close)</strong>
              <button type="button" onClick={() => setZoomImg(null)}>✕</button>
            </div>
            <img src={zoomImg} alt="Enlarged" style={{ width: '100%', maxHeight: '75vh', objectFit: 'contain' }} />
          </div>
        </div>
      )}
    </div>
  );
}
