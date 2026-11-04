import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { api } from './api';
import type { Address, AddressSuggestion } from './types';

type ServiceLocality = { name: string; postalCodes: string[]; deliveryFeePaise?: number };
type AddressFields = Omit<Address, 'id' | '_id'>;
type AddressField = keyof AddressFields;
type AddressFormErrors = Partial<Record<'name' | 'phone' | 'address' | 'villageOrCity' | 'state' | 'postalCode' | 'locality', string>>;

const emptyAddress = (name: string, phone: string): AddressFields => ({
  label: 'Home',
  isDefault: false,
  name,
  phone,
  addressLine1: '',
  addressLine2: '',
  locality: '',
  city: '',
  state: '',
  postalCode: '',
  houseNumber: '',
  street: '',
  area: '',
  landmark: '',
  villageOrCity: '',
  district: '',
  deliveryInstructions: '',
});

function locationFields(suggestion: AddressSuggestion): Partial<AddressFields> {
  return {
    ...(suggestion.houseNumber ? { houseNumber: suggestion.houseNumber } : {}),
    ...(suggestion.street ? { street: suggestion.street } : {}),
    ...(suggestion.area ? { area: suggestion.area } : {}),
    ...(suggestion.villageOrCity ? { villageOrCity: suggestion.villageOrCity } : {}),
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
  return <div className="address-map" aria-label="Map for choosing a delivery location">
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
      {latitude !== undefined && longitude !== undefined && <Marker
        position={[latitude, longitude]}
        draggable
        icon={pinIcon()}
        eventHandlers={{ dragend(event: L.DragEndEvent & { target: L.Marker }) {
          const point = event.target.getLatLng();
          onMove(point.lat, point.lng);
        } }}
      />}
    </MapContainer>
    {tileLoading && <p className="address-map-status" role="status">Loading map…</p>}
    {tileError && <p className="address-map-error" role="status">Map tiles are unavailable. You can still enter the address manually or retry later.</p>}
    <small>OpenStreetMap contributors · Click the map or drag the pin to adjust it.</small>
  </div>;
}

function formatAddress(address: AddressFields): string {
  return [
    address.houseNumber,
    address.street,
    address.area,
    address.landmark ? `Near ${address.landmark}` : undefined,
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
  const initial = useMemo(() => ({
    ...emptyAddress(customerName, customerPhone),
    ...initialAddress,
    houseNumber: initialAddress?.houseNumber ?? initialAddress?.addressLine1 ?? '',
    street: initialAddress?.street ?? '',
    area: initialAddress?.area ?? '',
    landmark: initialAddress?.landmark ?? initialAddress?.addressLine2 ?? '',
    villageOrCity: initialAddress?.villageOrCity ?? initialAddress?.city ?? '',
    district: initialAddress?.district ?? '',
    locality: initialAddress?.locality ?? '',
    label: initialAddress?.label ?? 'Home',
  }), [customerName, customerPhone, initialAddress]);
  const [values, setValues] = useState<AddressFields>(initial);
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<AddressFormErrors>({});
  const [lookupError, setLookupError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolvingPin, setResolvingPin] = useState(false);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | undefined>(initialAddress?.locationAccuracyMeters);
  const [pinRequest, setPinRequest] = useState(0);
  const [showMap, setShowMap] = useState(initialAddress?.latitude !== undefined && initialAddress.longitude !== undefined);
  const [dirtyFields, setDirtyFields] = useState<Set<AddressField>>(() => new Set());
  const [mapBackup, setMapBackup] = useState<{
    values: AddressFields;
    dirtyFields: Set<AddressField>;
    gpsAccuracy?: number;
  }>();

  const mergeLocation = (suggestion: AddressSuggestion) => {
    const suggestedFields = locationFields(suggestion);
    setValues((current) => {
      const next = { ...current, ...suggestedFields };
      for (const field of dirtyFields) {
        if (field in suggestedFields) next[field] = current[field] as never;
      }
      return next;
    });
  };

  useEffect(() => {
    if (search.trim().length < 3) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      setLookupError('');
      void api.searchAddresses(search.trim(), controller.signal)
        .then(setSuggestions)
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) setLookupError(cause instanceof Error ? cause.message : 'Address suggestions are unavailable.');
        })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 650);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search]);

  useEffect(() => {
    if (!pinRequest || values.latitude === undefined || values.longitude === undefined) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setResolvingPin(true);
      setLookupError('');
      void api.reverseAddress(values.latitude!, values.longitude!, controller.signal)
        .then((suggestion) => {
          mergeLocation(suggestion);
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) setLookupError(cause instanceof Error ? cause.message : 'Could not find an address for this pin. Enter it manually.');
        })
        .finally(() => { if (!controller.signal.aborted) setResolvingPin(false); });
    }, 700);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [pinRequest, values.latitude, values.longitude]);

  const setField = (field: AddressField, value: string | boolean) => {
    setValues((previous) => ({
      ...previous,
      [field]: value,
      ...(typeof value === 'string' && ['houseNumber', 'street', 'area', 'landmark', 'villageOrCity', 'district', 'state', 'postalCode', 'locality'].includes(field)
        ? { latitude: undefined, longitude: undefined, locationAccuracyMeters: undefined, formattedAddress: undefined }
        : {}),
    }));
    setDirtyFields((previous) => new Set(previous).add(field));
    setFieldErrors((previous) => ({ ...previous, [field]: undefined }));
    setError('');
  };

  const applySuggestion = (suggestion: AddressSuggestion) => {
    mergeLocation(suggestion);
    setSearch('');
    setSuggestions([]);
    setShowMap(true);
    setLookupError('');
  };

  const locateMe = () => {
    setLookupError('');
    setMessage('');
    if (!navigator.geolocation) {
      setLookupError('This browser does not support location detection. Enter your address manually or choose it on the map.');
      return;
    }
    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setLookupError('Current location requires a secure HTTPS connection. Enter your address manually or choose it on the map.');
      return;
    }
    setMessage('Requesting your location…');
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      setValues((previous) => ({
        ...previous,
        latitude: coords.latitude,
        longitude: coords.longitude,
        locationAccuracyMeters: coords.accuracy,
      }));
      setGpsAccuracy(coords.accuracy);
      setShowMap(true);
      setMessage('');
      setResolvingPin(true);
      try {
        const suggestion = await api.reverseAddress(coords.latitude, coords.longitude);
        mergeLocation(suggestion);
        setValues((previous) => ({
          ...previous,
          latitude: coords.latitude,
          longitude: coords.longitude,
          locationAccuracyMeters: coords.accuracy,
        }));
      } catch (cause) {
        setLookupError(cause instanceof Error ? cause.message : 'Could not read the GPS location. Enter your address manually.');
      } finally {
        setResolvingPin(false);
      }
    }, (cause) => {
      setMessage('');
      const reason = cause.code === cause.PERMISSION_DENIED
        ? 'Location permission was denied. Allow location access in your browser or enter the address manually.'
        : cause.code === cause.POSITION_UNAVAILABLE
          ? 'Your device could not determine a location. Check location services or enter the address manually.'
          : 'Location detection timed out. Try again or enter the address manually.';
      setLookupError(reason);
    }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  };

  const openMap = () => {
    if (!showMap) {
          setMapBackup({ values, dirtyFields: new Set(dirtyFields), gpsAccuracy });
          setLookupError('');
          setShowMap(true);
    }
  };

  const confirmMap = () => {
    setMapBackup(undefined);
    setShowMap(false);
    setMessage('Location confirmed. Review the address before saving.');
  };

  const cancelMap = () => {
    if (mapBackup) {
          setValues(mapBackup.values);
          setDirtyFields(mapBackup.dirtyFields);
          setGpsAccuracy(mapBackup.gpsAccuracy);
    } else {
          setValues((current) => ({
            ...current,
            latitude: undefined,
            longitude: undefined,
            locationAccuracyMeters: undefined,
            formattedAddress: undefined,
          }));
          setGpsAccuracy(undefined);
    }
    setMapBackup(undefined);
    setShowMap(false);
    setPinRequest((previous) => previous + 1);
    setLookupError('');
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
    setPinRequest((previous) => previous + 1);
  };

  const review = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const errors: AddressFormErrors = {};
    if (!values.name.trim()) errors.name = 'Enter the recipient’s full name.';
    const compactPhone = values.phone.replace(/[\s()-]/g, '');
    if (!/^(\+91)?[6-9]\d{9}$/.test(compactPhone)) errors.phone = 'Enter a valid 10-digit Indian mobile number.';
    if (![values.houseNumber, values.street, values.area].some((value) => value?.trim())) {
      errors.address = 'Enter a house/building, street, or area. Rural addresses do not need a street name.';
    }
    if (!values.villageOrCity?.trim() && !values.city?.trim()) errors.villageOrCity = 'Enter a village, town, or city.';
    if (!values.state.trim()) errors.state = 'Enter a state.';
    if (!/^\d{6}$/.test(values.postalCode.trim())) errors.postalCode = 'Enter a six-digit PIN code.';
    const locality = serviceLocalities.find((zone) => zone.name.toLocaleLowerCase() === values.locality.trim().toLocaleLowerCase());
    if (!locality) {
      errors.locality = 'Choose a configured delivery locality.';
    } else if (!locality.postalCodes.includes(values.postalCode.trim())) {
      errors.locality = 'This PIN code is not configured for the selected delivery locality.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setError('Correct the highlighted fields before reviewing this address.');
      return;
    }
    setStep('confirm');
  };

  const save = async () => {
    setError('');
    setSaving(true);
    try {
      const address: AddressFields = {
        label: values.label?.trim() || 'Home',
        isDefault: Boolean(values.isDefault),
        name: values.name.trim(),
        phone: values.phone.replace(/[\s()-]/g, '').replace(/^([6-9]\d{9})$/, '+91$1'),
        addressLine1: [values.houseNumber, values.street, values.area].filter(Boolean).join(', ') || values.addressLine1.trim(),
        addressLine2: values.landmark?.trim() || '',
        locality: values.locality.trim(),
        city: (values.villageOrCity?.trim() || values.city).trim(),
        state: values.state.trim(),
        postalCode: values.postalCode.trim(),
        houseNumber: values.houseNumber?.trim() || '',
        street: values.street?.trim() || '',
        area: values.area?.trim() || '',
        landmark: values.landmark?.trim() || '',
        villageOrCity: values.villageOrCity?.trim() || '',
        district: values.district?.trim() || '',
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
    return <section className="address-form-panel">
      <span className="eyebrow">Check your details</span>
      <h3>Confirm this delivery address</h3>
      {showMap && <AddressMap latitude={values.latitude} longitude={values.longitude} onMove={movePin} />}
      {!showMap && <p className="address-map-placeholder">No map pin selected. Your manually entered address will be used for delivery.</p>}
      {resolvingPin && <p role="status">Finding the address for this pin…</p>}
      {gpsAccuracy !== undefined && gpsAccuracy > 100 && <p className="address-warning">GPS accuracy is approximately {Math.round(gpsAccuracy)} m. Move the pin to your entrance if needed.</p>}
      <dl className="address-confirm-details">
        <div><dt>Address</dt><dd>{formatAddress(values)}</dd></div>
        <div><dt>Recipient</dt><dd>{values.name} · {values.phone}</dd></div>
        <div><dt>Delivery locality</dt><dd>{values.locality}</dd></div>
        <div><dt>Label</dt><dd>{values.label}</dd></div>
      </dl>
      {values.deliveryInstructions && <p><strong>Delivery instructions:</strong> {values.deliveryInstructions}</p>}
      {error && <p className="address-error" role="alert">{error}</p>}
      <div className="button-row">
        <button type="button" className="button button-outline" onClick={() => setStep('edit')}>Edit address</button>
        <button type="button" className="button" disabled={saving || resolvingPin} onClick={() => void save()}>{saving ? 'Saving…' : 'Confirm and save'}</button>
      </div>
    </section>;
  }

  return <form className="address-form-panel" onSubmit={review}>
    <span className="eyebrow">Delivery details</span>
    <h3>{initialAddress ? 'Edit address' : 'Add a delivery address'}</h3>
    <div className="address-location-actions">
      <button type="button" className="button button-outline" disabled={Boolean(message) || resolvingPin} onClick={locateMe}>{message || 'Use current location'}</button>
      <button type="button" className="button button-outline" onClick={openMap}>Choose location on map</button>
      <button type="button" className="text-button" onClick={() => { setShowMap(false); setMapBackup(undefined); setSearch(''); setMessage('Enter the address below. Location detection and map selection are optional.'); }}>Enter address manually</button>
    </div>
    <label className="field address-search-field"><span>Search for an address</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search a place, village, road or landmark" autoComplete="off" /></label>
    {searching && <p className="address-muted" role="status">Searching addresses…</p>}
    {!searching && search.trim().length >= 3 && !lookupError && suggestions.length === 0 && <p className="address-muted" role="status">No matching addresses found. You can still enter the address manually.</p>}
    {suggestions.length > 0 && <div className="address-suggestions" role="listbox" aria-label="Address suggestions">
      {suggestions.map((suggestion, index) => <button key={`${suggestion.latitude}-${suggestion.longitude}-${index}`} type="button" role="option" onClick={() => applySuggestion(suggestion)}>{suggestion.formattedAddress}</button>)}
    </div>}
    {(lookupError || message) && <p className={lookupError ? 'address-error' : 'address-muted'} role={lookupError ? 'alert' : 'status'}>{lookupError || message}</p>}
    {showMap && <div className="address-map-section">
      <AddressMap latitude={values.latitude} longitude={values.longitude} onMove={movePin} />
      <div className="button-row"><button type="button" className="button button-outline button-small" disabled={Boolean(message) || resolvingPin} onClick={locateMe}>Locate me</button>{values.latitude !== undefined && values.longitude !== undefined && <span className="address-coordinates">Pin: {values.latitude.toFixed(5)}, {values.longitude.toFixed(5)}</span>}<button type="button" className="button button-small" disabled={values.latitude === undefined || resolvingPin} onClick={confirmMap}>Confirm location</button><button type="button" className="text-button" onClick={cancelMap}>Cancel map</button></div>
    </div>}
    <div className="form-grid">
      <label className="field"><span>Recipient full name</span><input autoComplete="name" required maxLength={120} aria-invalid={Boolean(fieldErrors.name)} value={values.name} onChange={(event) => setField('name', event.target.value)} />{fieldErrors.name && <small className="address-error">{fieldErrors.name}</small>}</label>
      <label className="field"><span>Recipient mobile number</span><input autoComplete="tel" inputMode="tel" required pattern="(\+91[6-9][0-9]{9}|[6-9][0-9]{9})" aria-invalid={Boolean(fieldErrors.phone)} value={values.phone} onChange={(event) => setField('phone', event.target.value)} />{fieldErrors.phone && <small className="address-error">{fieldErrors.phone}</small>}</label>
      <label className="field"><span>House / building number</span><input autoComplete="address-line1" maxLength={100} value={values.houseNumber ?? ''} onChange={(event) => setField('houseNumber', event.target.value)} /></label>
      <label className="field"><span>Street / road</span><input maxLength={150} value={values.street ?? ''} onChange={(event) => setField('street', event.target.value)} /></label>
      <label className="field"><span>Area / locality</span><input autoComplete="address-level3" maxLength={100} value={values.area ?? ''} onChange={(event) => setField('area', event.target.value)} /></label>
      <label className="field"><span>Landmark (optional)</span><input maxLength={150} value={values.landmark ?? ''} onChange={(event) => setField('landmark', event.target.value)} /></label>
      <label className="field"><span>Village / town / city</span><input autoComplete="address-level2" required maxLength={100} aria-invalid={Boolean(fieldErrors.villageOrCity)} value={values.villageOrCity ?? values.city} onChange={(event) => setField('villageOrCity', event.target.value)} />{fieldErrors.villageOrCity && <small className="address-error">{fieldErrors.villageOrCity}</small>}</label>
      <label className="field"><span>District</span><input maxLength={100} value={values.district ?? ''} onChange={(event) => setField('district', event.target.value)} /></label>
      <label className="field"><span>State</span><input autoComplete="address-level1" required maxLength={100} aria-invalid={Boolean(fieldErrors.state)} value={values.state} onChange={(event) => setField('state', event.target.value)} />{fieldErrors.state && <small className="address-error">{fieldErrors.state}</small>}</label>
      <label className="field"><span>PIN code</span><input autoComplete="postal-code" inputMode="numeric" required pattern="[0-9]{6}" maxLength={6} aria-invalid={Boolean(fieldErrors.postalCode)} value={values.postalCode} onChange={(event) => setField('postalCode', event.target.value)} />{fieldErrors.postalCode && <small className="address-error">{fieldErrors.postalCode}</small>}</label>
      <label className="field"><span>Delivery locality</span><input list="esakhi-service-localities" required maxLength={100} aria-invalid={Boolean(fieldErrors.locality)} value={values.locality} onChange={(event) => setField('locality', event.target.value)} /><datalist id="esakhi-service-localities">{serviceLocalities.map((zone) => <option key={zone.name} value={zone.name} />)}</datalist><small>Delivery is confirmed only for a configured locality and PIN code.</small>{fieldErrors.locality && <small className="address-error">{fieldErrors.locality}</small>}</label>
      <label className="field"><span>Address label</span><select value={values.label ?? 'Home'} onChange={(event) => setField('label', event.target.value)}><option>Home</option><option>Work</option><option>Other</option></select></label>
      {fieldErrors.address && <p className="address-error span-two">{fieldErrors.address}</p>}
      <label className="field span-two"><span>Delivery instructions (optional)</span><textarea rows={2} maxLength={500} value={values.deliveryInstructions ?? ''} onChange={(event) => setField('deliveryInstructions', event.target.value)} /></label>
    </div>
    <label className="address-default-option"><input type="checkbox" checked={Boolean(values.isDefault)} onChange={(event) => setField('isDefault', event.target.checked)} /> Set as my default delivery address</label>
    {error && <p className="address-error" role="alert">{error}</p>}
    <div className="button-row"><button className="button" type="submit">Review address</button><button type="button" className="text-button" onClick={onCancel}>Cancel</button></div>
  </form>;
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
    return <AddressForm
      initialAddress={editing ?? undefined}
      serviceLocalities={serviceLocalities}
      customerName={customerName}
      customerPhone={customerPhone}
      onSave={save}
      onCancel={() => { setAdding(false); setEditing(null); }}
    />;
  }

  return <section className="address-book">
    {addresses.length === 0 && <p className="address-muted">No saved delivery addresses yet. Add one to speed up checkout.</p>}
    {actionError && <p className="address-error" role="alert">{actionError}</p>}
    <div className="address-book-list">
      {addresses.map((address) => {
        const id = address.id ?? address._id ?? '';
        const selectedAddress = id === selected;
        return <article className={`saved-address-card ${selectedAddress ? 'selected' : ''}`} key={id}>
          {onSelect && <label className="saved-address-select"><input type="radio" name="checkout-address" checked={selectedAddress} onChange={() => onSelect(address)} /><span className="sr-only">Use this delivery address</span></label>}
          <div className="saved-address-copy">
            <div className="saved-address-heading"><strong>{address.label || 'Address'}</strong>{address.isDefault && <span>Default</span>}</div>
            <p>{address.formattedAddress || [address.addressLine1, address.addressLine2, address.area, address.city, address.state, address.postalCode].filter(Boolean).join(', ')}</p>
            <small>{address.name} · {address.phone}</small>
          </div>
          <div className="saved-address-actions">
            <button type="button" className="text-button" onClick={() => setEditing(address)}>Edit</button>
            {!address.isDefault && <button type="button" className="text-button" onClick={() => void setDefault(id)}>Make default</button>}
            {pendingDelete === id
              ? <><button type="button" className="text-button danger-text" onClick={() => void deleteAddress(id)}>Confirm delete</button><button type="button" className="text-button" onClick={() => setPendingDelete('')}>Keep</button></>
              : <button type="button" className="text-button danger-text" onClick={() => setPendingDelete(id)}>Delete</button>}
          </div>
        </article>;
      })}
    </div>
    {addresses.length < 10
      ? <button type="button" className="button button-outline" onClick={() => setAdding(true)}>+ Add a delivery address</button>
      : <p className="address-muted">You can save up to 10 addresses.</p>}
  </section>;
}
