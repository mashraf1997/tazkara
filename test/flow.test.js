'use strict';

// End-to-end: online payment → order paid → tickets by WhatsApp API + email;
// reminders the day before; backups; white-label; secrets never leave the server.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const mailer = require('../src/mailer');

const H = { 'Content-Type': 'application/json', 'X-Tazkara': '1' };
const realFetch = globalThis.fetch;
const outbound = [];
const mails = [];
let clockNow = { date: '2026-11-02', minutes: 18 * 60 };
let server, base, dir, cookie, store, app;
let brand = { name: '', url: '', hideBranding: false };

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.stripe.com/')) {
    outbound.push({ to: 'stripe', url: u, body: String(opts.body || '') });
    if (u.includes('/v1/checkout/sessions/')) return new Response(JSON.stringify({ id: 'cs_test_1', payment_status: 'paid', amount_total: 3000, currency: 'usd', client_reference_id: lastRef(), payment_intent: 'pi_1' }), { status: 200 });
    return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }), { status: 200 });
  }
  if (u.startsWith('https://graph.facebook.com/')) {
    outbound.push({ to: 'whatsapp', url: u, body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 });
  }
  return realFetch(url, opts);
};
const lastRef = () => Object.keys(store.db.payments.checkouts).pop();
const settle = () => new Promise((r) => setTimeout(r, 60));

async function call(method, url, body, { auth = false, headers = {} } = {}) {
  const res = await realFetch(base + url, { method, redirect: 'manual', headers: { ...H, ...(auth ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, headers: res.headers };
}
const admin = (method, url, body) => call(method, `/api/admin${url}`, body, { auth: true });

before(async () => {
  mailer.setTransportFactory(() => ({ sendMail: async (m) => (mails.push(m), { messageId: `m${mails.length}` }) }));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tazkara-flow-'));
  app = createApp({ dataDir: dir, setupCode: 'TEST-CODE', quiet: true, clock: () => clockNow, branding: () => brand });
  store = app.locals.store;
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await call('POST', '/api/setup', { setupCode: 'test-code', name: 'Stage Eleven', type: 'concert', whatsapp: '201001234567', currency: '$', lang: 'en', password: 'supersecret', sample: true });
  cookie = r.headers.get('set-cookie').split(';')[0];
});
after(() => {
  server.close();
  globalThis.fetch = realFetch;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('connections: settings saved, secrets never returned', async () => {
  assert.equal((await admin('PUT', '/payments', { provider: 'stripe', currency: 'usd', stripeSecret: 'sk_test_abcdefghijkl', stripeWebhookSecret: 'whsec_abcdefghijkl' })).status, 200);
  assert.equal((await admin('PUT', '/whatsapp', { token: 'EAAtoken123', phoneNumberId: '1234567890', language: 'en', templates: { tickets: { enabled: true }, reminder: { enabled: true } } })).status, 200);
  assert.equal((await admin('PUT', '/email', { host: 'smtp.example.com', port: 587, user: 'u', pass: 'smtp-secret', from: 'Stage <tickets@example.com>', ownerEmail: 'owner@example.com', alerts: true })).status, 200);
  const all = JSON.stringify([(await admin('GET', '/payments')).json, (await admin('GET', '/whatsapp')).json, (await admin('GET', '/email')).json, (await admin('GET', '/data')).json]);
  for (const secret of ['sk_test_abcdefghijkl', 'whsec_abcdefghijkl', 'EAAtoken123', 'smtp-secret']) assert.ok(!all.includes(secret), secret);
  const exp = await admin('GET', '/export');
  for (const secret of ['sk_test_abcdefghijkl', 'EAAtoken123', 'smtp-secret']) assert.ok(!exp.text.includes(secret), secret);
});

let order;
test('pay online: checkout → return → tickets delivered once', async () => {
  const night = (await admin('GET', '/data')).json.events.find((e) => e.slug === 'night');
  const r = await call('POST', '/api/orders', { eventId: night.id, items: [{ ticketTypeId: 'night-ga', qty: 2 }], customer: { name: 'Mona Adel', phone: '01001112222', email: 'mona@example.com' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'pending');
  assert.equal(r.json.payOnline, true);
  order = r.json;
  await settle();
  // Payment instructions emailed; owner alerted by email.
  assert.ok(mails.some((m) => m.to === 'mona@example.com' && /Complete your order/.test(m.subject)));
  assert.ok(mails.some((m) => m.to === 'owner@example.com'));
  const page = await call('GET', `/o/${order.token}`);
  assert.match(page.text, /data-pay-online/);

  const co = await call('POST', `/api/orders/${order.token}/checkout`, {});
  assert.equal(co.status, 200);
  assert.equal(co.json.url, 'https://checkout.stripe.com/c/pay/cs_test_1');
  const sent = outbound.find((x) => x.to === 'stripe');
  assert.match(sent.body, /unit_amount%5D=3000|unit_amount\]=3000/);

  mails.length = 0;
  outbound.length = 0;
  const ret = await call('GET', `/pay/return?ref=${lastRef()}&p=stripe&session_id=cs_test_1`);
  assert.equal(ret.status, 302);
  assert.match(ret.headers.get('location'), new RegExp(`/o/${order.token}\\?paid=1`));
  await settle();
  const o = store.orderByToken(order.token);
  assert.equal(o.status, 'paid');
  assert.equal(o.paidVia, 'stripe');
  const waMsg = outbound.find((x) => x.to === 'whatsapp');
  assert.equal(waMsg.body.to, '201001112222');
  assert.equal(waMsg.body.template.name, 'tazkara_tickets');
  const ticketsMail = mails.find((m) => m.to === 'mona@example.com');
  assert.match(ticketsMail.subject, /Your tickets for Friday Night Live/);
  assert.equal(ticketsMail.attachments[0].contentType, 'text/calendar');

  // A webhook for the same payment changes nothing (idempotent).
  const n = outbound.length + mails.length;
  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { payment_status: 'paid', client_reference_id: lastRef(), amount_total: 3000, currency: 'usd', id: 'cs_test_1' } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsec_abcdefghijkl').update(`${t}.${body}`).digest('hex');
  assert.equal((await call('POST', '/webhooks/stripe', body, { headers: { 'Stripe-Signature': `t=${t},v1=${sig}` } })).status, 200);
  assert.equal((await call('POST', '/webhooks/stripe', body, { headers: { 'Stripe-Signature': `t=${t},v1=${'0'.repeat(64)}` } })).status, 400);
  await settle();
  assert.equal(outbound.length + mails.length, n);
  // Paid orders can't be paid again.
  assert.equal((await call('POST', `/api/orders/${order.token}/checkout`, {})).status, 400);
});

test('admin "mark paid" sends the tickets automatically', async () => {
  const night = (await admin('GET', '/data')).json.events.find((e) => e.slug === 'night');
  const r = await call('POST', '/api/orders', { eventId: night.id, items: [{ ticketTypeId: 'night-vip', qty: 1 }], customer: { name: 'Omar', phone: '+201005556666' } });
  const id = store.orderByToken(r.json.token).id;
  outbound.length = 0;
  assert.equal((await admin('PUT', `/orders/${id}`, { status: 'paid' })).status, 200);
  await settle();
  assert.equal(outbound.filter((x) => x.to === 'whatsapp').length, 1);
  assert.equal((await admin('PUT', `/orders/${id}`, { status: 'paid' })).status, 200);
  await settle();
  assert.equal(outbound.filter((x) => x.to === 'whatsapp').length, 1);
});

test('reminders go out once, the day before, after 10:00', async () => {
  const night = store.db.events.find((e) => e.slug === 'night');
  const tomorrow = new Date(Date.parse(`${night.date}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
  clockNow = { date: tomorrow, minutes: 9 * 60 };
  assert.equal(app.locals.runReminders(), 0);
  clockNow = { date: tomorrow, minutes: 11 * 60 };
  outbound.length = 0;
  mails.length = 0;
  assert.equal(app.locals.runReminders(), 2);
  assert.equal(app.locals.runReminders(), 0);
  await settle();
  assert.equal(outbound.filter((x) => x.to === 'whatsapp' && x.body.template.name === 'tazkara_reminder').length, 2);
  assert.ok(mails.some((m) => m.to === 'mona@example.com' && /^Tomorrow/.test(m.subject)));
  clockNow = { date: '2026-11-02', minutes: 18 * 60 };
});

test('backups: run now, list, download without secrets', async () => {
  const r = await admin('POST', '/backups/now');
  assert.equal(r.status, 200);
  assert.equal(r.json.backups.length, 1);
  const file = await admin('GET', `/backups/${r.json.date}`);
  assert.equal(file.status, 200);
  assert.equal(file.json.app, 'tazkara');
  assert.ok(!file.text.includes('sk_test_abcdefghijkl'));
  assert.equal((await admin('GET', '/backups/../../hub')).status, 404);
});

test('white-label: agency name replaces or hides "powered by"', async () => {
  assert.match((await call('GET', '/')).text, /github.com\/mashraf1997\/tazkara/);
  brand = { name: 'Pixel Agency', url: 'https://pixel.example', hideBranding: false };
  const page = (await call('GET', '/')).text;
  assert.match(page, /Pixel Agency/);
  assert.ok(!page.includes('github.com/mashraf1997/tazkara'));
  assert.equal((await call('GET', '/api/state')).json.brand.name, 'Pixel Agency');
  brand = { name: '', url: '', hideBranding: true };
  assert.ok(!(await call('GET', '/')).text.includes('class="powered"'));
});

test('offline door: list has hashed codes only; sync applies scans once', async () => {
  const night = store.db.events.find((e) => e.slug === 'night');
  const tok = night.scanToken;
  const list = await call('GET', `/api/scan/${tok}/list`);
  assert.equal(list.status, 200);
  assert.ok(list.json.tickets.length >= 3);
  const raw = store.tickets.filter((t) => t.eventId === night.id);
  for (const t of raw) assert.ok(!list.text.includes(t.token));
  const h = crypto.createHash('sha256').update(raw[0].token).digest('hex').slice(0, 24);
  assert.ok(list.json.tickets.some((x) => x.h === h));
  assert.equal((await call('GET', '/api/scan/wrongtoken12345/list')).status, 404);

  const fresh = raw.find((t) => !t.usedAt && store.order(t.orderId).status === 'paid');
  const at = new Date(Date.now() - 60000).toISOString();
  const s1 = await call('POST', `/api/scan/${tok}/sync`, { scans: [{ code: `${base}/t/${fresh.token}`, at }, { code: 'nope-nope-nope', at }] });
  assert.equal(s1.status, 200);
  assert.equal(s1.json.results[0].ok, true);
  assert.equal(s1.json.results[1].reason, 'unknown');
  assert.equal(store.ticketByToken(fresh.token).usedAt, at);
  // Same batch again (lost response): still ok, no conflict.
  const s2 = await call('POST', `/api/scan/${tok}/sync`, { scans: [{ code: fresh.token, at }] });
  assert.equal(s2.json.results[0].ok, true);
  assert.equal(s2.json.conflicts, 0);
  // Another door scanned it too: conflict reported.
  const s3 = await call('POST', `/api/scan/${tok}/sync`, { scans: [{ code: fresh.token, at: new Date().toISOString() }] });
  assert.equal(s3.json.conflicts, 1);
});
