"use client";

import { useCallback, useEffect, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { orpc } from "@/lib/orpc/react";

export interface MyLocation {
  latitude: number;
  longitude: number;
  /** Reverse-geocoded street address; null when the lookup failed. */
  address: string | null;
}

/**
 * `unknown` means the Permissions API could not tell us — Safari reports it
 * only after a first attempt.
 */
export type MyLocationPermission = "unsupported" | "unknown" | "prompt" | "granted" | "denied";

/**
 * The browser's geolocation, reverse-geocoded so the result can both centre a
 * map and prefill an address field.
 *
 * A prompt the customer *dismissed* leaves the permission at `prompt`, so
 * asking again re-opens it. One they *blocked* is remembered by the browser and
 * no API call can re-open it — callers read `permission` to tell the two apart
 * and stop offering a button that would do nothing.
 */
export const useMyLocation = () => {
  const queryClient = useQueryClient();
  const [position, setPosition] = useState<MyLocation | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [permission, setPermission] = useState<MyLocationPermission>("unknown");

  // Watching the permission means a change made in browser settings unblocks
  // the UI without a reload.
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setPermission("unsupported");
      return;
    }
    if (!navigator.permissions?.query) return;

    let status: PermissionStatus | null = null;
    const sync = () => setPermission((status?.state as MyLocationPermission) ?? "unknown");

    void navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((result) => {
        status = result;
        sync();
        result.addEventListener("change", sync);
      })
      .catch(() => undefined);

    return () => status?.removeEventListener("change", sync);
  }, []);

  const locate = useCallback(
    (onResolved?: (found: MyLocation) => void) => {
      if (!("geolocation" in navigator)) {
        setPermission("unsupported");
        return;
      }

      setIsLocating(true);

      navigator.geolocation.getCurrentPosition(
        (result) => {
          const { latitude, longitude } = result.coords;
          setPermission("granted");

          void (async () => {
            let address: string | null = null;
            try {
              const data = await queryClient.fetchQuery(
                orpc.public.address.reverseGeocode.queryOptions({
                  input: { latitude, longitude },
                }),
              );
              address = data.details?.formattedAddress ?? null;
            } catch {
              address = null;
            }

            const found = { latitude, longitude, address };
            setPosition(found);
            setIsLocating(false);
            onResolved?.(found);
          })();
        },
        (error) => {
          setIsLocating(false);
          // PERMISSION_DENIED covers both "blocked" and "dismissed"; the
          // Permissions API watcher above tells them apart where supported.
          setPermission((current) =>
            error.code === error.PERMISSION_DENIED && current !== "prompt" ? "denied" : current,
          );
        },
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
      );
    },
    [queryClient],
  );

  return { position, isLocating, permission, locate };
};
