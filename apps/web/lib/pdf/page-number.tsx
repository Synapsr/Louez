import type { ComponentType, PropsWithChildren } from "react";
import { Text as BaseText, View as BaseView } from "@react-pdf/renderer";

// Cast react-pdf components to React types for TS/React 19 compatibility.
type PdfComponent = ComponentType<PropsWithChildren<Record<string, unknown>>>;
const Text = BaseText as unknown as PdfComponent;
const View = BaseView as unknown as PdfComponent;

/** The documents' body line height: a unitless ratio, resolved against the label's font size. */
const LINE_HEIGHT = 1.45;

interface PageNumberProps {
  /** Where the label sits on the page. */
  style?: unknown;
  textStyle: unknown;
  fixed?: boolean;
  /** The label of one page. Return null to print nothing, on a single page for instance. */
  format: (page: { pageNumber: number; totalPages: number }) => string | null;
}

/**
 * "Page 2/5" on every page.
 *
 * react-pdf lays a page out several times and resolves the styles again each time: a line height
 * is multiplied by the font size on every pass. A `<Text render>` carried from page to page keeps
 * that style and is laid out again with it. At 7pt its line height grew 49-fold per page: the
 * label was pushed off the sheet from the first page, and on the twelfth the coordinate went over
 * what PDFKit accepts, so the whole document failed with "unsupported number".
 *
 * So the `render` prop goes on a View, which has no line of its own to lay out, and it returns a
 * new Text for each page. That Text sets its own line height, or it would inherit the View's.
 */
export const PageNumber = ({ style, textStyle, fixed = false, format }: PageNumberProps) => (
  <View
    style={style}
    fixed={fixed}
    render={({ pageNumber, totalPages }: { pageNumber: number; totalPages?: number }) => {
      // The first layout pass runs before the pages are counted.
      if (totalPages === undefined) return null;
      const label = format({ pageNumber, totalPages });
      return label ? <Text style={[{ lineHeight: LINE_HEIGHT }, textStyle]}>{label}</Text> : null;
    }}
  />
);
