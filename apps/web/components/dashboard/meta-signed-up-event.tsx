"use client";

import { useEffect } from "react";

import { usePublicEnv } from "@/components/shared/public-env-provider";
import { fireMetaSignedUpEvent } from "@/lib/utils/util.meta-pixel";

export const MetaSignedUpEvent = (): null => {
  const { NEXT_PUBLIC_META_PIXEL_ID: pixelId } = usePublicEnv();

  useEffect(() => {
    if (pixelId) {
      fireMetaSignedUpEvent(pixelId);
    }
  }, [pixelId]);

  return null;
};
