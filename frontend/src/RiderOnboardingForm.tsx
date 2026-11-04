import { useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';

const SUBMITTED_STORAGE_KEY = 'esakhi.riderApplication.submitted';

export function RiderOnboardingForm({
  assignedCity = 'Jaipur',
  availableLocalities = [],
  onSubmitted,
}: {
  assignedCity?: string;
  availableLocalities?: string[];
  onSubmitted?: () => void;
}): ReactNode {
  const [submissionStatus, setSubmissionStatus] = useState<'IDLE' | 'SUBMITTING' | 'SUBMITTED'>(() => {
    try {
      return localStorage.getItem(SUBMITTED_STORAGE_KEY) ? 'SUBMITTED' : 'IDLE';
    } catch {
      return 'IDLE';
    }
  });
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Personal Biodata
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [selfieUrl, setSelfieUrl] = useState('');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyRel, setEmergencyRel] = useState('Family');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [residentialAddress, setResidentialAddress] = useState('');
  const [pincode, setPincode] = useState('');

  // Operational Hub & Localities
  const [selectedLocalities, setSelectedLocalities] = useState<string[]>(availableLocalities.slice(0, 3));

  const toggleLocality = (loc: string) => {
    setSelectedLocalities((prev) => (prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]));
  };

  // Dynamic Vehicle Selection ("No-DL" Rule)
  const [vehicleType, setVehicleType] = useState<'BICYCLE' | 'MOTORCYCLE'>('BICYCLE');
  const [govIdUrl, setGovIdUrl] = useState('');
  const [dlNumber, setDlNumber] = useState('');
  const [dlExpiryDate, setDlExpiryDate] = useState('');
  const [vehicleRcNumber, setVehicleRcNumber] = useState('');
  const [dlFrontUrl, setDlFrontUrl] = useState('');
  const [dlBackUrl, setDlBackUrl] = useState('');

  // Settlement & Double-Entry Banking
  const [accountNumber, setAccountNumber] = useState('');
  const [confirmAccount, setConfirmAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [bankName, setBankName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [upiVpa, setUpiVpa] = useState('');
  const [passbookDocUrl, setPassbookDocUrl] = useState('');

  // IFSC Auto-Lookup Simulation
  const handleIfscChange = (val: string) => {
    const code = val.toUpperCase().trim();
    setIfsc(code);
    if (code.length === 11) {
      if (code.startsWith('SBIN')) {
        setBankName('State Bank of India');
        setBranchName(`${assignedCity} Main Branch`);
      } else if (code.startsWith('HDFC')) {
        setBankName('HDFC Bank Ltd');
        setBranchName(`${assignedCity} City Center`);
      } else if (code.startsWith('BARB')) {
        setBankName('Bank of Baroda');
        setBranchName(`${assignedCity} Regional Hub`);
      } else {
        setBankName('Nationalized Bank');
        setBranchName('Branch Verified');
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, setter: (v: string) => void) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setter(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const isBankMatch = accountNumber.length >= 9 && accountNumber === confirmAccount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmissionStatus('SUBMITTING');

    if (!isBankMatch) {
      setError('Bank Account numbers do not match in double-entry verification.');
      setSubmissionStatus('IDLE');
      return;
    }

    if (vehicleType === 'MOTORCYCLE' && (!dlNumber || !dlExpiryDate || !vehicleRcNumber || !dlFrontUrl || !dlBackUrl)) {
      setError('Driving License Number, Expiry, Vehicle RC, and DL photos are strictly mandatory for two-wheelers.');
      setSubmissionStatus('IDLE');
      return;
    }

    try {
      const res = await api.submitDeliveryPartnerApplication({
        name: name.trim(),
        phone: phone.trim(),
        city: assignedCity,
        requestedLocalities: selectedLocalities.length ? selectedLocalities : [assignedCity],
        selfieUrl: selfieUrl || '/images/products/terracotta-diya.jpg',
        emergencyContactName: emergencyName.trim(),
        emergencyContactRel: emergencyRel,
        emergencyContactPhone: emergencyPhone.trim(),
        residentialAddress: residentialAddress.trim(),
        pincode: pincode.trim(),
        vehicleType,
        govIdUrl: vehicleType === 'BICYCLE' ? (govIdUrl || '/images/products/bamboo-tokri.jpg') : undefined,
        dlNumber: vehicleType === 'MOTORCYCLE' ? dlNumber.trim().toUpperCase() : undefined,
        dlExpiryDate: vehicleType === 'MOTORCYCLE' ? dlExpiryDate : undefined,
        vehicleRcNumber: vehicleType === 'MOTORCYCLE' ? vehicleRcNumber.trim().toUpperCase() : undefined,
        dlFrontUrl: vehicleType === 'MOTORCYCLE' ? dlFrontUrl : undefined,
        dlBackUrl: vehicleType === 'MOTORCYCLE' ? dlBackUrl : undefined,
        accountNumber: accountNumber.trim(),
        confirmAccountNumber: confirmAccount.trim(),
        ifscCode: ifsc.trim().toUpperCase(),
        bankName: bankName || 'Nationalized Bank',
        branchName: branchName || 'Main Branch',
        upiVpa: upiVpa.trim() || undefined,
        passbookDocUrl: passbookDocUrl || '/images/products/chanderi-silk-saree.jpg',
        applicantNote: `Rider registered for ${vehicleType} deliveries. Payout target: ${ifsc.trim().toUpperCase()}`,
      });

      setSuccessMessage(res.message);
      try {
        localStorage.setItem(SUBMITTED_STORAGE_KEY, new Date().toISOString());
      } catch {
        // Storage unavailable; banner still shows for this session.
      }
      setSubmissionStatus('SUBMITTED');
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit rider profile.');
      setSubmissionStatus('IDLE');
    }
  };

  if (submissionStatus === 'SUBMITTED') {
    return (
      <div className="panel" style={{ padding: '2rem', textAlign: 'center', background: '#fefce8', border: '2px solid #ca8a04' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⏳</div>
        <span style={{ display: 'inline-block', padding: '0.35rem 0.85rem', background: '#fef08a', color: '#854d0e', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase' }}>
          Profile Submitted - Under Physical Audit by City Admin
        </span>
        <h2 style={{ marginTop: '1rem', color: '#713f12' }}>Application Locked & Under City Admin Review</h2>
        <p style={{ maxWidth: '540px', margin: '0.5rem auto 1.5rem', color: '#854d0e', fontSize: '0.9rem', lineHeight: 1.5 }}>
          {successMessage || 'Your profile, vehicle documents, and bank details have been forwarded to the local operations team.'}
        </p>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.25rem', background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '0.85rem' }}>
          <span style={{ height: '10px', width: '10px', borderRadius: '50%', background: '#94a3b8' }} />
          <strong>Rider Duty Switch (`isOnline`): Hard-Locked OFFLINE</strong>
        </div>
      </div>
    );
  }

  return (
    <form className="panel stack-form" onSubmit={handleSubmit} style={{ padding: '1.75rem', maxWidth: '800px', margin: '0 auto' }}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">eSakhi Hyperlocal Logistics Fleet</span>
          <h2>Delivery Partner Onboarding & Biodata Form</h2>
        </div>
        <span className="seller-verified-pill" style={{ background: '#dbeafe', color: '#1e40af' }}>
          Fixed ₹40 / Doorstep Drop
        </span>
      </div>

      {error && <div className="city-admin-error" role="alert">{error}</div>}

      {/* 1. Personal Identity */}
      <fieldset className="field">
        <legend style={{ fontWeight: 800, fontSize: '0.95rem', color: '#1e293b', marginBottom: '0.75rem' }}>
          1. Personal Identity & Live Selfie
        </legend>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <label className="field">
            <span>Full Legal Name (as per Bank/ID) *</span>
            <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Mukesh Kumar Verma" />
          </label>
          <label className="field">
            <span>Primary Phone (SMS / Doorstep OTP) *</span>
            <input required type="tel" maxLength={15} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '0.5rem' }}>
          <label className="field">
            <span>Emergency Contact Name *</span>
            <input required maxLength={120} value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} placeholder="Sanjay Verma" />
          </label>
          <label className="field">
            <span>Relationship *</span>
            <select value={emergencyRel} onChange={(e) => setEmergencyRel(e.target.value)}>
              <option value="Parent">Parent</option>
              <option value="Spouse">Spouse</option>
              <option value="Sibling">Sibling</option>
              <option value="Family">Family / Relative</option>
            </select>
          </label>
          <label className="field">
            <span>Emergency Phone *</span>
            <input required type="tel" maxLength={15} value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} placeholder="+919414000000" />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
          <label className="field">
            <span>Current Residential Address *</span>
            <input required maxLength={300} value={residentialAddress} onChange={(e) => setResidentialAddress(e.target.value)} placeholder="House No, Ward/Street, Landmark" />
          </label>
          <label className="field">
            <span>Pincode *</span>
            <input required maxLength={6} value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))} placeholder="302028" />
          </label>
        </div>

        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: '0.35rem' }}>Operating Localities ({selectedLocalities.length} selected)</span>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {availableLocalities.map((loc) => (
              <label key={loc} style={{ fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={selectedLocalities.includes(loc)} onChange={() => toggleLocality(loc)} />
                <span>{loc}</span>
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: '0.35rem' }}>Live Selfie / Face Verification Photo *</span>
          <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, setSelfieUrl)} />
          {selfieUrl && (
            <div style={{ marginTop: '0.5rem' }}>
              <img src={selfieUrl} alt="Selfie preview" style={{ width: '96px', height: '96px', objectFit: 'cover', borderRadius: '50%', border: '2px solid #16a34a' }} />
              <small style={{ color: '#16a34a', fontWeight: 700, display: 'block', marginTop: '0.25rem' }}>✓ Selfie image attached</small>
            </div>
          )}
        </div>
      </fieldset>

      {/* 2. Dynamic Vehicle & "No-DL" Rule */}
      <fieldset className="field">
        <legend style={{ fontWeight: 800, fontSize: '0.95rem', color: '#1e293b', marginBottom: '0.75rem' }}>
          2. Vehicle & Licensing Logic (The "No-DL" Rule)
        </legend>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <label
            style={{
              padding: '1rem',
              borderRadius: '12px',
              border: `2px solid ${vehicleType === 'BICYCLE' ? '#16a34a' : '#cbd5e1'}`,
              background: vehicleType === 'BICYCLE' ? '#f0fdf4' : '#ffffff',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="vehicleType"
              checked={vehicleType === 'BICYCLE'}
              onChange={() => setVehicleType('BICYCLE')}
              style={{ marginRight: '0.5rem' }}
            />
            <strong>Bicycle / E-Cycle</strong>
            <small style={{ display: 'block', color: '#166534', marginTop: '0.25rem' }}>
              ✓ No DL required • Hyperlocal radius (1–3 km)
            </small>
          </label>

          <label
            style={{
              padding: '1rem',
              borderRadius: '12px',
              border: `2px solid ${vehicleType === 'MOTORCYCLE' ? '#ea580c' : '#cbd5e1'}`,
              background: vehicleType === 'MOTORCYCLE' ? '#fff7ed' : '#ffffff',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="vehicleType"
              checked={vehicleType === 'MOTORCYCLE'}
              onChange={() => setVehicleType('MOTORCYCLE')}
              style={{ marginRight: '0.5rem' }}
            />
            <strong>Motorcycle / Scooter</strong>
            <small style={{ display: 'block', color: '#9a3412', marginTop: '0.25rem' }}>
              ⚠ Driving License & RC Strictly Mandatory
            </small>
          </label>
        </div>

        {vehicleType === 'BICYCLE' ? (
          <div style={{ padding: '0.85rem', background: '#f0fdf4', borderRadius: '10px', border: '1px solid #bbf7d0' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#166534', display: 'block' }}>
              Alternative ID: Government Photo ID (Voter ID / Passport / PAN) *
            </span>
            <small style={{ color: '#15803d', display: 'block', marginBottom: '0.5rem' }}>
              Under the No-DL rule for cycles, upload a front copy of your government identity document.
            </small>
            <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, setGovIdUrl)} />
            {govIdUrl && <small style={{ color: '#16a34a', fontWeight: 700, display: 'block', marginTop: '0.25rem' }}>✓ Gov ID proof attached</small>}
          </div>
        ) : (
          <div style={{ padding: '1rem', background: '#fff7ed', borderRadius: '12px', border: '1px solid #fed7aa', display: 'grid', gap: '0.75rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <label className="field">
                <span>Driving License (DL) Number *</span>
                <input required value={dlNumber} onChange={(e) => setDlNumber(e.target.value.toUpperCase())} placeholder="RJ14 20210088991" />
              </label>
              <label className="field">
                <span>DL Expiry Date *</span>
                <input required type="date" value={dlExpiryDate} onChange={(e) => setDlExpiryDate(e.target.value)} />
              </label>
              <label className="field">
                <span>Vehicle RC Number *</span>
                <input required value={vehicleRcNumber} onChange={(e) => setVehicleRcNumber(e.target.value.toUpperCase())} placeholder="RJ14 AB 1234" />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.25rem' }}>
              <div>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: '0.25rem' }}>DL Front Photo *</span>
                <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, setDlFrontUrl)} />
                {dlFrontUrl && <small style={{ color: '#16a34a', fontWeight: 700, display: 'block' }}>✓ Front photo attached</small>}
              </div>
              <div>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: '0.25rem' }}>DL Back Photo *</span>
                <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, setDlBackUrl)} />
                {dlBackUrl && <small style={{ color: '#16a34a', fontWeight: 700, display: 'block' }}>✓ Back photo attached</small>}
              </div>
            </div>
          </div>
        )}
      </fieldset>

      {/* 3. Settlement & Bank Details */}
      <fieldset className="field">
        <legend style={{ fontWeight: 800, fontSize: '0.95rem', color: '#1e293b', marginBottom: '0.75rem' }}>
          3. Payout Bank Account (Double-Entry Match)
        </legend>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <label className="field">
            <span>Bank Account Number *</span>
            <input required type="password" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))} placeholder="Enter account number" />
          </label>
          <label className="field">
            <span>Confirm Account Number *</span>
            <input required type="text" value={confirmAccount} onChange={(e) => setConfirmAccount(e.target.value.replace(/\D/g, ''))} placeholder="Re-enter to verify match" />
          </label>
        </div>
        {confirmAccount && (
          <small role="status" style={{ display: 'block', marginTop: '0.35rem', fontWeight: 700, color: isBankMatch ? '#16a34a' : '#dc2626' }}>
            {isBankMatch ? '✓ Account numbers match' : '✗ Account numbers do not match'}
          </small>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
          <label className="field">
            <span>11-Digit IFSC Code *</span>
            <input required maxLength={11} value={ifsc} onChange={(e) => handleIfscChange(e.target.value)} placeholder="SBIN0001234" />
          </label>
          <label className="field">
            <span>Direct UPI VPA (Optional)</span>
            <input value={upiVpa} onChange={(e) => setUpiVpa(e.target.value.trim())} placeholder="rider@upi" />
          </label>
        </div>

        {bankName && (
          <div style={{ marginTop: '0.5rem', padding: '0.6rem 0.85rem', background: '#ecfdf5', borderRadius: '8px', border: '1px solid #a7f3d0', fontSize: '0.84rem', color: '#065f46' }}>
            ✓ Verified Bank: <strong>{bankName}</strong> ({branchName})
          </div>
        )}

        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: '0.35rem' }}>Passbook Front Page / Cancelled Cheque *</span>
          <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, setPassbookDocUrl)} />
          {passbookDocUrl && <small style={{ color: '#16a34a', fontWeight: 700, display: 'block', marginTop: '0.25rem' }}>✓ Passbook proof attached</small>}
        </div>
      </fieldset>

      <div style={{ marginTop: '1rem' }}>
        <button
          type="submit"
          className="button button-full"
          disabled={submissionStatus === 'SUBMITTING'}
          style={{ background: '#059669', color: '#ffffff', fontWeight: 800, padding: '0.85rem' }}
        >
          {submissionStatus === 'SUBMITTING' ? 'Submitting & Encrypting...' : 'Lock Profile & Submit for City Admin Review'}
        </button>
      </div>
    </form>
  );
}
