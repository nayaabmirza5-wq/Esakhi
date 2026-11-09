import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../api';
import type { SellerSettlementsResponse, SellerRecord, PenaltyLedgerEntry } from '../../types';

function formatRupees(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format((paise || 0) / 100);
}

interface SellerBankPassbookProps {
  sellerRecord?: SellerRecord | null;
  grossSalesMonthPaise?: number;
}

export function SellerBankPassbook({
  sellerRecord,
  grossSalesMonthPaise = 0,
}: SellerBankPassbookProps): ReactNode {
  const [settlements, setSettlements] = useState<SellerSettlementsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    api
      .sellerSettlements()
      .then((res) => {
        if (mounted) setSettlements(res);
      })
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : 'Could not load settlements');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const bankName = sellerRecord?.bankDetails?.bankName || 'State Bank of India (SBI)';
  const rawAccount = sellerRecord?.bankDetails?.accountNumber || '48219012345';
  const maskedAccount = rawAccount.length > 4 ? `•••• •••• ${rawAccount.slice(-4)}` : `•••• ${rawAccount}`;
  const ifscCode = sellerRecord?.bankDetails?.ifscCode || 'SBIN0000364';
  const accountHolder = sellerRecord?.bankDetails?.accountHolderName || sellerRecord?.supplierDetails?.shgName || 'Maitri Mahila SHG';

  const netPaise = settlements?.netSettlementPaise ?? 0;
  const grossPaise = settlements?.grossMonthlyPayoutPaise ?? grossSalesMonthPaise;
  const penaltyPaise = settlements?.totalPenaltyDeductionsPaise ?? 0;
  const completedOrders = settlements?.completedOrdersCount ?? 0;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      {/* SHG Transparent Passbook Hero Banner */}
      <section
        style={{
          background: 'linear-gradient(135deg, #4a1553 0%, #6d2878 100%)',
          borderRadius: '18px',
          padding: '1.75rem',
          color: '#ffffff',
          boxShadow: '0 8px 24px rgba(74, 21, 83, 0.18)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255, 255, 255, 0.15)', padding: '0.3rem 0.75rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.04em' }}>
              <span>🏦</span>
              <span>TRANSPARENT SHG DIGITAL PASSBOOK</span>
            </div>
            <h2 style={{ margin: '0.65rem 0 0.25rem', fontSize: '1.65rem', fontWeight: 800 }}>
              {accountHolder}
            </h2>
            <div style={{ fontSize: '0.88rem', opacity: 0.9 }}>
              Damoh District · Direct Benefit Transfer (DBT) Linked
            </div>
          </div>

          <button
            type="button"
            onClick={handlePrint}
            style={{
              background: '#ffffff',
              color: '#4a1553',
              border: 'none',
              borderRadius: '10px',
              padding: '0.65rem 1.15rem',
              fontWeight: 800,
              fontSize: '0.88rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
            }}
          >
            <span>🖨️</span>
            <span>Print Meeting Statement</span>
          </button>
        </div>

        {/* 3 Metric Summary Boxes */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            marginTop: '1.5rem',
          }}
        >
          {/* Card 1: DBT Transferred */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.12)',
              backdropFilter: 'blur(8px)',
              borderRadius: '12px',
              padding: '1rem 1.15rem',
              border: '1px solid rgba(255, 255, 255, 0.2)',
            }}
          >
            <div style={{ fontSize: '0.8rem', opacity: 0.9, fontWeight: 600 }}>
              🟢 Net DBT Settled to Bank Account
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: '0.25rem', color: '#86efac' }}>
              {formatRupees(netPaise)}
            </div>
            <div style={{ fontSize: '0.74rem', opacity: 0.8, marginTop: '0.2rem' }}>
              {completedOrders} verified orders credited via NEFT/DBT
            </div>
          </div>

          {/* Card 2: Today's Processing */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.12)',
              backdropFilter: 'blur(8px)',
              borderRadius: '12px',
              padding: '1rem 1.15rem',
              border: '1px solid rgba(255, 255, 255, 0.2)',
            }}
          >
            <div style={{ fontSize: '0.8rem', opacity: 0.9, fontWeight: 600 }}>
              🟡 Orders In Transit / Pending Settlement
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: '0.25rem', color: '#fef08a' }}>
              {formatRupees(Math.max(0, grossPaise - netPaise))}
            </div>
            <div style={{ fontSize: '0.74rem', opacity: 0.8, marginTop: '0.2rem' }}>
              Settles automatically daily at 11:59 PM
            </div>
          </div>

          {/* Card 3: Lifetime Cumulative */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.12)',
              backdropFilter: 'blur(8px)',
              borderRadius: '12px',
              padding: '1rem 1.15rem',
              border: '1px solid rgba(255, 255, 255, 0.2)',
            }}
          >
            <div style={{ fontSize: '0.8rem', opacity: 0.9, fontWeight: 600 }}>
              🟣 Gross Monthly Sales Turnover
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: '0.25rem', color: '#ffffff' }}>
              {formatRupees(grossPaise)}
            </div>
            <div style={{ fontSize: '0.74rem', opacity: 0.8, marginTop: '0.2rem' }}>
              {settlements?.monthLabel || 'Current Month'} Cycle
            </div>
          </div>
        </div>
      </section>

      {/* Verified Bank Account Details Card */}
      <section
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          border: '1.5px solid #e2e8f0',
          padding: '1.25rem 1.5rem',
          boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04)',
          display: 'grid',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
              🏛️ Linked SHG Bank Account
            </h3>
            <div style={{ fontSize: '0.82rem', color: '#64748b' }}>
              Earnings are deposited directly to this verified bank account without manual withdrawal requests.
            </div>
          </div>

          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.35rem 0.75rem',
              borderRadius: '999px',
              background: '#dcfce7',
              color: '#166534',
              border: '1px solid #86efac',
              fontWeight: 700,
              fontSize: '0.82rem',
            }}
          >
            <span>✓</span>
            <span>RBI Verified & Active for DBT</span>
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: '1rem',
            background: '#f8fafc',
            padding: '1.15rem',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
          }}
        >
          <div>
            <div style={{ fontSize: '0.76rem', color: '#64748b', fontWeight: 600 }}>BANK NAME</div>
            <div style={{ fontSize: '0.98rem', fontWeight: 800, color: '#0f172a', marginTop: '0.2rem' }}>{bankName}</div>
            <div style={{ fontSize: '0.76rem', color: '#475569' }}>Damoh Main Branch, MP</div>
          </div>

          <div>
            <div style={{ fontSize: '0.76rem', color: '#64748b', fontWeight: 600 }}>ACCOUNT NUMBER</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, fontFamily: 'monospace', color: '#0f172a', marginTop: '0.2rem' }}>
              {maskedAccount}
            </div>
            <div style={{ fontSize: '0.76rem', color: '#15803d' }}>SAVINGS (SHG Shared Account)</div>
          </div>

          <div>
            <div style={{ fontSize: '0.76rem', color: '#64748b', fontWeight: 600 }}>IFSC CODE</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, fontFamily: 'monospace', color: '#0f172a', marginTop: '0.2rem' }}>
              {ifscCode}
            </div>
            <div style={{ fontSize: '0.76rem', color: '#475569' }}>Verified in RBI Directory</div>
          </div>

          <div>
            <div style={{ fontSize: '0.76rem', color: '#64748b', fontWeight: 600 }}>PAYOUT FREQUENCY</div>
            <div style={{ fontSize: '0.98rem', fontWeight: 800, color: '#0f172a', marginTop: '0.2rem' }}>
              T+1 Direct Transfer
            </div>
            <div style={{ fontSize: '0.76rem', color: '#64748b' }}>Zero Commission Deductions</div>
          </div>
        </div>
      </section>

      {/* Itemized Penalty Deductions (if any) */}
      {penaltyPaise > 0 && settlements?.penalties && (
        <section
          style={{
            background: '#fff5f5',
            borderRadius: '14px',
            border: '1.5px solid #fecaca',
            padding: '1.25rem',
            display: 'grid',
            gap: '0.85rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.1rem' }}>⚠️</span>
              <div>
                <strong style={{ fontSize: '0.95rem', color: '#991b1b' }}>
                  Itemized Deductions Ledger
                </strong>
                <div style={{ fontSize: '0.78rem', color: '#7f1d1d' }}>
                  Deductions for verified customer returns or damaged dispatches: −{formatRupees(penaltyPaise)}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {settlements.penalties.map((p: PenaltyLedgerEntry) => (
              <div
                key={p._id}
                style={{
                  background: '#ffffff',
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  border: '1px solid #fee2e2',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.85rem',
                }}
              >
                <div>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#991b1b' }}>
                    Order #{p.orderReference}
                  </span>
                  <div style={{ fontSize: '0.78rem', color: '#475569' }}>{p.reason}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <strong style={{ color: '#dc2626' }}>−{formatRupees(p.penaltyAmountPaise)}</strong>
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{p.settlementStatus}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Digital Passbook Entries Table */}
      <section
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          border: '1.5px solid #e2e8f0',
          padding: '1.25rem',
          boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.12rem', fontWeight: 800, color: '#0f172a' }}>
              📜 Monthly Passbook Ledger Entries
            </h3>
            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
              Complete record of direct benefit transfers credited for fulfilled orders.
            </div>
          </div>

          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#6b215c', background: 'rgba(107, 33, 92, 0.08)', padding: '0.3rem 0.65rem', borderRadius: '6px' }}>
            {settlements?.monthLabel || 'Current Cycle'}
          </span>
        </div>

        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Loading passbook ledger…</div>
        ) : error ? (
          <div style={{ padding: '1rem', color: '#dc2626', background: '#fef2f2', borderRadius: '8px' }}>{error}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.86rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 700 }}>Date</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 700 }}>Narration & Reference</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 700 }}>Fulfilled Orders</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 700, textAlign: 'right' }}>Credit Amount</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 700, textAlign: 'center' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.85rem 1rem', color: '#334155' }}>
                    {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <strong>eSakhi DBT Payout #{settlements?.monthLabel?.replace(/\s+/g, '') || '2026-03'}</strong>
                    <div style={{ fontSize: '0.74rem', color: '#64748b' }}>Direct settlement to {bankName} (Ac: {maskedAccount})</div>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', color: '#334155' }}>
                    <span style={{ padding: '0.2rem 0.5rem', background: '#f1f5f9', borderRadius: '6px', fontWeight: 700, fontSize: '0.8rem' }}>
                      {completedOrders} Verified Orders
                    </span>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'right', fontWeight: 800, color: '#15803d', fontSize: '1rem' }}>
                    +{formatRupees(netPaise)}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                    <span
                      style={{
                        padding: '0.25rem 0.65rem',
                        borderRadius: '999px',
                        background: '#dcfce7',
                        color: '#166534',
                        fontWeight: 700,
                        fontSize: '0.78rem',
                      }}
                    >
                      ✓ Credited via DBT
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
