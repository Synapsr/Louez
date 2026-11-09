/** Up to two avatar initials from a customer's full name ("Teo Lumy" → "TL"). */
export const getCustomerNameInitials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
