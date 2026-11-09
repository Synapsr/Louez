export type ProductPlaceholderShape = "circle-triangle" | "triangle-circle" | "square-circle";

interface ProductPlaceholderArtProps {
  shape: ProductPlaceholderShape;
  /** The store colour; the two shapes use it at two strengths. */
  color: string;
}

/**
 * Stands in for a product photo in the storefront preview: two flat shapes
 * that suggest an object, in the store's own colour. Deliberately plain, since
 * it represents the merchant's storefront and not the Louez back office.
 */
export const ProductPlaceholderArt = ({ shape, color }: ProductPlaceholderArtProps) => (
  <svg aria-hidden viewBox="0 0 120 90" className="size-full">
    {shape === "circle-triangle" && (
      <>
        <circle cx="52" cy="50" r="15" fill={color} fillOpacity={0.55} />
        <path d="M64 60l12-22 12 22z" fill={color} fillOpacity={0.85} />
      </>
    )}
    {shape === "triangle-circle" && (
      <>
        <path d="M40 60l14-25 14 25z" fill={color} fillOpacity={0.85} />
        <circle cx="72" cy="48" r="13" fill={color} fillOpacity={0.55} />
      </>
    )}
    {shape === "square-circle" && (
      <>
        <rect x="40" y="36" width="22" height="22" rx="6" fill={color} fillOpacity={0.55} />
        <circle cx="72" cy="50" r="12" fill={color} fillOpacity={0.85} />
      </>
    )}
  </svg>
);
