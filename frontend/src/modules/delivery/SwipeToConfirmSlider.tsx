import React, { useState, useRef, useEffect, useCallback } from 'react';

interface SwipeToConfirmSliderProps {
  label: string;
  confirmLabel?: string;
  themeColor?: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
}

export const SwipeToConfirmSlider: React.FC<SwipeToConfirmSliderProps> = ({
  label,
  confirmLabel = 'Confirmed!',
  themeColor = '#4A0E4E',
  onConfirm,
  disabled = false,
}) => {
  const [sliderPosition, setSliderPosition] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);

  const handleConfirm = useCallback(async () => {
    setIsConfirmed(true);
    setLoading(true);
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate([40, 60, 40]);
      } catch {
        // Ignore vibration permission issues
      }
    }
    try {
      await onConfirm();
    } finally {
      setLoading(false);
      setTimeout(() => {
        setIsConfirmed(false);
        setSliderPosition(0);
      }, 1500);
    }
  }, [onConfirm]);

  const onStartDrag = (clientX: number) => {
    if (disabled || isConfirmed || loading) return;
    setIsDragging(true);
    startXRef.current = clientX - sliderPosition;
  };

  const onMoveDrag = useCallback((clientX: number) => {
    if (!isDragging || !trackRef.current || isConfirmed || loading) return;
    const trackWidth = trackRef.current.offsetWidth;
    const handleWidth = 56;
    const maxDrag = Math.max(0, trackWidth - handleWidth);
    const newPos = Math.min(maxDrag, Math.max(0, clientX - startXRef.current));
    setSliderPosition(newPos);

    // If dragged >= 85% of track width, trigger confirmation
    if (newPos >= maxDrag * 0.85) {
      setIsDragging(false);
      setSliderPosition(maxDrag);
      void handleConfirm();
    }
  }, [handleConfirm, isConfirmed, isDragging, loading]);

  const onEndDrag = useCallback(() => {
    if (!isDragging || isConfirmed) return;
    setIsDragging(false);
    // Snap back to origin if not confirmed
    setSliderPosition(0);
  }, [isConfirmed, isDragging]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => onMoveDrag(e.clientX);
    const handleMouseUp = () => onEndDrag();
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) onMoveDrag(e.touches[0].clientX);
    };
    const handleTouchEnd = () => onEndDrag();

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove, { passive: true });
      window.addEventListener('touchend', handleTouchEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, onMoveDrag, onEndDrag]);

  const progressPercent = trackRef.current
    ? Math.min(100, Math.max(0, (sliderPosition / (trackRef.current.offsetWidth - 56)) * 100))
    : 0;

  return (
    <div
      ref={trackRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '56px',
        backgroundColor: '#f1f5f9',
        borderRadius: '28px',
        overflow: 'hidden',
        userSelect: 'none',
        border: `2px solid ${isConfirmed ? '#16a34a' : themeColor}`,
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.06)',
      }}
      onClick={() => {
        // Desktop click-to-confirm fallback for accessibility
        if (!disabled && !isConfirmed && !loading && !isDragging) {
          void handleConfirm();
        }
      }}
    >
      {/* Background fill based on drag progress */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: '100%',
          width: `${progressPercent}%`,
          backgroundColor: isConfirmed ? '#16a34a' : themeColor,
          opacity: 0.18,
          transition: isDragging ? 'none' : 'width 0.3s ease',
        }}
      />

      {/* Label Text Centered */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: '0.88rem',
          color: isConfirmed ? '#15803d' : '#1e293b',
          letterSpacing: '0.02em',
          pointerEvents: 'none',
          paddingLeft: '40px',
        }}
      >
        {loading ? 'Processing...' : isConfirmed ? `✓ ${confirmLabel}` : `${label} ➔`}
      </div>

      {/* Draggable Knob */}
      <div
        style={{
          position: 'absolute',
          top: '3px',
          left: '3px',
          width: '46px',
          height: '46px',
          borderRadius: '23px',
          backgroundColor: isConfirmed ? '#16a34a' : themeColor,
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 800,
          fontSize: '1.1rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          transform: `translateX(${sliderPosition}px)`,
          transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
          cursor: isDragging ? 'grabbing' : 'grab',
          zIndex: 2,
        }}
        onMouseDown={(e) => onStartDrag(e.clientX)}
        onTouchStart={(e) => {
          if (e.touches[0]) onStartDrag(e.touches[0].clientX);
        }}
      >
        {loading ? '⏳' : isConfirmed ? '✓' : '➔'}
      </div>
    </div>
  );
};
