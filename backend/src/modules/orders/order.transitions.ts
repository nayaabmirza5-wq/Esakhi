export type FulfilmentStatus =
  | 'placed'
  | 'accepted'
  | 'preparing'
  | 'ready_for_pickup'
  | 'out_for_delivery'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'delivery_failed';

export type FulfilmentMethod = 'delivery' | 'pickup';

export function nextFulfilmentStatus(
  current: FulfilmentStatus,
  method: FulfilmentMethod,
): FulfilmentStatus | null {
  const transitions: Partial<Record<FulfilmentStatus, FulfilmentStatus>> = {
    placed: 'accepted',
    accepted: 'preparing',
    preparing: method === 'pickup' ? 'ready_for_pickup' : 'out_for_delivery',
    ready_for_pickup: 'completed',
    out_for_delivery: 'delivered',
    delivery_failed: 'delivered',
  };
  return transitions[current] ?? null;
}
