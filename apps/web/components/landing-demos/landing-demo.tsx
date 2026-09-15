"use client";
import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Button, TooltipProvider } from "@louez/ui";
import { cn } from "@louez/utils";
import { StoreProvider } from "@/contexts/store-context";
import { usePublicEnv } from "@/components/shared/public-env-provider";
import { DEMO_RULES, type DemoBooking } from "@/lib/landing-demos/fixtures";
import { getDemoParentOrigins, type DemoScene } from "@/lib/landing-demos/policy";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReservationStatus } from "@/app/(dashboard)/dashboard/reservations/reservations-types";
import { AdvisorScene } from "./advisor-scene";
import { PlanningScene } from "./planning-scene";
import { ReservationScene } from "./reservation-scene";
import { StorefrontScene } from "./storefront-scene";
import { useDemoPlayback, type AnimatedScene } from "./use-demo-playback";
import "./landing-demo.css";

const steps = ["Le client réserve", "Vous préparez", "Tout est suivi"];
const scenes: AnimatedScene[] = ["storefront", "planning", "reservation"];
const subscribeMotion = (notify: () => void) => {
  const query = matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const reducedMotionSnapshot = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export const LandingDemo = ({
  scene,
  compact,
  initialPeriod,
}: {
  scene: DemoScene;
  compact: boolean;
  initialPeriod: RentalPeriodValue;
}) => {
  const publicEnv = usePublicEnv();
  const [period, setPeriod] = useState(initialPeriod);
  const [booking, setBooking] = useState<DemoBooking>(() => ({
    productIndex: 0,
    quantity: 2,
    selected: {},
    period,
    unitPrice: 20,
  }));
  const [reservationIndex, setReservationIndex] = useState(0);
  const [detail, setDetail] = useState<{
    booking: DemoBooking;
    period: RentalPeriodValue;
    status: ReservationStatus;
  } | null>(null);
  const [planningView, setPlanningView] = useState<"dashboard" | "list">("dashboard");
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  );
  const [step, setStep] = useState(scene === "planning" ? 1 : scene === "reservation" ? 2 : 0);
  const [cycle, setCycle] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [parentVisible, setParentVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [embedded, setEmbedded] = useState(true);
  const [parentOrigin, setParentOrigin] = useState<string | null>(null);
  const reduced = useSyncExternalStore(subscribeMotion, reducedMotionSnapshot, () => true);
  const currentScene: AnimatedScene =
    scene === "advisor" ? "advisor" : (scenes[step] ?? "storefront");
  const running = parentVisible && pageVisible && !hovered && !keyboard && !paused && !reduced;
  const reset = useCallback(() => {
    setCycle((value) => value + 1);
    setStep(scene === "planning" ? 1 : scene === "reservation" ? 2 : 0);
  }, [scene]);
  const finish = () => {
    setPlanningView("dashboard");
    if (scene === "rental") setStep((value) => (value + 1) % 3);
    else setStep(scene === "planning" ? 1 : scene === "reservation" ? 2 : 0);
    setCycle((value) => value + 1);
  };
  const { cursorRef, phase } = useDemoPlayback({
    scene: currentScene,
    cycle,
    running,
    onFinish: finish,
  });

  useEffect(() => {
    const standalone = window.parent === window;
    setEmbedded(!standalone);
    setParentVisible(standalone);
    const allowed = getDemoParentOrigins(
      publicEnv.NEXT_PUBLIC_APP_DOMAIN,
      process.env.NODE_ENV === "development",
    );
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== window.parent || !allowed.includes(event.origin)) return;
      const data = event.data;
      if (
        !data ||
        typeof data !== "object" ||
        !("type" in data) ||
        data.type !== "louez:demo:control"
      )
        return;
      setParentOrigin(event.origin);
      window.parent.postMessage({ type: "louez:demo:ack" }, event.origin);
      if ("visible" in data && typeof data.visible === "boolean") setParentVisible(data.visible);
      if ("hovered" in data && typeof data.hovered === "boolean") {
        setHovered(data.hovered);
        if (!data.hovered) setKeyboard(false);
      }
      if ("paused" in data && typeof data.paused === "boolean") {
        setPaused(data.paused);
        setKeyboard(false);
      }
      if (
        "step" in data &&
        typeof data.step === "number" &&
        Number.isInteger(data.step) &&
        data.step >= 0 &&
        data.step <= 2 &&
        scene === "rental"
      ) {
        setStep(data.step);
        setCycle((value) => value + 1);
      }
      if ("reset" in data && data.reset === true) reset();
    };
    window.addEventListener("message", receive);
    // A ready handshake also handles a frame that finished loading off screen.
    if (!standalone && document.referrer) {
      const origin = new URL(document.referrer).origin;
      if (allowed.includes(origin)) {
        setParentOrigin(origin);
        window.parent.postMessage({ type: "louez:demo:ready" }, origin);
      }
    }
    const visibility = () => setPageVisible(document.visibilityState === "visible");
    const leave = () => {
      setHovered(false);
      setKeyboard(false);
    };
    const enter = (event: PointerEvent) => {
      if (event.isTrusted && event.pointerType === "mouse") setHovered(true);
    };
    const key = (event: KeyboardEvent) => {
      if (event.isTrusted) setKeyboard(true);
    };
    const blur = () => setKeyboard(false);
    const touch = (event: PointerEvent) => {
      if (event.isTrusted && event.pointerType !== "mouse") setPaused(true);
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("pointerdown", touch, true);
    document.documentElement.addEventListener("pointerenter", enter);
    document.documentElement.addEventListener("pointerleave", leave);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("message", receive);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("pointerdown", touch, true);
      document.documentElement.removeEventListener("pointerenter", enter);
      document.documentElement.removeEventListener("pointerleave", leave);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", blur);
    };
  }, [publicEnv.NEXT_PUBLIC_APP_DOMAIN, scene, reset]);

  useEffect(() => {
    document.documentElement.dataset.demoRunning = String(running);
    if (parentOrigin)
      window.parent.postMessage(
        { type: "louez:demo:state", step, running, paused, reduced, phase },
        parentOrigin,
      );
  }, [step, running, paused, parentOrigin, reduced, phase]);

  return (
    <NuqsAdapter>
      <StoreProvider
        storeId="demo-store"
        storeSlug="demo"
        storeName="Maison du Vélo"
        currency="EUR"
        timezone="Europe/Paris"
        basePath=""
        periodRules={DEMO_RULES}
      >
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <main
              className={cn(
                "demo-canvas min-h-dvh bg-background text-foreground",
                currentScene === "advisor" ? "p-5 sm:p-8" : "p-0",
              )}
              data-demo-step={step}
              data-demo-running={running}
              data-demo-visible={parentVisible && pageVisible}
              data-demo-hovered={hovered}
              data-demo-keyboard={keyboard}
              data-demo-phase={phase}
              data-demo-compact={compact}
            >
              <div key={`${currentScene}-${cycle}`}>
                {currentScene === "storefront" && (
                  <StorefrontScene
                    compact={compact}
                    period={period}
                    onBookingChange={(nextBooking) => {
                      setBooking(nextBooking);
                      setPeriod(nextBooking.period);
                      setReservationIndex(0);
                      setDetail(null);
                    }}
                  />
                )}
                {currentScene === "planning" && (
                  <PlanningScene
                    initialView={planningView}
                    period={period}
                    booking={booking}
                    onOpenReservation={(index, selectedBooking, selectedPeriod, status) => {
                      setReservationIndex(index);
                      setDetail({ booking: selectedBooking, period: selectedPeriod, status });
                      setStep(2);
                      setCycle((value) => value + 1);
                    }}
                  />
                )}
                {currentScene === "reservation" && (
                  <ReservationScene
                    period={detail?.period ?? period}
                    reservationIndex={reservationIndex}
                    booking={detail?.booking ?? booking}
                    status={detail?.status ?? "confirmed"}
                    onNavigate={(page) => {
                      setPlanningView(page === "dashboard" ? "dashboard" : "list");
                      setStep(1);
                      setCycle((value) => value + 1);
                    }}
                  />
                )}
                {currentScene === "advisor" && <AdvisorScene visible={parentVisible} />}
              </div>
              {!embedded && (
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  {scene === "rental" &&
                    steps.map((label, index) => (
                      <Button
                        key={label}
                        size="sm"
                        variant={step === index ? "default" : "ghost"}
                        onClick={() => {
                          setStep(index);
                          setCycle((value) => value + 1);
                        }}
                      >
                        {label}
                      </Button>
                    ))}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={paused ? "Lancer la démo" : "Pause"}
                    onClick={() => {
                      setPaused((value) => !value);
                      setKeyboard(false);
                    }}
                  >
                    {paused ? <Play /> : <Pause />}
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Recommencer" onClick={reset}>
                    <RotateCcw />
                  </Button>
                </div>
              )}
            </main>
            <div
              ref={cursorRef}
              className="demo-cursor"
              aria-hidden="true"
              data-visible={running && phase > 0}
            >
              <svg width="28" height="32" viewBox="0 0 28 32" fill="none">
                <path
                  d="M3 2L24 18L14 19L10 28L3 2Z"
                  fill="#111"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              </svg>
              <span>
                {currentScene === "storefront" || currentScene === "advisor" ? "Client" : "Loueur"}
              </span>
            </div>
          </TooltipProvider>
        </QueryClientProvider>
      </StoreProvider>
    </NuqsAdapter>
  );
};
