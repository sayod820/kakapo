'use client';
import { useState, useEffect } from 'react';
import { fetchOrdersRoadKm } from './courierData';
import { usePickupLocations } from './courierStore';

/** OSRM км для списка заказов — общий хук для курьера и админки */
export function useOrderRoadKm<T extends { id: string; pickupIds: string[]; lat: number; lng: number }>(
  orders: T[],
  enabled = true
) {
  const locations = usePickupLocations();
  const locKey = JSON.stringify(locations);
  const [roadKm, setRoadKm] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !orders.length) return;
    let cancelled = false;
    setLoading(true);
    fetchOrdersRoadKm(orders, locations).then(map => {
      if (!cancelled) {
        setRoadKm(map);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [enabled, orders, locKey]);

  return { roadKm, loading };
}
