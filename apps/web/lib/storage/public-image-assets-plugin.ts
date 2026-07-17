import { handlers, type FilesPlugin } from "files-sdk";

interface PublicImageAssetsOptions {
  setPublicReadAcl: (key: string) => Promise<void>;
}

export const publicImageAssets = ({ setPublicReadAcl }: PublicImageAssetsOptions): FilesPlugin => ({
  name: "public-image-assets",
  wrap: handlers({
    upload: async (operation, next) => {
      const uploaded = await next(operation);
      await setPublicReadAcl(operation.key);
      return uploaded;
    },
    url: (operation, next) =>
      next({
        ...operation,
        // Image files are validated active-content-free assets. Let the
        // adapter return their stable public URL instead of a temporary URL
        // signed only to override Content-Disposition.
        options: {
          ...operation.options,
          responseContentDisposition: undefined,
        },
      }),
  }),
});
