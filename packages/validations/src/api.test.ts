import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.SKIP_ENV_VALIDATION = 'true';

const productId = 'qdO2S5tJdj9ZbfSMcp61n';

const apiSchemas = import('./api');

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
