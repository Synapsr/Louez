'use client';

import { useCallback, useEffect, useState } from 'react';

import { ArrowUpRight, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
} from '@louez/ui/components/carousel';
import { StarSolidIcon } from '@louez/ui/icons';
import { cn } from '@louez/utils';

const reviews = [
  {
    id: 'review1',
    name: 'Timothée',
    logo: '/images/testimonials/bicy-dijon-logo.webp',
    shopUrl: 'https://bicy-dijon.louez.io',
  },
  {
    id: 'review2',
    name: 'Martin',
    logo: '/images/testimonials/bloom-store-logo.svg',
    shopUrl: 'https://bloom.louez.io',
  },
  {
    id: 'review3',
    name: 'Romain',
    logo: '/images/testimonials/les-freres-complices-logo.webp',
    shopUrl: 'https://les-freres-complices.louez.io',
  },
] as const;

const perks = ['perk1', 'perk2', 'perk3'] as const;

const ROTATION_MS = 8000;

export const LoginSocialProof = () => {
  const t = useTranslations('auth');
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const updateActiveIndex = useCallback((api: CarouselApi) => {
    if (!api) return;
    setActiveIndex(api.selectedScrollSnap());
  }, []);

  useEffect(() => {
    if (!carouselApi) return;

    updateActiveIndex(carouselApi);
    carouselApi.on('select', updateActiveIndex);
    carouselApi.on('reInit', updateActiveIndex);

    return () => {
      carouselApi.off('select', updateActiveIndex);
      carouselApi.off('reInit', updateActiveIndex);
    };
  }, [carouselApi, updateActiveIndex]);

  useEffect(() => {
    if (!carouselApi) return;
    if (isPaused) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const timer = setInterval(() => {
      carouselApi.scrollNext();
    }, ROTATION_MS);

    return () => clearInterval(timer);
  }, [carouselApi, isPaused]);

  return (
    <div className="flex max-w-md flex-col gap-10">
      <div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5" aria-hidden>
            {Array.from({ length: 5 }).map((_, i) => (
              <StarSolidIcon
                key={i}
                className="fill-louez-yellow text-louez-yellow h-4 w-4"
              />
            ))}
          </div>
          <span className="font-semibold">{t('socialProofRating')}</span>
        </div>
        <p className="text-primary-foreground/80 mt-2 text-sm">
          {t('socialProofTrusted')}
        </p>
      </div>

      <Carousel
        setApi={setCarouselApi}
        opts={{ align: 'start', loop: true }}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        className="select-none"
      >
        <CarouselContent className="-ml-0">
          {reviews.map((review, index) => (
            <CarouselItem
              key={review.id}
              className="pl-0"
              aria-hidden={index !== activeIndex}
            >
              <figure>
                <blockquote className="text-xl leading-relaxed font-medium">
                  &ldquo;{t(`${review.id}Quote`)}&rdquo;
                </blockquote>
                <figcaption className="mt-6">
                  <a
                    href={review.shopUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${t('visitShop')} — ${review.name}`}
                    className="group inline-flex items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-0.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={review.logo}
                        alt=""
                        className="h-full w-full rounded-[12px] object-cover"
                        loading="lazy"
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold">{review.name}</span>
                      <span className="text-primary-foreground/70 flex items-center gap-1 text-sm">
                        {t(`${review.id}Role`)}
                        <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
                      </span>
                    </span>
                  </a>
                </figcaption>
              </figure>
            </CarouselItem>
          ))}
        </CarouselContent>

        <div className="mt-6 flex items-center justify-center gap-1">
          {reviews.map((review, index) => (
            <button
              key={review.id}
              type="button"
              aria-label={review.name}
              aria-current={index === activeIndex}
              onClick={() => carouselApi?.scrollTo(index)}
              className={cn(
                "relative h-1.5 rounded-full transition-all duration-300 outline-none after:absolute after:top-1/2 after:left-1/2 after:size-4 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] focus-visible:ring-2 focus-visible:ring-white/80",
                index === activeIndex
                  ? 'w-6 bg-white'
                  : 'w-1.5 bg-white/30 hover:bg-white/50',
              )}
            />
          ))}
        </div>
      </Carousel>

      <div className="space-y-3 border-t border-white/15 pt-8">
        {perks.map((perk) => (
          <div key={perk} className="flex items-center gap-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15">
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
            <span className="text-primary-foreground/90 text-sm">
              {t(perk)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
