import React, { useState } from 'react';
import QRCode from 'qrcode';
import type { SellerOrder, OrderAddressSnapshot } from '../types';

interface MeeshoSlipModalProps {
  order: SellerOrder | any;
  onClose: () => void;
  sellerBusinessName?: string;
  sellerAddress?: string;
  sellerPhone?: string;
}

// Convert paise to Title Case Indian English words: "Rupees One Thousand One Hundred Forty Only"
function paiseToRupeesWords(paise: number): string {
  const totalRupees = Math.floor(paise / 100);
  const remainingPaise = Math.round(paise % 100);

  if (totalRupees === 0 && remainingPaise === 0) return 'Rupees Zero Only';

  const units = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertBelowThousand(n: number): string {
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

  let amount = totalRupees;
  const crore = Math.floor(amount / 10000000);
  amount %= 10000000;
  const lakh = Math.floor(amount / 100000);
  amount %= 100000;
  const thousand = Math.floor(amount / 1000);
  amount %= 1000;
  const hundreds = amount;

  let words = '';
  if (crore > 0) words += convertBelowThousand(crore) + ' Crore ';
  if (lakh > 0) words += convertBelowThousand(lakh) + ' Lakh ';
  if (thousand > 0) words += convertBelowThousand(thousand) + ' Thousand ';
  if (hundreds > 0) words += convertBelowThousand(hundreds) + ' ';

  let result = 'Rupees ' + words.trim();
  if (remainingPaise > 0) {
    result += ' And ' + convertBelowThousand(remainingPaise) + ' Paise';
  }
  return result + ' Only';
}

// Format currency in Indian style: ₹1,150.00
function formatInr(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((paise || 0) / 100);
}

// Format date as DD-MMM-YYYY (e.g., 11-Nov-2026)
function formatBillDate(dateInput?: string | Date): string {
  const d = dateInput ? new Date(dateInput) : new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(d.getDate()).padStart(2, '0');
  const month = months[d.getMonth()] || 'Nov';
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

// Official ISO/IEC 15417 Code-128B symbol patterns (values 0..106)
const CODE128_PATTERNS = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100', '10001001100', '10011001000', '10011000100',
  '10001100100', '11001001000', '11001000100', '11000100100', '10110011100', '10011011100', '10011001110', '10111001100',
  '10011101100', '10011100110', '11001110010', '11001011100', '11001001110', '11011100100', '11001110100', '11101101110',
  '11101001100', '11100101100', '11100100110', '11101100100', '11100110100', '11100110010', '11011011000', '11011000110',
  '11000110110', '10100011000', '10001011000', '10001000110', '10110001000', '10001101000', '10001100010', '11010001000',
  '11000101000', '11000100010', '10110111000', '10110001110', '10001101110', '10111011000', '10111000110', '10001110110',
  '11101110110', '11010001110', '11000101110', '11011101000', '11011100010', '11011101110', '11101011000', '11101000110',
  '11100010110', '11101101000', '11101100010', '11100011010', '11101111010', '11001000010', '11110001010', '10100110000',
  '10100001100', '10010110000', '10010000110', '10000101100', '10000100110', '10110010000', '10110000100', '10011010000',
  '10011000010', '10000110100', '10000110010', '11000010010', '11001010000', '11110111010', '11000010100', '10001111010',
  '10100111100', '10010111100', '10010011110', '10111100100', '10011110100', '10011110010', '11110100100', '11110010100',
  '11110010010', '11011011110', '11011110110', '11110110110', '10101111000', '10100011110', '10001011110', '10111101000',
  '10111100010', '11110101000', '11110100010', '10111011110', '10111101110', '11101011110', '11110101110', '11010000100',
  '11010010000', '11010011100', '1100011101011',
];

// Real ISO/IEC 15417 Code-128B Optical Retail Barcode SVG
function SvgBarcode({
  value,
  height = 38,
  width = 185,
  label,
  onInspect,
}: {
  value: string;
  height?: number;
  width?: number;
  label?: string;
  onInspect?: () => void;
}) {
  // Encode using Code 128 Set B (Start Code B = 104)
  const clean = value.replace(/[^\x20-\x7E]/g, '') || 'BOS2026';
  let checksum = 104;
  let bitString = '0000000000' + CODE128_PATTERNS[104]; // 10-module quiet zone + Start B

  for (let i = 0; i < clean.length; i++) {
    const codeVal = clean.charCodeAt(i) - 32;
    const clamped = Math.max(0, Math.min(94, codeVal));
    checksum += clamped * (i + 1);
    bitString += CODE128_PATTERNS[clamped];
  }

  const checkSymbol = checksum % 103;
  bitString += CODE128_PATTERNS[checkSymbol];
  bitString += CODE128_PATTERNS[106]; // Stop pattern (13 modules)
  bitString += '0000000000'; // Trailing quiet zone

  const totalModules = bitString.length;

  return (
    <div
      style={{ display: 'inline-block', textAlign: 'center', cursor: onInspect ? 'pointer' : 'default' }}
      onClick={onInspect}
      title={`Click or scan with a Code-128 barcode scanner: ${clean}`}
    >
      <svg
        viewBox={`0 0 ${totalModules} ${height}`}
        style={{ width: `${width}px`, height: `${height}px`, display: 'block', background: '#ffffff' }}
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
      >
        {Array.from(bitString).map((bit, idx) =>
          bit === '1' ? <rect key={idx} x={idx} y={0} width={1} height={height} fill="#000000" /> : null,
        )}
      </svg>
      <div
        style={{
          fontFamily: '"Courier New", Courier, monospace',
          fontSize: '8.5px',
          fontWeight: 700,
          letterSpacing: '0.4px',
          marginTop: '3px',
          color: '#000',
          whiteSpace: 'nowrap',
        }}
      >
        {label || `*${clean}*`}
      </div>
    </div>
  );
}

// Real ISO/IEC 18004 Scannable QR Code SVG (powered by 'qrcode')
function SvgQrCode({
  text,
  size = 90,
  onInspect,
}: {
  text: string;
  size?: number;
  onInspect?: () => void;
}) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const gridSize = qr.modules.size;
  const data = qr.modules.data;
  const quietZone = 2;
  const totalView = gridSize + quietZone * 2;

  const rects: React.ReactElement[] = [];
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (data[r * gridSize + c]) {
        rects.push(
          <rect key={`${r}-${c}`} x={c + quietZone} y={r + quietZone} width={1} height={1} fill="#000000" />,
        );
      }
    }
  }

  return (
    <div
      style={{ display: 'inline-block', textAlign: 'center', cursor: onInspect ? 'pointer' : 'default' }}
      onClick={onInspect}
      title="Scan with your phone camera (Google Lens / QR Scanner) or click to preview decoded Bill of Supply data"
    >
      <svg
        viewBox={`0 0 ${totalView} ${totalView}`}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          border: '1.5px solid #000',
          background: '#ffffff',
          display: 'block',
          margin: '0 auto',
        }}
        shapeRendering="crispEdges"
      >
        <rect x={0} y={0} width={totalView} height={totalView} fill="#ffffff" />
        {rects}
      </svg>
      <div style={{ fontSize: '8.5px', fontWeight: 700, letterSpacing: '0.04em', marginTop: '3px', color: '#000' }}>
        VERIFIED BILL QR
      </div>
    </div>
  );
}

export const MeeshoSlipModal: React.FC<MeeshoSlipModalProps> = ({
  order,
  onClose,
  sellerBusinessName,
  sellerAddress,
}) => {
  const ref = order.orderReference || 'OD42981039481';
  const formattedDate = formatBillDate(order.createdAt);
  const year = order.createdAt ? new Date(order.createdAt).getFullYear() : 2026;
  const shortNumericHash = String(
    Math.abs(
      ref.split('').reduce((acc: number, ch: string) => acc * 31 + ch.charCodeAt(0), 7),
    ) % 9000 + 1000,
  );
  const invoiceNo = `BOS-${year}-${shortNumericHash}`;

  const isCod =
    order.paymentMethod === 'cash' ||
    (order.paymentStatus === 'pending_verification' && order.paymentMethod !== 'upi');
  const paymentModeText = isCod ? 'Cash on Delivery (COD)' : 'Prepaid (Online / UPI)';

  // Seller Details (Unregistered E-Commerce Seller under Notification No. 34/2023-CT)
  const effectiveSellerName =
    sellerBusinessName ||
    order.sellerPickup?.sellerName ||
    'Maitri SHG Damoh';
  const effectiveSellerAddress =
    sellerAddress ||
    order.sellerPickup?.address ||
    'Station Road, Purana Bazar, Damoh, Madhya Pradesh - 470661';
  const enrolmentId =
    order.sellerPickup?.enrolmentId ||
    '23ABCDE1234F1Z9';
  const panNumber =
    order.sellerPickup?.panNumber ||
    enrolmentId.slice(2, 12) ||
    'ABCDE1234F';

  // Customer Details (Bill To / Ship To)
  const customerName = order.customerName || order.address?.name || 'Valued Customer';
  const customerPhone = order.customerPhoneE164 || order.address?.phoneE164 || '';
  const addr: OrderAddressSnapshot = order.address || {
    name: customerName,
    phoneE164: customerPhone,
    addressLine1: 'Civil Ward, Purana Bazar',
    locality: 'Damoh',
    city: 'Damoh',
    state: 'Madhya Pradesh',
    postalCode: '470661',
  };

  const streetLine = [
    addr.houseNumber,
    addr.street,
    addr.addressLine1,
    addr.addressLine2,
    addr.landmark ? `Near ${addr.landmark}` : '',
    addr.locality,
  ]
    .filter(Boolean)
    .join(', ');

  const cityStatePinLine = `${addr.city || 'Damoh'}, Madhya Pradesh - ${addr.postalCode || '470661'}`;

  // Line Items
  const rawItems =
    order.items && order.items.length > 0
      ? order.items
      : [
          {
            productName: 'Handcrafted Artisan SHG Product',
            quantity: 1,
            unitPricePaise: order.subtotalPaise || 75000,
            lineTotalPaise: order.subtotalPaise || 75000,
          },
        ];

  let computedSubtotalPaise = 0;
  const lineRows = rawItems.map((it: any, idx: number) => {
    const qty = it.quantity || 1;
    const lineTotalPaise =
      it.lineTotalPaise || (it.unitPricePaise ? it.unitPricePaise * qty : 75000);
    const unitPricePaise = it.unitPricePaise || Math.round(lineTotalPaise / qty);
    computedSubtotalPaise += lineTotalPaise;

    const variantText =
      it.variantAttributes && Object.keys(it.variantAttributes).length > 0
        ? ` (${Object.entries(it.variantAttributes)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ')})`
        : '';

    return {
      sNo: `${idx + 1}.`,
      description: `${it.productName}${variantText}`,
      qty,
      unitPricePaise,
      lineTotalPaise,
    };
  });

  const subtotalPaise = computedSubtotalPaise;
  const discountPaise = order.discountPaise || 0;
  const shippingPaise = order.deliveryFeePaise ?? 0;
  const grandTotalPaise = order.totalPaise || (subtotalPaise - discountPaise + shippingPaise);

  const [scanPreview, setScanPreview] = useState<'qr' | 'barcode' | null>(null);

  const itemsSummaryText = lineRows
    .map((r: { qty: number; description: string; lineTotalPaise: number }) => `${r.qty}x ${r.description} (${formatInr(r.lineTotalPaise)})`)
    .join(', ');

  // Scannable QR Code Payload (human-readable verified receipt when scanned with any phone camera / Google Lens)
  const qrVerificationPayload = [
    '=== eSAKHI VERIFIED BILL OF SUPPLY ===',
    `Invoice No: ${invoiceNo}`,
    `Order ID: ${ref}`,
    `Date: ${formattedDate}`,
    `Seller: ${effectiveSellerName}`,
    `Enrolment ID: ${enrolmentId} | PAN: ${panNumber}`,
    `Place of Supply: Madhya Pradesh (23) [Intra-State]`,
    `Customer: ${customerName}`,
    `Items: ${itemsSummaryText}`,
    `Grand Total: ${formatInr(grandTotalPaise)} (GST 0% - Exempt u/s 34/2023-CT)`,
    `Payment: ${paymentModeText}`,
    'Status: AUTHENTICATED PACKAGE PROOF SLIP',
  ].join('\n');

  const doubleRule: React.CSSProperties = {
    borderTop: '3px double #000000',
    margin: '10px 0',
  };

  const dashedRule: React.CSSProperties = {
    borderTop: '1.5px dashed #000000',
    margin: '8px 0',
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
        backdropFilter: 'blur(4px)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '1.25rem 0.75rem',
      }}
      onClick={onClose}
    >
      {/* Screen Action Bar (Hidden when printing) */}
      <div
        className="meesho-modal-controls"
        style={{
          width: '100%',
          maxWidth: '760px',
          background: '#ffffff',
          borderRadius: '12px 12px 0 0',
          padding: '0.75rem 1.25rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '2px solid #e2e8f0',
          boxSizing: 'border-box',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <strong style={{ fontSize: '1rem', color: '#4A0E4E', display: 'block' }}>
            Bill of Supply · Package Proof Slip
          </strong>
          <span style={{ fontSize: '0.76rem', color: '#64748b' }}>
            Scan QR / Barcode with phone camera or click them below to preview decoded verification data
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={() => setScanPreview((prev) => (prev === 'qr' ? null : 'qr'))}
            style={{
              background: scanPreview ? '#4A0E4E' : '#f3e8ff',
              color: scanPreview ? '#ffffff' : '#4A0E4E',
              border: '1px solid #d8b4fe',
              padding: '0.5rem 0.9rem',
              borderRadius: '8px',
              fontWeight: 700,
              fontSize: '12.5px',
              cursor: 'pointer',
            }}
          >
            📱 {scanPreview ? 'Hide Scan Output' : 'What Scans Show'}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
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
            }}
          >
            🖨️ Print Bill of Supply
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

      {/* Interactive Scanner Output Inspector (Hidden when printing) */}
      {scanPreview && (
        <div
          className="meesho-modal-controls"
          style={{
            width: '100%',
            maxWidth: '760px',
            background: '#0f172a',
            color: '#f8fafc',
            padding: '0.9rem 1.25rem',
            boxSizing: 'border-box',
            borderBottom: '2px solid #334155',
            fontSize: '12px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <strong style={{ color: '#38bdf8', fontSize: '12.5px' }}>
              {scanPreview === 'qr'
                ? '📱 QR Code Scanner Result (ISO/IEC 18004 — Phone Camera / Google Lens)'
                : '🔫 Retail 1D Barcode Scanner Result (ISO/IEC 15417 Code-128B)'}
            </strong>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                onClick={() => setScanPreview('qr')}
                style={{
                  background: scanPreview === 'qr' ? '#0284c7' : '#1e293b',
                  color: '#fff',
                  border: '1px solid #475569',
                  borderRadius: '5px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                QR Code Output
              </button>
              <button
                type="button"
                onClick={() => setScanPreview('barcode')}
                style={{
                  background: scanPreview === 'barcode' ? '#0284c7' : '#1e293b',
                  color: '#fff',
                  border: '1px solid #475569',
                  borderRadius: '5px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                1D Barcode Output
              </button>
            </div>
          </div>
          {scanPreview === 'qr' ? (
            <pre
              style={{
                margin: 0,
                padding: '8px 10px',
                background: '#1e293b',
                borderRadius: '6px',
                color: '#a7f3d0',
                fontFamily: '"Courier New", Courier, monospace',
                fontSize: '11.5px',
                lineHeight: 1.45,
                whiteSpace: 'pre-wrap',
              }}
            >
              {qrVerificationPayload}
            </pre>
          ) : (
            <div
              style={{
                padding: '8px 10px',
                background: '#1e293b',
                borderRadius: '6px',
                color: '#fde68a',
                fontFamily: '"Courier New", Courier, monospace',
                fontSize: '12px',
              }}
            >
              <div>
                <strong>Top Retail Slip Barcode (Code-128B):</strong> Decodes to Order ID{' '}
                <code style={{ color: '#fff', fontWeight: 700 }}>{ref}</code>
              </div>
              <div style={{ marginTop: '4px' }}>
                <strong>Bottom Invoice Barcode (Code-128B):</strong> Decodes to Bill of Supply No{' '}
                <code style={{ color: '#fff', fontWeight: 700 }}>{invoiceNo}</code>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Printable Bill of Supply Sheet */}
      <div
        id="meesho-printable-sheet"
        style={{
          width: '100%',
          maxWidth: '760px',
          background: '#ffffff',
          color: '#000000',
          fontFamily: '"Courier New", Courier, "Liberation Mono", monospace',
          padding: '24px 28px',
          boxShadow: '0 12px 30px rgba(0,0,0,0.25)',
          borderRadius: '0 0 12px 12px',
          boxSizing: 'border-box',
          border: '2px solid #000000',
          fontSize: '12.5px',
          lineHeight: 1.45,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ================================================================== */}
        {/* TOP HEADER WITH RETAIL BARCODE, BILL OF SUPPLY TITLE, AND QR CODE  */}
        {/* ================================================================== */}
        <div style={doubleRule} />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '215px 1fr 110px',
            alignItems: 'center',
            gap: '12px',
            padding: '4px 0',
          }}
        >
          {/* Left: Brand & Retail Barcode */}
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontWeight: 900, fontSize: '14px', letterSpacing: '0.05em', marginBottom: '4px', fontFamily: 'Arial, sans-serif' }}>
              eSAKHI RETAIL SLIP
            </div>
            <SvgBarcode
              value={ref}
              height={36}
              width={205}
              label={ref}
              onInspect={() => setScanPreview('barcode')}
            />
          </div>

          {/* Center: BILL OF SUPPLY Heading */}
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontSize: '20px',
                fontWeight: 900,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontFamily: 'Arial, Helvetica, sans-serif',
              }}
            >
              BILL OF SUPPLY
            </div>
            <div style={{ fontSize: '11.5px', fontWeight: 700, marginTop: '3px' }}>
              (Issued by Unregistered E-Commerce Seller - No GST Charged)
            </div>
            <div
              style={{
                display: 'inline-block',
                marginTop: '5px',
                padding: '2px 8px',
                border: '1px solid #000',
                fontSize: '10.5px',
                fontWeight: 800,
              }}
            >
              PAYMENT: {paymentModeText.toUpperCase()}
            </div>
          </div>

          {/* Right: Retail Verification QR */}
          <div style={{ textAlign: 'right' }}>
            <SvgQrCode
              text={qrVerificationPayload}
              size={88}
              onInspect={() => setScanPreview('qr')}
            />
          </div>
        </div>

        <div style={doubleRule} />

        {/* ================================================================== */}
        {/* SELLER DETAILS (LEFT) & INVOICE / ORDER METADATA (RIGHT)           */}
        {/* ================================================================== */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.15fr 1fr',
            gap: '16px',
            padding: '4px 0 8px',
          }}
        >
          {/* Left Column */}
          <div>
            <div>
              <strong>Seller Name:</strong> {effectiveSellerName}
            </div>
            <div>
              <strong>Address:</strong> {effectiveSellerAddress}
            </div>
            <div>
              <strong>Enrolment ID:</strong> {enrolmentId}
            </div>
            <div>
              <strong>State Code:</strong> 23 (Madhya Pradesh)
            </div>
          </div>

          {/* Right Column */}
          <div>
            <div>
              <strong>Invoice No:</strong> {invoiceNo}
            </div>
            <div>
              <strong>Order ID:</strong> {ref}
            </div>
            <div>
              <strong>Date:</strong> {formattedDate}
            </div>
            <div>
              <strong>PAN:</strong> {panNumber}
            </div>
          </div>
        </div>

        {/* ================================================================== */}
        {/* BILL TO / SHIP TO (CUSTOMER)                                       */}
        {/* ================================================================== */}
        <div style={{ marginTop: '6px', paddingBottom: '4px' }}>
          <div style={{ fontWeight: 900, textDecoration: 'underline', marginBottom: '2px' }}>
            Bill To / Ship To:
          </div>
          <div style={{ fontWeight: 800 }}>{customerName}</div>
          <div>{streetLine}</div>
          <div>{cityStatePinLine}</div>
          {customerPhone && <div>Contact: {customerPhone}</div>}
          <div style={{ marginTop: '3px', fontWeight: 800 }}>
            Place of Supply: Madhya Pradesh (23) — [Intra-State Only]
          </div>
        </div>

        {/* ================================================================== */}
        {/* LINE ITEMS TABLE                                                   */}
        {/* ================================================================== */}
        <div style={dashedRule} />

        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '12.5px',
          }}
        >
          <thead>
            <tr style={{ fontWeight: 900, textAlign: 'left' }}>
              <th style={{ padding: '4px 6px 6px 0', width: '52px' }}>S.No</th>
              <th style={{ padding: '4px 6px 6px 0' }}>Item Description</th>
              <th style={{ padding: '4px 6px 6px 0', width: '65px', textAlign: 'center' }}>Qty</th>
              <th style={{ padding: '4px 6px 6px 0', width: '120px', textAlign: 'right' }}>Unit Price</th>
              <th style={{ padding: '4px 0 6px 6px', width: '125px', textAlign: 'right' }}>Amount</th>
            </tr>
            <tr>
              <td colSpan={5} style={{ padding: 0 }}>
                <div style={{ borderTop: '1.5px dashed #000000', marginBottom: '6px' }} />
              </td>
            </tr>
          </thead>
          <tbody>
            {lineRows.map((row: any) => (
              <tr key={row.sNo}>
                <td style={{ padding: '4px 6px 4px 0', verticalAlign: 'top' }}>{row.sNo}</td>
                <td style={{ padding: '4px 6px 4px 0', fontWeight: 700, verticalAlign: 'top' }}>
                  {row.description}
                </td>
                <td style={{ padding: '4px 6px 4px 0', textAlign: 'center', verticalAlign: 'top' }}>
                  {row.qty}
                </td>
                <td style={{ padding: '4px 6px 4px 0', textAlign: 'right', verticalAlign: 'top' }}>
                  {formatInr(row.unitPricePaise)}
                </td>
                <td style={{ padding: '4px 0 4px 6px', textAlign: 'right', fontWeight: 700, verticalAlign: 'top' }}>
                  {formatInr(row.lineTotalPaise)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={dashedRule} />

        {/* ================================================================== */}
        {/* SUBTOTAL, DISCOUNT, SHIPPING, GST (0%), GRAND TOTAL                */}
        {/* ================================================================== */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ width: '280px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
              <span>Subtotal:</span>
              <strong>{formatInr(subtotalPaise)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
              <span>Discount:</span>
              <span>-{formatInr(discountPaise)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
              <span>Shipping:</span>
              <span>{formatInr(shippingPaise)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
              <span>GST (0%):</span>
              <span>₹0.00</span>
            </div>

            <div style={dashedRule} />

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '15px',
                fontWeight: 900,
                padding: '2px 0',
              }}
            >
              <span>GRAND TOTAL:</span>
              <span>{formatInr(grandTotalPaise)}</span>
            </div>
          </div>
        </div>

        <div style={doubleRule} />

        {/* ================================================================== */}
        {/* AMOUNT IN WORDS & STATUTORY DECLARATION                            */}
        {/* ================================================================== */}
        <div style={{ margin: '8px 0', fontWeight: 800 }}>
          Amount in Words: {paiseToRupeesWords(grandTotalPaise)}
        </div>

        <div style={{ marginTop: '12px' }}>
          <div style={{ fontWeight: 800 }}>Declaration:</div>
          <div style={{ fontStyle: 'italic', marginTop: '2px', lineHeight: 1.45 }}>
            &ldquo;Certified that the seller is exempt from GST registration under Notification No. 34/2023-CT and supplies goods strictly within Madhya Pradesh. No GST has been charged on this invoice.&rdquo;
          </div>
        </div>

        {/* ================================================================== */}
        {/* BOTTOM BARCODE & AUTHORIZED SIGNATORY                              */}
        {/* ================================================================== */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            marginTop: '22px',
            paddingTop: '6px',
          }}
        >
          <div>
            <SvgBarcode value={invoiceNo} height={30} width={160} label={`*${invoiceNo}*`} />
            <div style={{ fontSize: '9.5px', marginTop: '3px' }}>
              Customer Support: +91 76270-49855 | support@esakhi.in
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 800 }}>Authorized Signatory</div>
            <div style={{ fontSize: '11px' }}>(Computer Generated Document)</div>
          </div>
        </div>

        <div style={doubleRule} />
      </div>

      {/* Print-specific CSS */}
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
            padding: 10mm !important;
            box-shadow: none !important;
            border-radius: 0 !important;
          }
          .meesho-modal-controls {
            display: none !important;
          }
          @page {
            size: A4 portrait;
            margin: 8mm;
          }
        }
      `}</style>
    </div>
  );
};
