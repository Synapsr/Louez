'use client'

import { useState } from 'react'
import { ImageIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@louez/utils'
import { Button } from '@louez/ui'

interface ProductGalleryProps {
  images: string[]
  productName: string
}

export function ProductGallery({ images, productName }: ProductGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  if (images.length === 0) {
    return (
      <div className="aspect-[4/3] rounded-lg bg-muted flex items-center justify-center">
        <ImageIcon className="h-24 w-24 text-muted-foreground/30" />
      </div>
    )
  }

  const goToPrevious = () => {
    setSelectedIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1))
  }

  const goToNext = () => {
    setSelectedIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1))
  }

  return (
    <div className="space-y-4">
      {/* Main Image */}
      <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-muted">
        <img
          src={images[selectedIndex]}
          alt={`${productName} - Image ${selectedIndex + 1}`}
          className="w-full h-full object-cover"
        />

        {images.length > 1 && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background"
              onClick={goToPrevious}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background"
              onClick={goToNext}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </>
        )}
      </div>

      {/* Thumbnails */}
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {images.map((image, index) => (
            <button
              key={index}
              onClick={() => setSelectedIndex(index)}
              className={cn(
                'relative shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 transition-colors',
                selectedIndex === index
                  ? 'border-primary'
                  : 'border-transparent hover:border-muted-foreground/50'
              )}
            >
              <img
                src={image}
                alt={`${productName} - Thumbnail ${index + 1}`}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
