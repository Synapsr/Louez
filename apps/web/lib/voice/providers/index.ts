/**
 * Voice Providers Index
 *
 * Export all available telephony providers from this file. When adding a new
 * provider (e.g. Telnyx):
 *   1. Create the provider file (e.g. telnyx.ts)
 *   2. Export it here
 *   3. Register it in the factory in ../client.ts
 */

export { TwilioVoiceProvider } from './twilio'
