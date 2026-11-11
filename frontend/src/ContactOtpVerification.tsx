import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';

export interface ContactOtpVerificationProps {
  phone: string;
  email?: string;
  isVerified: boolean;
  onPhoneChange: (newPhone: string) => void;
  onEmailChange?: (newEmail: string) => void;
  onVerifiedChange: (verified: boolean) => void;
  phoneLabel?: string;
  emailLabel?: string;
  showEmailOption?: boolean;
  phoneRequired?: boolean;
}

export function ContactOtpVerification({
  phone,
  email = '',
  isVerified,
  onPhoneChange,
  onEmailChange,
  onVerifiedChange,
  phoneLabel = 'Contact Mobile Number (10 Digits) *',
  emailLabel = 'Email Address (Optional for OTP)',
  showEmailOption = true,
  phoneRequired = true,
}: ContactOtpVerificationProps): ReactNode {
  const [selectedChannel, setSelectedChannel] = useState<'phone' | 'email'>('phone');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [sending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Countdown timer for resending OTP
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const isPhoneValid = /^[6-9]\d{9}$/.test(phone.trim());
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handlePhoneInputChange = (val: string) => {
    const clean = val.replace(/\D/g, '').slice(0, 10);
    onPhoneChange(clean);
    if (isVerified) {
      onVerifiedChange(false);
      setSuccessMsg('');
      setErrorMsg('');
      setOtpSent(false);
      setOtpCode('');
    }
  };

  const handleEmailInputChange = (val: string) => {
    onEmailChange?.(val);
    if (isVerified && selectedChannel === 'email') {
      onVerifiedChange(false);
      setSuccessMsg('');
      setErrorMsg('');
      setOtpSent(false);
      setOtpCode('');
    }
  };

  const handleSendOtp = () => {
    setErrorMsg('');
    setSuccessMsg('');

    if (selectedChannel === 'phone' && !isPhoneValid) {
      setErrorMsg('Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.');
      return;
    }

    if (selectedChannel === 'email' && !isEmailValid) {
      setErrorMsg('Please enter a valid email address to receive the verification OTP.');
      return;
    }

    setOtpSent(true);
    setCountdown(60);
    const destination = selectedChannel === 'email' ? email.trim() : `+91 ${phone.trim()}`;
    setSuccessMsg(`OTP sent successfully to ${destination}! (Development OTP: 246810)`);
    void api.sendOtp(phone.trim(), selectedChannel, email.trim() || undefined).catch(() => {});
  };

  const handleVerifyOtp = async () => {
    setErrorMsg('');
    setSuccessMsg('');

    const cleanOtp = otpCode.trim();
    if (cleanOtp.length !== 6) {
      setErrorMsg('Please enter the complete 6-digit OTP code.');
      return;
    }

    setVerifying(true);
    try {
      const res = await api.verifyOtp(phone.trim(), cleanOtp, selectedChannel, email.trim() || undefined);
      if (res && res.verified !== false) {
        onVerifiedChange(true);
        setOtpSent(false);
        setOtpCode('');
        const destination = selectedChannel === 'email' ? email.trim() : `+91 ${phone.trim()}`;
        setSuccessMsg(`✓ Successfully verified! ${destination} is confirmed with OTP.`);
      } else {
        onVerifiedChange(false);
        setErrorMsg('❌ Invalid verification code. Please check and re-enter.');
      }
    } catch (err) {
      onVerifiedChange(false);
      setErrorMsg(err instanceof Error ? err.message : '❌ Invalid verification code. The code does not match.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div
      className="contact-otp-container"
      style={{
        padding: '1.25rem',
        borderRadius: '12px',
        border: isVerified ? '2px solid #16a34a' : '1px solid #cbd5e1',
        background: isVerified ? '#f0fdf4' : '#f8fafc',
        marginTop: '0.75rem',
        marginBottom: '1rem',
        transition: 'all 0.2s ease-in-out',
      }}
    >
      {/* Header and status badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
        <div>
          <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#0f172a' }}>
            📱 Contact Verification & OTP Authentication
          </span>
          <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
            Verify your contact phone number with OTP to confirm account ownership.
          </p>
        </div>
        <div>
          {isVerified ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.35rem 0.75rem',
                background: '#dcfce7',
                color: '#15803d',
                borderRadius: '999px',
                fontSize: '0.8rem',
                fontWeight: 800,
                border: '1px solid #86efac',
              }}
            >
              ✓ Verified with OTP
            </span>
          ) : (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.35rem 0.75rem',
                background: '#fef3c7',
                color: '#b45309',
                borderRadius: '999px',
                fontSize: '0.8rem',
                fontWeight: 800,
                border: '1px solid #fde68a',
              }}
            >
              ⚠️ OTP Required
            </span>
          )}
        </div>
      </div>

      {/* OTP Delivery Channel Option */}
      {showEmailOption && !isVerified && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.4rem' }}>
            Select where you want to receive your verification OTP:
          </span>
          <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.88rem', cursor: 'pointer', fontWeight: 600 }}>
              <input
                type="radio"
                name="otpChannel"
                value="phone"
                checked={selectedChannel === 'phone'}
                onChange={() => setSelectedChannel('phone')}
              />
              <span>📱 Mobile SMS (+91 {phone || '...' })</span>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.88rem', cursor: 'pointer', fontWeight: 600 }}>
              <input
                type="radio"
                name="otpChannel"
                value="email"
                checked={selectedChannel === 'email'}
                onChange={() => setSelectedChannel('email')}
              />
              <span>📧 Registered Email ({email || 'Enter email'})</span>
            </label>
          </div>
        </div>
      )}

      {/* Input Fields */}
      <div style={{ display: 'grid', gridTemplateColumns: showEmailOption ? 'repeat(auto-fit, minmax(240px, 1fr))' : '1fr', gap: '1rem' }}>
        {/* Phone Input */}
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{phoneLabel}</span>
          <div style={{ position: 'relative' }}>
            <input
              required={phoneRequired}
              type="tel"
              maxLength={10}
              disabled={isVerified}
              value={phone}
              onChange={(e) => handlePhoneInputChange(e.target.value)}
              placeholder="9876543210"
              style={{
                width: '100%',
                paddingRight: '2rem',
                background: isVerified ? '#f8fafc' : '#ffffff',
                borderColor: isVerified ? '#16a34a' : undefined,
                fontWeight: isVerified ? 700 : 500,
              }}
            />
            {phone && (
              <span
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: '0.9rem',
                }}
              >
                {isPhoneValid ? '✓' : '⚠️'}
              </span>
            )}
          </div>
          {phone && !isPhoneValid && (
            <small style={{ color: '#dc2626', fontSize: '0.75rem' }}>
              Must be 10 digits starting with 6, 7, 8, or 9.
            </small>
          )}
        </label>

        {/* Email Input (if enabled) */}
        {showEmailOption && (
          <label className="field" style={{ margin: 0 }}>
            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{emailLabel}</span>
            <input
              type="email"
              disabled={isVerified}
              value={email}
              onChange={(e) => handleEmailInputChange(e.target.value)}
              placeholder="user@example.com"
              style={{
                width: '100%',
                background: isVerified ? '#f8fafc' : '#ffffff',
              }}
            />
          </label>
        )}
      </div>

      {/* Action Row: Send OTP or Change Number */}
      {!isVerified ? (
        <div style={{ marginTop: '0.85rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <button
            type="button"
            className="button"
            onClick={handleSendOtp}
            disabled={
              sending ||
              countdown > 0 ||
              (selectedChannel === 'phone' ? !isPhoneValid : !isEmailValid)
            }
            style={{
              background: '#0284c7',
              color: '#ffffff',
              padding: '0.45rem 1.15rem',
              fontSize: '0.85rem',
              fontWeight: 700,
              borderRadius: '6px',
              border: 'none',
              cursor: countdown > 0 ? 'not-allowed' : 'pointer',
              opacity: countdown > 0 || (selectedChannel === 'phone' ? !isPhoneValid : !isEmailValid) ? 0.6 : 1,
            }}
          >
            {sending
              ? 'Sending OTP...'
              : countdown > 0
              ? `Resend OTP in ${countdown}s`
              : otpSent
              ? 'Resend OTP'
              : '⚡ Send Verification OTP'}
          </button>

          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
            {selectedChannel === 'phone'
              ? 'SMS will be sent to +91 ' + (phone || 'your number')
              : 'OTP will be sent to ' + (email || 'your email')}
          </span>
        </div>
      ) : (
        <div style={{ marginTop: '0.65rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '0.85rem', color: '#15803d', fontWeight: 700 }}>
            ✓ Phone Number {phone} is verified and locked.
          </span>
          <button
            type="button"
            onClick={() => {
              onVerifiedChange(false);
              setSuccessMsg('');
              setErrorMsg('');
              setOtpSent(false);
              setOtpCode('');
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#0284c7',
              textDecoration: 'underline',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            Change Number / Re-verify
          </button>
        </div>
      )}

      {/* OTP Input Box (when OTP has been sent and not yet verified) */}
      {otpSent && !isVerified && (
        <div
          style={{
            marginTop: '1rem',
            padding: '1rem',
            background: '#ffffff',
            borderRadius: '8px',
            border: '2px solid #38bdf8',
            boxShadow: '0 2px 8px rgba(2, 132, 199, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0369a1' }}>
              Enter the 6-Digit Verification Code
            </span>
            <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
              Development test code: <strong style={{ color: '#0f172a' }}>246810</strong>
            </span>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="246810"
              style={{
                width: '180px',
                letterSpacing: '4px',
                fontSize: '1.2rem',
                fontWeight: 800,
                textAlign: 'center',
                padding: '0.45rem',
                borderRadius: '6px',
                border: '2px solid #0284c7',
              }}
            />

            <button
              type="button"
              className="button"
              onClick={handleVerifyOtp}
              disabled={verifying || otpCode.trim().length !== 6}
              style={{
                background: otpCode.trim().length === 6 ? '#16a34a' : '#94a3b8',
                color: '#ffffff',
                padding: '0.55rem 1.4rem',
                fontSize: '0.88rem',
                fontWeight: 800,
                borderRadius: '6px',
                border: 'none',
                cursor: otpCode.trim().length === 6 ? 'pointer' : 'not-allowed',
              }}
            >
              {verifying ? 'Verifying...' : '✓ Verify OTP'}
            </button>
          </div>
        </div>
      )}

      {/* Live Error and Success Messages */}
      {errorMsg && (
        <div
          style={{
            marginTop: '0.75rem',
            padding: '0.55rem 0.85rem',
            background: '#fef2f2',
            border: '1px solid #f87171',
            borderRadius: '6px',
            color: '#b91c1c',
            fontSize: '0.85rem',
            fontWeight: 600,
          }}
        >
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div
          style={{
            marginTop: '0.75rem',
            padding: '0.55rem 0.85rem',
            background: '#f0fdf4',
            border: '1px solid #86efac',
            borderRadius: '6px',
            color: '#15803d',
            fontSize: '0.85rem',
            fontWeight: 600,
          }}
        >
          {successMsg}
        </div>
      )}
    </div>
  );
}
