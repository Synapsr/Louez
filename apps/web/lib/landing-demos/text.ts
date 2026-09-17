import { type Locale, defaultLocale, isLocale } from "@/i18n/config";

// Text the demos show that does not come from the app's messages: fixture data
// (products, categories, activity, notes, the advisor's reply) and the labels of
// the demo host. French is the source; the other languages follow it.
export interface DemoText {
  products: Record<string, string>;
  categories: Record<string, string>;
  depositAuthorized: string;
  paymentReceived: string;
  advisorReply: string;
  customerNotes: string;
  internalNotes: string;
  steps: [string, string, string];
  customer: string;
  owner: string;
  play: string;
  pause: string;
  restart: string;
  toggleMenu: string;
}

const products = {
  fr: {
    "demo-city-bike": "Vélo de ville",
    "demo-electric-bike": "Vélo électrique",
    "demo-child-bike": "Vélo enfant",
    "demo-gravel": "Gravel",
    "demo-mountain": "VTT électrique",
    "demo-cargo": "Vélo cargo",
    "demo-longtail": "Vélo longtail",
    "demo-road": "Vélo de route",
    "demo-trailer": "Remorque enfant",
    "demo-panniers": "Sacoches de randonnée",
    "demo-child-seat": "Siège enfant",
    "demo-touring": "Vélo de randonnée",
  },
  en: {
    "demo-city-bike": "City bike",
    "demo-electric-bike": "Electric bike",
    "demo-child-bike": "Kids' bike",
    "demo-gravel": "Gravel bike",
    "demo-mountain": "Electric mountain bike",
    "demo-cargo": "Cargo bike",
    "demo-longtail": "Longtail bike",
    "demo-road": "Road bike",
    "demo-trailer": "Child trailer",
    "demo-panniers": "Touring panniers",
    "demo-child-seat": "Child seat",
    "demo-touring": "Touring bike",
  },
  de: {
    "demo-city-bike": "Citybike",
    "demo-electric-bike": "E-Bike",
    "demo-child-bike": "Kinderfahrrad",
    "demo-gravel": "Gravelbike",
    "demo-mountain": "E-Mountainbike",
    "demo-cargo": "Lastenrad",
    "demo-longtail": "Longtail-Rad",
    "demo-road": "Rennrad",
    "demo-trailer": "Kinderanhänger",
    "demo-panniers": "Tourentaschen",
    "demo-child-seat": "Kindersitz",
    "demo-touring": "Tourenrad",
  },
  es: {
    "demo-city-bike": "Bicicleta urbana",
    "demo-electric-bike": "Bicicleta eléctrica",
    "demo-child-bike": "Bicicleta infantil",
    "demo-gravel": "Gravel",
    "demo-mountain": "Bicicleta de montaña eléctrica",
    "demo-cargo": "Bicicleta de carga",
    "demo-longtail": "Bicicleta longtail",
    "demo-road": "Bicicleta de carretera",
    "demo-trailer": "Remolque infantil",
    "demo-panniers": "Alforjas de viaje",
    "demo-child-seat": "Silla infantil",
    "demo-touring": "Bicicleta de cicloturismo",
  },
  it: {
    "demo-city-bike": "Bici da città",
    "demo-electric-bike": "Bici elettrica",
    "demo-child-bike": "Bici per bambini",
    "demo-gravel": "Gravel",
    "demo-mountain": "Mountain bike elettrica",
    "demo-cargo": "Cargo bike",
    "demo-longtail": "Bici longtail",
    "demo-road": "Bici da corsa",
    "demo-trailer": "Rimorchio per bambini",
    "demo-panniers": "Borse da viaggio",
    "demo-child-seat": "Seggiolino",
    "demo-touring": "Bici da cicloturismo",
  },
  nl: {
    "demo-city-bike": "Stadsfiets",
    "demo-electric-bike": "Elektrische fiets",
    "demo-child-bike": "Kinderfiets",
    "demo-gravel": "Gravelbike",
    "demo-mountain": "Elektrische mountainbike",
    "demo-cargo": "Bakfiets",
    "demo-longtail": "Longtailfiets",
    "demo-road": "Racefiets",
    "demo-trailer": "Kinderaanhanger",
    "demo-panniers": "Fietstassen",
    "demo-child-seat": "Kinderzitje",
    "demo-touring": "Toerfiets",
  },
  pt: {
    "demo-city-bike": "Bicicleta de cidade",
    "demo-electric-bike": "Bicicleta elétrica",
    "demo-child-bike": "Bicicleta de criança",
    "demo-gravel": "Gravel",
    "demo-mountain": "BTT elétrica",
    "demo-cargo": "Bicicleta de carga",
    "demo-longtail": "Bicicleta longtail",
    "demo-road": "Bicicleta de estrada",
    "demo-trailer": "Atrelado para criança",
    "demo-panniers": "Alforges de viagem",
    "demo-child-seat": "Cadeira de criança",
    "demo-touring": "Bicicleta de cicloturismo",
  },
  pl: {
    "demo-city-bike": "Rower miejski",
    "demo-electric-bike": "Rower elektryczny",
    "demo-child-bike": "Rower dziecięcy",
    "demo-gravel": "Rower gravelowy",
    "demo-mountain": "Elektryczny rower górski",
    "demo-cargo": "Rower cargo",
    "demo-longtail": "Rower longtail",
    "demo-road": "Rower szosowy",
    "demo-trailer": "Przyczepka dziecięca",
    "demo-panniers": "Sakwy turystyczne",
    "demo-child-seat": "Fotelik dziecięcy",
    "demo-touring": "Rower turystyczny",
  },
} satisfies Record<Locale, Record<string, string>>;

const categories = {
  fr: {
    bikes: "Vélos",
    electric: "Vélos électriques",
    family: "En famille",
    accessories: "Accessoires",
  },
  en: { bikes: "Bikes", electric: "Electric bikes", family: "Family", accessories: "Accessories" },
  de: { bikes: "Fahrräder", electric: "E-Bikes", family: "Familie", accessories: "Zubehör" },
  es: {
    bikes: "Bicicletas",
    electric: "Bicicletas eléctricas",
    family: "En familia",
    accessories: "Accesorios",
  },
  it: {
    bikes: "Bici",
    electric: "Bici elettriche",
    family: "In famiglia",
    accessories: "Accessori",
  },
  nl: {
    bikes: "Fietsen",
    electric: "Elektrische fietsen",
    family: "Gezin",
    accessories: "Accessoires",
  },
  pt: {
    bikes: "Bicicletas",
    electric: "Bicicletas elétricas",
    family: "Em família",
    accessories: "Acessórios",
  },
  pl: {
    bikes: "Rowery",
    electric: "Rowery elektryczne",
    family: "Dla rodziny",
    accessories: "Akcesoria",
  },
} satisfies Record<Locale, Record<string, string>>;

const text: Record<Locale, Omit<DemoText, "products" | "categories">> = {
  fr: {
    depositAuthorized: "Empreinte bancaire enregistrée",
    paymentReceived: "Paiement reçu en ligne",
    advisorReply:
      "Pour une balade en ville, je vous conseille le vélo de ville : confortable et facile à prendre en main. Pour quelle date souhaitez-vous le louer ?",
    customerNotes: "Nous passerons à l’ouverture pour profiter de la journée.",
    internalNotes: "Préparer les vélos et vérifier la pression des pneus avant le départ.",
    steps: ["Le client réserve", "Vous préparez", "Tout est suivi"],
    customer: "Client",
    owner: "Loueur",
    play: "Lancer la démo",
    pause: "Pause",
    restart: "Recommencer",
    toggleMenu: "Afficher ou masquer le menu",
  },
  en: {
    depositAuthorized: "Card hold recorded",
    paymentReceived: "Payment received online",
    advisorReply:
      "For a ride around town, I’d suggest the city bike: comfortable and easy to handle. What date would you like to rent it for?",
    customerNotes: "We’ll come by at opening time to make the most of the day.",
    internalNotes: "Prepare the bikes and check the tyre pressure before pickup.",
    steps: ["The customer books", "You prepare", "Everything is tracked"],
    customer: "Customer",
    owner: "Owner",
    play: "Play the demo",
    pause: "Pause",
    restart: "Start over",
    toggleMenu: "Show or hide the menu",
  },
  de: {
    depositAuthorized: "Kartenreservierung erfasst",
    paymentReceived: "Zahlung online erhalten",
    advisorReply:
      "Für eine Fahrt durch die Stadt empfehle ich das Citybike: bequem und leicht zu fahren. Für welches Datum möchten Sie es mieten?",
    customerNotes: "Wir kommen zur Öffnung, um den ganzen Tag zu nutzen.",
    internalNotes: "Räder vorbereiten und vor der Abholung den Reifendruck prüfen.",
    steps: ["Der Kunde bucht", "Sie bereiten vor", "Alles wird verfolgt"],
    customer: "Kunde",
    owner: "Vermieter",
    play: "Demo starten",
    pause: "Pause",
    restart: "Von vorn",
    toggleMenu: "Menü ein- oder ausblenden",
  },
  es: {
    depositAuthorized: "Retención en tarjeta registrada",
    paymentReceived: "Pago recibido en línea",
    advisorReply:
      "Para un paseo por la ciudad, le recomiendo la bicicleta urbana: cómoda y fácil de manejar. ¿Para qué fecha desea alquilarla?",
    customerNotes: "Pasaremos a la hora de apertura para aprovechar el día.",
    internalNotes:
      "Preparar las bicicletas y comprobar la presión de los neumáticos antes de la salida.",
    steps: ["El cliente reserva", "Usted prepara", "Todo queda registrado"],
    customer: "Cliente",
    owner: "Propietario",
    play: "Iniciar la demo",
    pause: "Pausa",
    restart: "Volver a empezar",
    toggleMenu: "Mostrar u ocultar el menú",
  },
  it: {
    depositAuthorized: "Blocco sulla carta registrato",
    paymentReceived: "Pagamento ricevuto online",
    advisorReply:
      "Per un giro in città ti consiglio la bici da città: comoda e facile da guidare. Per quale data vuoi noleggiarla?",
    customerNotes: "Passeremo all’apertura per goderci tutta la giornata.",
    internalNotes: "Preparare le bici e controllare la pressione delle gomme prima della consegna.",
    steps: ["Il cliente prenota", "Tu prepari", "Tutto è tracciato"],
    customer: "Cliente",
    owner: "Noleggiatore",
    play: "Avvia la demo",
    pause: "Pausa",
    restart: "Ricomincia",
    toggleMenu: "Mostra o nascondi il menu",
  },
  nl: {
    depositAuthorized: "Kaartreservering geregistreerd",
    paymentReceived: "Betaling online ontvangen",
    advisorReply:
      "Voor een ritje door de stad raad ik de stadsfiets aan: comfortabel en makkelijk te besturen. Voor welke datum wilt u hem huren?",
    customerNotes: "We komen bij opening langs om de hele dag te benutten.",
    internalNotes: "Fietsen klaarzetten en de bandenspanning controleren voor het ophalen.",
    steps: ["De klant boekt", "U bereidt voor", "Alles wordt gevolgd"],
    customer: "Klant",
    owner: "Verhuurder",
    play: "Demo starten",
    pause: "Pauze",
    restart: "Opnieuw beginnen",
    toggleMenu: "Menu tonen of verbergen",
  },
  pt: {
    depositAuthorized: "Cativação no cartão registada",
    paymentReceived: "Pagamento recebido online",
    advisorReply:
      "Para um passeio pela cidade, aconselho a bicicleta de cidade: confortável e fácil de conduzir. Para que data pretende alugá-la?",
    customerNotes: "Passamos à hora de abertura para aproveitar o dia.",
    internalNotes: "Preparar as bicicletas e verificar a pressão dos pneus antes do levantamento.",
    steps: ["O cliente reserva", "Você prepara", "Tudo fica registado"],
    customer: "Cliente",
    owner: "Locador",
    play: "Iniciar a demonstração",
    pause: "Pausa",
    restart: "Recomeçar",
    toggleMenu: "Mostrar ou ocultar o menu",
  },
  pl: {
    depositAuthorized: "Blokada na karcie zarejestrowana",
    paymentReceived: "Płatność otrzymana online",
    advisorReply:
      "Na przejażdżkę po mieście polecam rower miejski: wygodny i łatwy w prowadzeniu. Na jaki termin chcesz go wypożyczyć?",
    customerNotes: "Przyjdziemy zaraz po otwarciu, żeby wykorzystać cały dzień.",
    internalNotes: "Przygotować rowery i sprawdzić ciśnienie w oponach przed wydaniem.",
    steps: ["Klient rezerwuje", "Ty przygotowujesz", "Wszystko jest śledzone"],
    customer: "Klient",
    owner: "Wypożyczalnia",
    play: "Uruchom demo",
    pause: "Pauza",
    restart: "Od nowa",
    toggleMenu: "Pokaż lub ukryj menu",
  },
};

export const getDemoText = (locale: Locale = defaultLocale): DemoText => ({
  ...text[locale],
  products: products[locale],
  categories: categories[locale],
});

/** The demo language, from the `locale` query parameter; French when absent or unknown. */
export const getDemoLocale = (value: string | string[] | undefined): Locale => {
  const first = Array.isArray(value) ? value[0] : value;
  return isLocale(first) ? first : defaultLocale;
};
