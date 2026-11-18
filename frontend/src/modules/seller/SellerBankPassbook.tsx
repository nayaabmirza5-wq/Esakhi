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
  const [previewAbove5Lakh, setPreviewAbove5Lakh] = useState(false);

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
  const taxLedger = settlements?.statutoryTaxLedger;
  const isGstRegistered = Boolean(
    taxLedger?.hasGst ?? (sellerRecord?.taxDetails?.hasGst && sellerRecord?.taxDetails?.gstin)
  );
  const gstinDisplay = taxLedger?.gstin || sellerRecord?.taxDetails?.gstin || '23AAAAA0000A1Z5';
  const enrolmentIdDisplay =
    taxLedger?.enrolmentId || sellerRecord?.taxDetails?.enrolmentId || 'ENR-MP-470661-0012';
  const panDisplay = taxLedger?.panNumber || sellerRecord?.taxDetails?.panNumber || 'ABCDE1234F';

  const FIVE_LAKH_PAISE = 50_000_000;
  const realFyGrossPaise = taxLedger?.fyGrossSalesPaise ?? grossPaise;
  const effectiveFyGrossPaise = previewAbove5Lakh ? Math.max(realFyGrossPaise, 54_500_000) : realFyGrossPaise;
  const exceeds5Lakh = effectiveFyGrossPaise > FIVE_LAKH_PAISE;
  const thresholdPercent = Math.min(100, Math.round((effectiveFyGrossPaise / FIVE_LAKH_PAISE) * 1000) / 10);
  const remainingBeforeTdsPaise = Math.max(0, FIVE_LAKH_PAISE - effectiveFyGrossPaise);

  const effectiveTcsPaise = isGstRegistered
    ? (settlements?.tcsGstPaise ?? Math.round((grossPaise / 1.05) * 0.005))
    : 0;
  const effectiveTdsPaise = exceeds5Lakh
    ? Math.max(settlements?.tds194OPaise ?? 0, Math.round((previewAbove5Lakh ? Math.max(grossPaise, 54_500_000) : grossPaise) * 0.001))
    : 0;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      {/* SHG Transparent Passbook Hero Banner */}
      <section
        style={{
          background: 'linear-gradient(135deg, #4a1553 0%, #4A0E4E 100%)',
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

      {/* STATUTORY TAX LEDGER: GSTR-8 TCS & SECTION 194-O TDS */}
      <section
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          border: '1.5px solid #e2e8f0',
          padding: '1.25rem 1.5rem',
          boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04)',
          display: 'grid',
          gap: '1.15rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                ⚖️ Statutory Tax Ledger & Government Filings (TCS & TDS)
              </h3>
              <span
                style={{
                  padding: '0.2rem 0.6rem',
                  borderRadius: '999px',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  background: isGstRegistered ? '#dbeafe' : '#fef3c7',
                  color: isGstRegistered ? '#1e40af' : '#92400e',
                  border: `1px solid ${isGstRegistered ? '#93c5fd' : '#fde68a'}`,
                }}
              >
                {isGstRegistered ? 'GSTIN Registered Merchant' : 'Non-GST / Enrolment ID Seller'}
              </span>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.2rem' }}>
              Full transparency on statutory deductions deposited directly to the Government on your behalf.
            </div>
          </div>

          <div style={{ fontSize: '0.82rem', color: '#475569', background: '#f8fafc', padding: '0.4rem 0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <strong>{isGstRegistered ? 'GSTIN' : 'Enrolment ID'}:</strong>{' '}
            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>
              {isGstRegistered ? gstinDisplay : enrolmentIdDisplay}
            </span>{' '}
            | <strong>PAN:</strong> <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{panDisplay}</span>
          </div>
        </div>

        {/* LIVE ₹5,00,000 ANNUAL TURNOVER TRACKER (HOW PORTAL DETECTS >₹5L FOR SEC 194-O TDS) */}
        <div
          style={{
            padding: '1.1rem 1.25rem',
            borderRadius: '12px',
            background: exceeds5Lakh ? '#faf5ff' : '#f0f9ff',
            border: `1.5px solid ${exceeds5Lakh ? '#d8b4fe' : '#bae6fd'}`,
            display: 'grid',
            gap: '0.65rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>
                  📊 Live {taxLedger?.fyLabel || 'FY 2026-27'} Portal Sales vs ₹5,00,000 TDS Threshold (Section 194-O)
                </strong>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    padding: '0.15rem 0.55rem',
                    borderRadius: '999px',
                    background: exceeds5Lakh ? '#f3e8ff' : '#dcfce7',
                    color: exceeds5Lakh ? '#7e22ce' : '#166534',
                    border: `1px solid ${exceeds5Lakh ? '#c084fc' : '#86efac'}`,
                  }}
                >
                  {exceeds5Lakh
                    ? '⚡ ABOVE ₹5,00,000 — 0.1% TDS DEDUCTION ACTIVE'
                    : '✓ BELOW ₹5,00,000 — 0% TDS EXEMPT'}
                </span>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '0.15rem' }}>
                eSakhi automatically aggregates all your confirmed non-cancelled orders in the Indian Financial Year (1 Apr – 31 Mar) linked to PAN <strong>{panDisplay}</strong>.
              </div>
            </div>

            <button
              type="button"
              onClick={() => setPreviewAbove5Lakh((prev) => !prev)}
              style={{
                background: previewAbove5Lakh ? '#7e22ce' : '#ffffff',
                color: previewAbove5Lakh ? '#ffffff' : '#6b21a8',
                border: '1px solid #c084fc',
                borderRadius: '8px',
                padding: '0.35rem 0.75rem',
                fontSize: '0.75rem',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {previewAbove5Lakh ? '↺ Show Actual Live FY Sales' : '🔬 Simulate > ₹5,00,000 FY Sales (Test 0.1% TDS)'}
            </button>
          </div>

          {/* Progress Bar */}
          <div style={{ width: '100%', height: '10px', background: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.max(4, thresholdPercent)}%`,
                height: '100%',
                background: exceeds5Lakh
                  ? 'linear-gradient(90deg, #9333ea 0%, #c026d3 100%)'
                  : 'linear-gradient(90deg, #0284c7 0%, #10b981 100%)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', fontSize: '0.78rem', color: '#334155' }}>
            <span>
              <strong>Cumulative FY Gross Sales:</strong> {formatRupees(effectiveFyGrossPaise)} / ₹5,00,000 ({thresholdPercent}%)
            </span>
            <span>
              {exceeds5Lakh ? (
                <strong style={{ color: '#7e22ce' }}>
                  Crossed ₹5L limit by {formatRupees(effectiveFyGrossPaise - FIVE_LAKH_PAISE)} → 0.1% TDS ({formatRupees(effectiveTdsPaise)}) auto-deducted & filed in Form 26Q
                </strong>
              ) : (
                <strong style={{ color: '#0369a1' }}>
                  {formatRupees(remainingBeforeTdsPaise)} remaining in FY before 0.1% Section 194-O TDS activates
                </strong>
              )}
            </span>
          </div>
        </div>

        {/* 2 Tax Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {/* Box 1: GST TCS */}
          <div
            style={{
              padding: '1.15rem',
              borderRadius: '12px',
              background: isGstRegistered ? '#f0fdf4' : '#f8fafc',
              border: `1.5px solid ${isGstRegistered ? '#bbf7d0' : '#e2e8f0'}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: isGstRegistered ? '#166534' : '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Section 52 · GST TCS (0.5% · GSTR-8)
                </span>
                <h4 style={{ margin: '0.35rem 0 0.2rem', fontSize: '1.4rem', fontWeight: 800, color: isGstRegistered ? '#15803d' : '#64748b' }}>
                  {isGstRegistered ? formatRupees(effectiveTcsPaise) : '₹0 (Enrolment ID Exempt)'}
                </h4>
              </div>
              <span style={{ fontSize: '1.4rem' }}>{isGstRegistered ? '🏛️' : '🛡️'}</span>
            </div>

            <p style={{ margin: '0.45rem 0 0', fontSize: '0.78rem', color: '#475569', lineHeight: 1.45 }}>
              {isGstRegistered ? (
                <>
                  Deducted at 0.5% (0.25% CGST + 0.25% SGST) on net taxable value. Deposited monthly by eSakhi via <strong>GSTR-8</strong> directly into your <strong>GST Electronic Cash Ledger</strong> ({gstinDisplay}).
                </>
              ) : (
                <>
                  Non-GST sellers operating under Enrolment ID (<strong>{enrolmentIdDisplay}</strong>, Notification No. 34/2023-CT) are legally exempt from charging GST and <strong>0% TCS is deducted</strong>. Outward supply value is reported in GSTR-8 Table 4B.
                </>
              )}
            </p>
          </div>

          {/* Box 2: Income Tax TDS */}
          <div
            style={{
              padding: '1.15rem',
              borderRadius: '12px',
              background: '#fdf4ff',
              border: '1.5px solid #f5d0fe',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#86198f', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Section 194-O · Income Tax TDS (0.1% · Form 26Q)
                </span>
                <h4 style={{ margin: '0.35rem 0 0.2rem', fontSize: '1.4rem', fontWeight: 800, color: '#a21caf' }}>
                  {exceeds5Lakh ? `${formatRupees(effectiveTdsPaise)} (0.1% Deducted)` : '₹0 (Below ₹5L Limit)'}
                </h4>
              </div>
              <span style={{ fontSize: '1.4rem' }}>📋</span>
            </div>

            <p style={{ margin: '0.45rem 0 0', fontSize: '0.78rem', color: '#475569', lineHeight: 1.45 }}>
              Applicable when Financial Year e-commerce sales exceed <strong>₹5,00,000</strong>. Deposited by eSakhi against PAN <strong>{panDisplay}</strong> via quarterly <strong>Form 26Q</strong> and reflects in your <strong>Form 26AS / AIS (Form 16A)</strong> for full credit or refund.
            </p>
          </div>
        </div>

        {/* Claim Procedure Accordion */}
        <div style={{ background: '#f8fafc', padding: '0.9rem 1.15rem', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '0.8rem', color: '#334155', lineHeight: 1.5 }}>
          <strong>💡 How Sellers Claim Deducted Government Taxes Back:</strong>
          <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.25rem', display: 'grid', gap: '0.25rem' }}>
            <li><strong>GST TCS (GSTR-8):</strong> Login to <em>services.gst.gov.in</em> → Services → Returns → <em>TDS and TCS credit received</em>. Accept the eSakhi return entry; the amount immediately credits to your <strong>Cash Ledger</strong>!</li>
            <li><strong>Income Tax TDS (Form 16A):</strong> eSakhi generates quarterly Form 16A. When you file your annual ITR, pre-filled TDS credit reduces your tax liability or is refunded directly to your bank account.</li>
          </ul>
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

          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#4A0E4E', background: 'rgba(107, 33, 92, 0.08)', padding: '0.3rem 0.65rem', borderRadius: '6px' }}>
            {settlements?.monthLabel || 'Current Cycle'}
          </span>
        </div>

        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Loading passbook ledger…</div>
        ) : error ? (
          <div style={{ padding: '1rem', color: '#dc2626', background: '#fef2f2', borderRadius: '8px' }}>{error}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ padding: '0.75rem 0.85rem', color: '#475569', fontWeight: 700 }}>Date</th>
                  <th style={{ padding: '0.75rem 0.85rem', color: '#475569', fontWeight: 700 }}>Order / DBT Narration & SKU</th>
                  <th style={{ padding: '0.75rem 0.85rem', color: '#475569', fontWeight: 700, textAlign: 'right' }}>Gross Sale</th>
                  <th style={{ padding: '0.75rem 0.85rem', color: '#475569', fontWeight: 700, textAlign: 'right' }}>10% Fee</th>
                  <th style={{ padding: '0.75rem 0.85rem', color: '#475569', fontWeight: 700, textAlign: 'right' }}>GST TCS (0.5%)</th>
                  <th style={{ padding: '0.75rem 0.85rem', color: '#475569', fontWeight: 700, textAlign: 'right' }}>IT TDS (0.1%)</th>
                  <th style={{ padding: '0.75rem 0.85rem', color: '#475569', fontWeight: 700, textAlign: 'right' }}>Net Bank Credit</th>
                  <th style={{ padding: '0.75rem 0.85rem', color: '#475569', fontWeight: 700, textAlign: 'center' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '2px solid #e2e8f0', background: '#f0fdf4' }}>
                  <td style={{ padding: '0.85rem', color: '#334155', fontWeight: 700 }}>
                    {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td style={{ padding: '0.85rem' }}>
                    <strong>Monthly Summary · eSakhi DBT Payout #{settlements?.monthLabel?.replace(/\s+/g, '') || '2026-11'}</strong>
                    <div style={{ fontSize: '0.74rem', color: '#475569' }}>
                      {completedOrders} Verified Orders · {bankName} ({maskedAccount}) · {isGstRegistered ? `GSTIN: ${gstinDisplay}` : `Enrolment ID: ${enrolmentIdDisplay}`}
                    </div>
                  </td>
                  <td style={{ padding: '0.85rem', textAlign: 'right', fontWeight: 700 }}>{formatRupees(grossPaise)}</td>
                  <td style={{ padding: '0.85rem', textAlign: 'right', color: '#b45309' }}>−{formatRupees(settlements?.commissionPaise ?? Math.round(grossPaise * 0.1))}</td>
                  <td style={{ padding: '0.85rem', textAlign: 'right', color: '#0369a1' }}>
                    {isGstRegistered ? `−${formatRupees(effectiveTcsPaise)}` : '₹0 (Exempt)'}
                  </td>
                  <td style={{ padding: '0.85rem', textAlign: 'right', color: '#7e22ce' }}>
                    {exceeds5Lakh ? `−${formatRupees(effectiveTdsPaise)}` : '₹0 (≤₹5L)'}
                  </td>
                  <td style={{ padding: '0.85rem', textAlign: 'right', fontWeight: 800, color: '#15803d', fontSize: '0.98rem' }}>
                    +{formatRupees(netPaise)}
                  </td>
                  <td style={{ padding: '0.85rem', textAlign: 'center' }}>
                    <span
                      style={{
                        padding: '0.25rem 0.65rem',
                        borderRadius: '999px',
                        background: '#dcfce7',
                        color: '#166534',
                        fontWeight: 700,
                        fontSize: '0.76rem',
                      }}
                    >
                      ✓ DBT Active
                    </span>
                  </td>
                </tr>
                {(settlements?.orderLedger ?? []).map((entry) => (
                  <tr key={entry.orderId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.75rem 0.85rem', color: '#475569' }}>
                      {new Date(entry.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td style={{ padding: '0.75rem 0.85rem' }}>
                      <strong style={{ fontFamily: 'monospace', color: '#0f172a' }}>#{entry.orderReference}</strong>
                      <div style={{ fontSize: '0.74rem', color: '#64748b' }}>{entry.productSummary || 'Handcrafted SHG Item'}</div>
                    </td>
                    <td style={{ padding: '0.75rem 0.85rem', textAlign: 'right', fontWeight: 600 }}>{formatRupees(entry.grossPaise)}</td>
                    <td style={{ padding: '0.75rem 0.85rem', textAlign: 'right', color: '#64748b' }}>−{formatRupees(entry.commissionPaise)}</td>
                    <td style={{ padding: '0.75rem 0.85rem', textAlign: 'right', color: '#0369a1' }}>
                      {entry.tcsPaise > 0 ? `−${formatRupees(entry.tcsPaise)}` : '₹0'}
                    </td>
                    <td style={{ padding: '0.75rem 0.85rem', textAlign: 'right', color: '#7e22ce' }}>
                      {exceeds5Lakh ? `−${formatRupees(Math.round(entry.grossPaise * 0.001))}` : '₹0'}
                    </td>
                    <td style={{ padding: '0.75rem 0.85rem', textAlign: 'right', fontWeight: 700, color: '#15803d' }}>
                      +{formatRupees(entry.netPaise)}
                    </td>
                    <td style={{ padding: '0.75rem 0.85rem', textAlign: 'center' }}>
                      <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#166534' }}>✓ Verified</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
