// Ambient types for non-standard PWA browser APIs that are absent from lib.dom.

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

interface WindowEventMap {
  beforeinstallprompt: BeforeInstallPromptEvent;
}

interface Navigator {
  /** Legacy iOS Safari flag set when launched from the home screen. */
  readonly standalone?: boolean;
}
