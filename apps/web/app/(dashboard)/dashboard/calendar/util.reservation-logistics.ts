import type { Reservation } from './types';

export type ReservationLogisticsKind =
  | 'delivery'
  | 'return'
  | 'deliveryAndReturn';

export type ReservationLogisticsLocation = {
  kind: 'delivery' | 'return';
  address: string;
};

export type ReservationMapsUrls = {
  apple: string;
  google: string;
  waze: string;
};

type ReservationLogisticsData = Pick<
  Reservation,
  | 'outboundMethod'
  | 'returnMethod'
  | 'deliveryOption'
  | 'deliveryAddress'
  | 'deliveryCity'
  | 'deliveryPostalCode'
  | 'deliveryCountry'
  | 'returnAddress'
  | 'returnCity'
  | 'returnPostalCode'
  | 'returnCountry'
>;

const formatAddress = (
  address: string | null,
  postalCode: string | null,
  city: string | null,
  country: string | null,
): string | null => {
  const cityLine = [postalCode, city].filter(Boolean).join(' ');
  const formattedAddress = [address, cityLine, country]
    .filter(Boolean)
    .join(', ');

  return formattedAddress || null;
};

export const getReservationLogisticsKind = (
  reservation: ReservationLogisticsData,
): ReservationLogisticsKind | null => {
  const hasOutboundDelivery =
    reservation.outboundMethod === 'address' ||
    (reservation.deliveryOption === 'delivery' &&
      Boolean(reservation.deliveryAddress));
  const hasReturnCollection = reservation.returnMethod === 'address';

  if (hasOutboundDelivery && hasReturnCollection) {
    return 'deliveryAndReturn';
  }

  if (hasOutboundDelivery) {
    return 'delivery';
  }

  if (hasReturnCollection) {
    return 'return';
  }

  return null;
};

export const getReservationLogisticsLocations = (
  reservation: ReservationLogisticsData,
): ReservationLogisticsLocation[] => {
  const locations: ReservationLogisticsLocation[] = [];
  const hasOutboundDelivery =
    reservation.outboundMethod === 'address' ||
    (reservation.deliveryOption === 'delivery' &&
      Boolean(reservation.deliveryAddress));

  if (hasOutboundDelivery) {
    const address = formatAddress(
      reservation.deliveryAddress,
      reservation.deliveryPostalCode,
      reservation.deliveryCity,
      reservation.deliveryCountry,
    );

    if (address) {
      locations.push({ kind: 'delivery', address });
    }
  }

  if (reservation.returnMethod === 'address') {
    const address = formatAddress(
      reservation.returnAddress,
      reservation.returnPostalCode,
      reservation.returnCity,
      reservation.returnCountry,
    );

    if (address) {
      locations.push({ kind: 'return', address });
    }
  }

  return locations;
};

export const createReservationMapsUrls = (
  address: string,
): ReservationMapsUrls => {
  const encodedAddress = encodeURIComponent(address);

  return {
    apple: `https://maps.apple.com/?daddr=${encodedAddress}&dirflg=d`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}`,
    waze: `https://www.waze.com/ul?q=${encodedAddress}&navigate=yes`,
  };
};
