import { createInertEmailDocument } from "@/lib/document-previews/util.inert-email-document";

/** Mark the template's real CTA before making every email link inert. */
export const createDemoPortalEmailDocument = (html: string): string =>
  createInertEmailDocument(
    html.replace('href="#portal-access"', 'data-portal-email-action="" href="#portal-access"'),
  );
