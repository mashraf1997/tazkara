'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, intlPhone, slugify } = require('../src/app');
const { demoConfig } = require('../src/demo');

const H = { 'Content-Type': 'application/json', 'X-Tazkara': '1' };
let clockNow = { date: '2026-11-02', minutes: 18 * 60 };
let server;
let base;
let dir;
let cookie = '';

async function call(method, url, body, { auth = false, headers = {} } = {}) {
  const res = await fetch(base + url, { method, redirect: 'manual', headers: { ...H, ...(auth ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, headers: res.headers };
}
const admin = (method, url, body) => call(method, `/api/admin${url}`, body, { auth: true });

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tazkara-'));
  const app = createApp({ dataDir: dir, setupCode: 'TEST-CODE', quiet: true, clock: () => clockNow });
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('setup with sample events; public pages list them', async () => {
  assert.equal((await call('GET', '/')).status, 302);
  assert.equal((await call('POST', '/api/setup', { setupCode: 'NOPE-NOPE', name: 'X', password: 'supersecret' })).status, 403);
  const r = await call('POST', '/api/setup', { setupCode: 'test-code', name: 'Stage Eleven', type: 'concert', whatsapp: '201001234567', currency: '$', lang: 'en', password: 'supersecret', sample: true });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
  await admin('PUT', '/settings', { paymentInfo: 'InstaPay: stage@instapay', holdHours: 24 });
  const home = await call('GET', '/');
  assert.match(home.text, /Friday Night Live/);
  assert.match(home.text, /"@type":"Event"/);
  const ev = await call('GET', '/e/night');
  assert.equal(ev.status, 200);
  assert.match(ev.text, /General admission/);
  assert.match(ev.text, /schema.org\/InStock/);
  assert.equal((await call('GET', '/e/nope')).status, 404);
  const ics = await call('GET', '/e/night.ics');
  assert.match(ics.text, /BEGIN:VEVENT/);
});

let night;
test('events: create, validate, keep sold ticket types', async () => {
  const data = (await admin('GET', '/data')).json;
  night = data.events.find((e) => e.slug === 'night');
  assert.match(night.scanUrl, /\/scan\/[\w-]{16}$/);
  assert.equal((await admin('POST', '/events', { title: '', date: '2026-12-01', tickets: [{ name: 'A' }] })).json.error, 'title_required');
  assert.equal((await admin('POST', '/events', { title: 'X', date: 'tomorrow', tickets: [{ name: 'A' }] })).json.error, 'invalid_date');
  assert.equal((await admin('POST', '/events', { title: 'X', date: '2026-12-01', tickets: [] })).json.error, 'no_tickets');
  const made = await admin('POST', '/events', { title: 'Small Workshop', date: '2026-11-20', start: '11:00', end: '13:00', capacity: 3, published: false, tickets: [{ name: 'Seat', price: 50, quantity: 0 }] });
  assert.equal(made.json.slug, 'small-workshop');
  assert.equal(made.json.start, 660);
  assert.equal((await call('GET', '/e/small-workshop')).status, 404, 'drafts are hidden');
  assert.equal((await call('GET', '/e/small-workshop', undefined, { auth: true })).status, 200, 'but the organizer can preview them');
  const dup = await admin('POST', '/events', { title: 'Small Workshop', date: '2026-11-21', tickets: [{ name: 'Seat' }] });
  assert.notEqual(dup.json.slug, 'small-workshop', 'slugs stay unique');
  assert.equal((await admin('DELETE', `/events/${dup.json.id}`)).status, 200);
});

let order;
test('buying paid tickets: pending, payment instructions, then paid', async () => {
  const ga = night.tickets.find((t) => t.price > 0 && t.quantity > 100);
  assert.equal((await call('POST', '/api/orders', { eventId: night.id, items: [{ ticketTypeId: ga.id, qty: 2 }], customer: { name: '', phone: '1' } })).json.error, 'name_required');
  const r = await call('POST', '/api/orders', { eventId: night.id, items: [{ ticketTypeId: ga.id, qty: 2 }], customer: { name: 'Sara Ali', phone: '01011112222', email: 'sara@example.com' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'pending');
  assert.equal(r.json.total, ga.price * 2);
  assert.equal(r.json.paymentInfo, 'InstaPay: stage@instapay');
  assert.match(decodeURIComponent(r.json.receiptUrl), /wa\.me\/201001234567\?text=.*#1001/);
  order = r.json;
  const page = await call('GET', `/o/${order.token}`);
  assert.match(page.text, /Pay \$30 to confirm/);
  assert.match(page.text, /qr-locked/, 'no QR before payment');
  assert.ok(!page.text.includes('<svg xmlns'), 'QR codes are hidden until paid');
  const list = (await admin('GET', `/orders?event=${night.id}&status=pending`)).json;
  const row = list.orders.find((o) => o.no === order.no);
  assert.ok(row);
  const paid = await admin('PUT', `/orders/${row.id}`, { status: 'paid' });
  assert.equal(paid.json.state, 'paid');
  assert.match(decodeURIComponent(paid.json.whatsappUrl), /wa\.me\/201011112222\?text=.*Friday Night Live/);
  const after = await call('GET', `/o/${order.token}`);
  assert.match(after.text, /You're in!/);
  assert.equal((after.text.match(/<svg xmlns/g) || []).length, 2, 'one QR per ticket');
});

test('ticket holders can be renamed; door scanner checks each ticket once', async () => {
  const detail = (await admin('GET', `/orders/${(await admin('GET', `/orders?q=Sara`)).json.orders[0].id}`)).json;
  const [t1, t2] = detail.tickets;
  assert.equal(t1.holder, 'Sara Ali');
  assert.equal((await call('PUT', `/api/tickets/${t2.token}`, { holder: 'Mona Adel' })).json.holder, 'Mona Adel');
  const tpage = await call('GET', `/t/${t2.token}`);
  assert.match(tpage.text, /Mona Adel/);
  assert.match(tpage.headers.get('x-robots-tag'), /noindex/);

  const scanToken = night.scanUrl.split('/scan/')[1];
  assert.equal((await call('GET', `/scan/${scanToken}`)).status, 200);
  assert.equal((await call('GET', '/scan/wrong-token')).status, 404);
  let r = await call('POST', `/api/scan/${scanToken}/checkin`, { code: t1.url });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.holder, 'Sara Ali');
  assert.equal(r.json.checkedIn, 1);
  r = await call('POST', `/api/scan/${scanToken}/checkin`, { code: t1.url });
  assert.equal(r.json.ok, false);
  assert.equal(r.json.reason, 'used');
  assert.ok(r.json.usedAt);
  assert.equal((await call('POST', `/api/scan/${scanToken}/checkin`, { code: 'https://evil/t/doesnotexist123' })).status, 404);
  assert.equal((await call('POST', '/api/scan/badtoken0000000000/checkin', { code: t2.url })).status, 404);
  assert.equal((await call('PUT', `/api/tickets/${t1.token}`, { holder: 'X' })).json.error, 'used', 'used tickets can’t be renamed');
  // A ticket for one event doesn't open another event's door.
  const other = (await admin('GET', '/data')).json.events.find((e) => e.slug === 'acoustic');
  const wrongDoor = await call('POST', `/api/scan/${other.scanUrl.split('/scan/')[1]}/checkin`, { code: t2.url });
  assert.equal(wrongDoor.json.reason, 'other_event');
  // Desk check-in and undo.
  r = await admin('POST', '/checkin', { ticketId: t2.id, eventId: night.id });
  assert.equal(r.json.ok, true);
  assert.equal((await admin('DELETE', `/tickets/${t2.id}/checkin`)).status, 200);
  assert.equal((await admin('GET', `/events/${night.id}/checkins`)).json.checkedIn, 1);
});

test('unpaid tickets are refused; holds expire and free their seats', async () => {
  const small = (await admin('GET', '/data')).json.events.find((e) => e.slug === 'small-workshop');
  await admin('PUT', `/events/${small.id}`, { published: true });
  const seat = small.tickets[0];
  const r = await call('POST', '/api/orders', { eventId: small.id, items: [{ ticketTypeId: seat.id, qty: 3 }], customer: { name: 'Hold', phone: '1' } });
  assert.equal(r.json.status, 'pending', JSON.stringify(r.json));
  assert.equal((await call('POST', '/api/orders', { eventId: small.id, items: [{ ticketTypeId: seat.id, qty: 1 }], customer: { name: 'Late', phone: '1' } })).status, 409, 'capacity 3 is held');
  const det = (await admin('GET', `/orders/${(await admin('GET', '/orders?q=Hold')).json.orders[0].id}`)).json;
  const refused = await admin('POST', '/checkin', { ticketId: det.tickets[0].id, eventId: small.id });
  assert.equal(refused.json.reason, 'unpaid');
  // 25 hours later the 24-hour hold has expired.
  clockNow = { date: '2026-11-03', minutes: 19 * 60, ms: Date.now() + 25 * 3600e3 };
  assert.equal((await admin('GET', '/orders?q=Hold')).json.orders[0].state, 'expired');
  const late = await call('POST', '/api/orders', { eventId: small.id, items: [{ ticketTypeId: seat.id, qty: 1 }], customer: { name: 'Late', phone: '1' } });
  assert.equal(late.status, 200);
  assert.match((await call('GET', `/o/${r.json.token}`)).text, /expired before payment/);
  clockNow = { date: '2026-11-02', minutes: 18 * 60 };
});

test('free events confirm instantly; manual orders; attendee CSV; stats', async () => {
  const meetup = await admin('POST', '/events', { title: 'Free Meetup', date: '2026-11-15', tickets: [{ name: 'RSVP', price: 0, quantity: 0, maxPerOrder: 2 }] });
  const rsvp = meetup.json.tickets[0];
  const r = await call('POST', '/api/orders', { eventId: meetup.json.id, items: [{ ticketTypeId: rsvp.id, qty: 2 }], customer: { name: 'Free Guy', phone: '0102' } });
  assert.equal(r.json.status, 'paid');
  assert.equal((await call('POST', '/api/orders', { eventId: meetup.json.id, items: [{ ticketTypeId: rsvp.id, qty: 3 }], customer: { name: 'Greedy', phone: '1' } })).json.error, 'too_many');
  const manual = await admin('POST', '/orders', { eventId: night.id, items: [{ ticketTypeId: night.tickets[1].id, qty: 2 }], customer: { name: 'Box Office', phone: '' }, paid: true });
  assert.equal(manual.json.state, 'paid');
  assert.equal(manual.json.source, 'admin');
  const res = await fetch(`${base}/api/admin/events/${night.id}/attendees.csv`, { headers: { Cookie: cookie } });
  const csv = await res.text();
  assert.match(csv, /Mona Adel/);
  assert.match(csv, /checked_in/);
  const st = (await admin('GET', '/stats')).json;
  assert.ok(st.sold30 >= 6);
  assert.equal(st.days.length, 14);
  assert.ok(st.recent.length > 0);
  const data = (await admin('GET', '/data')).json;
  const n = data.events.find((e) => e.id === night.id);
  assert.equal(n.stats.sold, 4);
  assert.equal(n.stats.checkedIn, 1);
});

test('editing an event never deletes ticket types people bought', async () => {
  const before = (await admin('GET', '/data')).json.events.find((e) => e.id === night.id);
  const keep = before.tickets.filter((t) => t.price > 0 && t.quantity > 100);
  const r = await admin('PUT', `/events/${night.id}`, { tickets: [{ name: 'New type', price: 5, quantity: 10 }] });
  const ids = r.json.tickets.map((t) => t.id);
  for (const t of keep) {
    assert.ok(ids.includes(t.id), 'sold type kept');
    assert.equal(r.json.tickets.find((x) => x.id === t.id).hidden, true, '…but hidden');
  }
  assert.equal((await admin('DELETE', `/events/${night.id}`)).json.error, 'has_orders');
});

test('cancelled orders invalidate their tickets', async () => {
  const o = (await admin('GET', '/orders?q=Box Office')).json.orders[0];
  await admin('PUT', `/orders/${o.id}`, { status: 'cancelled' });
  const det = (await admin('GET', `/orders/${o.id}`)).json;
  const r = await admin('POST', '/checkin', { ticketId: det.tickets[0].id, eventId: night.id });
  assert.equal(r.json.reason, 'cancelled');
});

test('backup round trip', async () => {
  const backup = (await admin('GET', '/export')).json;
  assert.equal(backup.app, 'tazkara');
  assert.ok(backup.orders.length >= 5);
  await admin('DELETE', `/events/${night.id}`, { confirm: 'night' });
  assert.equal((await call('GET', '/e/night')).status, 404);
  assert.equal((await admin('POST', '/import', backup)).status, 200);
  assert.equal((await call('GET', '/e/night')).status, 200);
  assert.equal((await call('GET', `/o/${order.token}`)).status, 200, 'ticket links survive a restore');
  assert.equal((await admin('POST', '/import', { app: 'nadi' })).status, 400);
});

test('helpers and demo', () => {
  assert.equal(intlPhone('01011112222', '201001234567'), '201011112222');
  assert.equal(slugify('Friday Night Live!'), 'friday-night-live');
  assert.equal(slugify('ليلة الجمعة'), 'ليلة-الجمعة');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tazkara-demo-'));
  const app = createApp({ dataDir: d, demo: demoConfig({ DEMO_MODE: 'true', DEMO_LANG: 'ar' }), quiet: true });
  const store = app.locals.store;
  assert.equal(store.db.events.length, 4);
  assert.ok(store.orders.length > 50);
  const tonight = store.db.events.find((e) => e.slug === 'open-mic');
  assert.ok(app.locals.eventStats(tonight).checkedIn > 0);
  fs.rmSync(d, { recursive: true, force: true });
});
