const OPEN_FREE_MAP_STYLE_BASE_URL = "https://tiles.openfreemap.org/styles" as const;

export const DEFAULT_MAP_CENTER = {
  latitude: 48.8566,
  longitude: 2.3522,
} as const;

export const getOpenFreeMapStyleUrl = (isDark: boolean) =>
  `${OPEN_FREE_MAP_STYLE_BASE_URL}/${isDark ? "dark" : "positron"}`;
