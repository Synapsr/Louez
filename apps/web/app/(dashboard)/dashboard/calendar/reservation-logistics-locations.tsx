'use client';

import { ExternalLink, MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { Reservation } from './types';
import {
  createReservationMapsUrls,
  getReservationLogisticsLocations,
} from './util.reservation-logistics';

interface ReservationLogisticsLocationsProps {
  reservation: Reservation;
}

export const ReservationLogisticsLocations = ({
  reservation,
}: ReservationLogisticsLocationsProps) => {
  const t = useTranslations('dashboard.calendar');
  const locations = getReservationLogisticsLocations(reservation);

  if (locations.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 border-t pt-2">
      {locations.map((location) => {
        const mapsUrls = createReservationMapsUrls(location.address);

        return (
          <div key={location.kind} className="flex items-start gap-2">
            <MapPin
              className="text-warning mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                {t(`logistics.${location.kind}Location`)}
              </div>

              <a
                href={mapsUrls.google}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:text-primary flex items-start gap-1 text-xs font-medium underline-offset-2 hover:underline pointer-coarse:hidden"
                title={t('maps.openAddress')}
              >
                <span>{location.address}</span>
                <ExternalLink
                  className="mt-0.5 h-3 w-3 shrink-0"
                  aria-hidden="true"
                />
              </a>

              <div className="hidden space-y-1.5 pointer-coarse:block">
                <div className="text-foreground text-xs font-medium">
                  {location.address}
                </div>
                <div className="text-muted-foreground text-[10px]">
                  {t('maps.openWith')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <a
                    href={mapsUrls.apple}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="border-border bg-background hover:bg-accent rounded-md border px-2 py-1 text-[11px] font-medium"
                  >
                    Apple Plans
                  </a>
                  <a
                    href={mapsUrls.google}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="border-border bg-background hover:bg-accent rounded-md border px-2 py-1 text-[11px] font-medium"
                  >
                    Google Maps
                  </a>
                  <a
                    href={mapsUrls.waze}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="border-border bg-background hover:bg-accent rounded-md border px-2 py-1 text-[11px] font-medium"
                  >
                    Waze
                  </a>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
