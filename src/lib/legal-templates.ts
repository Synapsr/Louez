/**
 * Hardcoded legal templates for CGV (Terms) and Legal Notice
 * These templates are not in translation files to keep them lightweight
 * and because legal text should be carefully controlled.
 */

export type SupportedLocale = 'fr' | 'en'

export interface LegalTemplates {
  cgv: string
  legalNotice: string
}

const frenchTemplates: LegalTemplates = {
  cgv: `<h1>Conditions Générales de Vente</h1>
<h2>Article 1 - Objet</h2>
<p>Les présentes conditions générales de vente régissent les relations contractuelles entre [Nom de votre entreprise] et ses clients dans le cadre de la location de matériel.</p>
<h2>Article 2 - Prix</h2>
<p>Les prix indiqués sur le site sont exprimés en euros TTC. Ils comprennent la location du matériel pour la durée sélectionnée.</p>
<h2>Article 3 - Réservation</h2>
<p>La réservation est effective après validation de votre demande par nos services et, le cas échéant, après réception du paiement.</p>
<h2>Article 4 - Caution</h2>
<p>Une caution peut être demandée lors de la remise du matériel. Elle sera restituée au retour du matériel en bon état.</p>
<h2>Article 5 - Retrait et Retour</h2>
<p>Le matériel doit être retiré et retourné aux dates convenues lors de la réservation. Tout retard peut entraîner des frais supplémentaires.</p>
<h2>Article 6 - Responsabilité</h2>
<p>Le locataire est responsable du matériel pendant toute la durée de la location. En cas de perte, vol ou détérioration, le locataire s'engage à indemniser le loueur.</p>
<h2>Article 7 - Annulation</h2>
<p>Toute annulation doit être effectuée au minimum 48h avant la date de début de location. Au-delà, la réservation reste due.</p>
<h2>Article 8 - Litiges</h2>
<p>En cas de litige, les parties s'engagent à rechercher une solution amiable. À défaut, les tribunaux français seront compétents.</p>`,

  legalNotice: `<h1>Mentions Légales</h1>
<h2>Éditeur du site</h2>
<p>[Nom de votre entreprise]<br>[Forme juridique]<br>[Adresse]<br>[Code postal, Ville]<br>[Pays]</p>
<p>Téléphone : [Numéro de téléphone]<br>Email : [Adresse email]</p>
<h2>Directeur de la publication</h2>
<p>[Nom du directeur de publication]</p>
<h2>Hébergement</h2>
<p>Ce site est hébergé par :<br>LumyCloud<br>Quai de la Douane, LE GRAND LARGE<br>29200 BREST<br>France</p>
<h2>Propriété intellectuelle</h2>
<p>L'ensemble du contenu de ce site (textes, images, logos) est protégé par le droit d'auteur. Toute reproduction est interdite sans autorisation préalable.</p>
<h2>Données personnelles</h2>
<p>Conformément au RGPD, vous disposez d'un droit d'accès, de rectification et de suppression de vos données personnelles. Pour exercer ce droit, contactez-nous à l'adresse email indiquée ci-dessus.</p>
<h2>Cookies</h2>
<p>Ce site utilise des cookies pour améliorer votre expérience de navigation. En poursuivant votre navigation, vous acceptez l'utilisation de cookies.</p>`,
}

const englishTemplates: LegalTemplates = {
  cgv: `<h1>Terms and Conditions</h1>
<h2>Article 1 - Purpose</h2>
<p>These terms and conditions govern the contractual relationship between [Your Company Name] and its customers for equipment rental services.</p>
<h2>Article 2 - Pricing</h2>
<p>Prices displayed on the website are in euros including VAT. They include equipment rental for the selected duration.</p>
<h2>Article 3 - Booking</h2>
<p>The booking is confirmed after validation by our services and, if applicable, after receipt of payment.</p>
<h2>Article 4 - Security Deposit</h2>
<p>A security deposit may be required upon equipment handover. It will be returned when the equipment is returned in good condition.</p>
<h2>Article 5 - Pickup and Return</h2>
<p>Equipment must be picked up and returned on the dates agreed upon during booking. Any delay may result in additional charges.</p>
<h2>Article 6 - Liability</h2>
<p>The renter is responsible for the equipment throughout the rental period. In case of loss, theft, or damage, the renter agrees to compensate the lessor.</p>
<h2>Article 7 - Cancellation</h2>
<p>Any cancellation must be made at least 48 hours before the rental start date. After this deadline, the reservation remains due.</p>
<h2>Article 8 - Disputes</h2>
<p>In case of dispute, the parties agree to seek an amicable solution. Failing this, the French courts shall have jurisdiction.</p>`,

  legalNotice: `<h1>Legal Notice</h1>
<h2>Website Publisher</h2>
<p>[Your Company Name]<br>[Legal Form]<br>[Address]<br>[Postal Code, City]<br>[Country]</p>
<p>Phone: [Phone Number]<br>Email: [Email Address]</p>
<h2>Publication Director</h2>
<p>[Name of Publication Director]</p>
<h2>Hosting</h2>
<p>This website is hosted by:<br>LumyCloud<br>Quai de la Douane, LE GRAND LARGE<br>29200 BREST<br>France</p>
<h2>Intellectual Property</h2>
<p>All content on this website (text, images, logos) is protected by copyright. Any reproduction is prohibited without prior authorization.</p>
<h2>Personal Data</h2>
<p>In accordance with GDPR, you have the right to access, rectify, and delete your personal data. To exercise this right, contact us at the email address indicated above.</p>
<h2>Cookies</h2>
<p>This website uses cookies to improve your browsing experience. By continuing to browse, you accept the use of cookies.</p>`,
}

const templates: Record<SupportedLocale, LegalTemplates> = {
  fr: frenchTemplates,
  en: englishTemplates,
}

export function getLegalTemplates(locale: string): LegalTemplates {
  const supportedLocale = (locale === 'en' ? 'en' : 'fr') as SupportedLocale
  return templates[supportedLocale]
}

export function getCgvTemplate(locale: string): string {
  return getLegalTemplates(locale).cgv
}

export function getLegalNoticeTemplate(locale: string): string {
  return getLegalTemplates(locale).legalNotice
}
