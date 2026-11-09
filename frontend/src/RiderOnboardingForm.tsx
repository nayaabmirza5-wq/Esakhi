import { useState, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api';
import type { User, DeliveryPartnerRecord } from './types';
import { ContactOtpVerification } from './ContactOtpVerification';

interface RiderOnboardingFormProps {
  user?: User | null;
  setSession?: (user: User, token: string) => void;
  onSubmitted?: (partner: DeliveryPartnerRecord) => void;
}

export function RiderOnboardingForm({
  user,
  setSession,
  onSubmitted,
}: RiderOnboardingFormProps): ReactNode {
  // Activated Partner state (post-auto-activation)
  const [activatedPartner, setActivatedPartner] = useState<DeliveryPartnerRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 1. Personal Details
  const [fullName, setFullName] = useState(user?.name || '');
  const [phone, setPhone] = useState(() => {
    const raw = user?.phoneE164 || user?.phone || '';
    return raw.replace(/\D/g, '').slice(-10);
  });
  const [email, setEmail] = useState(user?.email || '');
  const [isPhoneVerified, setIsPhoneVerified] = useState(() => {
    const raw = user?.phoneE164 || user?.phone || '';
    const digits = raw.replace(/\D/g, '').slice(-10);
    return Boolean(user && digits.length === 10);
  });
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [dob, setDob] = useState('1998-01-01');

  // 2. Vehicle Choice & Licensing
  const [vehicleType, setVehicleType] = useState<'CYCLE' | 'BIKE' | 'EV'>('CYCLE');
  const [dlNumber, setDlNumber] = useState('');
  const [rcNumber, setRcNumber] = useState('');

  // 3. KYC Details
  const [panNumber, setPanNumber] = useState('');
  const [aadharNumber, setAadharNumber] = useState('');

  // 4. Double-Entry Banking Details
  const [accountHolderName, setAccountHolderName] = useState(user?.name || '');
  const [accountNumber, setAccountNumber] = useState('');
  const [confirmAccountNumber, setConfirmAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [bankName, setBankName] = useState('');
  const [branchName, setBranchName] = useState('');

  // Auto Bank & Branch Lookup from RBI IFSC
  const handleIfscChange = (val: string) => {
    const code = val.toUpperCase().trim();
    setIfscCode(code);
    if (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code)) {
      if (code.startsWith('SBIN')) {
        setBankName('State Bank of India');
        setBranchName('Damoh Main Branch (Station Road)');
      } else if (code.startsWith('HDFC')) {
        setBankName('HDFC Bank Ltd');
        setBranchName('Damoh Branch (Civil Lines)');
      } else if (code.startsWith('BARB')) {
        setBankName('Bank of Baroda');
        setBranchName('Damoh Branch');
      } else if (code.startsWith('PUNB') || code.startsWith('PNBB')) {
        setBankName('Punjab National Bank');
        setBranchName('Damoh Branch');
      } else if (code.startsWith('CBIN')) {
        setBankName('Central Bank of India');
        setBranchName('Damoh Main Branch');
      } else if (code.startsWith('UBIN')) {
        setBankName('Union Bank of India');
        setBranchName('Damoh Branch');
      } else if (code.startsWith('ICIC')) {
        setBankName('ICICI Bank Ltd');
        setBranchName('Damoh Branch');
      } else {
        setBankName('Nationalized / Commercial Bank');
        setBranchName('Damoh Clearing Branch');
      }
    } else {
      setBankName('');
      setBranchName('');
    }
  };

  // Real-time Age Calculation
  const calculatedAge = useMemo(() => {
    if (!dob) return 0;
    const birthDate = new Date(dob);
    if (isNaN(birthDate.getTime())) return 0;
    const ageDiffMs = Date.now() - birthDate.getTime();
    const ageDate = new Date(ageDiffMs);
    return Math.abs(ageDate.getUTCFullYear() - 1970);
  }, [dob]);

  // Real-time validation checks
  const isPhoneValid = /^[6-9]\d{9}$/.test(phone);
  const isEmergencyValid = /^[6-9]\d{9}$/.test(emergencyPhone) && emergencyPhone !== phone;
  const isAgeValid = calculatedAge >= 18;
  const isPanValid = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panNumber.toUpperCase().trim());
  const isAadharValid = /^\d{12}$/.test(aadharNumber.trim());
  const isBankMatch = accountNumber.length >= 8 && accountNumber === confirmAccountNumber;
  const isIfscValid = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode.toUpperCase().trim());
  const isDlValid = vehicleType === 'CYCLE' || /^[A-Z]{2}[0-9]{2}[0-9]{11}$/.test(dlNumber.toUpperCase().trim());
  const isRcValid = vehicleType === 'CYCLE' || rcNumber.trim().length >= 5;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isPhoneValid) {
      setError('Please enter a valid 10-digit Indian mobile number starting with 6-9.');
      return;
    }

    if (!isPhoneVerified) {
      setError('Please verify your primary mobile number with OTP before submitting.');
      return;
    }

    if (!isEmergencyValid) {
      setError('Please enter a valid emergency phone number different from your primary phone.');
      return;
    }

    if (!isAgeValid) {
      setError('Delivery partner must be at least 18 years old.');
      return;
    }

    if (vehicleType !== 'CYCLE' && !isDlValid) {
      setError('Please enter a valid Driving License in Parivahan format (e.g. MP1520210001234).');
      return;
    }

    if (vehicleType !== 'CYCLE' && !isRcValid) {
      setError('Please enter a valid Vehicle Registration (RC) number.');
      return;
    }

    if (!isPanValid) {
      setError('Please enter a valid 10-character PAN number (e.g. ABCDE1234F).');
      return;
    }

    if (!isAadharValid) {
      setError('Please enter a valid 12-digit Aadhaar number.');
      return;
    }

    if (!isBankMatch) {
      setError('Bank Account numbers do not match in double-entry verification.');
      return;
    }

    if (!isIfscValid) {
      setError('Please enter a valid 11-character RBI IFSC code (e.g. SBIN0000358).');
      return;
    }

    setSubmitting(true);

    try {
      const payload = {
        fullName: fullName.trim(),
        phone: phone.trim(),
        emergencyPhone: emergencyPhone.trim(),
        dob,
        vehicleType,
        dlNumber: vehicleType !== 'CYCLE' ? dlNumber.trim().toUpperCase() : undefined,
        rcNumber: vehicleType !== 'CYCLE' ? rcNumber.trim().toUpperCase() : undefined,
        panNumber: panNumber.trim().toUpperCase(),
        aadharNumber: aadharNumber.trim(),
        bankDetails: {
          accountHolderName: accountHolderName.trim() || fullName.trim(),
          bankName: bankName || 'Nationalized Bank',
          branchName: branchName || 'Damoh Branch',
          accountNumber: accountNumber.trim(),
          confirmAccountNumber: confirmAccountNumber.trim(),
          ifscCode: ifscCode.trim().toUpperCase(),
        },
      };

      const res = await api.onboardDeliveryPartner(payload);

      // Elevate session role immediately in React auth state & localStorage
      if (setSession && res.user && res.accessToken) {
        setSession(res.user, res.accessToken);
      }

      setActivatedPartner(res.partner);
      onSubmitted?.(res.partner);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onboarding failed. Please review your details.');
    } finally {
      setSubmitting(false);
    }
  };

  // Celebration / Auto-Activated Confirmation Screen
  if (activatedPartner) {
    return (
      <div
        className="panel"
        style={{
          padding: '2.5rem',
          textAlign: 'center',
          background: 'linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)',
          border: '2px solid #16a34a',
          borderRadius: '16px',
          boxShadow: '0 10px 25px -5px rgba(22, 163, 74, 0.1)',
        }}
      >
        <div style={{ fontSize: '3.5rem', marginBottom: '0.75rem' }}>🎉🚴‍♂️</div>
        <span
          style={{
            display: 'inline-block',
            padding: '0.4rem 1.25rem',
            background: '#dcfce7',
            color: '#15803d',
            borderRadius: '999px',
            fontSize: '0.85rem',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Instant Auto-Activation Complete · Damoh Fleet
        </span>

        <h1 style={{ marginTop: '1rem', color: '#14532d', fontSize: '1.85rem', fontWeight: 800 }}>
          Welcome to the eSakhi Delivery Fleet!
        </h1>

        <p style={{ maxWidth: '580px', margin: '0.75rem auto 1.5rem', color: '#166534', fontSize: '1rem', lineHeight: 1.6 }}>
          Congratulations, <strong>{activatedPartner.personalDetails.fullName}</strong>! Your account has been instantly verified and auto-activated. No uniform, bag purchase, or security deposit is required.
        </p>

        {/* Partner ID Highlight Card */}
        <div
          style={{
            maxWidth: '460px',
            margin: '0 auto 1.5rem',
            padding: '1.25rem',
            background: '#ffffff',
            borderRadius: '12px',
            border: '2px dashed #16a34a',
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '1rem',
            textAlign: 'left',
          }}
        >
          <div>
            <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>
              Partner ID
            </span>
            <strong style={{ fontSize: '1.25rem', color: '#0f172a' }}>{activatedPartner.partnerId}</strong>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>
              Operating Unit
            </span>
            <strong style={{ fontSize: '1.1rem', color: '#0f172a' }}>{activatedPartner.operatingCity}</strong>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>
              Vehicle Mode
            </span>
            <strong style={{ fontSize: '1rem', color: '#0f172a' }}>{activatedPartner.vehicleDetails.vehicleType}</strong>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>
              Duty Switch (`isOnline`)
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#16a34a', fontWeight: 700 }}>
              <span style={{ height: '8px', width: '8px', borderRadius: '50%', background: '#16a34a' }} />
              ONLINE & ACTIVE
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <Link
            to="/delivery-partner"
            className="button"
            style={{
              background: '#16a34a',
              color: '#ffffff',
              fontWeight: 800,
              padding: '0.85rem 2rem',
              fontSize: '1rem',
              borderRadius: '10px',
              textDecoration: 'none',
              boxShadow: '0 4px 12px rgba(22, 163, 74, 0.25)',
            }}
          >
            Launch Delivery Partner Portal
          </Link>
          <Link to="/" className="button button-outline" style={{ borderRadius: '10px' }}>
            Back to Marketplace
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      className="panel stack-form"
      onSubmit={handleSubmit}
      style={{
        padding: '2rem',
        maxWidth: '820px',
        margin: '0 auto',
        borderRadius: '16px',
        boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
      }}
    >
      <div className="panel-heading" style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '1.25rem', marginBottom: '1.5rem' }}>
        <div>
          <span className="eyebrow" style={{ color: '#0284c7', fontWeight: 700 }}>
            Damoh City Logistics Network · Single Operating Unit
          </span>
          <h2 style={{ fontSize: '1.6rem', marginTop: '0.25rem' }}>
            Delivery Partner Registration & Instant Auto-Activation
          </h2>
          <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '0.35rem' }}>
            Get verified and activated in seconds. No zone restrictions, no uniform/bag deposits.
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span
            style={{
              display: 'inline-block',
              padding: '0.35rem 0.85rem',
              background: '#dcfce7',
              color: '#15803d',
              borderRadius: '999px',
              fontSize: '0.8rem',
              fontWeight: 800,
            }}
          >
            ⚡ Instant Auto-Activation
          </span>
        </div>
      </div>

      {/* No Deposit Callout Banner */}
      <div
        style={{
          padding: '1rem 1.25rem',
          background: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <span style={{ fontSize: '1.75rem' }}>🛡️</span>
        <div style={{ fontSize: '0.88rem', color: '#1e40af', lineHeight: 1.45 }}>
          <strong>Zero Security Deposits, Free Onboarding:</strong> eSakhi riders in Damoh do NOT pay for uniforms, bags, or deposit kits. Use your own cycle, bike, or smartphone and start delivering immediately.
        </div>
      </div>

      {error && (
        <div className="city-admin-error" role="alert" style={{ marginBottom: '1.25rem' }}>
          {error}
        </div>
      )}

      {/* 1. Personal Identity & Age */}
      <fieldset className="field" style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.5rem' }}>
        <legend style={{ fontWeight: 800, fontSize: '1rem', color: '#0f172a', padding: '0 0.5rem' }}>
          1. Personal Details & Contact Verification
        </legend>

        <div style={{ marginBottom: '1rem' }}>
          <label className="field" style={{ margin: 0 }}>
            <span>Full Legal Name (as per Bank / Aadhaar) *</span>
            <input
              required
              maxLength={120}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Mukesh Kumar Verma"
            />
          </label>
        </div>

        {/* Real-time Phone & Email Verification via OTP */}
        <ContactOtpVerification
          phone={phone}
          email={email}
          isVerified={isPhoneVerified}
          onPhoneChange={(val) => setPhone(val)}
          onEmailChange={(val) => setEmail(val)}
          onVerifiedChange={(verified) => setIsPhoneVerified(verified)}
          phoneLabel="Primary 10-Digit Mobile Number *"
          emailLabel="Email Address (Optional for receiving OTP)"
          showEmailOption={true}
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
          <label className="field">
            <span>Emergency Contact Mobile Number *</span>
            <div style={{ position: 'relative' }}>
              <input
                required
                type="tel"
                maxLength={10}
                value={emergencyPhone}
                onChange={(e) => setEmergencyPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="9414000000"
              />
              {emergencyPhone && (
                <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.85rem' }}>
                  {isEmergencyValid ? '✓' : '⚠️'}
                </span>
              )}
            </div>
            {emergencyPhone === phone && phone.length > 0 && (
              <small style={{ color: '#dc2626' }}>Emergency contact cannot be your own phone.</small>
            )}
          </label>

          <label className="field">
            <span>Date of Birth (Must be at least 18 years) *</span>
            <input
              required
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
            />
            {dob && (
              <small style={{ color: isAgeValid ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                {isAgeValid ? `✓ Age: ${calculatedAge} years (Eligible)` : `✗ Age: ${calculatedAge} years (Must be at least 18)`}
              </small>
            )}
          </label>
        </div>
      </fieldset>

      {/* 2. Vehicle Mode & Parivahan DL */}
      <fieldset className="field" style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.5rem' }}>
        <legend style={{ fontWeight: 800, fontSize: '1rem', color: '#0f172a', padding: '0 0.5rem' }}>
          2. Vehicle Selection & Parivahan License
        </legend>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
          <label
            style={{
              padding: '0.85rem',
              borderRadius: '10px',
              border: `2px solid ${vehicleType === 'CYCLE' ? '#16a34a' : '#cbd5e1'}`,
              background: vehicleType === 'CYCLE' ? '#f0fdf4' : '#ffffff',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            <input
              type="radio"
              name="vehicleType"
              checked={vehicleType === 'CYCLE'}
              onChange={() => setVehicleType('CYCLE')}
              style={{ display: 'none' }}
            />
            <div style={{ fontSize: '1.5rem' }}>🚲</div>
            <strong style={{ display: 'block', fontSize: '0.9rem', color: '#166534' }}>Bicycle / Cycle</strong>
            <small style={{ fontSize: '0.75rem', color: '#15803d', display: 'block', marginTop: '0.2rem' }}>
              ✓ DL & RC Waived
            </small>
          </label>

          <label
            style={{
              padding: '0.85rem',
              borderRadius: '10px',
              border: `2px solid ${vehicleType === 'BIKE' ? '#ea580c' : '#cbd5e1'}`,
              background: vehicleType === 'BIKE' ? '#fff7ed' : '#ffffff',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            <input
              type="radio"
              name="vehicleType"
              checked={vehicleType === 'BIKE'}
              onChange={() => setVehicleType('BIKE')}
              style={{ display: 'none' }}
            />
            <div style={{ fontSize: '1.5rem' }}>🏍️</div>
            <strong style={{ display: 'block', fontSize: '0.9rem', color: '#9a3412' }}>Motorcycle / Bike</strong>
            <small style={{ fontSize: '0.75rem', color: '#c2410c', display: 'block', marginTop: '0.2rem' }}>
              DL & RC Mandatory
            </small>
          </label>

          <label
            style={{
              padding: '0.85rem',
              borderRadius: '10px',
              border: `2px solid ${vehicleType === 'EV' ? '#0284c7' : '#cbd5e1'}`,
              background: vehicleType === 'EV' ? '#f0f9ff' : '#ffffff',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            <input
              type="radio"
              name="vehicleType"
              checked={vehicleType === 'EV'}
              onChange={() => setVehicleType('EV')}
              style={{ display: 'none' }}
            />
            <div style={{ fontSize: '1.5rem' }}>⚡</div>
            <strong style={{ display: 'block', fontSize: '0.9rem', color: '#0369a1' }}>Electric Bike / EV</strong>
            <small style={{ fontSize: '0.75rem', color: '#0284c7', display: 'block', marginTop: '0.2rem' }}>
              DL & RC Mandatory
            </small>
          </label>
        </div>

        {vehicleType === 'CYCLE' ? (
          <div style={{ padding: '0.75rem 1rem', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0', fontSize: '0.85rem', color: '#166534' }}>
            ✓ <strong>No Driving License or RC Required:</strong> Bicycle delivery partners are fully exempt from transport license requirements under eSakhi hyperlocal Damoh regulations.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '0.75rem' }}>
            <label className="field">
              <span>Driving License (Parivahan format) *</span>
              <input
                required
                value={dlNumber}
                onChange={(e) => setDlNumber(e.target.value.toUpperCase())}
                placeholder="e.g. MP1520210001234"
              />
              <small style={{ color: isDlValid ? '#16a34a' : '#64748b' }}>
                {isDlValid ? '✓ Parivahan format verified' : 'Format: State code (2) + RTO (2) + Year (4) + 7 digits'}
              </small>
            </label>

            <label className="field">
              <span>Vehicle Registration (RC) Number *</span>
              <input
                required
                value={rcNumber}
                onChange={(e) => setRcNumber(e.target.value.toUpperCase())}
                placeholder="e.g. MP15AB1234"
              />
              <small style={{ color: isRcValid ? '#16a34a' : '#64748b' }}>
                {isRcValid ? '✓ Vehicle RC verified' : 'Vehicle number plate registration'}
              </small>
            </label>
          </div>
        )}
      </fieldset>

      {/* 3. KYC Verification */}
      <fieldset className="field" style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.5rem' }}>
        <legend style={{ fontWeight: 800, fontSize: '1rem', color: '#0f172a', padding: '0 0.5rem' }}>
          3. Government KYC Verification
        </legend>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <label className="field">
            <span>Income Tax PAN Number (10 Characters) *</span>
            <div style={{ position: 'relative' }}>
              <input
                required
                maxLength={10}
                value={panNumber}
                onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                placeholder="ABCDE1234F"
              />
              {panNumber && (
                <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.85rem' }}>
                  {isPanValid ? '✓' : '⚠️'}
                </span>
              )}
            </div>
            <small style={{ color: isPanValid ? '#16a34a' : '#64748b' }}>
              {isPanValid ? '✓ Valid PAN format' : '5 letters + 4 digits + 1 letter'}
            </small>
          </label>

          <label className="field">
            <span>UIDAI Aadhaar Number (12 Digits) *</span>
            <div style={{ position: 'relative' }}>
              <input
                required
                maxLength={12}
                value={aadharNumber}
                onChange={(e) => setAadharNumber(e.target.value.replace(/\D/g, ''))}
                placeholder="123456789012"
              />
              {aadharNumber && (
                <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.85rem' }}>
                  {isAadharValid ? '✓' : '⚠️'}
                </span>
              )}
            </div>
            <small style={{ color: isAadharValid ? '#16a34a' : '#64748b' }}>
              {isAadharValid ? '✓ 12-digit Aadhaar verified' : '12-digit Indian Aadhaar number'}
            </small>
          </label>
        </div>
      </fieldset>

      {/* 4. Double-Entry Banking & RBI IFSC */}
      <fieldset className="field" style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.5rem' }}>
        <legend style={{ fontWeight: 800, fontSize: '1rem', color: '#0f172a', padding: '0 0.5rem' }}>
          4. Payout Bank Account (Double-Entry Verification)
        </legend>

        <label className="field" style={{ marginBottom: '1rem' }}>
          <span>Account Holder Name (as per Bank Passbook) *</span>
          <input
            required
            value={accountHolderName}
            onChange={(e) => setAccountHolderName(e.target.value)}
            placeholder="Mukesh Kumar Verma"
          />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <label className="field">
            <span>Bank Account Number *</span>
            <input
              required
              type="password"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
              placeholder="Enter account number"
            />
          </label>

          <label className="field">
            <span>Confirm Bank Account Number (Double-Entry) *</span>
            <input
              required
              type="text"
              value={confirmAccountNumber}
              onChange={(e) => setConfirmAccountNumber(e.target.value.replace(/\D/g, ''))}
              placeholder="Re-enter account number"
            />
          </label>
        </div>

        {confirmAccountNumber && (
          <div
            style={{
              marginTop: '0.5rem',
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: 700,
              background: isBankMatch ? '#ecfdf5' : '#fef2f2',
              color: isBankMatch ? '#065f46' : '#991b1b',
              border: `1px solid ${isBankMatch ? '#a7f3d0' : '#fecaca'}`,
            }}
          >
            {isBankMatch ? '✓ Bank Account numbers match perfectly' : '✗ Double-entry mismatch: Account numbers do not match'}
          </div>
        )}

        <div style={{ marginTop: '1rem' }}>
          <label className="field">
            <span>11-Character RBI IFSC Code *</span>
            <input
              required
              maxLength={11}
              value={ifscCode}
              onChange={(e) => handleIfscChange(e.target.value)}
              placeholder="e.g. SBIN0000358 or HDFC0001234"
            />
          </label>
        </div>

        {bankName && (
          <div
            style={{
              marginTop: '0.65rem',
              padding: '0.75rem 1rem',
              background: '#ecfdf5',
              borderRadius: '8px',
              border: '1px solid #6ee7b7',
              fontSize: '0.88rem',
              color: '#065f46',
            }}
          >
            🏛️ <strong>Auto-Detected Bank:</strong> {bankName} <br />
            📍 <strong>Clearing Branch:</strong> {branchName}
          </div>
        )}
      </fieldset>

      <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
        <button
          type="submit"
          className="button button-full"
          disabled={submitting || !isPhoneVerified}
          style={{
            background: isPhoneVerified ? '#16a34a' : '#94a3b8',
            color: '#ffffff',
            fontWeight: 800,
            padding: '1rem',
            fontSize: '1.05rem',
            borderRadius: '12px',
            border: 'none',
            cursor: submitting || !isPhoneVerified ? 'not-allowed' : 'pointer',
            boxShadow: isPhoneVerified ? '0 4px 14px rgba(22, 163, 74, 0.3)' : 'none',
            transition: 'all 0.2s ease',
          }}
        >
          {submitting
            ? 'Verifying & Activating Account...'
            : isPhoneVerified
            ? '⚡ Submit & Instant Auto-Activate Rider Profile'
            : '🔒 Verify Contact Phone via OTP to Submit'}
        </button>
        {!isPhoneVerified && (
          <p style={{ marginTop: '0.65rem', color: '#b45309', fontSize: '0.85rem', fontWeight: 600 }}>
            * Contact phone verification via OTP is required to submit the application and activate your profile.
          </p>
        )}
      </div>
    </form>
  );
}
