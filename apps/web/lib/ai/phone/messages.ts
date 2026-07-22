/**
 * Fixed spoken lines for the phone receptionist, per configured language.
 * These are the deterministic bits the model does NOT produce: the mandatory
 * EU AI Act disclosure at pickup, reprompts, goodbyes and fallbacks. Kept in
 * sync with the app's supported locales; falls back to English.
 */
export interface PhoneStrings {
  /** MANDATORY opener: tells the caller they reached an automated AI. */
  disclosure: (store: string) => string
  /** Default follow-up when the merchant set no custom greeting. */
  ask: string
  /** Spoken when no speech was recognized. */
  reprompt: string
  /** Short goodbye before hanging up. */
  goodbye: string
  /** Spoken right before transferring to a human. */
  transferring: string
  /** Spoken when the receptionist can't take the call (inactive / no credits). */
  unavailable: string
}

const STRINGS: Record<string, PhoneStrings> = {
  fr: {
    disclosure: (store) =>
      `Bonjour, vous êtes en relation avec l'assistant vocal automatisé de ${store}.`,
    ask: 'Comment puis-je vous aider ?',
    reprompt: "Je n'ai pas bien entendu. Pouvez-vous répéter ?",
    goodbye: 'Merci de votre appel. Bonne journée, au revoir !',
    transferring: 'Je vous mets en relation avec la boutique, veuillez patienter.',
    unavailable:
      "Le standard automatique n'est pas disponible pour le moment. Merci de rappeler plus tard.",
  },
  en: {
    disclosure: (store) =>
      `Hello, you've reached the automated voice assistant of ${store}.`,
    ask: 'How can I help you?',
    reprompt: "Sorry, I didn't catch that. Could you say it again?",
    goodbye: 'Thanks for calling. Have a great day, goodbye!',
    transferring: "I'm connecting you to the store now, please hold.",
    unavailable:
      'The automated line is unavailable right now. Please call back later.',
  },
  it: {
    disclosure: (store) =>
      `Salve, è in contatto con l'assistente vocale automatico di ${store}.`,
    ask: 'Come posso aiutarla?',
    reprompt: 'Scusi, non ho capito bene. Può ripetere?',
    goodbye: 'Grazie per la chiamata. Buona giornata, arrivederci!',
    transferring: 'La metto in contatto con il negozio, attenda in linea.',
    unavailable:
      'Il centralino automatico non è disponibile al momento. Richiami più tardi.',
  },
  nl: {
    disclosure: (store) =>
      `Hallo, u bent verbonden met de geautomatiseerde spraakassistent van ${store}.`,
    ask: 'Waarmee kan ik u helpen?',
    reprompt: 'Sorry, dat heb ik niet goed verstaan. Kunt u het herhalen?',
    goodbye: 'Bedankt voor uw telefoontje. Fijne dag, tot ziens!',
    transferring: 'Ik verbind u door met de winkel, een moment geduld.',
    unavailable:
      'De geautomatiseerde lijn is momenteel niet beschikbaar. Bel later terug.',
  },
  pt: {
    disclosure: (store) =>
      `Olá, está em contacto com o assistente de voz automático da ${store}.`,
    ask: 'Como posso ajudar?',
    reprompt: 'Desculpe, não percebi bem. Pode repetir?',
    goodbye: 'Obrigado pela chamada. Bom dia, até logo!',
    transferring: 'Vou transferir para a loja, aguarde um momento.',
    unavailable:
      'O atendimento automático não está disponível de momento. Ligue mais tarde.',
  },
  de: {
    disclosure: (store) =>
      `Hallo, Sie sprechen mit dem automatischen Sprachassistenten von ${store}.`,
    ask: 'Wie kann ich Ihnen helfen?',
    reprompt: 'Entschuldigung, das habe ich nicht verstanden. Können Sie es wiederholen?',
    goodbye: 'Danke für Ihren Anruf. Einen schönen Tag, auf Wiederhören!',
    transferring: 'Ich verbinde Sie mit dem Geschäft, bitte bleiben Sie dran.',
    unavailable:
      'Die automatische Leitung ist derzeit nicht verfügbar. Bitte rufen Sie später zurück.',
  },
  es: {
    disclosure: (store) =>
      `Hola, está hablando con el asistente de voz automático de ${store}.`,
    ask: '¿En qué puedo ayudarle?',
    reprompt: 'Perdón, no le he entendido bien. ¿Puede repetirlo?',
    goodbye: 'Gracias por llamar. Que tenga un buen día, ¡hasta luego!',
    transferring: 'Le paso con la tienda, espere un momento por favor.',
    unavailable:
      'La línea automática no está disponible en este momento. Vuelva a llamar más tarde.',
  },
  pl: {
    disclosure: (store) =>
      `Dzień dobry, łączysz się z automatycznym asystentem głosowym ${store}.`,
    ask: 'W czym mogę pomóc?',
    reprompt: 'Przepraszam, nie zrozumiałem. Czy może Pan/Pani powtórzyć?',
    goodbye: 'Dziękuję za telefon. Miłego dnia, do usłyszenia!',
    transferring: 'Łączę ze sklepem, proszę czekać.',
    unavailable:
      'Automatyczna linia jest chwilowo niedostępna. Proszę zadzwonić później.',
  },
}

export function phoneStrings(language: string): PhoneStrings {
  return STRINGS[language] ?? STRINGS.en
}
