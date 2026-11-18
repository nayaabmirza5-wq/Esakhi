import React, { useState, useEffect } from 'react';
import { api } from './api';
import type {
  SupportTicketItem,
  CityAdminSettlementItem,
  SellerPayoutSettlementItem,
  PartnerPayoutSettlementItem,
} from './types';

function formatRupees(paise: number): string {
  return `₹${((paise || 0) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ----------------------------------------------------------------------
// Reusable UI Badges & Helpers
// ----------------------------------------------------------------------

function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    critical: { bg: '#fee2e2', text: '#991b1b', label: 'CRITICAL' },
    high: { bg: '#ffedd5', text: '#9a3412', label: 'HIGH' },
    medium: { bg: '#fef3c7', text: '#92400e', label: 'MEDIUM' },
    low: { bg: '#f1f5f9', text: '#475569', label: 'LOW' },
  };
  const cfg = map[priority] || map.medium;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 9px',
        borderRadius: '9999px',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.04em',
        backgroundColor: cfg.bg,
        color: cfg.text,
      }}
    >
      {priority === 'critical' && (
        <span
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: '#ef4444',
            marginRight: '5px',
            animation: 'pulse 1.5s infinite',
          }}
        />
      )}
      {cfg.label}
    </span>
  );
}

function TicketStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    open: { bg: '#fef3c7', text: '#b45309', label: 'OPEN' },
    under_review: { bg: '#e0f2fe', text: '#0369a1', label: 'UNDER REVIEW' },
    action_taken: { bg: '#ede9fe', text: '#6d28d9', label: 'ACTION TAKEN' },
    resolved: { bg: '#dcfce7', text: '#15803d', label: 'RESOLVED' },
    closed: { bg: '#f1f5f9', text: '#64748b', label: 'CLOSED' },
  };
  const cfg = map[status] || map.open;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        borderRadius: '9999px',
        fontSize: '11px',
        fontWeight: 700,
        backgroundColor: cfg.bg,
        color: cfg.text,
      }}
    >
      {cfg.label}
    </span>
  );
}

// ----------------------------------------------------------------------
// 1. Super Admin Support & Escalations Desk
// ----------------------------------------------------------------------

export const SuperAdminSupportDeskPage: React.FC = () => {
  const [tickets, setTickets] = useState<SupportTicketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCity, setSelectedCity] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  // Resolution modal state
  const [activeTicket, setActiveTicket] = useState<SupportTicketItem | null>(null);
  const [resolutionStatus, setResolutionStatus] = useState<'action_taken' | 'resolved' | 'closed'>('resolved');
  const [decisionNote, setDecisionNote] = useState('');
  const [actionTaken, setActionTaken] = useState('');
  const [submittingResolution, setSubmittingResolution] = useState(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState('');

  const fetchTickets = async () => {
    setLoading(true);
    setError('');
    try {
      const city = selectedCity === 'all' ? undefined : selectedCity;
      const st = statusFilter === 'all' ? undefined : statusFilter;
      const cat = categoryFilter === 'all' ? undefined : categoryFilter;
      const data = await api.superAdminSupportTickets(st, cat, city);
      setTickets(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load support escalations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTickets();
  }, [selectedCity, statusFilter, categoryFilter]);

  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket || !decisionNote.trim()) return;
    setSubmittingResolution(true);
    try {
      const updated = await api.resolveSuperAdminSupportTicket(activeTicket._id, {
        status: resolutionStatus,
        decisionNote: decisionNote.trim(),
        ...(actionTaken.trim() ? { actionTaken: actionTaken.trim() } : {}),
      });
      setActionSuccessMessage(`Ticket #${updated.ticketReference} successfully updated to ${updated.status.toUpperCase()}!`);
      setActiveTicket(null);
      setDecisionNote('');
      setActionTaken('');
      await fetchTickets();
      setTimeout(() => setActionSuccessMessage(''), 5000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update ticket.');
    } finally {
      setSubmittingResolution(false);
    }
  };

  // Unique cities from tickets
  const availableCities = Array.from(new Set(['Damoh', ...tickets.map((t) => t.city)]));

  const openTicketsCount = tickets.filter((t) => t.status === 'open' || t.status === 'under_review').length;
  const criticalCount = tickets.filter((t) => t.priority === 'critical' && t.status !== 'resolved' && t.status !== 'closed').length;
  const sellerDisputesCount = tickets.filter((t) => t.category === 'seller_dispute').length;
  const deliveryDisputesCount = tickets.filter((t) => t.category === 'delivery_dispute').length;

  return (
    <div style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto', fontFamily: 'inherit' }}>
      {/* Header Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 60%, #4338ca 100%)',
          color: '#ffffff',
          borderRadius: '16px',
          padding: '28px 32px',
          marginBottom: '28px',
          boxShadow: '0 10px 25px -5px rgba(30, 27, 75, 0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <span
              style={{
                display: 'inline-block',
                background: 'rgba(255, 255, 255, 0.15)',
                color: '#e0e7ff',
                padding: '4px 12px',
                borderRadius: '9999px',
                fontSize: '12px',
                fontWeight: 600,
                marginBottom: '8px',
                letterSpacing: '0.05em',
              }}
            >
              CITY ESCALATIONS & LOCAL DISPUTES
            </span>
            <h1 style={{ fontSize: '26px', fontWeight: 800, margin: '4px 0 8px 0', color: '#ffffff' }}>
              Super Admin Support & Dispute Resolution Desk
            </h1>
            <p style={{ margin: 0, fontSize: '14px', color: '#c7d2fe', maxWidth: '720px', lineHeight: 1.5 }}>
              Centralized arbitration hub for City Admins (e.g. Damoh) to escalate local customer disputes, artisan seller conflicts, and delivery partner transit exceptions with direct Super Admin resolution.
            </p>
          </div>
          <button
            onClick={() => void fetchTickets()}
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              color: '#ffffff',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '8px',
              padding: '10px 18px',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            ↻ Refresh Escalations
          </button>
        </div>

        {/* Quick KPI Counters */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
            marginTop: '24px',
          }}
        >
          <div style={{ background: 'rgba(255, 255, 255, 0.1)', padding: '16px', borderRadius: '12px' }}>
            <span style={{ fontSize: '12px', color: '#cbd5e1' }}>Pending Escalations</span>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#fef08a', marginTop: '4px' }}>{openTicketsCount}</div>
            <span style={{ fontSize: '11px', color: '#e2e8f0' }}>Awaiting executive action</span>
          </div>
          <div style={{ background: 'rgba(255, 255, 255, 0.1)', padding: '16px', borderRadius: '12px' }}>
            <span style={{ fontSize: '12px', color: '#cbd5e1' }}>Critical Priority</span>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#fca5a5', marginTop: '4px' }}>{criticalCount}</div>
            <span style={{ fontSize: '11px', color: '#e2e8f0' }}>Urgent immediate resolution</span>
          </div>
          <div style={{ background: 'rgba(255, 255, 255, 0.1)', padding: '16px', borderRadius: '12px' }}>
            <span style={{ fontSize: '12px', color: '#cbd5e1' }}>Artisan Seller Disputes</span>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#fed7aa', marginTop: '4px' }}>{sellerDisputesCount}</div>
            <span style={{ fontSize: '11px', color: '#e2e8f0' }}>Catalog & payout queries</span>
          </div>
          <div style={{ background: 'rgba(255, 255, 255, 0.1)', padding: '16px', borderRadius: '12px' }}>
            <span style={{ fontSize: '12px', color: '#cbd5e1' }}>Delivery & Transit Issues</span>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#93c5fd', marginTop: '4px' }}>{deliveryDisputesCount}</div>
            <span style={{ fontSize: '11px', color: '#e2e8f0' }}>Damage / customer claims</span>
          </div>
        </div>
      </div>

      {actionSuccessMessage && (
        <div
          style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #86efac',
            color: '#166534',
            padding: '14px 18px',
            borderRadius: '10px',
            marginBottom: '20px',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          ✓ {actionSuccessMessage}
        </div>
      )}

      {/* Filter Matrix Bar */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          padding: '16px 20px',
          marginBottom: '24px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '16px',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#64748b', marginBottom: '4px' }}>
              TARGET CITY
            </label>
            <select
              value={selectedCity}
              onChange={(e) => setSelectedCity(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                fontWeight: 600,
                color: '#1e293b',
                backgroundColor: '#f8fafc',
              }}
            >
              <option value="all">All Cities ({tickets.length})</option>
              {availableCities.map((c) => (
                <option key={c} value={c}>
                  {c} City Matrix
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#64748b', marginBottom: '4px' }}>
              STATUS
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                fontWeight: 600,
                color: '#1e293b',
                backgroundColor: '#f8fafc',
              }}
            >
              <option value="all">All Statuses</option>
              <option value="open">Open</option>
              <option value="under_review">Under Review</option>
              <option value="action_taken">Action Taken</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#64748b', marginBottom: '4px' }}>
              CATEGORY
            </label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                fontWeight: 600,
                color: '#1e293b',
                backgroundColor: '#f8fafc',
              }}
            >
              <option value="all">All Dispute Categories</option>
              <option value="seller_dispute">Artisan Seller Dispute</option>
              <option value="delivery_dispute">Delivery Partner Dispute</option>
              <option value="customer_claim">Customer Return Claim</option>
              <option value="payout_query">Payout / Commission Query</option>
              <option value="policy_help">Policy & Exception Help</option>
            </select>
          </div>
        </div>

        <div style={{ fontSize: '13px', color: '#64748b' }}>
          Showing <strong>{tickets.length}</strong> escalated ticket{tickets.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Ticket List View */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>⏳</div>
          <strong>Loading city escalations…</strong>
        </div>
      ) : error ? (
        <div style={{ padding: '24px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', color: '#991b1b' }}>
          {error}
        </div>
      ) : tickets.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 20px',
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            border: '1px dashed #cbd5e1',
          }}
        >
          <div style={{ fontSize: '42px', marginBottom: '12px' }}>🛡️</div>
          <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#1e293b', margin: '0 0 6px 0' }}>
            No Active Escalations Found
          </h3>
          <p style={{ fontSize: '14px', color: '#64748b', maxWidth: '480px', margin: '0 auto' }}>
            There are currently no disputes or escalations matching your selected filter. City administrators will raise tickets here when complex exceptions require Super Admin decision.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {tickets.map((t) => (
            <div
              key={t._id}
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '14px',
                border: '1px solid #e2e8f0',
                padding: '20px 24px',
                boxShadow: '0 2px 8px -2px rgba(0, 0, 0, 0.05)',
                transition: 'box-shadow 0.2s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '13px', fontWeight: 700, color: '#4338ca', backgroundColor: '#eef2ff', padding: '2px 8px', borderRadius: '6px' }}>
                      {t.ticketReference}
                    </span>
                    <PriorityBadge priority={t.priority} />
                    <TicketStatusBadge status={t.status} />
                    <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
                      📍 {t.city} City
                    </span>
                  </div>
                  <h3 style={{ fontSize: '17px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px 0' }}>
                    {t.subject}
                  </h3>
                  <div style={{ fontSize: '12px', color: '#475569', display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
                    <span>
                      Escalated by: <strong>{t.cityAdminName}</strong> ({t.cityAdminPhone})
                    </span>
                    <span>
                      Created: {new Date(t.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {t.relatedOrderReference && (
                      <span style={{ color: '#0284c7', fontWeight: 600 }}>
                        Order Ref: #{t.relatedOrderReference}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => {
                    setActiveTicket(t);
                    setDecisionNote(t.superAdminResolution?.decisionNote || '');
                    setActionTaken(t.superAdminResolution?.actionTaken || '');
                    setResolutionStatus(t.status === 'resolved' || t.status === 'closed' ? (t.status as 'resolved' | 'closed') : 'resolved');
                  }}
                  style={{
                    backgroundColor: '#4338ca',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Arbitrate & Resolve ➔
                </button>
              </div>

              {/* Description box */}
              <div
                style={{
                  marginTop: '14px',
                  backgroundColor: '#f8fafc',
                  borderRadius: '10px',
                  padding: '14px 16px',
                  fontSize: '13px',
                  lineHeight: 1.6,
                  color: '#334155',
                  border: '1px solid #f1f5f9',
                }}
              >
                <div style={{ fontWeight: 600, color: '#475569', marginBottom: '4px', fontSize: '11px', textTransform: 'uppercase' }}>
                  City Admin Description / Issue Report:
                </div>
                {t.description}

                {t.relatedParty?.name && (
                  <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0', fontSize: '12px', color: '#64748b' }}>
                    Involved Party: <strong style={{ color: '#0f172a' }}>{t.relatedParty.name}</strong> ({t.relatedParty.partyType.toUpperCase().replace('_', ' ')})
                    {t.relatedParty.phoneE164 && ` · Phone: ${t.relatedParty.phoneE164}`}
                  </div>
                )}
              </div>

              {/* Super Admin resolution note if present */}
              {t.superAdminResolution?.decisionNote && (
                <div
                  style={{
                    marginTop: '12px',
                    backgroundColor: '#ecfdf5',
                    borderRadius: '10px',
                    padding: '12px 16px',
                    fontSize: '13px',
                    color: '#065f46',
                    border: '1px solid #a7f3d0',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px', color: '#047857' }}>
                    Super Admin Resolution Decision ({t.superAdminResolution.resolvedByName || 'Super Admin'}):
                  </div>
                  <div>{t.superAdminResolution.decisionNote}</div>
                  {t.superAdminResolution.actionTaken && (
                    <div style={{ fontSize: '12px', marginTop: '4px', fontWeight: 600, color: '#065f46' }}>
                      Action: {t.superAdminResolution.actionTaken}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Resolution Modal / Drawer */}
      {activeTicket && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              maxWidth: '640px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              padding: '28px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#4338ca' }}>
                  {activeTicket.ticketReference} · {activeTicket.city} City
                </span>
                <h2 style={{ fontSize: '19px', fontWeight: 800, margin: '4px 0 0 0', color: '#0f172a' }}>
                  Executive Resolution & Decision
                </h2>
              </div>
              <button
                onClick={() => setActiveTicket(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '20px',
                  color: '#64748b',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ backgroundColor: '#f8fafc', padding: '12px 16px', borderRadius: '10px', marginBottom: '18px', fontSize: '13px' }}>
              <strong style={{ color: '#1e293b' }}>{activeTicket.subject}</strong>
              <div style={{ color: '#475569', marginTop: '4px' }}>{activeTicket.description}</div>
            </div>

            <form onSubmit={handleResolveSubmit}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Decision Status
                </label>
                <select
                  value={resolutionStatus}
                  onChange={(e) => setResolutionStatus(e.target.value as 'action_taken' | 'resolved' | 'closed')}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                    fontWeight: 600,
                  }}
                >
                  <option value="resolved">Resolved (Close with full settlement / resolution)</option>
                  <option value="action_taken">Action Taken (Instruction issued to City Admin)</option>
                  <option value="closed">Closed (No further action needed)</option>
                </select>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Executive Decision Note (Recorded on Ticket Timeline) *
                </label>
                <textarea
                  required
                  rows={4}
                  value={decisionNote}
                  onChange={(e) => setDecisionNote(e.target.value)}
                  placeholder="State the final ruling, e.g. 'Approved penalty waiver for seller, City Admin to disburse replacement item from Damoh center...'"
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    lineHeight: 1.5,
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Action Taken (Optional)
                </label>
                <input
                  type="text"
                  value={actionTaken}
                  onChange={(e) => setActionTaken(e.target.value)}
                  placeholder="e.g. Penalty waived, refund issued, replacement order created"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => setActiveTicket(null)}
                  style={{
                    padding: '10px 18px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#475569',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingResolution || !decisionNote.trim()}
                  style={{
                    padding: '10px 22px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#4338ca',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: submittingResolution ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submittingResolution ? 'Saving Decision…' : 'Confirm Resolution'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// ----------------------------------------------------------------------
// 2. Super Admin Assisted Payout Desk (5% City Admin, 90% Seller, ₹29 Rider)
// ----------------------------------------------------------------------

type BeneficiaryChannel = 'city_admins' | 'sellers' | 'partners' | 'govt_tax_register';

interface PayoutBeneficiaryModalData {
  beneficiaryType: 'city_admin' | 'seller' | 'delivery_partner';
  beneficiaryId: string;
  name: string;
  phone: string;
  city: string;
  netLockedPayablePaise: number;
  bankAccount: {
    accountHolderName: string;
    accountNumberMasked: string;
    ifscCode: string;
    bankName: string;
    upiId?: string;
  };
}

export const SuperAdminAssistedPayoutDeskPage: React.FC<{ initialTab?: BeneficiaryChannel }> = ({ initialTab = 'city_admins' }) => {
  const [activeTab, setActiveTab] = useState<BeneficiaryChannel>(initialTab);
  const [cityAdmins, setCityAdmins] = useState<CityAdminSettlementItem[]>([]);
  const [sellers, setSellers] = useState<SellerPayoutSettlementItem[]>([]);
  const [partners, setPartners] = useState<PartnerPayoutSettlementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('all');

  // Assisted Payout Drawer / Modal
  const [payoutModalData, setPayoutModalData] = useState<PayoutBeneficiaryModalData | null>(null);
  const [utrReference, setUtrReference] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'upi_intent' | 'bank_transfer' | 'razorpay_manual'>('upi_intent');
  const [notes, setNotes] = useState('');
  const [auditCertified, setAuditCertified] = useState(false);
  const [processingDisbursement, setProcessingDisbursement] = useState(false);
  const [disbursementSuccess, setDisbursementSuccess] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [simulateAbove5Lakh, setSimulateAbove5Lakh] = useState(false);

  const exportCsvFile = (filename: string, headers: string[], rows: string[][]) => {
    const csvContent = [
      headers.join(','),
      ...rows.map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportGstr8Csv = () => {
    const headers = [
      'Seller_ID',
      'SHG_Business_Name',
      'City',
      'Tax_Regime',
      'GSTIN_or_Enrolment_ID',
      'PAN_Number',
      'GSTR8_Table',
      'Gross_Supplies_INR',
      'Net_Taxable_Value_INR',
      'CGST_TCS_0.25_INR',
      'SGST_TCS_0.25_INR',
      'Total_GSTR8_TCS_0.5_INR',
    ];
    const rows = sellers.map((s) => {
      const st = s.statutoryTax;
      const isGst = Boolean(st?.hasGst);
      const grossInr = (s.grossSalesPaise / 100).toFixed(2);
      const taxableInr = ((st?.taxableSalesPaise ?? s.grossSalesPaise) / 100).toFixed(2);
      const cgstInr = ((st?.tcsCgstPaise ?? 0) / 100).toFixed(2);
      const sgstInr = ((st?.tcsSgstPaise ?? 0) / 100).toFixed(2);
      const totalTcsInr = (((s.tcsDeductionPaise ?? st?.tcsTotalPaise ?? 0)) / 100).toFixed(2);
      return [
        s.sellerId,
        s.sellerName,
        s.city,
        isGst ? 'GST_REGISTERED' : 'NON_GST_ENROLMENT_ID',
        isGst ? (st?.gstin || '23AAAAA0000A1Z5') : (st?.enrolmentId || 'ENR-MP-470661-0012'),
        st?.panNumber || 'ABCDE1234F',
        isGst ? 'Table 3 (GSTIN TCS)' : 'Table 4B (Unregistered Enrolment ID)',
        grossInr,
        taxableInr,
        cgstInr,
        sgstInr,
        totalTcsInr,
      ];
    });
    exportCsvFile(`eSakhi_GSTR8_TCS_and_Enrolment_Return_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const handleExportForm26QCsv = () => {
    const headers = [
      'Seller_ID',
      'Deductee_SHG_Name',
      'PAN_Number',
      'Enrolment_ID_or_GSTIN',
      'Financial_Year',
      'FY_Cumulative_Gross_Sales_INR',
      'Above_5_Lakh_Threshold_194O',
      'TDS_Rate_Percent',
      'Section_194O_TDS_Deducted_INR',
      'IT_Filing_Form',
    ];
    const rows = sellers.map((s) => {
      const st = s.statutoryTax;
      const rawFy = st?.fyGrossSalesPaise ?? s.grossSalesPaise;
      const effectiveFy = simulateAbove5Lakh ? Math.max(rawFy, 54_500_000) : rawFy;
      const isAbove5L = effectiveFy > 50_000_000;
      const tdsPaise = isAbove5L
        ? Math.max(s.tdsDeductionPaise ?? 0, Math.round(effectiveFy * 0.001))
        : 0;
      return [
        s.sellerId,
        s.sellerName,
        st?.panNumber || 'ABCDE1234F',
        st?.hasGst ? (st.gstin || '23AAAAA0000A1Z5') : (st?.enrolmentId || 'ENR-MP-470661-0012'),
        st?.fyLabel || 'FY 2026-27',
        (effectiveFy / 100).toFixed(2),
        isAbove5L ? 'YES (> 5,00,000)' : 'NO (<= 5,00,000 Exempt)',
        isAbove5L ? '0.10%' : '0.00%',
        (tdsPaise / 100).toFixed(2),
        isAbove5L ? 'Form 26Q / Form 16A (Sec 194-O)' : 'Exempt u/s 194-O Proviso',
      ];
    });
    exportCsvFile(`eSakhi_Form26Q_Sec194O_TDS_Return_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const loadSettlementData = async () => {
    setLoading(true);
    setError('');
    try {
      const [adminsRes, sellersRes, partnersRes] = await Promise.all([
        api.superAdminCityAdminSettlements(),
        api.superAdminSellerSettlements(),
        api.superAdminPartnerSettlements(),
      ]);
      setCityAdmins(adminsRes);
      setSellers(sellersRes);
      setPartners(partnersRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settlement ledgers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettlementData();
  }, []);

    const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 2500);
  };

  const handleDisbursementSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payoutModalData || !utrReference.trim()) return;

    setProcessingDisbursement(true);
    try {
      const res = await api.recordSuperAdminDisbursement({
        beneficiaryType: payoutModalData.beneficiaryType,
        beneficiaryId: payoutModalData.beneficiaryId,
        paymentMethod,
        utrReference: utrReference.trim(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });

      setDisbursementSuccess(
        `Disbursement ${res.payoutReference} successfully recorded! Net ₹${((res.netPaidPaise) / 100).toFixed(2)} disbursed with UTR: ${res.utrReference}.`
      );
      setPayoutModalData(null);
      setUtrReference('');
      setNotes('');
      setAuditCertified(false);
      await loadSettlementData();
      setTimeout(() => setDisbursementSuccess(null), 7000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Disbursement recording failed.');
    } finally {
      setProcessingDisbursement(false);
    }
  };

  // Grand totals across channels
  const totalCityAdminPending = cityAdmins.reduce((sum, a) => sum + (a.netLockedPayablePaise || 0), 0);
  const totalSellerPending = sellers.reduce((sum, s) => sum + (s.netLockedPayablePaise || 0), 0);
  const totalPartnerPending = partners.reduce((sum, p) => sum + (p.netLockedPayablePaise || 0), 0);
  const grandTotalPending = totalCityAdminPending + totalSellerPending + totalPartnerPending;

  // Filtered lists
  const filterPredicate = (city: string, name: string, phone: string) => {
    const cityMatch = selectedCity === 'all' || city.toLowerCase() === selectedCity.toLowerCase();
    const queryMatch =
      !searchQuery.trim() ||
      name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      phone.includes(searchQuery);
    return cityMatch && queryMatch;
  };

  const filteredAdmins = cityAdmins.filter((a) => filterPredicate(a.city, a.cityAdminName, a.phoneE164));
  const filteredSellers = sellers.filter((s) => filterPredicate(s.city, s.sellerName, s.phoneE164));
  const filteredPartners = partners.filter((p) => filterPredicate(p.city, p.partnerName, p.phoneE164));

  return (
    <div style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto', fontFamily: 'inherit' }}>
      {/* Top Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #064e3b 0%, #065f46 60%, #047857 100%)',
          color: '#ffffff',
          borderRadius: '16px',
          padding: '28px 32px',
          marginBottom: '28px',
          boxShadow: '0 10px 25px -5px rgba(6, 78, 59, 0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <span
              style={{
                display: 'inline-block',
                background: 'rgba(255, 255, 255, 0.15)',
                color: '#a7f3d0',
                padding: '4px 12px',
                borderRadius: '9999px',
                fontSize: '12px',
                fontWeight: 600,
                marginBottom: '8px',
                letterSpacing: '0.05em',
              }}
            >
              RAZORPAY INDIVIDUAL · ASSISTED PAYOUT DESK
            </span>
            <h1 style={{ fontSize: '26px', fontWeight: 800, margin: '4px 0 8px 0', color: '#ffffff' }}>
              Financial Settlements & Salary Payouts
            </h1>
            <p style={{ margin: 0, fontSize: '14px', color: '#d1fae5', maxWidth: '780px', lineHeight: 1.5 }}>
              100% of customer collections arrive into your bank account. Disburse strictly computed and <strong>locked balances</strong> to City Admins (5% fee), Artisan Sellers (90% product earnings), and Delivery Partners (₹29/order) with 1-click UPI, auto-fetched bank details, and dynamic QR codes.
            </p>
          </div>
          <button
            onClick={() => void loadSettlementData()}
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              color: '#ffffff',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '8px',
              padding: '10px 18px',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            ↻ Refresh Ledgers
          </button>
        </div>

        {/* Global Pending KPI Strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '16px',
            marginTop: '24px',
          }}
        >
          <div style={{ background: 'rgba(255, 255, 255, 0.1)', padding: '16px', borderRadius: '12px' }}>
            <span style={{ fontSize: '12px', color: '#cbd5e1' }}>Total Outstanding Payouts</span>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#fef08a', marginTop: '4px' }}>
              {formatRupees(grandTotalPending)}
            </div>
            <span style={{ fontSize: '11px', color: '#e2e8f0' }}>Locked non-editable net sum</span>
          </div>
          <div style={{ background: 'rgba(255, 255, 255, 0.1)', padding: '16px', borderRadius: '12px' }}>
            <span style={{ fontSize: '12px', color: '#cbd5e1' }}>City Admins (5% Commission)</span>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#ffffff', marginTop: '4px' }}>
              {formatRupees(totalCityAdminPending)}
            </div>
            <span style={{ fontSize: '11px', color: '#a7f3d0' }}>{cityAdmins.length} active City Admin(s)</span>
          </div>
          <div style={{ background: 'rgba(255, 255, 255, 0.1)', padding: '16px', borderRadius: '12px' }}>
            <span style={{ fontSize: '12px', color: '#cbd5e1' }}>Artisan Sellers (90% Share)</span>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#ffffff', marginTop: '4px' }}>
              {formatRupees(totalSellerPending)}
            </div>
            <span style={{ fontSize: '11px', color: '#a7f3d0' }}>Net of 10% retention & penalties</span>
          </div>
          <div style={{ background: 'rgba(255, 255, 255, 0.1)', padding: '16px', borderRadius: '12px' }}>
            <span style={{ fontSize: '12px', color: '#cbd5e1' }}>Delivery Partners (₹29/trip)</span>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#ffffff', marginTop: '4px' }}>
              {formatRupees(totalPartnerPending)}
            </div>
            <span style={{ fontSize: '11px', color: '#a7f3d0' }}>Net of transit penalties</span>
          </div>
        </div>
      </div>

      {disbursementSuccess && (
        <div
          style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #86efac',
            color: '#166534',
            padding: '14px 18px',
            borderRadius: '10px',
            marginBottom: '20px',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          ✓ {disbursementSuccess}
        </div>
      )}

      {/* Tabs & Filter Bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '20px',
        }}
      >
        {/* Beneficiary Switcher */}
        <div
          style={{
            display: 'inline-flex',
            backgroundColor: '#f1f5f9',
            padding: '4px',
            borderRadius: '10px',
            gap: '4px',
          }}
        >
          <button
            onClick={() => setActiveTab('city_admins')}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              border: 'none',
              backgroundColor: activeTab === 'city_admins' ? '#ffffff' : 'transparent',
              color: activeTab === 'city_admins' ? '#0f172a' : '#64748b',
              boxShadow: activeTab === 'city_admins' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            🏛️ City Admins ({cityAdmins.length})
          </button>
          <button
            onClick={() => setActiveTab('sellers')}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              border: 'none',
              backgroundColor: activeTab === 'sellers' ? '#ffffff' : 'transparent',
              color: activeTab === 'sellers' ? '#0f172a' : '#64748b',
              boxShadow: activeTab === 'sellers' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            🧵 Artisan Sellers ({sellers.length})
          </button>
          <button
            onClick={() => setActiveTab('partners')}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              border: 'none',
              backgroundColor: activeTab === 'partners' ? '#ffffff' : 'transparent',
              color: activeTab === 'partners' ? '#0f172a' : '#64748b',
              boxShadow: activeTab === 'partners' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            🚴 Delivery Partners ({partners.length})
          </button>
          <button
            onClick={() => setActiveTab('govt_tax_register')}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              border: 'none',
              backgroundColor: activeTab === 'govt_tax_register' ? '#4338ca' : 'transparent',
              color: activeTab === 'govt_tax_register' ? '#ffffff' : '#4338ca',
              boxShadow: activeTab === 'govt_tax_register' ? '0 1px 3px rgba(67,56,202,0.3)' : 'none',
            }}
          >
            ⚖️ Govt. Tax & Enrolment Register (TCS / TDS)
          </button>
        </div>

        {/* Search & City Filter */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={selectedCity}
            onChange={(e) => setSelectedCity(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            <option value="all">All Cities</option>
            <option value="Damoh">Damoh</option>
          </select>
          <input
            type="text"
            placeholder="Search name or phone…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              minWidth: '200px',
            }}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>⏳</div>
          <strong>Calculating financial ledgers and bank records…</strong>
        </div>
      ) : error ? (
        <div style={{ padding: '24px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', color: '#991b1b' }}>
          {error}
        </div>
      ) : (
        <>
          {/* TAB 1: CITY ADMINS */}
          {activeTab === 'city_admins' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {filteredAdmins.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', backgroundColor: '#ffffff', borderRadius: '12px', border: '1px dashed #cbd5e1', color: '#64748b' }}>
                  No City Admins found matching criteria.
                </div>
              ) : (
                filteredAdmins.map((admin) => (
                  <div
                    key={admin.cityAdminId}
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: '14px',
                      border: '1px solid #e2e8f0',
                      padding: '20px 24px',
                      boxShadow: '0 2px 6px -2px rgba(0, 0, 0, 0.05)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: '#4338ca', backgroundColor: '#eef2ff', padding: '2px 8px', borderRadius: '6px' }}>
                            CITY ADMINISTRATOR
                          </span>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                            📍 {admin.city} City Hub
                          </span>
                        </div>
                        <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: '2px 0 6px 0' }}>
                          {admin.cityAdminName}
                        </h3>
                        <div style={{ fontSize: '13px', color: '#64748b' }}>
                          Phone: <strong>{admin.phoneE164}</strong> {admin.email && `· Email: ${admin.email}`} · Completed Orders: <strong>{admin.ordersHandledCount}</strong>
                        </div>
                      </div>

                      {/* Locked Payout Card */}
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                          🔒 Net Locked Payable (5% Commission)
                        </span>
                        <div style={{ fontSize: '24px', fontWeight: 800, color: admin.netLockedPayablePaise > 0 ? '#047857' : '#64748b', marginTop: '2px' }}>
                          {formatRupees(admin.netLockedPayablePaise)}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                          Gross Sales: {formatRupees(admin.grossCitySalesPaise)} · Already Disbursed: {formatRupees(admin.alreadyDisbursedPaise)}
                        </div>
                        <button
                          disabled={admin.netLockedPayablePaise <= 0}
                          onClick={() => {
                            setPayoutModalData({
                              beneficiaryType: 'city_admin',
                              beneficiaryId: admin.cityAdminId,
                              name: admin.cityAdminName,
                              phone: admin.phoneE164,
                              city: admin.city,
                              netLockedPayablePaise: admin.netLockedPayablePaise,
                              bankAccount: admin.bankAccount,
                            });
                          }}
                          style={{
                            marginTop: '10px',
                            backgroundColor: admin.netLockedPayablePaise > 0 ? '#059669' : '#cbd5e1',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '9px 18px',
                            fontSize: '13px',
                            fontWeight: 700,
                            cursor: admin.netLockedPayablePaise > 0 ? 'pointer' : 'not-allowed',
                          }}
                        >
                          {admin.netLockedPayablePaise > 0 ? 'Proceed to Disburse ➔' : '✓ All Settled'}
                        </button>
                      </div>
                    </div>

                    {/* Linked Bank Snapshot */}
                    <div
                      style={{
                        marginTop: '16px',
                        padding: '12px 16px',
                        backgroundColor: '#f8fafc',
                        borderRadius: '10px',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '20px',
                        fontSize: '12px',
                        color: '#475569',
                        border: '1px solid #f1f5f9',
                      }}
                    >
                      <div><strong>Bank:</strong> {admin.bankAccount.bankName}</div>
                      <div><strong>Account:</strong> {admin.bankAccount.accountNumberMasked}</div>
                      <div><strong>IFSC:</strong> {admin.bankAccount.ifscCode}</div>
                      <div><strong>UPI ID:</strong> {admin.bankAccount.upiId || '—'}</div>
                      <div><strong>Holder:</strong> {admin.bankAccount.accountHolderName}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 2: ARTISAN SELLERS */}
          {activeTab === 'sellers' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {filteredSellers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', backgroundColor: '#ffffff', borderRadius: '12px', border: '1px dashed #cbd5e1', color: '#64748b' }}>
                  No Artisan Sellers found matching criteria.
                </div>
              ) : (
                filteredSellers.map((seller) => {
                  const st = seller.statutoryTax;
                  const isGst = Boolean(st?.hasGst);
                  const taxIdLabel = isGst ? 'GSTIN' : 'Enrolment ID';
                  const taxIdValue = isGst ? (st?.gstin || '23AAAAA0000A1Z5') : (st?.enrolmentId || 'ENR-MP-470661-0012');
                  const panVal = st?.panNumber || 'ABCDE1234F';
                  const fyGross = st?.fyGrossSalesPaise ?? seller.grossSalesPaise;
                  const exceeds5L = Boolean(st?.exceeds5LakhThreshold || fyGross > 50_000_000);
                  const pct5L = Math.min(100, Math.round((fyGross / 50_000_000) * 1000) / 10);
                  const tcsPaise = seller.tcsDeductionPaise ?? st?.tcsTotalPaise ?? 0;
                  const tdsPaise = seller.tdsDeductionPaise ?? st?.tds194OPaise ?? 0;

                  return (
                    <div
                      key={seller.sellerId}
                      style={{
                        backgroundColor: '#ffffff',
                        borderRadius: '14px',
                        border: '1px solid #e2e8f0',
                        padding: '20px 24px',
                        boxShadow: '0 2px 6px -2px rgba(0, 0, 0, 0.05)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '12px', fontWeight: 700, color: '#b45309', backgroundColor: '#fef3c7', padding: '2px 8px', borderRadius: '6px' }}>
                              ARTISAN / SHG SELLER
                            </span>
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 800,
                                padding: '2px 8px',
                                borderRadius: '6px',
                                backgroundColor: isGst ? '#dbeafe' : '#dcfce7',
                                color: isGst ? '#1e40af' : '#166534',
                              }}
                            >
                              {isGst ? `GSTIN: ${taxIdValue}` : `Enrolment ID: ${taxIdValue}`}
                            </span>
                            <span style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'monospace', backgroundColor: '#f1f5f9', color: '#334155', padding: '2px 8px', borderRadius: '6px' }}>
                              PAN: {panVal}
                            </span>
                            <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                              📍 {seller.city}
                            </span>
                          </div>
                          <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: '2px 0 6px 0' }}>
                            {seller.sellerName}
                          </h3>
                          <div style={{ fontSize: '13px', color: '#64748b' }}>
                            Lead: <strong>{seller.representative}</strong> · Phone: <strong>{seller.phoneE164}</strong> · Handcrafted Units Sold: <strong>{seller.unitsSold}</strong>
                          </div>
                        </div>

                        {/* Locked Payout Card */}
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                            🔒 Net Locked Payable (After Commission, TCS & TDS)
                          </span>
                          <div style={{ fontSize: '24px', fontWeight: 800, color: seller.netLockedPayablePaise > 0 ? '#047857' : '#64748b', marginTop: '2px' }}>
                            {formatRupees(seller.netLockedPayablePaise)}
                          </div>
                          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                            Gross: {formatRupees(seller.grossSalesPaise)} · 10% Comm: −{formatRupees(seller.commissionDeductionsPaise)} · TCS: −{formatRupees(tcsPaise)} · TDS: −{formatRupees(tdsPaise)} · Penalties: −{formatRupees(seller.penaltyDeductionsPaise)}
                          </div>
                          <button
                            disabled={seller.netLockedPayablePaise <= 0}
                            onClick={() => {
                              setPayoutModalData({
                                beneficiaryType: 'seller',
                                beneficiaryId: seller.sellerId,
                                name: seller.sellerName,
                                phone: seller.phoneE164,
                                city: seller.city,
                                netLockedPayablePaise: seller.netLockedPayablePaise,
                                bankAccount: seller.bankAccount,
                              });
                            }}
                            style={{
                              marginTop: '10px',
                              backgroundColor: seller.netLockedPayablePaise > 0 ? '#059669' : '#cbd5e1',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '8px',
                              padding: '9px 18px',
                              fontSize: '13px',
                              fontWeight: 700,
                              cursor: seller.netLockedPayablePaise > 0 ? 'pointer' : 'not-allowed',
                            }}
                          >
                            {seller.netLockedPayablePaise > 0 ? 'Proceed to Disburse ➔' : '✓ All Settled'}
                          </button>
                        </div>
                      </div>

                      {/* Statutory ₹5,00,000 Threshold & TCS/TDS Strip */}
                      <div
                        style={{
                          marginTop: '14px',
                          padding: '10px 14px',
                          backgroundColor: exceeds5L ? '#faf5ff' : '#f0f9ff',
                          borderRadius: '10px',
                          border: `1px solid ${exceeds5L ? '#d8b4fe' : '#bae6fd'}`,
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '12px',
                          fontSize: '12px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                          <strong style={{ color: '#0f172a' }}>
                            {st?.fyLabel || 'FY 2026-27'} Sales vs ₹5,00,000 Threshold (Sec 194-O):
                          </strong>
                          <span style={{ fontWeight: 800, color: exceeds5L ? '#7e22ce' : '#0369a1' }}>
                            {formatRupees(fyGross)} / ₹5,00,000.00 ({pct5L}%)
                          </span>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '999px',
                              fontSize: '11px',
                              fontWeight: 800,
                              backgroundColor: exceeds5L ? '#f3e8ff' : '#dcfce7',
                              color: exceeds5L ? '#7e22ce' : '#166534',
                            }}
                          >
                            {exceeds5L ? '⚡ >₹5L: 0.1% TDS Deducted' : '✓ ≤₹5L: 0% TDS Exempt'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', color: '#334155' }}>
                          <span>
                            <strong>GSTR-8 TCS (0.5%):</strong>{' '}
                            {isGst ? formatRupees(tcsPaise) : '₹0.00 (Enrolment ID Exempt)'}
                          </span>
                          <span>
                            <strong>Sec 194-O TDS (0.1%):</strong>{' '}
                            {exceeds5L ? formatRupees(tdsPaise) : '₹0.00 (Below ₹5L)'}
                          </span>
                        </div>
                      </div>

                      {/* Linked Bank Snapshot */}
                      <div
                        style={{
                          marginTop: '12px',
                          padding: '12px 16px',
                          backgroundColor: '#f8fafc',
                          borderRadius: '10px',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '20px',
                          fontSize: '12px',
                          color: '#475569',
                          border: '1px solid #f1f5f9',
                        }}
                      >
                        <div><strong>Bank:</strong> {seller.bankAccount.bankName}</div>
                        <div><strong>Account:</strong> {seller.bankAccount.accountNumberMasked}</div>
                        <div><strong>IFSC:</strong> {seller.bankAccount.ifscCode}</div>
                        <div><strong>UPI ID:</strong> {seller.bankAccount.upiId || '—'}</div>
                        <div><strong>Holder:</strong> {seller.bankAccount.accountHolderName}</div>
                        <div><strong>{taxIdLabel}:</strong> {taxIdValue}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 3: DELIVERY PARTNERS */}
          {activeTab === 'partners' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {filteredPartners.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', backgroundColor: '#ffffff', borderRadius: '12px', border: '1px dashed #cbd5e1', color: '#64748b' }}>
                  No Delivery Partners found matching criteria.
                </div>
              ) : (
                filteredPartners.map((partner) => (
                  <div
                    key={partner.partnerId}
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: '14px',
                      border: '1px solid #e2e8f0',
                      padding: '20px 24px',
                      boxShadow: '0 2px 6px -2px rgba(0, 0, 0, 0.05)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: '#0369a1', backgroundColor: '#e0f2fe', padding: '2px 8px', borderRadius: '6px' }}>
                            DELIVERY PARTNER
                          </span>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                            📍 {partner.city} City Fleet
                          </span>
                        </div>
                        <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: '2px 0 6px 0' }}>
                          {partner.partnerName}
                        </h3>
                        <div style={{ fontSize: '13px', color: '#64748b' }}>
                          Phone: <strong>{partner.phoneE164}</strong> · Completed Deliveries: <strong>{partner.tripsCompleted}</strong> (at ₹29.00/trip)
                        </div>
                      </div>

                      {/* Locked Payout Card */}
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                          🔒 Net Locked Payable (₹29 × Trips)
                        </span>
                        <div style={{ fontSize: '24px', fontWeight: 800, color: partner.netLockedPayablePaise > 0 ? '#047857' : '#64748b', marginTop: '2px' }}>
                          {formatRupees(partner.netLockedPayablePaise)}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                          Gross Trips: {formatRupees(partner.grossEarningsPaise)} · Transit Penalties: {formatRupees(partner.penaltyDeductionsPaise)} · Disbursed: {formatRupees(partner.alreadyDisbursedPaise)}
                        </div>
                        <button
                          disabled={partner.netLockedPayablePaise <= 0}
                          onClick={() => {
                            setPayoutModalData({
                              beneficiaryType: 'delivery_partner',
                              beneficiaryId: partner.partnerId,
                              name: partner.partnerName,
                              phone: partner.phoneE164,
                              city: partner.city,
                              netLockedPayablePaise: partner.netLockedPayablePaise,
                              bankAccount: partner.bankAccount,
                            });
                          }}
                          style={{
                            marginTop: '10px',
                            backgroundColor: partner.netLockedPayablePaise > 0 ? '#059669' : '#cbd5e1',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '9px 18px',
                            fontSize: '13px',
                            fontWeight: 700,
                            cursor: partner.netLockedPayablePaise > 0 ? 'pointer' : 'not-allowed',
                          }}
                        >
                          {partner.netLockedPayablePaise > 0 ? 'Proceed to Disburse ➔' : '✓ All Settled'}
                        </button>
                      </div>
                    </div>

                    {/* Linked Bank Snapshot */}
                    <div
                      style={{
                        marginTop: '16px',
                        padding: '12px 16px',
                        backgroundColor: '#f8fafc',
                        borderRadius: '10px',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '20px',
                        fontSize: '12px',
                        color: '#475569',
                        border: '1px solid #f1f5f9',
                      }}
                    >
                      <div><strong>Bank:</strong> {partner.bankAccount.bankName}</div>
                      <div><strong>Account:</strong> {partner.bankAccount.accountNumberMasked}</div>
                      <div><strong>IFSC:</strong> {partner.bankAccount.ifscCode}</div>
                      <div><strong>UPI ID:</strong> {partner.bankAccount.upiId || '—'}</div>
                      <div><strong>Holder:</strong> {partner.bankAccount.accountHolderName}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 4: GOVERNMENT STATUTORY TAX & ENROLMENT REGISTER (GSTR-8 TCS & SEC 194-O TDS) */}
          {activeTab === 'govt_tax_register' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Statutory Compliance Explainer & Export Bar */}
              <div
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '16px',
                  border: '1.5px solid #c7d2fe',
                  padding: '22px 24px',
                  boxShadow: '0 4px 14px rgba(67, 56, 202, 0.06)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                  <div>
                    <span
                      style={{
                        display: 'inline-block',
                        backgroundColor: '#eef2ff',
                        color: '#4338ca',
                        padding: '3px 10px',
                        borderRadius: '999px',
                        fontSize: '11px',
                        fontWeight: 800,
                        letterSpacing: '0.04em',
                      }}
                    >
                      GOVERNMENT OF INDIA · E-COMMERCE OPERATOR TAX LEDGER
                    </span>
                    <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', margin: '6px 0 4px 0' }}>
                      GSTR-8 (Sec 52 GST TCS), Form 26Q (Sec 194-O TDS) & Enrolment ID Register
                    </h2>
                    <p style={{ fontSize: '13px', color: '#475569', margin: 0, maxWidth: '760px', lineHeight: 1.5 }}>
                      Centralized statutory register for filing monthly <strong>GSTR-8</strong> (0.5% TCS on GSTIN sellers + Table 4B outward supplies for Non-GST Enrolment ID artisans) and quarterly <strong>Form 26Q</strong> (0.1% Income Tax TDS when a seller’s Financial Year sales cross <strong>₹5,00,000</strong>).
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => setSimulateAbove5Lakh((prev) => !prev)}
                      style={{
                        backgroundColor: simulateAbove5Lakh ? '#7e22ce' : '#faf5ff',
                        color: simulateAbove5Lakh ? '#ffffff' : '#6b21a8',
                        border: '1px solid #c084fc',
                        borderRadius: '8px',
                        padding: '9px 14px',
                        fontSize: '12px',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {simulateAbove5Lakh ? '↺ Show Actual Live FY Sales' : '🔬 Simulate > ₹5L Seller Sales (Test 0.1% TDS)'}
                    </button>
                    <button
                      type="button"
                      onClick={handleExportGstr8Csv}
                      style={{
                        backgroundColor: '#047857',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '9px 14px',
                        fontSize: '12px',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      ⬇️ Export GSTR-8 (TCS & Enrolment IDs) CSV
                    </button>
                    <button
                      type="button"
                      onClick={handleExportForm26QCsv}
                      style={{
                        backgroundColor: '#4338ca',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '9px 14px',
                        fontSize: '12px',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      ⬇️ Export Form 26Q (Sec 194-O TDS) CSV
                    </button>
                  </div>
                </div>

                {/* 3 Statutory Rule Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px', marginTop: '18px' }}>
                  <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', fontSize: '12px', lineHeight: 1.5 }}>
                    <strong style={{ color: '#0f172a', display: 'block', marginBottom: '4px' }}>
                      1. How We Detect Seller Earnings &gt; ₹5,00,000 (Sec 194-O)
                    </strong>
                    <span style={{ color: '#475569' }}>
                      The backend aggregates each seller’s confirmed non-cancelled orders across the Indian Financial Year (<strong>1 April – 31 March</strong>) linked to their PAN. While cumulative sales are <strong>≤ ₹5,00,000</strong>, TDS is <strong>0% (Exempt)</strong>. The moment cumulative FY sales cross <strong>₹5,00,000</strong>, the engine automatically deducts <strong>0.1% TDS</strong> and queues it for <strong>Form 26Q / Form 16A</strong>.
                    </span>
                  </div>
                  <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: '12px', lineHeight: 1.5 }}>
                    <strong style={{ color: '#166534', display: 'block', marginBottom: '4px' }}>
                      2. Section 52 GST TCS (0.5% · GSTR-8 Table 3)
                    </strong>
                    <span style={{ color: '#15803d' }}>
                      For <strong>GSTIN-registered sellers</strong>, eSakhi deducts <strong>0.5% TCS</strong> (0.25% CGST + 0.25% SGST) on net taxable value and deposits it by the 10th of the following month via <strong>GSTR-8</strong>. Sellers claim 100% of this back in their <strong>GST Electronic Cash Ledger</strong>.
                    </span>
                  </div>
                  <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#fffbeb', border: '1px solid #fde68a', fontSize: '12px', lineHeight: 1.5 }}>
                    <strong style={{ color: '#92400e', display: 'block', marginBottom: '4px' }}>
                      3. Non-GST Enrolment ID Artisans (Notification 34/2023-CT)
                    </strong>
                    <span style={{ color: '#b45309' }}>
                      SHGs and small artisans with a Government <strong>Enrolment ID</strong> (e.g. <code>ENR-MP-470661-0012</code>) issue a <strong>0% GST Bill of Supply</strong> and have <strong>₹0 GST TCS deducted</strong>. eSakhi reports their Enrolment ID and state-wise outward supply total to the Government in <strong>GSTR-8 Table 4B</strong>.
                    </span>
                  </div>
                </div>
              </div>

              {/* Government Filing Table */}
              <div
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '16px',
                  border: '1px solid #e2e8f0',
                  padding: '20px',
                  overflowX: 'auto',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12.5px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#334155', fontWeight: 800 }}>
                      <th style={{ padding: '10px 12px' }}>Seller / SHG & City</th>
                      <th style={{ padding: '10px 12px' }}>Tax Regime</th>
                      <th style={{ padding: '10px 12px' }}>GSTIN / Enrolment ID & PAN</th>
                      <th style={{ padding: '10px 12px' }}>FY Gross Sales & ₹5L Threshold</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>Net Taxable Value</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>GSTR-8 TCS (0.5%)</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>Sec 194-O TDS (0.1%)</th>
                      <th style={{ padding: '10px 12px' }}>Govt. Return Mapping</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSellers.map((seller) => {
                      const st = seller.statutoryTax;
                      const isGst = Boolean(st?.hasGst);
                      const idVal = isGst ? (st?.gstin || '23AAAAA0000A1Z5') : (st?.enrolmentId || 'ENR-MP-470661-0012');
                      const panVal = st?.panNumber || 'ABCDE1234F';
                      const rawFy = st?.fyGrossSalesPaise ?? seller.grossSalesPaise;
                      const effectiveFy = simulateAbove5Lakh ? Math.max(rawFy, 54_500_000) : rawFy;
                      const isAbove5L = effectiveFy > 50_000_000;
                      const pct = Math.min(100, Math.round((effectiveFy / 50_000_000) * 1000) / 10);
                      const taxablePaise = st?.taxableSalesPaise ?? seller.grossSalesPaise;
                      const tcsPaise = isGst ? (seller.tcsDeductionPaise ?? st?.tcsTotalPaise ?? Math.round(taxablePaise * 0.005)) : 0;
                      const tdsPaise = isAbove5L
                        ? Math.max(seller.tdsDeductionPaise ?? 0, Math.round(effectiveFy * 0.001))
                        : 0;

                      return (
                        <tr key={seller.sellerId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '12px' }}>
                            <strong style={{ color: '#0f172a', display: 'block' }}>{seller.sellerName}</strong>
                            <span style={{ fontSize: '11px', color: '#64748b' }}>
                              {seller.representative} · 📍 {seller.city}
                            </span>
                          </td>
                          <td style={{ padding: '12px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '3px 8px',
                                borderRadius: '999px',
                                fontSize: '11px',
                                fontWeight: 800,
                                backgroundColor: isGst ? '#dbeafe' : '#dcfce7',
                                color: isGst ? '#1e40af' : '#166534',
                              }}
                            >
                              {isGst ? 'GSTIN Regular' : 'Enrolment ID (Sec 24)'}
                            </span>
                          </td>
                          <td style={{ padding: '12px', fontFamily: 'monospace' }}>
                            <div style={{ fontWeight: 800, color: '#0f172a' }}>
                              {isGst ? 'GSTIN: ' : 'ENR: '}{idVal}
                            </div>
                            <div style={{ fontSize: '11px', color: '#475569' }}>PAN: {panVal}</div>
                          </td>
                          <td style={{ padding: '12px', minWidth: '210px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', fontWeight: 700 }}>
                              <span>{formatRupees(effectiveFy)}</span>
                              <span style={{ color: isAbove5L ? '#7e22ce' : '#0369a1' }}>{pct}% of ₹5L</span>
                            </div>
                            <div style={{ width: '100%', height: '6px', backgroundColor: '#e2e8f0', borderRadius: '999px', margin: '4px 0', overflow: 'hidden' }}>
                              <div
                                style={{
                                  width: `${Math.max(4, pct)}%`,
                                  height: '100%',
                                  backgroundColor: isAbove5L ? '#9333ea' : '#0284c7',
                                }}
                              />
                            </div>
                            <span
                              style={{
                                fontSize: '10.5px',
                                fontWeight: 800,
                                color: isAbove5L ? '#7e22ce' : '#15803d',
                              }}
                            >
                              {isAbove5L ? '⚡ Above ₹5L — Deduct 0.1% TDS' : '✓ Below ₹5L — 0% TDS Exempt'}
                            </span>
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', fontWeight: 700 }}>
                            {formatRupees(taxablePaise)}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right' }}>
                            <strong style={{ color: isGst ? '#0369a1' : '#64748b' }}>
                              {isGst ? formatRupees(tcsPaise) : '₹0.00'}
                            </strong>
                            <div style={{ fontSize: '10px', color: '#64748b' }}>
                              {isGst ? '0.25% CGST + 0.25% SGST' : 'Exempt (Notif 34/2023)'}
                            </div>
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right' }}>
                            <strong style={{ color: isAbove5L ? '#7e22ce' : '#64748b' }}>
                              {isAbove5L ? formatRupees(tdsPaise) : '₹0.00'}
                            </strong>
                            <div style={{ fontSize: '10px', color: '#64748b' }}>
                              {isAbove5L ? '0.1% u/s 194-O' : '≤ ₹5L Proviso Exempt'}
                            </div>
                          </td>
                          <td style={{ padding: '12px', fontSize: '11px', color: '#334155' }}>
                            <div><strong>GST:</strong> {isGst ? 'GSTR-8 Table 3' : 'GSTR-8 Table 4B'}</div>
                            <div><strong>IT:</strong> {isAbove5L ? 'Form 26Q / 16A' : 'No TDS Required'}</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ASSISTED PAYOUT DRAWER / MODAL */}
      {payoutModalData && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '18px',
              maxWidth: '680px',
              width: '100%',
              maxHeight: '92vh',
              overflowY: 'auto',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.3)',
              padding: '28px 32px',
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#047857',
                    backgroundColor: '#ecfdf5',
                    padding: '3px 10px',
                    borderRadius: '9999px',
                  }}
                >
                  ASSISTED DISBURSEMENT DESK
                </span>
                <h2 style={{ fontSize: '20px', fontWeight: 800, margin: '6px 0 0 0', color: '#0f172a' }}>
                  Pay Beneficiary: {payoutModalData.name}
                </h2>
                <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>
                  Role: <strong>{payoutModalData.beneficiaryType.toUpperCase().replace('_', ' ')}</strong> · City: <strong>{payoutModalData.city}</strong> · Phone: {payoutModalData.phone}
                </div>
              </div>
              <button
                onClick={() => setPayoutModalData(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '20px',
                  color: '#64748b',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {/* 3-STEP EASY PAYMENT GUIDE */}
            <div
              style={{
                backgroundColor: '#f0f9ff',
                border: '1px solid #bae6fd',
                borderRadius: '12px',
                padding: '16px 20px',
                marginBottom: '18px',
              }}
            >
              <div style={{ fontWeight: 800, color: '#0369a1', fontSize: '13px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>📱</span> HOW TO PAY IN 3 EASY STEPS:
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', fontSize: '12px' }}>
                <div style={{ background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e0f2fe' }}>
                  <strong style={{ color: '#0284c7', display: 'block', marginBottom: '2px' }}>1. Open PhonePe / GPay</strong>
                  <span style={{ color: '#64748b' }}>Scan the QR code below on your mobile phone.</span>
                </div>
                <div style={{ background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e0f2fe' }}>
                  <strong style={{ color: '#0284c7', display: 'block', marginBottom: '2px' }}>2. Pay Locked Amount</strong>
                  <span style={{ color: '#64748b' }}>Transfer exact locked amount shown in green below.</span>
                </div>
                <div style={{ background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e0f2fe' }}>
                  <strong style={{ color: '#0284c7', display: 'block', marginBottom: '2px' }}>3. Confirm Settlement</strong>
                  <span style={{ color: '#64748b' }}>Paste the 12-digit UTR from receipt or click Auto-Generate.</span>
                </div>
              </div>
            </div>

            {/* STRICTLY LOCKED AMOUNT CARD */}
            <div
              style={{
                backgroundColor: '#ecfdf5',
                border: '2px solid #a7f3d0',
                borderRadius: '12px',
                padding: '18px 20px',
                marginBottom: '20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#047857' }}>
                  <span>🔒</span> NON-EDITABLE LOCKED PAYABLE AMOUNT
                </div>
                <div style={{ fontSize: '30px', fontWeight: 900, color: '#065f46', marginTop: '2px' }}>
                  {formatRupees(payoutModalData.netLockedPayablePaise)}
                </div>
                <div style={{ fontSize: '11px', color: '#047857' }}>
                  Computed after 5% platform deduction, city commissions & verified penalty adjustments.
                </div>
              </div>
              <button
                type="button"
                onClick={() => copyToClipboard((payoutModalData.netLockedPayablePaise / 100).toFixed(2), 'amount')}
                style={{
                  backgroundColor: '#047857',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 14px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {copiedField === 'amount' ? '✓ Copied Amount!' : 'Copy Amount'}
              </button>
            </div>

            {/* AUTO-FETCHED BANK & UPI DRAWER */}
            <div
              style={{
                backgroundColor: '#f8fafc',
                borderRadius: '12px',
                padding: '18px 20px',
                border: '1px solid #e2e8f0',
                marginBottom: '20px',
              }}
            >
              <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#1e293b', margin: '0 0 12px 0' }}>
                Auto-Fetched Beneficiary Bank Account
              </h4>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                <div style={{ background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Account Holder</span>
                  <strong style={{ fontSize: '13px', color: '#0f172a' }}>{payoutModalData.bankAccount.accountHolderName}</strong>
                </div>

                <div style={{ background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Account Number</span>
                    <strong style={{ fontSize: '13px', color: '#0f172a' }}>{payoutModalData.bankAccount.accountNumberMasked}</strong>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(payoutModalData.bankAccount.accountNumberMasked, 'acct')}
                    style={{ background: '#f1f5f9', border: 'none', padding: '4px 8px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                  >
                    {copiedField === 'acct' ? '✓' : 'Copy'}
                  </button>
                </div>

                <div style={{ background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>IFSC Code</span>
                    <strong style={{ fontSize: '13px', color: '#0f172a' }}>{payoutModalData.bankAccount.ifscCode}</strong>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(payoutModalData.bankAccount.ifscCode, 'ifsc')}
                    style={{ background: '#f1f5f9', border: 'none', padding: '4px 8px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                  >
                    {copiedField === 'ifsc' ? '✓' : 'Copy'}
                  </button>
                </div>

                <div style={{ background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>Bank Name</span>
                    <strong style={{ fontSize: '13px', color: '#0f172a' }}>{payoutModalData.bankAccount.bankName}</strong>
                  </div>
                </div>

                {payoutModalData.bankAccount.upiId && (
                  <div style={{ background: '#eff6ff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #bfdbfe', gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: '11px', color: '#1e40af', display: 'block', fontWeight: 600 }}>UPI VPA ID</span>
                      <strong style={{ fontSize: '14px', color: '#1e3a8a' }}>{payoutModalData.bankAccount.upiId}</strong>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(payoutModalData.bankAccount.upiId!, 'upi')}
                      style={{ background: '#1e40af', color: '#ffffff', border: 'none', padding: '5px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}
                    >
                      {copiedField === 'upi' ? '✓ Copied' : 'Copy UPI'}
                    </button>
                  </div>
                )}
              </div>

              {/* DYNAMIC UPI INTENT & QR CODE PAYMENT SECTION */}
              {payoutModalData.bankAccount.upiId ? (
                <div
                  style={{
                    marginTop: '16px',
                    backgroundColor: '#ffffff',
                    borderRadius: '10px',
                    padding: '16px',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '20px',
                    flexWrap: 'wrap',
                  }}
                >
                  {/* Dynamic QR Code for PhonePe/GPay/Paytm */}
                  {(() => {
                    const upiString = `upi://pay?pa=${encodeURIComponent(payoutModalData.bankAccount.upiId!)}&pn=${encodeURIComponent(payoutModalData.name)}&am=${(payoutModalData.netLockedPayablePaise / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(`eSakhi-${payoutModalData.city}`)}`;
                    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(upiString)}`;
                    return (
                      <div style={{ textAlign: 'center' }}>
                        <img
                          src={qrUrl}
                          alt="Scan to Pay via UPI"
                          style={{ width: '110px', height: '110px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                        />
                        <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px', fontWeight: 600 }}>
                          Scan with PhonePe / GPay
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b' }}>
                      Fast Direct UPI Payment
                    </div>
                    <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 10px 0', lineHeight: 1.4 }}>
                      Scan the QR code directly from your mobile banking app, or click below to launch UPI intent directly with the locked amount:
                    </p>
                    <a
                      href={`upi://pay?pa=${encodeURIComponent(payoutModalData.bankAccount.upiId)}&pn=${encodeURIComponent(payoutModalData.name)}&am=${(payoutModalData.netLockedPayablePaise / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(`eSakhi-${payoutModalData.city}`)}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        backgroundColor: '#4f46e5',
                        color: '#ffffff',
                        padding: '8px 16px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontWeight: 700,
                        textDecoration: 'none',
                      }}
                    >
                      ⚡ Open in UPI App ({formatRupees(payoutModalData.netLockedPayablePaise)})
                    </a>
                  </div>
                </div>
              ) : payoutModalData.bankAccount.accountNumberMasked !== 'PENDING_REGISTRATION' ? (
                <div
                  style={{
                    marginTop: '16px',
                    backgroundColor: '#ffffff',
                    borderRadius: '10px',
                    padding: '14px 18px',
                    border: '1px solid #cbd5e1',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <span style={{ fontSize: '24px' }}>🏦</span>
                  <div>
                    <strong style={{ fontSize: '13px', color: '#1e293b', display: 'block' }}>Direct Bank Transfer Mode (IMPS / NEFT)</strong>
                    <span style={{ fontSize: '12px', color: '#64748b', lineHeight: 1.4 }}>
                      Beneficiary has not registered a UPI handle. Use the copy buttons above to transfer the locked amount directly to their bank account via Netbanking/IMPS.
                    </span>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    marginTop: '16px',
                    backgroundColor: '#fef2f2',
                    borderRadius: '10px',
                    padding: '14px 18px',
                    border: '2px solid #ef4444',
                    color: '#991b1b',
                    fontSize: '13px',
                    fontWeight: 700,
                  }}
                >
                  ⚠️ Banking coordinates not linked for this beneficiary. You must enter their real bank account details before settling payouts.
                </div>
              )}
            </div>

            {/* DISBURSEMENT RECORDING FORM */}
            <form onSubmit={handleDisbursementSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                    Payment Channel
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as 'upi_intent' | 'bank_transfer' | 'razorpay_manual')}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      fontWeight: 600,
                    }}
                  >
                    <option value="upi_intent">UPI / PhonePe / GPay / Paytm</option>
                    <option value="bank_transfer">Direct IMPS / NEFT Bank Transfer</option>
                    <option value="razorpay_manual">Razorpay Manual Payout</option>
                  </select>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>
                      Official Bank UTR / 12-Digit UPI Ref Number *
                    </label>
                    <span
                      style={{
                        background: '#f1f5f9',
                        color: '#475569',
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        padding: '2px 8px',
                        fontSize: '11px',
                        fontWeight: 700,
                      }}
                    >
                      🔒 Bank Receipt Record
                    </span>
                  </div>
                  <input
                    required
                    type="text"
                    value={utrReference}
                    onChange={(e) => setUtrReference(e.target.value.trim())}
                    placeholder="Enter 12-digit UTR from PhonePe / GPay / NetBanking"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: utrReference.includes('@')
                        ? '2px solid #ef4444'
                        : utrReference.length >= 6
                        ? '1px solid #10b981'
                        : '1px solid #cbd5e1',
                      fontSize: '13px',
                      fontFamily: 'monospace',
                    }}
                  />
                  {utrReference.includes('@') ? (
                    <div style={{ fontSize: '11px', color: '#991b1b', marginTop: '4px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', padding: '6px 10px', borderRadius: '6px', fontWeight: 600 }}>
                      ❌ You typed a UPI ID address ('{utrReference}'). Please enter the actual 12-digit transaction number from your banking receipt.
                    </div>
                  ) : utrReference.length > 0 && utrReference.length < 6 ? (
                    <div style={{ fontSize: '11px', color: '#b45309', marginTop: '4px' }}>
                      ⚠️ UTR must be at least 6 characters (UPI UTRs are 12 digits, e.g. 412345678901).
                    </div>
                  ) : utrReference.length >= 6 ? (
                    <div style={{ fontSize: '11px', color: '#047857', marginTop: '4px', fontWeight: 600 }}>
                      ✓ Valid transaction reference format
                    </div>
                  ) : null}
                </div>
              </div>

              {/* WHAT IS UTR EXPLAINER */}
              <div
                style={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '12px 16px',
                  marginBottom: '16px',
                  fontSize: '12px',
                  color: '#475569',
                }}
              >
                <strong style={{ color: '#1e293b', display: 'block', marginBottom: '4px' }}>
                  ❓ What is a UTR and where do I find it?
                </strong>
                <span>
                  After paying via your UPI app, the success receipt displays a 12-digit number:
                </span>
                <ul style={{ margin: '6px 0 0 0', paddingLeft: '18px', lineHeight: 1.5 }}>
                  <li>In <strong>PhonePe</strong>: Labeled as <strong>UTR</strong> (e.g. <code>412384759201</code>)</li>
                  <li>In <strong>Google Pay (GPay)</strong>: Labeled as <strong>UPI transaction ID</strong></li>
                  <li>In <strong>Paytm</strong>: Labeled as <strong>UPI Ref No.</strong></li>
                  <li>In <strong>NetBanking</strong>: Labeled as <strong>IMPS / UTR Ref No.</strong></li>
                </ul>
                <div style={{ marginTop: '8px', fontSize: '11px', color: '#047857', backgroundColor: '#ecfdf5', padding: '8px 12px', borderRadius: '6px', border: '1px solid #a7f3d0', fontWeight: 600 }}>
                  🛡️ <strong>Double-Entry Banking Protection:</strong> Each settlement requires a real transaction reference. The database checks every UTR to ensure no duplicate or reused receipts can ever be submitted.
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Audit Notes / Month Reference (Optional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. November 2026 Monthly Settlement Batch"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                  }}
                />
              </div>

              {/* MANDATORY SECURITY CERTIFICATION CHECKBOX */}
              <div
                style={{
                  marginBottom: '20px',
                  backgroundColor: auditCertified ? '#f0fdf4' : '#fffbeb',
                  border: auditCertified ? '1px solid #86efac' : '1px solid #fde68a',
                  borderRadius: '10px',
                  padding: '12px 16px',
                  transition: 'background-color 0.2s ease',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', fontSize: '12px', color: auditCertified ? '#166534' : '#92400e', fontWeight: 600, lineHeight: 1.4 }}>
                  <input
                    type="checkbox"
                    checked={auditCertified}
                    onChange={(e) => setAuditCertified(e.target.checked)}
                    style={{ marginTop: '2px', width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <span>
                    I certify under audit liability that {formatRupees(payoutModalData.netLockedPayablePaise)} has been transferred directly to {payoutModalData.name} ({payoutModalData.bankAccount.bankName} / {payoutModalData.bankAccount.upiId || payoutModalData.bankAccount.accountNumberMasked}) and this UTR matches the authentic bank statement.
                  </span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setPayoutModalData(null);
                    setAuditCertified(false);
                  }}
                  style={{
                    padding: '10px 18px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#475569',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processingDisbursement || utrReference.trim().length < 6 || utrReference.includes('@') || !auditCertified || payoutModalData.bankAccount.accountNumberMasked === 'PENDING_REGISTRATION'}
                  style={{
                    padding: '10px 24px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: (processingDisbursement || utrReference.trim().length < 6 || utrReference.includes('@') || !auditCertified || payoutModalData.bankAccount.accountNumberMasked === 'PENDING_REGISTRATION') ? '#94a3b8' : '#059669',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: (processingDisbursement || utrReference.trim().length < 6 || utrReference.includes('@') || !auditCertified || payoutModalData.bankAccount.accountNumberMasked === 'PENDING_REGISTRATION') ? 'not-allowed' : 'pointer',
                  }}
                >
                  {processingDisbursement ? 'Recording Settlement…' : `✓ Settle Verified Payment (${formatRupees(payoutModalData.netLockedPayablePaise)})`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// ----------------------------------------------------------------------
// 3. City Admin "Raise Ticket to Super Admin" Modal / Panel
// ----------------------------------------------------------------------

export const CityAdminRaiseTicketModal: React.FC<{ isOpen: boolean; onClose: () => void; onSubmitted?: () => void }> = ({
  isOpen,
  onClose,
  onSubmitted,
}) => {
  const [category, setCategory] = useState('seller_dispute');
  const [priority, setPriority] = useState('medium');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [relatedOrderReference, setRelatedOrderReference] = useState('');
  const [relatedPartyType, setRelatedPartyType] = useState<'seller' | 'delivery_partner' | 'customer'>('seller');
  const [relatedPartyName, setRelatedPartyName] = useState('');
  const [relatedPartyPhone, setRelatedPartyPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successTicket, setSuccessTicket] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const ticket = await api.createCityAdminSupportTicket({
        category,
        priority,
        subject: subject.trim(),
        description: description.trim(),
        ...(relatedOrderReference.trim() ? { relatedOrderReference: relatedOrderReference.trim().toUpperCase() } : {}),
        ...(relatedPartyName.trim()
          ? {
              relatedParty: {
                partyType: relatedPartyType,
                name: relatedPartyName.trim(),
                phoneE164: relatedPartyPhone.trim() || undefined,
              },
            }
          : {}),
      });

      setSuccessTicket(ticket.ticketReference);
      setTimeout(() => {
        setSuccessTicket(null);
        onSubmitted?.();
        onClose();
      }, 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create support ticket.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px',
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          maxWidth: '600px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '28px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#4338ca', backgroundColor: '#eef2ff', padding: '3px 8px', borderRadius: '6px' }}>
              CITY ADMIN ESCALATION DESK
            </span>
            <h2 style={{ fontSize: '19px', fontWeight: 800, margin: '6px 0 0 0', color: '#0f172a' }}>
              Raise Ticket / Dispute to Super Admin
            </h2>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '4px 0 0 0' }}>
              Direct line to Super Admin for area disputes, seller complaints, delivery transit damages, or payout questions.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '20px',
              color: '#64748b',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {successTicket ? (
          <div style={{ textAlign: 'center', padding: '30px 20px', backgroundColor: '#f0fdf4', borderRadius: '12px', color: '#166534' }}>
            <div style={{ fontSize: '36px', marginBottom: '8px' }}>✓</div>
            <h3 style={{ fontSize: '17px', fontWeight: 800, margin: '0 0 6px 0' }}>Escalation Ticket Submitted!</h3>
            <p style={{ fontSize: '13px', margin: 0 }}>
              Reference Number: <strong>{successTicket}</strong>. Super Admin has been notified and will review your escalation.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Issue Category *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                >
                  <option value="seller_dispute">Artisan Seller Dispute</option>
                  <option value="delivery_dispute">Delivery Partner Dispute</option>
                  <option value="customer_claim">Customer Return Claim</option>
                  <option value="payout_query">Payout / Salary Query</option>
                  <option value="policy_help">Policy Exception Help</option>
                  <option value="other">Other Matter</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Urgency / Priority *
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                >
                  <option value="medium">Medium Priority</option>
                  <option value="high">High Priority</option>
                  <option value="critical">Critical (Customer blocked / urgent)</option>
                  <option value="low">Low Priority</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                Subject / Brief Title *
              </label>
              <input
                required
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Seller refusing damaged return arbitration in Damoh ward 4"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                }}
              />
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                Detailed Description & Context *
              </label>
              <textarea
                required
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Explain the background, attempts made locally, and what specific action or decision you need from Super Admin..."
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  lineHeight: 1.5,
                  fontFamily: 'inherit',
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '20px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Related Order Ref
                </label>
                <input
                  type="text"
                  value={relatedOrderReference}
                  onChange={(e) => setRelatedOrderReference(e.target.value)}
                  placeholder="e.g. ES-202611..."
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Involved Party Role
                </label>
                <select
                  value={relatedPartyType}
                  onChange={(e) => setRelatedPartyType(e.target.value as 'seller' | 'delivery_partner' | 'customer')}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                  }}
                >
                  <option value="seller">Seller / Artisan</option>
                  <option value="delivery_partner">Delivery Partner</option>
                  <option value="customer">Customer</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Party Name / Phone
                </label>
                <input
                  type="text"
                  value={relatedPartyName}
                  onChange={(e) => {
                    setRelatedPartyName(e.target.value);
                    setRelatedPartyPhone(e.target.value);
                  }}
                  placeholder="e.g. Ramesh (+9198...)"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  color: '#475569',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !subject.trim() || !description.trim()}
                style={{
                  padding: '10px 24px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#4338ca',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? 'Submitting…' : 'Submit Ticket to Super Admin'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
