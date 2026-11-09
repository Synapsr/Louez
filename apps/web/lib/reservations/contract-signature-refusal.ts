/** The pickup refusal when the store requires the signed contract (see `contractSignatureMode`). */
export const CONTRACT_SIGNATURE_REQUIRED_ERROR = "errors.contractSignatureRequired";

/** The procedure names it in its translation key (`data.i18nKey`). No server import. */
export const isContractSignatureRequiredRefusal = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const data: unknown = "data" in error ? error.data : undefined;
  const i18nKey = data && typeof data === "object" && "i18nKey" in data ? data.i18nKey : undefined;
  return i18nKey === CONTRACT_SIGNATURE_REQUIRED_ERROR;
};
