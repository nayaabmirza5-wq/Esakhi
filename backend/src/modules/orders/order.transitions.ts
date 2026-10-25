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

export function canAssignDeliveryPartner(status: FulfilmentStatus, hasAssignment: boolean): boolean {
  const assignableStatus = status === 'preparing' || status === 'out_for_delivery' || status === 'delivery_failed';
  return assignableStatus && (!hasAssignment || status === 'delivery_failed');
}

export function statusAfterDeliveryPartnerAssignment(status: FulfilmentStatus): FulfilmentStatus {
  return status === 'delivery_failed' ? 'preparing' : status;
}

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
