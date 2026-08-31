"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AttributionControl,
  Map as MapGl,
  Marker,
  NavigationControl,
  type MapRef,
} from "@vis.gl/react-maplibre";

import { MapPinMarker } from "@/components/ui/map-pin-marker";
import { DEFAULT_MAP_CENTER, getOpenFreeMapStyleUrl } from "@/lib/maplibre/map-config";

interface DeliveryTestMapProps {
  storeLatitude: number | null;
  storeLongitude: number | null;
  testLatitude: number | null;
  testLongitude: number | null;
}

export const DeliveryTestMap = ({
  storeLatitude,
  storeLongitude,
  testLatitude,
  testLongitude,
}: DeliveryTestMapProps) => {
  const mapRef = useRef<MapRef>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const hasStoreCoordinates = storeLatitude !== null && storeLongitude !== null;
  const hasTestCoordinates = testLatitude !== null && testLongitude !== null;

  const frameMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !hasTestCoordinates) {
      return;
    }

    if (hasStoreCoordinates) {
      map.fitBounds(
        [
          [storeLongitude, storeLatitude],
          [testLongitude, testLatitude],
        ],
        { padding: 40, maxZoom: 14, duration: 500 },
      );
      return;
    }

    map.flyTo({
      center: [testLongitude, testLatitude],
      zoom: 14,
      duration: 500,
    });
  }, [
    hasStoreCoordinates,
    hasTestCoordinates,
    storeLatitude,
    storeLongitude,
    testLatitude,
    testLongitude,
  ]);

  useEffect(() => {
    if (isLoaded) {
      frameMarkers();
    }
  }, [frameMarkers, isLoaded]);

  return (
    <div className="bg-muted h-[200px] overflow-hidden rounded-lg border [&_.maplibregl-ctrl-attrib]:text-[10px] [&_.maplibregl-ctrl-attrib_a]:text-muted-foreground">
      <MapGl
        ref={mapRef}
        initialViewState={{
          longitude: storeLongitude ?? DEFAULT_MAP_CENTER.longitude,
          latitude: storeLatitude ?? DEFAULT_MAP_CENTER.latitude,
          zoom: 12,
        }}
        mapStyle={getOpenFreeMapStyleUrl(false)}
        maxZoom={20}
        scrollZoom={false}
        dragRotate={false}
        pitchWithRotate={false}
        attributionControl={false}
        onLoad={() => {
          setIsLoaded(true);
        }}
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl showCompass={false} />
        <AttributionControl position="bottom-left" compact={false} />

        {hasStoreCoordinates ? (
          <Marker longitude={storeLongitude} latitude={storeLatitude} anchor="bottom">
            <MapPinMarker color="#16a34a" size="small" />
          </Marker>
        ) : null}

        {hasTestCoordinates ? (
          <Marker longitude={testLongitude} latitude={testLatitude} anchor="bottom">
            <MapPinMarker color="#2563eb" size="small" />
          </Marker>
        ) : null}
      </MapGl>
    </div>
  );
};
