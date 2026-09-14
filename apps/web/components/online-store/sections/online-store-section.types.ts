import type { PendingImageUploads } from "../use-pending-image-uploads";
import type { OnlineStoreEditorStore, OnlineStoreFormValues } from "../util.online-store-form";

/** What every section receives beside the form. */
export interface OnlineStoreSectionProps {
  uploads: PendingImageUploads;
  /** The last saved values, so only unsaved uploads get deleted. */
  savedValues: OnlineStoreFormValues;
  store: OnlineStoreEditorStore;
}
