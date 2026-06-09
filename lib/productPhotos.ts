'use client';
import { create } from 'zustand';

const PHOTOS_KEY = 'kakapo-product-photos';

function loadPhotos(): Record<number, string> {
  if (typeof window === 'undefined') return {};
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
  if (typeof window === 'undefined') return;
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

export function resolveProductPhoto(product: { id: number; photo?: string }, getPhoto: (id: number) => string | undefined) {
  return product.photo || getPhoto(product.id);
}
