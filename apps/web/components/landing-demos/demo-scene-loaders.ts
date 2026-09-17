import { lazy } from "react";

export const loadStorefront = () =>
  import("./storefront-scene").then((module) => ({ default: module.StorefrontScene }));
export const loadPlanning = () =>
  import("./planning-scene").then((module) => ({ default: module.PlanningScene }));
export const loadReservation = () =>
  import("./reservation-scene").then((module) => ({ default: module.ReservationScene }));
const loadAdvisor = () =>
  import("./advisor-scene").then((module) => ({ default: module.AdvisorScene }));

export const StorefrontScene = lazy(loadStorefront);
export const PlanningScene = lazy(loadPlanning);
export const ReservationScene = lazy(loadReservation);
export const AdvisorScene = lazy(loadAdvisor);
