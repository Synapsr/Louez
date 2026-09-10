import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { getEmailTranslations, type EmailLocale } from "../i18n";
import { DEFAULT_PRIMARY_COLOR, shell } from "./components/theme";

interface BaseLayoutProps {
  preview: string;
  storeName: string;
  logoUrl?: string | null;
  primaryColor?: string;
  storeEmail?: string | null;
  storePhone?: string | null;
  storeAddress?: string | null;
  locale?: EmailLocale;
  children: React.ReactNode;
}

/**
 * The shared shell of every store-branded email, laid out like a letter: the
 * store logo (or its name as a wordmark) centred over a narrow column, the
 * message, and the store contact plus the Louez mention on the grey footer
 * band. The store's primary color is reserved for the CTA, so the shell stays
 * neutral whatever the palette. The postal address deliberately stays out of
 * the footer: it appears in the body of the emails where the customer needs it.
 */
export function BaseLayout({
  preview,
  storeName,
  logoUrl,
  primaryColor: _primaryColor = DEFAULT_PRIMARY_COLOR,
  storeEmail,
  storePhone,
  locale = "fr",
  children,
}: BaseLayoutProps) {
  const t = getEmailTranslations(locale);
  const baseLayout = t.baseLayout;

  const contactParts = [
    storeEmail && (
      <Link key="email" href={`mailto:${storeEmail}`} style={shell.footerLink}>
        {storeEmail}
      </Link>
    ),
    storePhone && (
      <Link key="phone" href={`tel:${storePhone}`} style={shell.footerLink}>
        {storePhone}
      </Link>
    ),
  ].filter(Boolean);

  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={shell.body}>
        <Section style={shell.page}>
          <Container style={shell.container}>
            <Section style={shell.header}>
              {logoUrl ? (
                <Img src={logoUrl} alt={storeName} height={32} style={shell.logo} />
              ) : (
                <Text style={shell.wordmark}>{storeName}</Text>
              )}
            </Section>
            <Section style={shell.content}>{children}</Section>
          </Container>
        </Section>

        <Section style={shell.footerBand}>
          <Container style={shell.container}>
            <Text style={shell.footerStrong}>
              {storeName}
              {contactParts.map((part, index) => (
                <span key={index}>
                  {" · "}
                  {part}
                </span>
              ))}
            </Text>
            <Text style={shell.footerText}>
              {baseLayout.sentBy.replace("{storeName}", storeName)}. {baseLayout.ignoreIfNotYou}
            </Text>
            <Text style={shell.footerText}>
              {baseLayout.poweredBy}{" "}
              <Link href="https://louez.io" style={shell.footerLink}>
                Louez.io
              </Link>
            </Text>
          </Container>
        </Section>
      </Body>
    </Html>
  );
}
