"use client";

import { useEffect, useState } from "react";

interface PasskeyCapabilities {
  supported: boolean;
}

export const usePasskeyCapabilities = (): PasskeyCapabilities => {
  const [capabilities, setCapabilities] = useState<PasskeyCapabilities>({
    supported: false,
  });

  useEffect(() => {
    if (
      !window.isSecureContext ||
      !window.PublicKeyCredential ||
      !navigator.credentials?.create ||
      !navigator.credentials.get
    )
      return;
    // The browser may offer a synced provider, a phone, or a security key even
    // when no user-verifying authenticator is built into this device.
    setCapabilities({ supported: true });
  }, []);

  return capabilities;
};
