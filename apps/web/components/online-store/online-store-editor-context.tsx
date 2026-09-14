"use client";

import { createContext, useContext, type ReactNode } from "react";

import { useAppForm } from "@/hooks/form/form";

import type { OnlineStoreDevice } from "./online-store.constants";
import type { PendingImageUploads } from "./use-pending-image-uploads";
import {
  type OnlineStoreEditorStore,
  type OnlineStoreFormValues,
  onlineStoreFormOptions,
} from "./util.online-store-form";

interface UseOnlineStoreFormOptions {
  defaultValues: OnlineStoreFormValues;
  onSubmit: (input: { value: OnlineStoreFormValues }) => Promise<void>;
}

/** The editor's one form over the five sections; typed once here for every consumer. */
export const useOnlineStoreForm = ({ defaultValues, onSubmit }: UseOnlineStoreFormOptions) =>
  useAppForm({ ...onlineStoreFormOptions, defaultValues, onSubmit });

export type OnlineStoreForm = ReturnType<typeof useOnlineStoreForm>;

export interface OnlineStoreEditorContextValue {
  form: OnlineStoreForm;
  uploads: PendingImageUploads;
  /** The last saved values: what the row holds, what a reset goes back to. */
  savedValues: OnlineStoreFormValues;
  store: OnlineStoreEditorStore;
  device: OnlineStoreDevice;
  setDevice: (device: OnlineStoreDevice) => void;
}

const OnlineStoreEditorContext = createContext<OnlineStoreEditorContextValue | null>(null);

export const OnlineStoreEditorProvider = ({
  value,
  children,
}: {
  value: OnlineStoreEditorContextValue;
  children: ReactNode;
}) => (
  <OnlineStoreEditorContext.Provider value={value}>{children}</OnlineStoreEditorContext.Provider>
);

export const useOnlineStoreEditor = (): OnlineStoreEditorContextValue => {
  const context = useContext(OnlineStoreEditorContext);
  if (!context) {
    throw new Error("useOnlineStoreEditor must be used within OnlineStoreEditorProvider");
  }
  return context;
};
