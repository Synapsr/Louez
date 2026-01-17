'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Star, ChevronLeft, ChevronRight, Quote, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn, formatRelativeTime } from '@/lib/utils'
import type { GoogleReview } from '@/types'

// Inline Google "G" logo SVG to avoid external requests
const GoogleLogo = ({ size = 14, className }: { size?: number; className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 48 48"
    width={size}
    height={size}
    className={className}
  >
    <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/>
    <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/>
    <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/>
    <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/>
  </svg>
)

interface GoogleReviewsWidgetProps {
  placeName: string
  rating: number
  reviewCount: number
  reviews: GoogleReview[]
  mapsUrl: string
  primaryColor?: string
}

export function GoogleReviewsWidget({
  placeName,
  rating,
  reviewCount,
  reviews,
  mapsUrl,
  primaryColor = '#0066FF',
}: GoogleReviewsWidgetProps) {
  const t = useTranslations('storefront.reviews')
  const locale = useLocale()
  const [currentIndex, setCurrentIndex] = useState(0)

  const visibleReviews = reviews.slice(0, 5)
  // Add 1 for the "See all" card
  const totalCards = visibleReviews.length + 1
  const reviewsPerPage = typeof window !== 'undefined' && window.innerWidth < 768 ? 1 : 3
  const maxIndex = Math.max(0, totalCards - reviewsPerPage)

  const nextReview = () => {
    setCurrentIndex((prev) => Math.min(prev + 1, maxIndex))
  }

  const prevReview = () => {
    setCurrentIndex((prev) => Math.max(prev - 1, 0))
  }

  if (visibleReviews.length === 0) {
    return null
  }

  return (
    <div className="space-y-6">
      {/* Rating summary with Google verification badge */}
      <div className="flex flex-col items-center gap-4">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={cn(
                    'h-6 w-6',
                    star <= Math.round(rating)
                      ? 'fill-amber-400 text-amber-400'
                      : 'fill-muted text-muted'
                  )}
                />
              ))}
            </div>
            <span className="text-2xl font-bold">{rating.toFixed(1)}</span>
          </div>
          <span className="text-muted-foreground">
            {t('basedOn', { count: reviewCount })}
          </span>
        </div>
        {/* Google verification badge */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <GoogleLogo size={14} className="opacity-70" />
          <span>{t('verifiedByGoogle')}</span>
        </div>
      </div>

      {/* Reviews carousel */}
      <div className="relative">
        {/* Navigation buttons */}
        {visibleReviews.length > reviewsPerPage && (
          <>
            <Button
              variant="outline"
              size="icon"
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-10 hidden md:flex"
              onClick={prevReview}
              disabled={currentIndex === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10 hidden md:flex"
              onClick={nextReview}
              disabled={currentIndex >= maxIndex}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </>
        )}

        {/* Reviews grid */}
        <div className="overflow-hidden">
          <div
            className="flex transition-transform duration-300 ease-in-out gap-4 md:gap-6"
            style={{
              transform: `translateX(-${currentIndex * (100 / reviewsPerPage + 1.5)}%)`,
            }}
          >
            {visibleReviews.map((review, index) => (
              <Card
                key={index}
                className="flex-shrink-0 w-full md:w-[calc(33.333%-1rem)] transition-all duration-200 hover:shadow-md"
                style={{
                  borderColor: 'transparent',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = primaryColor
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'transparent'
                }}
              >
                <CardContent className="p-6">
                  {/* Quote icon */}
                  <Quote
                    className="h-8 w-8 mb-4"
                    style={{ color: primaryColor }}
                  />

                  {/* Rating */}
                  <div className="flex items-center gap-1 mb-3">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={cn(
                          'h-4 w-4',
                          star <= review.rating
                            ? 'fill-amber-400 text-amber-400'
                            : 'fill-muted text-muted'
                        )}
                      />
                    ))}
                  </div>

                  {/* Review text */}
                  <p className="text-sm text-muted-foreground line-clamp-4 mb-4">
                    {review.text || t('noReviewText')}
                  </p>

                  {/* Author */}
                  <div className="flex items-center gap-3">
                    {review.authorPhotoBase64 || review.authorPhotoUrl ? (
                      <img
                        src={review.authorPhotoBase64 || review.authorPhotoUrl}
                        alt={review.authorName}
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <div
                        className="h-10 w-10 rounded-full flex items-center justify-center text-white font-medium"
                        style={{ backgroundColor: primaryColor }}
                      >
                        {review.authorName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="font-medium text-sm">{review.authorName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatRelativeTime(new Date(review.time * 1000), locale)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* See all reviews card */}
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 w-full md:w-[calc(33.333%-1rem)] group"
            >
              <Card
                className="h-full transition-all duration-200 cursor-pointer border-dashed hover:shadow-md"
                style={{ borderColor: primaryColor }}
              >
                <CardContent className="p-6 h-full flex flex-col items-center justify-center text-center gap-4">
                  <div
                    className="h-16 w-16 rounded-full flex items-center justify-center transition-colors"
                    style={{ backgroundColor: `${primaryColor}25` }}
                  >
                    <GoogleLogo size={32} />
                  </div>
                  <div>
                    <p className="font-medium mb-1">{t('seeAllOnGoogle')}</p>
                    <p className="text-sm text-muted-foreground">
                      {reviewCount} {t('basedOn', { count: reviewCount }).split(' ').slice(-1)[0]}
                    </p>
                  </div>
                  <div
                    className="flex items-center gap-1 text-sm font-medium transition-transform group-hover:translate-x-1"
                    style={{ color: primaryColor }}
                  >
                    {t('viewOnGoogle')}
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </CardContent>
              </Card>
            </a>
          </div>
        </div>

        {/* Mobile navigation dots */}
        {visibleReviews.length > 1 && (
          <div className="flex justify-center gap-2 mt-4 md:hidden">
            {Array.from({ length: totalCards }).map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentIndex(index)}
                className="h-2 w-2 rounded-full transition-colors"
                style={{
                  backgroundColor:
                    index === currentIndex ? primaryColor : `${primaryColor}50`,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
