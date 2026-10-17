import { getMutationAuthCode } from "@/lib/utils/util.auth-error";

/** Never render raw browser/server errors: they may contain technical details. */
export const passkeyErrorKey = (
  error: unknown,
):
  | "errors.cancelled"
  | "errors.alreadyRegistered"
  | "errors.reauthenticate"
  | "errors.rateLimited"
  | "errors.failed" => {
  const code = getMutationAuthCode(error);
  if (code === "SESSION_NOT_FRESH" || code === "UNAUTHORIZED" || code === "SESSION_REQUIRED") {
    return "errors.reauthenticate";
  }
  if (code === "TOO_MANY_REQUESTS") return "errors.rateLimited";
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" || code === "PREVIOUSLY_REGISTERED") {
    return "errors.alreadyRegistered";
  }
  if (
    code === "AUTH_CANCELLED" ||
    code === "ERROR_CEREMONY_ABORTED" ||
    code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" ||
    code === "REGISTRATION_CANCELLED"
  )
    return "errors.cancelled";
  return "errors.failed";
};
