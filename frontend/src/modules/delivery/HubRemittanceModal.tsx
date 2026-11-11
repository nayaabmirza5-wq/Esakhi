import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../api';

interface HubRemittanceModalProps {
  cashInHandRupees: string;
  remittancePin: string;
  assignedCity?: string;
  onClose: () => void;
  onSettled: () => void | Promise<void>;
}

export const HubRemittanceModal: React.FC<HubRemittanceModalProps> = ({
  cashInHandRupees,
  remittancePin: initialPin,
  assignedCity = 'Damoh',
  onClose,
  onSettled,
}) => {
  const [activeTab, setActiveTab] = useState<'hub' | 'upi'>('hub');
  const [upiLoading, setUpiLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const hubCoords = '23.8415,79.445';
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${hubCoords}`;
  const TOTAL_TTL_SECONDS = 60;
  const [currentPin, setCurrentPin] = useState(initialPin || '----');
  const [timeLeft, setTimeLeft] = useState(TOTAL_TTL_SECONDS);
  const [isRotating, setIsRotating] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Automated Rolling PIN Generator
  const fetchFreshPin = useCallback(async (isInitial = false) => {
    setIsRotating(true);
    try {
      const res = await api.partnerRegenerateRemittancePin();
      setCurrentPin(res.remittancePin);
      setTimeLeft(res.expiresInSeconds || TOTAL_TTL_SECONDS);
      setError('');
    } catch (cause) {
      if (!isInitial) {
        setError(cause instanceof Error ? cause.message : 'Could not auto-rotate Handshake PIN.');
      }
    } finally {
      setTimeout(() => setIsRotating(false), 300);
    }
  }, []);

  // Auto-fetch fresh PIN immediately on modal open
  useEffect(() => {
    void fetchFreshPin(true);
  }, [fetchFreshPin]);

  // Rolling countdown timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          void fetchFreshPin(false);
          return TOTAL_TTL_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchFreshPin]);
const handleUpiRemit = async () => {
    setUpiLoading(true);
    setError('');
    try {
      const res = await api.partnerRemitViaUpi();
      setSuccess(`✓ Instant UPI Remittance of ₹${res.settledAmountRupees} verified! Receipt #${res.receiptNumber}. Cash balance cleared to ₹0.00.`);
      setTimeout(() => {
        void onSettled();
        onClose();
      }, 1500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UPI remittance failed. Please deposit physical cash at Hub.');
    } finally {
      setUpiLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '20px',
          maxWidth: '480px',
          width: '100%',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          animation: 'fadeIn 0.2s ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            background: 'linear-gradient(135deg, #15803d 0%, #16a34a 100%)',
            color: '#ffffff',
            padding: '1.25rem 1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#bbf7d0', fontWeight: 800 }}>
              {assignedCity} Operations Desk
            </span>
            <h2 style={{ margin: '0.2rem 0 0', fontSize: '1.25rem', fontWeight: 900 }}>
              Cash Handover & Clearance
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: '#ffffff',
              width: '32px',
              height: '32px',
              borderRadius: '999px',
              cursor: 'pointer',
              fontWeight: 800,
              fontSize: '1rem',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '1.25rem 1.5rem' }}>
          {/* Outstanding Amount Card */}
          <div
            style={{
              background: '#f8fafc',
              border: '2px dashed #cbd5e1',
              borderRadius: '12px',
              padding: '1rem',
              textAlign: 'center',
              marginBottom: '1rem',
            }}
          >
            <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
              Total Physical Cash In Hand
            </span>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: '#15803d', margin: '0.2rem 0' }}>
              ₹{cashInHandRupees}
            </div>
            <small style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              Hand over cash to City Admin desk to reset your balance to ₹0.00
            </small>
          </div>

          {/* Toggle between Hub Drop vs UPI */}
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              backgroundColor: '#f1f5f9',
              padding: '4px',
              borderRadius: '10px',
              marginBottom: '1.25rem',
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('hub')}
              style={{
                flex: 1,
                padding: '0.6rem',
                border: 'none',
                borderRadius: '8px',
                background: activeTab === 'hub' ? '#ffffff' : 'transparent',
                color: activeTab === 'hub' ? '#0f172a' : '#64748b',
                fontWeight: activeTab === 'hub' ? 800 : 600,
                fontSize: '0.84rem',
                cursor: 'pointer',
                boxShadow: activeTab === 'hub' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              🏢 Physical Hub Drop
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('upi')}
              style={{
                flex: 1,
                padding: '0.6rem',
                border: 'none',
                borderRadius: '8px',
                background: activeTab === 'upi' ? '#ffffff' : 'transparent',
                color: activeTab === 'upi' ? '#0f172a' : '#64748b',
                fontWeight: activeTab === 'upi' ? 800 : 600,
                fontSize: '0.84rem',
                cursor: 'pointer',
                boxShadow: activeTab === 'upi' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              📲 Instant UPI
            </button>
          </div>

          {error && (
            <div
              style={{
                background: '#fee2e2',
                border: '1px solid #f87171',
                color: '#991b1b',
                padding: '0.75rem',
                borderRadius: '8px',
                fontSize: '0.82rem',
                marginBottom: '1rem',
              }}
            >
              {error}
            </div>
          )}

          {success && (
            <div
              style={{
                background: '#dcfce7',
                border: '1px solid #86efac',
                color: '#166534',
                padding: '0.75rem',
                borderRadius: '8px',
                fontSize: '0.82rem',
                marginBottom: '1rem',
                fontWeight: 700,
              }}
            >
              {success}
            </div>
          )}

          {activeTab === 'hub' ? (
            <div>
              {/* Dynamic Ephemeral Handshake PIN Card (Strict Auto-Refresh Only) */}
              <div
                style={{
                  background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
                  color: '#ffffff',
                  padding: '1.25rem',
                  borderRadius: '16px',
                  textAlign: 'center',
                  marginBottom: '1rem',
                  boxShadow: '0 8px 24px rgba(49, 46, 129, 0.3)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Header Badge & Countdown Status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      color: '#86efac',
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: timeLeft <= 10 ? '#f59e0b' : '#10b981',
                        display: 'inline-block',
                        boxShadow: `0 0 8px ${timeLeft <= 10 ? '#f59e0b' : '#10b981'}`,
                      }}
                    />
                    🔐 Self-Rotating Clearance Nonce
                  </span>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      color: timeLeft <= 10 ? '#fde68a' : '#c7d2fe',
                      fontFamily: 'monospace',
                      fontWeight: 800,
                      padding: '0.15rem 0.55rem',
                      borderRadius: '999px',
                      background: timeLeft <= 10 ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255, 255, 255, 0.1)',
                    }}
                  >
                    {isRotating ? 'Rotating…' : `⏱ ${timeLeft}s`}
                  </span>
                </div>

                {/* 4 Segmented Digit Tiles */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.65rem', margin: '0.85rem 0' }}>
                  {currentPin.padEnd(4, '•').slice(0, 4).split('').map((digit, idx) => (
                    <div
                      key={idx}
                      style={{
                        width: '54px',
                        height: '64px',
                        background: 'rgba(255, 255, 255, 0.12)',
                        backdropFilter: 'blur(8px)',
                        border: '2px solid rgba(255, 255, 255, 0.3)',
                        borderRadius: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '2.25rem',
                        fontWeight: 900,
                        fontFamily: 'monospace',
                        color: '#ffffff',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
                        transform: isRotating ? 'scale(0.92)' : 'scale(1)',
                        transition: 'transform 0.2s ease',
                      }}
                    >
                      {digit}
                    </div>
                  ))}
                </div>

                {/* Linear Countdown Progress Bar */}
                <div style={{ width: '100%', height: '5px', background: 'rgba(255, 255, 255, 0.15)', borderRadius: '999px', overflow: 'hidden', margin: '0.65rem 0 0.5rem' }}>
                  <div
                    style={{
                      width: `${(timeLeft / TOTAL_TTL_SECONDS) * 100}%`,
                      height: '100%',
                      background: timeLeft <= 10 ? 'linear-gradient(90deg, #f59e0b, #ef4444)' : 'linear-gradient(90deg, #10b981, #60a5fa)',
                      borderRadius: '999px',
                      transition: 'width 1s linear',
                    }}
                  />
                </div>

                <p style={{ margin: '0.5rem 0 0', fontSize: '0.74rem', color: '#c7d2fe', lineHeight: 1.45 }}>
                  🛡️ <strong>Auto-Refresh Anti-Fraud Security:</strong> This PIN automatically rotates every 60 seconds and permanently burns once cleared. The hub operator cannot memorize or reuse past PINs to clear cash without your physical presence.
                </p>
              </div>

              {/* Hub Destination & Turn-by-Turn GPS */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '0.85rem',
                  marginBottom: '1.25rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>📍</span>
                  <strong style={{ fontSize: '0.86rem', color: '#0f172a' }}>
                    {assignedCity} Municipal Hub Desk
                  </strong>
                </div>
                <p style={{ margin: '0 0 0.75rem 1.6rem', fontSize: '0.78rem', color: '#64748b' }}>
                  eSakhi Operations Center, Station Road, {assignedCity}, Madhya Pradesh
                </p>
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    background: '#2563eb',
                    color: '#ffffff',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    textDecoration: 'none',
                    fontWeight: 800,
                    fontSize: '0.86rem',
                    boxShadow: '0 2px 6px rgba(37, 99, 235, 0.25)',
                  }}
                >
                  <span>🧭</span> Open Google Maps Navigation to Hub
                </a>
              </div>
            </div>
          ) : (
            <div>
              {/* UPI Direct Remit */}
              <div
                style={{
                  background: '#f5f3ff',
                  border: '1px solid #ddd6fe',
                  borderRadius: '12px',
                  padding: '1.1rem',
                  marginBottom: '1rem',
                }}
              >
                <h4 style={{ margin: '0 0 0.5rem', color: '#5b21b6', fontSize: '0.95rem', fontWeight: 800 }}>
                  Remit Online via UPI (Keep Physical Cash)
                </h4>
                <p style={{ margin: '0 0 0.85rem', fontSize: '0.8rem', color: '#6d28d9', lineHeight: 1.5 }}>
                  You keep the collected customer banknotes for personal fuel/expenses, and transfer the ₹{cashInHandRupees} directly from your PhonePe, Google Pay, or Paytm to eSakhi’s corporate escrow account.
                </p>
                <button
                  type="button"
                  disabled={upiLoading || Boolean(success)}
                  onClick={() => void handleUpiRemit()}
                  style={{
                    width: '100%',
                    background: '#4A0E4E',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.85rem',
                    borderRadius: '10px',
                    fontWeight: 800,
                    fontSize: '0.9rem',
                    cursor: upiLoading ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 12px rgba(107, 33, 92, 0.25)',
                  }}
                >
                  {upiLoading ? 'Clearing Ledger via UPI…' : `Pay ₹${cashInHandRupees} & Clear Balance to ₹0.00`}
                </button>
              </div>
            </div>
          )}

          <div style={{ textAlign: 'center' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#64748b',
                fontWeight: 600,
                fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              Close Window
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
