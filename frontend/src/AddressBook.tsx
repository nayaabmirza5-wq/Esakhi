import { useState, useMemo } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api } from './api';
import type { Address } from './types';
import {
  MapPin,
  Plus,
  Trash2,
  Check,
  CheckCircle2,
  RefreshCw,
  Home,
  Building2,
  AlertCircle,
  Phone,
  User,
} from 'lucide-react';

export type ServiceLocality = { name: string; postalCodes: string[]; deliveryFeePaise?: number };
export type AddressFields = Omit<Address, 'id' | '_id'>;
export type AddressField = keyof AddressFields;
export type AddressFormErrors = Partial<Record<'name' | 'phone' | 'houseNumber' | 'street' | 'city' | 'state' | 'postalCode', string>>;

// Common Central India / MP Pincode Fast Lookup
const PINCODE_MAP: Record<string, { city: string; state: string; district?: string }> = {
  '470661': { city: 'Damoh', state: 'Madhya Pradesh', district: 'Damoh' },
  '470663': { city: 'Damoh', state: 'Madhya Pradesh', district: 'Damoh' },
  '470670': { city: 'Damoh', state: 'Madhya Pradesh', district: 'Damoh' },
  '470672': { city: 'Damoh', state: 'Madhya Pradesh', district: 'Damoh' },
  '470673': { city: 'Damoh', state: 'Madhya Pradesh', district: 'Damoh' },
  '470675': { city: 'Damoh', state: 'Madhya Pradesh', district: 'Damoh' },
  '470771': { city: 'Hatta', state: 'Madhya Pradesh', district: 'Damoh' },
  '470772': { city: 'Patera', state: 'Madhya Pradesh', district: 'Damoh' },
  '470775': { city: 'Tendukheda', state: 'Madhya Pradesh', district: 'Damoh' },
  '470880': { city: 'Jabera', state: 'Madhya Pradesh', district: 'Damoh' },
  '470881': { city: 'Damoh', state: 'Madhya Pradesh', district: 'Damoh' },
  '470001': { city: 'Sagar', state: 'Madhya Pradesh', district: 'Sagar' },
  '470002': { city: 'Sagar', state: 'Madhya Pradesh', district: 'Sagar' },
  '482001': { city: 'Jabalpur', state: 'Madhya Pradesh', district: 'Jabalpur' },
  '482002': { city: 'Jabalpur', state: 'Madhya Pradesh', district: 'Jabalpur' },
  '462001': { city: 'Bhopal', state: 'Madhya Pradesh', district: 'Bhopal' },
  '452001': { city: 'Indore', state: 'Madhya Pradesh', district: 'Indore' },
};

const DEFAULT_DAMOH_LOCALITY: ServiceLocality = {
  name: 'Damoh',
  postalCodes: ['470661'],
  deliveryFeePaise: 0,
};

const emptyAddress = (name: string, phone: string, defaultLocality?: ServiceLocality): AddressFields => ({
  label: 'Home',
  isDefault: false,
  name,
  phone,
  addressLine1: '',
  addressLine2: '',
  locality: defaultLocality?.name ?? 'Damoh',
  city: 'Damoh',
  state: 'Madhya Pradesh',
  postalCode: defaultLocality?.postalCodes[0] ?? '470661',
  houseNumber: '',
  street: '',
  area: '',
  landmark: '',
  villageOrCity: 'Damoh',
  district: 'Damoh',
  deliveryInstructions: '',
});

export function formatAddress(address: AddressFields | Address): string {
  return [
    address.houseNumber,
    address.street,
    address.area,
    address.landmark ? `Near ${address.landmark}` : undefined,
    address.city || address.villageOrCity,
    address.state,
    address.postalCode ? `PIN ${address.postalCode}` : undefined,
  ].filter(Boolean).join(', ') || address.addressLine1 || 'Delivery Address';
}

function AddressForm({
  initialAddress,
  serviceLocalities,
  customerName,
  customerPhone,
  onSave,
  onCancel,
}: {
  initialAddress?: Address;
  serviceLocalities: ServiceLocality[];
  customerName: string;
  customerPhone: string;
  onSave: (address: AddressFields, id?: string) => Promise<Address>;
  onCancel: () => void;
}): ReactNode {
  const primaryLocality = serviceLocalities[0] || DEFAULT_DAMOH_LOCALITY;

  const initial = useMemo(() => {
    const base = emptyAddress(customerName, customerPhone, primaryLocality);
    if (!initialAddress) return base;

    return {
      ...base,
      ...initialAddress,
      houseNumber: initialAddress.houseNumber ?? initialAddress.addressLine1 ?? '',
      street: initialAddress.street ?? '',
      area: initialAddress.area ?? '',
      landmark: initialAddress.landmark ?? initialAddress.addressLine2 ?? '',
      city: initialAddress.city ?? initialAddress.villageOrCity ?? 'Damoh',
      state: initialAddress.state ?? 'Madhya Pradesh',
      postalCode: initialAddress.postalCode ?? '470661',
      locality: initialAddress.locality ?? initialAddress.area ?? 'Damoh',
      label: initialAddress.label ?? 'Home',
    };
  }, [customerName, customerPhone, initialAddress, primaryLocality]);

  const [values, setValues] = useState<AddressFields>(initial);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<AddressFormErrors>({});
  const [gpsMessage, setGpsMessage] = useState('');
  const [customLabel, setCustomLabel] = useState(
    initialAddress?.label && !['Home', 'Work'].includes(initialAddress.label) ? initialAddress.label : ''
  );

  const setField = (field: AddressField, value: string | boolean) => {
    setValues((prev) => ({
      ...prev,
      [field]: value,
    }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    setError('');
  };

  // Instant Pincode Auto-Fill (Local central India + Pan-India fallback)
  const handlePincodeChange = (pin: string) => {
    setField('postalCode', pin);
    if (pin.length === 6) {
      const match = PINCODE_MAP[pin];
      if (match) {
        setValues((prev) => ({
          ...prev,
          postalCode: pin,
          city: match.city,
          villageOrCity: match.city,
          state: match.state,
          district: match.district || match.city,
        }));
        return;
      }

      // Universal Pan-India postal pincode fallback
      void fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal: AbortSignal.timeout(3000) })
        .then((res) => res.json())
        .then((data) => {
          const po = data?.[0]?.PostOffice?.[0];
          if (po?.District && po?.State) {
            setValues((prev) => ({
              ...prev,
              postalCode: pin,
              city: po.District,
              villageOrCity: po.District,
              state: po.State,
              district: po.District,
            }));
          }
        })
        .catch(() => {});
    }
  };

  // 1-Click GPS Doorstep Locator
  const locateMe = () => {
    setError('');
    setGpsMessage('');
    if (!navigator.geolocation) {
      setError('GPS location is not supported in this browser. Please type your address below.');
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const suggestion = await api.reverseAddress(coords.latitude, coords.longitude);
          setValues((prev) => ({
            ...prev,
            latitude: coords.latitude,
            longitude: coords.longitude,
            locationAccuracyMeters: coords.accuracy,
            postalCode: suggestion.postalCode || prev.postalCode || '470661',
            city: suggestion.villageOrCity || suggestion.district || 'Damoh',
            villageOrCity: suggestion.villageOrCity || suggestion.district || 'Damoh',
            district: suggestion.district || 'Damoh',
            state: suggestion.state || 'Madhya Pradesh',
            area: suggestion.area || prev.area,
            street: suggestion.street || prev.street,
            houseNumber: suggestion.houseNumber || prev.houseNumber,
            formattedAddress: suggestion.formattedAddress,
          }));
          setGpsMessage(`✓ Doorstep location auto-detected (${suggestion.area || suggestion.villageOrCity || 'Damoh'})`);
        } catch {
          setValues((prev) => ({
            ...prev,
            latitude: coords.latitude,
            longitude: coords.longitude,
          }));
          setGpsMessage('✓ Coordinates detected. Please verify your house/street details.');
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setError('Location access was denied. Please enter your address details manually.');
        } else {
          setError('Could not detect location. Please enter your address manually.');
        }
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  };

  const rawPhoneDigits = values.phone.replace(/^\+91/, '').replace(/\D/g, '');

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    setError('');
    const errors: AddressFormErrors = {};

    if (!values.name.trim()) errors.name = 'Full name is required.';
    if (!/^[6-9]\d{9}$/.test(rawPhoneDigits)) {
      errors.phone = 'Enter a valid 10-digit Indian mobile number.';
    }
    if (!values.postalCode.trim() || !/^\d{6}$/.test(values.postalCode.trim())) {
      errors.postalCode = 'Enter a valid 6-digit PIN code.';
    }
    if (!values.houseNumber?.trim() && !values.street?.trim()) {
      errors.houseNumber = 'Enter your flat, house number, or building.';
    }
    if (!values.area?.trim() && !values.street?.trim()) {
      errors.street = 'Enter your street, road, or area.';
    }
    if (!values.city.trim()) errors.city = 'Enter your city or town.';
    if (!values.state.trim()) errors.state = 'Enter your state.';

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError('Please fill in all required address fields.');
      return;
    }

    setSaving(true);
    try {
      const fullPhone = `+91${rawPhoneDigits}`;
      const resolvedLabel = values.label === 'Other' && customLabel.trim()
        ? customLabel.trim()
        : (values.label?.trim() || 'Home');

      const streetLine = [values.houseNumber, values.street, values.area].filter(Boolean).join(', ');

      const addressPayload: AddressFields = {
        label: resolvedLabel,
        isDefault: Boolean(values.isDefault),
        name: values.name.trim(),
        phone: fullPhone,
        addressLine1: streetLine || values.addressLine1 || 'Doorstep Address',
        addressLine2: values.landmark?.trim() || '',
        locality: values.area?.trim() || values.city.trim() || 'Damoh',
        city: values.city.trim() || 'Damoh',
        state: values.state.trim() || 'Madhya Pradesh',
        postalCode: values.postalCode.trim() || '470661',
        houseNumber: values.houseNumber?.trim() || '',
        street: values.street?.trim() || '',
        area: values.area?.trim() || values.street?.trim() || '',
        landmark: values.landmark?.trim() || '',
        villageOrCity: values.city.trim() || 'Damoh',
        district: values.district?.trim() || values.city.trim() || 'Damoh',
        deliveryInstructions: values.deliveryInstructions?.trim() || '',
        ...(values.latitude !== undefined && values.longitude !== undefined
          ? {
            latitude: values.latitude,
            longitude: values.longitude,
            ...(values.locationAccuracyMeters !== undefined ? { locationAccuracyMeters: values.locationAccuracyMeters } : {}),
            ...(values.formattedAddress ? { formattedAddress: values.formattedAddress } : {}),
          }
          : {}),
      };

      await onSave(addressPayload, initialAddress?.id ?? initialAddress?._id);
      onCancel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save address.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-7 shadow-xs">
      {/* 1. Header with 1-Click GPS button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <h3 className="text-base sm:text-lg font-bold text-slate-900">
            {initialAddress ? 'Edit Delivery Address' : 'Add a Delivery Address'}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Enter your doorstep delivery details for safe order dispatch.
          </p>
        </div>

        <button
          type="button"
          onClick={locateMe}
          disabled={locating}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-900 text-xs font-bold transition-all shadow-2xs shrink-0"
        >
          {locating ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-600" />
          ) : (
            <MapPin className="w-3.5 h-3.5 text-purple-600" />
          )}
          <span>{locating ? 'Detecting…' : 'Use Current Location'}</span>
        </button>
      </div>

      {/* GPS Status Message */}
      {gpsMessage && (
        <div className="mt-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{gpsMessage}</span>
        </div>
      )}

      {error && (
        <div className="mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-5 space-y-4">
        {/* ROW 1: RECIPIENT CONTACT (Name & Mobile) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1">
              Recipient Full Name <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-400">
                <User className="w-4 h-4" />
              </span>
              <input
                type="text"
                required
                maxLength={100}
                placeholder="e.g. Rahul Sharma"
                value={values.name}
                onChange={(e) => setField('name', e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E1B4B]"
              />
            </div>
            {fieldErrors.name && <p className="text-rose-600 text-[11px] mt-0.5">{fieldErrors.name}</p>}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1">
              10-Digit Mobile Number <span className="text-rose-500">*</span>
            </label>
            <div className="flex">
              <span className="px-2.5 py-2 rounded-l-lg border-y border-l border-slate-300 bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1 shrink-0">
                <Phone className="w-3.5 h-3.5 text-slate-500" />
                <span>+91</span>
              </span>
              <input
                type="tel"
                required
                maxLength={10}
                placeholder="9876543210"
                value={rawPhoneDigits}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/\D/g, '').slice(0, 10);
                  setField('phone', `+91${cleaned}`);
                }}
                className="w-full px-3 py-2 rounded-r-lg border border-slate-300 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E1B4B]"
              />
            </div>
            {fieldErrors.phone && <p className="text-rose-600 text-[11px] mt-0.5">{fieldErrors.phone}</p>}
          </div>
        </div>

        {/* ROW 2: PINCODE, CITY, STATE */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1">
              6-Digit PIN Code <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              required
              maxLength={6}
              placeholder="e.g. 470661"
              value={values.postalCode}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                handlePincodeChange(val);
              }}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E1B4B]"
            />
            {fieldErrors.postalCode && <p className="text-rose-600 text-[11px] mt-0.5">{fieldErrors.postalCode}</p>}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1">
              City / Town <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Damoh"
              value={values.city}
              onChange={(e) => {
                setField('city', e.target.value);
                setField('villageOrCity', e.target.value);
              }}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E1B4B]"
            />
            {fieldErrors.city && <p className="text-rose-600 text-[11px] mt-0.5">{fieldErrors.city}</p>}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1">
              State <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Madhya Pradesh"
              value={values.state}
              onChange={(e) => setField('state', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E1B4B]"
            />
            {fieldErrors.state && <p className="text-rose-600 text-[11px] mt-0.5">{fieldErrors.state}</p>}
          </div>
        </div>

        {/* ROW 3: FLAT/HOUSE NO & STREET/AREA */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1">
              Flat, House No., Building, Apartment <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. House No. 24, Flat 3B, Ward 12"
              value={values.houseNumber}
              onChange={(e) => setField('houseNumber', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E1B4B]"
            />
            {fieldErrors.houseNumber && <p className="text-rose-600 text-[11px] mt-0.5">{fieldErrors.houseNumber}</p>}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1">
              Area, Street, Sector, Mohalla <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Civil Lines, Station Road, Purana Bazar"
              value={values.area || values.street}
              onChange={(e) => {
                setField('area', e.target.value);
                setField('street', e.target.value);
                setField('locality', e.target.value || 'Damoh');
              }}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E1B4B]"
            />
            {fieldErrors.street && <p className="text-rose-600 text-[11px] mt-0.5">{fieldErrors.street}</p>}
          </div>
        </div>

        {/* ROW 4: LANDMARK & DELIVERY INSTRUCTIONS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1">
              Prominent Landmark (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Near Ghanta Ghar, Opposite District Hospital"
              value={values.landmark}
              onChange={(e) => setField('landmark', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E1B4B]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1">
              Delivery Instructions (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Call upon arrival, leave with security guard"
              value={values.deliveryInstructions}
              onChange={(e) => setField('deliveryInstructions', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E1B4B]"
            />
          </div>
        </div>

        {/* ROW 5: ADDRESS LABEL & PRIMARY TOGGLE */}
        <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700">Save As:</span>
            <div className="flex gap-1.5">
              {[
                { key: 'Home', icon: <Home className="w-3.5 h-3.5" />, label: 'Home' },
                { key: 'Work', icon: <Building2 className="w-3.5 h-3.5" />, label: 'Work' },
                { key: 'Other', icon: <MapPin className="w-3.5 h-3.5" />, label: 'Other' },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setField('label', item.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                    values.label === item.key
                      ? 'bg-[#1E1B4B] text-white shadow-2xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
            {values.label === 'Other' && (
              <input
                type="text"
                placeholder="Label name (e.g. Mom's House)"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs text-slate-900 w-36"
              />
            )}
          </div>

          <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(values.isDefault)}
              onChange={(e) => setField('isDefault', e.target.checked)}
              className="rounded border-slate-300 text-[#1E1B4B] focus:ring-[#1E1B4B]"
            />
            <span>Make this my default delivery address</span>
          </label>
        </div>

        {/* ROW 6: ACTIONS */}
        <div className="pt-4 border-t border-slate-100 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="px-5 py-2.5 rounded-xl bg-[#1E1B4B] hover:bg-[#2e2a6d] text-white text-xs font-bold shadow-sm transition-all flex items-center gap-2 cursor-pointer"
          >
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-[#A3E635]" />}
            <span>{saving ? 'Saving Address…' : 'Save Address'}</span>
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function AddressBook({
  addresses,
  serviceLocalities,
  customerName,
  customerPhone,
  onChanged,
  selectedAddressId,
  onSelect,
}: {
  addresses: Address[];
  serviceLocalities: ServiceLocality[];
  customerName: string;
  customerPhone: string;
  onChanged: () => Promise<void>;
  selectedAddressId?: string;
  onSelect?: (address: Address) => void;
}): ReactNode {
  const [editing, setEditing] = useState<Address | null>(null);
  const [adding, setAdding] = useState(false);
  const [actionError, setActionError] = useState('');
  const [pendingDelete, setPendingDelete] = useState('');
  const selected = selectedAddressId ?? addresses.find((address) => address.isDefault)?.id ?? addresses[0]?.id;

  const save = async (address: AddressFields, id?: string): Promise<Address> => {
    const result = id
      ? await api.updateAddress(id, address)
      : await api.createAddress(address);
    await onChanged();
    onSelect?.(result);
    return result;
  };

  const setDefault = async (id: string) => {
    setActionError('');
    try {
      const address = await api.setDefaultAddress(id);
      await onChanged();
      onSelect?.(address);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not update default address.');
    }
  };

  const deleteAddress = async (id: string) => {
    setActionError('');
    try {
      await api.deleteAddress(id);
      setPendingDelete('');
      await onChanged();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not delete address.');
    }
  };

  if (adding || editing) {
    return (
      <AddressForm
        initialAddress={editing ?? undefined}
        serviceLocalities={serviceLocalities}
        customerName={customerName}
        customerPhone={customerPhone}
        onSave={save}
        onCancel={() => { setAdding(false); setEditing(null); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {actionError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold text-rose-800">
          {actionError}
        </div>
      )}

      {/* List of Saved Addresses */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {addresses.map((address) => {
          const id = address.id ?? address._id ?? '';
          const isSelected = id === selected;
          const isHome = (address.label || '').toLowerCase().includes('home');
          const isWork = (address.label || '').toLowerCase().includes('work');

          return (
            <div
              key={id}
              onClick={() => onSelect?.(address)}
              className={`p-4 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                isSelected
                  ? 'border-[#1E1B4B] bg-purple-50/20 shadow-xs'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div>
                {/* Top Badge & Radio */}
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="selected_delivery_address"
                      checked={isSelected}
                      onChange={() => onSelect?.(address)}
                      className="text-[#1E1B4B] focus:ring-[#1E1B4B]"
                    />
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 text-[11px] font-bold">
                      {isHome ? <Home className="w-3 h-3 text-purple-700" /> : isWork ? <Building2 className="w-3 h-3 text-blue-700" /> : <MapPin className="w-3 h-3 text-emerald-700" />}
                      <span>{address.label || 'Home'}</span>
                    </span>
                    {address.isDefault && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-800">
                        Default
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => setEditing(address)}
                      className="font-bold text-purple-700 hover:text-purple-900"
                    >
                      Edit
                    </button>
                    {!address.isDefault && (
                      <button
                        type="button"
                        onClick={() => void setDefault(id)}
                        className="text-slate-500 hover:text-slate-800"
                      >
                        Set Default
                      </button>
                    )}
                    {pendingDelete === id ? (
                      <span className="flex items-center gap-1 font-bold text-rose-600">
                        <span>Delete?</span>
                        <button type="button" onClick={() => void deleteAddress(id)} className="underline">Yes</button>
                        <button type="button" onClick={() => setPendingDelete('')} className="text-slate-400">No</button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPendingDelete(id)}
                        className="text-slate-400 hover:text-rose-600 p-0.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Recipient details */}
                <div className="mt-2.5">
                  <div className="text-xs font-bold text-slate-900">
                    {address.name} <span className="text-slate-500 font-normal">({address.phone})</span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    {formatAddress(address)}
                  </p>
                  {address.deliveryInstructions && (
                    <p className="text-[11px] text-slate-500 italic mt-1 bg-slate-50 px-2 py-1 rounded">
                      Note: "{address.deliveryInstructions}"
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add New Address Button */}
      {addresses.length < 10 && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-slate-300 hover:border-purple-600 hover:bg-purple-50/30 text-xs font-bold text-slate-800 transition-colors"
        >
          <Plus className="w-4 h-4 text-purple-700" />
          <span>Add a New Delivery Address</span>
        </button>
      )}

      {addresses.length === 0 && !adding && (
        <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200">
          <MapPin className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          <h4 className="text-sm font-bold text-slate-800">No Saved Delivery Address</h4>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Add your doorstep delivery address to complete your checkout and receive your order.
          </p>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1E1B4B] text-white text-xs font-bold hover:bg-[#2b2767]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Delivery Address</span>
          </button>
        </div>
      )}
    </div>
  );
}
