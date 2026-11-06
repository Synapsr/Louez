"use client";

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { authClient } from "@louez/auth/client";

import {
  createAuthMutationError,
  getMutationAuthCode,
  resolveAuthErrorMessage,
} from "@/lib/utils/util.auth-error";

import { revokePasswordAccessAction } from "./actions";

export const useRevokePasswordAccess = () => {
  const t = useTranslations("auth");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await revokePasswordAccessAction();
      if (!result.success) {
        throw createAuthMutationError(result.code);
      }

      // The sessions are gone from the database; this clears the cookies of
      // this browser, which would otherwise keep a cached session for minutes.
      await authClient.signOut();
    },
    onMutate: () => setError(null),
    onError: (mutationError) => {
      setError(resolveAuthErrorMessage(t, getMutationAuthCode(mutationError)));
    },
  });

  return {
    revoke: () => mutation.mutate(),
    isPending: mutation.isPending,
    isDone: mutation.isSuccess,
    error,
  };
};
