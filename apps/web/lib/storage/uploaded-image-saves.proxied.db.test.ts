import { describeUploadedImageSaves } from "./uploaded-image-saves.fixtures";

// Storage served by the app itself under /files (the bundled, private bucket):
// stored URLs are same-origin paths.
describeUploadedImageSaves("/files", (key) => `/files/${key}`);
