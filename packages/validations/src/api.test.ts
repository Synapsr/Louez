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

test('accepts a manual reservation customer reached by phone only', async () => {
  const { dashboardReservationCreateManualReservationInputSchema } =
    await apiSchemas;

  for (const email of [undefined, '', '   ']) {
    const result = dashboardReservationCreateManualReservationInputSchema.parse({
      payload: {
        newCustomer: {
          email,
          firstName: 'Loïc',
          lastName: 'Le Gall',
          phone: '06 12 34 56 78',
        },
        startDate: '2026-07-02T07:00:00.000Z',
        endDate: '2026-07-04T17:00:00.000Z',
        items: [{ productId, quantity: 1 }],
      },
    });

    assert.equal(result.payload.newCustomer?.email, undefined);
    assert.equal(result.payload.newCustomer?.phone, '06 12 34 56 78');
  }
});

test('refuses a manual reservation customer with neither e-mail nor phone', async () => {
  const { dashboardReservationCreateManualReservationInputSchema } =
    await apiSchemas;

  const result = dashboardReservationCreateManualReservationInputSchema.safeParse({
    payload: {
      newCustomer: { email: '', firstName: 'Loïc', lastName: 'Le Gall', phone: ' ' },
      startDate: '2026-07-02T07:00:00.000Z',
      endDate: '2026-07-04T17:00:00.000Z',
      items: [{ productId, quantity: 1 }],
    },
  });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.error?.issues.map((issue) => [issue.path.join('.'), issue.message]),
    [['payload.newCustomer.email', 'validation.contactRequired']],
  );
});

test('refuses a manual reservation customer phone that cannot be dialled', async () => {
  const { dashboardReservationCreateManualReservationInputSchema } =
    await apiSchemas;

  assert.throws(() =>
    dashboardReservationCreateManualReservationInputSchema.parse({
      payload: {
        newCustomer: { firstName: 'Loïc', lastName: 'Le Gall', phone: '12' },
        startDate: '2026-07-02T07:00:00.000Z',
        endDate: '2026-07-04T17:00:00.000Z',
        items: [{ productId, quantity: 1 }],
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
