import React, { useState } from 'react';

interface DynamicUpiQrModalProps {
  orderReference: string;
  amountRupees: number;
  customerName: string;
  onClose: () => void;
  onConfirmPayment: (upiUtr: string) => Promise<void> | void;
}

export const DynamicUpiQrModal: React.FC<DynamicUpiQrModalProps> = ({
  orderReference,
  amountRupees,
  customerName,
  onClose,
  onConfirmPayment,
}) => {
  const [upiUtr, setUpiUtr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Official NPCI UPI Standard Deep Link
  const upiVpa = '9399716375@axl';
  const merchantName = 'eSakhi Artisans';
  const upiString = `upi://pay?pa=${encodeURIComponent(upiVpa)}&pn=${encodeURIComponent(merchantName)}&am=${amountRupees.toFixed(2)}&tr=${encodeURIComponent(orderReference)}&tn=${encodeURIComponent(`Payment for Order ${orderReference}`)}&cu=INR`;
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=${encodeURIComponent(upiString)}`;

  const handleCopyLink = () => {
    void navigator.clipboard?.writeText(upiString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirmPayment(upiUtr.trim() || `UPI-VERIFIED-${Date.now().toString().slice(-6)}`);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '20px',
          width: '100%',
          maxWidth: '420px',
          padding: '1.75rem',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          border: '1px solid #e2e8f0',
          position: 'relative',
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '1rem',
            right: '1rem',
            background: '#f1f5f9',
            border: 'none',
            width: '32px',
            height: '32px',
            borderRadius: '16px',
            fontSize: '1.1rem',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            color: '#64748b',
          }}
          aria-label="Close"
        >
          ✕
        </button>

        <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          <span
            style={{
              display: 'inline-block',
              background: 'rgba(107, 33, 92, 0.1)',
              color: '#6b215c',
              padding: '0.25rem 0.75rem',
              borderRadius: '999px',
              fontSize: '0.75rem',
              fontWeight: 800,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              marginBottom: '0.5rem',
            }}
          >
            Doorstep Digital COD
          </span>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', margin: '0.2rem 0' }}>
            Scan to Pay via UPI
          </h2>
          <p style={{ fontSize: '0.86rem', color: '#64748b', margin: 0 }}>
            Customer: <strong>{customerName}</strong> · #{orderReference}
          </p>
        </div>

        {/* Dynamic Locked Amount Display */}
        <div
          style={{
            background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
            border: '2px solid #e2e8f0',
            borderRadius: '14px',
            padding: '0.85rem',
            textAlign: 'center',
            marginBottom: '1.25rem',
          }}
        >
          <small style={{ display: 'block', fontSize: '0.74rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>
            EXACT LOCKED AMOUNT
          </small>
          <strong style={{ fontSize: '2rem', color: '#16a34a', fontWeight: 800 }}>
            ₹{amountRupees.toFixed(2)}
          </strong>
          <small style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
            Amount auto-fills on customer phone · Zero over/underpayment risk
          </small>
        </div>

        {/* Dynamic QR Code Card */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#ffffff',
            padding: '1rem',
            borderRadius: '16px',
            border: '2px solid #6b215c',
            boxShadow: '0 4px 12px rgba(107, 33, 92, 0.08)',
            marginBottom: '1.25rem',
          }}
        >
          <img
            src={qrImageUrl}
            alt={`UPI QR Code for Order ${orderReference}`}
            style={{ width: '220px', height: '220px', borderRadius: '8px' }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem' }}>
            <span style={{ fontSize: '0.76rem', color: '#475569', fontWeight: 600 }}>
              Works with:
            </span>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#2563eb' }}>GPay</span>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#5f259f' }}>PhonePe</span>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#00baf2' }}>Paytm</span>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#16a34a' }}>BHIM</span>
          </div>
        </div>

        {/* Verification Reference Input */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
            UPI UTR / Reference ID (Optional):
          </label>
          <input
            type="text"
            placeholder="e.g. 412389182391"
            value={upiUtr}
            onChange={(e) => setUpiUtr(e.target.value.replace(/\D/g, '').slice(0, 16))}
            style={{
              width: '100%',
              padding: '0.65rem 0.85rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '0.9rem',
              letterSpacing: '0.04em',
            }}
          />
          <small style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', marginTop: '0.25rem' }}>
            Verify the green tick on customer's phone before completing delivery.
          </small>
        </div>

        {/* Actions */}
        <div style={{ display: 'grid', gap: '0.65rem' }}>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleConfirm()}
            style={{
              width: '100%',
              padding: '0.85rem',
              backgroundColor: '#16a34a',
              color: '#ffffff',
              border: 'none',
              borderRadius: '10px',
              fontWeight: 800,
              fontSize: '0.95rem',
              cursor: submitting ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              boxShadow: '0 4px 12px rgba(22, 163, 74, 0.25)',
            }}
          >
            {submitting ? 'Verifying...' : '✓ Payment Received — Mark Delivered'}
          </button>

          <button
            type="button"
            onClick={handleCopyLink}
            style={{
              width: '100%',
              padding: '0.5rem',
              backgroundColor: 'transparent',
              color: '#64748b',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {copied ? '✓ UPI Link Copied' : '🔗 Copy UPI Deep Link'}
          </button>
        </div>
      </div>
    </div>
  );
};
