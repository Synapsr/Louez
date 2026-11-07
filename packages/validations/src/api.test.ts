import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.SKIP_ENV_VALIDATION = 'true';

const productId = 'qdO2S5tJdj9ZbfSMcp61n';

const apiSchemas = import('./api');

test('accepts supported reservation payment method filters', async () => {
  const { dashboardReservationsListInputSchema } = await apiSchemas;

  for (const paymentMethod of [
    'stripe',
    'cash',
    'card',
    'transfer',
    'check',
    'other',
  ]) {
    const result = dashboardReservationsListInputSchema.parse({ paymentMethod });
    assert.equal(result.paymentMethod, paymentMethod);
  }

  assert.throws(() =>
    dashboardReservationsListInputSchema.parse({ paymentMethod: 'crypto' }),
  );
});

test('normalizes manual reservation customer emails before validation', async () => {
  const { dashboardReservationCreateManualReservationInputSchema } =
    await apiSchemas;
  const result = dashboardReservationCreateManualReservationInputSchema.parse({
    payload: {
      newCustomer: {
        email: ' CELINE@EXAMPLE.COM ',
        firstName: 'celine',
        lastName: 'Toiseux',
      },
      startDate: '2026-07-02T07:00:00.000Z',
      endDate: '2026-07-04T17:00:00.000Z',
      items: [{ productId, quantity: 4 }],
    },
  });

  assert.equal(result.payload.newCustomer?.email, 'celine@example.com');
});

test('keeps rejecting malformed manual reservation customer emails', async () => {
  const { dashboardReservationCreateManualReservationInputSchema } =
    await apiSchemas;

  assert.throws(() =>
    dashboardReservationCreateManualReservationInputSchema.parse({
      payload: {
        newCustomer: {
          email: 'celine@example.',
          firstName: 'celine',
          lastName: 'Toiseux',
        },
        startDate: '2026-07-02T07:00:00.000Z',
        endDate: '2026-07-04T17:00:00.000Z',
        items: [{ productId, quantity: 4 }],
      },
    }),
  );
});

test('normalizes manual Tulip quote preview customer emails', async () => {
  const { dashboardReservationPreviewManualTulipQuoteInputSchema } =
    await apiSchemas;

  const result = dashboardReservationPreviewManualTulipQuoteInputSchema.parse({
    payload: {
      newCustomer: {
        email: ' CELINE@EXAMPLE.COM ',
        firstName: 'celine',
        lastName: 'Toiseux',
      },
      startDate: '2026-07-02T07:00:00.000Z',
      endDate: '2026-07-04T17:00:00.000Z',
      items: [{ productId, quantity: 4 }],
    },
  });

  assert.equal(result.payload.newCustomer?.email, 'celine@example.com');
});

const pngDataUrl = (width: number, height: number, magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) => {
  const header = Buffer.alloc(24);
  Buffer.from(magic).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  const body = Buffer.concat([header, Buffer.alloc(120, 1)]);
  return `data:image/png;base64,${body.toString('base64')}`;
};

test('an in-store signature must be a real PNG of a sensible size', async () => {
  const { dashboardReservationSignInStoreInputSchema } = await apiSchemas;
  const sign = (signature: string) =>
    dashboardReservationSignInStoreInputSchema.safeParse({
      reservationId: productId,
      signerName: 'Tanguy Girard',
      signature,
    }).success;

  assert.equal(sign(pngDataUrl(900, 300)), true);
  assert.equal(sign('data:image/png;base64,'), false);
  assert.equal(sign(`data:image/png;base64,${'A'.repeat(200)}`), false);
  assert.equal(sign(pngDataUrl(900, 300, [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), false);
  assert.equal(sign(pngDataUrl(0, 300)), false);
  assert.equal(sign(pngDataUrl(20_000, 300)), false);
  assert.equal(sign(`${pngDataUrl(900, 300)}<script>`), false);
});
