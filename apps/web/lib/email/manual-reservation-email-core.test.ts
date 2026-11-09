import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import {
  buildManualReservationEmailFromContext,
  MANUAL_RESERVATION_EMAIL_TEMPLATE_IDS,
  type ManualEmailRenderContext,
} from './manual-reservation-email-core'

const context: ManualEmailRenderContext = {
  store: {
    name: 'Ar Mor Location',
    email: 'contact@armor.example',
    phone: '+33 2 98 00 00 00',
    address: '2 quai du Port, 29900 Concarneau',
    theme: { primaryColor: '#0e7490' },
    settings: { currency: 'EUR', country: 'FR', timezone: 'Europe/Paris' },
    emailSettings: null,
  },
  customer: { firstName: 'Tanguy', lastName: 'Girard', email: 'tanguy@example.com' },
  reservation: {
    id: 'res_0000000000000000001',
    number: '2026-0365',
    startDate: '2026-08-06T07:00:00.000Z',
    endDate: '2026-08-09T16:00:00.000Z',
    totalAmount: '1158.00',
    depositAmount: '100.00',
    items: [
      { name: 'Paddle géant', quantity: 2, totalPrice: '458.00' },
      { name: 'Combinaison', quantity: 1, totalPrice: '700.00' },
    ],
  },
  reservationUrl: 'https://armor.example/account/reservations/res_1',
  logoUrl: null,
  showPaymentCta: true,
  contractSigned: true,
}

const build = (
  payload: Parameters<typeof buildManualReservationEmailFromContext>[1],
  options?: Parameters<typeof buildManualReservationEmailFromContext>[2],
) => buildManualReservationEmailFromContext(context, payload, options)

test('every manual template renders a non-empty email addressed to the customer', async () => {
  for (const templateId of MANUAL_RESERVATION_EMAIL_TEMPLATE_IDS) {
    const result = await build({ templateId, customMessage: 'Bonjour !' })

    assert.ok(!('error' in result), `${templateId} returned an error`)
    assert.equal(result.to, 'tanguy@example.com')
    assert.ok(result.subject.length > 0, `${templateId} has an empty subject`)
    assert.match(result.html, /Tanguy/)
  }
})

test('subjects follow the store locale and carry the store name', async () => {
  const contract = await build({ templateId: 'contract' })
  const paymentRequest = await build({ templateId: 'payment_request' })
  const custom = await build({ templateId: 'custom', customMessage: 'Un mot.' })

  assert.ok(!('error' in contract) && !('error' in paymentRequest) && !('error' in custom))
  assert.equal(contract.subject, 'Votre contrat de location #2026-0365 - Ar Mor Location')
  assert.equal(
    paymentRequest.subject,
    'Paiement demandé pour la réservation #2026-0365 - Ar Mor Location',
  )
  assert.equal(custom.subject, 'À propos de votre réservation #2026-0365 - Ar Mor Location')
})

test('a custom subject wins over the default one', async () => {
  for (const templateId of ['contract', 'payment_request', 'custom']) {
    const result = await build({
      templateId,
      customSubject: 'Objet sur mesure',
      customMessage: 'Un mot.',
    })

    assert.ok(!('error' in result))
    assert.equal(result.subject, 'Objet sur mesure')
  }
})

test('only the historically logged templates carry a logTemplateType', async () => {
  const expected: Record<string, string | undefined> = {
    contract: undefined,
    payment_request: undefined,
    reminder_pickup: 'reminder_pickup',
    reminder_return: 'reminder_return',
    access_link: 'instant_access',
    custom: undefined,
  }

  for (const [templateId, logTemplateType] of Object.entries(expected)) {
    const result = await build({ templateId, customMessage: 'Bonjour !' })

    assert.ok(!('error' in result))
    assert.equal(result.logTemplateType, logTemplateType, templateId)
  }
})

test('a custom email without a message is rejected', async () => {
  assert.deepEqual(await build({ templateId: 'custom' }), { error: 'errors.messageRequired' })
  assert.deepEqual(await build({ templateId: 'custom', customMessage: '   ' }), {
    error: 'errors.messageRequired',
  })
})

test('an unknown template id is rejected', async () => {
  assert.deepEqual(await build({ templateId: 'nope' }), { error: 'errors.invalidEmailTemplate' })
})

test('the store owner message is escaped, never injected as markup', async () => {
  const result = await build({
    templateId: 'custom',
    customMessage: '<script>alert("x")</script> & fin',
  })

  assert.ok(!('error' in result))
  assert.doesNotMatch(result.html, /<script>alert/)
  assert.match(result.html, /&lt;script&gt;/)
  assert.match(result.html, /&amp; fin/)
})

test('the payment request asks for the total plus the deposit', async () => {
  const result = await build({ templateId: 'payment_request' })

  assert.ok(!('error' in result))
  // 1158.00 + 100.00, fr-FR formatted (any flavor of space between groups).
  assert.match(result.html, /1\s?[  ]?258,00/u)
  // The manual variant points at the reservation page, not a payment link.
  assert.match(result.html, /Voir ma réservation/)
  assert.doesNotMatch(result.html, /Payer\s/)
})

test('preview falls back to the reservation page where a send mints real links', async () => {
  const preview = await build({ templateId: 'contract' })
  const send = await build(
    { templateId: 'contract' },
    { contractUrl: 'https://armor.example/access/token-123' },
  )

  assert.ok(!('error' in preview) && !('error' in send))
  assert.match(preview.html, /href="https:\/\/armor\.example\/account\/reservations\/res_1"/)
  assert.match(send.html, /href="https:\/\/armor\.example\/access\/token-123"/)
})

test('an unsigned contract turns the contract email and the pickup reminder into a request to sign', async () => {
  const signUrl = 'https://armor.example/r/res_1?token=sign-123'
  const unsigned = { ...context, contractSigned: false }

  for (const templateId of ['contract', 'reminder_pickup']) {
    const signed = await build({ templateId }, { contractSignatureUrl: signUrl })
    const send = await buildManualReservationEmailFromContext(
      unsigned,
      { templateId },
      { contractSignatureUrl: signUrl },
    )

    assert.ok(!('error' in signed) && !('error' in send))
    assert.doesNotMatch(signed.html, /Signer le contrat/, templateId)
    assert.match(send.html, /Signer le contrat/, templateId)
    assert.match(send.html, /href="https:\/\/armor\.example\/r\/res_1\?token=sign-123"/, templateId)
  }

  const contract = await buildManualReservationEmailFromContext(unsigned, { templateId: 'contract' })
  assert.ok(!('error' in contract))
  assert.doesNotMatch(contract.html, /Télécharger le contrat/)
})

test('the shared shell keeps contact info but no postal address in the footer', async () => {
  const result = await build({ templateId: 'contract' })

  assert.ok(!('error' in result))
  assert.match(result.html, /contact@armor\.example/)
  assert.match(result.html, /Propulsé par/)
  assert.doesNotMatch(result.html, /29900 Concarneau/)
})

test('the browser renderer produces the exact html the server sends', async () => {
  // The exports map only exposes ".", so reach the browser build by file URL —
  // this is the very bundle the dashboard preview ships to the client.
  const require = createRequire(import.meta.url)
  const nodeBuildPath = require.resolve('@react-email/render')
  const browserBuildPath = nodeBuildPath.replace('/dist/node/', '/dist/browser/').replace(/\.js$/, '.mjs')
  const browserRender = (await import(pathToFileURL(browserBuildPath).href)) as {
    render: (element: React.ReactElement) => Promise<string>
  }

  const { composeContractEmail, composeReminderPickupEmail } = await import('./compose')

  const composed = [
    composeContractEmail({
      store: context.store,
      customer: context.customer,
      reservationNumber: context.reservation.number,
      contractUrl: context.reservationUrl,
      additionalMessage: 'Pensez au gilet.',
      locale: 'fr',
      logoUrl: null,
    }),
    composeReminderPickupEmail({
      store: context.store,
      customer: context.customer,
      reservation: {
        number: context.reservation.number,
        startDate: new Date(context.reservation.startDate),
      },
      reservationUrl: context.reservationUrl,
      locale: 'fr',
      logoUrl: null,
    }),
  ]

  const { render } = await import('@react-email/render')

  for (const { element } of composed) {
    assert.equal(await browserRender.render(element), await render(element))
  }
})
