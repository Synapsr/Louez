// Nucleo Glass icons (https://nucleoapp.com) — the glassmorphism set used for
// dashboard sidebar navigation. Unlike the monochrome barrels these are
// multi-layer SVGs (gradient + blur) that ignore `currentColor`; their palette
// is themed globally through the `--nc-*` CSS variables in styles/globals.css.
//
// License (see /NOTICE): © Nucleo, used under https://nucleoapp.com/license —
// NOT covered by the repository license and requires a valid Nucleo license.
// The most restrictive standard-license project category is capped at 100
// icons, so every icon this app uses must be re-exported from this barrel to
// keep the count auditable. Never copy the SVG sources into the repo; they are
// consumed from Nucleo's official `nucleo-glass` npm package.
export {
  IconBell as NotificationsGlassIcon,
  IconBot as AiAssistantGlassIcon,
  IconBox as ProductGlassIcon,
  IconCalendar as ReservationsGlassIcon,
  IconChartBar as AnalyticsGlassIcon,
  IconCreditCards as BillingGlassIcon,
  IconGear as SettingsGlassIcon,
  IconHelpChat as HelpGlassIcon,
  IconHouse as HomeGlassIcon,
  IconPhone as InstallAppGlassIcon,
  IconSparkle2 as WhatsNewGlassIcon,
  IconTeam as TeamGlassIcon,
  IconUsers as CustomersGlassIcon,
  IconWalletContent as AiCreditsGlassIcon,
  type IconProps as GlassIconProps,
} from "nucleo-glass";
