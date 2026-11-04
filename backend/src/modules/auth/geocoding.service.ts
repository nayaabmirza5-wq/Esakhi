import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';

type PhotonFeature = {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
};

type ResolvedAddress = {
  formattedAddress: string;
  houseNumber?: string;
  street?: string;
  area?: string;
  villageOrCity?: string;
  district?: string;
  state?: string;
  postalCode?: string;
  latitude: number;
  longitude: number;
};

function getString(properties: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function resolveFeature(feature: PhotonFeature): ResolvedAddress | null {
  const coordinates = feature.geometry?.coordinates;
  const properties = feature.properties;
  if (!Array.isArray(coordinates) || coordinates.length < 2 || !properties) return null;
  const [longitude, latitude] = coordinates;
  if (typeof longitude !== 'number' || typeof latitude !== 'number'
      || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;

  const houseNumber = getString(properties, 'housenumber');
  const street = getString(properties, 'street', 'road');
  const area = getString(properties, 'suburb', 'neighbourhood', 'quarter', 'locality');
  const villageOrCity = getString(properties, 'city', 'town', 'village');
  const district = getString(properties, 'district', 'county');
  const state = getString(properties, 'state');
  const postalCode = getString(properties, 'postcode');
  const formattedAddress = [
    houseNumber,
    street,
    area,
    villageOrCity,
    district,
    state,
    postalCode,
  ].filter(Boolean).join(', ') || getString(properties, 'name') || '';
  if (!formattedAddress) return null;
  return {
    formattedAddress,
    ...(houseNumber ? { houseNumber } : {}),
    ...(street ? { street } : {}),
    ...(area ? { area } : {}),
    ...(villageOrCity ? { villageOrCity } : {}),
    ...(district ? { district } : {}),
    ...(state ? { state } : {}),
    ...(postalCode ? { postalCode } : {}),
    latitude,
    longitude,
  };
}

async function requestPhoton(path: string): Promise<PhotonFeature[]> {
  const url = new URL(path, env.GEOCODER_BASE_URL);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'eSakhi/1.0 address lookup' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new AppError(502, 'GEOCODING_UNAVAILABLE', 'Address lookup is temporarily unavailable. Please enter the address manually.');
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('features' in body) || !Array.isArray(body.features)) {
      throw new AppError(502, 'GEOCODING_INVALID_RESPONSE', 'Address lookup returned an invalid response. Please enter the address manually.');
    }
    return body.features as PhotonFeature[];
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, 'GEOCODING_UNAVAILABLE', 'Address lookup is temporarily unavailable. Please enter the address manually.');
  }
}

export async function searchAddress(query: string): Promise<ResolvedAddress[]> {
  const params = new URLSearchParams({
    q: query,
    limit: '6',
    lang: 'en',
    bbox: '68.1,6.5,97.4,35.7',
  });
  const features = await requestPhoton(`/api/?${params}`);
  return features.map(resolveFeature).filter((result): result is ResolvedAddress => result !== null);
}

export async function reverseAddress(latitude: number, longitude: number): Promise<ResolvedAddress> {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    lang: 'en',
  });
  const features = await requestPhoton(`/reverse?${params}`);
  const resolved = features.map(resolveFeature).find((result) => result !== null);
  if (!resolved) {
    throw new AppError(404, 'ADDRESS_NOT_FOUND', 'No readable address was found for this map pin. You can still enter the address manually.');
  }
  return resolved;
}
