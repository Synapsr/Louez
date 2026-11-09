import { Suspense } from "react";

import { OAuthLayoutContent } from "./oauth-layout-content";

// The consent page depends on the session and on its signed query.
export const instant = false;

const OAuthLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <Suspense fallback={<div className="dashboard bg-background min-h-screen" />}>
      <OAuthLayoutContent>{children}</OAuthLayoutContent>
    </Suspense>
  );
};

export default OAuthLayout;
