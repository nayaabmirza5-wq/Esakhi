import { useState } from 'react';
import { useBazaar, DAMOH_LOCALITIES } from './BazaarContext';
import {
  MapPin,
  Store,
  Clock,
  Bell,
  ChevronDown,
  X,
  Compass,
  CheckCircle2,
} from 'lucide-react';

export function BazaarLocationBar() {
  const {
    selectedLocality,
    setSelectedLocality,
    searchScope,
    setSearchScope,
  } = useBazaar();

  const [isLocalityDropdownOpen, setIsLocalityDropdownOpen] = useState(false);

  return (
    <div className="w-full bg-[#1E1B4B] text-[#F8FAFC] border-b border-[#2E2868] shadow-xs">
      <div className="max-w-6xl mx-auto px-4 py-2 flex flex-col md:flex-row md:items-center justify-between gap-2.5">
        {/* Left: Locality Selector with Dropdown */}
        <div className="flex items-center gap-2 relative">
          <span className="flex items-center gap-1.5 text-xs text-white/90 font-bold shrink-0">
            <MapPin className="w-3.5 h-3.5 text-[#A3E635]" />
            Delivering to:
          </span>

          <button
            type="button"
            onClick={() => setIsLocalityDropdownOpen(!isLocalityDropdownOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white font-extrabold text-xs transition-colors border border-white/25 cursor-pointer shadow-xs"
            aria-label="Select delivery locality in Damoh"
          >
            <span>{selectedLocality.name}, Damoh</span>
            <ChevronDown className="w-3.5 h-3.5 text-[#A3E635]" />
          </button>

          {/* Dropdown Menu */}
          {isLocalityDropdownOpen && (
            <div className="absolute top-10 left-0 z-50 w-72 bg-white text-[#1E1B4B] rounded-xl shadow-2xl border border-slate-200 p-2 animate-fadeIn">
              <div className="px-2.5 py-1.5 text-[11px] font-extrabold text-slate-600 uppercase tracking-wider flex items-center justify-between border-b border-slate-100">
                <span>Select Mohalla / Locality</span>
                <span className="text-[#1E1B4B] font-black">Damoh, MP</span>
              </div>
              <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 mt-1">
                {DAMOH_LOCALITIES.map((loc) => {
                  const isCurrent = loc.id === selectedLocality.id;
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => {
                        setSelectedLocality(loc);
                        setIsLocalityDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-[#F8FAFC] transition-colors rounded-lg cursor-pointer ${
                        isCurrent ? 'bg-[#F1F5F9] font-black text-[#1E1B4B] border-l-4 border-[#A3E635]' : 'text-slate-800 font-semibold'
                      }`}
                    >
                      <div>
                        <div className="font-bold">{loc.name}</div>
                        <div className="text-[10px] text-slate-500 font-normal">{loc.popularFor}</div>
                      </div>
                      {isCurrent && <CheckCircle2 className="w-4 h-4 text-[#65A30D] shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: "My Area" vs "Entire Damoh" Dual Toggle Pills */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          <span className="text-xs text-white/90 font-bold hidden sm:inline">Search Mode:</span>
          <div className="inline-flex p-1 rounded-xl bg-[#0F0D2E] border border-white/20 gap-1 shadow-inner">
            <button
              type="button"
              onClick={() => setSearchScope('my_area')}
              style={{
                background: searchScope === 'my_area' ? '#A3E635' : 'transparent',
                color: searchScope === 'my_area' ? '#1E1B4B' : '#FFFFFF',
                border: searchScope === 'my_area' ? '1px solid #84CC16' : '1px solid transparent',
                fontWeight: searchScope === 'my_area' ? 900 : 700,
              }}
              className="px-3.5 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1.5 cursor-pointer hover:bg-white/10"
              title="Show shops and products in your immediate locality first"
            >
              <span>🏠 My Area</span>
              <span style={{ fontSize: '10px', opacity: searchScope === 'my_area' ? 0.9 : 0.75 }} className="hidden lg:inline">
                ({selectedLocality.name})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSearchScope('entire_damoh')}
              style={{
                background: searchScope === 'entire_damoh' ? '#A3E635' : 'transparent',
                color: searchScope === 'entire_damoh' ? '#1E1B4B' : '#FFFFFF',
                border: searchScope === 'entire_damoh' ? '1px solid #84CC16' : '1px solid transparent',
                fontWeight: searchScope === 'entire_damoh' ? 900 : 700,
              }}
              className="px-3.5 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1.5 cursor-pointer hover:bg-white/10"
              title="Search across all shops across Entire Damoh sorted by proximity"
            >
              <span>🌐 Entire Damoh</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ClosedShopNoticeModal() {
  const {
    closedShopModalProduct,
    setClosedShopModalProduct,
    setSearchScope,
  } = useBazaar();

  const [notified, setNotified] = useState(false);

  if (!closedShopModalProduct) return null;

  const product = closedShopModalProduct;
  const hours = product.operatingHours || { openTime: '09:30', closeTime: '20:30', openDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden">
        {/* Header Banner - Dark Indigo */}
        <div className="bg-[#1E1B4B] p-4 text-[#F8FAFC] flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[#A3E635] flex items-center justify-center text-[#1E1B4B] font-bold text-lg shadow-sm">
              <Store className="w-5 h-5 text-[#1E1B4B]" />
            </div>
            <div>
              <h3 className="font-extrabold text-base leading-tight text-white">
                Shop is Currently Closed
              </h3>
              <p className="text-xs text-[#CBD5E1] mt-0.5">
                {product.sellerName || 'Local Shop in Damoh'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setClosedShopModalProduct(null)}
            className="p-1 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body - Light Background canvas */}
        <div className="p-5 space-y-4 text-sm text-[#1E1B4B] bg-[#F8FAFC]">
          <div className="p-3.5 rounded-xl bg-white border border-[#C084FC]/30 shadow-xs space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-[#1E1B4B] flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-[#C084FC]" />
                Operating Hours:
              </span>
              <span className="font-mono font-bold text-[#1E1B4B] bg-[#F1F5F9] px-2 py-0.5 rounded border border-slate-200">
                {hours.openTime} – {hours.closeTime}
              </span>
            </div>
            <div className="text-xs text-slate-600 flex items-center gap-1">
              <span>Days:</span>
              <span className="font-semibold text-slate-800">{hours.openDays.join(', ')}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-slate-700 leading-relaxed">
              <strong>{product.name}</strong> is available at <strong>{product.sellerName}</strong> ({product.shopLocality}, ~{product.distanceKm} km away), but the seller has currently closed the shop ({product.storeClosedReason || 'Closed • Opens Tomorrow'}).
            </p>
            {product.alternativeOpenProduct ? (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-950 text-xs">
                <div className="font-extrabold flex items-center gap-1.5 text-emerald-900 mb-1">
                  <span>🏪 Alternative Open Store Found!</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  The exact same item (Master SKU: {product.masterSku || 'Verified'}) is in stock and available right now at <strong>{product.alternativeOpenProduct.sellerName}</strong> ({product.alternativeOpenProduct.shopLocality}, ~{product.alternativeOpenProduct.distanceKm} km away).
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                You can browse and review items now. Doorstep order placement will be available once the shopkeeper opens.
              </p>
            )}
          </div>

          {notified ? (
            <div className="p-3 rounded-xl bg-[#A3E635]/25 text-[#1E1B4B] text-xs font-bold flex items-center gap-2 border border-[#A3E635]">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[#65A30D]" />
              <span>We'll notify your phone as soon as {product.sellerName} opens!</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setNotified(true)}
              className="w-full h-10 px-4 rounded-xl bg-white hover:bg-[#F3E8FF] text-[#1E1B4B] border border-[#C084FC]/50 text-xs font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
            >
              <Bell className="w-4 h-4 text-[#C084FC]" />
              Notify Me When Shop Opens ({hours.openTime})
            </button>
          )}

          <div className="pt-2 border-t border-slate-200 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setSearchScope('entire_damoh');
                setClosedShopModalProduct(null);
              }}
              className="w-full h-10 px-4 rounded-xl bg-[#A3E635] hover:bg-[#BEF264] text-[#1E1B4B] text-xs font-extrabold shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer border border-[#84CC16]"
            >
              <Compass className="w-4 h-4" />
              Find Open Shops in Entire Damoh
            </button>

            <button
              type="button"
              onClick={() => setClosedShopModalProduct(null)}
              className="w-full h-9 rounded-xl text-xs text-slate-500 hover:text-slate-800 font-semibold cursor-pointer"
            >
              Continue Browsing Catalog
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SellerStoreToggleBanner({
  sellerName,
  storeOpen,
  onToggle,
}: {
  sellerName: string;
  storeOpen: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div
      className={`p-4 rounded-2xl border transition-all ${
        storeOpen
          ? 'bg-[#F8FAFC] border-[#A3E635]/60 text-[#1E1B4B] shadow-xs'
          : 'bg-rose-50 border-rose-200 text-rose-900'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bold text-lg shadow-2xs ${
              storeOpen ? 'bg-[#A3E635] text-[#1E1B4B]' : 'bg-rose-600 text-white'
            }`}
          >
            <Store className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-extrabold text-sm text-[#1E1B4B]">
                {sellerName || 'My Local Shop'}
              </h3>
              <span
                className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-full ${
                  storeOpen
                    ? 'bg-[#A3E635] text-[#1E1B4B] border border-[#84CC16]'
                    : 'bg-rose-600 text-white'
                }`}
              >
                {storeOpen ? '🟢 SHOP IS LIVE & OPEN' : '🔴 SHOP IS CLOSED'}
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              {storeOpen
                ? 'Your shop is open. Products appear at top for nearby customers in Damoh.'
                : 'Your shop is paused. Products appear demoted and buyers are told you open at 09:30 AM.'}
            </p>
          </div>
        </div>

        {/* Interactive Toggle Switch */}
        <div className="flex items-center gap-2 self-end sm:self-center">
          <span className="text-xs font-bold text-slate-700">
            {storeOpen ? 'Open for Orders' : 'Store Closed'}
          </span>
          <button
            type="button"
            onClick={() => onToggle(!storeOpen)}
            className={`w-14 h-8 rounded-full p-1 transition-colors duration-200 ease-in-out focus:outline-none cursor-pointer ${
              storeOpen ? 'bg-[#A3E635]' : 'bg-slate-300'
            }`}
            aria-label="Toggle store open status"
          >
            <div
              className={`w-6 h-6 rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out ${
                storeOpen ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
