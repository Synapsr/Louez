"use client";

import { useEffect, useRef } from "react";

import {
  AttributionControl,
  Map as MapGl,
  Marker,
  NavigationControl,
  type MapRef,
} from "@vis.gl/react-maplibre";

import { MapPinMarker } from "@/components/ui/map-pin-marker";
import { DEFAULT_MAP_CENTER, getOpenFreeMapStyleUrl } from "@/lib/maplibre/map-config";

interface AddressPickerMapProps {
  latitude: number | null;
  longitude: number | null;
  onCoordinatesChange: (latitude: number, longitude: number) => void;
}

export const AddressPickerMap = ({
  latitude,
  longitude,
  onCoordinatesChange,
}: AddressPickerMapProps) => {
  const mapRef = useRef<MapRef>(null);
  const hasCoordinates = latitude !== null && longitude !== null;

  useEffect(() => {
    if (!hasCoordinates) {
      return;
    }

    mapRef.current?.flyTo({
      center: [longitude, latitude],
      zoom: 16,
      duration: 500,
    });
  }, [hasCoordinates, latitude, longitude]);

  return (
    <div className="bg-muted h-[250px] overflow-hidden rounded-lg border [&_.maplibregl-ctrl-attrib]:text-[10px] [&_.maplibregl-ctrl-attrib_a]:text-muted-foreground">
      <MapGl
        ref={mapRef}
        initialViewState={{
          longitude: longitude ?? DEFAULT_MAP_CENTER.longitude,
          latitude: latitude ?? DEFAULT_MAP_CENTER.latitude,
          zoom: hasCoordinates ? 16 : 5,
        }}
        mapStyle={getOpenFreeMapStyleUrl(false)}
        maxZoom={20}
        dragRotate={false}
        pitchWithRotate={false}
        attributionControl={false}
        onClick={(event) => {
          onCoordinatesChange(event.lngLat.lat, event.lngLat.lng);
        }}
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl showCompass={false} />
        <AttributionControl position="bottom-left" compact={false} />

        {hasCoordinates ? (
          <Marker
            longitude={longitude}
            latitude={latitude}
            anchor="bottom"
            draggable
            onDragEnd={(event) => {
              onCoordinatesChange(event.lngLat.lat, event.lngLat.lng);
            }}
          >
            <MapPinMarker color="#2563eb" draggable />
          </Marker>
        ) : null}
      </MapGl>
    </div>
  );
};
