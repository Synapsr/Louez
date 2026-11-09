/**
 * What a model can do about an error an older service throws with a
 * dashboard translation key as its message (`errors.productNotFound`): plain
 * English and the way out. errors.test.ts checks that every key thrown in
 * packages/api is here.
 */
export const TRANSLATION_KEY_MESSAGES: Readonly<
  Record<string, { message: string; retryable?: true }>
> = {
  "errors.invalidData": {
    message: "Some arguments are not valid: check them against the tool's input schema.",
  },
  "errors.storeNotFound": {
    message:
      "This store was not found, or this connection does not reach it: take an id from stores_list.",
  },
  "errors.reservationNotFound": {
    message:
      "No reservation of this store has this id: find it with reservations_list or search_global.",
  },
  "errors.productNotFound": {
    message: "No product of this store has this id: find it with products_list.",
  },
  "errors.productNoLongerAvailable": {
    message: "This product is no longer available for these dates: check its availability first.",
  },
  "errors.optionsRequired": {
    message: "This product needs its options chosen: send them with the call.",
  },
  "errors.conversationNotFound": { message: "No conversation of this store has this id." },
  "errors.marketplaceChannelNotFound": {
    message: "This marketplace channel is not connected to the store.",
  },
  "errors.apiKeyNotFound": { message: "No API key of this store has this id." },
  "errors.unauthorized": {
    message: "This connection or the user's role does not allow this in this store.",
  },
  "errors.permissionDenied": {
    message: "This connection or the user's role does not allow this in this store.",
  },
  "errors.unauthenticated": {
    message: "The credential was not accepted: the user signs in to Louez again.",
  },
  "errors.customerNotAuthenticated": {
    message: "Only a customer signed in on the storefront can do this, not an agent.",
  },
  "errors.missingStoreContext": {
    message: "Say which store: pass storeId, an id from stores_list.",
  },
  "errors.tooManyRequests": {
    message: "Too many requests: wait a moment, then try again.",
    retryable: true,
  },
  "errors.reservationDetailsLocked": {
    message: "This reservation's details can no longer change at its current status.",
  },
  "errors.contractAlreadySigned": {
    message: "The contract is signed already: it can no longer change.",
  },
  "errors.contractGenerationFailed": {
    message:
      "The contract could not be generated. Try once more in a moment; if it fails again, tell the user to contact Louez support.",
    retryable: true,
  },
  "errors.customFieldsInvalid": {
    message:
      "Some custom field values do not match the store's customer fields: check their keys and types.",
  },
  "errors.customerFields.tooManyFields": {
    message: "The store has as many customer fields as it may: remove one first.",
  },
  "errors.customerFields.tooManyListFields": {
    message: "Too many customer fields are shown in the customer list: hide one from it first.",
  },
  "errors.customerFields.tooManySearchable": {
    message: "Too many customer fields are searchable: make one unsearchable first.",
  },
  "errors.companyNameRequired": { message: "A business customer needs a company name." },
  "errors.invalidVatNumber": {
    message: "The VAT number is not valid: check its country prefix and its digits.",
  },
  "errors.invalidCompanyNumber": {
    message: "The company number is not valid: a SIREN has 9 digits, a SIRET 14.",
  },
  "errors.noStripeAccount": {
    message: "The store has no Stripe account yet: it connects Stripe first.",
  },
  "errors.addressApiNotConfigured": {
    message: "Address lookup is not set up on this Louez: send the address as text.",
  },
  "errors.addressLookupFailed": {
    message: "The address lookup did not answer: send the address as text, or try again later.",
    retryable: true,
  },
  "errors.internalServerError": {
    message:
      "Louez hit an unexpected error and could not finish this call. Try once more in a moment; if it fails again, tell the user to contact Louez support.",
  },
};

/** A dashboard translation key that an older service throws as its message. */
export const TRANSLATION_KEY = /^errors\.[A-Za-z0-9_.]+$/;

/**
 * A key no message is written for yet, made readable: `errors.slotTaken`
 * reads "Louez refused this call: slot taken."
 */
export function unknownKeyMessage(key: string): string {
  const words = (key.split(".").pop() ?? key).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return `Louez refused this call: ${words}. Check the arguments and the record it names, then try again with what the user wants.`;
}
