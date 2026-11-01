'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/tickets');

const NOW = { date: '2026-11-02', minutes: 600 };
const NOW_MS = Date.parse('2026-11-02T10:00:00Z');
const settings = { holdHours: 48, lang: 'en', currency: '$', paymentInfo: 'InstaPay: x@instapay', timezone: 'UTC' };
const event = (o = {}) => ({
  id: 'e1', title: 'Gig', date: '2026-11-10', start: 1200, end: 1380, published: true, salesOpen: true, capacity: 0, venue: 'Hall',
  tickets: [{ id: 'ga', name: 'GA', price: 10, quantity: 5, maxPerOrder: 4 }, { id: 'free', name: 'Free', price: 0, quantity: 0, maxPerOrder: 2 }],
  ...o,
});
const order = (qty, status = 'paid', createdAt = '2026-11-02T09:00:00Z', type = 'ga') => ({ eventId: 'e1', status, createdAt, items: [{ ticketTypeId: type, qty }] });
const build = (input, opts = {}) => T.buildOrder({ customer: { name: 'Ann', phone: '1' }, ...input }, { event: event(opts.event), orders: opts.orders || [], settings, now: opts.now || NOW, nowMs: NOW_MS, admin: opts.admin });

test('availability counts paid and fresh pending orders, not expired or cancelled ones', () => {
  const orders = [order(2), order(1, 'pending'), order(1, 'pending', '2026-10-30T09:00:00Z'), order(1, 'cancelled')];
  const a = T.availability(event(), orders, 48, NOW_MS);
  assert.equal(a.types.ga, 2, '5 - 2 paid - 1 pending');
  assert.equal(a.types.free, null, 'unlimited');
  assert.equal(a.soldOut, false);
  assert.equal(T.isExpired(orders[2], 48, NOW_MS), true);
  assert.equal(T.isExpired(orders[2], 0, NOW_MS), false, '0 = hold forever');
  const capped = T.availability(event({ capacity: 4 }), orders, 48, NOW_MS);
  assert.equal(capped.types.free, 1, 'event capacity limits unlimited types');
  assert.equal(T.availability(event({ tickets: [{ id: 'ga', name: 'GA', price: 1, quantity: 3 }] }), orders, 48, NOW_MS).soldOut, true);
});

test('orders: validation, limits, free vs paid', () => {
  let r = build({ items: [{ ticketTypeId: 'ga', qty: 2 }] });
  assert.equal(r.order.status, 'pending');
  assert.equal(r.order.total, 20);
  assert.equal(r.order.count, 2);
  r = build({ items: [{ ticketTypeId: 'free', qty: 2 }] });
  assert.equal(r.order.status, 'paid', 'free orders are confirmed at once');
  assert.equal(r.order.total, 0);
  assert.equal(build({ items: [{ ticketTypeId: 'ga', qty: 5 }] }).error, 'too_many', 'max per order');
  assert.equal(build({ items: [{ ticketTypeId: 'ga', qty: 3 }] }, { orders: [order(3)] }).error, 'sold_out');
  assert.equal(build({ items: [{ ticketTypeId: 'ga', qty: 3 }] }, { orders: [order(3)] }).left, 2);
  assert.equal(build({ items: [] }).error, 'no_tickets');
  assert.equal(build({ items: [{ ticketTypeId: 'nope', qty: 1 }] }).error, 'no_tickets');
  assert.equal(build({ items: [{ ticketTypeId: 'ga', qty: 1 }], customer: { name: '', phone: '1' } }).error, 'name_required');
  assert.equal(build({ items: [{ ticketTypeId: 'ga', qty: 1 }], customer: { name: 'A', phone: '' } }).error, 'phone_required');
  assert.equal(build({ items: [{ ticketTypeId: 'ga', qty: 1 }], customer: { name: 'A', phone: '1', email: 'bad' } }).error, 'invalid_email');
  assert.equal(build({ items: [{ ticketTypeId: 'ga', qty: 1 }] }, { event: { salesOpen: false } }).error, 'sales_closed');
  assert.equal(build({ items: [{ ticketTypeId: 'ga', qty: 1 }] }, { event: { published: false } }).error, 'sales_closed');
  assert.equal(build({ items: [{ ticketTypeId: 'ga', qty: 1 }] }, { now: { date: '2026-11-11', minutes: 0 } }).error, 'sales_closed', 'after the event');
  const closedType = event({ tickets: [{ id: 'eb', name: 'Early', price: 5, quantity: 0, salesEnd: '2026-11-01' }] });
  assert.equal(T.buildOrder({ items: [{ ticketTypeId: 'eb', qty: 1 }], customer: { name: 'A', phone: '1' } }, { event: closedType, orders: [], settings, now: NOW, nowMs: NOW_MS }).error, 'type_closed');
  // The organizer can add orders by hand past the limits, paid or not.
  r = build({ items: [{ ticketTypeId: 'ga', qty: 5 }], customer: { name: 'Box office' } }, { admin: true, event: { salesOpen: false } });
  assert.equal(r.order.status, 'paid');
  assert.equal(r.order.source, 'admin');
  assert.equal(build({ items: [{ ticketTypeId: 'ga', qty: 6 }], customer: { name: 'X' } }, { admin: true }).error, 'sold_out', 'never oversell');
});

test('tickets: one per seat, validity at the door', () => {
  const o = { id: 'o1', eventId: 'e1', customer: { name: 'Ann' }, items: [{ ticketTypeId: 'ga', name: 'GA', qty: 2 }, { ticketTypeId: 'vip', name: 'VIP', qty: 1 }] };
  const tks = T.ticketsFor(o);
  assert.deepEqual(tks.map((t) => [t.seq, t.typeName, t.holder]), [[1, 'GA', 'Ann'], [2, 'GA', ''], [3, 'VIP', '']]);
  const e = event();
  const tk = { ...tks[0], usedAt: '' };
  assert.equal(T.ticketProblem(tk, { status: 'pending' }, e), 'unpaid');
  assert.equal(T.ticketProblem(tk, { status: 'cancelled' }, e), 'cancelled');
  assert.equal(T.ticketProblem(tk, { status: 'paid' }, { id: 'other' }), 'other_event');
  assert.equal(T.ticketProblem(tk, { status: 'paid' }, e), '');
  assert.equal(T.ticketProblem({ ...tk, usedAt: '2026-11-10T20:00:00Z' }, { status: 'paid' }, e), 'used');
  assert.equal(T.tokenFromCode('https://tix.example.com/t/abcdEFGH1234_-xyz'), 'abcdEFGH1234_-xyz');
  assert.equal(T.tokenFromCode(' abcdEFGH1234 '), 'abcdEFGH1234');
  assert.equal(T.tokenFromCode('javascript:alert(1)'), '');
});

test('event timing', () => {
  const e = event({ date: '2026-11-02', start: 1200, end: 1380 });
  assert.equal(T.hasStarted(e, { date: '2026-11-02', minutes: 1199 }), false);
  assert.equal(T.hasStarted(e, { date: '2026-11-02', minutes: 1200 }), true);
  assert.equal(T.isPast(e, { date: '2026-11-02', minutes: 1300 }), false, 'sales stay open during the event');
  assert.equal(T.isPast(e, { date: '2026-11-02', minutes: 1380 }), true);
  assert.equal(T.isPast(event({ date: '2026-11-02', endDate: '2026-11-04' }), { date: '2026-11-03', minutes: 0 }), false, 'multi-day');
});

test('messages and calendar', () => {
  const e = event();
  const o = { no: 1001, items: [{ name: 'GA', price: 10, qty: 2 }], total: 20, status: 'pending', customer: { name: 'Ann', phone: '1' } };
  const msg = T.orderMessage(o, e, settings, 'https://x/o/abc');
  assert.match(msg, /\*Gig\*/);
  assert.match(msg, /2× GA — \$20/);
  assert.match(msg, /InstaPay: x@instapay/);
  assert.match(msg, /https:\/\/x\/o\/abc/);
  assert.match(T.newOrderMessage(o, e, settings), /New order #1001[\s\S]*not paid yet/);
  const ics = T.ics(e, settings, 'https://x/e/gig');
  assert.match(ics, /DTSTART:20261110T200000Z/);
  assert.match(ics, /DTEND:20261110T230000Z/);
  assert.match(ics, /LOCATION:Hall/);
  assert.equal(T.formatMoney(1500, 'EGP'), '1500 EGP');
});
