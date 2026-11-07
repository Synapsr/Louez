/** The pickup refusal when the store requires the signed contract (see `contractSignatureMode`). */
export const CONTRACT_SIGNATURE_REQUIRED_ERROR = "errors.contractSignatureRequired";

export const isContractSignatureRequiredRefusal = (error: unknown) =>
  error instanceof Error && error.message === CONTRACT_SIGNATURE_REQUIRED_ERROR;
