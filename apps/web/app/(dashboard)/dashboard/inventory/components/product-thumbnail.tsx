import { ImageIcon } from 'lucide-react';

interface ProductThumbnailProps {
  src: string | null;
  alt: string;
}

export const ProductThumbnail = ({ src, alt }: ProductThumbnailProps) => (
  <div className="bg-muted relative h-9 w-9 shrink-0 overflow-hidden rounded-md">
    {src ? (
      // Product thumbnails use direct URLs, like the reservation product picker.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt} className="h-full w-full object-cover" />
    ) : (
      <div className="flex h-full w-full items-center justify-center">
        <ImageIcon className="text-muted-foreground h-4 w-4" />
      </div>
    )}
  </div>
);
