// What refund-credit-note-race.db.test.ts puts in place of the PDF's rendering: the
// generator under test runs; no document is drawn.
export const renderToBuffer = async () => Buffer.from("%PDF-test");
export const InvoiceDocument = (props) => props;
export const generateContract = async () => null;
