/** Disable links and remote resources in generated email markup used by public demos. */
export const createInertEmailDocument = (html: string): string =>
  html
    .replace(
      /<head>/i,
      `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">`,
    )
    .replace(/<a\b[^>]*>/gi, (anchor) =>
      anchor
        .replace(/\s(?:href|target)=(?:"[^"]*"|'[^']*')/gi, "")
        .replace(/>$/, ' aria-disabled="true" tabindex="-1">'),
    );
