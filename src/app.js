'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const QRCode = require('qrcode');

const { Store, defaultSettings, localDate, newId, newToken } = require('./store');
const auth = require('./auth');
const { LANGS, LANGUAGES, adminStrings, strings } = require('./i18n');
const { cleanTheme, cleanFont, appearanceOptions } = require('./theme');
const { validTimezone } = require('./schedule');
const D = require('./dates');
const T = require('./tickets');
const { loadSample, EVENT_TYPES } = require('./sample');
const { resetDemo } = require('./demo');
const notify = require('./notify');
const V = require('./views');
const { toCsv } = require('./csv');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const JSQR = require.resolve('jsqr/dist/jsQR.js');
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|headless/i;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---------- sanitizers ----------
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, max = 1e9) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(max, Math.round(n * 100) / 100) : 0;
};
const int = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const bool = (v) => v === true || v === 'true' || v === 1 || v === 'on';
const imageUrl = (v) => {
  const s = str(v, 500);
  return /^(\/uploads\/[\w.-]+|https?:\/\/\S+)$/i.test(s) ? s : '';
};
const httpUrl = (v) => (/^https?:\/\//i.test(str(v, 500)) ? str(v, 500) : '');
const time = (v, def) => (TIME_RE.test(v) ? D.toMin(v) : Number.isInteger(v) && v >= 0 && v <= 1440 ? v : def);

const SETTINGS_SCHEMA = {
  name: (v) => str(v, 80) || 'My Events',
  tagline: (v) => str(v, 140),
  about: (v) => str(v, 1000),
  logo: imageUrl,
  cover: imageUrl,
  whatsapp: (v) => str(v, 30).replace(/[^\d+]/g, ''),
  phone: (v) => str(v, 30),
  email: (v) => str(v, 120),
  address: (v) => str(v, 200),
  instagram: (v) => str(v, 200),
  facebook: (v) => str(v, 200),
  tiktok: (v) => str(v, 200),
  currency: (v) => str(v, 12),
  lang: (v) => (LANGS.includes(v) ? v : 'en'),
  color: (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v : defaultSettings().color),
  theme: cleanTheme,
  font: cleanFont,
  timezone: validTimezone,
  paymentInfo: (v) => str(v, 400),
  paymentLink: httpUrl,
  holdHours: (v) => int(v, 0, 720, 48),
  policy: (v) => str(v, 800),
};

function cleanSettings(input) {
  const out = {};
  for (const [key, fn] of Object.entries(SETTINGS_SCHEMA)) {
    if (input && Object.prototype.hasOwnProperty.call(input, key)) out[key] = fn(input[key]);
  }
  return out;
}

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/** Cleans an event; keeps ticket types that already have orders. */
function cleanEvent(input, store, existing = null) {
  const date = D.isDate(input.date) ? input.date : '';
  const endDate = D.isDate(input.endDate) && date && input.endDate > date ? input.endDate : '';
  const start = time(input.start, 19 * 60);
  const end = time(input.end, Math.min(1439, start + 120));
  const sold = new Set(existing ? store.orders.filter((o) => o.eventId === existing.id).flatMap((o) => o.items.map((i) => i.ticketTypeId)) : []);
  const tickets = (Array.isArray(input.tickets) ? input.tickets : []).slice(0, 20).map((t) => ({
    id: t && typeof t.id === 'string' && /^[\w-]{4,20}$/.test(t.id) ? t.id : newId(),
    name: str(t && t.name, 60),
    description: str(t && t.description, 200),
    price: num(t && t.price),
    quantity: int(t && t.quantity, 0, 100000, 0),
    maxPerOrder: int(t && t.maxPerOrder, 1, 50, 10),
    salesEnd: D.isDate(t && t.salesEnd) ? t.salesEnd : '',
    hidden: bool(t && t.hidden),
  })).filter((t) => t.name);
  // A ticket type that people already bought can be hidden, never deleted.
  if (existing) {
    for (const old of existing.tickets || []) {
      if (sold.has(old.id) && !tickets.some((t) => t.id === old.id)) tickets.push({ ...old, hidden: true });
    }
  }
  let slug = slugify(input.slug || input.title) || newId().toLowerCase();
  if (store.db.events.some((e) => e.slug === slug && (!existing || e.id !== existing.id))) slug = `${slug}-${newId().slice(0, 4).toLowerCase()}`;
  return {
    title: str(input.title, 120),
    slug,
    subtitle: str(input.subtitle, 160),
    description: str(input.description, 4000),
    date,
    endDate,
    start,
    end,
    venue: str(input.venue, 120),
    address: str(input.address, 200),
    mapUrl: httpUrl(input.mapUrl),
    cover: imageUrl(input.cover),
    emoji: str(input.emoji, 8),
    capacity: int(input.capacity, 0, 1000000, 0),
    published: input.published === undefined ? true : bool(input.published),
    salesOpen: input.salesOpen === undefined ? true : bool(input.salesOpen),
    tickets,
  };
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateSetupCode() {
  const chars = [...crypto.randomBytes(8)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Local numbers ("0101…") borrow the country code from the organizer's WhatsApp number. */
function intlPhone(phone, ownWhatsapp) {
  const raw = String(phone || '').trim();
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  const own = String(ownWhatsapp || '').replace(/\D/g, '');
  if (digits.startsWith('0') && own) {
    const national = digits.slice(1);
    const cc = own.slice(0, own.length - national.length);
    if (cc.length >= 1 && cc.length <= 3) digits = cc + national;
  }
  return digits;
}

function createApp({ dataDir, setupCode, demo = null, quiet = false, clock = null }) {
  const store = new Store(dataDir);
  const app = express();
  const now = () => (clock ? clock() : D.nowIn(store.settings.timezone));
  const nowMs = () => (clock && clock().ms) || Date.now();
  const limit = (windowMs, max) => auth.rateLimiter({ windowMs, max });
  const loginLimited = limit(15 * 60 * 1000, 10);
  const setupLimited = limit(15 * 60 * 1000, 10);
  const orderLimited = limit(10 * 60 * 1000, 15);
  const scanLimited = limit(60 * 1000, 120);

  if (demo) {
    resetDemo(store, demo, now);
    setInterval(() => resetDemo(store, demo, now), demo.resetMinutes * 60 * 1000).unref();
  } else if (!store.db.setupDone) {
    if (setupCode) store.db.setupCode = setupCode;
    else if (!store.db.setupCode) store.db.setupCode = generateSetupCode();
    store.save();
    if (!quiet) {
      console.log('');
      console.log('  ┌──────────────────────────────────────────────┐');
      console.log(`  │  Setup code: ${store.db.setupCode.padEnd(32)}│`);
      console.log('  │  Open /admin in your browser and enter it    │');
      console.log('  │  to set up your events.                      │');
      console.log('  └──────────────────────────────────────────────┘');
      console.log('');
    }
  }

  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  const baseUrl = (req) => `${req.protocol}://${req.get('host')}/`;
  const orderUrl = (req, o) => `${baseUrl(req)}o/${o.token}`;
  const scanUrl = (req, e) => `${baseUrl(req)}scan/${e.scanToken}`;
  const pickLang = (req) => (LANGS.includes(req.query.lang) ? req.query.lang : store.settings.lang);
  const requireAuth = (req, res, next) => (auth.isAuthenticated(req, store.db) ? next() : res.status(401).json({ error: 'unauthorized' }));
  const notInDemo = (req, res, next) => (demo ? res.status(403).json({ error: 'demo' }) : next());
  const requireHeader = (req, res, next) => (req.method === 'GET' || req.get('x-tazkara') === '1' ? next() : res.status(403).json({ error: 'forbidden' }));
  const hold = () => store.settings.holdHours;

  /** Order status as people should see it (an unpaid order past its hold time shows as expired). */
  const orderState = (o) => (T.isExpired(o, hold(), nowMs()) ? 'expired' : o.status);

  function eventStats(e) {
    const orders = store.orders.filter((o) => o.eventId === e.id);
    const paid = orders.filter((o) => o.status === 'paid');
    const pending = orders.filter((o) => o.status === 'pending' && !T.isExpired(o, hold(), nowMs()));
    const tickets = store.tickets.filter((t) => t.eventId === e.id && !t.cancelled);
    const paidIds = new Set(paid.map((o) => o.id));
    const valid = tickets.filter((t) => paidIds.has(t.orderId));
    const avail = T.availability(e, store.orders, hold(), nowMs());
    const totalCap = e.capacity || (e.tickets.every((t) => t.quantity) ? e.tickets.reduce((s, t) => s + t.quantity, 0) : 0);
    return {
      sold: valid.length,
      pending: pending.reduce((s, o) => s + o.count, 0),
      pendingOrders: pending.length,
      revenue: T.round2(paid.reduce((s, o) => s + o.total, 0)),
      checkedIn: valid.filter((t) => t.usedAt).length,
      capacity: totalCap,
      soldOut: avail.soldOut,
      remaining: avail.types,
      byType: e.tickets.map((t) => ({ id: t.id, name: t.name, sold: paid.reduce((s, o) => s + o.items.filter((i) => i.ticketTypeId === t.id).reduce((a, i) => a + i.qty, 0), 0), quantity: t.quantity, left: avail.types[t.id] })),
    };
  }

  const publicEvents = () => store.db.events.filter((e) => e.published).sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);

  /** Check a ticket in (shared by the admin desk and the door scanner). */
  function doCheckIn(ticket, event, by) {
    const order = store.order(ticket.orderId);
    const ev = store.event(ticket.eventId);
    const problem = T.ticketProblem(ticket, order, event);
    const info = {
      ticketId: ticket.id,
      holder: ticket.holder || (order ? order.customer.name : ''),
      typeName: ticket.typeName,
      orderNo: order ? order.no : '',
      seq: ticket.seq,
      of: order ? order.count : 1,
      eventTitle: ev ? ev.title : '',
    };
    if (problem) return { ok: false, reason: problem, usedAt: ticket.usedAt, ...info };
    ticket.usedAt = new Date(nowMs()).toISOString();
    ticket.usedBy = by;
    store.saveList('tickets');
    return { ok: true, reason: '', usedAt: ticket.usedAt, ...info };
  }

  app.use(express.static(PUBLIC_DIR, { maxAge: '1h', index: false }));
  app.use('/uploads', express.static(store.uploadsDir, { maxAge: '30d', immutable: true }));
  app.get('/js/jsqr.js', (req, res) => res.set('Cache-Control', 'public, max-age=86400').type('js').sendFile(JSQR));
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // ---------- public pages ----------
  const countVisit = (req, res) => {
    const today = localDate();
    if (req.query.preview === '1' || BOT_RE.test(req.get('user-agent') || '') || (req.headers.cookie || '').includes(`tz_v=${today}`)) return;
    store.recordVisit(today);
    res.append('Set-Cookie', `tz_v=${today}; Path=/; Max-Age=86400; SameSite=Lax`);
  };

  app.get('/', (req, res) => {
    if (!store.db.setupDone) return res.redirect('/admin');
    countVisit(req, res);
    const n = now();
    const events = publicEvents().map((e) => ({ ...e, stats: eventStats(e), past: T.isPast(e, n) }));
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(V.renderHome({ settings: store.settings, events, lang: pickLang(req), baseUrl: baseUrl(req), now: n, demo: !!demo, preview: req.query.preview === '1', languages: LANGUAGES }));
  });

  app.get('/e/:slug.ics', (req, res) => {
    const e = store.eventBySlug(req.params.slug);
    if (!e || !e.published) return res.status(404).type('text').send('Not found');
    res.setHeader('Content-Disposition', `attachment; filename="${e.slug}.ics"`);
    res.type('text/calendar; charset=utf-8').send(T.ics(e, store.settings, `${baseUrl(req)}e/${e.slug}`));
  });

  app.get('/e/:slug', (req, res) => {
    const e = store.eventBySlug(req.params.slug);
    const authed = auth.isAuthenticated(req, store.db);
    if (!e || (!e.published && !authed)) return res.status(404).type('html').send(V.renderNotFound({ settings: store.settings, lang: pickLang(req) }));
    countVisit(req, res);
    const n = now();
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(
      V.renderEventPage({
        settings: store.settings,
        event: e,
        avail: T.availability(e, store.orders, hold(), nowMs()),
        open: T.salesOpen(e, n),
        past: T.isPast(e, n),
        lang: pickLang(req),
        baseUrl: baseUrl(req),
        now: n,
        demo: !!demo,
        languages: LANGUAGES,
        draft: !e.published,
      })
    );
  });

  async function qrSvg(text) {
    return QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } });
  }

  app.get('/o/:token', async (req, res) => {
    const o = store.orderByToken(req.params.token);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    if (!o) return res.status(404).type('html').send(V.renderNotFound({ settings: store.settings, lang: pickLang(req) }));
    const e = store.event(o.eventId);
    const tickets = await Promise.all(store.ticketsOf(o.id).map(async (t) => ({ ...t, url: `${baseUrl(req)}t/${t.token}`, qr: await qrSvg(`${baseUrl(req)}t/${t.token}`) })));
    res.type('html').send(V.renderOrderPage({ settings: store.settings, order: o, state: orderState(o), event: e, tickets, lang: pickLang(req), baseUrl: baseUrl(req) }));
  });

  app.get('/t/:token', async (req, res) => {
    const t = store.ticketByToken(req.params.token);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    if (!t) return res.status(404).type('html').send(V.renderNotFound({ settings: store.settings, lang: pickLang(req) }));
    const o = store.order(t.orderId);
    const e = store.event(t.eventId);
    const url = `${baseUrl(req)}t/${t.token}`;
    res.type('html').send(V.renderTicketPage({ settings: store.settings, ticket: t, order: o, state: o ? orderState(o) : 'cancelled', event: e, qr: await qrSvg(url), url, lang: pickLang(req), baseUrl: baseUrl(req) }));
  });

  app.get('/scan/:token', (req, res) => {
    const e = store.eventByScanToken(req.params.token);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.status(e ? 200 : 404).type('html').send(V.renderScanPage({ settings: store.settings, event: e, token: e ? e.scanToken : '', lang: pickLang(req), languages: LANGUAGES }));
  });

  app.get('/manifest.webmanifest', (req, res) => res.type('application/manifest+json').send(JSON.stringify(V.renderManifest(store.settings))));
  app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

  // ---------- public API ----------
  const api = express.Router();
  api.use(express.json({ limit: '6mb' }));
  api.use(requireHeader);

  api.get('/i18n/:lang', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ strings: adminStrings(req.params.lang), languages: LANGUAGES });
  });

  api.get('/state', (req, res) => {
    res.json({
      setupDone: store.db.setupDone,
      authed: auth.isAuthenticated(req, store.db),
      lang: store.settings.lang,
      needsSetupCode: !store.db.setupDone,
      demo: demo ? { password: demo.password, resetMinutes: demo.resetMinutes } : null,
      languages: LANGUAGES,
      eventTypes: EVENT_TYPES,
    });
  });

  api.post('/orders', (req, res) => {
    if (orderLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    const b = req.body || {};
    const event = store.event(str(b.eventId, 20));
    if (!event || !event.published) return res.status(404).json({ error: 'invalid_event' });
    const r = T.buildOrder(b, { event, orders: store.orders, settings: store.settings, now: now(), nowMs: nowMs() });
    if (r.error) return res.status(r.error === 'sold_out' ? 409 : 400).json(r);
    const o = store.addOrder(r.order, T.ticketsFor);
    notify.notifyInBackground(store.db.notify, `${T.newOrderMessage(o, event, store.settings)}\n\n🔗 ${baseUrl(req)}admin#orders`);
    const s = store.settings;
    const receipt = T.fill(strings(s.lang).receiptText, { no: o.no, name: o.customer.name, event: event.title });
    res.json({
      no: o.no,
      token: o.token,
      status: o.status,
      total: o.total,
      orderUrl: orderUrl(req, o),
      paymentInfo: o.status === 'pending' ? s.paymentInfo : '',
      paymentLink: o.status === 'pending' ? s.paymentLink : '',
      receiptUrl: o.status === 'pending' && s.whatsapp ? T.whatsappUrl(s.whatsapp, receipt) : '',
    });
  });

  // Buyers can put a friend's name on each ticket before forwarding it.
  api.put('/tickets/:token', (req, res) => {
    const t = store.ticketByToken(req.params.token);
    if (!t) return res.status(404).json({ error: 'not_found' });
    if (t.usedAt) return res.status(400).json({ error: 'used' });
    t.holder = str((req.body || {}).holder, 80);
    store.saveList('tickets');
    res.json({ holder: t.holder });
  });

  // Door scanner: the secret per-event link is the credential.
  const scanEvent = (req, res) => {
    const tok = req.params.token;
    const e = store.db.events.find((x) => x.scanToken && x.scanToken.length === tok.length && crypto.timingSafeEqual(Buffer.from(x.scanToken), Buffer.from(tok)));
    if (!e) res.status(404).json({ error: 'not_found' });
    return e;
  };
  api.get('/scan/:token/stats', (req, res) => {
    const e = scanEvent(req, res);
    if (!e) return;
    const st = eventStats(e);
    res.json({ checkedIn: st.checkedIn, sold: st.sold });
  });
  api.post('/scan/:token/checkin', (req, res) => {
    if (scanLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    const e = scanEvent(req, res);
    if (!e) return;
    const t = store.ticketByToken(T.tokenFromCode((req.body || {}).code));
    if (!t) return res.status(404).json({ error: 'unknown_ticket' });
    const r = doCheckIn(t, e, 'door');
    const st = eventStats(e);
    res.json({ ...r, checkedIn: st.checkedIn, sold: st.sold });
  });

  api.post('/setup', notInDemo, (req, res) => {
    if (store.db.setupDone) return res.status(409).json({ error: 'already_setup' });
    if (setupLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    const b = req.body || {};
    const given = normCode(b.setupCode);
    const expected = normCode(store.db.setupCode);
    if (!given || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
      return res.status(403).json({ error: 'invalid_setup_code' });
    }
    if (typeof b.password !== 'string' || b.password.length < 8) return res.status(400).json({ error: 'weak_password' });
    store.updateSettings(cleanSettings({ name: b.name, whatsapp: b.whatsapp, currency: b.currency, lang: b.lang, timezone: b.timezone }));
    store.db.auth = auth.hashPassword(b.password);
    store.db.setupDone = true;
    delete store.db.setupCode;
    store.save();
    if (bool(b.sample)) loadSample(store, EVENT_TYPES.includes(b.type) ? b.type : 'concert', store.settings.lang, now());
    res.setHeader('Set-Cookie', auth.createSessionCookie(store.db, req.secure));
    res.json({ ok: true });
  });

  api.post('/login', (req, res) => {
    if (loginLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    if (!auth.verifyPassword(req.body && req.body.password, store.db.auth)) return res.status(401).json({ error: 'wrong_password' });
    res.setHeader('Set-Cookie', auth.createSessionCookie(store.db, req.secure));
    res.json({ ok: true });
  });

  api.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', auth.clearSessionCookie());
    res.json({ ok: true });
  });

  // ---------- admin API ----------
  const admin = express.Router();
  admin.use(requireAuth);
  notify.mountRoutes(admin, store, { guard: notInDemo, appName: 'Tazkara' });

  const eventView = (req, e) => ({ ...e, stats: eventStats(e), past: T.isPast(e, now()), url: `${baseUrl(req)}e/${e.slug}`, scanUrl: scanUrl(req, e) });

  admin.get('/data', (req, res) => {
    res.json({
      settings: store.settings,
      events: [...store.db.events].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start).map((e) => eventView(req, e)),
      baseUrl: baseUrl(req),
      now: now(),
      demo: !!demo,
      appearance: appearanceOptions(store.settings.lang),
      pending: store.orders.filter((o) => o.status === 'pending' && !T.isExpired(o, hold(), nowMs())).length,
    });
  });

  admin.put('/settings', (req, res) => {
    const before = { logo: store.settings.logo, cover: store.settings.cover };
    const settings = store.updateSettings(cleanSettings(req.body));
    store.removeUploadIfUnused(before.logo);
    store.removeUploadIfUnused(before.cover);
    res.json({ settings });
  });

  admin.put('/password', notInDemo, (req, res) => {
    const { current, next } = req.body || {};
    if (!auth.verifyPassword(current, store.db.auth)) return res.status(401).json({ error: 'wrong_password' });
    if (typeof next !== 'string' || next.length < 8) return res.status(400).json({ error: 'weak_password' });
    store.db.auth = auth.hashPassword(next);
    store.save();
    res.setHeader('Set-Cookie', auth.createSessionCookie(store.db, req.secure));
    res.json({ ok: true });
  });

  // ---- events ----
  admin.post('/events', (req, res) => {
    const data = cleanEvent(req.body || {}, store);
    if (!data.title) return res.status(400).json({ error: 'title_required' });
    if (!data.date) return res.status(400).json({ error: 'invalid_date' });
    if (!data.tickets.length) return res.status(400).json({ error: 'no_tickets' });
    res.json(eventView(req, store.addEvent(data)));
  });

  admin.put('/events/:id', (req, res) => {
    const e = store.event(req.params.id);
    if (!e) return res.status(404).json({ error: 'not_found' });
    const before = e.cover;
    const data = cleanEvent({ ...e, ...req.body }, store, e);
    if (!data.title) return res.status(400).json({ error: 'title_required' });
    if (!data.date) return res.status(400).json({ error: 'invalid_date' });
    if (!data.tickets.length) return res.status(400).json({ error: 'no_tickets' });
    store.updateEvent(e.id, data);
    if (before && before !== data.cover) store.removeUploadIfUnused(before);
    res.json(eventView(req, e));
  });

  admin.post('/events/:id/duplicate', (req, res) => {
    const e = store.event(req.params.id);
    if (!e) return res.status(404).json({ error: 'not_found' });
    const copy = cleanEvent({ ...e, slug: '', title: `${e.title} (2)`, published: false, tickets: e.tickets.filter((t) => !t.hidden).map((t) => ({ ...t, id: '' })) }, store);
    res.json(eventView(req, store.addEvent(copy)));
  });

  admin.post('/events/:id/scan-reset', notInDemo, (req, res) => {
    const e = store.event(req.params.id);
    if (!e) return res.status(404).json({ error: 'not_found' });
    store.updateEvent(e.id, { scanToken: newToken() });
    res.json(eventView(req, e));
  });

  admin.delete('/events/:id', (req, res) => {
    const e = store.event(req.params.id);
    if (!e) return res.status(404).json({ error: 'not_found' });
    if (store.orders.some((o) => o.eventId === e.id && o.status === 'paid') && (req.body || {}).confirm !== e.slug) return res.status(400).json({ error: 'has_orders' });
    store.removeEvent(e.id);
    store.removeUploadIfUnused(e.cover);
    res.json({ ok: true });
  });

  admin.get('/events/:id/attendees.csv', (req, res) => {
    const e = store.event(req.params.id);
    if (!e) return res.status(404).json({ error: 'not_found' });
    const orders = new Map(store.orders.filter((o) => o.eventId === e.id).map((o) => [o.id, o]));
    const rows = store.tickets
      .filter((t) => t.eventId === e.id)
      .map((t) => {
        const o = orders.get(t.orderId);
        return [o ? o.no : '', t.seq, t.holder || (o ? o.customer.name : ''), o ? o.customer.name : '', o ? o.customer.phone : '', o ? o.customer.email : '', t.typeName, o ? orderState(o) : '', t.cancelled ? 'cancelled' : t.usedAt ? 'checked_in' : '', t.usedAt];
      })
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const csv = toCsv(['order', 'ticket', 'attendee', 'buyer', 'phone', 'email', 'type', 'order_status', 'entry', 'checked_in_at'], rows);
    res.setHeader('Content-Disposition', `attachment; filename="attendees-${e.slug}.csv"`);
    res.type('text/csv; charset=utf-8').send(csv);
  });

  // ---- orders ----
  const orderRow = (o) => {
    const tickets = store.ticketsOf(o.id);
    const e = store.event(o.eventId);
    return { ...o, state: orderState(o), eventTitle: e ? e.title : '', eventDate: e ? e.date : '', used: tickets.filter((t) => t.usedAt).length };
  };

  admin.get('/orders', (req, res) => {
    const ev = str(req.query.event, 20);
    const status = str(req.query.status, 20);
    const q = str(req.query.q, 60).toLowerCase();
    let list = store.orders.filter((o) => !ev || o.eventId === ev).map(orderRow);
    const counts = { all: list.length, pending: 0, paid: 0, cancelled: 0, expired: 0 };
    for (const o of list) counts[o.state]++;
    if (status) list = list.filter((o) => o.state === status);
    if (q) {
      const holders = new Map();
      for (const t of store.tickets) if (t.holder) holders.set(t.orderId, `${holders.get(t.orderId) || ''} ${t.holder}`);
      list = list.filter((o) => `${o.no} ${o.customer.name} ${o.customer.phone} ${o.customer.email} ${holders.get(o.id) || ''}`.toLowerCase().includes(q));
    }
    list.sort((a, b) => b.no - a.no);
    res.json({ orders: list.slice(0, 500), counts, total: list.length });
  });

  admin.get('/orders/:id', (req, res) => {
    const o = store.order(req.params.id);
    if (!o) return res.status(404).json({ error: 'not_found' });
    res.json({ ...orderRow(o), tickets: store.ticketsOf(o.id).map((t) => ({ ...t, url: `${baseUrl(req)}t/${t.token}` })), orderUrl: orderUrl(req, o) });
  });

  admin.post('/orders', (req, res) => {
    const b = req.body || {};
    const event = store.event(str(b.eventId, 20));
    const r = T.buildOrder({ ...b, paid: b.paid !== false && b.paid !== 'false' }, { event, orders: store.orders, settings: store.settings, now: now(), admin: true, nowMs: nowMs() });
    if (r.error) return res.status(r.error === 'sold_out' ? 409 : 400).json(r);
    const o = store.addOrder(r.order, T.ticketsFor);
    res.json({ ...orderRow(o), orderUrl: orderUrl(req, o), whatsappUrl: T.whatsappUrl(intlPhone(o.customer.phone, store.settings.whatsapp), T.orderMessage(o, event, store.settings, orderUrl(req, o))) });
  });

  admin.put('/orders/:id', (req, res) => {
    const o = store.order(req.params.id);
    if (!o) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const patch = {};
    if (b.status !== undefined) {
      if (!T.STATUSES.includes(b.status)) return res.status(400).json({ error: 'invalid_status' });
      patch.status = b.status;
      if (b.status === 'paid' && !o.paidAt) patch.paidAt = new Date(nowMs()).toISOString();
    }
    if (b.notes !== undefined) patch.customer = { ...o.customer, notes: str(b.notes, 500) };
    store.updateOrder(o.id, patch);
    const e = store.event(o.eventId);
    res.json({ ...orderRow(o), whatsappUrl: e ? T.whatsappUrl(intlPhone(o.customer.phone, store.settings.whatsapp), T.orderMessage(o, e, store.settings, orderUrl(req, o))) : '' });
  });

  admin.get('/orders/:id/whatsapp', (req, res) => {
    const o = store.order(req.params.id);
    if (!o) return res.status(404).json({ error: 'not_found' });
    const e = store.event(o.eventId);
    res.json({ url: T.whatsappUrl(intlPhone(o.customer.phone, store.settings.whatsapp), T.orderMessage(o, e, store.settings, orderUrl(req, o))) });
  });

  // ---- check-in at the door (admin) ----
  admin.post('/checkin', (req, res) => {
    const b = req.body || {};
    const e = b.eventId ? store.event(str(b.eventId, 20)) : null;
    const t = b.ticketId ? store.tickets.find((x) => x.id === b.ticketId) : store.ticketByToken(T.tokenFromCode(b.code));
    if (!t) return res.status(404).json({ error: 'unknown_ticket' });
    const r = doCheckIn(t, e, 'desk');
    res.json({ ...r, ...(e ? { checkedIn: eventStats(e).checkedIn, sold: eventStats(e).sold } : {}) });
  });

  admin.delete('/tickets/:id/checkin', (req, res) => {
    const t = store.tickets.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'not_found' });
    t.usedAt = '';
    t.usedBy = '';
    store.saveList('tickets');
    res.json({ ok: true });
  });

  admin.get('/events/:id/checkins', (req, res) => {
    const e = store.event(req.params.id);
    if (!e) return res.status(404).json({ error: 'not_found' });
    const orders = new Map(store.orders.map((o) => [o.id, o]));
    const list = store.tickets
      .filter((t) => t.eventId === e.id && t.usedAt)
      .sort((a, b) => b.usedAt.localeCompare(a.usedAt))
      .slice(0, 50)
      .map((t) => ({ id: t.id, holder: t.holder || (orders.get(t.orderId) || { customer: {} }).customer.name, typeName: t.typeName, usedAt: t.usedAt, usedBy: t.usedBy, orderNo: (orders.get(t.orderId) || {}).no }));
    res.json({ checkins: list, ...eventStats(e) });
  });

  admin.get('/stats', (req, res) => res.json(computeStats(store, now(), nowMs())));
  admin.get('/ping', (req, res) => {
    const pending = store.orders.filter((o) => o.status === 'pending' && !T.isExpired(o, hold(), nowMs()));
    res.json({ pending: pending.length, lastOrder: store.orders.length ? store.orders[store.orders.length - 1].no : 0 });
  });

  admin.post('/upload', (req, res) => {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec((req.body && req.body.dataUrl) || '');
    if (!m) return res.status(400).json({ error: 'invalid_image' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: 'too_large' });
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}.${IMAGE_TYPES[m[1]]}`;
    fs.writeFileSync(path.join(store.uploadsDir, name), buf);
    res.json({ url: `/uploads/${name}` });
  });

  admin.get('/qr.svg', async (req, res) => {
    const svg = await QRCode.toString(str(req.query.text, 500) || baseUrl(req), { type: 'svg', margin: 1, color: { dark: '#111111', light: '#ffffff' } });
    res.type('image/svg+xml').send(svg);
  });

  admin.get('/export', (req, res) => {
    const { settings, events, nextOrderNo } = store.db;
    res.setHeader('Content-Disposition', `attachment; filename="tazkara-backup-${now().date}.json"`);
    res.json({ app: 'tazkara', version: 1, exportedAt: new Date().toISOString(), settings, events, nextOrderNo, orders: store.orders, tickets: store.tickets });
  });

  admin.post('/import', notInDemo, (req, res) => {
    const b = req.body || {};
    if (b.app !== 'tazkara' || !Array.isArray(b.events)) return res.status(400).json({ error: 'invalid_backup' });
    store.db.settings = { ...defaultSettings(), ...cleanSettings(b.settings || {}) };
    store.db.events = [];
    for (const e of b.events) {
      if (!e || !e.id) continue;
      const data = cleanEvent(e, store);
      if (data.title && data.date) store.db.events.push({ id: e.id, scanToken: typeof e.scanToken === 'string' && /^[\w-]{16}$/.test(e.scanToken) ? e.scanToken : newToken(), createdAt: e.createdAt || new Date().toISOString(), ...data, slug: e.slug || data.slug });
    }
    const ids = new Set(store.db.events.map((e) => e.id));
    store.orders = (Array.isArray(b.orders) ? b.orders : []).filter((o) => o && o.id && o.token && ids.has(o.eventId) && T.STATUSES.includes(o.status) && Array.isArray(o.items));
    const orderIds = new Set(store.orders.map((o) => o.id));
    store.tickets = (Array.isArray(b.tickets) ? b.tickets : []).filter((t) => t && t.id && t.token && orderIds.has(t.orderId));
    store.db.nextOrderNo = store.orders.reduce((m, o) => Math.max(m, (o.no || 0) + 1), Number(b.nextOrderNo) || 1001);
    store.save();
    store.saveList('orders');
    store.saveList('tickets');
    res.json({ ok: true });
  });

  api.use('/admin', admin);
  app.use('/api', api);

  app.get('/admin/poster', async (req, res) => {
    if (!auth.isAuthenticated(req, store.db)) return res.redirect('/admin');
    const e = req.query.event ? store.event(str(req.query.event, 20)) : null;
    const url = e ? `${baseUrl(req)}e/${e.slug}` : baseUrl(req);
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1 });
    res.type('html').send(V.renderPoster({ settings: store.settings, event: e, svg, lang: store.settings.lang, url }));
  });

  app.use((req, res) => res.status(404).type('text').send('Not found'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });

  app.locals.store = store;
  app.locals.setupCode = store.db.setupCode;
  app.locals.eventStats = eventStats;
  return app;
}

function computeStats(store, now, nowMs = Date.now()) {
  const hold = store.settings.holdHours;
  const day = (iso) => {
    const n = D.nowIn(store.settings.timezone, new Date(iso));
    return n.date;
  };
  const sinceMs = (days) => nowMs - days * 864e5;
  const paid = store.orders.filter((o) => o.status === 'paid');
  const created = (o) => Date.parse(o.paidAt || o.createdAt);
  const sum = (list) => T.round2(list.reduce((s, o) => s + o.total, 0));
  const count = (list) => list.reduce((s, o) => s + o.count, 0);
  const last30 = paid.filter((o) => created(o) >= sinceMs(30));
  const prev30 = paid.filter((o) => created(o) >= sinceMs(60) && created(o) < sinceMs(30));
  const change = (cur, prev, minPrev) => (prev && prev >= minPrev ? Math.round(((cur - prev) / prev) * 100) : null);
  const pending = store.orders.filter((o) => o.status === 'pending' && !T.isExpired(o, hold, nowMs)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = D.addDays(now.date, -i);
    days.push({ date: d, count: count(paid.filter((o) => day(o.paidAt || o.createdAt) === d)) });
  }
  const upcoming = store.db.events.filter((e) => !T.isPast(e, now)).sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const events = new Map(store.db.events.map((e) => [e.id, e]));
  let visits = 0;
  for (let i = 0; i < 30; i++) visits += store.stats.visits[D.addDays(now.date, -i)] || 0;
  return {
    sold30: count(last30),
    revenue: { month: sum(last30), change: change(sum(last30), sum(prev30), Math.max(1, sum(last30) / 4)) },
    pending: { count: pending.length, amount: sum(pending), list: pending.slice(0, 20).map((o) => ({ ...o, eventTitle: (events.get(o.eventId) || {}).title || '' })) },
    visits: { month: visits },
    days,
    upcomingIds: upcoming.map((e) => e.id),
    recent: [...store.orders].sort((a, b) => b.no - a.no).slice(0, 8).map((o) => ({ ...o, state: T.isExpired(o, hold, nowMs) ? 'expired' : o.status, eventTitle: (events.get(o.eventId) || {}).title || '' })),
    eventsCount: store.db.events.length,
    latestNo: store.orders.reduce((m, o) => Math.max(m, o.no), 0),
  };
}

module.exports = { createApp, intlPhone, generateSetupCode, computeStats, cleanEvent, slugify };
