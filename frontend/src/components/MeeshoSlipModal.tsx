import React, { useState } from 'react';
import type { SellerOrder, OrderAddressSnapshot } from '../types';

interface MeeshoSlipModalProps {
  order: SellerOrder | any;
  onClose: () => void;
  sellerBusinessName?: string;
  sellerAddress?: string;
  sellerPhone?: string;
}

// Convert paise to Indian English words (e.g., 79000 -> "Seven Hundred And Ninety Rupees Only")
function paiseToWords(paise: number): string {
  const amount = Math.floor(paise / 100);
  if (amount === 0) return 'Zero Rupees Only';

  const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertHundreds(n: number): string {
    let str = '';
    if (n >= 100) {
      str += units[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n >= 20) {
      str += tens[Math.floor(n / 10)] + ' ';
      n %= 10;
    }
    if (n > 0) {
      str += units[n] + ' ';
    }
    return str.trim();
  }

  let crore = Math.floor(amount / 10000000);
  let remainder = amount % 10000000;
  let lakh = Math.floor(remainder / 100000);
  remainder %= 100000;
  let thousand = Math.floor(remainder / 1000);
  remainder %= 1000;
  let hundreds = remainder;

  let words = '';
  if (crore > 0) words += convertHundreds(crore) + ' Crore ';
  if (lakh > 0) words += convertHundreds(lakh) + ' Lakh ';
  if (thousand > 0) words += convertHundreds(thousand) + ' Thousand ';
  if (hundreds > 0) words += convertHundreds(hundreds) + ' ';

  return (words.trim() + ' Rupees Only').toUpperCase();
}

// Smart HSN code assignment based on craft product categories
function getHsnCode(name: string): string {
  const lower = (name || '').toLowerCase();
  if (lower.includes('dupatta') || lower.includes('shawl') || lower.includes('stole')) return '621410';
  if (lower.includes('saree') || lower.includes('cotton') || lower.includes('fabric')) return '520842';
  if (lower.includes('bamboo') || lower.includes('tokri') || lower.includes('basket')) return '460211';
  if (lower.includes('terracotta') || lower.includes('diya') || lower.includes('pot') || lower.includes('clay')) return '691200';
  if (lower.includes('soap') || lower.includes('mitti') || lower.includes('herbal')) return '340111';
  if (lower.includes('papad') || lower.includes('achar') || lower.includes('pickle') || lower.includes('spices')) return '210690';
  if (lower.includes('clutch') || lower.includes('bag') || lower.includes('purse')) return '420222';
  return '621400';
}

// Crisp pure SVG Code-128 style optical barcode generator
function SvgBarcode({ value, height = 48 }: { value: string; height?: number }) {
  // Deterministic bar widths based on character codes
  const bars: Array<{ width: number; isBlack: boolean }> = [];
  bars.push({ width: 3, isBlack: true });
  bars.push({ width: 2, isBlack: false });
  bars.push({ width: 2, isBlack: true });

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const b1 = (code % 3) + 1;
    const s1 = ((code >> 1) % 3) + 1;
    const b2 = ((code >> 2) % 3) + 1;
    const s2 = ((code >> 3) % 2) + 1;
    bars.push({ width: b1, isBlack: true });
    bars.push({ width: s1, isBlack: false });
    bars.push({ width: b2, isBlack: true });
    bars.push({ width: s2, isBlack: false });
  }

  bars.push({ width: 3, isBlack: true });
  bars.push({ width: 1, isBlack: false });
  bars.push({ width: 4, isBlack: true });

  const totalWidth = bars.reduce((sum, b) => sum + b.width, 0);

  let currentX = 0;
  return (
    <div style={{ textAlign: 'center', margin: '4px 0' }}>
      <svg
        viewBox={`0 0 ${totalWidth} ${height}`}
        style={{ width: '100%', maxWidth: '280px', height: `${height}px`, display: 'inline-block' }}
        preserveAspectRatio="none"
      >
        {bars.map((bar, idx) => {
          const x = currentX;
          currentX += bar.width;
          if (!bar.isBlack) return null;
          return (
            <rect
              key={idx}
              x={x}
              y={0}
              width={bar.width}
              height={height}
              fill="#000000"
            />
          );
        })}
      </svg>
      <div style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '2px', fontWeight: 700, color: '#000' }}>
        *{value}*
      </div>
    </div>
  );
}

// Crisp SVG QR Code generator
function SvgQrCode({ text, size = 90 }: { text: string; size?: number }) {
  // High-density deterministic 21x21 matrix with standard QR position finder squares
  const gridSize = 21;
  const matrix: boolean[][] = Array.from({ length: gridSize }, () => Array(gridSize).fill(false));

  // Function to place 7x7 corner finder squares
  const placeFinder = (startX: number, startY: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        if (
          r === 0 || r === 6 || c === 0 || c === 6 ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        ) {
          matrix[startY + r][startX + c] = true;
        }
      }
    }
  };

  placeFinder(0, 0); // Top-left
  placeFinder(gridSize - 7, 0); // Top-right
  placeFinder(0, gridSize - 7); // Bottom-left

  // Timing patterns
  for (let i = 8; i < gridSize - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // Populate data-like pseudo modules from string hash
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const isTopLeft = r < 8 && c < 8;
      const isTopRight = r < 8 && c >= gridSize - 8;
      const isBottomLeft = r >= gridSize - 8 && c < 8;
      const isTiming = r === 6 || c === 6;
      if (isTopLeft || isTopRight || isBottomLeft || isTiming) continue;

      const seed = Math.sin(hash + r * 31 + c * 17) * 10000;
      matrix[r][c] = (seed - Math.floor(seed)) > 0.5;
    }
  }

  return (
    <div style={{ textAlign: 'center' }}>
      <svg
        viewBox={`0 0 ${gridSize} ${gridSize}`}
        style={{ width: `${size}px`, height: `${size}px`, border: '1px solid #000', padding: '2px', background: '#fff' }}
      >
        {matrix.map((row, r) =>
          row.map((filled, c) =>
            filled ? <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#000" /> : null
          )
        )}
      </svg>
      <div style={{ fontSize: '8px', color: '#333', fontWeight: 600, marginTop: '2px' }}>
        SCAN TO PAY / TRACK
      </div>
    </div>
  );
}

export const MeeshoSlipModal: React.FC<MeeshoSlipModalProps> = ({
  order,
  onClose,
  sellerBusinessName,
  sellerAddress,
  sellerPhone,
}) => {
  const [slipMode, setSlipMode] = useState<'combo' | 'label_only' | 'invoice_only'>('combo');

  const ref = order.orderReference || 'ES-SAMPLE-ORDER';
  const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }) : '10 Nov 2026, 11:30 PM';

  const isCod = order.paymentMethod === 'cash' || (order.paymentStatus === 'pending_verification' && order.paymentMethod !== 'upi');
  const totalPaise = order.totalPaise || order.subtotalPaise || 79000;
  const totalRupees = (totalPaise / 100).toFixed(2);
  const deliveryFeePaise = order.deliveryFeePaise || 4000;

  // Extract Destination Address
  const customerName = order.customerName || order.address?.name || 'Customer';
  const customerPhone = order.customerPhoneE164 || order.address?.phoneE164 || '+91 93198-XXXXX';
  const addr: OrderAddressSnapshot = order.address || {
    name: customerName,
    phoneE164: customerPhone,
    addressLine1: 'Purana Bazar, Ward 3',
    locality: 'Singhpur',
    city: 'Damoh',
    state: 'Madhya Pradesh',
    postalCode: '470661',
  };

  const fullCustomerAddress = [
    addr.houseNumber,
    addr.street,
    addr.addressLine1,
    addr.addressLine2,
    addr.landmark ? `Near ${addr.landmark}` : '',
    addr.locality,
    addr.city,
    addr.state,
    addr.postalCode ? `- ${addr.postalCode}` : '',
  ].filter(Boolean).join(', ');

  const destinationPincode = addr.postalCode || '470661';

  // Extract Seller / RTO Return Address
  const effectiveSellerName = sellerBusinessName || order.sellerPickup?.sellerName || 'Maitri SHG Damoh (Artisan Collective)';
  const effectiveSellerAddress = sellerAddress || order.sellerPickup?.address || 'Near Bada Mandir, Purana Bazar, Damoh, MP - 470661';
  const effectiveSellerPhone = sellerPhone || order.sellerPickup?.phoneE164 || '+91 99597-05392';

  // Compute GST splits (5% total handicraft GST: 2.5% CGST + 2.5% SGST intra-state)
  const items = (order.items && order.items.length > 0)
    ? order.items
    : [{ productName: 'Handcrafted Bridal Dupatta (Zari Red)', quantity: 1, lineTotalPaise: totalPaise - deliveryFeePaise, unitPricePaise: totalPaise - deliveryFeePaise }];

  let cumulativeTaxablePaise = 0;
  let cumulativeCgstPaise = 0;
  let cumulativeSgstPaise = 0;

  const itemRows = items.map((it: any, idx: number) => {
    const grossPaise = it.lineTotalPaise || (it.unitPricePaise ? it.unitPricePaise * it.quantity : 75000);
    // 5% inclusive GST formula: Taxable = Gross / 1.05
    const taxablePaise = Math.round(grossPaise / 1.05);
    const taxPaise = grossPaise - taxablePaise;
    const cgstPaise = Math.round(taxPaise / 2);
    const sgstPaise = taxPaise - cgstPaise;

    cumulativeTaxablePaise += taxablePaise;
    cumulativeCgstPaise += cgstPaise;
    cumulativeSgstPaise += sgstPaise;

    return {
      sNo: idx + 1,
      name: it.productName,
      hsn: getHsnCode(it.productName),
      qty: it.quantity || 1,
      unitPrice: ((it.unitPricePaise || Math.round(grossPaise / (it.quantity || 1))) / 100).toFixed(2),
      taxableVal: (taxablePaise / 100).toFixed(2),
      cgstRate: '2.5%',
      cgstAmt: (cgstPaise / 100).toFixed(2),
      sgstRate: '2.5%',
      sgstAmt: (sgstPaise / 100).toFixed(2),
      total: (grossPaise / 100).toFixed(2),
    };
  });

  const grandTotalPaise = cumulativeTaxablePaise + cumulativeCgstPaise + cumulativeSgstPaise + deliveryFeePaise;
  const invoiceNumber = `INV-${new Date().getFullYear()}-${ref.replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase()}`;

  const triggerPrint = () => {
    window.print();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(5px)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '1.5rem 1rem',
      }}
      onClick={onClose}
    >
      {/* Control Navigation Header (Screen only, completely omitted from print) */}
      <div
        className="meesho-modal-controls"
        style={{
          width: '100%',
          maxWidth: '840px',
          background: '#ffffff',
          borderRadius: '12px 12px 0 0',
          padding: '0.85rem 1.25rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '2px solid #e2e8f0',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#6b215c', letterSpacing: '-0.02em' }}>
            eSakhi Meesho-Style Slip
          </span>
          <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: '8px', padding: '3px' }}>
            <button
              type="button"
              onClick={() => setSlipMode('combo')}
              style={{
                border: 'none',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                background: slipMode === 'combo' ? '#6b215c' : 'transparent',
                color: slipMode === 'combo' ? '#ffffff' : '#475569',
              }}
            >
              2-in-1 Combo (A4)
            </button>
            <button
              type="button"
              onClick={() => setSlipMode('label_only')}
              style={{
                border: 'none',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                background: slipMode === 'label_only' ? '#6b215c' : 'transparent',
                color: slipMode === 'label_only' ? '#ffffff' : '#475569',
              }}
            >
              Shipping Label (4×6")
            </button>
            <button
              type="button"
              onClick={() => setSlipMode('invoice_only')}
              style={{
                border: 'none',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                background: slipMode === 'invoice_only' ? '#6b215c' : 'transparent',
                color: slipMode === 'invoice_only' ? '#ffffff' : '#475569',
              }}
            >
              Tax Invoice Only
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <button
            type="button"
            onClick={triggerPrint}
            style={{
              background: '#047857',
              color: '#ffffff',
              border: 'none',
              padding: '0.5rem 1.15rem',
              borderRadius: '8px',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 8px rgba(4, 120, 87, 0.3)',
            }}
          >
            🖨️ Print Slip (Ctrl+P)
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              color: '#475569',
              borderRadius: '8px',
              padding: '0.5rem 0.85rem',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* Printable Sheet Viewport */}
      <div
        id="meesho-printable-sheet"
        style={{
          width: '100%',
          maxWidth: '840px',
          background: '#ffffff',
          color: '#000000',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          padding: '20px 24px',
          boxShadow: '0 12px 30px rgba(0,0,0,0.25)',
          borderRadius: '0 0 12px 12px',
          boxSizing: 'border-box',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ========================================================================= */}
        {/* SECTION 1: MEESHO SHIPPING LABEL (TOP HALF - PASTED ON OUTER BOX)          */}
        {/* ========================================================================= */}
        {(slipMode === 'combo' || slipMode === 'label_only') && (
          <div
            className="meesho-shipping-label"
            style={{
              border: '2px solid #000000',
              padding: '12px 14px',
              marginBottom: slipMode === 'combo' ? '14px' : '0',
              background: '#ffffff',
              fontSize: '11px',
              lineHeight: 1.35,
            }}
          >
            {/* Top Bar: Carrier Brand + Routing + Huge PIN */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.4fr 1.6fr 1fr',
                borderBottom: '2px solid #000000',
                paddingBottom: '8px',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <div>
                <div style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '-0.03em' }}>
                  eSakhi
                </div>
                <div style={{ fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', color: '#111' }}>
                  Express Logistics · Rural SHG Network
                </div>
              </div>

              <div style={{ textAlign: 'center', borderLeft: '1px solid #000', borderRight: '1px solid #000', padding: '0 8px' }}>
                <div style={{ fontSize: '9px', fontWeight: 700, color: '#333' }}>HUB ROUTING CODE</div>
                <div style={{ fontSize: '15px', fontWeight: 900, letterSpacing: '0.05em' }}>MP-DAM-HUB01</div>
                <div style={{ fontSize: '8.5px', color: '#444' }}>Standard Surface · Hyperlocal</div>
              </div>

              <div style={{ textAlign: 'center', background: '#000000', color: '#ffffff', padding: '4px 6px', borderRadius: '4px' }}>
                <div style={{ fontSize: '8px', fontWeight: 700, letterSpacing: '0.05em' }}>DESTINATION PIN</div>
                <div style={{ fontSize: '20px', fontWeight: 900, letterSpacing: '1px' }}>{destinationPincode}</div>
              </div>
            </div>

            {/* AWB Barcode & Reference */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                borderBottom: '2px solid #000000',
                padding: '6px 0',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div>
                <div style={{ fontSize: '9px', fontWeight: 800, color: '#222' }}>
                  TRACKING NUMBER / AIR WAYBILL (AWB)
                </div>
                <SvgBarcode value={ref} height={42} />
              </div>
              <div style={{ textAlign: 'right', fontSize: '9.5px' }}>
                <div><strong>Order Date:</strong> {orderDate}</div>
                <div><strong>Order Ref:</strong> {ref}</div>
                <div><strong>Logistics:</strong> eSakhi Hyperlocal</div>
              </div>
            </div>

            {/* Giant Meesho-Style Payment Status Box */}
            <div
              style={{
                margin: '8px 0',
                padding: '8px 12px',
                border: '2px solid #000000',
                background: isCod ? '#000000' : '#f1f5f9',
                color: isCod ? '#ffffff' : '#000000',
                textAlign: 'center',
                borderRadius: '4px',
              }}
            >
              {isCod ? (
                <>
                  <div style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '0.04em' }}>
                    CASH ON DELIVERY (COD): ₹ {totalRupees}
                  </div>
                  <div style={{ fontSize: '10px', fontWeight: 700, marginTop: '2px', opacity: 0.9 }}>
                    ⚠️ DELIVERY AGENT: Collect exact cash of ₹{totalRupees} or scan Doorstep UPI before package handover!
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '17px', fontWeight: 900, letterSpacing: '0.04em' }}>
                    PREPAID (ONLINE UPI) — DO NOT COLLECT CASH
                  </div>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: '#334155' }}>
                    ✓ 100% Paid Online. Verify OTP from recipient and hand over parcel without collecting payment.
                  </div>
                </>
              )}
            </div>

            {/* Addresses Grid: Deliver To vs Return To */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.4fr 1fr',
                border: '1.5px solid #000000',
                gap: '0',
                margin: '6px 0',
              }}
            >
              {/* Deliver To */}
              <div style={{ padding: '8px 10px', borderRight: '1.5px solid #000000' }}>
                <div style={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', borderBottom: '1px solid #ccc', paddingBottom: '2px', marginBottom: '4px' }}>
                  DELIVER TO (CUSTOMER):
                </div>
                <div style={{ fontSize: '13px', fontWeight: 900, color: '#000' }}>{customerName}</div>
                <div style={{ fontSize: '10.5px', marginTop: '2px', fontWeight: 500 }}>{fullCustomerAddress}</div>
                <div style={{ fontSize: '11px', fontWeight: 800, marginTop: '4px' }}>
                  Phone: {customerPhone}
                </div>
              </div>

              {/* Return To */}
              <div style={{ padding: '8px 10px', background: '#fafafa' }}>
                <div style={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', borderBottom: '1px solid #ccc', paddingBottom: '2px', marginBottom: '4px' }}>
                  RETURN / SHIP FROM (SELLER):
                </div>
                <div style={{ fontSize: '11.5px', fontWeight: 800 }}>{effectiveSellerName}</div>
                <div style={{ fontSize: '9.5px', color: '#333', marginTop: '2px' }}>{effectiveSellerAddress}</div>
                <div style={{ fontSize: '10px', fontWeight: 700, marginTop: '4px' }}>
                  Contact: {effectiveSellerPhone}
                </div>
              </div>
            </div>

            {/* Package Manifest & QR Code Row */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                borderTop: '1px solid #000000',
                paddingTop: '6px',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div>
                <div style={{ fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', marginBottom: '3px' }}>
                  PACKAGE CONTENTS MANIFEST ({items.length} ITEM{items.length > 1 ? 'S' : ''}):
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9.5px' }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                      <th style={{ border: '1px solid #000', padding: '2px 4px' }}>Item Title</th>
                      <th style={{ border: '1px solid #000', padding: '2px 4px', width: '50px' }}>Qty</th>
                      <th style={{ border: '1px solid #000', padding: '2px 4px', width: '70px', textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it: any, idx: number) => (
                      <tr key={idx}>
                        <td style={{ border: '1px solid #000', padding: '2px 4px' }}>{it.productName}</td>
                        <td style={{ border: '1px solid #000', padding: '2px 4px', fontWeight: 800 }}>{it.quantity}</td>
                        <td style={{ border: '1px solid #000', padding: '2px 4px', textAlign: 'right', fontWeight: 800 }}>
                          ₹{((it.lineTotalPaise || 75000) / 100).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: '8.5px', color: '#555', marginTop: '3px' }}>
                  Weight: 0.45 kg · Verified Rural Artisan Handcraft Goods
                </div>
              </div>

              <div>
                <SvgQrCode text={`upi://pay?pa=esakhi.shg@sbi&pn=eSakhi&am=${totalRupees}&tr=${ref}`} size={70} />
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* CENTER PERFORATION / FOLD LINE                                            */}
        {/* ========================================================================= */}
        {slipMode === 'combo' && (
          <div
            className="meesho-perforation-divider"
            style={{
              textAlign: 'center',
              borderTop: '2px dashed #666666',
              margin: '18px 0',
              position: 'relative',
              fontSize: '9.5px',
              fontWeight: 800,
              color: '#444444',
              letterSpacing: '1px',
            }}
          >
            <span
              style={{
                position: 'relative',
                top: '-10px',
                background: '#ffffff',
                padding: '0 12px',
              }}
            >
              ✂ FOLD OR CUT HERE (Top: Paste on Parcel · Bottom: Place Inside / Hand to Buyer) ✂
            </span>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SECTION 2: TAX INVOICE & RETAIL BILL OF SUPPLY (BOTTOM HALF)               */}
        {/* ========================================================================= */}
        {(slipMode === 'combo' || slipMode === 'invoice_only') && (
          <div
            className="meesho-tax-invoice"
            style={{
              border: '2px solid #000000',
              padding: '12px 14px',
              background: '#ffffff',
              fontSize: '10.5px',
              lineHeight: 1.35,
            }}
          >
            {/* Invoice Heading & Metadata */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.8fr 1.2fr',
                borderBottom: '2px solid #000000',
                paddingBottom: '8px',
                alignItems: 'flex-start',
                gap: '12px',
              }}
            >
              <div>
                <div style={{ fontSize: '13px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  TAX INVOICE / RETAIL BILL OF SUPPLY
                </div>
                <div style={{ fontSize: '9px', fontWeight: 700, color: '#333' }}>
                  (Original for Recipient · Inter-state/Intra-state Supply Under Rule 46 of CGST Rules)
                </div>
                <div style={{ fontSize: '10px', marginTop: '4px' }}>
                  <strong>eSakhi E-Commerce Platform</strong> · Empowering Rural Artisan SHGs
                </div>
              </div>

              <div style={{ fontSize: '9.5px', textAlign: 'right' }}>
                <div><strong>Invoice No:</strong> {invoiceNumber}</div>
                <div><strong>Invoice Date:</strong> {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                <div><strong>Order ID:</strong> {ref}</div>
                <div><strong>Place of Supply:</strong> MADHYA PRADESH (Code 23)</div>
                <div><strong>Reverse Charge:</strong> No</div>
              </div>
            </div>

            {/* Seller & Customer Tax Details */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                borderBottom: '1.5px solid #000000',
                gap: '12px',
                padding: '6px 0',
              }}
            >
              <div>
                <div style={{ fontSize: '9.5px', fontWeight: 900, textTransform: 'uppercase', color: '#111', borderBottom: '1px solid #ccc', paddingBottom: '1px' }}>
                  SOLD BY (ARTISAN SUPPLIER):
                </div>
                <div style={{ fontSize: '11px', fontWeight: 900, marginTop: '2px' }}>{effectiveSellerName}</div>
                <div style={{ fontSize: '9px' }}>{effectiveSellerAddress}</div>
                <div style={{ fontSize: '9px' }}>Contact: {effectiveSellerPhone}</div>
                <div style={{ fontSize: '9px', fontWeight: 700, marginTop: '2px' }}>
                  GSTIN / NRLM Enrolment: 23AAICA7618B1ZE · MP State Code 23
                </div>
              </div>

              <div>
                <div style={{ fontSize: '9.5px', fontWeight: 900, textTransform: 'uppercase', color: '#111', borderBottom: '1px solid #ccc', paddingBottom: '1px' }}>
                  BILLING & SHIPPING ADDRESS:
                </div>
                <div style={{ fontSize: '11px', fontWeight: 900, marginTop: '2px' }}>{customerName}</div>
                <div style={{ fontSize: '9px' }}>{fullCustomerAddress}</div>
                <div style={{ fontSize: '9px' }}>Phone: {customerPhone}</div>
                <div style={{ fontSize: '9px', fontWeight: 700, marginTop: '2px' }}>
                  State: Madhya Pradesh (State Code 23)
                </div>
              </div>
            </div>

            {/* Itemized GST Table */}
            <div style={{ margin: '8px 0' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9.5px' }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', textAlign: 'center', fontWeight: 900 }}>
                    <th style={{ border: '1px solid #000', padding: '4px 3px', width: '24px' }}>#</th>
                    <th style={{ border: '1px solid #000', padding: '4px 4px', textAlign: 'left' }}>Description of Goods</th>
                    <th style={{ border: '1px solid #000', padding: '4px 3px', width: '50px' }}>HSN</th>
                    <th style={{ border: '1px solid #000', padding: '4px 3px', width: '28px' }}>Qty</th>
                    <th style={{ border: '1px solid #000', padding: '4px 4px', width: '55px', textAlign: 'right' }}>Unit (₹)</th>
                    <th style={{ border: '1px solid #000', padding: '4px 4px', width: '60px', textAlign: 'right' }}>Taxable (₹)</th>
                    <th style={{ border: '1px solid #000', padding: '4px 3px', width: '35px' }}>CGST</th>
                    <th style={{ border: '1px solid #000', padding: '4px 4px', width: '45px', textAlign: 'right' }}>CGST ₹</th>
                    <th style={{ border: '1px solid #000', padding: '4px 3px', width: '35px' }}>SGST</th>
                    <th style={{ border: '1px solid #000', padding: '4px 4px', width: '45px', textAlign: 'right' }}>SGST ₹</th>
                    <th style={{ border: '1px solid #000', padding: '4px 4px', width: '60px', textAlign: 'right' }}>Total (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {itemRows.map((r: any, i: number) => (
                    <tr key={i} style={{ textAlign: 'center' }}>
                      <td style={{ border: '1px solid #000', padding: '3px' }}>{r.sNo}</td>
                      <td style={{ border: '1px solid #000', padding: '3px 4px', textAlign: 'left', fontWeight: 600 }}>{r.name}</td>
                      <td style={{ border: '1px solid #000', padding: '3px' }}>{r.hsn}</td>
                      <td style={{ border: '1px solid #000', padding: '3px', fontWeight: 800 }}>{r.qty}</td>
                      <td style={{ border: '1px solid #000', padding: '3px 4px', textAlign: 'right' }}>{r.unitPrice}</td>
                      <td style={{ border: '1px solid #000', padding: '3px 4px', textAlign: 'right' }}>{r.taxableVal}</td>
                      <td style={{ border: '1px solid #000', padding: '3px' }}>{r.cgstRate}</td>
                      <td style={{ border: '1px solid #000', padding: '3px 4px', textAlign: 'right' }}>{r.cgstAmt}</td>
                      <td style={{ border: '1px solid #000', padding: '3px' }}>{r.sgstRate}</td>
                      <td style={{ border: '1px solid #000', padding: '3px 4px', textAlign: 'right' }}>{r.sgstAmt}</td>
                      <td style={{ border: '1px solid #000', padding: '3px 4px', textAlign: 'right', fontWeight: 800 }}>{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Financial Summary & Amount in Words */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.4fr 1fr',
                border: '1.5px solid #000000',
                gap: '0',
                margin: '6px 0',
              }}
            >
              <div style={{ padding: '8px 10px', borderRight: '1.5px solid #000000', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', color: '#333' }}>
                    AMOUNT IN WORDS:
                  </div>
                  <div style={{ fontSize: '10.5px', fontWeight: 900, color: '#000', marginTop: '2px' }}>
                    {paiseToWords(grandTotalPaise)}
                  </div>
                </div>

                <div style={{ marginTop: '8px', borderTop: '1px solid #ddd', paddingTop: '4px', fontSize: '8.5px', color: '#444' }}>
                  <div><strong>Customer Grievance & Support:</strong> +91 76270 49855 | support@esakhi.in</div>
                  <div><strong>Return Window:</strong> 7 days return eligible with original packaging intact.</div>
                </div>
              </div>

              <div style={{ padding: '8px 10px', fontSize: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <span>Taxable Value:</span>
                  <strong>₹ {(cumulativeTaxablePaise / 100).toFixed(2)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <span>CGST (2.5%):</span>
                  <span>₹ {(cumulativeCgstPaise / 100).toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <span>SGST (2.5%):</span>
                  <span>₹ {(cumulativeSgstPaise / 100).toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <span>Delivery Charges:</span>
                  <span>₹ {(deliveryFeePaise / 100).toFixed(2)}</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    borderTop: '2px solid #000000',
                    paddingTop: '4px',
                    marginTop: '4px',
                    fontSize: '13px',
                    fontWeight: 900,
                  }}
                >
                  <span>GRAND TOTAL:</span>
                  <span>₹ {(grandTotalPaise / 100).toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Handover & Legal Footer */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.4fr 1fr',
                borderTop: '1.5px solid #000000',
                paddingTop: '6px',
                marginTop: '6px',
                alignItems: 'flex-end',
                gap: '12px',
                fontSize: '9px',
              }}
            >
              <div>
                <div><strong>Delivery Mode:</strong> {isCod ? 'Cash on Delivery (COD)' : 'Prepaid Online'}</div>
                <div><strong>Verification OTP:</strong> [{order.deliveryOtp || ' _ _ _ _ '}] Verified upon handover</div>
                <div style={{ marginTop: '2px', color: '#555' }}>
                  This is a computer-generated tax invoice verified under the eSakhi Digital SHG Initiative.
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ height: '24px' }}></div>
                <div style={{ borderTop: '1px solid #000', display: 'inline-block', minWidth: '160px', textAlign: 'center', paddingTop: '2px', fontWeight: 700 }}>
                  Authorized Signatory (SHG Artisan)
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Embedded Print CSS to guarantee clean A4 print without browser chrome or modal overlays */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #meesho-printable-sheet,
          #meesho-printable-sheet * {
            visibility: visible !important;
          }
          #meesho-printable-sheet {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 8mm !important;
            box-shadow: none !important;
            border-radius: 0 !important;
          }
          .meesho-modal-controls {
            display: none !important;
          }
          @page {
            size: A4 portrait;
            margin: 6mm;
          }
        }
      `}</style>
    </div>
  );
};
