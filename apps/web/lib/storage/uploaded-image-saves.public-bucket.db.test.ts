import { describeUploadedImageSaves } from "./uploaded-image-saves.test-fixtures";

// Storage served from a public bucket: stored URLs are the bucket's.
describeUploadedImageSaves(
  "https://assets.example.test/louez",
  (key) => `https://assets.example.test/louez/${key}`,
);
