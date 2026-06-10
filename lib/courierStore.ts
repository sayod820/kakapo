'use client';
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { DEFAULT_PRICING, type PricingConfig } from './courierData';
import { DEFAULT_PICKUPS, pickupsToLocationMap, type PickupPoint, type PickupLocationMap, upsertRestaurantPickup, type RestaurantPickupSync } from './pickups';
import { USE_API } from './config';
import { api } from './api';

const PRICING_KEY = 'kakapo-pricing';
const PICKUPS_KEY = 'kakapo-pickups';

function loadPickups(): PickupPoint[] {
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
  if (typeof window === 'undefined') return;
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
    set({ pricing: loadPricing(), hydrated: true });
  },
  setPricing: p => set(s => {
    const pricing = { ...s.pricing, ...p };
    if (!USE_API) saveJson(PRICING_KEY, pricing);
    else api.updatePricing(pricing).catch(console.error);
    return { pricing };
  }),
}));

export const usePickupStore = create<PickupStore>((set, get) => ({
  pickups: DEFAULT_PICKUPS,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
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
    return { pickups };
  }),
}));

export function usePricing() {
  const hydrate = usePricingStore(s => s.hydrate);
  const pricing = usePricingStore(s => s.pricing);
  useEffect(() => { hydrate(); }, [hydrate]);
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
  usePricingStore.getState().hydrate();
  usePickupStore.getState().hydrate();
}

/** Загрузить pickups + pricing с API (Render) */
export async function syncCourierStoresFromApi() {
  if (!USE_API) {
    hydrateCourierStores();
    return;
  }
  try {
    const [pickups, pricing] = await Promise.all([api.getPickups(), api.getPricing()]);
    usePickupStore.setState({ pickups, hydrated: true });
    usePricingStore.setState({ pricing: { ...DEFAULT_PRICING, ...pricing }, hydrated: true });
  } catch (e) {
    console.error(e);
    hydrateCourierStores();
  }
}
