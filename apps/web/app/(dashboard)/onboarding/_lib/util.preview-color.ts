function parseHexColor(hex: string): [number, number, number] | null {
  const value = hex.replace("#", "");
  const expanded =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
  return [
    parseInt(expanded.slice(0, 2), 16),
    parseInt(expanded.slice(2, 4), 16),
    parseInt(expanded.slice(4, 6), 16),
  ];
}

/** The store colour at a given opacity; falls back to the default blue on a bad value. */
export function rgba(hex: string, alpha: number): string {
  const rgb = parseHexColor(hex) ?? [0, 102, 255];
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/** Black or white, whichever reads on the store colour. */
export function readableTextColor(hex: string): string {
  const rgb = parseHexColor(hex) ?? [0, 102, 255];
  const luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return luminance > 170 ? "#09090b" : "#ffffff";
}
