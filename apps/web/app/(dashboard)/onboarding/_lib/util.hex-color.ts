/**
 * "0af" or "00AAFF" → "#00AAFF"; anything else → null. Accepts the code with
 * or without its leading "#".
 */
export function toFullHexColor(code: string): string | null {
  const value = code.replace("#", "");
  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value
      .split("")
      .map((c) => c + c)
      .join("")
      .toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(value)) return `#${value.toUpperCase()}`;
  return null;
}
