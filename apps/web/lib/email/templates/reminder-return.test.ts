import assert from 'node:assert/strict'
import { test } from 'node:test'
import { render } from '@react-email/render'

import { ReminderReturnEmail } from './reminder-return'

test('uses the actual return date instead of a relative day in the French reminder', async () => {
  const html = await render(
    ReminderReturnEmail({
      storeName: 'VELO RIBINE',
      storeTimezone: 'Europe/Paris',
      customerFirstName: 'Tristan',
      reservationNumber: 'R2604-9070',
      endDate: new Date('2026-07-13T15:00:00.000Z'),
      locale: 'fr',
    }),
  )

  assert.match(html, /Rappel : retour de votre matériel le lundi 13 juillet 2026 à 17:00/)
  assert.match(html, /Le retour du matériel est prévu le lundi 13 juillet 2026 à 17:00\./)
  assert.doesNotMatch(html, /aujourd'hui/)
})
