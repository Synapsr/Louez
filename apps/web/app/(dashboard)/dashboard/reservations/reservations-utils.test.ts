import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Reservation } from './reservations-types';
import { getPaymentStatus } from './reservations-utils';

const createReservation = (overrides: Partial<Reservation>): Reservation => ({
  id: 'reservation-1',
  number: 'R-1',
  status: 'confirmed',
  startDate: new Date('2026-06-01T10:00:00Z'),
  endDate: new Date('2026-06-02T10:00:00Z'),
  subtotalAmount: '100.00',
  depositAmount: '0.00',
  totalAmount: '100.00',
  customer: {
    id: 'customer-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
  },
  items: [
    {
      id: 'item-1',
      quantity: 1,
      isCustomItem: false,
      productSnapshot: { name: 'Videoprojecteur' },
      product: {
        id: 'product-1',
        name: 'Videoprojecteur',
      },
    },
  ],
  payments: [],
  ...overrides,
});

test('reservation list payment status ignores uncollected deposit', () => {
  const status = getPaymentStatus(
    createReservation({
      subtotalAmount: '31.00',
      depositAmount: '200.00',
      totalAmount: '31.00',
      payments: [
        {
          id: 'payment-1',
          amount: '31.00',
          type: 'rental',
          method: 'stripe',
          status: 'completed',
        },
      ],
    }),
  );

  assert.equal(status.status, 'paid');
  assert.equal(status.totalPaid, 31);
  assert.equal(status.totalDue, 31);
});

test('reservation list payment status ignores deposit collections', () => {
  const status = getPaymentStatus(
    createReservation({
      subtotalAmount: '31.00',
      depositAmount: '200.00',
      totalAmount: '31.00',
      payments: [
        {
          id: 'payment-1',
          amount: '200.00',
          type: 'deposit',
          method: 'card',
          status: 'completed',
        },
      ],
    }),
  );

  assert.equal(status.status, 'unpaid');
  assert.equal(status.totalPaid, 0);
  assert.equal(status.depositCollected, 200);
});

test('reservation list payment status keeps partial for rental payments only', () => {
  const status = getPaymentStatus(
    createReservation({
      subtotalAmount: '100.00',
      depositAmount: '200.00',
      totalAmount: '100.00',
      payments: [
        {
          id: 'payment-1',
          amount: '40.00',
          type: 'rental',
          method: 'cash',
          status: 'completed',
        },
        {
          id: 'payment-2',
          amount: '200.00',
          type: 'deposit',
          method: 'card',
          status: 'completed',
        },
      ],
    }),
  );

  assert.equal(status.status, 'partial');
  assert.equal(status.totalPaid, 40);
  assert.equal(status.totalDue, 100);
});

test('reservation list payment status handles legacy totals that included deposit', () => {
  const status = getPaymentStatus(
    createReservation({
      subtotalAmount: '100.00',
      depositAmount: '200.00',
      totalAmount: '300.00',
      payments: [
        {
          id: 'payment-1',
          amount: '100.00',
          type: 'rental',
          method: 'stripe',
          status: 'completed',
        },
      ],
    }),
  );

  assert.equal(status.status, 'paid');
  assert.equal(status.totalDue, 100);
});
