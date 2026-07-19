'use client';
import { create } from 'zustand';
import { USE_API } from './config';
import { persistAppDataLocally } from './localCache';

const PHOTOS_KEY = 'kakapo-product-photos';

function loadPhotos(): Record<number, string> {
  if (USE_API || typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(PHOTOS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return Object.fromEntries(
      Object.entries(parsed).map(([id, url]) => [Number(id), url]),
    );
  } catch {
    return {};
  }
}

function savePhotos(photos: Record<number, string>) {
  if (typeof window === 'undefined' || !persistAppDataLocally()) return;
  try {
    localStorage.setItem(PHOTOS_KEY, JSON.stringify(photos));
  } catch { /* quota */ }
}

interface ProductPhotosStore {
  photos: Record<number, string>;
  hydrated: boolean;
  hydrate: () => void;
  setPhoto: (id: number, photo: string) => void;
  removePhoto: (id: number) => void;
  getPhoto: (id: number) => string | undefined;
}

export const useProductPhotos = create<ProductPhotosStore>((set, get) => ({
  photos: {},
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ photos: loadPhotos(), hydrated: true });
  },
  setPhoto: (id, photo) => {
    const photos = { ...get().photos, [id]: photo };
    savePhotos(photos);
    set({ photos });
  },
  removePhoto: (id) => {
    const { [id]: _, ...rest } = get().photos;
    savePhotos(rest);
    set({ photos: rest });
  },
  getPhoto: (id) => get().photos[id],
}));

/** URL фото товара: серверное → локальный fallback (демо без API) */
export function resolveProductPhoto(
  product: { id?: number; photo?: string | null; photoThumb?: string | null } | null | undefined,
  opts?: { preferThumb?: boolean; getPhoto?: (id: number) => string | undefined },
) {
  if (!product) return undefined
  const preferThumb = opts?.preferThumb !== false
  const local = typeof product.id === 'number' && opts?.getPhoto
    ? opts.getPhoto(product.id)
    : undefined
  if (preferThumb) {
    return product.photoThumb || product.photo || local || undefined
  }
  return product.photo || product.photoThumb || local || undefined
}

/** Иконка/фото для строки заказа: сначала поля item, иначе живой каталог */
export function resolveOrderItemPhoto(
  item: { id?: number; product_id?: number; photo?: string | null; photoThumb?: string | null; e?: string },
  products?: Array<{ id: number; photo?: string | null; photoThumb?: string | null }>,
) {
  const fromItem = item.photoThumb || item.photo
  if (fromItem) return fromItem
  const pid = Number(item.product_id ?? item.id)
  if (!pid || !products?.length) return undefined
  const p = products.find(x => x.id === pid)
  return p ? (p.photoThumb || p.photo || undefined) : undefined
}
