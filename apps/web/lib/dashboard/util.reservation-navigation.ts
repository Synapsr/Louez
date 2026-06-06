const DASHBOARD_ROOT_PATH = '/dashboard';
const RESERVATIONS_LIST_PATH = '/dashboard/reservations';
const LOCAL_ORIGIN = 'https://louez.local';

export function createDashboardReturnTo(
  pathname: string,
  searchParams?: string | { toString: () => string } | null,
): string {
  const queryString =
    typeof searchParams === 'string'
      ? searchParams
      : (searchParams?.toString() ?? '');

  return queryString ? `${pathname}?${queryString}` : pathname;
}

export function createDashboardReservationHref({
  reservationId,
  returnTo,
}: {
  reservationId: string;
  returnTo?: string | null;
}): string {
  const reservationHref = `${RESERVATIONS_LIST_PATH}/${encodeURIComponent(reservationId)}`;

  if (!returnTo) {
    return reservationHref;
  }

  const params = new URLSearchParams({ returnTo });
  return `${reservationHref}?${params.toString()}`;
}

export function getDashboardReservationBackHref(
  returnTo?: string | null,
): string {
  if (!returnTo || !returnTo.startsWith('/') || returnTo.startsWith('//')) {
    return RESERVATIONS_LIST_PATH;
  }

  try {
    const url = new URL(returnTo, LOCAL_ORIGIN);

    if (url.origin !== LOCAL_ORIGIN) {
      return RESERVATIONS_LIST_PATH;
    }

    const isDashboardPath =
      url.pathname === DASHBOARD_ROOT_PATH ||
      url.pathname.startsWith(`${DASHBOARD_ROOT_PATH}/`);

    if (!isDashboardPath) {
      return RESERVATIONS_LIST_PATH;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return RESERVATIONS_LIST_PATH;
  }
}
