/**
 * Product Templates for Seed Script
 *
 * Realistic bike rental product templates organized by specialty.
 * All prices are in EUR.
 */

export interface ProductTemplate {
  name: string
  description: string
  price: number // per unit (day/hour/week depending on store)
  deposit: number
  quantity: number
  status: 'active' | 'draft' | 'archived'
  category: string
  hasVariants?: boolean
  trackUnits?: boolean
  pricingTiers?: { minDuration: number; discountPercent: number }[]
  unitPrefix?: string // Prefix for unit identifiers (e.g., VL for Vélo Liberté)
}

export interface CategoryTemplate {
  name: string
  description: string
  order: number
}

// ============================================================================
// CITY BIKES (Vélo Liberté)
// ============================================================================

export const CITY_BIKES_CATEGORIES: CategoryTemplate[] = [
  { name: 'Vélos de ville', description: 'Vélos confortables pour vos trajets urbains', order: 0 },
  { name: 'Vélos pliants', description: 'Vélos compacts et pratiques pour les transports', order: 1 },
  { name: 'Vélos hollandais', description: 'Style classique et confort optimal', order: 2 },
  { name: 'Accessoires', description: 'Tout pour compléter votre location', order: 3 },
  { name: 'Équipement sécurité', description: 'Protégez-vous pendant vos trajets', order: 4 },
]

export const CITY_BIKES_PRODUCTS: ProductTemplate[] = [
  // Vélos de ville
  {
    name: 'Vélo de ville classique',
    description: 'Vélo de ville confortable avec panier avant. Idéal pour les trajets quotidiens. Cadre en aluminium léger, 7 vitesses Shimano.',
    price: 15,
    deposit: 150,
    quantity: 8,
    status: 'active',
    category: 'Vélos de ville',
    trackUnits: true,
    unitPrefix: 'VVC',
    pricingTiers: [
      { minDuration: 3, discountPercent: 10 },
      { minDuration: 7, discountPercent: 20 },
      { minDuration: 14, discountPercent: 30 },
    ],
  },
  {
    name: 'Vélo de ville premium',
    description: 'Vélo haut de gamme avec suspension avant et selle ergonomique. Freins à disque hydrauliques, éclairage LED intégré.',
    price: 25,
    deposit: 250,
    quantity: 4,
    status: 'active',
    category: 'Vélos de ville',
    trackUnits: true,
    unitPrefix: 'VVP',
    pricingTiers: [
      { minDuration: 3, discountPercent: 10 },
      { minDuration: 7, discountPercent: 15 },
    ],
  },
  {
    name: 'Vélo de ville femme',
    description: 'Cadre bas pour un enjambement facile. Équipé d\'un panier et d\'un porte-bagages. Parfait pour les balades en ville.',
    price: 15,
    deposit: 150,
    quantity: 6,
    status: 'active',
    category: 'Vélos de ville',
    trackUnits: true,
    unitPrefix: 'VVF',
    pricingTiers: [
      { minDuration: 3, discountPercent: 10 },
      { minDuration: 7, discountPercent: 20 },
    ],
  },
  // Vélos pliants
  {
    name: 'Vélo pliant Brompton',
    description: 'Le célèbre vélo pliant anglais. Se plie en 20 secondes, ultra compact. Idéal pour les trajets multimodaux.',
    price: 35,
    deposit: 500,
    quantity: 3,
    status: 'active',
    category: 'Vélos pliants',
    trackUnits: true,
    unitPrefix: 'VPB',
    pricingTiers: [
      { minDuration: 3, discountPercent: 10 },
      { minDuration: 7, discountPercent: 15 },
    ],
  },
  {
    name: 'Vélo pliant compact',
    description: 'Vélo pliant économique avec roues 20 pouces. 6 vitesses, pliage rapide. Housse de transport incluse.',
    price: 18,
    deposit: 200,
    quantity: 5,
    status: 'active',
    category: 'Vélos pliants',
    trackUnits: true,
    unitPrefix: 'VPC',
  },
  // Vélos hollandais
  {
    name: 'Vélo hollandais tradition',
    description: 'Vélo hollandais authentique avec cadre acier. Position assise droite, très confortable. Carter de chaîne fermé.',
    price: 20,
    deposit: 200,
    quantity: 4,
    status: 'active',
    category: 'Vélos hollandais',
    trackUnits: true,
    unitPrefix: 'VHT',
    pricingTiers: [
      { minDuration: 3, discountPercent: 10 },
      { minDuration: 7, discountPercent: 20 },
    ],
  },
  {
    name: 'Vélo hollandais cargo',
    description: 'Vélo hollandais avec grande caisse avant. Capacité 50kg. Parfait pour les courses ou transporter vos affaires.',
    price: 30,
    deposit: 350,
    quantity: 2,
    status: 'active',
    category: 'Vélos hollandais',
    trackUnits: true,
    unitPrefix: 'VHC',
  },
  // Accessoires
  {
    name: 'Casque adulte',
    description: 'Casque de vélo homologué CE. Tailles S, M, L disponibles. Système de réglage micrométrique.',
    price: 3,
    deposit: 30,
    quantity: 20,
    status: 'active',
    category: 'Accessoires',
    trackUnits: false,
  },
  {
    name: 'Antivol U haute sécurité',
    description: 'Antivol en U certifié ART 2 étoiles. Résistant à la coupe et au crochetage. Câble d\'extension inclus.',
    price: 2,
    deposit: 50,
    quantity: 15,
    status: 'active',
    category: 'Accessoires',
    trackUnits: false,
  },
  {
    name: 'Panier avant amovible',
    description: 'Panier en osier avec fixation rapide. Capacité 5kg. S\'adapte à tous les guidons standards.',
    price: 2,
    deposit: 20,
    quantity: 12,
    status: 'active',
    category: 'Accessoires',
    trackUnits: false,
  },
  {
    name: 'Sacoche vélo imperméable',
    description: 'Sacoche 20L étanche avec bandoulière. Se fixe sur le porte-bagages. Bandes réfléchissantes.',
    price: 4,
    deposit: 40,
    quantity: 10,
    status: 'active',
    category: 'Accessoires',
    trackUnits: false,
  },
  // Équipement sécurité
  {
    name: 'Kit éclairage LED',
    description: 'Éclairage avant et arrière LED rechargeable USB. Autonomie 8h. Plusieurs modes de clignotement.',
    price: 2,
    deposit: 25,
    quantity: 15,
    status: 'active',
    category: 'Équipement sécurité',
    trackUnits: false,
  },
  {
    name: 'Gilet réfléchissant',
    description: 'Gilet haute visibilité conforme EN 1150. Taille unique ajustable. Obligatoire hors agglomération la nuit.',
    price: 1,
    deposit: 10,
    quantity: 20,
    status: 'active',
    category: 'Équipement sécurité',
    trackUnits: false,
  },
  // Brouillon et archivé pour tester ces états
  {
    name: 'Vélo cargo biporteur (bientôt)',
    description: 'Nouveau modèle de vélo cargo à deux roues. En cours de préparation pour la location.',
    price: 40,
    deposit: 400,
    quantity: 2,
    status: 'draft',
    category: 'Vélos hollandais',
    trackUnits: true,
    unitPrefix: 'VCB',
  },
  {
    name: 'Ancien modèle vélo ville',
    description: 'Ancien modèle retiré de la flotte. Plus disponible à la location.',
    price: 12,
    deposit: 100,
    quantity: 0,
    status: 'archived',
    category: 'Vélos de ville',
    trackUnits: false,
  },
]

// ============================================================================
// E-BIKES (E-Ride Pro)
// ============================================================================

export const EBIKES_CATEGORIES: CategoryTemplate[] = [
  { name: 'VAE urbain', description: 'Vélos électriques pour la ville', order: 0 },
  { name: 'VAE trekking', description: 'Vélos électriques pour les longues distances', order: 1 },
  { name: 'VAE pliant', description: 'Vélos électriques compacts', order: 2 },
  { name: 'Speed bikes', description: 'Vélos électriques rapides (45 km/h)', order: 3 },
  { name: 'Accessoires VAE', description: 'Accessoires spécifiques aux vélos électriques', order: 4 },
]

export const EBIKES_PRODUCTS: ProductTemplate[] = [
  // VAE urbain
  {
    name: 'VAE urbain Bosch',
    description: 'Vélo électrique équipé du moteur Bosch Performance Line. Batterie 500Wh, autonomie jusqu\'à 100km. Écran Intuvia.',
    price: 8, // par heure
    deposit: 500,
    quantity: 6,
    status: 'active',
    category: 'VAE urbain',
    trackUnits: true,
    unitPrefix: 'VEB',
    pricingTiers: [
      { minDuration: 4, discountPercent: 10 },
      { minDuration: 8, discountPercent: 20 },
    ],
  },
  {
    name: 'VAE urbain Shimano Steps',
    description: 'Moteur central Shimano Steps E6100. Batterie intégrée 504Wh. Design épuré et silencieux.',
    price: 7,
    deposit: 450,
    quantity: 5,
    status: 'active',
    category: 'VAE urbain',
    trackUnits: true,
    unitPrefix: 'VES',
    pricingTiers: [
      { minDuration: 4, discountPercent: 10 },
      { minDuration: 8, discountPercent: 15 },
    ],
  },
  {
    name: 'VAE urbain entrée de gamme',
    description: 'Vélo électrique abordable avec moteur moyeu arrière. Batterie 400Wh, idéal pour débuter.',
    price: 5,
    deposit: 300,
    quantity: 8,
    status: 'active',
    category: 'VAE urbain',
    trackUnits: true,
    unitPrefix: 'VEE',
  },
  // VAE trekking
  {
    name: 'VAE trekking longue distance',
    description: 'Vélo électrique pour les grandes randonnées. Double batterie 1000Wh, autonomie 200km. Suspension avant.',
    price: 12,
    deposit: 700,
    quantity: 3,
    status: 'active',
    category: 'VAE trekking',
    trackUnits: true,
    unitPrefix: 'VET',
    pricingTiers: [
      { minDuration: 4, discountPercent: 10 },
      { minDuration: 8, discountPercent: 20 },
      { minDuration: 24, discountPercent: 30 },
    ],
  },
  {
    name: 'VAE trekking tout-chemin',
    description: 'Polyvalent route et chemins. Pneus mixtes, porte-bagages robuste. Batterie 625Wh.',
    price: 10,
    deposit: 600,
    quantity: 4,
    status: 'active',
    category: 'VAE trekking',
    trackUnits: true,
    unitPrefix: 'VTC',
  },
  // VAE pliant
  {
    name: 'VAE pliant compact',
    description: 'Vélo électrique pliant en 10 secondes. Roues 20 pouces, batterie amovible 300Wh. Poids 18kg.',
    price: 6,
    deposit: 400,
    quantity: 4,
    status: 'active',
    category: 'VAE pliant',
    trackUnits: true,
    unitPrefix: 'VEP',
  },
  // Speed bikes
  {
    name: 'Speed bike 45 km/h',
    description: 'Vélo électrique rapide homologué cyclomoteur. Vitesse max 45 km/h. Permis AM requis. Casque moto obligatoire.',
    price: 15,
    deposit: 800,
    quantity: 2,
    status: 'active',
    category: 'Speed bikes',
    trackUnits: true,
    unitPrefix: 'VSB',
  },
  // Accessoires VAE
  {
    name: 'Batterie supplémentaire Bosch',
    description: 'Batterie Bosch PowerPack 500Wh compatible tous modèles Bosch. Double votre autonomie.',
    price: 3,
    deposit: 200,
    quantity: 4,
    status: 'active',
    category: 'Accessoires VAE',
    trackUnits: true,
    unitPrefix: 'BAT',
  },
  {
    name: 'Chargeur rapide 4A',
    description: 'Chargeur rapide pour batteries Bosch. Recharge complète en 2h30 au lieu de 4h30.',
    price: 2,
    deposit: 100,
    quantity: 5,
    status: 'active',
    category: 'Accessoires VAE',
    trackUnits: false,
  },
  {
    name: 'Casque VAE homologué',
    description: 'Casque renforcé pour VAE et speed bikes. Certification NTA 8776. Visière intégrée.',
    price: 3,
    deposit: 50,
    quantity: 10,
    status: 'active',
    category: 'Accessoires VAE',
    trackUnits: false,
  },
  {
    name: 'Compteur GPS Garmin',
    description: 'Compteur GPS avec navigation turn-by-turn. Compatible ANT+ et Bluetooth. Autonomie 20h.',
    price: 4,
    deposit: 150,
    quantity: 6,
    status: 'active',
    category: 'Accessoires VAE',
    trackUnits: true,
    unitPrefix: 'GPS',
  },
]

// ============================================================================
// MTB (VTT Aventure)
// ============================================================================

export const MTB_CATEGORIES: CategoryTemplate[] = [
  { name: 'VTT cross-country', description: 'VTT légers pour les sentiers', order: 0 },
  { name: 'VTT all-mountain', description: 'VTT polyvalents montée et descente', order: 1 },
  { name: 'VTT enduro', description: 'VTT orientés descente technique', order: 2 },
  { name: 'VTTAE', description: 'VTT à assistance électrique', order: 3 },
  { name: 'Protection', description: 'Équipement de protection VTT', order: 4 },
]

export const MTB_PRODUCTS: ProductTemplate[] = [
  // VTT cross-country
  {
    name: 'VTT cross-country carbone',
    description: 'VTT XC cadre carbone ultra léger (10.5kg). Fourche Fox 32, transmission Shimano XT 12v.',
    price: 150, // par semaine
    deposit: 800,
    quantity: 3,
    status: 'active',
    category: 'VTT cross-country',
    trackUnits: true,
    unitPrefix: 'XCC',
    pricingTiers: [
      { minDuration: 2, discountPercent: 10 },
      { minDuration: 3, discountPercent: 20 },
    ],
  },
  {
    name: 'VTT cross-country alu',
    description: 'VTT XC cadre aluminium. Fourche RockShox 100mm, transmission Shimano Deore 11v.',
    price: 100,
    deposit: 500,
    quantity: 5,
    status: 'active',
    category: 'VTT cross-country',
    trackUnits: true,
    unitPrefix: 'XCA',
    pricingTiers: [
      { minDuration: 2, discountPercent: 10 },
    ],
  },
  // VTT all-mountain
  {
    name: 'VTT all-mountain 140mm',
    description: 'VTT polyvalent débattement 140mm. Géométrie moderne, roues 29 pouces. Idéal pour tous les terrains.',
    price: 120,
    deposit: 600,
    quantity: 4,
    status: 'active',
    category: 'VTT all-mountain',
    trackUnits: true,
    unitPrefix: 'AMT',
    pricingTiers: [
      { minDuration: 2, discountPercent: 10 },
      { minDuration: 3, discountPercent: 15 },
    ],
  },
  {
    name: 'VTT trail 120mm',
    description: 'VTT trail joueur et léger. Parfait pour les sorties en montagne. Roues 29 pouces.',
    price: 100,
    deposit: 500,
    quantity: 5,
    status: 'active',
    category: 'VTT all-mountain',
    trackUnits: true,
    unitPrefix: 'TRL',
  },
  // VTT enduro
  {
    name: 'VTT enduro 170mm',
    description: 'VTT enduro haute performance. Débattement 170mm, géométrie agressive. Pour les descentes engagées.',
    price: 180,
    deposit: 900,
    quantity: 3,
    status: 'active',
    category: 'VTT enduro',
    trackUnits: true,
    unitPrefix: 'END',
    pricingTiers: [
      { minDuration: 2, discountPercent: 10 },
    ],
  },
  // VTTAE
  {
    name: 'VTTAE Bosch CX',
    description: 'VTT électrique moteur Bosch Performance CX. Batterie 625Wh, débattement 150mm. Parfait pour explorer plus loin.',
    price: 200,
    deposit: 1000,
    quantity: 4,
    status: 'active',
    category: 'VTTAE',
    trackUnits: true,
    unitPrefix: 'VAE',
    pricingTiers: [
      { minDuration: 2, discountPercent: 10 },
      { minDuration: 3, discountPercent: 20 },
    ],
  },
  {
    name: 'VTTAE light',
    description: 'VTTAE léger (18kg) avec moteur Fazua. Batterie amovible 250Wh. Comportement proche d\'un VTT classique.',
    price: 180,
    deposit: 800,
    quantity: 2,
    status: 'active',
    category: 'VTTAE',
    trackUnits: true,
    unitPrefix: 'VEL',
  },
  // Protection
  {
    name: 'Casque intégral DH',
    description: 'Casque intégral pour descente. Mentonnière amovible. Certification ASTM DH.',
    price: 15,
    deposit: 100,
    quantity: 8,
    status: 'active',
    category: 'Protection',
    trackUnits: false,
  },
  {
    name: 'Casque VTT open face',
    description: 'Casque VTT avec protection étendue. Visière réglable, ventilation optimale.',
    price: 10,
    deposit: 60,
    quantity: 12,
    status: 'active',
    category: 'Protection',
    trackUnits: false,
  },
  {
    name: 'Genouillères VTT',
    description: 'Genouillères souples avec coque D3O. Protection niveau 1. Confort toute la journée.',
    price: 8,
    deposit: 50,
    quantity: 15,
    status: 'active',
    category: 'Protection',
    trackUnits: false,
  },
  {
    name: 'Kit protection complet',
    description: 'Casque intégral + genouillères + coudières + dorsale. Pack complet pour la pratique engagée.',
    price: 30,
    deposit: 200,
    quantity: 6,
    status: 'active',
    category: 'Protection',
    trackUnits: false,
  },
  {
    name: 'Sac à dos hydratation',
    description: 'Sac à dos VTT avec poche à eau 2L. Rangement outils et snacks. Dorsale intégrée.',
    price: 8,
    deposit: 60,
    quantity: 10,
    status: 'active',
    category: 'Protection',
    trackUnits: false,
  },
]

// ============================================================================
// FAMILY (Baby Cycle)
// ============================================================================

export const FAMILY_CATEGORIES: CategoryTemplate[] = [
  { name: 'Vélos enfants', description: 'Vélos adaptés aux enfants de tous âges', order: 0 },
  { name: 'Draisiennes', description: 'Vélos sans pédales pour l\'apprentissage', order: 1 },
  { name: 'Sièges et remorques', description: 'Transport sécurisé des tout-petits', order: 2 },
  { name: 'Accessoires famille', description: 'Équipements pour toute la famille', order: 3 },
]

export const FAMILY_PRODUCTS: ProductTemplate[] = [
  // Vélos enfants
  {
    name: 'Vélo enfant 12 pouces',
    description: 'Premier vélo pour les 2-4 ans. Stabilisateurs inclus, garde-boue, panier avant. Hauteur selle 38-48cm.',
    price: 8,
    deposit: 80,
    quantity: 6,
    status: 'active',
    category: 'Vélos enfants',
    trackUnits: false,
  },
  {
    name: 'Vélo enfant 14 pouces',
    description: 'Vélo pour les 3-5 ans. Freins adaptés aux petites mains. Stabilisateurs amovibles.',
    price: 8,
    deposit: 80,
    quantity: 5,
    status: 'active',
    category: 'Vélos enfants',
    trackUnits: false,
  },
  {
    name: 'Vélo enfant 16 pouces',
    description: 'Vélo pour les 4-6 ans. Premier vélo sans stabilisateurs. Léger et maniable.',
    price: 10,
    deposit: 100,
    quantity: 6,
    status: 'active',
    category: 'Vélos enfants',
    trackUnits: false,
  },
  {
    name: 'Vélo enfant 20 pouces',
    description: 'Vélo pour les 6-9 ans. 6 vitesses, freins V-brake. Idéal pour les balades en famille.',
    price: 12,
    deposit: 120,
    quantity: 5,
    status: 'active',
    category: 'Vélos enfants',
    trackUnits: false,
  },
  {
    name: 'Vélo enfant 24 pouces',
    description: 'Vélo pour les 8-12 ans. 7 vitesses Shimano. Style VTT avec garde-boue.',
    price: 14,
    deposit: 140,
    quantity: 4,
    status: 'active',
    category: 'Vélos enfants',
    trackUnits: false,
  },
  // Draisiennes
  {
    name: 'Draisienne bois',
    description: 'Draisienne en bois naturel pour les 18 mois - 3 ans. Développe l\'équilibre naturellement.',
    price: 5,
    deposit: 50,
    quantity: 6,
    status: 'active',
    category: 'Draisiennes',
    trackUnits: false,
  },
  {
    name: 'Draisienne métal',
    description: 'Draisienne légère en aluminium. Pneus gonflables, frein arrière. Pour les 2-5 ans.',
    price: 6,
    deposit: 60,
    quantity: 5,
    status: 'active',
    category: 'Draisiennes',
    trackUnits: false,
  },
  // Sièges et remorques
  {
    name: 'Siège bébé avant',
    description: 'Siège vélo avant pour les 9 mois - 3 ans (max 15kg). Harnais 5 points, repose-pieds.',
    price: 5,
    deposit: 50,
    quantity: 6,
    status: 'active',
    category: 'Sièges et remorques',
    trackUnits: false,
  },
  {
    name: 'Siège bébé arrière',
    description: 'Siège vélo arrière pour les 9 mois - 6 ans (max 22kg). Inclinable, coque protectrice.',
    price: 6,
    deposit: 60,
    quantity: 6,
    status: 'active',
    category: 'Sièges et remorques',
    trackUnits: false,
  },
  {
    name: 'Remorque enfant 1 place',
    description: 'Remorque vélo pour 1 enfant jusqu\'à 6 ans. Convertible en poussette. Capote anti-pluie.',
    price: 18,
    deposit: 200,
    quantity: 3,
    status: 'active',
    category: 'Sièges et remorques',
    trackUnits: false,
  },
  {
    name: 'Remorque enfant 2 places',
    description: 'Remorque vélo pour 2 enfants. Suspension intégrée, rangement arrière. Drapeau de sécurité.',
    price: 25,
    deposit: 300,
    quantity: 2,
    status: 'active',
    category: 'Sièges et remorques',
    trackUnits: false,
  },
  {
    name: 'Barre de remorquage Follow-me',
    description: 'Barre de remorquage pour vélo enfant 20-24 pouces. Permet de tracter l\'enfant fatigué.',
    price: 8,
    deposit: 80,
    quantity: 4,
    status: 'active',
    category: 'Sièges et remorques',
    trackUnits: false,
  },
  // Accessoires famille
  {
    name: 'Casque enfant 3-6 ans',
    description: 'Casque vélo enfant tour de tête 48-52cm. Motifs colorés, ajustement facile.',
    price: 2,
    deposit: 20,
    quantity: 15,
    status: 'active',
    category: 'Accessoires famille',
    trackUnits: false,
  },
  {
    name: 'Casque enfant 6-12 ans',
    description: 'Casque vélo junior tour de tête 52-56cm. Style sportif, ventilation optimale.',
    price: 3,
    deposit: 25,
    quantity: 12,
    status: 'active',
    category: 'Accessoires famille',
    trackUnits: false,
  },
  {
    name: 'Sonnette fun',
    description: 'Sonnette vélo pour enfant. Plusieurs sons rigolos. S\'adapte à tous les guidons.',
    price: 1,
    deposit: 5,
    quantity: 20,
    status: 'active',
    category: 'Accessoires famille',
    trackUnits: false,
  },
]

/**
 * Get products for a specific specialty
 */
export function getProductsForSpecialty(specialty: 'city-bikes' | 'e-bikes' | 'mtb' | 'family'): {
  categories: CategoryTemplate[]
  products: ProductTemplate[]
} {
  switch (specialty) {
    case 'city-bikes':
      return { categories: CITY_BIKES_CATEGORIES, products: CITY_BIKES_PRODUCTS }
    case 'e-bikes':
      return { categories: EBIKES_CATEGORIES, products: EBIKES_PRODUCTS }
    case 'mtb':
      return { categories: MTB_CATEGORIES, products: MTB_PRODUCTS }
    case 'family':
      return { categories: FAMILY_CATEGORIES, products: FAMILY_PRODUCTS }
  }
}

/**
 * Unit notes templates for product units
 */
export const UNIT_NOTES_TEMPLATES = [
  'Cadre bleu foncé',
  'Cadre rouge vif',
  'Cadre noir mat',
  'Cadre blanc',
  'Cadre vert émeraude',
  'Cadre gris métallisé',
  'Rayure légère sur le cadre',
  'Batterie neuve janvier 2025',
  'Révision complète décembre 2024',
  'Pneus neufs',
  'Freins ajustés',
  'Éclairage remplacé',
  'Selle neuve',
  'Poignées changées',
  'Porte-bagages installé',
  'Garde-boue ajouté',
  'Antivol intégré',
]

/**
 * Unit status distribution for seeding
 */
export const UNIT_STATUS_DISTRIBUTION = {
  available: 0.85,
  maintenance: 0.12,
  retired: 0.03,
}
