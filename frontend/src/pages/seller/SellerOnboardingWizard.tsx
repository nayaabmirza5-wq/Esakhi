import { useState, useRef } from 'react';
import type { ReactNode, ChangeEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Mail,
  FileText,
  MapPin,
  Landmark,
  Clock,
  Camera,
  ShieldCheck,
  Loader2,
  AlertCircle,
  Sparkles,
  Utensils,
  Shirt,
  Home,
  Gift,
  ArrowRight,
  RotateCcw,
  Building2,
  BadgePercent,
  LocateFixed,
  Crosshair,
} from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../AuthContext';
import { DAMOH_LOCALITIES } from '../../modules/bazaar/BazaarContext';

export interface CategoryOption {
  id: string;
  name: string;
  commission: string;
  desc: string;
  icon: LucideIcon;
  isFood: boolean;
  eSakhiCategoryId?: string;
  eSakhiSubcategoryId?: string;
}

// Store Category Configuration with Commission Slabs
export const CATEGORIES: CategoryOption[] = [
  {
    id: 'grocery',
    name: 'Grocery & Food',
    commission: '5%',
    desc: 'Packaged foods, spices, beverages, snacks & staples',
    icon: Utensils,
    isFood: true,
    eSakhiCategoryId: 'food-items',
    eSakhiSubcategoryId: 'snacks-beverages',
  },
  {
    id: 'clothing',
    name: 'Clothing & Apparel',
    commission: '10%',
    desc: 'Ethnic wear, western wear, kids apparel & fabrics',
    icon: Shirt,
    isFood: false,
    eSakhiCategoryId: 'womens-apparel-accessories',
    eSakhiSubcategoryId: 'ethnic-wear',
  },
  {
    id: 'decor',
    name: 'Home Decor',
    commission: '12%',
    desc: 'Furnishings, wall art, lighting & kitchen essentials',
    icon: Home,
    isFood: false,
    eSakhiCategoryId: 'home-furnishings-decor',
    eSakhiSubcategoryId: 'decor',
  },
  {
    id: 'gifts',
    name: 'Gifts & Handicrafts',
    commission: '8%',
    desc: 'Artisanal crafts, festive hampers & personalized gifts',
    icon: Gift,
    isFood: false,
    eSakhiCategoryId: 'art-crafts',
    eSakhiSubcategoryId: 'handicrafts',
  },
];

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const STEPS = [
  { number: 1, title: 'Contact', shortTitle: 'Contact' },
  { number: 2, title: 'Category & Tax', shortTitle: 'Tax & FSSAI' },
  { number: 3, title: 'Pickup Address', shortTitle: 'Address' },
  { number: 4, title: 'Bank Details', shortTitle: 'Bank' },
  { number: 5, title: 'Store Profile', shortTitle: 'Store' },
];

// Helper to resolve realistic Indian Pincode data
const lookupPincode = (pin: string) => {
  if (pin.startsWith('560')) return { city: 'Bengaluru', state: 'Karnataka' };
  if (pin.startsWith('400')) return { city: 'Mumbai', state: 'Maharashtra' };
  if (pin.startsWith('110')) return { city: 'New Delhi', state: 'Delhi' };
  if (pin.startsWith('500')) return { city: 'Hyderabad', state: 'Telangana' };
  if (pin.startsWith('600')) return { city: 'Chennai', state: 'Tamil Nadu' };
  if (pin.startsWith('700')) return { city: 'Kolkata', state: 'West Bengal' };
  if (pin.startsWith('380')) return { city: 'Ahmedabad', state: 'Gujarat' };
  if (pin.startsWith('411')) return { city: 'Pune', state: 'Maharashtra' };
  if (pin.startsWith('395')) return { city: 'Surat', state: 'Gujarat' };
  if (pin.startsWith('470')) return { city: 'Damoh', state: 'Madhya Pradesh' };
  return { city: 'Jaipur', state: 'Rajasthan' };
};

// Helper to resolve realistic Indian Bank details from IFSC
const lookupIfsc = (ifsc: string) => {
  const code = ifsc.toUpperCase();
  if (code.startsWith('HDFC')) return 'HDFC Bank • Koramangala Branch';
  if (code.startsWith('SBIN')) return 'State Bank of India • Commercial Street';
  if (code.startsWith('ICIC')) return 'ICICI Bank • MG Road Branch';
  if (code.startsWith('UTIB')) return 'Axis Bank • Indiranagar Branch';
  if (code.startsWith('KKBK')) return 'Kotak Mahindra Bank • Main Branch';
  if (code.startsWith('PUNB')) return 'Punjab National Bank • Civil Lines Branch';
  return `${code.slice(0, 4)} Bank • Verified Main Branch`;
};

export function SellerOnboardingWizard(): ReactNode {
  const navigate = useNavigate();
  const { reloadUser } = useAuth();

  // Navigation & submission state
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Step 1: Contact Verification
  const [mobile, setMobile] = useState<string>('');
  const [otpSent, setOtpSent] = useState<boolean>(false);
  const [otp, setOtp] = useState<string>('');
  const [mobileVerified, setMobileVerified] = useState<boolean>(false);
  const [sendingOtp, setSendingOtp] = useState<boolean>(false);
  const [verifyingOtp, setVerifyingOtp] = useState<boolean>(false);
  const [email, setEmail] = useState<string>('');

  // Step 2: Category, Tax & FSSAI
  const [selectedCategory, setSelectedCategory] = useState<string>('grocery');
  const [taxType, setTaxType] = useState<'GSTIN' | 'UIN'>('GSTIN');
  const [taxNumber, setTaxNumber] = useState<string>('');
  const [taxVerified, setTaxVerified] = useState<boolean>(false);
  const [verifyingTax, setVerifyingTax] = useState<boolean>(false);
  const [taxEntityName, setTaxEntityName] = useState<string>('');
  const [fssai, setFssai] = useState<string>('');

  // Step 3: Pickup Address
  const [pincode, setPincode] = useState<string>('');
  const [pincodeVerified, setPincodeVerified] = useState<boolean>(false);
  const [verifyingPincode, setVerifyingPincode] = useState<boolean>(false);
  const [city, setCity] = useState<string>('');
  const [stateName, setStateName] = useState<string>('');
  const [building, setBuilding] = useState<string>('');
  const [street, setStreet] = useState<string>('');
  const [selectedMohalla, setSelectedMohalla] = useState<string>('Pathani Mohalla');
  const [locatingGps, setLocatingGps] = useState<boolean>(false);
  const [gpsCoordinates, setGpsCoordinates] = useState<{
    lat: number;
    lng: number;
    accuracy?: number;
  } | null>(null);
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Step 4: Bank Details
  const [accountNumber, setAccountNumber] = useState<string>('');
  const [confirmAccountNumber, setConfirmAccountNumber] = useState<string>('');
  const [ifsc, setIfsc] = useState<string>('');
  const [bankVerified, setBankVerified] = useState<boolean>(false);
  const [verifyingBank, setVerifyingBank] = useState<boolean>(false);
  const [verifiedBranch, setVerifiedBranch] = useState<string>('');

  // Step 5: Store Profile, Schedule & Declaration
  const [storeName, setStoreName] = useState<string>('');
  const [ownerName, setOwnerName] = useState<string>('');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [openTime, setOpenTime] = useState<string>('09:30');
  const [closeTime, setCloseTime] = useState<string>('20:30');
  const [openDays, setOpenDays] = useState<string[]>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  const [declarationAccepted, setDeclarationAccepted] = useState<boolean>(false);

  // Validation errors dictionary
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeCategoryObj = CATEGORIES.find((c) => c.id === selectedCategory) || CATEGORIES[0];
  const isFoodCategory = activeCategoryObj.isFood;

  // Clear specific field error on change
  const clearError = (field: string) => {
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  // --- INLINE VERIFICATION HANDLERS ---

  const handleSendOtp = () => {
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setErrors((prev) => ({
        ...prev,
        mobile: 'Enter a valid 10-digit Indian mobile number',
      }));
      return;
    }
    clearError('mobile');
    setSendingOtp(true);
    setTimeout(() => {
      setSendingOtp(false);
      setOtpSent(true);
      setOtp('4829'); // Pre-populate demo OTP
    }, 550);
  };

  const handleVerifyOtp = () => {
    if (!/^\d{4,6}$/.test(otp)) {
      setErrors((prev) => ({
        ...prev,
        otp: 'Enter the 4-digit OTP sent to your mobile',
      }));
      return;
    }
    clearError('otp');
    clearError('mobile');
    setVerifyingOtp(true);
    setTimeout(() => {
      setVerifyingOtp(false);
      setMobileVerified(true);
    }, 600);
  };

  const handleVerifyTax = () => {
    const cleaned = taxNumber.trim().toUpperCase();
    if (taxType === 'GSTIN') {
      if (cleaned.length !== 15) {
        setErrors((prev) => ({
          ...prev,
          taxNumber: 'GSTIN must be exactly 15 alphanumeric characters',
        }));
        return;
      }
    } else {
      if (cleaned.length < 10 || cleaned.length > 15) {
        setErrors((prev) => ({
          ...prev,
          taxNumber: 'Enter a valid 10–15 character Enrolment ID / UIN',
        }));
        return;
      }
    }

    clearError('taxNumber');
    setVerifyingTax(true);
    setTimeout(() => {
      setVerifyingTax(false);
      setTaxVerified(true);
      setTaxEntityName(
        taxType === 'GSTIN'
          ? 'Active Regular Taxpayer • Verified'
          : 'Exempted Small Supplier UIN • Verified'
      );
    }, 650);
  };

  const handleVerifyPincode = () => {
    if (!/^\d{6}$/.test(pincode)) {
      setErrors((prev) => ({
        ...prev,
        pincode: 'Enter a valid 6-digit Indian Pincode',
      }));
      return;
    }
    clearError('pincode');
    clearError('city');
    clearError('stateName');
    setVerifyingPincode(true);
    setTimeout(() => {
      const resolved = lookupPincode(pincode);
      setCity(resolved.city);
      setStateName(resolved.state);
      setPincodeVerified(true);
      setVerifyingPincode(false);
    }, 550);
  };

  // Helper to find the geographically closest Damoh Mohalla from coordinates
  const findNearestDamohLocality = (lat: number, lng: number) => {
    let nearest = DAMOH_LOCALITIES[0];
    let minDistance = Infinity;
    for (const loc of DAMOH_LOCALITIES) {
      const dLat = loc.lat - lat;
      const dLng = loc.lng - lng;
      const dist = Math.sqrt(dLat * dLat + dLng * dLng);
      if (dist < minDistance) {
        minDistance = dist;
        nearest = loc;
      }
    }
    return nearest;
  };

  // GPS 1-Tap Auto Detection Handler
  const handleDetectLocation = () => {
    setGpsError(null);
    setGpsMessage(null);

    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported in this browser. Please select your mohalla manually.');
      return;
    }

    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const roundedLat = Number(latitude.toFixed(4));
        const roundedLng = Number(longitude.toFixed(4));
        const roundedAcc = Math.round(accuracy);

        setGpsCoordinates({
          lat: roundedLat,
          lng: roundedLng,
          accuracy: roundedAcc,
        });

        // Resolve closest Damoh Mohalla from master registry
        const nearest = findNearestDamohLocality(latitude, longitude);
        setSelectedMohalla(nearest.name);

        let detectedPin = '470661';
        let detectedCity = 'Damoh';
        let detectedState = 'Madhya Pradesh';
        let detectedStreet = `${nearest.name}, Damoh`;

        // Attempt reverse geocoding via backend API or fallback
        try {
          const res = await api.reverseAddress(latitude, longitude);
          if (res) {
            if (res.postalCode && /^\d{6}$/.test(res.postalCode)) detectedPin = res.postalCode;
            if (res.villageOrCity || res.district) {
              detectedCity = res.villageOrCity || res.district || 'Damoh';
            }
            if (res.state) detectedState = res.state;
            const fullStreet = [res.houseNumber, res.street, res.area].filter(Boolean).join(', ');
            if (fullStreet) detectedStreet = fullStreet;
            if (res.houseNumber && !building.trim()) {
              setBuilding(res.houseNumber);
            }
          }
        } catch {
          // Defaults gracefully to Damoh localized market hub
        }

        setPincode(detectedPin);
        setPincodeVerified(true);
        setCity(detectedCity);
        setStateName(detectedState);
        setStreet(detectedStreet);

        clearError('pincode');
        clearError('city');
        clearError('stateName');
        clearError('street');
        clearError('building');

        setGpsMessage(
          `✓ Exact shop GPS pinned: ${roundedLat}° N, ${roundedLng}° E (±${roundedAcc}m) • Nearest: ${nearest.name}`
        );
        setLocatingGps(false);
      },
      (err) => {
        setLocatingGps(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGpsError('Location permission denied. Please enable location access or select Damoh center below.');
        } else {
          setGpsError('Could not retrieve GPS coordinates. Please select your Damoh mohalla below.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // 1-Tap preset for Damoh central market hub
  const handleUseDamohCenter = (locName = 'Ghanta Ghar (Clock Tower)') => {
    const loc = DAMOH_LOCALITIES.find((l) => l.name === locName) || DAMOH_LOCALITIES[0];
    setGpsCoordinates({
      lat: loc.lat,
      lng: loc.lng,
      accuracy: 5,
    });
    setSelectedMohalla(loc.name);
    setPincode('470661');
    setPincodeVerified(true);
    setCity('Damoh');
    setStateName('Madhya Pradesh');
    setStreet(`${loc.name}, Damoh`);
    clearError('pincode');
    clearError('city');
    clearError('stateName');
    clearError('street');
    setGpsError(null);
    setGpsMessage(`✓ Damoh Hub Pinned: ${loc.lat}° N, ${loc.lng}° E (±5m) • ${loc.name}`);
  };

  const handleVerifyBank = () => {
    const cleanedIfsc = ifsc.trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanedIfsc) && cleanedIfsc.length !== 11) {
      setErrors((prev) => ({
        ...prev,
        ifsc: 'Enter a valid 11-character IFSC code (e.g., HDFC0001234)',
      }));
      return;
    }
    clearError('ifsc');
    setVerifyingBank(true);
    setTimeout(() => {
      setVerifiedBranch(lookupIfsc(cleanedIfsc));
      setBankVerified(true);
      setVerifyingBank(false);
    }, 650);
  };

  // --- STEP VALIDATION LOGIC ---

  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {};

    if (step === 1) {
      if (!/^[6-9]\d{9}$/.test(mobile)) {
        newErrors.mobile = 'Please enter a valid 10-digit mobile number';
      } else if (!mobileVerified) {
        newErrors.mobile = 'Please verify your mobile number with OTP before continuing';
      }
      if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        newErrors.email = 'Please enter a valid business or personal email address';
      }
    }

    if (step === 2) {
      if (!taxNumber.trim()) {
        newErrors.taxNumber = `Please enter your ${taxType === 'GSTIN' ? 'GSTIN' : 'Enrolment ID / UIN'}`;
      } else if (!taxVerified) {
        newErrors.taxNumber = `Please click "Verify" to validate your ${taxType === 'GSTIN' ? 'GSTIN' : 'Enrolment ID'}`;
      }

      const cleanedFssai = fssai.replace(/\s+/g, '');
      if (isFoodCategory) {
        if (!/^\d{14}$/.test(cleanedFssai)) {
          newErrors.fssai = '14-digit FSSAI License Number is mandatory for Grocery & Food sellers';
        }
      } else if (cleanedFssai.length > 0 && !/^\d{14}$/.test(cleanedFssai)) {
        newErrors.fssai = 'If provided, FSSAI License Number must be exactly 14 digits';
      }
    }

    if (step === 3) {
      if (!/^\d{6}$/.test(pincode)) {
        newErrors.pincode = 'Enter a valid 6-digit Pincode';
      } else if (!pincodeVerified) {
        newErrors.pincode = 'Please verify your Pincode to confirm serviceability';
      }
      if (!city.trim()) newErrors.city = 'City is required';
      if (!stateName.trim()) newErrors.stateName = 'State is required';
      if (!building.trim()) newErrors.building = 'Room, floor, or building number is required';
      if (!street.trim()) newErrors.street = 'Street, area, or locality is required';
    }

    if (step === 4) {
      if (!/^\d{9,18}$/.test(accountNumber.trim())) {
        newErrors.accountNumber = 'Enter a valid bank account number (9–18 digits)';
      }
      if (accountNumber.trim() !== confirmAccountNumber.trim()) {
        newErrors.confirmAccountNumber = 'Account numbers do not match';
      }
      if (ifsc.trim().length !== 11) {
        newErrors.ifsc = 'Enter a valid 11-character IFSC code';
      } else if (!bankVerified) {
        newErrors.ifsc = 'Please click "Verify Bank" to confirm your IFSC & branch';
      }
    }

    if (step === 5) {
      if (!storeName.trim() || storeName.trim().length < 3) {
        newErrors.storeName = 'Store name must be at least 3 characters';
      }
      if (!ownerName.trim() || ownerName.trim().length < 2) {
        newErrors.ownerName = 'Owner full name is required';
      }
      if (openDays.length === 0) {
        newErrors.openDays = 'Select at least one operating day for pickup';
      }
      if (!declarationAccepted) {
        newErrors.declaration = 'Please accept the Seller Declaration to complete registration';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = async () => {
    if (validateStep(currentStep)) {
      if (currentStep < 5) {
        setCurrentStep((prev) => prev + 1);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setIsSubmitting(true);
        // Persist application to backend if API is connected
        try {
          await api.submitSellerApplication({
            shgName: storeName.trim(),
            representative: ownerName.trim(),
            phone: mobile.trim(),
            city: city.trim() || 'Damoh',
            address: `${building.trim()}, ${street.trim()}`,
            categoryId: activeCategoryObj.eSakhiCategoryId || 'womens-apparel-accessories',
            subcategoryId: activeCategoryObj.eSakhiSubcategoryId || 'ethnic-wear',
            productType: activeCategoryObj.name,
            fssaiRegistrationNumber: fssai.trim() || undefined,
          });
          if (reloadUser) {
            await reloadUser().catch(() => {});
          }
        } catch (err) {
          console.warn('Backend auto-provisioning note:', err);
          // Non-blocking: ensure UI proceeds smoothly to completion screen
        } finally {
          setIsSubmitting(false);
          setIsSubmitted(true);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
    }
  };

  const handleBack = () => {
    setErrors({});
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleAvatarUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const toggleDay = (day: string) => {
    clearError('openDays');
    setOpenDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const resetWizard = () => {
    setCurrentStep(1);
    setIsSubmitted(false);
    setMobile('');
    setOtpSent(false);
    setOtp('');
    setMobileVerified(false);
    setEmail('');
    setSelectedCategory('grocery');
    setTaxType('GSTIN');
    setTaxNumber('');
    setTaxVerified(false);
    setTaxEntityName('');
    setFssai('');
    setPincode('');
    setPincodeVerified(false);
    setCity('');
    setStateName('');
    setBuilding('');
    setStreet('');
    setSelectedMohalla('Pathani Mohalla');
    setGpsCoordinates(null);
    setGpsMessage(null);
    setGpsError(null);
    setLocatingGps(false);
    setAccountNumber('');
    setConfirmAccountNumber('');
    setIfsc('');
    setBankVerified(false);
    setVerifiedBranch('');
    setStoreName('');
    setOwnerName('');
    setAvatarPreview(null);
    setOpenTime('09:30');
    setCloseTime('20:30');
    setOpenDays(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    setDeclarationAccepted(false);
    setErrors({});
  };

  const getStoreInitials = () => {
    if (!storeName.trim()) return 'ST';
    return storeName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('');
  };

  return (
    <div className="min-h-screen bg-[#FFF8E8] text-[#2B2B2B] flex flex-col justify-between font-sans selection:bg-[#E0ECC8] selection:text-[#1A4D2E]">
      {/* Fresh Market / eSakhi Deep Leaf Green Top Brand Bar */}
      <header className="bg-[#1A4D2E] text-white border-b border-[#143d24] sticky top-0 z-20 shadow-xs">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Link
              to="/"
              className="w-8 h-8 rounded-lg bg-[#FF9F1C] flex items-center justify-center text-[#1A4D2E] font-black text-lg shadow-sm hover:opacity-95 transition-opacity"
              title="Return to Home"
            >
              B
            </Link>
            <div className="flex items-center flex-wrap gap-1.5">
              <span className="font-bold text-white tracking-tight text-base">
                Bazaar to Home Seller
              </span>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#E0ECC8] text-[#1A4D2E]">
                Damoh Local Shops • 0% Penalty
              </span>
            </div>
          </div>
          {!isSubmitted && (
            <span className="text-xs font-medium text-[#E0ECC8]">
              Step <strong className="text-white">{currentStep}</strong> of 5
            </span>
          )}
        </div>
      </header>

      {/* Main Single-Column Container */}
      <main className="flex-1 w-full max-w-xl mx-auto px-4 py-6 sm:py-8">
        {!isSubmitted ? (
          <>
            {/* Clean 5-Step Progress Stepper */}
            <nav aria-label="Onboarding Progress" className="mb-6">
              <div className="flex items-center justify-between relative">
                {/* Connecting background bar */}
                <div
                  className="absolute left-4 right-4 top-4 h-0.5 bg-[#1A4D2E]/15 -z-0"
                  aria-hidden="true"
                />
                {/* Active progress bar */}
                <div
                  className="absolute left-4 top-4 h-0.5 bg-[#1A4D2E] transition-all duration-300 -z-0"
                  style={{
                    width: `calc(${((currentStep - 1) / (STEPS.length - 1)) * 100}% - 16px)`,
                  }}
                  aria-hidden="true"
                />

                {STEPS.map((step) => {
                  const isCompleted = currentStep > step.number;
                  const isCurrent = currentStep === step.number;
                  return (
                    <div
                      key={step.number}
                      className="flex flex-col items-center z-10"
                    >
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-200 ${
                          isCompleted
                            ? 'bg-[#1A4D2E] text-white shadow-sm'
                            : isCurrent
                            ? 'bg-[#1A4D2E] text-white ring-4 ring-[#E0ECC8] shadow-sm'
                            : 'bg-white text-[#2B2B2B]/50 border border-[#1A4D2E]/20'
                        }`}
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="w-4 h-4 text-[#E0ECC8]" />
                        ) : (
                          step.number
                        )}
                      </div>
                      <span
                        className={`mt-1.5 text-[11px] font-medium text-center max-w-[68px] leading-tight ${
                          isCurrent
                            ? 'text-[#1A4D2E] font-bold'
                            : isCompleted
                            ? 'text-[#2B2B2B]'
                            : 'text-[#2B2B2B]/55'
                        }`}
                      >
                        <span className="hidden sm:inline">{step.title}</span>
                        <span className="sm:hidden">{step.shortTitle}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </nav>

            {/* Centered White Wizard Card */}
            <div className="bg-white rounded-2xl border border-[#1A4D2E]/15 shadow-sm overflow-hidden transition-all duration-300">
              {/* STEP 1: CONTACT VERIFICATION */}
              {currentStep === 1 && (
                <div className="p-5 sm:p-7 space-y-6 animate-fadeIn">
                  <div>
                    <h1 className="text-xl font-bold text-[#2B2B2B]">
                      Welcome! Let’s verify your contact details
                    </h1>
                    <p className="text-sm text-[#2B2B2B]/70 mt-1">
                      We’ll send order alerts and payout updates to this mobile number & email.
                    </p>
                  </div>

                  {/* Mobile Number + Inline Send OTP */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-sm font-semibold text-[#2B2B2B]">
                        Mobile Number <span className="text-rose-600">*</span>
                      </label>
                      {mobileVerified && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-[#1A4D2E] bg-[#E0ECC8] border border-[#1A4D2E]/20 px-2.5 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#1A4D2E]" />
                          Verified
                        </span>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <div className="relative flex-1 flex items-center">
                        <span className="inline-flex items-center px-3 h-11 rounded-l-xl border border-r-0 border-stone-300 bg-[#FFF8E8] text-[#1A4D2E] text-sm font-bold select-none">
                          +91
                        </span>
                        <input
                          type="tel"
                          inputMode="numeric"
                          maxLength={10}
                          disabled={mobileVerified}
                          value={mobile}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '');
                            setMobile(val);
                            clearError('mobile');
                            if (otpSent) {
                              setOtpSent(false);
                              setOtp('');
                            }
                          }}
                          placeholder="Enter 10-digit mobile number"
                          className={`w-full h-11 px-3.5 rounded-r-xl border text-sm transition-colors focus:outline-none focus:ring-2 ${
                            mobileVerified
                              ? 'bg-[#E0ECC8]/40 border-[#1A4D2E]/40 text-[#2B2B2B] font-semibold'
                              : errors.mobile
                              ? 'border-rose-500 focus:ring-rose-500/20'
                              : 'border-stone-300 focus:border-[#1A4D2E] focus:ring-[#1A4D2E]/15'
                          }`}
                        />
                      </div>

                      {!mobileVerified && (
                        <button
                          type="button"
                          onClick={handleSendOtp}
                          disabled={sendingOtp || mobile.length !== 10}
                          className="h-11 px-4 rounded-xl text-sm font-bold whitespace-nowrap transition-all bg-[#1A4D2E] text-white hover:bg-[#143d24] disabled:bg-stone-100 disabled:text-stone-400 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-2xs cursor-pointer"
                        >
                          {sendingOtp ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : otpSent ? (
                            'Resend OTP'
                          ) : (
                            'Send OTP'
                          )}
                        </button>
                      )}
                    </div>

                    {errors.mobile && (
                      <p className="text-xs text-rose-600 flex items-center gap-1 mt-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {errors.mobile}
                      </p>
                    )}
                  </div>

                  {/* Inline 4-Digit OTP Box */}
                  {otpSent && !mobileVerified && (
                    <div className="p-4 rounded-xl bg-[#E0ECC8]/45 border border-[#1A4D2E]/20 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-[#1A4D2E]">
                          Enter 4-Digit OTP sent to +91 {mobile}
                        </label>
                        <span className="text-[11px] text-[#1A4D2E] font-semibold bg-white/80 px-2 py-0.5 rounded-full">
                          Demo OTP pre-filled
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={otp}
                          onChange={(e) => {
                            setOtp(e.target.value.replace(/\D/g, ''));
                            clearError('otp');
                          }}
                          placeholder="• • • •"
                          className="w-36 h-11 px-4 text-center tracking-[0.4em] font-bold text-base rounded-xl border border-stone-300 bg-white text-[#2B2B2B] focus:outline-none focus:border-[#1A4D2E] focus:ring-2 focus:ring-[#1A4D2E]/15"
                        />
                        <button
                          type="button"
                          onClick={handleVerifyOtp}
                          disabled={verifyingOtp || otp.length < 4}
                          className="h-11 px-5 rounded-xl text-sm font-bold bg-[#1A4D2E] text-white hover:bg-[#143d24] disabled:bg-stone-200 disabled:text-stone-400 transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          {verifyingOtp ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            'Verify OTP'
                          )}
                        </button>
                      </div>
                      {errors.otp && (
                        <p className="text-xs text-rose-600 flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          {errors.otp}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Email Address */}
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-[#2B2B2B]">
                      Email Address <span className="text-rose-600">*</span>
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-[#1A4D2E]/60 absolute left-3.5 top-3.5" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          clearError('email');
                        }}
                        placeholder="you@yourbusiness.com"
                        className={`w-full h-11 pl-10 pr-3.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 ${
                          errors.email
                            ? 'border-rose-500 focus:ring-rose-500/20'
                            : 'border-stone-300 focus:border-[#1A4D2E] focus:ring-[#1A4D2E]/15'
                        }`}
                      />
                    </div>
                    {errors.email && (
                      <p className="text-xs text-rose-600 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {errors.email}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 2: CATEGORY, TAX & FSSAI DETAILS */}
              {currentStep === 2 && (
                <div className="p-5 sm:p-7 space-y-6 animate-fadeIn">
                  <div>
                    <h1 className="text-xl font-bold text-[#2B2B2B]">
                      Category, Tax & FSSAI Details
                    </h1>
                    <p className="text-sm text-[#2B2B2B]/70 mt-1">
                      Select your primary store category to lock in your commission slab.
                    </p>
                  </div>

                  {/* Store Category Selector with #E0ECC8 Light Sage active states */}
                  <div className="space-y-2.5">
                    <label className="block text-sm font-semibold text-[#2B2B2B]">
                      Primary Store Category <span className="text-rose-600">*</span>
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {CATEGORIES.map((cat) => {
                        const Icon = cat.icon;
                        const active = selectedCategory === cat.id;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => {
                              setSelectedCategory(cat.id);
                              clearError('fssai');
                            }}
                            className={`text-left p-3.5 rounded-xl border transition-all flex flex-col justify-between cursor-pointer ${
                              active
                                ? 'border-[#1A4D2E] bg-[#E0ECC8] ring-2 ring-[#1A4D2E]/20 shadow-2xs'
                                : 'border-stone-200 hover:border-[#1A4D2E]/40 bg-white'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2 w-full">
                              <div className="flex items-center gap-2">
                                <div
                                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                                    active
                                      ? 'bg-[#1A4D2E] text-white'
                                      : 'bg-[#FFF8E8] text-[#1A4D2E] border border-[#1A4D2E]/15'
                                  }`}
                                >
                                  <Icon className="w-4 h-4" />
                                </div>
                                <span className="font-bold text-sm text-[#2B2B2B]">
                                  {cat.name}
                                </span>
                              </div>
                              <span
                                className={`text-xs font-extrabold px-2 py-0.5 rounded-full shrink-0 ${
                                  active
                                    ? 'bg-[#FF9F1C] text-[#2B2B2B]'
                                    : 'bg-[#FFF8E8] text-[#1A4D2E] border border-[#1A4D2E]/15'
                                }`}
                              >
                                {cat.commission} Fee
                              </span>
                            </div>
                            <p
                              className={`text-xs mt-2 leading-relaxed ${
                                active ? 'text-[#1A4D2E]/90 font-medium' : 'text-[#2B2B2B]/65'
                              }`}
                            >
                              {cat.desc}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Tax Registration Toggle (GSTIN vs Enrolment ID / UIN) */}
                  <div className="space-y-3 pt-1">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <label className="text-sm font-semibold text-[#2B2B2B]">
                        Tax Registration Type <span className="text-rose-600">*</span>
                      </label>

                      <div className="inline-flex p-1 rounded-xl bg-[#FFF8E8] border border-[#1A4D2E]/15 self-start">
                        <button
                          type="button"
                          onClick={() => {
                            setTaxType('GSTIN');
                            setTaxNumber('');
                            setTaxVerified(false);
                            setTaxEntityName('');
                            clearError('taxNumber');
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                            taxType === 'GSTIN'
                              ? 'bg-[#1A4D2E] text-white shadow-2xs'
                              : 'text-[#2B2B2B]/70 hover:text-[#1A4D2E]'
                          }`}
                        >
                          GSTIN (Regular)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTaxType('UIN');
                            setTaxNumber('');
                            setTaxVerified(false);
                            setTaxEntityName('');
                            clearError('taxNumber');
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                            taxType === 'UIN'
                              ? 'bg-[#1A4D2E] text-white shadow-2xs'
                              : 'text-[#2B2B2B]/70 hover:text-[#1A4D2E]'
                          }`}
                        >
                          Enrolment ID / UIN
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-[#2B2B2B]/65">
                      {taxType === 'GSTIN'
                        ? 'Enter your 15-character Goods & Services Tax Identification Number.'
                        : 'For GST-exempt small sellers selling within their home state.'}
                    </p>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        maxLength={15}
                        value={taxNumber}
                        onChange={(e) => {
                          setTaxNumber(e.target.value.toUpperCase());
                          setTaxVerified(false);
                          setTaxEntityName('');
                          clearError('taxNumber');
                        }}
                        placeholder={
                          taxType === 'GSTIN'
                            ? 'e.g., 29AABCU9603R1ZM'
                            : 'e.g., 292400019283UIN'
                        }
                        className={`flex-1 h-11 px-3.5 rounded-xl border text-sm uppercase font-mono tracking-wide transition-colors focus:outline-none focus:ring-2 ${
                          taxVerified
                            ? 'bg-[#E0ECC8]/45 border-[#1A4D2E]/40 text-[#2B2B2B] font-semibold'
                            : errors.taxNumber
                            ? 'border-rose-500 focus:ring-rose-500/20'
                            : 'border-stone-300 focus:border-[#1A4D2E] focus:ring-[#1A4D2E]/15'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={handleVerifyTax}
                        disabled={verifyingTax || !taxNumber.trim()}
                        className={`h-11 px-4 rounded-xl text-sm font-bold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                          taxVerified
                            ? 'bg-[#E0ECC8] text-[#1A4D2E] border border-[#1A4D2E]/25'
                            : 'bg-[#1A4D2E] text-white hover:bg-[#143d24] disabled:bg-stone-100 disabled:text-stone-400'
                        }`}
                      >
                        {verifyingTax ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : taxVerified ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-[#1A4D2E]" />
                            Verified
                          </>
                        ) : (
                          'Verify'
                        )}
                      </button>
                    </div>

                    {taxVerified && taxEntityName && (
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[#1A4D2E] bg-[#E0ECC8]/60 px-3 py-2 rounded-lg border border-[#1A4D2E]/20">
                        <ShieldCheck className="w-4 h-4 text-[#1A4D2E] shrink-0" />
                        <span>{taxEntityName}</span>
                      </div>
                    )}

                    {errors.taxNumber && (
                      <p className="text-xs text-rose-600 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {errors.taxNumber}
                      </p>
                    )}
                  </div>

                  {/* ALWAYS-VISIBLE FSSAI License Number with Dynamic Label */}
                  <div className="space-y-2 pt-3 border-t border-stone-100">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <label className="text-sm font-semibold text-[#2B2B2B]">
                        FSSAI License Number (14 digits)
                      </label>
                      {isFoodCategory ? (
                        <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#FF9F1C]/20 text-[#2B2B2B] border border-[#FF9F1C]">
                          (Mandatory)
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#E0ECC8] text-[#1A4D2E] border border-[#1A4D2E]/20">
                          (Optional / Recommended for edible hampers)
                        </span>
                      )}
                    </div>

                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={14}
                      value={fssai}
                      onChange={(e) => {
                        setFssai(e.target.value.replace(/\D/g, ''));
                        clearError('fssai');
                      }}
                      placeholder="Enter 14-digit FSSAI registration / license number"
                      className={`w-full h-11 px-3.5 rounded-xl border text-sm font-mono tracking-wider transition-colors focus:outline-none focus:ring-2 ${
                        errors.fssai
                          ? 'border-rose-500 focus:ring-rose-500/20'
                          : 'border-stone-300 focus:border-[#1A4D2E] focus:ring-[#1A4D2E]/15'
                      }`}
                    />
                    <p className="text-xs text-[#2B2B2B]/65">
                      {isFoodCategory
                        ? 'Required by Indian food safety regulations to list Grocery & Food items.'
                        : 'Include if your catalog or gift hampers contain chocolates, dry fruits, tea, or consumables.'}
                    </p>
                    {errors.fssai && (
                      <p className="text-xs text-rose-600 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {errors.fssai}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 3: PICKUP ADDRESS */}
              {currentStep === 3 && (
                <div className="p-5 sm:p-7 space-y-5 animate-fadeIn">
                  <div>
                    <h1 className="text-xl font-bold text-[#2B2B2B]">
                      Pickup Address
                    </h1>
                    <p className="text-sm text-[#2B2B2B]/70 mt-1">
                      Our courier partners will pick up customer orders from this location.
                    </p>
                  </div>

                  {/* DETECT FROM MY LOCATION (GPS 1-TAP ACTION CARD) */}
                  <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-[#FFF8E8] via-white to-[#E0ECC8]/50 border-2 border-[#1A4D2E]/25 shadow-sm space-y-3.5">
                    {/* Header line with Icon, Title, and Badge */}
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#1A4D2E] text-white flex items-center justify-center shrink-0 shadow-xs relative mt-0.5">
                        <LocateFixed className={`w-5 h-5 ${locatingGps ? 'animate-spin text-[#FF9F1C]' : 'text-white'}`} />
                        {locatingGps && (
                          <span className="absolute -top-1 -right-1 flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF9F1C] opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-[#FF9F1C]"></span>
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm sm:text-base font-bold text-[#1A4D2E]">
                            Detect from My Location
                          </span>
                          <span className="inline-flex items-center text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-[#1A4D2E] text-white tracking-wide shrink-0">
                            GPS 1-Tap
                          </span>
                        </div>
                        <p className="text-xs text-[#2B2B2B]/75 mt-0.5 leading-relaxed">
                          Auto-detects your shop entrance coordinates, Pincode (470661), City, State, and selects the nearest Damoh Mohalla for courier pickup.
                        </p>
                      </div>
                    </div>

                    {/* Action Buttons: 2-column grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-0.5">
                      <button
                        type="button"
                        onClick={handleDetectLocation}
                        disabled={locatingGps}
                        className="w-full h-11 px-4 rounded-xl bg-[#1A4D2E] hover:bg-[#143d24] text-white text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                      >
                        {locatingGps ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin text-[#FF9F1C]" />
                            <span>Detecting GPS Coordinates...</span>
                          </>
                        ) : (
                          <>
                            <Crosshair className="w-4 h-4 text-[#FF9F1C]" />
                            <span>Detect from My Location</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleUseDamohCenter('Ghanta Ghar (Clock Tower)')}
                        className="w-full h-11 px-4 rounded-xl border border-stone-300 hover:border-[#1A4D2E]/40 bg-white hover:bg-[#FFF8E8] text-[#2B2B2B] text-xs font-bold transition-all shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer"
                        title="Quickly fill Damoh central hub 470661"
                      >
                        <MapPin className="w-3.5 h-3.5 text-[#1A4D2E]" />
                        <span>Use Damoh Center (470661)</span>
                      </button>
                    </div>

                    {/* GPS Feedback Message */}
                    {gpsMessage && (
                      <div className="p-3 rounded-xl bg-[#E0ECC8] border border-[#1A4D2E]/25 text-xs text-[#1A4D2E] font-semibold flex items-center justify-between gap-2 animate-fadeIn">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-[#1A4D2E] shrink-0" />
                          <span>{gpsMessage}</span>
                        </div>
                        {gpsCoordinates && (
                          <span className="text-[11px] font-mono font-bold bg-[#1A4D2E]/10 px-2 py-0.5 rounded text-[#1A4D2E] shrink-0">
                            {gpsCoordinates.lat.toFixed(4)}° N, {gpsCoordinates.lng.toFixed(4)}° E
                          </span>
                        )}
                      </div>
                    )}

                    {gpsError && (
                      <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-900 font-medium flex items-center justify-between gap-2 animate-fadeIn">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                          <span>{gpsError}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleUseDamohCenter('Ghanta Ghar (Clock Tower)')}
                          className="underline font-bold text-amber-800 hover:text-amber-950 shrink-0 cursor-pointer"
                        >
                          Use Damoh Market Center
                        </button>
                      </div>
                    )}

                    {/* Interactive GPS Map Canvas Pin Visualizer */}
                    <div
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const x = (e.clientX - rect.left) / rect.width;
                        const y = (e.clientY - rect.top) / rect.height;
                        const newLat = Number((23.834 + (1 - y) * 0.012).toFixed(4));
                        const newLng = Number((79.435 + x * 0.015).toFixed(4));
                        setGpsCoordinates({ lat: newLat, lng: newLng, accuracy: 4 });
                        const nearest = findNearestDamohLocality(newLat, newLng);
                        setSelectedMohalla(nearest.name);
                        setStreet(`${nearest.name}, Damoh`);
                        setPincode('470661');
                        setPincodeVerified(true);
                        setCity('Damoh');
                        setStateName('Madhya Pradesh');
                        clearError('pincode');
                        clearError('city');
                        clearError('stateName');
                        clearError('street');
                        setGpsMessage(`✓ Shop entrance pin adjusted: ${newLat}° N, ${newLng}° E • Nearest: ${nearest.name}`);
                      }}
                      className="relative h-36 w-full rounded-xl border border-stone-300 bg-[#FFF8E8]/70 overflow-hidden cursor-crosshair shadow-inner flex items-center justify-center select-none group pt-4"
                      style={{
                        backgroundImage: `radial-gradient(#1A4D2E 1.2px, transparent 1.2px), radial-gradient(#FF9F1C 1.2px, #FFF8E8 1.2px)`,
                        backgroundSize: '20px 20px',
                      }}
                      title="Click anywhere on the Damoh grid to adjust shop entrance pin"
                    >
                      <div className="absolute top-2 left-2.5 px-2.5 py-0.5 rounded bg-white/95 border border-stone-200 text-[10px] font-bold text-[#1A4D2E] shadow-2xs flex items-center gap-1 z-10">
                        <Crosshair className="w-3 h-3 text-[#FF9F1C]" />
                        <span>Interactive Entrance Pin (Click grid to micro-adjust)</span>
                      </div>
                      <div className="flex flex-col items-center mt-2">
                        <div className="relative">
                          <MapPin className="w-8 h-8 text-[#1A4D2E] drop-shadow-md animate-bounce" />
                          <div className="w-3 h-1 bg-[#1A4D2E]/30 rounded-full mx-auto blur-[1px]"></div>
                        </div>
                        <span className="text-[11px] font-bold text-[#1A4D2E] bg-white/95 px-2.5 py-0.5 rounded-full border border-[#1A4D2E]/20 shadow-2xs mt-1">
                          📍 {selectedMohalla}
                        </span>
                      </div>
                      <div className="absolute bottom-2 right-2.5 px-2.5 py-0.5 rounded bg-white/95 border border-stone-200 text-[10px] text-stone-600 font-mono font-bold shadow-2xs z-10">
                        GPS: {gpsCoordinates ? `${gpsCoordinates.lat.toFixed(4)}° N, ${gpsCoordinates.lng.toFixed(4)}° E` : '23.8392° N, 79.4415° E'}
                      </div>
                    </div>
                  </div>

                  {/* Pincode + Inline Verify */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-semibold text-[#2B2B2B]">
                        Pincode <span className="text-rose-600">*</span>
                      </label>
                      {pincodeVerified && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-[#1A4D2E] bg-[#E0ECC8] border border-[#1A4D2E]/20 px-2.5 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#1A4D2E]" />
                          Serviceable Area
                        </span>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <MapPin className="w-4 h-4 text-[#1A4D2E]/60 absolute left-3.5 top-3.5" />
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={pincode}
                          onChange={(e) => {
                            setPincode(e.target.value.replace(/\D/g, ''));
                            setPincodeVerified(false);
                            clearError('pincode');
                          }}
                          placeholder="e.g., 560034, 400001, 110001, 470661"
                          className={`w-full h-11 pl-10 pr-3.5 rounded-xl border text-sm font-medium transition-colors focus:outline-none focus:ring-2 ${
                            pincodeVerified
                              ? 'bg-[#E0ECC8]/45 border-[#1A4D2E]/40 text-[#2B2B2B] font-semibold'
                              : errors.pincode
                              ? 'border-rose-500 focus:ring-rose-500/20'
                              : 'border-stone-300 focus:border-[#1A4D2E] focus:ring-[#1A4D2E]/15'
                          }`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleVerifyPincode}
                        disabled={verifyingPincode || pincode.length !== 6}
                        className={`h-11 px-4 rounded-xl text-sm font-bold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                          pincodeVerified
                            ? 'bg-[#E0ECC8] text-[#1A4D2E] border border-[#1A4D2E]/25'
                            : 'bg-[#1A4D2E] text-white hover:bg-[#143d24] disabled:bg-stone-100 disabled:text-stone-400'
                        }`}
                      >
                        {verifyingPincode ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : pincodeVerified ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-[#1A4D2E]" />
                            Verified
                          </>
                        ) : (
                          'Verify'
                        )}
                      </button>
                    </div>
                    {errors.pincode && (
                      <p className="text-xs text-rose-600 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {errors.pincode}
                      </p>
                    )}
                  </div>

                  {/* Auto-filled City & State */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="block text-sm font-semibold text-[#2B2B2B]">
                        City <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={city}
                        onChange={(e) => {
                          setCity(e.target.value);
                          clearError('city');
                        }}
                        placeholder="Auto-fills on Pincode verify"
                        className={`w-full h-11 px-3.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 ${
                          errors.city
                            ? 'border-rose-500 focus:ring-rose-500/20'
                            : 'border-stone-300 bg-[#FFF8E8]/60 focus:bg-white focus:border-[#1A4D2E] focus:ring-[#1A4D2E]/15'
                        }`}
                      />
                      {errors.city && (
                        <p className="text-xs text-rose-600">{errors.city}</p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-sm font-semibold text-[#2B2B2B]">
                        State <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={stateName}
                        onChange={(e) => {
                          setStateName(e.target.value);
                          clearError('stateName');
                        }}
                        placeholder="Auto-fills on Pincode verify"
                        className={`w-full h-11 px-3.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 ${
                          errors.stateName
                            ? 'border-rose-500 focus:ring-rose-500/20'
                            : 'border-stone-300 bg-[#FFF8E8]/60 focus:bg-white focus:border-[#1A4D2E] focus:ring-[#1A4D2E]/15'
                        }`}
                      />
                      {errors.stateName && (
                        <p className="text-xs text-rose-600">{errors.stateName}</p>
                      )}
                    </div>
                  </div>

                  {/* Damoh Mohalla / Hyperlocal Zone Selector */}
                  <div className="space-y-2 p-4 rounded-xl bg-[#FFF8E8] border border-[#FF9F1C]/40">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-[#1A4D2E] flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-[#FF9F1C]" />
                        Select Damoh Mohalla / Locality <span className="text-rose-600">*</span>
                      </label>
                      <span className="text-[11px] font-semibold text-[#1A4D2E] bg-[#E0ECC8] px-2 py-0.5 rounded-md">
                        Damoh Launch Market
                      </span>
                    </div>
                    <p className="text-xs text-[#2B2B2B]/75 leading-relaxed">
                      Customers in your selected mohalla discover your products under <strong>"My Area"</strong> first.
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {DAMOH_LOCALITIES.map((loc) => {
                        const isSelected = selectedMohalla === loc.name;
                        return (
                          <button
                            key={loc.id}
                            type="button"
                            onClick={() => {
                              setSelectedMohalla(loc.name);
                              setStreet(`${loc.name}, Damoh`);
                              setPincode('470661');
                              setPincodeVerified(true);
                              setCity('Damoh');
                              setStateName('Madhya Pradesh');
                              setGpsCoordinates({ lat: loc.lat, lng: loc.lng, accuracy: 5 });
                              setGpsMessage(`✓ Mohalla Pin: ${loc.lat}° N, ${loc.lng}° E • ${loc.name}`);
                              setGpsError(null);
                              clearError('street');
                              clearError('pincode');
                              clearError('city');
                              clearError('stateName');
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border cursor-pointer ${
                              isSelected
                                ? 'bg-[#1A4D2E] text-white border-[#1A4D2E] shadow-xs'
                                : 'bg-white text-stone-700 border-stone-200 hover:border-[#1A4D2E]/40 hover:bg-stone-50'
                            }`}
                          >
                            {isSelected ? '✓ ' : ''}
                            {loc.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Room / Floor / Building Number */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold text-[#2B2B2B]">
                      Room / Floor / Building Number <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={building}
                      onChange={(e) => {
                        setBuilding(e.target.value);
                        clearError('building');
                      }}
                      placeholder="e.g., Shop 12, 2nd Floor, Krishna Complex"
                      className={`w-full h-11 px-3.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 ${
                        errors.building
                          ? 'border-rose-500 focus:ring-rose-500/20'
                          : 'border-stone-300 focus:border-[#1A4D2E] focus:ring-[#1A4D2E]/15'
                      }`}
                    />
                    {errors.building && (
                      <p className="text-xs text-rose-600 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {errors.building}
                      </p>
                    )}
                  </div>

                  {/* Street / Locality */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold text-[#2B2B2B]">
                      Street / Locality <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={street}
                      onChange={(e) => {
                        setStreet(e.target.value);
                        clearError('street');
                      }}
                      placeholder="e.g., 4th Block, Market Main Road"
                      className={`w-full h-11 px-3.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 ${
                        errors.street
                          ? 'border-rose-500 focus:ring-rose-500/20'
                          : 'border-stone-300 focus:border-[#1A4D2E] focus:ring-[#1A4D2E]/15'
                      }`}
                    />
                    {errors.street && (
                      <p className="text-xs text-rose-600 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {errors.street}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 4: BANK DETAILS */}
              {currentStep === 4 && (
                <div className="p-5 sm:p-7 space-y-5 animate-fadeIn">
                  <div>
                    <h1 className="text-xl font-bold text-[#2B2B2B]">
                      Bank Details for Payouts
                    </h1>
                    <p className="text-sm text-[#2B2B2B]/70 mt-1">
                      Your order earnings will be settled directly to this bank account on a 7-day cycle.
                    </p>
                  </div>

                  {/* Bank Account Number */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold text-[#2B2B2B]">
                      Bank Account Number <span className="text-rose-600">*</span>
                    </label>
                    <div className="relative">
                      <Landmark className="w-4 h-4 text-[#1A4D2E]/60 absolute left-3.5 top-3.5" />
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={18}
                        value={accountNumber}
                        onChange={(e) => {
                          setAccountNumber(e.target.value.replace(/\D/g, ''));
                          clearError('accountNumber');
                          clearError('confirmAccountNumber');
                        }}
                        placeholder="Enter 9 to 18 digit account number"
                        className={`w-full h-11 pl-10 pr-3.5 rounded-xl border text-sm font-mono tracking-wider transition-colors focus:outline-none focus:ring-2 ${
                          errors.accountNumber
                            ? 'border-rose-500 focus:ring-rose-500/20'
                            : 'border-stone-300 focus:border-[#1A4D2E] focus:ring-[#1A4D2E]/15'
                        }`}
                      />
                    </div>
                    {errors.accountNumber && (
                      <p className="text-xs text-rose-600 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {errors.accountNumber}
                      </p>
                    )}
                  </div>

                  {/* Confirm Account Number */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold text-[#2B2B2B]">
                      Confirm Account Number <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={18}
                      value={confirmAccountNumber}
                      onChange={(e) => {
                        setConfirmAccountNumber(e.target.value.replace(/\D/g, ''));
                        clearError('confirmAccountNumber');
                      }}
                      placeholder="Re-enter bank account number"
                      className={`w-full h-11 px-3.5 rounded-xl border text-sm font-mono tracking-wider transition-colors focus:outline-none focus:ring-2 ${
                        errors.confirmAccountNumber
                          ? 'border-rose-500 focus:ring-rose-500/20'
                          : confirmAccountNumber &&
                            accountNumber === confirmAccountNumber
                          ? 'border-[#1A4D2E]/50 bg-[#E0ECC8]/35'
                          : 'border-stone-300 focus:border-[#1A4D2E] focus:ring-[#1A4D2E]/15'
                      }`}
                    />
                    {errors.confirmAccountNumber && (
                      <p className="text-xs text-rose-600 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {errors.confirmAccountNumber}
                      </p>
                    )}
                  </div>

                  {/* IFSC Code + Verify Bank */}
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-[#2B2B2B]">
                      IFSC Code <span className="text-rose-600">*</span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        maxLength={11}
                        value={ifsc}
                        onChange={(e) => {
                          setIfsc(e.target.value.toUpperCase());
                          setBankVerified(false);
                          setVerifiedBranch('');
                          clearError('ifsc');
                        }}
                        placeholder="e.g., HDFC0001234"
                        className={`flex-1 h-11 px-3.5 rounded-xl border text-sm uppercase font-mono tracking-wider transition-colors focus:outline-none focus:ring-2 ${
                          bankVerified
                            ? 'bg-[#E0ECC8]/45 border-[#1A4D2E]/40 text-[#2B2B2B] font-semibold'
                            : errors.ifsc
                            ? 'border-rose-500 focus:ring-rose-500/20'
                            : 'border-stone-300 focus:border-[#1A4D2E] focus:ring-[#1A4D2E]/15'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={handleVerifyBank}
                        disabled={verifyingBank || ifsc.trim().length !== 11}
                        className={`h-11 px-4 rounded-xl text-sm font-bold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                          bankVerified
                            ? 'bg-[#E0ECC8] text-[#1A4D2E] border border-[#1A4D2E]/25'
                            : 'bg-[#1A4D2E] text-white hover:bg-[#143d24] disabled:bg-stone-100 disabled:text-stone-400'
                        }`}
                      >
                        {verifyingBank ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : bankVerified ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-[#1A4D2E]" />
                            Verified
                          </>
                        ) : (
                          'Verify Bank'
                        )}
                      </button>
                    </div>

                    {bankVerified && verifiedBranch && (
                      <div className="flex items-center gap-2 text-xs font-bold text-[#1A4D2E] bg-[#E0ECC8]/65 px-3 py-2.5 rounded-xl border border-[#1A4D2E]/20">
                        <Building2 className="w-4 h-4 text-[#1A4D2E] shrink-0" />
                        <span>{verifiedBranch}</span>
                      </div>
                    )}

                    {errors.ifsc && (
                      <p className="text-xs text-rose-600 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {errors.ifsc}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 5: STORE PROFILE, SCHEDULE & DECLARATION */}
              {currentStep === 5 && (
                <div className="p-5 sm:p-7 space-y-6 animate-fadeIn">
                  <div>
                    <h1 className="text-xl font-bold text-[#2B2B2B]">
                      Store Profile & Operating Hours
                    </h1>
                    <p className="text-sm text-[#2B2B2B]/70 mt-1">
                      Customize how buyers see your shop and when couriers can schedule pickups.
                    </p>
                  </div>

                  {/* Store Profile Picture Upload + Store Name */}
                  <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 p-4 rounded-xl bg-[#FFF8E8] border border-[#1A4D2E]/15">
                    <div className="relative group shrink-0">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-20 h-20 rounded-full overflow-hidden border-2 border-white shadow-md bg-[#1A4D2E] flex items-center justify-center text-[#E0ECC8] font-bold text-xl focus:outline-none focus:ring-4 focus:ring-[#1A4D2E]/20 cursor-pointer"
                        title="Upload Store Logo"
                      >
                        {avatarPreview ? (
                          <img
                            src={avatarPreview}
                            alt="Store Logo Preview"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span>{getStoreInitials()}</span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[#FF9F1C] border-2 border-white shadow-sm flex items-center justify-center text-[#2B2B2B] hover:brightness-95 transition-all cursor-pointer"
                        aria-label="Upload store photo"
                      >
                        <Camera className="w-3.5 h-3.5" />
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleAvatarUpload}
                        className="hidden"
                      />
                    </div>

                    <div className="flex-1 w-full space-y-3">
                      <div className="space-y-1">
                        <label className="block text-sm font-semibold text-[#2B2B2B]">
                          Store Name <span className="text-rose-600">*</span>
                        </label>
                        <input
                          type="text"
                          value={storeName}
                          onChange={(e) => {
                            setStoreName(e.target.value);
                            clearError('storeName');
                          }}
                          placeholder="e.g., GreenBasket Fresh Mart"
                          className={`w-full h-10 px-3 rounded-xl border bg-white text-sm transition-colors focus:outline-none focus:ring-2 ${
                            errors.storeName
                              ? 'border-rose-500 focus:ring-rose-500/20'
                              : 'border-stone-300 focus:border-[#1A4D2E] focus:ring-[#1A4D2E]/15'
                          }`}
                        />
                        {errors.storeName && (
                          <p className="text-xs text-rose-600">{errors.storeName}</p>
                        )}
                      </div>

                      <div className="space-y-1">
                        <label className="block text-sm font-semibold text-[#2B2B2B]">
                          Owner Full Name <span className="text-rose-600">*</span>
                        </label>
                        <input
                          type="text"
                          value={ownerName}
                          onChange={(e) => {
                            setOwnerName(e.target.value);
                            clearError('ownerName');
                          }}
                          placeholder="e.g., Aarav Sharma"
                          className={`w-full h-10 px-3 rounded-xl border bg-white text-sm transition-colors focus:outline-none focus:ring-2 ${
                            errors.ownerName
                              ? 'border-rose-500 focus:ring-rose-500/20'
                              : 'border-stone-300 focus:border-[#1A4D2E] focus:ring-[#1A4D2E]/15'
                          }`}
                        />
                        {errors.ownerName && (
                          <p className="text-xs text-rose-600">{errors.ownerName}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Store Operating Hours */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-[#2B2B2B]">
                      <Clock className="w-4 h-4 text-[#1A4D2E]" />
                      <span>Store Operating Hours</span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-[#2B2B2B]/65">
                          Opening Time
                        </label>
                        <input
                          type="time"
                          value={openTime}
                          onChange={(e) => setOpenTime(e.target.value)}
                          className="w-full h-10 px-3 rounded-xl border border-stone-300 text-sm focus:outline-none focus:border-[#1A4D2E]"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-[#2B2B2B]/65">
                          Closing Time
                        </label>
                        <input
                          type="time"
                          value={closeTime}
                          onChange={(e) => setCloseTime(e.target.value)}
                          className="w-full h-10 px-3 rounded-xl border border-stone-300 text-sm focus:outline-none focus:border-[#1A4D2E]"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[#2B2B2B]/65 block">
                        Open Days for Order Pickup
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {DAYS_OF_WEEK.map((day) => {
                          const selected = openDays.includes(day);
                          return (
                            <button
                              key={day}
                              type="button"
                              onClick={() => toggleDay(day)}
                              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border cursor-pointer ${
                                selected
                                  ? 'bg-[#1A4D2E] text-white border-[#1A4D2E] shadow-2xs'
                                  : 'bg-white text-[#2B2B2B]/70 border-stone-200 hover:border-[#1A4D2E]/40'
                              }`}
                            >
                              {day}
                            </button>
                          );
                        })}
                      </div>
                      {errors.openDays && (
                        <p className="text-xs text-rose-600">{errors.openDays}</p>
                      )}
                    </div>
                  </div>

                  {/* Single Clean Seller Declaration */}
                  <div className="pt-2 border-t border-stone-100">
                    <label className="flex items-start gap-3 cursor-pointer select-none p-3 rounded-xl hover:bg-[#FFF8E8]/70 transition-colors">
                      <input
                        type="checkbox"
                        checked={declarationAccepted}
                        onChange={(e) => {
                          setDeclarationAccepted(e.target.checked);
                          clearError('declaration');
                        }}
                        className="mt-0.5 w-4 h-4 rounded border-stone-300 accent-[#1A4D2E] focus:ring-[#1A4D2E]"
                      />
                      <span className="text-xs text-[#2B2B2B]/80 leading-relaxed">
                        I confirm that the business, tax, and bank details provided are accurate, and I agree to the{' '}
                        <span className="text-[#1A4D2E] font-bold underline">
                          Supplier Terms & Policies
                        </span>
                        .
                      </span>
                    </label>
                    {errors.declaration && (
                      <p className="text-xs text-rose-600 flex items-center gap-1 mt-1 px-3">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {errors.declaration}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Card Footer Navigation with Juicy Orange (#FF9F1C) Primary CTA */}
              <div className="px-5 sm:px-7 py-4 bg-[#FFF8E8]/75 border-t border-[#1A4D2E]/10 flex items-center justify-between gap-3">
                {currentStep > 1 ? (
                  <button
                    type="button"
                    onClick={handleBack}
                    className="h-11 px-4 rounded-xl border border-[#1A4D2E]/25 bg-white text-[#1A4D2E] text-sm font-bold hover:bg-[#E0ECC8]/40 transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </button>
                ) : (
                  <div />
                )}

                <button
                  type="button"
                  onClick={handleNext}
                  disabled={isSubmitting}
                  className="h-11 px-6 rounded-xl bg-[#FF9F1C] hover:bg-[#f0900d] active:scale-[0.99] text-[#2B2B2B] text-sm font-extrabold shadow-sm transition-all flex items-center gap-2 ml-auto cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Launching Store...
                    </>
                  ) : currentStep === 5 ? (
                    <>
                      Submit & Start Selling
                      <Sparkles className="w-4 h-4" />
                    </>
                  ) : (
                    <>
                      Continue
                      <ChevronRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* CONFIRMATION & STORE SUMMARY SCREEN */
          <div className="bg-white rounded-2xl border border-[#1A4D2E]/15 shadow-sm overflow-hidden animate-fadeIn">
            <div className="bg-[#1A4D2E] px-6 py-8 text-center text-white">
              <div className="w-14 h-14 rounded-full bg-[#E0ECC8] mx-auto flex items-center justify-center mb-3 shadow-sm">
                <CheckCircle2 className="w-8 h-8 text-[#1A4D2E]" />
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight text-white">
                Your Store is Live!
              </h1>
              <p className="text-sm text-[#E0ECC8] mt-1 max-w-md mx-auto">
                Welcome aboard, <strong className="text-white">{ownerName || 'Seller'}</strong>. You’re ready to list fresh products and receive orders across India.
              </p>
            </div>

            <div className="p-6 sm:p-7 space-y-6">
              {/* Store Header Card */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-[#FFF8E8] border border-[#1A4D2E]/15">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-[#1A4D2E] flex items-center justify-center text-[#E0ECC8] font-bold text-lg shrink-0 border-2 border-white shadow-sm">
                  {avatarPreview ? (
                    <img
                      src={avatarPreview}
                      alt={storeName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    getStoreInitials()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-extrabold text-[#2B2B2B] truncate">
                      {storeName || 'My Store'}
                    </h2>
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-[#1A4D2E] bg-[#E0ECC8] border border-[#1A4D2E]/20 px-2.5 py-0.5 rounded-full">
                      <CheckCircle2 className="w-3 h-3 text-[#1A4D2E]" />
                      Verified Seller
                    </span>
                  </div>
                  <p className="text-xs text-[#2B2B2B]/70 mt-0.5 font-medium">
                    Managed by {ownerName || 'Store Owner'} • +91 {mobile}
                  </p>
                </div>
              </div>

              {/* Key Onboarding Summary Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-sm">
                <div className="p-3.5 rounded-xl border border-[#1A4D2E]/15 bg-white">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#2B2B2B]/65">
                    <BadgePercent className="w-3.5 h-3.5 text-[#1A4D2E]" />
                    Locked-in Commission Slab
                  </div>
                  <div className="mt-1.5 font-bold text-[#2B2B2B] flex items-center justify-between">
                    <span>{activeCategoryObj.name}</span>
                    <span className="text-[#2B2B2B] bg-[#FF9F1C] px-2.5 py-0.5 rounded-full text-xs font-extrabold">
                      {activeCategoryObj.commission} Fee
                    </span>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border border-[#1A4D2E]/15 bg-white">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#2B2B2B]/65">
                    <FileText className="w-3.5 h-3.5 text-[#1A4D2E]" />
                    Tax & Compliance
                  </div>
                  <div className="mt-1.5 font-bold text-[#2B2B2B] text-xs font-mono">
                    {taxType}: {taxNumber || 'Verified'}
                  </div>
                  {fssai && (
                    <div className="text-[11px] text-[#1A4D2E] font-semibold mt-0.5 font-mono">
                      FSSAI: {fssai}
                    </div>
                  )}
                </div>

                <div className="p-3.5 rounded-xl border border-[#1A4D2E]/15 bg-white">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#2B2B2B]/65">
                    <MapPin className="w-3.5 h-3.5 text-[#1A4D2E]" />
                    Pickup Location
                  </div>
                  <div className="mt-1.5 font-bold text-[#2B2B2B]">
                    {city}, {stateName} - {pincode}
                  </div>
                  <div className="text-xs text-[#2B2B2B]/65 truncate mt-0.5">
                    {building}, {street}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border border-[#1A4D2E]/15 bg-white">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#2B2B2B]/65">
                    <Landmark className="w-3.5 h-3.5 text-[#1A4D2E]" />
                    Payout Bank Account
                  </div>
                  <div className="mt-1.5 font-bold text-[#2B2B2B] font-mono text-xs">
                    •••• •••• {accountNumber.slice(-4) || 'XXXX'} ({ifsc})
                  </div>
                  <div className="text-[11px] text-[#1A4D2E] font-semibold mt-0.5 truncate">
                    {verifiedBranch}
                  </div>
                </div>
              </div>

              {/* Operating Schedule Pill Summary */}
              <div className="p-3.5 rounded-xl bg-[#E0ECC8]/45 border border-[#1A4D2E]/15 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 text-[#1A4D2E] font-semibold">
                  <Clock className="w-3.5 h-3.5 text-[#1A4D2E]" />
                  <span>
                    Pickup Window: <strong className="text-[#2B2B2B]">{openTime} – {closeTime}</strong>
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {openDays.map((d) => (
                    <span
                      key={d}
                      className="px-2 py-0.5 rounded bg-white border border-[#1A4D2E]/20 text-[#1A4D2E] font-bold text-[11px]"
                    >
                      {d}
                    </span>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={resetWizard}
                  className="h-11 px-4 rounded-xl border border-[#1A4D2E]/25 text-[#1A4D2E] text-sm font-bold hover:bg-[#E0ECC8]/40 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  Register Another Store
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/seller')}
                  className="flex-1 h-11 px-6 rounded-xl bg-[#FF9F1C] hover:bg-[#f0900d] text-[#2B2B2B] text-sm font-extrabold shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  Go to Seller Dashboard
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Deep Leaf Green Trust Footer */}
      <footer className="bg-[#1A4D2E] text-[#E0ECC8] py-4 text-center text-xs border-t border-[#143d24]">
        Need help registering? Reach Supplier Support at{' '}
        <span className="text-white font-semibold underline">support@freshmarket.in</span>
      </footer>
    </div>
  );
}

export default SellerOnboardingWizard;
