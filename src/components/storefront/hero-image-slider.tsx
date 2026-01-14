'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface HeroImageSliderProps {
  images: string[]
  className?: string
  fullscreen?: boolean
}

export function HeroImageSlider({ images, className, fullscreen }: HeroImageSliderProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isHovered, setIsHovered] = useState(false)

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % images.length)
  }, [images.length])

  const goToPrev = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + images.length) % images.length)
  }, [images.length])

  // Auto-advance when not hovered
  useEffect(() => {
    if (images.length <= 1 || isHovered) return

    const interval = setInterval(goToNext, 4000)
    return () => clearInterval(interval)
  }, [images.length, isHovered, goToNext])

  if (images.length === 0) return null

  return (
    <div
      className={cn('relative group', className)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Main image container */}
      <div className={cn(
        'relative overflow-hidden',
        fullscreen ? 'h-full w-full' : 'aspect-[4/3] rounded-2xl shadow-2xl'
      )}>
        {images.map((image, index) => (
          <div
            key={index}
            className={cn(
              'absolute inset-0 transition-all duration-500',
              index === currentIndex
                ? 'opacity-100 scale-100'
                : 'opacity-0 scale-105'
            )}
          >
            <img
              src={image}
              alt={`Image ${index + 1}`}
              className="h-full w-full object-cover"
            />
          </div>
        ))}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent" />
      </div>

      {/* Navigation arrows */}
      {images.length > 1 && (
        <>
          <button
            onClick={goToPrev}
            className={cn(
              'absolute top-1/2 -translate-y-1/2 rounded-full backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity',
              fullscreen
                ? 'left-4 md:left-8 p-3 bg-black/30 hover:bg-black/50'
                : 'left-2 p-2 bg-white/80 hover:bg-white shadow-lg'
            )}
            aria-label="Image précédente"
          >
            <ChevronLeft className={cn('text-white', fullscreen ? 'h-6 w-6' : 'h-4 w-4 text-gray-800')} />
          </button>
          <button
            onClick={goToNext}
            className={cn(
              'absolute top-1/2 -translate-y-1/2 rounded-full backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity',
              fullscreen
                ? 'right-4 md:right-8 p-3 bg-black/30 hover:bg-black/50'
                : 'right-2 p-2 bg-white/80 hover:bg-white shadow-lg'
            )}
            aria-label="Image suivante"
          >
            <ChevronRight className={cn('text-white', fullscreen ? 'h-6 w-6' : 'h-4 w-4 text-gray-800')} />
          </button>
        </>
      )}

      {/* Dots indicator */}
      {images.length > 1 && (
        <div className={cn(
          'absolute flex gap-1.5',
          fullscreen
            ? 'bottom-8 right-8 md:right-12'
            : 'bottom-3 left-1/2 -translate-x-1/2'
        )}>
          {images.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentIndex(index)}
              className={cn(
                'rounded-full transition-all',
                fullscreen ? 'h-2 w-2' : 'h-1.5',
                index === currentIndex
                  ? fullscreen ? 'w-6 bg-white' : 'w-4 bg-white'
                  : fullscreen ? 'bg-white/40 hover:bg-white/70' : 'w-1.5 bg-white/50 hover:bg-white/80'
              )}
              aria-label={`Aller à l'image ${index + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
