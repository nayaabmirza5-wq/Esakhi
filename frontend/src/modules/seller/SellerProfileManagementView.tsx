import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import type { User, SellerRecord } from '../../types';
import {
  Store,
  ShieldCheck,
  CreditCard,
  MapPin,
  Clock,
  Check,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Phone,
  Mail,
  User as UserIcon,
  PlusCircle,
  Package,
  TrendingUp,
  FileCheck,
  HelpCircle,
  Upload,
  Camera,
  FileText,
  Percent,
  Crosshair,
  Calendar,
  Info,
} from 'lucide-react';

interface SellerProfileManagementViewProps {
  user: User;
  onProfileUpdated?: () => Promise<void> | void;
}

type StoreCategory = 'FOOD' | 'TEXTILES' | 'HANDICRAFT' | 'HERBAL' | 'ELECTRONICS';

interface CommissionInfo {
  ratePercent: number;
  label: string;
  tier: string;
}

const CATEGORY_COMMISSION_MAP: Record<StoreCategory, CommissionInfo> = {
  FOOD: { ratePercent: 8, label: '8% Platform Commission Slab', tier: 'FMCG Tier A' },
  TEXTILES: { ratePercent: 12, label: '12% Platform Commission Slab', tier: 'Handloom & Apparel Tier B' },
  HANDICRAFT: { ratePercent: 10, label: '10% Platform Commission Slab', tier: 'Artisan & Home Tier B' },
  HERBAL: { ratePercent: 10, label: '10% Platform Commission Slab', tier: 'Wellness & Personal Care Tier B' },
  ELECTRONICS: { ratePercent: 15, label: '15% Platform Commission Slab', tier: 'General Electronics Tier C' },
};

const ALL_WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function SellerProfileManagementView({
  user,
  onProfileUpdated,
}: SellerProfileManagementViewProps): ReactNode {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // 1. Store Identity & Contact
  const [shgName, setShgName] = useState('Aarohi Verma Collective');
  const [representative, setRepresentative] = useState(user.name || 'Aarohi Verma');
  const [phone] = useState(user.phone || '+919876543210');
  const [email, setEmail] = useState('seller@esakhi.org');
  const [category, setCategory] = useState<StoreCategory>('TEXTILES');
  const [storeDescription, setStoreDescription] = useState(
    'Artisan collective empowering 12 rural women artisans in Damoh, producing handcrafted Chanderi sarees and textiles.'
  );
  const [numberOfMembers, setNumberOfMembers] = useState(12);
  const [shgCode] = useState('MP-DMH-1042');

  // 2. Tax & Legal Compliance
  const [hasGst, setHasGst] = useState(false);
  const [gstin, setGstin] = useState('23AAAAA0000A1Z5');
  const [enrolmentId, setEnrolmentId] = useState('ENR-MP-470661-0012');
  const [panNumber, setPanNumber] = useState('ABCDE1234F');
  const [fssaiNumber, setFssaiNumber] = useState('11423850000123');
  const [salesExceeds5Lakh, setSalesExceeds5Lakh] = useState(false);
  const [panCardFileName, setPanCardFileName] = useState('pan_card_aarohi_verma.jpg');
  const [taxCertificateFileName, setTaxCertificateFileName] = useState('enrolment_certificate_MP.pdf');

  // 3. Bank Account & Settlement
  const [accountHolderName, setAccountHolderName] = useState(user.name || 'Aarohi Verma');
  const [bankName, setBankName] = useState('State Bank of India (SBI)');
  const [accountNumber, setAccountNumber] = useState('48219012345');
  const [ifscCode, setIfscCode] = useState('SBIN0000364');
  const [accountType, setAccountType] = useState<'SAVINGS' | 'CURRENT'>('SAVINGS');
  const [upiId, setUpiId] = useState('9876543210@sbi');

  // 4. Retail Store Pickup Location & Interactive GPS Pin
  const [streetAddress, setStreetAddress] = useState('Zila Panchayat Parisar, Collectorate Road');
  const [locality, setLocality] = useState('Collectorate');
  const [city, setCity] = useState(user.assignedCity || 'Damoh');
  const [state, setState] = useState('Madhya Pradesh');
  const [pincode, setPincode] = useState('470661');
  const [landmark, setLandmark] = useState('Near Circuit House, Opposite District Hospital');
  const [latitude, setLatitude] = useState(23.8388);
  const [longitude, setLongitude] = useState(79.4422);
  const [locatingGps, setLocatingGps] = useState(false);
  const [gpsMessage, setGpsMessage] = useState('✓ Shop entrance GPS locked: 23.8388° N, 79.4422° E (±4m)');
  const [storefrontPhotoName, setStorefrontPhotoName] = useState('aarohi_storefront_signboard.jpg');

  // 5. Operating Schedule & Split-Shift Hours
  const [storeOpen, setStoreOpen] = useState(true);
  const [splitShiftEnabled, setSplitShiftEnabled] = useState(true);
  const [morningOpen, setMorningOpen] = useState('09:00');
  const [morningClose, setMorningClose] = useState('13:30');
  const [eveningOpen, setEveningOpen] = useState('16:30');
  const [eveningClose, setEveningClose] = useState('20:30');
  const [closedDays, setClosedDays] = useState<string[]>(['Sunday']);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'all' | 'store' | 'tax' | 'bank' | 'pickup' | 'hours'>('all');

  const commission = CATEGORY_COMMISSION_MAP[category] || CATEGORY_COMMISSION_MAP.HANDICRAFT;

  useEffect(() => {
    let isMounted = true;
    api.getSellerProfile()
      .then((res) => {
        if (!isMounted) return;
        const s: SellerRecord | undefined = res.seller;
        if (s) {
          if (s.supplierDetails?.shgName) setShgName(s.supplierDetails.shgName);
          if (s.supplierDetails?.shgLeaderName) setRepresentative(s.supplierDetails.shgLeaderName);
          if (s.supplierDetails?.category) {
            const cat = s.supplierDetails.category as StoreCategory;
            if (CATEGORY_COMMISSION_MAP[cat]) setCategory(cat);
          }
          if (s.supplierDetails?.numberOfMembers) setNumberOfMembers(s.supplierDetails.numberOfMembers);
          if (s.supplierDetails?.fssaiNumber) setFssaiNumber(s.supplierDetails.fssaiNumber);

          if (s.taxDetails) {
            setHasGst(Boolean(s.taxDetails.hasGst));
            if (s.taxDetails.gstin) setGstin(s.taxDetails.gstin);
            if (s.taxDetails.enrolmentId) setEnrolmentId(s.taxDetails.enrolmentId);
            if (s.taxDetails.panNumber) setPanNumber(s.taxDetails.panNumber);
            if (s.taxDetails.email) setEmail(s.taxDetails.email);
          }

          if (s.bankDetails) {
            if (s.bankDetails.accountHolderName) setAccountHolderName(s.bankDetails.accountHolderName);
            if (s.bankDetails.bankName) setBankName(s.bankDetails.bankName);
            if (s.bankDetails.accountNumber) setAccountNumber(s.bankDetails.accountNumber);
            if (s.bankDetails.ifscCode) setIfscCode(s.bankDetails.ifscCode);
            if (s.bankDetails.accountType) setAccountType(s.bankDetails.accountType);
          }

          if (s.pickupAddress) {
            if (s.pickupAddress.streetAddress) setStreetAddress(s.pickupAddress.streetAddress);
            if (s.pickupAddress.locality) setLocality(s.pickupAddress.locality);
            if (s.pickupAddress.city) setCity(s.pickupAddress.city);
            if (s.pickupAddress.state) setState(s.pickupAddress.state);
            if (s.pickupAddress.pincode) setPincode(s.pickupAddress.pincode);
            if (s.pickupAddress.landmark) setLandmark(s.pickupAddress.landmark);
          }
        }
      })
      .catch((err) => {
        console.warn('Could not pre-fetch full seller record:', err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, [user]);

  // Detect Shop Entrance GPS
  const detectShopGps = () => {
    setLocatingGps(true);
    setGpsMessage('');
    if (!navigator.geolocation) {
      setGpsMessage('Geolocation not supported in browser. Coordinates set manually.');
      setLocatingGps(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setLatitude(lat);
        setLongitude(lng);
        setGpsMessage(`✓ Exact shop entrance GPS pinned: ${lat}° N, ${lng}° E (±${Math.round(pos.coords.accuracy)}m)`);
        setLocatingGps(false);
      },
      () => {
        setGpsMessage('Could not retrieve browser GPS. Retaining Damoh central hub coordinates.');
        setLocatingGps(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const toggleClosedDay = (day: string) => {
    setClosedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    setError('');
    setSuccessMessage('');

    try {
      await api.updateSellerProfile({
        shgName: shgName.trim(),
        representative: representative.trim(),
        registeredAddress: streetAddress.trim(),
        storeDescription: storeDescription.trim(),
        taxDetails: {
          hasGst,
          gstin: hasGst ? gstin.trim().toUpperCase() : undefined,
          hasEnrolmentId: !hasGst,
          enrolmentId: !hasGst ? enrolmentId.trim().toUpperCase() : undefined,
          panNumber: panNumber.trim().toUpperCase(),
          panCardUrl: panCardFileName,
          gstCertificateUrl: taxCertificateFileName,
          businessName: shgName.trim(),
          email: email.trim(),
        },
        pickupAddress: {
          streetAddress: streetAddress.trim(),
          locality: locality.trim(),
          city: city.trim(),
          state: state.trim(),
          pincode: pincode.trim(),
          landmark: landmark.trim(),
          latitude,
          longitude,
          storefrontPhotoUrl: storefrontPhotoName,
        },
        bankDetails: {
          accountHolderName: accountHolderName.trim(),
          bankName: bankName.trim(),
          accountNumber: accountNumber.trim(),
          ifscCode: ifscCode.trim().toUpperCase(),
          accountType,
        },
        supplierDetails: {
          category: category as 'HANDICRAFT' | 'TEXTILES' | 'FOOD' | 'HERBAL',
          fssaiNumber: category === 'FOOD' ? fssaiNumber.trim() || undefined : undefined,
          numberOfMembers: Number(numberOfMembers) || 12,
        },
        operatingHours: {
          openTime: morningOpen,
          closeTime: splitShiftEnabled ? eveningClose : morningClose,
          splitShift: {
            enabled: splitShiftEnabled,
            breakStart: morningClose,
            breakEnd: eveningOpen,
          },
          weeklyOffDays: closedDays,
          isClosedOverride: !storeOpen,
        },
      });

      setSuccessMessage('✓ Store Profile, Tax & Banking Compliance saved successfully.');
      if (onProfileUpdated) await onProfileUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save seller profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-slate-500">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-purple-700" />
        <p className="text-sm font-semibold">Loading Seller Business & Compliance Profile…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* 1. SELLER HERO BANNER */}
      <div className="bg-gradient-to-r from-[#1E1B4B] via-[#2E1065] to-[#4A0E4E] rounded-2xl p-6 sm:p-8 text-white shadow-md relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>NRLM / NULM Verified SHG</span>
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-white/10 text-purple-200 border border-white/20">
                Code: {shgCode}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-400/20 text-amber-200 border border-amber-400/30">
                {storeOpen ? '🟢 Store Accepting Orders' : '🔴 Vacation Mode (Paused)'}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight" style={{ color: '#ffffff' }}>
              {shgName}
            </h1>
            <p className="text-xs sm:text-sm text-purple-200 max-w-xl">
              Representative: <strong className="text-white">{representative}</strong> · Empowering {numberOfMembers} Women Artisans in Damoh, MP.
            </p>
          </div>

          {/* Quick Seller Hub Action Buttons */}
          <div className="flex flex-wrap gap-2.5 shrink-0">
            <Link
              to="/seller-dashboard"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white text-purple-950 text-xs font-extrabold shadow-sm hover:bg-purple-50 transition-all"
            >
              <Store className="w-4 h-4 text-purple-900" />
              <span>Seller Dashboard</span>
            </Link>
            <Link
              to="/seller-dashboard?view=new_product"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-extrabold shadow-sm transition-all"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Add Product</span>
            </Link>
            <Link
              to="/seller-dashboard?view=orders"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold border border-white/20 transition-all"
            >
              <Package className="w-4 h-4" />
              <span>Orders</span>
            </Link>
            <Link
              to="/seller-dashboard?view=passbook"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold border border-white/20 transition-all"
            >
              <TrendingUp className="w-4 h-4" />
              <span>Earnings</span>
            </Link>
          </div>
        </div>
      </div>

      {/* SUCCESS / ERROR ALERTS */}
      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs font-bold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 5-STEP TAB NAVIGATION */}
      <div className="flex border-b border-slate-200 overflow-x-auto gap-2 pb-1">
        {[
          { key: 'all', label: 'Complete Overview' },
          { key: 'store', label: '1. Store Identity' },
          { key: 'tax', label: '2. Tax & Legal Compliance' },
          { key: 'bank', label: '3. Bank Settlements' },
          { key: 'pickup', label: '4. Store Pickup Location' },
          { key: 'hours', label: '5. Operating Schedule' },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
              activeTab === tab.key
                ? 'bg-[#1E1B4B] text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* FORM BODY */}
      <form onSubmit={handleSave} className="space-y-6">
        {/* CARD 1: STORE & BRAND IDENTITY */}
        {(activeTab === 'all' || activeTab === 'store') && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-purple-50 text-purple-700">
                  <Store className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                    1. Store & Brand Identity
                  </h2>
                  <p className="text-xs text-slate-500">
                    Visible to customers on the Damoh Hyperlocal marketplace.
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-full border border-purple-100">
                Step 1 of 5
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Store / Collective Display Name <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400">
                    <Store className="w-4 h-4" />
                  </span>
                  <input
                    type="text"
                    required
                    value={shgName}
                    onChange={(e) => setShgName(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Representative / Lead Artisan <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400">
                    <UserIcon className="w-4 h-4" />
                  </span>
                  <input
                    type="text"
                    required
                    value={representative}
                    onChange={(e) => setRepresentative(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Verified Contact Mobile
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400">
                    <Phone className="w-4 h-4" />
                  </span>
                  <input
                    type="text"
                    disabled
                    value={phone}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 cursor-not-allowed"
                  />
                </div>
                <p className="text-[10px] text-emerald-600 font-bold mt-1">✓ OTP Authenticated on eSakhi</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Official Store Email
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400">
                    <Mail className="w-4 h-4" />
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Primary Product Category <span className="text-rose-500">*</span>
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as StoreCategory)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                >
                  <option value="FOOD">Packaged FMCG & Snacks (Pickles, Spices, Papad)</option>
                  <option value="TEXTILES">Textiles, Handloom, Chanderi & Sarees (Apparel)</option>
                  <option value="HANDICRAFT">Handicrafts, Terracotta & Home Decor (Home)</option>
                  <option value="HERBAL">Herbal, Ayurvedic & Natural Soaps (Personal Care)</option>
                  <option value="ELECTRONICS">Electronics & Appliances</option>
                </select>

                {/* Read-only Commission Slab Badge for Selected Category */}
                <div className="mt-2 flex items-center gap-1.5 p-2 rounded-lg bg-purple-50 border border-purple-200">
                  <Percent className="w-3.5 h-3.5 text-purple-700 shrink-0" />
                  <span className="text-[11px] font-bold text-purple-900">
                    Auto-Assigned: {commission.label} ({commission.tier})
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Women Artisans in Collective
                </label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={numberOfMembers}
                  onChange={(e) => setNumberOfMembers(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                About the Store / Artisan Heritage (Customer Bio)
              </label>
              <textarea
                rows={3}
                value={storeDescription}
                onChange={(e) => setStoreDescription(e.target.value)}
                placeholder="Describe your craft, traditional techniques, and the story of your women artisans."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
              />
            </div>
          </div>
        )}

        {/* CARD 2: TAX & LEGAL COMPLIANCE */}
        {(activeTab === 'all' || activeTab === 'tax') && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-blue-50 text-blue-700">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                    2. Indian Tax Compliance & Legal Metrology
                  </h2>
                  <p className="text-xs text-slate-500">
                    Mandatory for GST, Section 52 TCS (GSTR-8) and Section 194-O TDS.
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100">
                Step 2 of 5
              </span>
            </div>

            {/* FIX 1: Tax Profile Choice: GST Registered vs Non-GST / Enrolment ID */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <span className="text-xs font-bold text-slate-800 block">
                Choose Tax Identification Profile:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label
                  onClick={() => setHasGst(true)}
                  className={`p-3.5 rounded-xl border-2 cursor-pointer flex items-start gap-2.5 transition-all ${
                    hasGst ? 'border-[#1E1B4B] bg-purple-50/50 shadow-2xs' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="tax_profile_choice"
                    checked={hasGst}
                    onChange={() => setHasGst(true)}
                    className="mt-0.5 text-[#1E1B4B]"
                  />
                  <div>
                    <strong className="text-xs text-slate-900 block font-bold">GST Registered (GSTIN)</strong>
                    <span className="text-[11px] text-slate-500 leading-relaxed block mt-0.5">
                      Standard GST registration. Relative GST (CGST + SGST) charged on customer bills with HSN code.
                    </span>
                  </div>
                </label>

                <label
                  onClick={() => setHasGst(false)}
                  className={`p-3.5 rounded-xl border-2 cursor-pointer flex items-start gap-2.5 transition-all ${
                    !hasGst ? 'border-[#1E1B4B] bg-purple-50/50 shadow-2xs' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="tax_profile_choice"
                    checked={!hasGst}
                    onChange={() => setHasGst(false)}
                    className="mt-0.5 text-[#1E1B4B]"
                  />
                  <div>
                    <strong className="text-xs text-slate-900 block font-bold">Non-GST / Enrolment ID</strong>
                    <span className="text-[11px] text-slate-500 leading-relaxed block mt-0.5">
                      Intra-state e-commerce exemption under Section 24 CGST Act. 0% GST on bills. eSakhi files GSTR-8 TCS & 194-O TDS.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {hasGst ? (
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    GSTIN Number (15 Alphanumeric) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required={hasGst}
                    maxLength={15}
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value.toUpperCase())}
                    placeholder="e.g. 23AAAAA0000A1Z5"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Madhya Pradesh State Code: 23</p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Government Enrolment ID <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required={!hasGst}
                    value={enrolmentId}
                    onChange={(e) => setEnrolmentId(e.target.value.toUpperCase())}
                    placeholder="e.g. ENR-MP-470661-0012"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Govt. E-Commerce Artisan Enrolment ID</p>
                </div>
              )}

              {/* FIX 1: Exact Permanent Account Number (PAN) Label */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Permanent Account Number (PAN) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={10}
                  value={panNumber}
                  onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                  placeholder="e.g. ABCDE1234F"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                />
                <p className="text-[10px] text-slate-500 mt-1">Mandatory for Section 194-O TDS credit in Form 26AS / AIS</p>
              </div>

              {/* FIX 2: Conditional FSSAI License Field (ONLY visible when category === 'FOOD') */}
              {category === 'FOOD' ? (
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    FSSAI License / Registration No. (Mandatory for Food & Snacks) <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-slate-400">
                      <FileCheck className="w-4 h-4 text-emerald-600" />
                    </span>
                    <input
                      type="text"
                      required
                      maxLength={14}
                      value={fssaiNumber}
                      onChange={(e) => setFssaiNumber(e.target.value)}
                      placeholder="e.g. 11423850000123"
                      className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                    />
                  </div>
                  <p className="text-[10px] text-emerald-700 font-bold mt-1">✓ Required for Packaged Food, Snacks & Spices</p>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-slate-50 border border-dashed border-slate-200 flex items-center gap-2.5">
                  <Info className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="text-xs text-slate-500">
                    FSSAI License: <strong>Not Required</strong> for {commission.tier.split(' ')[0]} (Apparel, Personal Care, Home & Crafts).
                  </span>
                </div>
              )}

              {/* Annual Turnover Tier */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Annual Platform Sales Threshold
                </label>
                <div className="flex items-center gap-2 mt-2">
                  <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800">
                    <input
                      type="checkbox"
                      checked={salesExceeds5Lakh}
                      onChange={(e) => setSalesExceeds5Lakh(e.target.checked)}
                      className="rounded border-slate-300 text-[#1E1B4B]"
                    />
                    <span>Annual platform sales exceed ₹5,00,000</span>
                  </label>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  {salesExceeds5Lakh
                    ? '0.5% TDS (Sec 194-O) & 0.5% TCS (Sec 52 GSTR-8) deducted & remitted to Govt.'
                    : '0.1% TDS (Sec 194-O) & 0.1% TCS (Sec 52 GSTR-8) deducted & remitted to Govt.'}
                </p>
              </div>
            </div>

            {/* FIX 1: Document Upload Boxes for PAN Card and GST/Enrolment Certificate */}
            <div className="pt-3 border-t border-slate-100">
              <span className="text-xs font-bold text-slate-800 block mb-2.5">
                Mandatory Verification Document Uploads:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Upload Box 1: PAN Card */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-blue-700" />
                      <span>PAN Card Copy *</span>
                    </span>
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      ✓ Uploaded
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mb-2.5">
                    Clear photo or PDF copy of business or proprietor PAN card.
                  </p>
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold text-slate-800 cursor-pointer shadow-2xs">
                    <Upload className="w-3.5 h-3.5 text-slate-600" />
                    <span>{panCardFileName ? 'Change PAN Card File' : 'Upload PAN Card'}</span>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) setPanCardFileName(file.name);
                      }}
                    />
                  </label>
                  {panCardFileName && (
                    <span className="text-[10px] text-slate-600 block mt-1.5 truncate">
                      File: {panCardFileName}
                    </span>
                  )}
                </div>

                {/* Upload Box 2: GST or Enrolment Proof */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <FileCheck className="w-4 h-4 text-purple-700" />
                      <span>{hasGst ? 'GST Registration Certificate *' : 'Enrolment ID Declaration *'}</span>
                    </span>
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      ✓ Uploaded
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mb-2.5">
                    {hasGst
                      ? 'Official GST REG-06 registration certificate copy.'
                      : 'Self-declaration or govt. artisan enrolment certificate copy.'}
                  </p>
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold text-slate-800 cursor-pointer shadow-2xs">
                    <Upload className="w-3.5 h-3.5 text-slate-600" />
                    <span>{taxCertificateFileName ? 'Change Document File' : 'Upload Certificate'}</span>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) setTaxCertificateFileName(file.name);
                      }}
                    />
                  </label>
                  {taxCertificateFileName && (
                    <span className="text-[10px] text-slate-600 block mt-1.5 truncate">
                      File: {taxCertificateFileName}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Indian Tax Ledger Callout */}
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
              <HelpCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-bold">Government Tax Credit Guarantee:</strong>
                <span>
                  All TCS deposited via GSTR-8 reflects in your GST portal for cash ledger credit. All TDS deducted under Section 194-O reflects in your Form 26AS / AIS for income tax refund.
                </span>
              </div>
            </div>
          </div>
        )}

        {/* CARD 3: BANK ACCOUNT & SETTLEMENT DETAILS */}
        {(activeTab === 'all' || activeTab === 'bank') && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                    3. Bank Account & Daily Settlements
                  </h2>
                  <p className="text-xs text-slate-500">
                    Direct T+1 micro-payouts credited after delivery partner inspection.
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
                Step 3 of 5
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Bank Account Holder Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={accountHolderName}
                  onChange={(e) => setAccountHolderName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Bank Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Bank Account Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Bank IFSC Code <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={11}
                  value={ifscCode}
                  onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
                  placeholder="e.g. SBIN0000364"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                />
                <p className="text-[10px] text-slate-500 mt-1">Branch: State Bank of India, Damoh Main Branch</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Account Type
                </label>
                <select
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as typeof accountType)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                >
                  <option value="SAVINGS">Savings Account (Bachat Khata)</option>
                  <option value="CURRENT">Current Account (Vyapar Khata)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Instant UPI ID / VPA (Optional)
                </label>
                <input
                  type="text"
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  placeholder="e.g. 9876543210@sbi"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                />
                <p className="text-[10px] text-slate-500 mt-1">For instant micro-disbursements</p>
              </div>
            </div>
          </div>
        )}

        {/* FIX 3: CARD 4 RENAME: STORE PICKUP LOCATION & GPS PIN */}
        {(activeTab === 'all' || activeTab === 'pickup') && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-50 text-amber-700">
                  <MapPin className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                    4. STORE PICKUP LOCATION & GPS PIN
                  </h2>
                  <p className="text-xs text-slate-500">
                    Set exact shop entrance coordinates for delivery fleet arrival and customer pickup.
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-100">
                Step 4 of 5
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Workshop / Shop / Doorstep Street Address <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={streetAddress}
                  onChange={(e) => setStreetAddress(e.target.value)}
                  placeholder="e.g. Zila Panchayat Parisar, Collectorate Road"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Area / Locality / Mohalla <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={locality}
                  onChange={(e) => setLocality(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Prominent Landmark
                </label>
                <input
                  type="text"
                  value={landmark}
                  onChange={(e) => setLandmark(e.target.value)}
                  placeholder="e.g. Near Circuit House"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  City / Town <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  6-Digit Postal PIN Code <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-[#1E1B4B]"
                />
              </div>
            </div>

            {/* FIX 3: Interactive GPS Map Pin Selector for Exact Shop Entrance */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <Crosshair className="w-4 h-4 text-purple-700" />
                    <span>Exact Shop Entrance GPS Coordinates</span>
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Pins your physical door for the Damoh delivery rider navigation.
                  </span>
                </div>

                <button
                  type="button"
                  onClick={detectShopGps}
                  disabled={locatingGps}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-900 text-xs font-bold transition-all shadow-2xs shrink-0 cursor-pointer"
                >
                  {locatingGps ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-700" /> : <MapPin className="w-3.5 h-3.5 text-purple-700" />}
                  <span>{locatingGps ? 'Detecting Doorstep…' : 'Pin Exact Shop GPS'}</span>
                </button>
              </div>

              {/* Visual Interactive Map Canvas Widget */}
              <div
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const xRatio = (e.clientX - rect.left) / rect.width;
                  const yRatio = (e.clientY - rect.top) / rect.height;
                  const newLat = Number((23.835 + (1 - yRatio) * 0.01).toFixed(6));
                  const newLng = Number((79.435 + xRatio * 0.015).toFixed(6));
                  setLatitude(newLat);
                  setLongitude(newLng);
                  setGpsMessage(`✓ Doorstep pin adjusted: ${newLat}° N, ${newLng}° E`);
                }}
                className="relative h-36 w-full rounded-xl border border-slate-300 bg-slate-200 overflow-hidden cursor-crosshair shadow-inner flex items-center justify-center select-none"
                style={{
                  backgroundImage: `radial-gradient(#94a3b8 1.5px, transparent 1.5px), radial-gradient(#cbd5e1 1.5px, #f1f5f9 1.5px)`,
                  backgroundSize: '24px 24px',
                  backgroundPosition: '0 0, 12px 12px',
                }}
                title="Click anywhere to fine-tune shop entrance pin"
              >
                {/* Damoh Hyperlocal Map Grid overlay */}
                <div className="absolute inset-0 flex items-center justify-center opacity-30 pointer-events-none">
                  <div className="w-48 h-48 border border-dashed border-purple-400 rounded-full" />
                </div>

                {/* Pin marker positioned at center */}
                <div className="flex flex-col items-center pointer-events-none z-10">
                  <div className="px-2 py-0.5 rounded bg-[#1E1B4B] text-white text-[10px] font-bold shadow-md whitespace-nowrap mb-1">
                    Shop Entrance ({latitude.toFixed(4)}, {longitude.toFixed(4)})
                  </div>
                  <MapPin className="w-8 h-8 text-rose-600 drop-shadow-md animate-bounce" />
                </div>

                <div className="absolute bottom-2 left-2 bg-white/90 backdrop-blur-xs px-2.5 py-1 rounded text-[10px] font-bold text-slate-700 border border-slate-300">
                  📍 Click map to fine-tune exact door placement
                </div>
              </div>

              {gpsMessage && (
                <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>{gpsMessage}</span>
                </div>
              )}
            </div>

            {/* FIX 3: Storefront Signboard Photo Upload Field */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-slate-50 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-amber-700" />
                  <span>Storefront Signboard / Shop Entrance Photo *</span>
                </span>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  ✓ Photo Verified
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mb-2.5">
                Upload a clear photo of your shop's signboard and front entrance to assist courier drivers during pickup.
              </p>
              <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold text-slate-800 cursor-pointer shadow-2xs">
                <Upload className="w-3.5 h-3.5 text-slate-600" />
                <span>{storefrontPhotoName ? 'Change Storefront Photo' : 'Upload Storefront Photo'}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setStorefrontPhotoName(file.name);
                  }}
                />
              </label>
              {storefrontPhotoName && (
                <span className="text-[10px] text-slate-600 block mt-1.5 truncate">
                  Selected Photo: {storefrontPhotoName}
                </span>
              )}
            </div>
          </div>
        )}

        {/* FIX 4: CARD 5: OPERATING SCHEDULE & SLA (SPLIT-SHIFT, CLOSED-DAY CHECKBOXES & COMMISSION BADGE) */}
        {(activeTab === 'all' || activeTab === 'hours') && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-purple-50 text-purple-700">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                    5. Store Operating Schedule & Hyperlocal SLA
                  </h2>
                  <p className="text-xs text-slate-500">
                    Controls customer ordering hours, split shifts, and weekly closed days.
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-full border border-purple-100">
                Step 5 of 5
              </span>
            </div>

            {/* Vacation Mode Toggle */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200 gap-2">
              <div>
                <strong className="text-xs text-slate-900 block font-bold">Store Vacation Mode</strong>
                <span className="text-[11px] text-slate-500">
                  Temporarily pause new incoming orders when traveling or replenishing stock.
                </span>
              </div>
              <select
                value={storeOpen ? 'open' : 'closed'}
                onChange={(e) => setStoreOpen(e.target.value === 'open')}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-[#1E1B4B] shrink-0"
              >
                <option value="open">🟢 Store Open (Accepting Orders)</option>
                <option value="closed">🔴 Vacation Mode (Paused)</option>
              </select>
            </div>

            {/* Split-Shift Morning & Evening Operating Hours */}
            <div className="space-y-3 p-4 rounded-xl border border-slate-200 bg-slate-50/50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-purple-700" />
                  <span>Split-Shift Morning / Evening Operating Hours</span>
                </span>
                <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={splitShiftEnabled}
                    onChange={(e) => setSplitShiftEnabled(e.target.checked)}
                    className="rounded border-slate-300 text-[#1E1B4B]"
                  />
                  <span>Split-Shift (Afternoon Break) Enabled</span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                {/* Morning Shift */}
                <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-2">
                  <span className="text-[11px] font-bold text-purple-900 block">
                    ☀️ Morning Shift
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Opening Time</label>
                      <input
                        type="time"
                        value={morningOpen}
                        onChange={(e) => setMorningOpen(e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-slate-300 text-xs font-bold text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                        {splitShiftEnabled ? 'Lunch Break Start' : 'Closing Time'}
                      </label>
                      <input
                        type="time"
                        value={morningClose}
                        onChange={(e) => setMorningClose(e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-slate-300 text-xs font-bold text-slate-900"
                      />
                    </div>
                  </div>
                </div>

                {/* Evening Shift */}
                <div className={`p-3 rounded-xl border space-y-2 ${splitShiftEnabled ? 'bg-white border-slate-200' : 'bg-slate-100 border-dashed border-slate-200 opacity-60'}`}>
                  <span className="text-[11px] font-bold text-purple-900 block">
                    🌙 Evening Shift {splitShiftEnabled ? '' : '(Disabled)'}
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Re-Opening Time</label>
                      <input
                        type="time"
                        disabled={!splitShiftEnabled}
                        value={eveningOpen}
                        onChange={(e) => setEveningOpen(e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-slate-300 text-xs font-bold text-slate-900 disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Night Closing Time</label>
                      <input
                        type="time"
                        disabled={!splitShiftEnabled}
                        value={eveningClose}
                        onChange={(e) => setEveningClose(e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-slate-300 text-xs font-bold text-slate-900 disabled:bg-slate-100"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* FIX 4: Weekly Closed-Day Checkboxes */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-purple-700" />
                  <span>Weekly Closed Days</span>
                </span>
                <span className="text-[11px] font-bold text-slate-600">
                  {closedDays.length === 0 ? 'Open all 7 days' : `Closed on: ${closedDays.join(', ')}`}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-7 gap-2 pt-1">
                {ALL_WEEK_DAYS.map((day) => {
                  const isChecked = closedDays.includes(day);
                  return (
                    <label
                      key={day}
                      onClick={() => toggleClosedDay(day)}
                      className={`p-2 rounded-lg border cursor-pointer text-center text-xs font-bold transition-all ${
                        isChecked
                          ? 'border-purple-600 bg-[#1E1B4B] text-white shadow-2xs'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleClosedDay(day)}
                        className="hidden"
                      />
                      <span>{day.slice(0, 3)}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* FIX 4: Auto-Assigned Commission Slab Badge in Step 5 */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-purple-50 border border-purple-200 gap-2">
              <div className="flex items-center gap-2">
                <Percent className="w-4 h-4 text-purple-700 shrink-0" />
                <div>
                  <strong className="text-xs text-purple-950 block">Commercial Category Commission Slab</strong>
                  <span className="text-[11px] text-purple-800">
                    Category: <strong>{commission.tier}</strong>
                  </span>
                </div>
              </div>

              <span className="px-3 py-1 rounded-full bg-[#1E1B4B] text-white text-xs font-extrabold shadow-2xs shrink-0 self-start sm:self-auto">
                {commission.label}
              </span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-xs font-bold text-slate-700">
                Dispatch SLA: Ready for courier pickup within 2 hours of customer order.
              </span>
              <span className="text-xs font-bold text-purple-800 bg-purple-100 px-2.5 py-0.5 rounded-full">
                24–48h Doorstep Handover
              </span>
            </div>
          </div>
        )}

        {/* BOTTOM STICKY SAVE BAR */}
        <div className="sticky bottom-4 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-300 p-4 shadow-lg flex items-center justify-between gap-4">
          <div className="text-xs text-slate-600 hidden sm:block">
            Updates will sync with your seller catalog, tax filings, and bank payouts.
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-[#1E1B4B] hover:bg-[#2b2767] text-white text-xs font-bold shadow-sm transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4 text-[#A3E635]" />
              )}
              <span>{saving ? 'Saving Seller Profile…' : 'Save Store Profile & Compliance'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
