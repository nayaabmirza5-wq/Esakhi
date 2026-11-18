import { createContext, useContext, useState, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { Product } from '../../types';

export type SearchScope = 'my_area' | 'entire_damoh';

export interface DamohLocality {
  id: string;
  name: string;
  zone: 'Central' | 'North' | 'South' | 'West' | 'East';
  lat: number;
  lng: number;
  popularFor: string;
}

export const DAMOH_LOCALITIES: DamohLocality[] = [
  { id: 'pathani-mohalla', name: 'Pathani Mohalla', zone: 'Central', lat: 23.8375, lng: 79.4390, popularFor: 'Grocery, Dairy & Daily Needs' },
  { id: 'ghanta-ghar', name: 'Ghanta Ghar (Clock Tower)', zone: 'Central', lat: 23.8392, lng: 79.4415, popularFor: 'Main Retail Market & Spices' },
  { id: 'nuri-nagar', name: 'Nuri Nagar', zone: 'North', lat: 23.8460, lng: 79.4430, popularFor: 'Apparel & General Stores' },
  { id: 'purani-bazar', name: 'Purani Bazar', zone: 'Central', lat: 23.8350, lng: 79.4370, popularFor: 'Handicrafts, Sweets & Utensils' },
  { id: 'naya-bazar', name: 'Naya Bazar', zone: 'Central', lat: 23.8398, lng: 79.4445, popularFor: 'Clothing & Footwear' },
  { id: 'station-road', name: 'Station Road', zone: 'South', lat: 23.8310, lng: 79.4470, popularFor: 'Electronics & Packaged Food' },
  { id: 'civil-lines', name: 'Civil Lines', zone: 'West', lat: 23.8420, lng: 79.4280, popularFor: 'Bakeries & Home Decor' },
  { id: 'collectorate-colony', name: 'Collectorate Colony', zone: 'West', lat: 23.8450, lng: 79.4230, popularFor: 'Residential Hub & Convenience' },
  { id: 'cinema-road', name: 'Cinema Road', zone: 'South', lat: 23.8335, lng: 79.4420, popularFor: 'Snacks, Dry Fruits & Gifts' },
  { id: 'malviya-nagar', name: 'Malviya Nagar', zone: 'East', lat: 23.8380, lng: 79.4510, popularFor: 'Local Kirana & Fresh Produce' },
  { id: 'maru-talab', name: 'Maru Talab', zone: 'Central', lat: 23.8330, lng: 79.4340, popularFor: 'Traditional Artisans' },
];

export interface ShopOperatingHours {
  openTime: string;
  closeTime: string;
  openDays: string[];
  splitShift?: {
    enabled: boolean;
    breakStart: string;
    breakEnd: string;
  };
  weeklyOffDays?: string[];
}

export interface RankedProduct extends Product {
  shopLocality: string;
  distanceKm: number;
  isStoreOpen: boolean;
  storeClosedReason?: string;
  operatingHours: ShopOperatingHours;
  alternativeOpenProduct?: RankedProduct | null;
}

interface BazaarContextValue {
  selectedLocality: DamohLocality;
  setSelectedLocality: (locality: DamohLocality) => void;
  searchScope: SearchScope;
  setSearchScope: (scope: SearchScope) => void;
  localities: DamohLocality[];
  getShopDistance: (shopLocalityName: string) => number;
  isShopOpen: (shopName?: string | null) => boolean;
  toggleShopOpenStatus: (shopName: string, forceOpen?: boolean) => boolean;
  getShopHours: (shopName?: string | null) => ShopOperatingHours;
  rankProducts: (products: Product[]) => RankedProduct[];
  closedShopModalProduct: RankedProduct | null;
  setClosedShopModalProduct: (product: RankedProduct | null) => void;
}

const BazaarContext = createContext<BazaarContextValue | null>(null);

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the Earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const dist = R * c;
  return Math.round(dist * 10) / 10;
}

// Consistent deterministic locality assignment for shops in Damoh
export function resolveShopLocality(sellerName?: string | null): DamohLocality {
  if (!sellerName) return DAMOH_LOCALITIES[0];
  const lower = sellerName.toLowerCase();

  // Direct matching on known Damoh Mohallas & keywords
  if (lower.includes('pathani')) return DAMOH_LOCALITIES.find((l) => l.id === 'pathani-mohalla') || DAMOH_LOCALITIES[0];
  if (lower.includes('ghanta')) return DAMOH_LOCALITIES.find((l) => l.id === 'ghanta-ghar') || DAMOH_LOCALITIES[1];
  if (lower.includes('nuri')) return DAMOH_LOCALITIES.find((l) => l.id === 'nuri-nagar') || DAMOH_LOCALITIES[2];
  if (lower.includes('purani')) return DAMOH_LOCALITIES.find((l) => l.id === 'purani-bazar') || DAMOH_LOCALITIES[3];
  if (lower.includes('naya')) return DAMOH_LOCALITIES.find((l) => l.id === 'naya-bazar') || DAMOH_LOCALITIES[4];
  if (lower.includes('station')) return DAMOH_LOCALITIES.find((l) => l.id === 'station-road') || DAMOH_LOCALITIES[5];
  if (lower.includes('civil')) return DAMOH_LOCALITIES.find((l) => l.id === 'civil-lines') || DAMOH_LOCALITIES[6];
  if (lower.includes('collectorate')) return DAMOH_LOCALITIES.find((l) => l.id === 'collectorate-colony') || DAMOH_LOCALITIES[7];
  if (lower.includes('cinema')) return DAMOH_LOCALITIES.find((l) => l.id === 'cinema-road') || DAMOH_LOCALITIES[8];
  if (lower.includes('malviya')) return DAMOH_LOCALITIES.find((l) => l.id === 'malviya-nagar') || DAMOH_LOCALITIES[9];
  if (lower.includes('maru')) return DAMOH_LOCALITIES.find((l) => l.id === 'maru-talab') || DAMOH_LOCALITIES[10];

  // Match known local businesses
  if (lower.includes('shree ram') || lower.includes('maitri')) {
    return DAMOH_LOCALITIES.find((l) => l.id === 'pathani-mohalla') || DAMOH_LOCALITIES[0];
  }
  if (lower.includes('damoh fresh dairy') || lower.includes('rano')) {
    return DAMOH_LOCALITIES.find((l) => l.id === 'ghanta-ghar') || DAMOH_LOCALITIES[1];
  }
  if (lower.includes('krishna')) {
    return DAMOH_LOCALITIES.find((l) => l.id === 'nuri-nagar') || DAMOH_LOCALITIES[2];
  }

  let hash = 0;
  for (let i = 0; i < sellerName.length; i++) {
    hash = (hash << 5) - hash + sellerName.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % DAMOH_LOCALITIES.length;
  return DAMOH_LOCALITIES[index];
}

export function BazaarProvider({ children }: { children: ReactNode }) {
  // Default to Pathani Mohalla as requested
  const [selectedLocality, setSelectedLocalityState] = useState<DamohLocality>(() => {
    try {
      const saved = localStorage.getItem('bazaartohome.locality');
      if (saved) {
        const found = DAMOH_LOCALITIES.find((l) => l.id === saved || l.name === saved);
        if (found) return found;
      }
    } catch {
      /* ignore */
    }
    return DAMOH_LOCALITIES[0]; // Pathani Mohalla
  });

  const [searchScope, setSearchScopeState] = useState<SearchScope>(() => {
    try {
      const saved = localStorage.getItem('bazaartohome.scope');
      if (saved === 'my_area' || saved === 'entire_damoh') return saved;
    } catch {
      /* ignore */
    }
    return 'my_area';
  });

  // Shop Open/Closed statuses persisted locally
  const [shopStatusOverrides, setShopStatusOverrides] = useState<Record<string, boolean>>(() => {
    try {
      if (typeof window !== 'undefined' && window.location.search.includes('closed_shop')) {
        return { 'damoh fresh dairy (ghanta ghar)': false, 'damoh fresh dairy': false };
      }
      const raw = localStorage.getItem('bazaartohome.shop_status_overrides');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const [closedShopModalProduct, setClosedShopModalProduct] = useState<RankedProduct | null>(null);

  const setSelectedLocality = (locality: DamohLocality) => {
    setSelectedLocalityState(locality);
    try {
      localStorage.setItem('bazaartohome.locality', locality.id);
    } catch {
      /* ignore */
    }
  };

  const setSearchScope = (scope: SearchScope) => {
    setSearchScopeState(scope);
    try {
      localStorage.setItem('bazaartohome.scope', scope);
    } catch {
      /* ignore */
    }
  };

  const getShopDistance = (shopLocalityName: string): number => {
    const target = DAMOH_LOCALITIES.find(
      (l) => l.name.toLowerCase() === shopLocalityName.toLowerCase() || l.id === shopLocalityName.toLowerCase()
    );
    if (!target) return 1.2;
    if (target.id === selectedLocality.id) return 0.3; // Within same locality (~300m)
    const dist = haversineDistanceKm(selectedLocality.lat, selectedLocality.lng, target.lat, target.lng);
    return Math.max(0.4, dist);
  };

  const getShopHours = (shopName?: string | null): ShopOperatingHours => {
    const key = (shopName || '').toLowerCase();
    const isTuesdayOff = key.includes('purani') || key.includes('bazar');
    return {
      openTime: '09:30',
      closeTime: '20:30',
      openDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      splitShift: {
        enabled: true,
        breakStart: '13:30',
        breakEnd: '16:30',
      },
      weeklyOffDays: isTuesdayOff ? ['Tue'] : ['Sun'],
    };
  };

  const getStoreStatusDetails = (shopName?: string | null): { isOpen: boolean; reason?: string } => {
    const key = (shopName || 'Main Store').trim().toLowerCase();
    if (typeof window !== 'undefined' && window.location.search.includes('closed_shop') && (key.includes('damoh fresh dairy') || key.includes('ghanta'))) {
      return { isOpen: false, reason: 'Closed • Opens Tomorrow' };
    }
    if (typeof shopStatusOverrides[key] === 'boolean') {
      return {
        isOpen: shopStatusOverrides[key],
        reason: shopStatusOverrides[key] ? undefined : 'Closed • Shop Paused by Merchant',
      };
    }

    const hours = getShopHours(shopName);
    const now = new Date();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentDay = dayNames[now.getDay()];

    if (hours.weeklyOffDays && hours.weeklyOffDays.includes(currentDay)) {
      return { isOpen: false, reason: 'Closed • Weekly Off (Opens Tomorrow)' };
    }

    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentTimeStr = `${String(currentHours).padStart(2, '0')}:${String(currentMinutes).padStart(2, '0')}`;

    if (currentTimeStr < hours.openTime || currentTimeStr > hours.closeTime) {
      return { isOpen: false, reason: `Closed • Opens Tomorrow at ${hours.openTime}` };
    }

    if (hours.splitShift?.enabled) {
      if (currentTimeStr >= hours.splitShift.breakStart && currentTimeStr < hours.splitShift.breakEnd) {
        return { isOpen: false, reason: `Closed • Afternoon Break (Opens at ${hours.splitShift.breakEnd})` };
      }
    }

    return { isOpen: true };
  };

  const isShopOpen = (shopName?: string | null): boolean => {
    return getStoreStatusDetails(shopName).isOpen;
  };

  const toggleShopOpenStatus = (shopName: string, forceOpen?: boolean): boolean => {
    const key = shopName.trim().toLowerCase();
    const current = isShopOpen(shopName);
    const next = forceOpen !== undefined ? forceOpen : !current;
    setShopStatusOverrides((prev) => {
      const updated = { ...prev, [key]: next };
      try {
        localStorage.setItem('bazaartohome.shop_status_overrides', JSON.stringify(updated));
      } catch {
        /* ignore */
      }
      return updated;
    });
    return next;
  };

  // The Core Proximity & Open Status Ranking Algorithm with Master SKU Switching
  const rankProducts = useMemo(() => {
    return (products: Product[]): RankedProduct[] => {
      const enriched: RankedProduct[] = products.map((prod) => {
        const locality = resolveShopLocality(prod.sellerName);
        const distance = getShopDistance(locality.name);
        const status = getStoreStatusDetails(prod.sellerName);
        const hours = getShopHours(prod.sellerName);
        return {
          ...prod,
          shopLocality: locality.name,
          distanceKm: distance,
          isStoreOpen: status.isOpen,
          storeClosedReason: status.reason,
          operatingHours: hours,
          alternativeOpenProduct: null,
        };
      });

      // Master SKU Multi-Store Switching:
      // If a product belongs to a closed store, find an open nearby store carrying the same Master SKU
      for (const prod of enriched) {
        if (!prod.isStoreOpen && prod.masterSku) {
          const openAlternative = enriched.find(
            (other) =>
              other.isStoreOpen &&
              other.masterSku === prod.masterSku &&
              (other.stock ?? 1) > 0 &&
              (other.id || other._id) !== (prod.id || prod._id)
          );
          if (openAlternative) {
            prod.alternativeOpenProduct = openAlternative;
          }
        }
      }

      // Filter if in 'my_area'
      let filtered = enriched;
      if (searchScope === 'my_area') {
        filtered = enriched.filter(
          (p) => p.shopLocality.toLowerCase() === selectedLocality.name.toLowerCase()
        );
      }

      // Proximity & Open Status Ranking Formula:
      return filtered.sort((a, b) => {
        if (a.isStoreOpen && !b.isStoreOpen) return -1;
        if (!a.isStoreOpen && b.isStoreOpen) return 1;
        return a.distanceKm - b.distanceKm;
      });
    };
  }, [selectedLocality, searchScope, shopStatusOverrides]);

  return (
    <BazaarContext.Provider
      value={{
        selectedLocality,
        setSelectedLocality,
        searchScope,
        setSearchScope,
        localities: DAMOH_LOCALITIES,
        getShopDistance,
        isShopOpen,
        toggleShopOpenStatus,
        getShopHours,
        rankProducts,
        closedShopModalProduct,
        setClosedShopModalProduct,
      }}
    >
      {children}
    </BazaarContext.Provider>
  );
}

export function useBazaar(): BazaarContextValue {
  const context = useContext(BazaarContext);
  if (!context) {
    throw new Error('useBazaar must be used within a BazaarProvider');
  }
  return context;
}
