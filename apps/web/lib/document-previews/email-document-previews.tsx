import { DeleteAccountEmail, getDeleteAccountEmailSubject } from "@louez/email/templates";

import {
  composeContractEmail,
  composeCustomMessageEmail,
  composeInstantAccessEmail,
  composeManualPaymentRequestEmail,
  composeReminderPickupEmail,
  composeReminderReturnEmail,
  type ComposeStore,
} from "@/lib/email/compose";
import { getEmailTranslations } from "@/lib/email/i18n";
import {
  DepositAuthorizationRequestEmail,
  MagicLinkEmail,
  NewRequestLandlordEmail,
  OTPEmail,
  PaymentConfirmationEmail,
  PaymentFailedEmail,
  PaymentRequestEmail,
  PhoneCallbackLandlordEmail,
  QuoteSentEmail,
  ReminderDigestAdminEmail,
  ReminderPickupAdminEmail,
  ReminderReturnAdminEmail,
  RequestAcceptedEmail,
  RequestReceivedEmail,
  RequestRejectedEmail,
  ReservationCancelledEmail,
  ReservationCompletedEmail,
  ReservationConfirmationEmail,
  ReservationModifiedEmail,
  RewardUnlockedEmail,
  SupplierInvoiceReceivedEmail,
  TeamInvitationEmail,
  ThankYouReviewEmail,
  VerificationCodeEmail,
  VoiceNumberBillingEmail,
  getReservationModifiedEmailSubject,
} from "@/lib/email/templates";
import type { VoiceNumberBillingVariant } from "@/lib/email/templates/voice-number-billing";

import {
  EMAIL_PREVIEW_LOCALES,
  PREVIEW_LINK_URL,
  previewCustomer,
  previewReservation,
} from "./document-previews.fixtures";
import type {
  DocumentPreviewContext,
  DocumentPreviewStore,
  EmailDocumentPreview,
} from "./document-previews.types";

const { number, startDate, endDate, items, subtotal, deposit, total } = previewReservation;
const url = PREVIEW_LINK_URL;

/** The props every store-branded template shares. Spread first, then add the specifics. */
const baseProps = ({ store, locale }: DocumentPreviewContext) => ({
  storeName: store.name,
  logoUrl: store.logoUrl,
  primaryColor: store.primaryColor,
  storeEmail: store.email,
  storePhone: store.phone,
  storeAddress: store.address,
  storeTimezone: store.timezone,
  storeCountry: store.country,
  customerFirstName: previewCustomer.firstName,
  reservationNumber: number,
  locale,
  currency: store.currency,
});

const toComposeStore = (store: DocumentPreviewStore): ComposeStore => ({
  name: store.name,
  email: store.email,
  phone: store.phone,
  address: store.address,
  theme: { primaryColor: store.primaryColor },
  settings: { currency: store.currency, country: store.country, timezone: store.timezone },
});

const composeArgs = ({ store, locale }: DocumentPreviewContext) => ({
  store: toComposeStore(store),
  customer: previewCustomer,
  locale,
  logoUrl: store.logoUrl,
});

const withNumber = (subject: string) => subject.replace("{number}", number);
const fromStore = (subject: string, store: DocumentPreviewStore) => `${subject} - ${store.name}`;

const customerEmail = (
  definition: Omit<EmailDocumentPreview, "kind" | "group" | "locales">,
): EmailDocumentPreview => ({
  kind: "email",
  group: "customer-email",
  locales: EMAIL_PREVIEW_LOCALES,
  ...definition,
});

const storeEmail = (
  definition: Omit<EmailDocumentPreview, "kind" | "group" | "locales">,
): EmailDocumentPreview => ({
  kind: "email",
  group: "store-email",
  locales: EMAIL_PREVIEW_LOCALES,
  ...definition,
});

const platformEmail = (
  definition: Omit<EmailDocumentPreview, "kind" | "group" | "locales">,
): EmailDocumentPreview => ({
  kind: "email",
  group: "platform-email",
  locales: EMAIL_PREVIEW_LOCALES,
  ...definition,
});

const voiceNumberBilling = (
  variant: VoiceNumberBillingVariant,
  title: string,
  description: string,
): EmailDocumentPreview =>
  storeEmail({
    id: `voice-number-billing-${variant}`,
    title,
    description,
    compose: ({ store, locale }) => ({
      subject: getEmailTranslations(locale).voiceNumberBilling[variant].subject.replace(
        "{number}",
        "+33 2 98 11 22 33",
      ),
      element: VoiceNumberBillingEmail({
        variant,
        storeName: store.name,
        primaryColor: store.primaryColor,
        e164: "+33298112233",
        credits: 40,
        deadlineText: variant === "failed" ? "le 15 septembre 2026" : null,
        ctaUrl: url,
        locale,
      }),
    }),
  });

export const EMAIL_DOCUMENT_PREVIEWS: readonly EmailDocumentPreview[] = [
  // ----- Customer-facing -----
  customerEmail({
    id: "reservation-confirmation",
    title: "Confirmation de réservation",
    description: "Réservation payée ou confirmée par le loueur.",
    compose: (context) => ({
      subject: fromStore(
        withNumber(getEmailTranslations(context.locale).confirmReservation.subject),
        context.store,
      ),
      element: ReservationConfirmationEmail({
        ...baseProps(context),
        startDate,
        endDate,
        items,
        subtotal,
        deposit,
        total,
        reservationUrl: url,
      }),
    }),
  }),
  customerEmail({
    id: "request-received",
    title: "Demande reçue",
    description: "Accusé de réception d'une demande de réservation en mode demande.",
    compose: (context) => ({
      subject: fromStore(
        withNumber(getEmailTranslations(context.locale).requestReceived.subject),
        context.store,
      ),
      element: RequestReceivedEmail({ ...baseProps(context), startDate, endDate }),
    }),
  }),
  customerEmail({
    id: "request-accepted",
    title: "Demande acceptée",
    description: "Le loueur accepte la demande, avec contrat, CGV et lien de paiement.",
    compose: (context) => ({
      subject: fromStore(
        withNumber(getEmailTranslations(context.locale).requestAccepted.subject),
        context.store,
      ),
      element: RequestAcceptedEmail({
        ...baseProps(context),
        startDate,
        endDate,
        items,
        total: subtotal,
        deposit,
        reservationUrl: url,
        contractUrl: url,
        termsUrl: url,
        paymentUrl: url,
      }),
    }),
  }),
  customerEmail({
    id: "request-rejected",
    title: "Demande refusée",
    description: "Le loueur refuse la demande, avec un motif.",
    compose: (context) => ({
      subject: fromStore(
        withNumber(getEmailTranslations(context.locale).requestRejected.subject),
        context.store,
      ),
      element: RequestRejectedEmail({
        ...baseProps(context),
        reason: "Matériel indisponible sur ces dates.",
      }),
    }),
  }),
  customerEmail({
    id: "quote-sent",
    title: "Devis envoyé",
    description: "Devis transmis au client depuis le tableau de bord.",
    compose: (context) => ({
      subject: fromStore(
        withNumber(getEmailTranslations(context.locale).quoteSent.subject),
        context.store,
      ),
      element: QuoteSentEmail({
        ...baseProps(context),
        startDate,
        endDate,
        items,
        total: subtotal,
        reservationUrl: url,
      }),
    }),
  }),
  customerEmail({
    id: "reservation-modified",
    title: "Réservation modifiée",
    description: "Les dates de la réservation ont changé.",
    compose: (context) => ({
      subject: fromStore(getReservationModifiedEmailSubject(number, context.locale), context.store),
      element: ReservationModifiedEmail({
        ...baseProps(context),
        previousStartDate: previewReservation.previousStartDate,
        previousEndDate: previewReservation.previousEndDate,
        startDate,
        endDate,
        reservationUrl: url,
      }),
    }),
  }),
  customerEmail({
    id: "reservation-cancelled",
    title: "Réservation annulée",
    description: "Annulation par le client ou le loueur, avec un motif.",
    compose: (context) => ({
      subject: fromStore(
        withNumber(getEmailTranslations(context.locale).reservationCancelled.subject),
        context.store,
      ),
      element: ReservationCancelledEmail({
        ...baseProps(context),
        startDate,
        endDate,
        reason: "Annulation demandée par le client.",
        storefrontUrl: url,
      }),
    }),
  }),
  customerEmail({
    id: "reservation-completed",
    title: "Réservation terminée",
    description: "Matériel rendu, caution restituée.",
    compose: (context) => ({
      subject: fromStore(
        withNumber(getEmailTranslations(context.locale).reservationCompleted.subject),
        context.store,
      ),
      element: ReservationCompletedEmail({
        ...baseProps(context),
        startDate,
        endDate,
        depositAmount: deposit,
        depositReturned: true,
        storefrontUrl: url,
      }),
    }),
  }),
  customerEmail({
    id: "reminder-pickup",
    title: "Rappel de retrait",
    description: "Envoyé la veille du début de la location, avec un mot du loueur.",
    compose: (context) =>
      composeReminderPickupEmail({
        ...composeArgs(context),
        reservation: { number, startDate },
        reservationUrl: url,
        additionalMessage: "Pensez à prévoir un coupe-vent, la brise se lève souvent.",
      }),
  }),
  customerEmail({
    id: "reminder-return",
    title: "Rappel de retour",
    description: "Envoyé la veille de la fin de la location.",
    compose: (context) =>
      composeReminderReturnEmail({
        ...composeArgs(context),
        reservation: { number, endDate },
      }),
  }),
  customerEmail({
    id: "instant-access",
    title: "Accès à la réservation",
    description: "Lien d'accès envoyé manuellement, avec appel au paiement.",
    compose: (context) =>
      composeInstantAccessEmail({
        ...composeArgs(context),
        reservation: { number, startDate, endDate, totalAmount: total },
        items,
        accessUrl: url,
        showPaymentCta: true,
        additionalMessage: "Demo message du loueur.",
      }),
  }),
  customerEmail({
    id: "contract",
    title: "Contrat à signer",
    description: "Le loueur envoie le contrat au client depuis le tableau de bord.",
    compose: (context) =>
      composeContractEmail({
        ...composeArgs(context),
        reservationNumber: number,
        contractUrl: url,
        additionalMessage: "Signature avant vendredi svp.",
      }),
  }),
  customerEmail({
    id: "custom-message",
    title: "Message personnalisé",
    description: "Message libre du loueur à propos d'une réservation.",
    compose: (context) =>
      composeCustomMessageEmail({
        ...composeArgs(context),
        reservationNumber: number,
        message: "Bonjour,\n\nvoici un petit mot personnalisé.\nÀ très vite !",
        reservationUrl: url,
      }),
  }),
  customerEmail({
    id: "payment-request-stripe",
    title: "Demande de paiement (Stripe)",
    description: "Lien de paiement en ligne pour le solde.",
    compose: (context) => ({
      subject: fromStore(
        withNumber(getEmailTranslations(context.locale).paymentRequest.subject),
        context.store,
      ),
      element: PaymentRequestEmail({
        ...baseProps(context),
        amount: total,
        description: "Solde de la réservation",
        paymentUrl: url,
        customMessage: "Merci de régler avant le retrait.",
      }),
    }),
  }),
  customerEmail({
    id: "payment-request-manual",
    title: "Demande de paiement (manuel)",
    description: "Le loueur demande un règlement hors ligne.",
    compose: (context) =>
      composeManualPaymentRequestEmail({
        ...composeArgs(context),
        reservationNumber: number,
        amount: total,
        reservationUrl: url,
        additionalMessage: "Merci de régler avant le retrait.",
      }),
  }),
  customerEmail({
    id: "payment-confirmation",
    title: "Paiement confirmé",
    description: "Reçu après un paiement réussi.",
    compose: (context) => ({
      subject: fromStore(
        withNumber(getEmailTranslations(context.locale).paymentConfirmation.subject),
        context.store,
      ),
      element: PaymentConfirmationEmail({
        ...baseProps(context),
        paymentAmount: total,
        paymentDate: startDate,
        paymentMethod: "card",
        reservationUrl: url,
      }),
    }),
  }),
  customerEmail({
    id: "payment-failed",
    title: "Échec de paiement",
    description: "Le prélèvement a échoué, le client doit réessayer.",
    compose: (context) => ({
      subject: fromStore(
        withNumber(getEmailTranslations(context.locale).paymentFailed.subject),
        context.store,
      ),
      element: PaymentFailedEmail({
        ...baseProps(context),
        paymentAmount: total,
        errorMessage: "Carte expirée",
        paymentUrl: url,
      }),
    }),
  }),
  customerEmail({
    id: "deposit-authorization-request",
    title: "Autorisation de caution",
    description: "Demande d'empreinte bancaire pour la caution.",
    compose: (context) => ({
      subject: fromStore(
        withNumber(getEmailTranslations(context.locale).depositAuthorizationRequest.subject),
        context.store,
      ),
      element: DepositAuthorizationRequestEmail({
        ...baseProps(context),
        depositAmount: deposit,
        authorizationUrl: url,
        customMessage: "Empreinte à faire avant jeudi.",
      }),
    }),
  }),
  customerEmail({
    id: "verification-code",
    title: "Code de connexion client",
    description: "Code à usage unique pour l'espace client de la boutique.",
    compose: (context) => ({
      subject: fromStore(
        getEmailTranslations(context.locale).verificationCode.subject.replace("{code}", "482913"),
        context.store,
      ),
      element: VerificationCodeEmail({ ...baseProps(context), code: "482913" }),
    }),
  }),
  customerEmail({
    id: "thank-you-review",
    title: "Merci et demande d'avis",
    description: "Envoyé après la location pour recueillir un avis.",
    compose: (context) => ({
      subject: fromStore(
        getEmailTranslations(context.locale).thankYouReview.subject,
        context.store,
      ),
      element: ThankYouReviewEmail({ ...baseProps(context), startDate, endDate, reviewUrl: url }),
    }),
  }),
  customerEmail({
    id: "reward-unlocked",
    title: "Récompense de parrainage",
    description: "Le loueur gagne des réservations offertes grâce à un parrainage.",
    compose: (context) => ({
      subject: fromStore(
        getEmailTranslations(context.locale).rewardUnlocked.subject,
        context.store,
      ),
      element: RewardUnlockedEmail({
        ...baseProps(context),
        storeLogoUrl: context.store.logoUrl,
        referredStoreName: "Kayak & Co",
        kind: "free_reservations",
        freeReservations: 5,
        rewardValue: "49€",
        ctaUrl: url,
      }),
    }),
  }),

  // ----- Store owner / team -----
  storeEmail({
    id: "new-request-landlord",
    title: "Nouvelle demande",
    description: "Le loueur reçoit une demande de réservation à traiter.",
    compose: ({ store, locale }) => ({
      subject: withNumber(getEmailTranslations(locale).newRequestLandlord.subject),
      element: NewRequestLandlordEmail({
        storeName: store.name,
        logoUrl: store.logoUrl,
        primaryColor: store.primaryColor,
        customerFirstName: previewCustomer.firstName,
        customerLastName: previewCustomer.lastName,
        customerEmail: previewCustomer.email,
        reservationNumber: number,
        startDate,
        endDate,
        total: subtotal,
        customerNotes: "Est-ce possible de récupérer le matériel dès 8h ?",
        dashboardUrl: url,
        locale,
        currency: store.currency,
        storeTimezone: store.timezone,
        storeCountryCode: store.country,
      }),
    }),
  }),
  storeEmail({
    id: "reminder-pickup-admin",
    title: "Retrait à venir (loueur)",
    description: "Rappel au loueur d'un retrait le lendemain.",
    compose: ({ store, locale }) => ({
      subject: withNumber(getEmailTranslations(locale).reminderPickupAdmin.subject),
      element: ReminderPickupAdminEmail({
        ...baseProps({ store, locale }),
        customerLastName: previewCustomer.lastName,
        customerEmail: previewCustomer.email,
        customerPhone: previewCustomer.phone,
        startDate,
        total: subtotal,
        dashboardUrl: url,
      }),
    }),
  }),
  storeEmail({
    id: "reminder-return-admin",
    title: "Retour à venir (loueur)",
    description: "Rappel au loueur d'un retour le lendemain.",
    compose: ({ store, locale }) => ({
      subject: withNumber(getEmailTranslations(locale).reminderReturnAdmin.subject),
      element: ReminderReturnAdminEmail({
        ...baseProps({ store, locale }),
        customerLastName: previewCustomer.lastName,
        customerEmail: previewCustomer.email,
        customerPhone: previewCustomer.phone,
        endDate,
        total: subtotal,
        dashboardUrl: url,
      }),
    }),
  }),
  storeEmail({
    id: "reminder-digest-admin",
    title: "Programme du jour (loueur)",
    description: "Récapitulatif quotidien des retraits et retours.",
    compose: ({ store, locale }) => ({
      subject: getEmailTranslations(locale).reminderDigestAdmin.subject.replace(
        "{date}",
        "jeudi 6 août",
      ),
      element: ReminderDigestAdminEmail({
        storeName: store.name,
        logoUrl: store.logoUrl,
        primaryColor: store.primaryColor,
        storeAddress: store.address,
        storeEmail: store.email,
        storePhone: store.phone,
        dateLabel: "jeudi 6 août",
        pickups: [
          { number: "2026-0365", customerName: "Tanguy Le Goff", timeLabel: "09:00" },
          { number: "2026-0368", customerName: "Maïwenn Kerbrat", timeLabel: "14:30" },
        ],
        returns: [{ number: "2026-0351", customerName: "Yann Guivarc'h", timeLabel: "18:00" }],
        dashboardUrl: url,
        locale,
      }),
    }),
  }),
  storeEmail({
    id: "phone-callback-landlord",
    title: "Client à rappeler",
    description: "L'agent vocal n'a pas pu finaliser l'appel et a pris un message.",
    compose: ({ store, locale }) => ({
      subject: getEmailTranslations(locale).phoneCallbackLandlord.subject.replace(
        "{store}",
        store.name,
      ),
      element: PhoneCallbackLandlordEmail({
        storeName: store.name,
        primaryColor: store.primaryColor,
        callerPhone: "+33 6 11 22 33 44",
        message:
          "Le client souhaite louer trois kayaks pour samedi et demande si un transport est possible.",
        conversationUrl: url,
        locale,
      }),
    }),
  }),
  voiceNumberBilling(
    "warning",
    "Numéro vocal : solde insuffisant",
    "Le renouvellement mensuel du numéro approche et les crédits IA manquent.",
  ),
  voiceNumberBilling(
    "failed",
    "Numéro vocal : renouvellement échoué",
    "Le renouvellement a échoué, le numéro sera libéré à la date limite.",
  ),
  voiceNumberBilling(
    "released",
    "Numéro vocal : numéro libéré",
    "Le numéro a été détaché de la boutique.",
  ),
  storeEmail({
    id: "team-invitation",
    title: "Invitation d'équipe",
    description: "Un membre invite un collègue à rejoindre la boutique.",
    compose: ({ store, locale }) => ({
      subject: getEmailTranslations(locale)
        .teamInvitation.subject.replace("{inviterName}", "Morgane")
        .replace("{storeName}", store.name),
      element: TeamInvitationEmail({
        storeName: store.name,
        storeLogoUrl: store.logoUrl,
        primaryColor: store.primaryColor,
        inviterName: "Morgane",
        invitationUrl: url,
        locale,
      }),
    }),
  }),
  storeEmail({
    id: "supplier-invoice-received",
    title: "Facture fournisseur reçue",
    description: "Une facture est arrivée via la plateforme de dématérialisation.",
    compose: ({ store, locale }) => ({
      subject: getEmailTranslations(locale).supplierInvoiceReceived.subject,
      element: SupplierInvoiceReceivedEmail({
        storeName: store.name,
        primaryColor: store.primaryColor,
        sellerName: "Nautic Supply SAS",
        invoiceNumber: "F-2026-1187",
        totalInclTax: "1 842,00",
        currency: store.currency,
        dashboardUrl: url,
        locale,
      }),
    }),
  }),

  // ----- Platform (Louez account) -----
  platformEmail({
    id: "otp",
    title: "Code de connexion Louez",
    description: "Code à usage unique pour se connecter au tableau de bord.",
    compose: ({ locale }) => ({
      subject: null,
      element: OTPEmail({ otp: "482913", locale }),
    }),
  }),
  platformEmail({
    id: "magic-link",
    title: "Lien de connexion Louez",
    description: "Lien magique pour se connecter au tableau de bord.",
    compose: ({ locale }) => ({
      subject: null,
      element: MagicLinkEmail({ url, locale }),
    }),
  }),
  platformEmail({
    id: "delete-account",
    title: "Suppression de compte",
    description: "Confirmation avant suppression définitive du compte Louez.",
    compose: ({ locale }) => ({
      subject: getDeleteAccountEmailSubject(locale),
      element: DeleteAccountEmail({ url, locale }),
    }),
  }),
];
