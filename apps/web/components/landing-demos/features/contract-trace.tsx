"use client";

import type { FC } from "react";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { ContractSceneContent } from "@/components/landing-demos/features/contract-scene-content";

export const ContractTraceScene: FC<FeatureSceneProps> = () => (
  <ContractSceneContent initialView="document" validation />
);
