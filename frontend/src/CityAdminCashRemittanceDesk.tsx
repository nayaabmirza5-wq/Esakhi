import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from './api';
import type { CityAdminRemittanceSummary, CityAdminRemittancePartner } from './types';

export const CityAdminCashRemittanceDesk: React.FC = () => {
  const [data, setData] = useState<CityAdminRemittanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Settlement modal state
  const [selectedPartner, setSelectedPartner] = useState<CityAdminRemittancePartner | null>(null);
  const [handshakePin, setHandshakePin] = useState('');
  const [pinDigits, setPinDigits] = useState<[string, string, string, string]>(['', '', '', '']);
  const pinInputRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];
  const [cashAmountInput, setCashAmountInput] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [settleError, setSettleError] = useState('');

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const summary = await api.cityAdminRemittanceSummary();
      setData(summary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load cash remittance summary.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const openSettleModal = (partner: CityAdminRemittancePartner) => {
    setSelectedPartner(partner);
    setCashAmountInput(partner.unremittedCashRupees);
    setPinDigits(['', '', '', '']);
    setHandshakePin('');
    setNotes('');
    setSettleError('');
    setTimeout(() => {
      pinInputRefs[0].current?.focus();
    }, 120);
  };

  const closeSettleModal = () => {
    setSelectedPartner(null);
    setPinDigits(['', '', '', '']);
    setHandshakePin('');
    setCashAmountInput('');
    setNotes('');
    setSettleError('');
  };

  const handleDigitChange = (index: number, value: string) => {
    const cleanDigit = value.replace(/\D/g, '').slice(-1);
    const updated = [...pinDigits] as [string, string, string, string];
    updated[index] = cleanDigit;
    setPinDigits(updated);
    setHandshakePin(updated.join(''));
    if (cleanDigit && index < 3) {
      pinInputRefs[index + 1].current?.focus();
    }
  };

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!pinDigits[index] && index > 0) {
        const updated = [...pinDigits] as [string, string, string, string];
        updated[index - 1] = '';
        setPinDigits(updated);
        setHandshakePin(updated.join(''));
        pinInputRefs[index - 1].current?.focus();
      } else {
        const updated = [...pinDigits] as [string, string, string, string];
        updated[index] = '';
        setPinDigits(updated);
        setHandshakePin(updated.join(''));
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      pinInputRefs[index - 1].current?.focus();
    } else if (e.key === 'ArrowRight' && index < 3) {
      pinInputRefs[index + 1].current?.focus();
    }
  };

  const handleDigitPaste = (e: React.ClipboardEvent) => {
    const pasteData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (pasteData) {
      e.preventDefault();
      const updated: [string, string, string, string] = ['', '', '', ''];
      for (let i = 0; i < pasteData.length; i++) {
        updated[i] = pasteData[i];
      }
      setPinDigits(updated);
      setHandshakePin(updated.join(''));
      pinInputRefs[Math.min(pasteData.length, 3)].current?.focus();
    }
  };

  const handleSettleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPartner) return;
    if (handshakePin.trim().length !== 4) {
      setSettleError('Please enter the exact 4-digit Handshake PIN provided by the delivery partner.');
      return;
    }
    const amountPaise = Math.round(parseFloat(cashAmountInput) * 100);
    if (isNaN(amountPaise) || amountPaise <= 0) {
      setSettleError('Please enter a valid cash amount.');
      return;
    }

    setSubmitting(true);
    setSettleError('');
    try {
      const result = await api.cityAdminSettleRemittance(
        selectedPartner.partnerId,
        amountPaise,
        handshakePin.trim(),
        notes.trim() || undefined,
      );
      setSuccessMsg(`✓ Cash Remittance Succeeded! Receipt #${result.receiptNumber}. Settled ₹${result.settledAmountRupees} across ${result.settledOrdersCount} orders. Rider balance reset to ₹0.00.`);
      closeSettleModal();
      await loadSummary();
      window.dispatchEvent(new Event('city-admin-order-updated'));
    } catch (cause) {
      setSettleError(cause instanceof Error ? cause.message : 'Settlement failed. Please check the Handshake PIN.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
        Loading Damoh Hub Cash Inward Ledger…
      </div>
    );
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      {/* Top Banner & KPI Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div
          style={{
            background: 'linear-gradient(135deg, #15803d 0%, #16a34a 100%)',
            color: '#ffffff',
            padding: '1.25rem',
            borderRadius: '14px',
            boxShadow: '0 4px 12px rgba(22, 163, 74, 0.2)',
          }}
        >
          <small style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#bbf7d0', fontWeight: 800 }}>
            Total Cash in Road Transit
          </small>
          <div style={{ fontSize: '1.85rem', fontWeight: 900, margin: '0.25rem 0' }}>
            ₹{data?.totalOutstandingRupees || '0.00'}
          </div>
          <small style={{ fontSize: '0.74rem', color: '#dcfce7' }}>
            Held by active couriers in {data?.city || 'Damoh'}
          </small>
        </div>

        <div
          style={{
            background: '#ffffff',
            border: '2px solid #fecaca',
            padding: '1.25rem',
            borderRadius: '14px',
          }}
        >
          <small style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#dc2626', fontWeight: 800 }}>
            Mandatory COD Floating Threshold
          </small>
          <div style={{ fontSize: '1.85rem', fontWeight: 900, color: '#dc2626', margin: '0.25rem 0' }}>
            ₹2,000.00
          </div>
          <small style={{ fontSize: '0.74rem', color: '#7f1d1d' }}>
            Auto-suspends new COD assignments if exceeded
          </small>
        </div>

        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            padding: '1.25rem',
            borderRadius: '14px',
          }}
        >
          <small style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', fontWeight: 800 }}>
            Couriers with Cash in Hand
          </small>
          <div style={{ fontSize: '1.85rem', fontWeight: 900, color: '#0f172a', margin: '0.25rem 0' }}>
            {data?.partners.filter((p) => p.unremittedCashPaise > 0).length || 0}
          </div>
          <small style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
            Out of {data?.partners.length || 0} approved couriers
          </small>
        </div>
      </div>

      {error && (
        <div style={{ padding: '0.85rem', background: '#fee2e2', border: '1px solid #f87171', color: '#991b1b', borderRadius: '10px', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {successMsg && (
        <div style={{ padding: '0.85rem', background: '#dcfce7', border: '1px solid #86efac', color: '#166534', borderRadius: '10px', marginBottom: '1rem', fontWeight: 700 }}>
          {successMsg}
        </div>
      )}

      {/* Partners Cash Reconciliation Table */}
      <div className="city-admin-panel" style={{ padding: '1.25rem', borderRadius: '14px', background: '#ffffff', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>
              Rider Cash Remittance & Handshake Queue
            </h3>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: '#64748b' }}>
              Verify physical banknotes handed over at the Damoh Hub desk using the rider’s 4-digit PIN.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadSummary()}
            style={{
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              padding: '0.45rem 0.85rem',
              borderRadius: '8px',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Refresh ⟳
          </button>
        </div>

        {data?.partners.length ? (
          <div className="city-admin-table-wrap">
            <table className="city-admin-table">
              <thead>
                <tr>
                  <th>Delivery Partner</th>
                  <th>Contact</th>
                  <th>Duty Status</th>
                  <th>Unremitted Cash</th>
                  <th>COD Orders</th>
                  <th>Guardrail Compliance</th>
                  <th>Desk Action</th>
                </tr>
              </thead>
              <tbody>
                {data.partners.map((p) => (
                  <tr key={p.partnerId} style={{ backgroundColor: p.exceedsThreshold ? '#fff7ed' : 'transparent' }}>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td>
                      <a href={`tel:${p.phoneE164}`}>{p.phoneE164}</a>
                    </td>
                    <td>
                      <span
                        style={{
                          padding: '0.25rem 0.55rem',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          backgroundColor: p.isOnline ? '#dcfce7' : '#f1f5f9',
                          color: p.isOnline ? '#166534' : '#64748b',
                        }}
                      >
                        {p.isOnline ? '🟢 Online' : '🔴 Offline'}
                      </span>
                    </td>
                    <td>
                      <strong
                        style={{
                          fontSize: '1rem',
                          color: p.unremittedCashPaise > 0 ? (p.exceedsThreshold ? '#dc2626' : '#15803d') : '#64748b',
                        }}
                      >
                        ₹{p.unremittedCashRupees}
                      </strong>
                    </td>
                    <td>{p.orderCount} completed</td>
                    <td>
                      {p.exceedsThreshold ? (
                        <span
                          style={{
                            background: '#fee2e2',
                            color: '#991b1b',
                            border: '1px solid #fca5a5',
                            padding: '0.25rem 0.6rem',
                            borderRadius: '6px',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                          }}
                        >
                          🚨 EXCEEDED ₹2,000 (COD BLOCKED)
                        </span>
                      ) : p.unremittedCashPaise > 0 ? (
                        <span
                          style={{
                            background: '#eff6ff',
                            color: '#1e40af',
                            padding: '0.25rem 0.6rem',
                            borderRadius: '6px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                          }}
                        >
                          ✓ Within Floating Limit
                        </span>
                      ) : (
                        <span style={{ color: '#16a34a', fontSize: '0.75rem', fontWeight: 700 }}>
                          ✓ Fully Remitted (₹0.00)
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        disabled={p.unremittedCashPaise === 0}
                        onClick={() => openSettleModal(p)}
                        style={{
                          background: p.unremittedCashPaise > 0 ? '#15803d' : '#e2e8f0',
                          color: p.unremittedCashPaise > 0 ? '#ffffff' : '#94a3b8',
                          border: 'none',
                          padding: '0.45rem 0.85rem',
                          borderRadius: '8px',
                          fontWeight: 800,
                          fontSize: '0.78rem',
                          cursor: p.unremittedCashPaise > 0 ? 'pointer' : 'not-allowed',
                        }}
                      >
                        Accept & Settle Cash
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
            No delivery partners found in {data?.city || 'this city'}.
          </div>
        )}
      </div>

      {/* Settle Modal */}
      {selectedPartner && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(4px)',
            zIndex: 99999,
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
            }}
          >
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
                <span style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#bbf7d0', fontWeight: 800 }}>
                  Damoh Hub Cash Inward
                </span>
                <h3 style={{ margin: '0.2rem 0 0', fontSize: '1.25rem', fontWeight: 900 }}>
                  Settle Cash for {selectedPartner.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeSettleModal}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  border: 'none',
                  color: '#ffffff',
                  width: '32px',
                  height: '32px',
                  borderRadius: '999px',
                  cursor: 'pointer',
                  fontWeight: 800,
                }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSettleSubmit} style={{ padding: '1.5rem' }}>
              {settleError && (
                <div style={{ padding: '0.75rem', background: '#fee2e2', border: '1px solid #f87171', color: '#991b1b', borderRadius: '8px', fontSize: '0.82rem', marginBottom: '1rem' }}>
                  {settleError}
                </div>
              )}

              {/* Order breakdown */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.85rem', marginBottom: '1.25rem' }}>
                <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
                  Unremitted Delivered Orders ({selectedPartner.orders.length})
                </span>
                <div style={{ marginTop: '0.4rem', maxHeight: '110px', overflowY: 'auto' }}>
                  {selectedPartner.orders.map((o) => (
                    <div key={o.orderId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '0.25rem 0', borderBottom: '1px dashed #e2e8f0' }}>
                      <span style={{ color: '#0f172a', fontWeight: 600 }}>#{o.orderReference} ({o.customerName})</span>
                      <strong style={{ color: '#15803d' }}>₹{o.totalRupees}</strong>
                    </div>
                  ))}
                </div>
              </div>

              {/* Physical Cash Count Input */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.35rem' }}>
                  Physical Banknotes Counted on Desk (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={cashAmountInput}
                  onChange={(e) => setCashAmountInput(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '1.1rem',
                    fontWeight: 800,
                    color: '#0f172a',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Segmented 4-Digit Handshake PIN Entry Pad */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.5rem' }}>
                  Rider's 4-Digit Handshake PIN (From Live Screen) *
                </label>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    gap: '0.75rem',
                    marginBottom: '0.5rem',
                  }}
                  onPaste={handleDigitPaste}
                >
                  {pinDigits.map((digit, index) => (
                    <input
                      key={index}
                      ref={pinInputRefs[index]}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleDigitChange(index, e.target.value)}
                      onKeyDown={(e) => handleDigitKeyDown(index, e)}
                      style={{
                        width: '54px',
                        height: '64px',
                        textAlign: 'center',
                        fontSize: '1.75rem',
                        fontWeight: 900,
                        fontFamily: 'monospace',
                        color: '#0f172a',
                        background: digit ? '#f0fdf4' : '#ffffff',
                        border: digit
                          ? '2px solid #16a34a'
                          : settleError
                            ? '2px solid #ef4444'
                            : '2px solid #cbd5e1',
                        borderRadius: '12px',
                        outline: 'none',
                        boxShadow: digit ? '0 2px 8px rgba(22, 163, 74, 0.15)' : 'none',
                        transition: 'all 0.15s ease',
                      }}
                    />
                  ))}
                </div>

                <div style={{ textAlign: 'center', minHeight: '22px' }}>
                  {handshakePin.length === 4 ? (
                    <span style={{ fontSize: '0.76rem', color: '#16a34a', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                      ✓ 4 Digits entered · Ready to verify handshake
                    </span>
                  ) : (
                    <small style={{ fontSize: '0.74rem', color: '#64748b' }}>
                      Ask {selectedPartner.name} for the live PIN displayed on their phone screen. (PIN auto-rotates every 60s)
                    </small>
                  )}
                </div>
              </div>

              {/* Notes */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.35rem' }}>
                  Desk Verification Note (Optional)
                </label>
                <input
                  type="text"
                  maxLength={200}
                  placeholder="Counted ₹1,470 in physical notes at Damoh desk"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.65rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.82rem',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={closeSettleModal}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    flex: 2,
                    padding: '0.75rem',
                    background: '#15803d',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 800,
                    fontSize: '0.9rem',
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 12px rgba(21, 128, 61, 0.25)',
                  }}
                >
                  {submitting ? 'Verifying PIN & Settling…' : 'Confirm Cash Inward & Reset Balance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Recent Remittance Vouchers */}
      {Boolean(data?.recentVouchers?.length) && (
        <div className="city-admin-panel" style={{ padding: '1.25rem', borderRadius: '14px', background: '#ffffff' }}>
          <h4 style={{ margin: '0 0 0.85rem', fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' }}>
            Recent Municipal Remittance Vouchers
          </h4>
          <div className="city-admin-table-wrap">
            <table className="city-admin-table">
              <thead>
                <tr>
                  <th>Voucher #</th>
                  <th>Delivery Partner</th>
                  <th>Settled Amount</th>
                  <th>Orders</th>
                  <th>Handshake PIN</th>
                  <th>Verified By</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {data!.recentVouchers.map((v) => (
                  <tr key={v._id}>
                    <td><strong>{v.receiptNumber}</strong></td>
                    <td>{v.riderName} ({v.riderPhone})</td>
                    <td><strong style={{ color: '#16a34a' }}>₹{v.amountRupees}</strong></td>
                    <td>{v.orderCount} orders</td>
                    <td><code>{v.handshakePinUsed}</code></td>
                    <td>{v.settledByAdminName}</td>
                    <td><small>{new Date(v.settledAt).toLocaleString('en-IN')}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
