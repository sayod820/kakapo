/** Nominatim geocoding — г. Яван */

export type ReverseGeocodeParts = {
  street: string;
  houseNumber: string;
  display: string;
};

export async function reverseGeocodeParts(lat: number, lng: number): Promise<ReverseGeocodeParts> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ru`,
      { headers: { 'User-Agent': 'KAKAPO.TJ/1.0' } },
    );
    const data = await res.json();
    const a = data.address ?? {};
    const street = a.road || a.pedestrian || a.street || '';
    const houseNumber = a.house_number || '';
    const district = a.suburb || a.neighbourhood || a.city_district || '';
    const display = [street, houseNumber, district].filter(Boolean).join(', ')
      || data.display_name?.split(',').slice(0, 3).join(',')
      || '';
    return { street, houseNumber, display };
  } catch {
    return { street: '', houseNumber: '', display: '' };
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const parts = await reverseGeocodeParts(lat, lng);
  if (parts.display) return parts.display;
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export async function forwardGeocode(query: string): Promise<{ lat: number; lng: number; display: string }[]> {
  try {
    const q = encodeURIComponent(`${query}, Яван, Таджикистан`);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=4&accept-language=ru`,
      { headers: { 'User-Agent': 'KAKAPO.TJ/1.0' } }
    );
    const data = await res.json();
    return data.map((d: { lat: string; lon: string; display_name: string }) => ({
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lon),
      display: d.display_name,
    }));
  } catch {
    return [];
  }
}
