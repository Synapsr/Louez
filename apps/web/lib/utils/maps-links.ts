/** Opens turn-by-turn directions to a postal address in the visitor's map app. */
export const directionsUrl = (address: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
