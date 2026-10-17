"use client";

import { useEffect, useState } from "react";

interface PasskeyCapabilities {
  supported: boolean;
  platform: boolean;
}

export const usePasskeyCapabilities = (): PasskeyCapabilities => {
  const [capabilities, setCapabilities] = useState<PasskeyCapabilities>({
    supported: false,
    platform: false,
  });

  useEffect(() => {
    if (
      !window.isSecureContext ||
      !window.PublicKeyCredential ||
      !navigator.credentials?.create ||
      !navigator.credentials.get
    )
      return;
    let active = true;
    setCapabilities({ supported: true, platform: false });
    void (
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.() ??
      Promise.resolve(false)
    )
      .then((platform) => {
        if (active) setCapabilities({ supported: true, platform });
      })
      .catch(() => {
        // A security key may still work; only the automatic invitation is hidden.
      });
    return () => {
      active = false;
    };
  }, []);

  return capabilities;
};
