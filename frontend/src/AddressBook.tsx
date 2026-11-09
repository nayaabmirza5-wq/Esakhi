import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { api } from './api';
import type { Address, AddressSuggestion } from './types';

export type ServiceLocality = { name: string; postalCodes: string[]; deliveryFeePaise?: number };
export type AddressFields = Omit<Address, 'id' | '_id'>;
export type AddressField = keyof AddressFields;
export type AddressFormErrors = Partial<Record<'name' | 'phone' | 'address' | 'villageOrCity' | 'state' | 'postalCode' | 'locality', string>>;

const POPULAR_DAMOH_AREAS = [
  'Civil Lines',
  'Ghanta Ghar',
  'Purana Bazar',
  'Naya Bazar',
  'Jabalpur Naka',
  'Sagar Naka',
  'Station Road',
  'Galla Mandi',
  'Badi Devi Ji',
  'Futera Ward',
];

const QUICK_INSTRUCTIONS = [
  '📞 Call before arrival',
  '🚪 Leave at doorstep',
  '🔔 Ring bell twice',
  '🛡️ Hand over to security',
  '🚫 Do not call, send SMS',
];

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

function locationFields(suggestion: AddressSuggestion): Partial<AddressFields> {
  return {
    ...(suggestion.houseNumber ? { houseNumber: suggestion.houseNumber } : {}),
    ...(suggestion.street ? { street: suggestion.street } : {}),
    ...(suggestion.area ? { area: suggestion.area } : {}),
    ...(suggestion.villageOrCity ? { villageOrCity: suggestion.villageOrCity, city: suggestion.villageOrCity } : {}),
    ...(suggestion.district ? { district: suggestion.district } : {}),
    ...(suggestion.state ? { state: suggestion.state } : {}),
    ...(suggestion.postalCode ? { postalCode: suggestion.postalCode } : {}),
    latitude: suggestion.latitude,
    longitude: suggestion.longitude,
    formattedAddress: suggestion.formattedAddress,
  };
}

function pinIcon(): L.DivIcon {
  return L.divIcon({
    className: 'address-map-pin',
    html: '<span></span>',
    iconSize: [34, 42],
    iconAnchor: [17, 40],
  });
}

function MapController({ center }: { center: [number, number] }): null {
  const map = useMap();
  useEffect(() => { map.setView(center, Math.max(map.getZoom(), 15)); }, [center, map]);
  return null;
}

function MapClickHandler({ onMove }: { onMove: (latitude: number, longitude: number) => void }): null {
  useMapEvents({
    click(event) { onMove(event.latlng.lat, event.latlng.lng); },
  });
  return null;
}

function AddressMap({
  latitude,
  longitude,
  onMove,
}: {
  latitude?: number;
  longitude?: number;
  onMove: (latitude: number, longitude: number) => void;
}): ReactNode {
  const [tileError, setTileError] = useState(false);
  const [tileLoading, setTileLoading] = useState(true);
  const center: [number, number] = latitude !== undefined && longitude !== undefined
    ? [latitude, longitude]
    : [23.84, 79.44];
  const tileUrl = import.meta.env.VITE_OSM_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  return (
    <div className="address-map" aria-label="Map for choosing a delivery location">
      <MapContainer center={center} zoom={latitude === undefined ? 6 : 15} scrollWheelZoom>
        <MapController center={center} />
        <MapClickHandler onMove={onMove} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url={tileUrl}
          eventHandlers={{
            loading: () => { setTileLoading(true); setTileError(false); },
            load: () => setTileLoading(false),
            tileerror: () => { setTileLoading(false); setTileError(true); },
          }}
        />
        {latitude !== undefined && longitude !== undefined && (
          <Marker
            position={[latitude, longitude]}
            draggable
            icon={pinIcon()}
            eventHandlers={{
              dragend(event: L.DragEndEvent & { target: L.Marker }) {
                const point = event.target.getLatLng();
                onMove(point.lat, point.lng);
              },
            }}
          />
        )}
      </MapContainer>
      {tileLoading && <p className="address-map-status" role="status">Loading map…</p>}
      {tileError && <p className="address-map-error" role="status">Map tiles unavailable. Enter address manually.</p>}
      <small>Click map or drag the pin to adjust entrance.</small>
    </div>
  );
}

export function formatAddress(address: AddressFields): string {
  return [
    address.houseNumber,
    address.street,
    address.area,
    address.landmark ? `Near ${address.landmark}` : undefined,
    address.locality && address.locality !== (address.villageOrCity || address.city) ? address.locality : undefined,
    address.villageOrCity || address.city,
    address.district,
    address.state,
    address.postalCode,
  ].filter(Boolean).join(', ');
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
  const activeLocalities = useMemo(() => (
    serviceLocalities.length > 0 ? serviceLocalities : [DEFAULT_DAMOH_LOCALITY]
  ), [serviceLocalities]);

  const primaryLocality = activeLocalities[0] || DEFAULT_DAMOH_LOCALITY;

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
      villageOrCity: initialAddress.villageOrCity ?? initialAddress.city ?? 'Damoh',
      city: initialAddress.city ?? initialAddress.villageOrCity ?? 'Damoh',
      district: initialAddress.district ?? 'Damoh',
      state: initialAddress.state ?? 'Madhya Pradesh',
      postalCode: initialAddress.postalCode ?? primaryLocality.postalCodes[0] ?? '470661',
      locality: initialAddress.locality ?? primaryLocality.name ?? 'Damoh',
      label: initialAddress.label ?? 'Home',
    };
  }, [customerName, customerPhone, initialAddress, primaryLocality]);

  // Mode: 'manual' by default, or 'gps' if GPS location is selected
  const [entryMode, setEntryMode] = useState<'manual' | 'gps'>(
    initialAddress?.latitude !== undefined ? 'gps' : 'manual'
  );

  const [values, setValues] = useState<AddressFields>(initial);
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<AddressFormErrors>({});
  const [lookupError, setLookupError] = useState('');
  const [message, setMessage] = useState('');
  const [resolvingPin, setResolvingPin] = useState(false);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | undefined>(initialAddress?.locationAccuracyMeters);
  const [showMap, setShowMap] = useState(false);
  const [showAdvancedRegion, setShowAdvancedRegion] = useState(false);
  const [customLabel, setCustomLabel] = useState(
    initialAddress?.label && !['Home', 'Work'].includes(initialAddress.label) ? initialAddress.label : ''
  );
  const setField = (field: AddressField, value: string | boolean) => {
    setValues((previous) => ({
      ...previous,
      [field]: value,
      ...(typeof value === 'string' && ['houseNumber', 'street', 'area', 'landmark', 'villageOrCity', 'district', 'state', 'postalCode', 'locality'].includes(field)
        ? { latitude: undefined, longitude: undefined, locationAccuracyMeters: undefined, formattedAddress: undefined }
        : {}),
    }));
    setFieldErrors((previous) => ({ ...previous, [field]: undefined }));
    setError('');
  };

  const locateMe = () => {
    setLookupError('');
    setMessage('Detecting your actual doorstep location in Damoh…');
    if (!navigator.geolocation) {
      setLookupError('This browser does not support GPS location. Please use "Enter Address Manually".');
      setMessage('');
      return;
    }
    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setLookupError('GPS location requires HTTPS. Please use "Enter Address Manually".');
      setMessage('');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        setValues((previous) => ({
          ...previous,
          latitude: coords.latitude,
          longitude: coords.longitude,
          locationAccuracyMeters: coords.accuracy,
        }));
        setGpsAccuracy(coords.accuracy);
        setMessage('');
        setResolvingPin(true);
        try {
          const suggestion = await api.reverseAddress(coords.latitude, coords.longitude);
          const fields = locationFields(suggestion);
          setValues((current) => ({
            ...current,
            ...fields,
            latitude: coords.latitude,
            longitude: coords.longitude,
            locationAccuracyMeters: coords.accuracy,
            locality: primaryLocality.name,
            postalCode: fields.postalCode || primaryLocality.postalCodes[0] || '470661',
            city: fields.city || 'Damoh',
            district: fields.district || 'Damoh',
            state: fields.state || 'Madhya Pradesh',
          }));
          setMessage('✓ Actual location detected successfully.');
        } catch (cause) {
          setLookupError(cause instanceof Error ? cause.message : 'Could not reverse geocode coordinates. Enter address manually.');
        } finally {
          setResolvingPin(false);
        }
      },
      (cause) => {
        setMessage('');
        const reason = cause.code === cause.PERMISSION_DENIED
          ? 'Location permission was denied. You can switch to "Enter Address Manually".'
          : cause.code === cause.POSITION_UNAVAILABLE
            ? 'Device could not determine GPS location. Please switch to "Enter Address Manually".'
            : 'Location detection timed out. Switch to "Enter Address Manually".';
        setLookupError(reason);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  };

  const movePin = (latitude: number, longitude: number) => {
    setValues((previous) => ({
      ...previous,
      latitude,
      longitude,
      locationAccuracyMeters: undefined,
      formattedAddress: undefined,
    }));
    setGpsAccuracy(undefined);
  };

  const review = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const errors: AddressFormErrors = {};
    if (!values.name.trim()) errors.name = 'Enter the recipient’s full name.';

    const compactPhone = values.phone.replace(/[\s()-]/g, '');
    const fullPhone = compactPhone.startsWith('+91') ? compactPhone : `+91${compactPhone}`;
    if (!/^\+91[6-9]\d{9}$/.test(fullPhone)) {
      errors.phone = 'Enter a valid 10-digit Indian mobile number.';
    }

    if (![values.houseNumber, values.street, values.area].some((value) => value?.trim())) {
      errors.address = 'Enter a flat/house number, street name, or area.';
    }
    if (!values.villageOrCity?.trim() && !values.city?.trim()) {
      errors.villageOrCity = 'Enter a village, town, or city.';
      setShowAdvancedRegion(true);
    }
    if (!values.state.trim()) {
      errors.state = 'Enter a state.';
      setShowAdvancedRegion(true);
    }
    if (!/^\d{6}$/.test(values.postalCode.trim())) {
      errors.postalCode = 'Enter a valid six-digit PIN code.';
      setShowAdvancedRegion(true);
    }

    const localityMatch = activeLocalities.find(
      (zone) => zone.name.toLocaleLowerCase() === values.locality.trim().toLocaleLowerCase()
    );
    if (!localityMatch) {
      errors.locality = 'Choose a configured delivery locality in Damoh.';
    } else if (!localityMatch.postalCodes.includes(values.postalCode.trim())) {
      errors.locality = `PIN ${values.postalCode} is outside ${localityMatch.name} (Valid: ${localityMatch.postalCodes.join(', ')})`;
      setShowAdvancedRegion(true);
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError('Please resolve the highlighted fields before proceeding.');
      return;
    }
    setStep('confirm');
  };

  const save = async () => {
    setError('');
    setSaving(true);
    try {
      const cleanPhone = values.phone.replace(/[\s()-]/g, '');
      const formattedPhone = cleanPhone.startsWith('+91') ? cleanPhone : `+91${cleanPhone}`;

      const resolvedLabel = values.label === 'Other' && customLabel.trim()
        ? customLabel.trim()
        : (values.label?.trim() || 'Home');

      const address: AddressFields = {
        label: resolvedLabel,
        isDefault: Boolean(values.isDefault),
        name: values.name.trim(),
        phone: formattedPhone,
        addressLine1: [values.houseNumber, values.street, values.area].filter(Boolean).join(', ') || values.addressLine1.trim(),
        addressLine2: values.landmark?.trim() || '',
        locality: values.locality.trim() || 'Damoh',
        city: (values.villageOrCity?.trim() || values.city).trim() || 'Damoh',
        state: values.state.trim() || 'Madhya Pradesh',
        postalCode: values.postalCode.trim() || '470661',
        houseNumber: values.houseNumber?.trim() || '',
        street: values.street?.trim() || '',
        area: values.area?.trim() || '',
        landmark: values.landmark?.trim() || '',
        villageOrCity: values.villageOrCity?.trim() || 'Damoh',
        district: values.district?.trim() || 'Damoh',
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

      await onSave(address, initialAddress?.id ?? initialAddress?._id);
      onCancel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this address.');
      setStep('edit');
    } finally {
      setSaving(false);
    }
  };

  if (step === 'confirm') {
    return (
      <section className="address-form-panel address-confirm-panel">
        <div className="address-confirm-header">
          <span className="address-badge-verified">✓ Verified Local Delivery</span>
          <h3>Confirm Delivery Address</h3>
          <p className="address-confirm-sub">Review your details to ensure fast, reliable local delivery across Damoh.</p>
        </div>

        <div className="address-confirm-card">
          <div className="address-confirm-recipient">
            <div className="recipient-avatar" aria-hidden="true">👤</div>
            <div className="recipient-info">
              <strong>{values.name}</strong>
              <span>📞 {values.phone.startsWith('+91') ? values.phone : `+91 ${values.phone}`}</span>
            </div>
            <span className="address-type-pill">
              {values.label === 'Home' ? '🏠 Home' : values.label === 'Work' ? '🏢 Work' : `📍 ${customLabel || values.label || 'Other'}`}
              {values.isDefault && ' · Default'}
            </span>
          </div>

          <div className="address-confirm-body">
            <div className="address-confirm-row">
              <span className="address-row-icon" aria-hidden="true">📍</span>
              <div className="address-row-text">
                <p className="address-main-line">
                  {[values.houseNumber, values.street].filter(Boolean).join(', ') || 'Address line'}
                </p>
                <p className="address-sub-line">
                  {[values.area, values.landmark ? `Near ${values.landmark}` : null].filter(Boolean).join(', ')}
                </p>
                <p className="address-city-line">
                  {[values.locality, values.villageOrCity || values.city, values.district, values.state].filter(Boolean).join(', ')} — <strong>PIN {values.postalCode}</strong>
                </p>
              </div>
            </div>

            {values.deliveryInstructions && (
              <div className="address-confirm-instructions">
                <span className="instructions-icon" aria-hidden="true">💬</span>
                <div>
                  <strong>Delivery Instructions:</strong>
                  <p>{values.deliveryInstructions}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {values.latitude !== undefined && values.longitude !== undefined && (
          <div className="address-confirm-map-wrap">
            <AddressMap latitude={values.latitude} longitude={values.longitude} onMove={movePin} />
            <small className="address-coordinates">GPS Coordinates: {values.latitude.toFixed(5)}, {values.longitude.toFixed(5)}</small>
          </div>
        )}

        {error && <p className="address-error" role="alert">{error}</p>}

        <div className="address-confirm-actions">
          <button type="button" className="button button-outline" onClick={() => setStep('edit')}>
            ✏️ Edit Details
          </button>
          <button type="button" className="button" disabled={saving || resolvingPin} onClick={() => void save()}>
            {saving ? 'Saving Address…' : '✓ Confirm & Save Address'}
          </button>
        </div>
      </section>
    );
  }

  const rawPhoneDigits = values.phone.replace(/^\+91/, '').replace(/\D/g, '');

  return (
    <form className="address-form-panel" onSubmit={review}>
      <div className="address-form-header">
        <span className="eyebrow">Local Fulfilment</span>
        <h3>{initialAddress ? 'Edit Delivery Address' : 'Add a Delivery Address'}</h3>
        <p className="address-form-sub">Dispatched directly from Damoh Women SHG Clusters within 24–48 hours.</p>
      </div>

      {/* 2 CLEAR OPTIONS UP FRONT: USE ACTUAL LOCATION OR ENTER MANUALLY */}
      <div className="address-mode-choice-section">
        <span className="field-subheading" style={{ marginBottom: '10px' }}>Choose how to set your address:</span>
        <div className="address-mode-toggle-grid">
          <button
            type="button"
            className={`address-mode-toggle-card ${entryMode === 'gps' ? 'active' : ''}`}
            onClick={() => {
              setEntryMode('gps');
              locateMe();
            }}
          >
            <span className="mode-toggle-icon">📍</span>
            <div className="mode-toggle-text">
              <strong>Use My Actual Location</strong>
              <small>Auto-detect doorstep GPS via device</small>
            </div>
            {entryMode === 'gps' && <span className="mode-active-pill">✓ Active</span>}
          </button>

          <button
            type="button"
            className={`address-mode-toggle-card ${entryMode === 'manual' ? 'active' : ''}`}
            onClick={() => {
              setEntryMode('manual');
              setMessage('');
              setLookupError('');
            }}
          >
            <span className="mode-toggle-icon">✍️</span>
            <div className="mode-toggle-text">
              <strong>Enter Address Manually</strong>
              <small>Type house number, street & area</small>
            </div>
            {entryMode === 'manual' && <span className="mode-active-pill">✓ Active</span>}
          </button>
        </div>
      </div>

      {/* OPTION A: GPS ACTUAL LOCATION FLOW */}
      {entryMode === 'gps' && (
        <section className="address-section-card gps-flow-card">
          <div className="address-section-header">
            <h4 className="address-section-title">
              <span>📍</span> Doorstep Location Detection
            </h4>
            <button
              type="button"
              className="quick-action-btn"
              disabled={Boolean(message.includes('Detecting')) || resolvingPin}
              onClick={locateMe}
            >
              🔄 Refresh GPS
            </button>
          </div>

          {message && (
            <div className="gps-status-box" role="status">
              <span className="gps-live-dot" />
              <span>{message}</span>
            </div>
          )}

          {lookupError && (
            <div className="gps-error-box" role="alert">
              <span>⚠️ {lookupError}</span>
              <button
                type="button"
                className="text-button"
                onClick={() => setEntryMode('manual')}
                style={{ marginLeft: '8px', textDecoration: 'underline' }}
              >
                Switch to Manual Entry
              </button>
            </div>
          )}

          {values.latitude !== undefined && values.longitude !== undefined && (
            <div className="gps-result-box">
              <div className="gps-result-info">
                <span className="gps-badge-ok">✓ Doorstep Pinned</span>
                <p className="gps-result-address">
                  {[values.houseNumber, values.street, values.area, values.city, values.postalCode].filter(Boolean).join(', ') || 'Damoh, Madhya Pradesh'}
                </p>
                {gpsAccuracy !== undefined && (
                  <small className="gps-accuracy-note">Accuracy: ±{Math.round(gpsAccuracy)} meters</small>
                )}
              </div>
              <button
                type="button"
                className="button button-outline button-small"
                onClick={() => setShowMap(!showMap)}
              >
                {showMap ? 'Hide Map' : '🗺️ Adjust Pin on Map'}
              </button>
            </div>
          )}

          {showMap && (
            <div className="address-map-section" style={{ marginTop: '12px' }}>
              <AddressMap latitude={values.latitude} longitude={values.longitude} onMove={movePin} />
              <div className="button-row" style={{ marginTop: '8px' }}>
                <span className="address-coordinates">
                  Pin: {values.latitude?.toFixed(5)}, {values.longitude?.toFixed(5)}
                </span>
                <button type="button" className="text-button" onClick={() => setShowMap(false)}>
                  Done Pinning
                </button>
              </div>
            </div>
          )}

          <div className="form-grid" style={{ marginTop: '12px' }}>
            <label className="field">
              <span>Flat / House / Door Number *</span>
              <input
                required
                maxLength={100}
                placeholder="e.g. Flat 204, Radha Kunj, House No. 12"
                value={values.houseNumber ?? ''}
                onChange={(event) => setField('houseNumber', event.target.value)}
              />
              {fieldErrors.address && <small className="address-error">{fieldErrors.address}</small>}
            </label>

            <label className="field">
              <span>Street / Road / Colony</span>
              <input
                maxLength={150}
                placeholder="e.g. Near Circuit House Road"
                value={values.street ?? ''}
                onChange={(event) => setField('street', event.target.value)}
              />
            </label>
          </div>
        </section>
      )}

      {/* OPTION B: MANUAL ENTRY FLOW */}
      {entryMode === 'manual' && (
        <section className="address-section-card manual-flow-card">
          <div className="address-section-header">
            <h4 className="address-section-title">
              <span>🏠</span> House & Street Address
            </h4>
            <span className="service-status-pill">✓ Damoh 470661 · Free Delivery</span>
          </div>

          <div className="popular-areas-wrap" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
            <span className="popular-areas-label">Quick select your Damoh neighborhood:</span>
            <div className="popular-areas-list">
              {POPULAR_DAMOH_AREAS.map((areaName) => {
                const isSelected = values.area === areaName;
                return (
                  <button
                    key={areaName}
                    type="button"
                    className={`area-quick-chip ${isSelected ? 'selected' : ''}`}
                    onClick={() => setField('area', isSelected ? '' : areaName)}
                  >
                    {isSelected ? '✓ ' : '+ '}{areaName}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="form-grid" style={{ marginTop: '14px' }}>
            <label className="field">
              <span>Flat / House / Building No. *</span>
              <input
                autoComplete="address-line1"
                required
                maxLength={100}
                placeholder="e.g. House No. 24, Flat 3B, Ward 12"
                value={values.houseNumber ?? ''}
                onChange={(event) => setField('houseNumber', event.target.value)}
              />
              {fieldErrors.address && <small className="address-error">{fieldErrors.address}</small>}
            </label>

            <label className="field">
              <span>Street / Road / Colony</span>
              <input
                maxLength={150}
                placeholder="e.g. Station Road, Civil Ward"
                value={values.street ?? ''}
                onChange={(event) => setField('street', event.target.value)}
              />
            </label>

            <label className="field">
              <span>Area / Locality / Mohalla *</span>
              <input
                autoComplete="address-level3"
                required
                maxLength={100}
                placeholder="e.g. Civil Lines, Ghanta Ghar"
                value={values.area ?? ''}
                onChange={(event) => setField('area', event.target.value)}
              />
            </label>

            <label className="field">
              <span>Prominent Landmark (Optional)</span>
              <input
                maxLength={150}
                placeholder="e.g. Opposite District Hospital, Near Jain Mandir"
                value={values.landmark ?? ''}
                onChange={(event) => setField('landmark', event.target.value)}
              />
            </label>
          </div>

          <div className="region-summary-wrap" style={{ marginTop: '10px' }}>
            <div className="region-summary-strip">
              <span className="region-summary-icon">🏛️</span>
              <div className="region-summary-text">
                <strong>{values.villageOrCity || values.city || 'Damoh'}, {values.district || 'Damoh'}, {values.state || 'Madhya Pradesh'}</strong>
                <span>PIN Code: <b>{values.postalCode || '470661'}</b></span>
              </div>
              <button
                type="button"
                className="address-advanced-toggle"
                onClick={() => setShowAdvancedRegion((prev) => !prev)}
              >
                ⚙️ {showAdvancedRegion ? 'Hide Region Settings' : 'Edit Region / PIN'}
              </button>
            </div>

            {showAdvancedRegion && (
              <div className="form-grid advanced-region-fields" style={{ marginTop: '10px' }}>
                <label className="field">
                  <span>Village / Town / City *</span>
                  <input
                    required
                    maxLength={100}
                    value={values.villageOrCity ?? values.city}
                    onChange={(event) => {
                      setField('villageOrCity', event.target.value);
                      setField('city', event.target.value);
                    }}
                  />
                  {fieldErrors.villageOrCity && <small className="address-error">{fieldErrors.villageOrCity}</small>}
                </label>

                <label className="field">
                  <span>District</span>
                  <input
                    maxLength={100}
                    value={values.district ?? ''}
                    onChange={(event) => setField('district', event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>State *</span>
                  <input
                    required
                    maxLength={100}
                    value={values.state}
                    onChange={(event) => setField('state', event.target.value)}
                  />
                  {fieldErrors.state && <small className="address-error">{fieldErrors.state}</small>}
                </label>

                <label className="field">
                  <span>6-Digit PIN Code *</span>
                  <input
                    inputMode="numeric"
                    required
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={values.postalCode}
                    onChange={(event) => setField('postalCode', event.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                  {fieldErrors.postalCode && <small className="address-error">{fieldErrors.postalCode}</small>}
                </label>
              </div>
            )}
          </div>
        </section>
      )}

      {/* RECIPIENT CONTACT DETAILS */}
      <section className="address-section-card">
        <div className="address-section-header">
          <h4 className="address-section-title">
            <span>👤</span> Recipient Contact Information
          </h4>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>Recipient Full Name *</span>
            <input
              autoComplete="name"
              required
              maxLength={120}
              placeholder="e.g. Priya Sharma"
              aria-invalid={Boolean(fieldErrors.name)}
              value={values.name}
              onChange={(event) => setField('name', event.target.value)}
            />
            {fieldErrors.name && <small className="address-error">{fieldErrors.name}</small>}
          </label>

          <label className="field">
            <span>Recipient 10-Digit Mobile Number *</span>
            <div className="phone-input-group">
              <span className="phone-prefix-badge">🇮🇳 +91</span>
              <input
                autoComplete="tel"
                inputMode="numeric"
                required
                maxLength={10}
                placeholder="9876543210"
                aria-invalid={Boolean(fieldErrors.phone)}
                value={rawPhoneDigits}
                onChange={(event) => {
                  const cleaned = event.target.value.replace(/\D/g, '').slice(0, 10);
                  setField('phone', `+91${cleaned}`);
                }}
              />
            </div>
            {fieldErrors.phone ? (
              <small className="address-error">{fieldErrors.phone}</small>
            ) : (
              <small className="field-hint">Indian 10-digit number for SMS dispatch updates</small>
            )}
          </label>
        </div>
      </section>

      {/* ADDRESS LABEL & PREFERENCES */}
      <section className="address-section-card">
        <div className="address-section-header">
          <h4 className="address-section-title">
            <span>🏷️</span> Address Label & Preferences
          </h4>
        </div>

        <div className="address-label-selector">
          <span className="field-subheading">Save Address As:</span>
          <div className="address-label-pills">
            {[
              { key: 'Home', icon: '🏠', text: 'Home' },
              { key: 'Work', icon: '🏢', text: 'Work' },
              { key: 'Other', icon: '📍', text: 'Other' },
            ].map((item) => {
              const isSelected = (values.label || 'Home') === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`label-pill ${isSelected ? 'selected' : ''}`}
                  onClick={() => setField('label', item.key)}
                >
                  <span className="label-pill-icon">{item.icon}</span>
                  <span>{item.text}</span>
                  {isSelected && <span className="label-pill-check">✓</span>}
                </button>
              );
            })}
          </div>

          {values.label === 'Other' && (
            <input
              type="text"
              placeholder="Give this address a label (e.g. Grandma's, Farmhouse)"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              className="custom-label-input"
              maxLength={40}
            />
          )}
        </div>

        <div className="delivery-instructions-section">
          <span className="field-subheading">Delivery Instructions (Optional):</span>
          <div className="quick-instructions-list">
            {QUICK_INSTRUCTIONS.map((instruction) => {
              const current = values.deliveryInstructions || '';
              const isSelected = current.includes(instruction);
              return (
                <button
                  key={instruction}
                  type="button"
                  className={`instruction-quick-chip ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    if (isSelected) {
                      const updated = current
                        .replace(instruction, '')
                        .replace(/,\s*,/g, ',')
                        .replace(/^,\s*|\s*,$/g, '')
                        .trim();
                      setField('deliveryInstructions', updated);
                    } else {
                      const updated = current ? `${current}, ${instruction}` : instruction;
                      setField('deliveryInstructions', updated);
                    }
                  }}
                >
                  {isSelected ? '✓ ' : '+ '}{instruction}
                </button>
              );
            })}
          </div>

          <textarea
            rows={2}
            maxLength={500}
            placeholder="e.g. Call before arrival, leave with security guard..."
            value={values.deliveryInstructions ?? ''}
            onChange={(e) => setField('deliveryInstructions', e.target.value)}
            className="instructions-textarea"
          />
        </div>

        <label className="address-default-toggle">
          <input
            type="checkbox"
            checked={Boolean(values.isDefault)}
            onChange={(event) => setField('isDefault', event.target.checked)}
          />
          <span className="default-toggle-text">
            <strong>Make this my primary delivery address</strong>
            <small>Automatically preselected during 1-click checkout</small>
          </span>
        </label>
      </section>

      {error && <p className="address-error" role="alert">{error}</p>}

      <div className="address-form-actions">
        <button className="button" type="submit">
          Review & Save Address →
        </button>
        <button type="button" className="text-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
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
      setActionError(cause instanceof Error ? cause.message : 'Could not update the default address.');
    }
  };

  const deleteAddress = async (id: string) => {
    setActionError('');
    try {
      await api.deleteAddress(id);
      setPendingDelete('');
      await onChanged();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not delete the address.');
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
    <section className="address-book">
      {addresses.length === 0 && (
        <div className="address-empty-card">
          <span className="address-empty-icon" aria-hidden="true">📍</span>
          <h4>No delivery address added yet</h4>
          <p>Add your home or work address in Damoh to enjoy direct delivery from local rural women's SHGs.</p>
        </div>
      )}

      {actionError && <p className="address-error" role="alert">{actionError}</p>}

      <div className="address-book-list">
        {addresses.map((address) => {
          const id = address.id ?? address._id ?? '';
          const selectedAddress = id === selected;
          const icon = address.label === 'Work' ? '🏢' : address.label === 'Home' ? '🏠' : '📍';

          return (
            <article className={`saved-address-card-v2 ${selectedAddress ? 'selected' : ''}`} key={id}>
              <div className="saved-address-card-top">
                <div className="saved-address-title-group">
                  {onSelect && (
                    <label className="saved-address-radio">
                      <input
                        type="radio"
                        name="checkout-address"
                        checked={selectedAddress}
                        onChange={() => onSelect(address)}
                      />
                      <span className="sr-only">Use this delivery address</span>
                    </label>
                  )}
                  <span className="saved-address-type-badge">
                    {icon} {address.label || 'Address'}
                  </span>
                  {address.isDefault && <span className="default-address-badge">⭐ Default</span>}
                  {address.locality && <span className="locality-tag">📍 {address.locality}</span>}
                </div>

                <div className="saved-address-actions">
                  <button type="button" className="text-button" onClick={() => setEditing(address)}>
                    ✏️ Edit
                  </button>
                  {!address.isDefault && (
                    <button type="button" className="text-button" onClick={() => void setDefault(id)}>
                      ⭐ Set Default
                    </button>
                  )}
                  {pendingDelete === id ? (
                    <span className="delete-confirm-group">
                      <span className="danger-text">Delete?</span>
                      <button type="button" className="text-button danger-text" onClick={() => void deleteAddress(id)}>
                        Yes
                      </button>
                      <button type="button" className="text-button" onClick={() => setPendingDelete('')}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="text-button danger-text" onClick={() => setPendingDelete(id)}>
                      🗑️ Delete
                    </button>
                  )}
                </div>
              </div>

              <div className="saved-address-card-content">
                <div className="saved-address-primary-line">
                  {[address.houseNumber, address.street].filter(Boolean).join(', ') || address.addressLine1}
                </div>
                <div className="saved-address-secondary-line">
                  {[
                    address.area,
                    address.landmark ? `Near ${address.landmark}` : null,
                    address.villageOrCity || address.city,
                    address.district,
                    address.state,
                  ].filter(Boolean).join(', ')}{address.postalCode ? ` — PIN ${address.postalCode}` : ''}
                </div>
                <div className="saved-address-contact-line">
                  <span>👤 {address.name}</span>
                  <span>📞 {address.phone}</span>
                </div>
                {address.deliveryInstructions && (
                  <div className="saved-address-instructions">
                    <span>💬</span> <em>"{address.deliveryInstructions}"</em>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {addresses.length < 10 ? (
        <button type="button" className="button button-outline add-address-btn" onClick={() => setAdding(true)}>
          + Add a New Delivery Address
        </button>
      ) : (
        <p className="address-muted">You have reached the limit of 10 saved addresses.</p>
      )}
    </section>
  );
}
