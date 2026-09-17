"use client";

import { useEffect, type ReactNode } from "react";
import type { AnimatedScene } from "./use-demo-playback";

export const DemoSceneReady = ({
  scene,
  onReady,
  children,
}: {
  scene: AnimatedScene;
  onReady: (scene: AnimatedScene) => void;
  children: ReactNode;
}) => {
  useEffect(() => {
    onReady(scene);
  }, [scene, onReady]);
  return children;
};
