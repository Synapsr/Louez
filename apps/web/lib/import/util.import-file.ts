/**
 * The text of a delimited file. Spreadsheets on Windows still save CSV in
 * Windows-1252: when UTF-8 decoding produces replacement characters, the file
 * is read again as such, so "Hélène" does not arrive as "H�l�ne".
 */
export const readDelimitedFile = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buffer) : utf8;
};

/** Rows cut into calls small enough for one request each. */
export const chunkRows = <T>(rows: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, index) =>
    rows.slice(index * size, (index + 1) * size),
  );
