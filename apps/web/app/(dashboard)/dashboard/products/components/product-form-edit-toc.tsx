'use client';

import { useEffect, useRef, useState } from 'react';

import { FileText, ImageIcon, Link2, Package, Receipt } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@louez/utils';

const SECTION_IDS = [
  'section-photos',
  'section-information',
  'section-pricing',
  'section-stock',
  'section-accessories',
] as const;

type SectionId = (typeof SECTION_IDS)[number];

export function ProductFormEditToc() {
  const t = useTranslations('dashboard.products.form');
  const [activeId, setActiveId] = useState<SectionId>(SECTION_IDS[0]);
  const isManualScroll = useRef(false);

  const sections: { id: SectionId; label: string; icon: React.ReactNode }[] = [
    {
      id: 'section-photos',
      label: t('photos'),
      icon: <ImageIcon className="h-3.5 w-3.5" />,
    },
    {
      id: 'section-information',
      label: t('information'),
      icon: <FileText className="h-3.5 w-3.5" />,
    },
    {
      id: 'section-pricing',
      label: t('pricing'),
      icon: <Receipt className="h-3.5 w-3.5" />,
    },
    {
      id: 'section-stock',
      label: t('stock'),
      icon: <Package className="h-3.5 w-3.5" />,
    },
    {
      id: 'section-accessories',
      label: t('accessories'),
      icon: <Link2 className="h-3.5 w-3.5" />,
    },
  ];

  useEffect(() => {
    const elements = SECTION_IDS.map((id) =>
      document.getElementById(id),
    ).filter(Boolean) as HTMLElement[];

    if (!elements.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isManualScroll.current) return;

        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          setActiveId(visible[0].target.id as SectionId);
        }
      },
      { rootMargin: '-80px 0px -50% 0px', threshold: 0 },
    );

    elements.forEach((el) => observer.observe(el));

    // Activate last section when near the bottom of the page
    const handleScroll = () => {
      if (isManualScroll.current) return;
      const scrollBottom = window.innerHeight + window.scrollY;
      const docHeight = document.documentElement.scrollHeight;
      if (docHeight - scrollBottom < 100) {
        setActiveId(SECTION_IDS[SECTION_IDS.length - 1]);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const scrollToSection = (id: SectionId) => {
    const el = document.getElementById(id);
    if (!el) return;

    isManualScroll.current = true;
    setActiveId(id);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Re-enable IO-driven tracking after scroll settles
    const timer = setTimeout(() => {
      isManualScroll.current = false;
    }, 800);

    return () => clearTimeout(timer);
  };

  return (
    <nav className="hidden w-48 shrink-0 xl:block" aria-label="Form navigation">
      <div className="sticky top-4">
        <ul className="border-border relative space-y-0.5 border-l">
          {sections.map((section) => {
            const isActive = activeId === section.id;
            return (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToSection(section.id);
                  }}
                  className={cn(
                    '-ml-px flex items-center gap-2.5 border-l-2 py-2 pr-2 pl-4 text-[13px] transition-all duration-200',
                    isActive
                      ? 'border-primary text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 border-transparent',
                  )}
                >
                  <span
                    className={cn(
                      'transition-colors duration-200',
                      isActive ? 'text-primary' : 'text-muted-foreground/70',
                    )}
                  >
                    {section.icon}
                  </span>
                  {section.label}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
