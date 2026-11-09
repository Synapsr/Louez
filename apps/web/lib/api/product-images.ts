import "server-only";

import type { ProductImagesPort } from "@louez/api";

import {
  afterProductImageRun,
  debitProductImage,
  discardProductImage,
  isProductImageRunReport,
  providerCostOf,
  quoteProductImage,
  readProductImageSource,
  resolveProductImageSource,
  runProductImagePipeline,
  storeProductImage,
} from "@/lib/ai/image/product-image-run";
import { log } from "@/lib/evlog";

/**
 * `ApiPorts.productImages`: the API's image jobs (packages/api
 * services/product-images.ts) run the dashboard route's steps
 * (lib/ai/image/product-image-run.ts).
 */
export const productImagesPort: ProductImagesPort = {
  quote: quoteProductImage,
  resolveSource: (storeId, url) => resolveProductImageSource(storeId, { url }),
  process: async ({ source, operation, productName, key, signal }) => {
    const bytes = await readProductImageSource(source, signal);
    signal.throwIfAborted();
    const report = await runProductImagePipeline({ source: bytes, operation, productName, signal });
    signal.throwIfAborted();
    const url = await storeProductImage(key, report);
    return {
      url,
      framingMode: report.processed.standardized.resolvedFramingMode,
      providerCostMicroUsd: providerCostOf(report),
      report,
    };
  },
  discard: discardProductImage,
  debit: (tx, { priceMicro, ...input }) =>
    debitProductImage({ ...input, billMicro: priceMicro }, tx),
  afterSuccess: async ({ report, ...input }) => {
    if (!isProductImageRunReport(report)) {
      log.warn({ productImage: { event: "report_missing", runId: input.runId } });
      return;
    }
    await afterProductImageRun({ ...input, report });
  },
};
