"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { cn } from "@louez/utils";

import { usePublicEnv } from "@/components/shared/public-env-provider";

import type {
  OnlineStoreDevice,
  OnlineStoreSection,
  OnlineStoreSketchPage,
} from "../online-store.constants";
import { useElementSize } from "../use-element-size";
import type { OnlineStoreEditorStore, OnlineStoreFormValues } from "../util.online-store-form";
import { SketchAnnouncementBar } from "./sketch-announcement-bar";
import { SketchBrowserFrame } from "./sketch-browser-frame";
import { SketchContactPage } from "./sketch-contact-page";
import { SketchFooter } from "./sketch-footer";
import { SketchHeader } from "./sketch-header";
import { SketchHomePage } from "./sketch-home-page";
import { SketchLegalPage } from "./sketch-legal-page";
import { SKETCH_PALETTE, SKETCH_TRANSITION } from "./sketch-palette";
import { SketchPhoneFrame } from "./sketch-phone-frame";
import { SketchSeoPage } from "./sketch-seo-page";
import { getSketchFit } from "./util.sketch-fit";

interface StorefrontSketchProps {
  page: OnlineStoreSketchPage;
  section: OnlineStoreSection;
  device: OnlineStoreDevice;
  values: OnlineStoreFormValues;
  store: OnlineStoreEditorStore;
  className?: string;
}

/**
 * The storefront as a sketch, redrawn from the editor values as they are
 * typed. It is laid out at the site's own sizes on a reference viewport
 * (a laptop-wide page or a phone), then zoomed down to the space the
 * canvas offers, so what the store owner sees is a miniature of the real
 * page rather than a diagram of it. A bare desktop window or an iPhone
 * frames it; the page scrolls inside the frame. Pages crossfade; colours transition; the rest is
 * instant.
 */
export const StorefrontSketch = ({
  page,
  section,
  device,
  values,
  store,
  className,
}: StorefrontSketchProps) => {
  const { NEXT_PUBLIC_APP_DOMAIN: appDomain } = usePublicEnv();
  const reduceMotion = useReducedMotion() ?? false;
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const { identity, home, contact, legal } = values;
  const p = SKETCH_PALETTE[identity.themeMode];
  const name = identity.name.trim() || store.name;
  const host = `${store.slug}.${appDomain}`;
  const logoUrl =
    identity.themeMode === "dark" && identity.darkLogoUrl ? identity.darkLogoUrl : identity.logoUrl;
  const transition = reduceMotion ? { duration: 0 } : SKETCH_TRANSITION;
  const fit = getSketchFit({ device, width, height });

  const content =
    page === "seo" ? (
      <SketchSeoPage palette={p} device={device} values={values} name={name} host={host} />
    ) : (
      <>
        <SketchAnnouncementBar
          enabled={home.announcementEnabled}
          text={home.announcementText}
          primaryColor={identity.primaryColor}
          reduceMotion={reduceMotion}
        />
        <SketchHeader
          palette={p}
          device={device}
          name={name}
          logoUrl={logoUrl}
          primaryColor={identity.primaryColor}
          showPhone={contact.headerPhone && contact.phone.trim() !== ""}
          websiteUrl={contact.social.website.trim() || null}
        />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={page}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={transition}
          >
            {page === "home" ? (
              <SketchHomePage
                palette={p}
                device={device}
                values={values}
                name={name}
                reduceMotion={reduceMotion}
              />
            ) : page === "contact" ? (
              <SketchContactPage
                palette={p}
                device={device}
                name={name}
                contact={contact}
                primaryColor={identity.primaryColor}
              />
            ) : (
              <SketchLegalPage palette={p} device={device} legal={legal} />
            )}
          </motion.div>
        </AnimatePresence>
        <SketchFooter
          palette={p}
          device={device}
          name={name}
          contact={contact}
          social={contact.social}
          footerNote={legal.footerNote}
        />
      </>
    );

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn("flex h-full w-full items-center justify-center", className)}
      data-slot="storefront-sketch"
      data-section={section}
    >
      {fit === null ? null : fit.device === "phone" ? (
        <SketchPhoneFrame palette={p} zoom={fit.zoom}>
          {content}
        </SketchPhoneFrame>
      ) : (
        <SketchBrowserFrame palette={p} zoom={fit.zoom} height={fit.windowHeight}>
          {content}
        </SketchBrowserFrame>
      )}
    </div>
  );
};
