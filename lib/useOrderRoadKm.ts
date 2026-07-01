'use client';
import { useState, useEffect, useMemo } from 'react';
import { fetchOrdersRoadKm, type RoadKmOrderInput } from './courierData';
import { usePickupLocations } from './courierStore';
import { normalizeOrder, resolveOrderRoutePickupIds } from './orderParts';
import type { Order } from './types';

type RoadKmOrder = { id: string; distanceKm?: number } & RoadKmOrderInput;

function normalizeRoadKmOrder(o: RoadKmOrder | Order): RoadKmOrder {
  if ('lat' in o && typeof o.lat === 'number' && 'lng' in o && typeof o.lng === 'number') {
    const mapped = o as RoadKmOrder;
    if (mapped.routePickupIds?.length) return mapped;
    if (mapped.pickupIds?.length) {
      return { ...mapped, routePickupIds: mapped.pickupIds };
    }
    return mapped;
  }
  const order = normalizeOrder(o as Order);
  const routePickupIds = resolveOrderRoutePickupIds(order);
  return {
    id: order.id,
    lat: order.client?.lat ?? 38.325,
    lng: order.client?.lng ?? 69.028,
    pickupIds: order.pickupIds,
    routePickupIds,
    distanceKm: order.distanceKm,
  };
}

function roadKmInputKey(o: RoadKmOrder): string {
  const pids = o.routePickupIds?.length ? o.routePickupIds : (o.pickupIds ?? []);
  return `${o.id}:${o.lat.toFixed(5)}:${o.lng.toFixed(5)}:${pids.join('.')}`;
}

/** OSRM км для списка заказов — общий хук для курьера и админки */
export function useOrderRoadKm<T extends RoadKmOrder | Order>(
  orders: T[],
  enabled = true
) {
  const locations = usePickupLocations();
  const locKey = JSON.stringify(locations);
  const normalized = useMemo(() => orders.map(normalizeRoadKmOrder), [orders]);
  const ordersKey = useMemo(() => normalized.map(roadKmInputKey).join('|'), [normalized]);
  const [roadKm, setRoadKm] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !normalized.length) return;
    let cancelled = false;
    setLoading(true);
    fetchOrdersRoadKm(normalized, locations).then(map => {
      if (!cancelled) {
        setRoadKm(prev => ({ ...prev, ...map }));
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [enabled, ordersKey, locKey, normalized, locations]);

  return { roadKm, loading };
}
