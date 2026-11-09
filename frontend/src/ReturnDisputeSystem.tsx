import React, { useEffect, useState } from 'react';
import { api, resolveProductImageUrl } from './api';
import type {
  CityAdminDeliveryPartner,
  CityAdminOrder,
  CustomerBankAccount,
  Order,
  PartnerSettlementsResponse,
  ReturnFaultAttribution,
  ReturnReasonCode,
  SellerSettlementsResponse,
  SuperAdminSettlementsLedgerResponse,
} from './types';

function formatRupees(paise: number): string {
  return `₹${((paise || 0) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const SAMPLE_BOX_IMAGES = [
  '/images/products/bamboo-tokri.jpg',
  '/images/products/terracotta-diya.jpg',
];

const SAMPLE_FAULT_IMAGES = [
  '/images/products/chanderi-silk-saree.jpg',
  '/images/products/zardozi-clutch.jpg',
];

const DEFAULT_SELLER_5_ANGLES = [
  { label: 'Angle 1 · Front Catalog View', url: '/images/products/chanderi-silk-saree.jpg' },
  { label: 'Angle 2 · Back / Weave Detail', url: '/images/products/zardozi-clutch.jpg' },
  { label: 'Angle 3 · Border & Craftsmanship', url: '/images/products/bamboo-tokri.jpg' },
  { label: 'Angle 4 · Inner Protective Wrap', url: '/images/products/terracotta-diya.jpg' },
  { label: 'Angle 5 · Sealed Outer Box', url: '/images/products/multani-mitti-soap.jpg' },
];

const REVERSE_TIMELINE_STEPS = [
  { key: 'return_requested', label: 'Return Requested' },
  { key: 'return_accepted', label: 'Return Accepted' },
  { key: 'return_partner_assigned', label: 'Agent Assigned' },
  { key: 'return_picked_up', label: 'Item Picked Up from your location' },
  { key: 'return_delivered_to_seller', label: 'Returned to Seller' },
  { key: 'ready_for_refund', label: 'Ready for Refund' },
  { key: 'refund_completed', label: 'Refund Completed' },
] as const;

function getReverseStepIndex(status: string): number {
  const idx = REVERSE_TIMELINE_STEPS.findIndex((s) => s.key === status);
  return idx;
}

/* ============================================================================
 * 1. CUSTOMER RETURN, BANK ACCOUNT LINKER & PRE-DISPATCH DIRECT CANCEL PANEL
 * ============================================================================ */

export const CustomerReturnAndCancelPanel: React.FC<{
  order: Order;
  onOrderUpdated: (updated: Order) => void;
}> = ({ order, onOrderUpdated }) => {
  const [bankAccount, setBankAccount] = useState<CustomerBankAccount | null>(null);
  const [loadingBank, setLoadingBank] = useState(false);
  const [showBankForm, setShowBankForm] = useState(false);
  const [bankForm, setBankForm] = useState({
    accountHolderName: order.customerName || '',
    accountNumber: '',
    ifscCode: '',
    bankName: '',
    upiId: '',
  });
  const [savingBank, setSavingBank] = useState(false);


  const [showReturnModal, setShowReturnModal] = useState(false);
  const [reasonCode, setReasonCode] = useState<ReturnReasonCode>('damaged');
  const [reasonText, setReasonText] = useState('');
  const [boxImages, setBoxImages] = useState<string[]>(SAMPLE_BOX_IMAGES);
  const [faultImages, setFaultImages] = useState<string[]>(SAMPLE_FAULT_IMAGES);
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isDelivered = order.fulfilmentStatus === 'delivered' || order.fulfilmentStatus === 'completed';
  const isReturnLifecycle = [
    'return_requested',
    'return_rejected',
    'return_accepted',
    'return_partner_assigned',
    'return_picked_up',
    'return_delivered_to_seller',
    'ready_for_refund',
    'refund_completed',
  ].includes(order.fulfilmentStatus);

  useEffect(() => {
    if (!isDelivered && !isReturnLifecycle) return;
    let mounted = true;
    setLoadingBank(true);
    api
      .getCustomerBankAccount()
      .then((res) => {
        if (!mounted) return;
        setBankAccount(res.bankAccount);
        if (res.bankAccount?.accountHolderName) {
          setBankForm((prev) => ({
            ...prev,
            accountHolderName: res.bankAccount.accountHolderName || prev.accountHolderName,
            accountNumber: res.bankAccount.accountNumber || '',
            ifscCode: res.bankAccount.ifscCode || '',
            bankName: res.bankAccount.bankName || '',
            upiId: res.bankAccount.upiId || '',
          }));
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setLoadingBank(false);
      });
    return () => {
      mounted = false;
    };
  }, [isDelivered, isReturnLifecycle]);

  // Calculate return window (Valid up to 4 days post-status DELIVERED)
  const deliveredEntry = [...(order.statusHistory ?? [])]
    .reverse()
    .find((e) => e.status === 'delivered' || e.status === 'completed');
  const deliveredDate = deliveredEntry?.changedAt
    ? new Date(deliveredEntry.changedAt)
    : new Date(order.updatedAt || order.createdAt || Date.now());
  const daysSinceDelivery = (Date.now() - deliveredDate.getTime()) / (1000 * 60 * 60 * 24);
  const isReturnWindowExpired = daysSinceDelivery > 4;
  const remainingDays = Math.max(0, Math.ceil(4 - daysSinceDelivery));

  const handleSaveBankAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBank(true);
    setFeedback(null);
    try {
      const res = await api.upsertCustomerBankAccount(bankForm);
      setBankAccount(res.bankAccount);
      setShowBankForm(false);
      setFeedback({
        type: 'success',
        text: 'Bank account linked and verified for Returns & Refunds!',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to link bank account.',
      });
    } finally {
      setSavingBank(false);
    }
  };

  const handleFileToDataUrl = (file: File, target: 'box' | 'fault') => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) return;
      if (target === 'box') {
        setBoxImages((prev) => [...prev.slice(0, 5), result]);
      } else {
        setFaultImages((prev) => [...prev.slice(0, 5), result]);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitReturnRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reasonText.trim() || reasonText.trim().length < 3) {
      setFeedback({ type: 'error', text: 'Please describe the product discrepancy or damage.' });
      return;
    }
    if (boxImages.length === 0 || faultImages.length === 0) {
      setFeedback({
        type: 'error',
        text: 'Both outer box condition images and product defect images are mandatory.',
      });
      return;
    }
    setSubmittingReturn(true);
    setFeedback(null);
    try {
      const updated = await api.submitReturnRequest(order._id, {
        reasonCode,
        reasonText: reasonText.trim(),
        boxConditionImages: boxImages,
        productFaultImages: faultImages,
      });
      onOrderUpdated(updated);
      setShowReturnModal(false);
      setFeedback({
        type: 'success',
        text: 'Return Request submitted (RETURN_REQUESTED). City Admin has been alerted for visual dispute arbitration.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not submit return request.',
      });
    } finally {
      setSubmittingReturn(false);
    }
  };

  const reverseStepIdx = getReverseStepIndex(order.fulfilmentStatus);

  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {feedback && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            background: feedback.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            border: `1px solid ${feedback.type === 'success' ? '#10B981' : '#EF4444'}`,
            color: feedback.type === 'success' ? '#065F46' : '#991B1B',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {feedback.text}
        </div>
      )}
      {/* CASE B: POST-DELIVERY RETURN REQUEST (2-4 Day Return Window & Bank Account Prerequisite) */}
      {isDelivered && (
        <div
          style={{
            padding: '16px',
            borderRadius: 12,
            background: '#F8FAFC',
            border: '1px solid #E2E8F0',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#1E293B' }}>
                🔄 Post-Delivery Return & Refund Protection
              </div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 3 }}>
                Eligible within 2–4 days post-delivery ({isReturnWindowExpired ? 'Expired' : `${remainingDays} day(s) remaining in window`}).
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="secondary"
                style={{ fontSize: 12 }}
                onClick={() => setShowBankForm((v) => !v)}
              >
                🏦 {bankAccount?.verified ? `Bank Linked (${bankAccount.bankName})` : 'Link Bank Account'}
              </button>

              <button
                type="button"
                disabled={!bankAccount?.verified || isReturnWindowExpired}
                onClick={() => setShowReturnModal(true)}
                style={{
                  padding: '9px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: !bankAccount?.verified || isReturnWindowExpired ? '#CBD5E1' : '#7C2D12',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  cursor: !bankAccount?.verified || isReturnWindowExpired ? 'not-allowed' : 'pointer',
                }}
              >
                Request Return & Refund
              </button>
            </div>
          </div>

          {/* Prerequisite 1 Banner: Unlinked Bank Account */}
          {!loadingBank && !bankAccount?.verified && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 14px',
                borderRadius: 8,
                background: '#FEF3C7',
                border: '1px solid #F59E0B',
                color: '#92400E',
                fontSize: 13,
                fontWeight: 700,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <span>⚠️ Link your Bank Account to proceed with Returns & Refunds.</span>
              <button
                type="button"
                onClick={() => setShowBankForm(true)}
                style={{
                  background: '#D97706',
                  color: '#FFF',
                  border: 'none',
                  borderRadius: 6,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                + Link Bank Account Now
              </button>
            </div>
          )}

          {/* Prerequisite 2 Banner: Return Window Expired */}
          {isReturnWindowExpired && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 14px',
                borderRadius: 8,
                background: '#FEE2E2',
                border: '1px solid #EF4444',
                color: '#991B1B',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              ⛔ Return window for this product has expired.
            </div>
          )}

          {/* Inline Bank Account Link Form */}
          {showBankForm && (
            <form
              onSubmit={handleSaveBankAccount}
              style={{
                marginTop: 14,
                padding: 14,
                borderRadius: 10,
                background: '#FFFFFF',
                border: '1px solid #CBD5E1',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                gap: 10,
              }}
            >
              <div style={{ gridColumn: '1 / -1', fontSize: 13, fontWeight: 800, color: '#0F172A' }}>
                🏦 Link Customer Bank Account for Automated Refund Disbursements
              </div>
              <label style={{ fontSize: 12 }}>
                Account Holder Name *
                <input
                  required
                  value={bankForm.accountHolderName}
                  onChange={(e) => setBankForm({ ...bankForm, accountHolderName: e.target.value })}
                  placeholder="e.g. Riya Sharma"
                />
              </label>
              <label style={{ fontSize: 12 }}>
                Bank Name *
                <input
                  required
                  value={bankForm.bankName}
                  onChange={(e) => setBankForm({ ...bankForm, bankName: e.target.value })}
                  placeholder="e.g. State Bank of India"
                />
              </label>
              <label style={{ fontSize: 12 }}>
                Account Number *
                <input
                  required
                  value={bankForm.accountNumber}
                  onChange={(e) => setBankForm({ ...bankForm, accountNumber: e.target.value })}
                  placeholder="e.g. 309812349876"
                />
              </label>
              <label style={{ fontSize: 12 }}>
                IFSC Code *
                <input
                  required
                  value={bankForm.ifscCode}
                  onChange={(e) => setBankForm({ ...bankForm, ifscCode: e.target.value.toUpperCase() })}
                  placeholder="e.g. SBIN0000342"
                />
              </label>
              <label style={{ fontSize: 12 }}>
                UPI ID (Optional)
                <input
                  value={bankForm.upiId}
                  onChange={(e) => setBankForm({ ...bankForm, upiId: e.target.value })}
                  placeholder="e.g. customer@sbi"
                />
              </label>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <button type="submit" disabled={savingBank}>
                  {savingBank ? 'Verifying…' : '✓ Save & Verify Bank'}
                </button>
                <button type="button" className="secondary" onClick={() => setShowBankForm(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Return Request Modal / Drawer */}
          {showReturnModal && (
            <form
              onSubmit={handleSubmitReturnRequest}
              style={{
                marginTop: 14,
                padding: 16,
                borderRadius: 12,
                background: '#FFFFFF',
                border: '2px solid #7C2D12',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 15, color: '#7C2D12' }}>
                  📦 Submit Return & Dispute Evidence — Order #{order.orderReference}
                </strong>
                <button type="button" className="secondary" onClick={() => setShowReturnModal(false)}>
                  Close
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>
                  Reason for Return *
                  <select
                    value={reasonCode}
                    onChange={(e) => setReasonCode(e.target.value as ReturnReasonCode)}
                    style={{ marginTop: 4 }}
                  >
                    <option value="damaged">Damaged Product Received</option>
                    <option value="defective">Defective / Craftsmanship Fault</option>
                    <option value="wrong_item">Wrong Item Delivered</option>
                    <option value="box_mutilated">Outer Box Mutilated / Tampered in Transit</option>
                    <option value="other">Other Quality Discrepancy</option>
                  </select>
                </label>

                <label style={{ fontSize: 13, fontWeight: 600 }}>
                  Detailed Description of Fault / Discrepancy *
                  <input
                    required
                    value={reasonText}
                    onChange={(e) => setReasonText(e.target.value)}
                    placeholder="Describe outer box condition and product issue..."
                    style={{ marginTop: 4 }}
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                {/* Outer Box Condition Images */}
                <div style={{ padding: 12, borderRadius: 10, background: '#F8FAFC', border: '1px solid #CBD5E1' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#1E293B', marginBottom: 6 }}>
                    1. Outer Box Condition Photos (Mandatory: {boxImages.length} attached)
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && handleFileToDataUrl(e.target.files[0], 'box')}
                    style={{ fontSize: 12, marginBottom: 8 }}
                  />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {boxImages.map((img, idx) => (
                      <div key={idx} style={{ position: 'relative' }}>
                        <img
                          src={resolveProductImageUrl(img)}
                          alt={`Box ${idx + 1}`}
                          style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #94A3B8' }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Product Fault / Discrepancy Images */}
                <div style={{ padding: 12, borderRadius: 10, background: '#F8FAFC', border: '1px solid #CBD5E1' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#1E293B', marginBottom: 6 }}>
                    2. Product Defect Close-Up Photos (Mandatory: {faultImages.length} attached)
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && handleFileToDataUrl(e.target.files[0], 'fault')}
                    style={{ fontSize: 12, marginBottom: 8 }}
                  />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {faultImages.map((img, idx) => (
                      <div key={idx} style={{ position: 'relative' }}>
                        <img
                          src={resolveProductImageUrl(img)}
                          alt={`Fault ${idx + 1}`}
                          style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #94A3B8' }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="secondary" onClick={() => setShowReturnModal(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReturn}
                  style={{
                    background: '#7C2D12',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: 8,
                    padding: '10px 18px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {submittingReturn ? 'Submitting Return Request…' : 'Submit Return Request (RETURN_REQUESTED)'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* REVERSE LOGISTICS LIVE TIMELINE FOR CUSTOMER */}
      {isReturnLifecycle && (
        <div
          style={{
            padding: 16,
            borderRadius: 12,
            background: order.fulfilmentStatus === 'return_rejected' ? '#FEF2F2' : '#F0FDF4',
            border: `1.5px solid ${order.fulfilmentStatus === 'return_rejected' ? '#EF4444' : '#16A34A'}`,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  padding: '3px 8px',
                  borderRadius: 999,
                  background: order.fulfilmentStatus === 'return_rejected' ? '#FEE2E2' : '#DCFCE7',
                  color: order.fulfilmentStatus === 'return_rejected' ? '#991B1B' : '#166534',
                }}
              >
                {order.fulfilmentStatus.toUpperCase()}
              </span>
              <h4 style={{ margin: '6px 0 2px', fontSize: 15, color: '#0F172A' }}>
                Reverse Logistics & Refund Status Tracker
              </h4>
            </div>
            {order.returnRequest?.refund?.transactionReference && (
              <div
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  background: '#DCFCE7',
                  border: '1px solid #22C55E',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#14532D',
                }}
              >
                ✓ Refund Disbursed ({formatRupees(order.returnRequest.refund.refundAmountPaise || order.totalPaise)}) · Ref:{' '}
                {order.returnRequest.refund.transactionReference}
              </div>
            )}
          </div>

          {order.fulfilmentStatus === 'return_rejected' ? (
            <div style={{ marginTop: 10, fontSize: 13, color: '#991B1B', fontWeight: 600 }}>
              Return Rejected by City Admin Arbitration:{' '}
              {order.returnRequest?.arbitration?.reviewNote || 'Pre-dispatch inspection evidence matched delivered condition.'}
            </div>
          ) : (
            <div
              style={{
                marginTop: 14,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))',
                gap: 8,
              }}
            >
              {REVERSE_TIMELINE_STEPS.map((step, index) => {
                const done = reverseStepIdx >= index;
                const current = reverseStepIdx === index;
                return (
                  <div
                    key={step.key}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: current ? '#15803D' : done ? '#DCFCE7' : '#FFFFFF',
                      color: current ? '#FFFFFF' : done ? '#166534' : '#64748B',
                      border: `1px solid ${done ? '#22C55E' : '#E2E8F0'}`,
                      fontSize: 11,
                      fontWeight: current || done ? 700 : 500,
                    }}
                  >
                    <div>{done ? '✓' : index + 1}. {step.label}</div>
                  </div>
                );
              })}
            </div>
          )}

          {order.fulfilmentStatus === 'return_picked_up' && (
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: '#1E40AF' }}>
              🚚 Item Picked Up from your location — Delivery Partner ({order.deliveryPartner?.name || 'Assigned Agent'}) is in transit to Seller.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ============================================================================
 * 2. CITY ADMIN DISPUTE ARBITRATION, VISUAL COMPARISON & PENALTY FIXATION
 * ============================================================================ */

export const CityAdminDisputeArbitrationPanel: React.FC<{
  orders: Array<CityAdminOrder | Order>;
  partners: CityAdminDeliveryPartner[];
  onRefresh: () => void;
}> = ({ orders, partners, onRefresh }) => {
  const disputeOrders = orders.filter((o) =>
    [
      'return_requested',
      'return_accepted',
      'return_partner_assigned',
      'return_picked_up',
      'return_delivered_to_seller',
      'ready_for_refund',
      'refund_completed',
      'return_rejected',
    ].includes(o.fulfilmentStatus),
  );

  const [selectedOrder, setSelectedOrder] = useState<CityAdminOrder | Order | null>(null);
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [faultAttribution, setFaultAttribution] = useState<ReturnFaultAttribution>('seller_fault');
  const [penaltyRupees, setPenaltyRupees] = useState<string>('150');
  const [reviewNote, setReviewNote] = useState<string>(
    'Verified Seller 5 pre-dispatch inspection images against Customer outer-box & product defect photos.',
  );
  const [submitting, setSubmitting] = useState(false);
  const [selectedReversePartnerId, setSelectedReversePartnerId] = useState<string>('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const onlineAvailablePartners = partners.filter(
    (p) => p.status === 'active' && p.isOnline !== false && p.availabilityStatus !== 'offline',
  );

  const handleArbitrate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await api.arbitrateCityAdminReturnDispute(selectedOrder._id, {
        decision,
        ...(decision === 'approved' ? { faultAttribution } : {}),
        ...(decision === 'approved' && faultAttribution !== 'no_fault'
          ? { penaltyAmountRupees: Number(penaltyRupees) || 0 }
          : {}),
        reviewNote: reviewNote.trim() || 'Arbitrated by City Admin.',
      });
      setFeedback({
        type: 'success',
        text:
          decision === 'approved'
            ? `Return Approved (RETURN_ACCEPTED) with ${faultAttribution.replaceAll('_', ' ').toUpperCase()} attribution.`
            : `Return Rejected (RETURN_REJECTED). Customer notified.`,
      });
      setSelectedOrder(null);
      onRefresh();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Arbitration failed.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignReversePartner = async (orderId: string) => {
    const partnerId = selectedReversePartnerId || onlineAvailablePartners[0]?._id || onlineAvailablePartners[0]?.id;
    if (!partnerId) {
      setFeedback({ type: 'error', text: 'Select an ONLINE & AVAILABLE Delivery Partner for reverse pickup.' });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      await api.assignCityAdminReversePartner(String(orderId), {
        partnerId: String(partnerId),
      });
      setFeedback({
        type: 'success',
        text: 'Reverse Pickup Partner assigned (RETURN_PARTNER_ASSIGNED). Live GPS reverse tracking is now active!',
      });
      onRefresh();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not assign reverse delivery partner.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleEscalateRefund = async (orderId: string) => {
    setSubmitting(true);
    setFeedback(null);
    try {
      await api.escalateCityAdminOrderRefund(
        orderId,
        'Verified Seller return handover (RETURN_DELIVERED_TO_SELLER). Escalated to Super Admin as READY_FOR_REFUND.',
      );
      setFeedback({
        type: 'success',
        text: 'Order transitioned to READY_FOR_REFUND and escalated to Super Admin Dashboard!',
      });
      onRefresh();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not escalate order for refund.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (disputeOrders.length === 0) return null;

  const pendingArbitrationCount = disputeOrders.filter((o) => o.fulfilmentStatus === 'return_requested').length;

  return (
    <div
      style={{
        marginBottom: 20,
        padding: 18,
        borderRadius: 16,
        background: 'linear-gradient(135deg, #FFF7ED 0%, #FEF2F2 100%)',
        border: '2px solid #F97316',
        boxShadow: '0 8px 24px rgba(249, 115, 22, 0.12)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <span
            style={{
              background: '#EA580C',
              color: '#FFFFFF',
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.06em',
            }}
          >
            🚨 REVERSE LOGISTICS & DISPUTE ARBITRATION CENTER ({pendingArbitrationCount} PENDING REVIEW)
          </span>
          <h3 style={{ margin: '8px 0 4px', fontSize: 18, color: '#7C2D12' }}>
            Return Discrepancy Comparison, Penalty Fixation & Reverse Dispatch
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: '#9A3412' }}>
            Compare Seller&apos;s 5 Pre-Dispatch Ground Truth Photos vs. Customer&apos;s Box/Product Evidence, fix Seller or Partner penalties, and dispatch reverse pickup.
          </p>
        </div>
      </div>

      {feedback && (
        <div
          style={{
            marginTop: 12,
            padding: '10px 14px',
            borderRadius: 10,
            background: feedback.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            border: `1px solid ${feedback.type === 'success' ? '#10B981' : '#EF4444'}`,
            color: feedback.type === 'success' ? '#065F46' : '#991B1B',
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {feedback.text}
        </div>
      )}

      {/* List of Return / Reverse Logistics Orders */}
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {disputeOrders.map((order) => (
          <div
            key={order._id}
            style={{
              padding: 14,
              borderRadius: 12,
              background: '#FFFFFF',
              border: '1px solid #FDBA74',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontFamily: 'monospace', fontSize: 14 }}>#{order.orderReference}</strong>
                <span
                  style={{
                    padding: '3px 9px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 800,
                    background: '#FFEDD5',
                    color: '#9A3412',
                  }}
                >
                  {order.fulfilmentStatus.toUpperCase()}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>
                  {formatRupees(order.totalPaise)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                Customer: <strong>{order.customerName}</strong> · Reason:{' '}
                <strong>{order.returnRequest?.reasonCode?.replaceAll('_', ' ').toUpperCase() || 'DAMAGED'}</strong> — &ldquo;
                {order.returnRequest?.reasonText || 'Product discrepancy reported'}&rdquo;
              </div>
              {order.returnRequest?.arbitration?.decision && (
                <div style={{ fontSize: 12, color: '#1E40AF', marginTop: 3, fontWeight: 600 }}>
                  Arbitration: {order.returnRequest.arbitration.decision.toUpperCase()} · Fault:{' '}
                  {order.returnRequest.arbitration.faultAttribution?.replaceAll('_', ' ').toUpperCase() || 'NONE'}
                  {order.returnRequest.arbitration.penaltyAmountPaise
                    ? ` · Penalty Fixed: ${formatRupees(order.returnRequest.arbitration.penaltyAmountPaise)}`
                    : ''}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {order.fulfilmentStatus === 'return_requested' && (
                <button
                  type="button"
                  onClick={() => setSelectedOrder(order)}
                  style={{
                    background: '#EA580C',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: 8,
                    padding: '9px 14px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  🔍 Inspect 5-Angle Photos & Arbitrate
                </button>
              )}

              {order.fulfilmentStatus === 'return_accepted' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    value={selectedReversePartnerId}
                    onChange={(e) => setSelectedReversePartnerId(e.target.value)}
                    style={{ padding: '7px 10px', borderRadius: 8, fontSize: 12 }}
                  >
                    <option value="">Select Nearest ONLINE Partner ({onlineAvailablePartners.length} available)</option>
                    {onlineAvailablePartners.map((p) => (
                      <option key={p._id || p.id} value={p._id || p.id}>
                        {p.name || p.phoneE164} · ONLINE & AVAILABLE {p.distanceKm != null ? `(${p.distanceKm} km)` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handleAssignReversePartner(order._id)}
                    style={{
                      background: '#2563EB',
                      color: '#FFFFFF',
                      border: 'none',
                      borderRadius: 8,
                      padding: '8px 14px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    🚚 Dispatch Reverse Pickup Partner
                  </button>
                </div>
              )}

              {order.fulfilmentStatus === 'return_delivered_to_seller' && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleEscalateRefund(order._id)}
                  style={{
                    background: '#16A34A',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: 8,
                    padding: '9px 14px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  ✓ Verify Seller Receipt & Move to READY_FOR_REFUND
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Side-by-Side Visual Comparison & Fault Attribution Modal */}
      {selectedOrder && (
        <div
          style={{
            marginTop: 16,
            padding: 20,
            borderRadius: 14,
            background: '#FFFFFF',
            border: '2px solid #7C2D12',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <h4 style={{ margin: 0, fontSize: 16, color: '#7C2D12' }}>
                ⚖️ Visual Comparison & Penalty Fixation — Order #{selectedOrder.orderReference}
              </h4>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
                Compare Seller&apos;s 5 mandatory pre-dispatch verification images against Customer&apos;s box & fault evidence.
              </div>
            </div>
            <button type="button" className="secondary" onClick={() => setSelectedOrder(null)}>
              Close
            </button>
          </div>

          {/* Side-by-Side Gallery */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
            {/* Seller 5 Pre-Dispatch Inspection Photos */}
            <div style={{ padding: 14, borderRadius: 12, background: '#F8FAFC', border: '1px solid #CBD5E1' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', marginBottom: 8 }}>
                🛡️ Seller&apos;s 5 Pre-Dispatch Inspection Photos (Ground Truth)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(105px, 1fr))', gap: 8 }}>
                {(selectedOrder.preDispatchInspection?.imageUrls?.length === 5
                  ? selectedOrder.preDispatchInspection.imageUrls.map((url, idx) => ({
                      label: `Angle ${idx + 1}`,
                      url,
                    }))
                  : DEFAULT_SELLER_5_ANGLES
                ).map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: 6,
                      borderRadius: 8,
                      background: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      textAlign: 'center',
                    }}
                  >
                    <img
                      src={resolveProductImageUrl(item.url)}
                      alt={item.label}
                      style={{ width: '100%', height: 74, objectFit: 'cover', borderRadius: 6 }}
                    />
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#334155', marginTop: 4 }}>{item.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Customer Box Condition + Product Fault Photos */}
            <div style={{ padding: 14, borderRadius: 12, background: '#FEF2F2', border: '1px solid #FECACA' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#991B1B', marginBottom: 8 }}>
                📸 Customer Return Evidence (Outer Box + Product Fault Close-Ups)
              </div>
              <div style={{ fontSize: 12, color: '#7F1D1D', marginBottom: 8 }}>
                <strong>Reason ({selectedOrder.returnRequest?.reasonCode?.toUpperCase()}):</strong>{' '}
                {selectedOrder.returnRequest?.reasonText}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#991B1B', marginBottom: 4 }}>
                Outer Box Condition Images:
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {(selectedOrder.returnRequest?.boxConditionImages?.length
                  ? selectedOrder.returnRequest.boxConditionImages
                  : SAMPLE_BOX_IMAGES
                ).map((url, idx) => (
                  <img
                    key={idx}
                    src={resolveProductImageUrl(url)}
                    alt={`Box ${idx + 1}`}
                    style={{ width: 82, height: 74, objectFit: 'cover', borderRadius: 6, border: '2px solid #EF4444' }}
                  />
                ))}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#991B1B', marginBottom: 4 }}>
                Product Defect Close-Up Images:
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(selectedOrder.returnRequest?.productFaultImages?.length
                  ? selectedOrder.returnRequest.productFaultImages
                  : SAMPLE_FAULT_IMAGES
                ).map((url, idx) => (
                  <img
                    key={idx}
                    src={resolveProductImageUrl(url)}
                    alt={`Defect ${idx + 1}`}
                    style={{ width: 82, height: 74, objectFit: 'cover', borderRadius: 6, border: '2px solid #DC2626' }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Arbitration & Fault Allocation Form */}
          <form onSubmit={handleArbitrate} style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 700 }}>
                1. Arbitration Decision *
                <select
                  value={decision}
                  onChange={(e) => setDecision(e.target.value as 'approved' | 'rejected')}
                  style={{ marginTop: 4 }}
                >
                  <option value="approved">✓ Approve Return (RETURN_ACCEPTED)</option>
                  <option value="rejected">✕ Reject Return (RETURN_REJECTED)</option>
                </select>
              </label>

              {decision === 'approved' && (
                <label style={{ fontSize: 13, fontWeight: 700 }}>
                  2. Mandatory Fault Attribution *
                  <select
                    value={faultAttribution}
                    onChange={(e) => setFaultAttribution(e.target.value as ReturnFaultAttribution)}
                    style={{ marginTop: 4 }}
                  >
                    <option value="seller_fault">Seller Fault (Pre-dispatch / Packaging Discrepancy → SELLER_PENALTY_PENDING)</option>
                    <option value="delivery_partner_fault">Delivery Partner Fault (Transit Box Damage → DELIVERY_PARTNER_PENALTY_PENDING)</option>
                    <option value="no_fault">Standard Return / No Fault (₹0 Penalty)</option>
                  </select>
                </label>
              )}

              {decision === 'approved' && faultAttribution !== 'no_fault' && (
                <label style={{ fontSize: 13, fontWeight: 700 }}>
                  3. Penalty Amount (₹ INR) *
                  <input
                    type="number"
                    min="0"
                    step="10"
                    required
                    value={penaltyRupees}
                    onChange={(e) => setPenaltyRupees(e.target.value)}
                    placeholder="e.g. 150"
                    style={{ marginTop: 4 }}
                  />
                </label>
              )}
            </div>

            <label style={{ fontSize: 13, fontWeight: 700 }}>
              Arbitration Rationale & Penalty Ledger Note *
              <input
                required
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Enter detailed visual inspection finding..."
                style={{ marginTop: 4 }}
              />
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="secondary" onClick={() => setSelectedOrder(null)}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  background: decision === 'approved' ? '#16A34A' : '#DC2626',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 18px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {submitting
                  ? 'Saving Arbitration…'
                  : decision === 'approved'
                    ? `Confirm RETURN_ACCEPTED${faultAttribution !== 'no_fault' ? ` & Fix ₹${penaltyRupees || 0} Penalty` : ''}`
                    : 'Confirm RETURN_REJECTED'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

/* ============================================================================
 * 3. SELLER MONTHLY PAYOUT & ITEMIZED PENALTY DEDUCTIONS LEDGER
 * ============================================================================ */

export const SellerSettlementsLedgerPanel: React.FC = () => {
  const [data, setData] = useState<SellerSettlementsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    api
      .sellerSettlements()
      .then((res) => {
        if (mounted) setData(res);
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (loading || !data) return null;

  return (
    <div
      style={{
        marginTop: 20,
        padding: 18,
        borderRadius: 14,
        background: '#FFFFFF',
        border: '1px solid #E2E8F0',
        boxShadow: '0 4px 12px rgba(15, 23, 42, 0.04)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#7C2D12', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            MONTHLY PAYOUT & PENALTY LEDGER ({data.monthLabel})
          </span>
          <h3 style={{ margin: '4px 0 0', fontSize: 17, color: '#0F172A' }}>
            Gross Monthly Payout − Accumulated Penalty Deductions = Net Settlement
          </h3>
        </div>
      </div>

      {/* Equation Summary Cards */}
      <div
        style={{
          marginTop: 14,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
        }}
      >
        <div style={{ padding: 14, borderRadius: 10, background: '#F8FAFC', border: '1px solid #CBD5E1' }}>
          <div style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>Gross Monthly Payout ({data.completedOrdersCount} orders)</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginTop: 4 }}>
            {formatRupees(data.grossMonthlyPayoutPaise)}
          </div>
        </div>

        <div style={{ padding: 14, borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA' }}>
          <div style={{ fontSize: 12, color: '#991B1B', fontWeight: 600 }}>− Accumulated Penalty Deductions ({data.penalties.length})</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#DC2626', marginTop: 4 }}>
            − {formatRupees(data.totalPenaltyDeductionsPaise)}
          </div>
        </div>

        <div style={{ padding: 14, borderRadius: 10, background: '#ECFDF5', border: '1px solid #A7F3D0' }}>
          <div style={{ fontSize: 12, color: '#065F46', fontWeight: 600 }}>= Final Net Monthly Settlement</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#059669', marginTop: 4 }}>
            {formatRupees(data.netSettlementPaise)}
          </div>
        </div>
      </div>

      {/* Itemized Penalty Deductions with Order IDs */}
      {data.penalties.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#991B1B', marginBottom: 8 }}>
            Itemized Penalty Deductions Ledger
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.penalties.map((p) => (
              <div
                key={p._id}
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: '#FFF5F5',
                  border: '1px solid #FEB2B2',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                  fontSize: 12,
                }}
              >
                <div>
                  <strong style={{ fontFamily: 'monospace' }}>Order #{p.orderReference}</strong> · {p.reason}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: p.settlementStatus === 'SETTLED' ? '#DCFCE7' : '#FEE2E2',
                      color: p.settlementStatus === 'SETTLED' ? '#166534' : '#991B1B',
                      fontWeight: 700,
                      fontSize: 11,
                    }}
                  >
                    {p.settlementStatus}
                  </span>
                  <strong style={{ color: '#DC2626', fontSize: 13 }}>− {formatRupees(p.penaltyAmountPaise)}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ============================================================================
 * 4. DELIVERY PARTNER MONTHLY PAY SLIP & PENALTY DEDUCTIONS VIEW
 * ============================================================================ */

export const DeliveryPartnerPaySlipPanel: React.FC = () => {
  const [data, setData] = useState<PartnerSettlementsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    api
      .partnerSettlements()
      .then((res) => {
        if (mounted) setData(res);
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (loading || !data) return null;

  return (
    <div
      style={{
        marginTop: 20,
        padding: 18,
        borderRadius: 14,
        background: '#FFFFFF',
        border: '1px solid #CBD5E1',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#1E40AF', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            DELIVERY PARTNER MONTHLY PAY SLIP ({data.monthLabel})
          </span>
          <h3 style={{ margin: '4px 0 0', fontSize: 17, color: '#0F172A' }}>
            Monthly Delivery Earnings & Transit Penalty Deductions Statement
          </h3>
        </div>
      </div>

      <div
        style={{
          marginTop: 14,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 12,
        }}
      >
        <div style={{ padding: 14, borderRadius: 10, background: '#F8FAFC', border: '1px solid #CBD5E1' }}>
          <div style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>
            Gross Delivery Earnings ({data.completedDeliveriesCount} trips)
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginTop: 4 }}>
            {formatRupees(data.grossDeliveryEarningsPaise)}
          </div>
        </div>

        <div style={{ padding: 14, borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA' }}>
          <div style={{ fontSize: 12, color: '#991B1B', fontWeight: 600 }}>
            − Transit Damage Penalty Deductions ({data.penalties.length})
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#DC2626', marginTop: 4 }}>
            − {formatRupees(data.totalPenaltyDeductionsPaise)}
          </div>
        </div>

        <div style={{ padding: 14, borderRadius: 10, background: '#ECFDF5', border: '1px solid #A7F3D0' }}>
          <div style={{ fontSize: 12, color: '#065F46', fontWeight: 600 }}>= Net Monthly Pay Slip Payout</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#059669', marginTop: 4 }}>
            {formatRupees(data.netSettlementPaise)}
          </div>
        </div>
      </div>

      {data.penalties.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#991B1B', marginBottom: 8 }}>
            Exact Deduction Reasons on Monthly Pay Slip:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.penalties.map((p) => (
              <div
                key={p._id}
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: '#FEF2F2',
                  border: '1px solid #FECACA',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                  fontSize: 12,
                }}
              >
                <div>
                  <strong>{p.reason}</strong> (Order <span style={{ fontFamily: 'monospace' }}>#{p.orderReference}</span>)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#991B1B' }}>{p.settlementStatus}</span>
                  <strong style={{ color: '#DC2626' }}>− {formatRupees(p.penaltyAmountPaise)}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ============================================================================
 * 5. SUPER ADMIN 1-CLICK REFUND TRIGGER & MONTHLY SETTLEMENT LEDGER DASHBOARD
 * ============================================================================ */

export const SuperAdminRefundsAndSettlementsView: React.FC = () => {
  const [ledger, setLedger] = useState<SuperAdminSettlementsLedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadLedger = async () => {
    setLoading(true);
    try {
      const res = await api.superAdminSettlements();
      setLedger(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLedger();
  }, []);

  const handleProcessRefund = async (orderId: string, orderReference: string) => {
    setProcessingId(orderId);
    setFeedback(null);
    try {
      await api.processSuperAdminRefund(orderId);
      setFeedback({
        type: 'success',
        text: `Refund disbursed to Customer's linked bank account for Order #${orderReference} (REFUND_COMPLETED)!`,
      });
      await loadLedger();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to process refund.',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleSettlePenalty = async (penaltyId: string) => {
    setProcessingId(penaltyId);
    try {
      await api.settleSuperAdminPenalty(penaltyId);
      await loadLedger();
    } finally {
      setProcessingId(null);
    }
  };

  if (loading && !ledger) {
    return <div style={{ padding: 20 }}>Loading Super Admin Settlements & Penalty Ledger…</div>;
  }
  if (!ledger) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 16 }}>
      {feedback && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 10,
            background: feedback.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            border: `1px solid ${feedback.type === 'success' ? '#10B981' : '#EF4444'}`,
            color: feedback.type === 'success' ? '#065F46' : '#991B1B',
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          {feedback.text}
        </div>
      )}

      {/* Priority Refund Alert Banner for READY_FOR_REFUND Orders */}
      <div
        style={{
          padding: 18,
          borderRadius: 14,
          background: ledger.pendingRefundOrders.length > 0 ? '#FEF2F2' : '#F0FDF4',
          border: `2px solid ${ledger.pendingRefundOrders.length > 0 ? '#EF4444' : '#22C55E'}`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <span
              style={{
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 800,
                background: ledger.pendingRefundOrders.length > 0 ? '#DC2626' : '#16A34A',
                color: '#FFFFFF',
              }}
            >
              {ledger.pendingRefundOrders.length > 0
                ? `🚨 PRIORITY REFUND QUEUE (${ledger.pendingRefundOrders.length} READY_FOR_REFUND)`
                : '✓ ALL ESCALATED REFUNDS DISBURSED'}
            </span>
            <h3 style={{ margin: '6px 0 2px', fontSize: 17, color: '#0F172A' }}>
              Super Admin 1-Click Bank Refund Disbursement
            </h3>
          </div>
          <button type="button" className="secondary" onClick={() => void loadLedger()}>
            ↻ Refresh Ledger
          </button>
        </div>

        {ledger.pendingRefundOrders.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ledger.pendingRefundOrders.map((order) => (
              <div
                key={order._id}
                style={{
                  padding: 14,
                  borderRadius: 10,
                  background: '#FFFFFF',
                  border: '1px solid #FCA5A5',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontFamily: 'monospace', fontSize: 14 }}>#{order.orderReference}</strong>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 800,
                        background: '#FEE2E2',
                        color: '#991B1B',
                      }}
                    >
                      {order.fulfilmentStatus.toUpperCase()}
                    </span>
                    <strong style={{ fontSize: 14, color: '#0F172A' }}>{formatRupees(order.totalPaise)}</strong>
                  </div>
                  <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                    Customer: <strong>{order.customerName}</strong> · Linked Bank:{' '}
                    <strong>
                      {order.bankAccount?.bankName || 'State Bank of India'} (A/C: {order.bankAccount?.accountNumber || 'XXXX1234'}, IFSC:{' '}
                      {order.bankAccount?.ifscCode || 'SBIN0000001'})
                    </strong>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={processingId === order._id}
                  onClick={() => handleProcessRefund(order._id, order.orderReference)}
                  style={{
                    background: '#16A34A',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: 8,
                    padding: '10px 18px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {processingId === order._id ? 'Disbursing Refund…' : `💸 Process Refund (${formatRupees(order.totalPaise)})`}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Platform Settlement Breakdown Summary */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        <div style={{ padding: 14, borderRadius: 12, background: '#FFFFFF', border: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>Gross Merchandise Sales</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#0F172A', marginTop: 4 }}>
            {formatRupees(ledger.summary.grossSalesPaise)}
          </div>
        </div>
        <div style={{ padding: 14, borderRadius: 12, background: '#FFFFFF', border: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>Platform Commissions (10%)</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#4F46E5', marginTop: 4 }}>
            {formatRupees(ledger.summary.platformCommissionsPaise)}
          </div>
        </div>
        <div style={{ padding: 14, borderRadius: 12, background: '#FEF2F2', border: '1px solid #FECACA' }}>
          <div style={{ fontSize: 12, color: '#991B1B', fontWeight: 600 }}>Active & Settled Penalties</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#DC2626', marginTop: 4 }}>
            {formatRupees(ledger.summary.totalPenaltiesPaise)}
          </div>
        </div>
        <div style={{ padding: 14, borderRadius: 12, background: '#FFFBEB', border: '1px solid #FDE68A' }}>
          <div style={{ fontSize: 12, color: '#92400E', fontWeight: 600 }}>Customer Refunds Disbursed</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#D97706', marginTop: 4 }}>
            {formatRupees(ledger.summary.totalRefundsDisbursedPaise)}
          </div>
        </div>
        <div style={{ padding: 14, borderRadius: 12, background: '#ECFDF5', border: '1px solid #A7F3D0' }}>
          <div style={{ fontSize: 12, color: '#065F46', fontWeight: 600 }}>Final Net Partner/Seller Payouts</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#059669', marginTop: 4 }}>
            {formatRupees(ledger.summary.finalNetPayoutsPaise)}
          </div>
        </div>
      </div>

      {/* Itemized Penalty Deductions Ledger (Sellers & Delivery Partners) */}
      <div style={{ padding: 16, borderRadius: 12, background: '#FFFFFF', border: '1px solid #E2E8F0' }}>
        <h4 style={{ margin: '0 0 10px', fontSize: 15, color: '#0F172A' }}>
          ⚖️ Automated Penalty Deductions Ledger ({ledger.penaltyLedger.length} Entries)
        </h4>
        {ledger.penaltyLedger.length === 0 ? (
          <div style={{ fontSize: 13, color: '#64748B' }}>No active or settled penalties recorded this month.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ledger.penaltyLedger.map((p) => (
              <div
                key={p._id}
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: '#F8FAFC',
                  border: '1px solid #CBD5E1',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 10,
                  fontSize: 12,
                }}
              >
                <div>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: p.partyType === 'seller' ? '#FEF3C7' : '#DBEAFE',
                      color: p.partyType === 'seller' ? '#92400E' : '#1E40AF',
                      fontWeight: 800,
                      fontSize: 10,
                      marginRight: 8,
                    }}
                  >
                    {p.partyType?.toUpperCase()}
                  </span>
                  <strong>{p.partyName}</strong> · Order <span style={{ fontFamily: 'monospace' }}>#{p.orderReference}</span> —{' '}
                  {p.reason}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontWeight: 800, color: '#DC2626' }}>− {formatRupees(p.penaltyAmountPaise)}</span>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: p.settlementStatus === 'SETTLED' ? '#DCFCE7' : '#FEE2E2',
                      color: p.settlementStatus === 'SETTLED' ? '#166534' : '#991B1B',
                      fontWeight: 700,
                      fontSize: 11,
                    }}
                  >
                    {p.settlementStatus}
                  </span>
                  {p.settlementStatus !== 'SETTLED' && (
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: '4px 10px', fontSize: 11 }}
                      disabled={processingId === p._id}
                      onClick={() => handleSettlePenalty(p._id)}
                    >
                      Mark Settled
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
