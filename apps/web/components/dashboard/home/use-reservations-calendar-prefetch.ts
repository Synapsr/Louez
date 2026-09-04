"use client";

import { useCallback } from "react";

import { useRouter } from "next/navigation";

import { useQueryClient } from "@tanstack/react-query";

import { useStore } from "@/contexts/store-context";
import { reservationCalendarQueries } from "@/lib/queries/reservation-calendar.queries";

export const useReservationsCalendarPrefetch = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { storeId } = useStore();

  return useCallback(
    (href: string) => {
      router.prefetch(href);

      for (const query of reservationCalendarQueries.initial(storeId)) {
        void queryClient.prefetchQuery(query);
      }
    },
    [queryClient, router, storeId],
  );
};
