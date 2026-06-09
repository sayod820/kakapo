/** Nominatim geocoding — г. Яван */

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ru`,
      { headers: { 'User-Agent': 'KAKAPO.TJ/1.0' } }
    );
    const data = await res.json();
    const a = data.address ?? {};
    const parts = [
      a.road || a.pedestrian || a.street,
      a.house_number,
      a.suburb || a.neighbourhood || a.city_district,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : data.display_name?.split(',').slice(0, 3).join(',') ?? '';
  } catch {
    return '';
  }
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
