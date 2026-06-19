'use client';
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { DEFAULT_PRICING, type PricingConfig } from './courierData';
import { DEFAULT_PICKUPS, pickupsToLocationMap, type PickupPoint, type PickupLocationMap, upsertRestaurantPickup, type RestaurantPickupSync, restIdToPickupId } from './pickups';
import { USE_API } from './config';
import { api } from './api';
import { hydrateCourierTeamStore, syncCourierTeamFromApi } from './courierTeamStore';
import { clearAppDataLocalCache, persistAppDataLocally } from './localCache';

const PRICING_KEY = 'kakapo-pricing';
const PICKUPS_KEY = 'kakapo-pickups';

function loadPickups(): PickupPoint[] {
  if (USE_API) return DEFAULT_PICKUPS;
  if (typeof window === 'undefined') return DEFAULT_PICKUPS;
  try {
    const raw = localStorage.getItem(PICKUPS_KEY);
    if (!raw) return DEFAULT_PICKUPS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_PICKUPS;
  } catch {
    return DEFAULT_PICKUPS;
  }
}

function loadPricing(): PricingConfig {
  if (USE_API) return DEFAULT_PRICING;
  if (typeof window === 'undefined') return DEFAULT_PRICING;
  try {
    const raw = localStorage.getItem(PRICING_KEY);
    if (!raw) return DEFAULT_PRICING;
    return { ...DEFAULT_PRICING, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PRICING;
  }
}

function saveJson(key: string, value: unknown) {
  if (typeof window === 'undefined' || !persistAppDataLocally()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* quota */ }
}

interface PricingStore {
  pricing: PricingConfig;
  setPricing: (p: Partial<PricingConfig>) => void;
  hydrated: boolean;
  hydrate: () => void;
}

interface PickupStore {
  pickups: PickupPoint[];
  setPickups: (list: PickupPoint[]) => void;
  updatePickup: (id: string, patch: Partial<PickupPoint>) => void;
  syncRestaurantPickup: (data: RestaurantPickupSync) => void;
  hydrated: boolean;
  hydrate: () => void;
}

export const usePricingStore = create<PricingStore>((set, get) => ({
  pricing: DEFAULT_PRICING,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    if (USE_API) {
      void syncCourierStoresFromApi();
      return;
    }
    set({ pricing: loadPricing(), hydrated: true });
  },
  setPricing: p => set(s => {
    const pricing = { ...s.pricing, ...p };
    if (!USE_API) saveJson(PRICING_KEY, pricing);
    else api.updatePricing(pricing).catch(console.error);
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        new BroadcastChannel('kakapo-pricing').postMessage({ type: 'update', pricing });
      }
    } catch { /* ignore */ }
    return { pricing };
  }),
}));

export const usePickupStore = create<PickupStore>((set, get) => ({
  pickups: DEFAULT_PICKUPS,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    if (USE_API) {
      void syncCourierStoresFromApi();
      return;
    }
    set({ pickups: loadPickups(), hydrated: true });
  },
  setPickups: list => {
    if (!USE_API) saveJson(PICKUPS_KEY, list);
    set({ pickups: list });
  },
  updatePickup: (id, patch) => set(s => {
    const pickups = s.pickups.map(p => (p.id === id ? { ...p, ...patch } : p));
    if (!USE_API) saveJson(PICKUPS_KEY, pickups);
    else api.updatePickup(id, patch).catch(console.error);
    return { pickups };
  }),
  syncRestaurantPickup: data => set(s => {
    const pickups = upsertRestaurantPickup(s.pickups, data);
    if (!USE_API) saveJson(PICKUPS_KEY, pickups);
    else {
      const id = restIdToPickupId(data.restId);
      const row = pickups.find(p => p.id === id);
      if (row) {
        api.updatePickup(id, {
          lat: row.lat,
          lng: row.lng,
          addr: row.addr,
          phone: row.phone,
          name: row.name,
          e: row.e,
          active: row.active,
        }).catch(console.error);
      }
    }
    return { pickups };
  }),
}));

export function usePricing() {
  const hydrate = usePricingStore(s => s.hydrate);
  const pricing = usePricingStore(s => s.pricing);
  useEffect(() => {
    hydrate();
    let bc: BroadcastChannel | null = null;
    const onStorage = (e: StorageEvent) => {
      if (e.key === PRICING_KEY) hydrate();
    };
    window.addEventListener('storage', onStorage);
    try {
      bc = new BroadcastChannel('kakapo-pricing');
      bc.onmessage = () => {
        if (USE_API) void syncCourierStoresFromApi();
        else hydrate();
      };
    } catch { /* ignore */ }
    return () => {
      window.removeEventListener('storage', onStorage);
      try { bc?.close(); } catch { /* ignore */ }
    };
  }, [hydrate]);
  return { pricing };
}

export function usePickups() {
  const hydrate = usePickupStore(s => s.hydrate);
  const pickups = usePickupStore(s => s.pickups);
  useEffect(() => { hydrate(); }, [hydrate]);
  return pickups;
}

export function usePickupLocations(): PickupLocationMap {
  const pickups = usePickups();
  return useMemo(() => pickupsToLocationMap(pickups), [pickups]);
}

/** Синхронизация store при загрузке любого приложения */
export function hydrateCourierStores() {
  if (USE_API) {
    void syncCourierStoresFromApi();
    return;
  }
  usePricingStore.getState().hydrate();
  usePickupStore.getState().hydrate();
  hydrateCourierTeamStore();
}

/** Загрузить pickups + pricing с API (Render) */
export async function syncCourierStoresFromApi() {
  if (!USE_API) {
    hydrateCourierStores();
    return;
  }
  try {
    clearAppDataLocalCache();
    const [pickups, pricing] = await Promise.all([
      api.getPickups(),
      api.getPricing(),
    ]);
    await syncCourierTeamFromApi();
    usePickupStore.setState({ pickups, hydrated: true });
    usePricingStore.setState({ pricing: { ...DEFAULT_PRICING, ...pricing }, hydrated: true });
  } catch (e) {
    console.error(e);
    usePickupStore.setState({ pickups: DEFAULT_PICKUPS, hydrated: true });
    usePricingStore.setState({ pricing: DEFAULT_PRICING, hydrated: true });
  }
}
