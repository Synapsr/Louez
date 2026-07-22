/**
 * Turns a checkout/reservation error (the exact keys createReservation returns
 * for the storefront "request" flow) into a short, spoken-friendly sentence in
 * the caller's language. The phone agent relays this reason as-is instead of
 * receiving a raw i18n key it cannot read — which is what used to make it
 * confabulate ("we close at 6pm…") and loop. The wording is deliberately plain
 * so the model can repeat or gently rephrase it out loud.
 */

const SUPPORTED = ['fr', 'en', 'de', 'es', 'it', 'nl', 'pl', 'pt'] as const
type Lang = (typeof SUPPORTED)[number]

function toLang(language: string): Lang {
  return (SUPPORTED as readonly string[]).includes(language)
    ? (language as Lang)
    : 'en'
}

/** Spoken plural forms for a duration unit, by language. */
const DURATION: Record<
  Lang,
  { day: (n: number) => string; hour: (n: number) => string; minute: (n: number) => string }
> = {
  fr: {
    day: (n) => `${n} jour${n > 1 ? 's' : ''}`,
    hour: (n) => `${n} heure${n > 1 ? 's' : ''}`,
    minute: (n) => `${n} minute${n > 1 ? 's' : ''}`,
  },
  en: {
    day: (n) => `${n} day${n > 1 ? 's' : ''}`,
    hour: (n) => `${n} hour${n > 1 ? 's' : ''}`,
    minute: (n) => `${n} minute${n > 1 ? 's' : ''}`,
  },
  de: {
    day: (n) => `${n} Tag${n > 1 ? 'e' : ''}`,
    hour: (n) => `${n} Stunde${n > 1 ? 'n' : ''}`,
    minute: (n) => `${n} Minute${n > 1 ? 'n' : ''}`,
  },
  es: {
    day: (n) => `${n} día${n > 1 ? 's' : ''}`,
    hour: (n) => `${n} hora${n > 1 ? 's' : ''}`,
    minute: (n) => `${n} minuto${n > 1 ? 's' : ''}`,
  },
  it: {
    day: (n) => `${n} giorno${n > 1 ? 'i' : ''}`,
    hour: (n) => `${n} ora${n > 1 ? 'e' : ''}`,
    minute: (n) => `${n} minuto${n > 1 ? 'i' : ''}`,
  },
  nl: {
    day: (n) => `${n} dag${n > 1 ? 'en' : ''}`,
    hour: (n) => `${n} uur`,
    minute: (n) => `${n} minu${n > 1 ? 'ten' : 'ut'}`,
  },
  pl: {
    day: (n) => `${n} ${n === 1 ? 'dzień' : 'dni'}`,
    hour: (n) => `${n} ${n === 1 ? 'godzinę' : 'godziny'}`,
    minute: (n) => `${n} ${n === 1 ? 'minutę' : 'minuty'}`,
  },
  pt: {
    day: (n) => `${n} dia${n > 1 ? 's' : ''}`,
    hour: (n) => `${n} hora${n > 1 ? 's' : ''}`,
    minute: (n) => `${n} minuto${n > 1 ? 's' : ''}`,
  },
}

/**
 * Localize the compact duration token that createReservation passes as
 * errorParams.duration (formatDurationFromMinutes: "1d", "2h", "30 min") into
 * spoken words ("1 jour", "2 heures"). Falls back to the raw token if unparsed.
 */
function spokenDuration(token: unknown, l: Lang): string {
  if (typeof token !== 'string') return ''
  const match = /^(\d+)\s*(d|h|min)$/.exec(token.trim())
  if (!match) return token
  const n = Number(match[1])
  const units = DURATION[l]
  if (match[2] === 'd') return units.day(n)
  if (match[2] === 'h') return units.hour(n)
  return units.minute(n)
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

type Params = Record<string, unknown> | undefined

/** Per-reason sentence builders, one map per language. */
const REASONS: Record<Lang, Record<string, (p: Params) => string>> = {
  fr: {
    businessHoursViolation: () =>
      "Ces horaires sont en dehors des heures d'ouverture de la boutique.",
    advanceNoticeViolation: (p) =>
      `Il faut réserver au moins ${spokenDuration(p?.duration, 'fr')} à l'avance.`,
    minRentalDurationViolation: (p) =>
      `La durée minimale de location est de ${spokenDuration(p?.duration, 'fr')}.`,
    maxRentalDurationViolation: (p) =>
      `La durée maximale de location est de ${spokenDuration(p?.duration, 'fr')}.`,
    insufficientStock: (p) =>
      `Il ne reste que ${str(p?.count)} ${str(p?.name)} pour ces dates.`,
    productUnavailable: (p) =>
      `${str(p?.name)} n'est pas disponible pour ces dates.`,
    productNoLongerAvailable: (p) =>
      `${str(p?.name)} vient d'être réservé par quelqu'un d'autre pour ces dates.`,
    productNotFound: () =>
      'Un des produits demandés est introuvable dans le catalogue.',
    default: () => "Je n'ai pas pu valider la réservation pour ces dates.",
  },
  en: {
    businessHoursViolation: () =>
      "Those times are outside the store's opening hours.",
    advanceNoticeViolation: (p) =>
      `Reservations need to be made at least ${spokenDuration(p?.duration, 'en')} in advance.`,
    minRentalDurationViolation: (p) =>
      `The minimum rental duration is ${spokenDuration(p?.duration, 'en')}.`,
    maxRentalDurationViolation: (p) =>
      `The maximum rental duration is ${spokenDuration(p?.duration, 'en')}.`,
    insufficientStock: (p) =>
      `Only ${str(p?.count)} ${str(p?.name)} left for those dates.`,
    productUnavailable: (p) => `${str(p?.name)} isn't available for those dates.`,
    productNoLongerAvailable: (p) =>
      `${str(p?.name)} was just booked by someone else for those dates.`,
    productNotFound: () => "One of the requested products isn't in the catalog.",
    default: () => "I couldn't confirm the booking for those dates.",
  },
  de: {
    businessHoursViolation: () =>
      'Diese Zeiten liegen außerhalb der Öffnungszeiten des Geschäfts.',
    advanceNoticeViolation: (p) =>
      `Reservierungen müssen mindestens ${spokenDuration(p?.duration, 'de')} im Voraus erfolgen.`,
    minRentalDurationViolation: (p) =>
      `Die Mindestmietdauer beträgt ${spokenDuration(p?.duration, 'de')}.`,
    maxRentalDurationViolation: (p) =>
      `Die maximale Mietdauer beträgt ${spokenDuration(p?.duration, 'de')}.`,
    insufficientStock: (p) =>
      `Es sind nur noch ${str(p?.count)} ${str(p?.name)} für diese Daten verfügbar.`,
    productUnavailable: (p) =>
      `${str(p?.name)} ist für diese Daten nicht verfügbar.`,
    productNoLongerAvailable: (p) =>
      `${str(p?.name)} wurde gerade von jemand anderem für diese Daten gebucht.`,
    productNotFound: () =>
      'Eines der angefragten Produkte ist nicht im Katalog.',
    default: () => 'Ich konnte die Buchung für diese Daten nicht bestätigen.',
  },
  es: {
    businessHoursViolation: () =>
      'Ese horario está fuera del horario de apertura de la tienda.',
    advanceNoticeViolation: (p) =>
      `Las reservas deben hacerse con al menos ${spokenDuration(p?.duration, 'es')} de antelación.`,
    minRentalDurationViolation: (p) =>
      `La duración mínima de alquiler es de ${spokenDuration(p?.duration, 'es')}.`,
    maxRentalDurationViolation: (p) =>
      `La duración máxima de alquiler es de ${spokenDuration(p?.duration, 'es')}.`,
    insufficientStock: (p) =>
      `Solo quedan ${str(p?.count)} ${str(p?.name)} para esas fechas.`,
    productUnavailable: (p) =>
      `${str(p?.name)} no está disponible para esas fechas.`,
    productNoLongerAvailable: (p) =>
      `${str(p?.name)} acaba de ser reservado por otra persona para esas fechas.`,
    productNotFound: () =>
      'Uno de los productos solicitados no está en el catálogo.',
    default: () => 'No pude confirmar la reserva para esas fechas.',
  },
  it: {
    businessHoursViolation: () =>
      "Quegli orari sono fuori dall'orario di apertura del negozio.",
    advanceNoticeViolation: (p) =>
      `Le prenotazioni vanno fatte con almeno ${spokenDuration(p?.duration, 'it')} di anticipo.`,
    minRentalDurationViolation: (p) =>
      `La durata minima del noleggio è di ${spokenDuration(p?.duration, 'it')}.`,
    maxRentalDurationViolation: (p) =>
      `La durata massima del noleggio è di ${spokenDuration(p?.duration, 'it')}.`,
    insufficientStock: (p) =>
      `Restano solo ${str(p?.count)} ${str(p?.name)} per quelle date.`,
    productUnavailable: (p) =>
      `${str(p?.name)} non è disponibile per quelle date.`,
    productNoLongerAvailable: (p) =>
      `${str(p?.name)} è appena stato prenotato da qualcun altro per quelle date.`,
    productNotFound: () => 'Uno dei prodotti richiesti non è nel catalogo.',
    default: () => 'Non sono riuscito a confermare la prenotazione per quelle date.',
  },
  nl: {
    businessHoursViolation: () =>
      'Die tijden vallen buiten de openingstijden van de winkel.',
    advanceNoticeViolation: (p) =>
      `Reserveringen moeten minstens ${spokenDuration(p?.duration, 'nl')} van tevoren worden gemaakt.`,
    minRentalDurationViolation: (p) =>
      `De minimale huurperiode is ${spokenDuration(p?.duration, 'nl')}.`,
    maxRentalDurationViolation: (p) =>
      `De maximale huurperiode is ${spokenDuration(p?.duration, 'nl')}.`,
    insufficientStock: (p) =>
      `Er zijn nog maar ${str(p?.count)} ${str(p?.name)} beschikbaar voor die data.`,
    productUnavailable: (p) =>
      `${str(p?.name)} is niet beschikbaar voor die data.`,
    productNoLongerAvailable: (p) =>
      `${str(p?.name)} is net door iemand anders geboekt voor die data.`,
    productNotFound: () =>
      'Een van de gevraagde producten staat niet in de catalogus.',
    default: () => 'Ik kon de reservering voor die data niet bevestigen.',
  },
  pl: {
    businessHoursViolation: () =>
      'Te godziny są poza godzinami otwarcia sklepu.',
    advanceNoticeViolation: (p) =>
      `Rezerwacji trzeba dokonać co najmniej ${spokenDuration(p?.duration, 'pl')} wcześniej.`,
    minRentalDurationViolation: (p) =>
      `Minimalny czas wynajmu to ${spokenDuration(p?.duration, 'pl')}.`,
    maxRentalDurationViolation: (p) =>
      `Maksymalny czas wynajmu to ${spokenDuration(p?.duration, 'pl')}.`,
    insufficientStock: (p) =>
      `Na te daty zostało tylko ${str(p?.count)} ${str(p?.name)}.`,
    productUnavailable: (p) =>
      `${str(p?.name)} nie jest dostępny w tych terminach.`,
    productNoLongerAvailable: (p) =>
      `${str(p?.name)} został właśnie zarezerwowany przez kogoś innego w tych terminach.`,
    productNotFound: () => 'Jednego z żądanych produktów nie ma w katalogu.',
    default: () => 'Nie udało mi się potwierdzić rezerwacji na te terminy.',
  },
  pt: {
    businessHoursViolation: () =>
      'Esses horários estão fora do horário de funcionamento da loja.',
    advanceNoticeViolation: (p) =>
      `As reservas devem ser feitas com pelo menos ${spokenDuration(p?.duration, 'pt')} de antecedência.`,
    minRentalDurationViolation: (p) =>
      `A duração mínima do aluguer é de ${spokenDuration(p?.duration, 'pt')}.`,
    maxRentalDurationViolation: (p) =>
      `A duração máxima do aluguer é de ${spokenDuration(p?.duration, 'pt')}.`,
    insufficientStock: (p) =>
      `Só restam ${str(p?.count)} ${str(p?.name)} para essas datas.`,
    productUnavailable: (p) =>
      `${str(p?.name)} não está disponível para essas datas.`,
    productNoLongerAvailable: (p) =>
      `${str(p?.name)} acaba de ser reservado por outra pessoa para essas datas.`,
    productNotFound: () => 'Um dos produtos pedidos não está no catálogo.',
    default: () => 'Não consegui confirmar a reserva para essas datas.',
  },
}

/** Strip the `errors.` namespace createReservation prefixes its keys with. */
function shortKey(errorKey: string | undefined): string {
  if (!errorKey) return 'default'
  return errorKey.startsWith('errors.') ? errorKey.slice('errors.'.length) : errorKey
}

/**
 * A spoken-friendly reason for a failed quote/booking, in the caller's language.
 * `errorKey` is what createReservation returns (e.g. 'errors.minRentalDurationViolation'
 * or the short 'productNotFound'); `errorParams` carries its interpolation values.
 * Unknown keys fall back to a generic "couldn't confirm" sentence — never a raw key.
 */
export function describePhoneQuoteError(
  errorKey: string | undefined,
  errorParams: Params,
  language: string,
): string {
  const l = toLang(language)
  const table = REASONS[l]
  const builder = table[shortKey(errorKey)] ?? table.default
  return builder(errorParams)
}
