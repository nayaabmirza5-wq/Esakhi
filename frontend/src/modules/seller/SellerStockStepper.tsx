import { useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../api';

interface SellerStockStepperProps {
  productId: string;
  variantId?: string;
  productName: string;
  currentStock: number;
  lowStockThreshold?: number;
  onStockUpdated: () => void;
  compact?: boolean;
}

export function SellerStockStepper({
  productId,
  variantId,
  productName,
  currentStock,
  lowStockThreshold = 5,
  onStockUpdated,
  compact = false,
}: SellerStockStepperProps): ReactNode {
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isOutOfStock = currentStock <= 0;
  const isLowStock = !isOutOfStock && currentStock <= lowStockThreshold;

  const handleAdjust = async (quantityChange: number, reason: string) => {
    if (loading || quantityChange === 0) return;
    setLoading(true);
    setError(null);
    setFeedback(null);
    try {
      await api.adjustSellerInventory(productId, {
        quantityChange,
        reason,
        ...(variantId ? { variantId } : {}),
      });
      const changeSign = quantityChange > 0 ? `+${quantityChange}` : `${quantityChange}`;
      setFeedback(`✓ ${changeSign} units updated successfully`);
      setTimeout(() => setFeedback(null), 3000);
      onStockUpdated();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not update stock';
      setError(msg);
      setTimeout(() => setError(null), 4500);
    } finally {
      setLoading(false);
    }
  };

  const toggleOutOfStock = async () => {
    if (isOutOfStock) {
      await handleAdjust(10, 'Restocked +10 units by seller');
    } else {
      await handleAdjust(-currentStock, 'Temporarily marked out of stock by seller');
    }
  };

  if (compact) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
        <button
          type="button"
          disabled={loading || currentStock <= 0}
          onClick={() => handleAdjust(-1, 'Deducted 1 unit (-1)')}
          title="Decrease 1 unit"
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            border: '1px solid #cbd5e1',
            background: '#ffffff',
            cursor: currentStock <= 0 ? 'not-allowed' : 'pointer',
            fontWeight: 800,
            fontSize: '1rem',
            lineHeight: 1,
            color: '#334155',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          −
        </button>
        <span
          style={{
            fontFamily: 'monospace',
            fontWeight: 700,
            fontSize: '0.95rem',
            minWidth: '32px',
            textAlign: 'center',
            color: isOutOfStock ? '#dc2626' : isLowStock ? '#d97706' : '#15803d',
          }}
        >
          {currentStock}
        </span>
        <button
          type="button"
          disabled={loading}
          onClick={() => handleAdjust(1, 'Added 1 unit (+1)')}
          title="Increase 1 unit"
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            border: '1px solid #cbd5e1',
            background: '#ffffff',
            cursor: 'pointer',
            fontWeight: 800,
            fontSize: '1rem',
            lineHeight: 1,
            color: '#334155',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          +
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '0.85rem 1rem',
        borderRadius: '12px',
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        display: 'grid',
        gap: '0.65rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>
            📦 Quick Stock Adjuster
          </span>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
            Tap <kbd style={{ padding: '0.1rem 0.35rem', background: '#e2e8f0', borderRadius: '4px' }}>+</kbd> or <kbd style={{ padding: '0.1rem 0.35rem', background: '#e2e8f0', borderRadius: '4px' }}>−</kbd> to adjust single units or choose a restock batch preset:
          </div>
        </div>

        <span
          style={{
            fontSize: '0.78rem',
            fontWeight: 700,
            padding: '0.25rem 0.65rem',
            borderRadius: '999px',
            background: isOutOfStock ? '#fee2e2' : isLowStock ? '#fef3c7' : '#dcfce7',
            color: isOutOfStock ? '#991b1b' : isLowStock ? '#92400e' : '#166534',
            border: `1px solid ${isOutOfStock ? '#fca5a5' : isLowStock ? '#fcd34d' : '#86efac'}`,
          }}
        >
          {isOutOfStock ? '● Out of Stock' : isLowStock ? `▲ Low Stock (${currentStock} remaining)` : `✓ In Stock (${currentStock} available)`}
        </span>
      </div>

      {feedback && (
        <div style={{ fontSize: '0.78rem', color: '#15803d', fontWeight: 700 }}>{feedback}</div>
      )}
      {error && (
        <div style={{ fontSize: '0.78rem', color: '#dc2626', fontWeight: 600 }}>⚠ {error}</div>
      )}

      {/* Primary Stepper Row & Batch Pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.55rem' }}>
        {/* Visual Stepper */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            background: '#ffffff',
            borderRadius: '8px',
            border: '1.5px solid #cbd5e1',
            padding: '2px',
          }}
        >
          <button
            type="button"
            disabled={loading || currentStock <= 0}
            onClick={() => handleAdjust(-1, `Deducted 1 unit from ${productName}`)}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              border: 'none',
              background: '#f1f5f9',
              cursor: currentStock <= 0 ? 'not-allowed' : 'pointer',
              fontWeight: 800,
              fontSize: '1.1rem',
              color: '#334155',
            }}
            title="Deduct 1 unit"
          >
            −
          </button>
          <span
            style={{
              minWidth: '48px',
              textAlign: 'center',
              fontWeight: 800,
              fontSize: '1rem',
              fontFamily: 'monospace',
              color: isOutOfStock ? '#dc2626' : '#0f172a',
            }}
          >
            {loading ? '…' : currentStock}
          </span>
          <button
            type="button"
            disabled={loading}
            onClick={() => handleAdjust(1, `Added 1 unit to ${productName}`)}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              border: 'none',
              background: '#f1f5f9',
              cursor: 'pointer',
              fontWeight: 800,
              fontSize: '1.1rem',
              color: '#334155',
            }}
            title="Add 1 unit"
          >
            +
          </button>
        </div>

        {/* Batch Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
          {[5, 10, 25, 50].map((batch) => (
            <button
              key={batch}
              type="button"
              disabled={loading}
              onClick={() => handleAdjust(batch, `Batch restock +${batch} units to ${productName}`)}
              style={{
                fontSize: '0.78rem',
                fontWeight: 700,
                padding: '0.35rem 0.65rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#475569',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#6b215c';
                e.currentTarget.style.color = '#6b215c';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#cbd5e1';
                e.currentTarget.style.color = '#475569';
              }}
            >
              +{batch}
            </button>
          ))}
        </div>

        {/* 1-Tap Out of Stock Toggle */}
        <button
          type="button"
          disabled={loading}
          onClick={toggleOutOfStock}
          style={{
            marginLeft: 'auto',
            fontSize: '0.78rem',
            fontWeight: 700,
            padding: '0.35rem 0.85rem',
            borderRadius: '8px',
            border: isOutOfStock ? '1px solid #16a34a' : '1px solid #dc2626',
            background: isOutOfStock ? '#f0fdf4' : '#fef2f2',
            color: isOutOfStock ? '#166534' : '#991b1b',
            cursor: 'pointer',
          }}
        >
          {isOutOfStock ? '↻ Restock (+10 units)' : '✕ Mark Out of Stock'}
        </button>
      </div>
    </div>
  );
}
