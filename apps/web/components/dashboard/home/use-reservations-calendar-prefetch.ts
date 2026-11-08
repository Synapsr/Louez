"use client";

import { useCallback } from "react";

import { useRouter } from "next/navigation";

import { useQueryClient } from "@tanstack/react-query";

import { reservationCalendarQueries } from "@/lib/queries/reservation-calendar.queries";

export const useReservationsCalendarPrefetch = () => {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useCallback(
    (href: string) => {
      router.prefetch(href);

      for (const query of reservationCalendarQueries.initial()) {
        void queryClient.prefetchQuery(query);
      }
    },
    [queryClient, router],
  );
};
