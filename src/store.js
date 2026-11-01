'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VISIT_DAYS = 120;
// Large, frequently-written lists live in their own files.
const LISTS = ['orders', 'tickets'];

const newId = () => crypto.randomBytes(6).toString('base64url');
const newToken = () => crypto.randomBytes(12).toString('base64url');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`Could not read ${file}: ${err.message}`);
  }
}

// Write to a temp file then rename, so a crash mid-write never corrupts data.
function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function defaultSettings() {
  return {
    name: 'My Events',
    tagline: '',
    about: '',
    logo: '',
    cover: '',
    whatsapp: '',
    phone: '',
    email: '',
    address: '',
    instagram: '',
    facebook: '',
    tiktok: '',
    currency: 'EGP',
    lang: 'ar',
    color: '#7c3aed',
    theme: 'fresh',
    font: 'cairo',
    timezone: '',
    paymentInfo: '',
    paymentLink: '',
    holdHours: 48,
    policy: '',
  };
}

function defaultDb() {
  return {
    version: 1,
    setupDone: false,
    secret: crypto.randomBytes(32).toString('hex'),
    auth: null,
    settings: defaultSettings(),
    events: [],
    nextOrderNo: 1001,
  };
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.uploadsDir = path.join(dir, 'uploads');
    fs.mkdirSync(this.uploadsDir, { recursive: true });
    this.dbFile = path.join(dir, 'db.json');
    this.statsFile = path.join(dir, 'stats.json');

    const db = readJson(this.dbFile);
    this.db = db || defaultDb();
    this.db.settings = { ...defaultSettings(), ...this.db.settings };
    if (!Array.isArray(this.db.events)) this.db.events = [];
    for (const k of LISTS) this[k] = readJson(this.file(k)) || [];
    this.stats = readJson(this.statsFile) || { visits: {} };
    if (!db) this.save();
  }

  file(list) {
    return path.join(this.dir, `${list}.json`);
  }

  save() {
    writeJsonAtomic(this.dbFile, this.db);
  }

  saveList(list) {
    writeJsonAtomic(this.file(list), this[list]);
  }

  get settings() {
    return this.db.settings;
  }

  updateSettings(patch) {
    this.db.settings = { ...this.db.settings, ...patch };
    this.save();
    return this.db.settings;
  }

  /** Wipes everything except the signing secret (demo mode). */
  reset() {
    const { secret } = this.db;
    this.db = defaultDb();
    this.db.secret = secret;
    for (const k of LISTS) this[k] = [];
    this.stats = { visits: {} };
    for (const f of fs.readdirSync(this.uploadsDir)) fs.rmSync(path.join(this.uploadsDir, f), { force: true });
    this.save();
    for (const k of LISTS) this.saveList(k);
    this.flushStats(true);
  }

  // ---- events ----
  event(id) {
    return this.db.events.find((e) => e.id === id) || null;
  }

  eventBySlug(slug) {
    return this.db.events.find((e) => e.slug === slug) || null;
  }

  eventByScanToken(token) {
    return (token && this.db.events.find((e) => e.scanToken === token)) || null;
  }

  addEvent(data) {
    const e = { id: newId(), scanToken: newToken(), createdAt: new Date().toISOString(), ...data };
    this.db.events.push(e);
    this.save();
    return e;
  }

  updateEvent(id, data) {
    const e = this.event(id);
    if (!e) return null;
    Object.assign(e, data, { updatedAt: new Date().toISOString() });
    this.save();
    return e;
  }

  removeEvent(id) {
    const e = this.event(id);
    if (!e) return null;
    this.db.events = this.db.events.filter((x) => x.id !== id);
    this.orders = this.orders.filter((o) => o.eventId !== id);
    this.tickets = this.tickets.filter((t) => t.eventId !== id);
    this.save();
    for (const k of LISTS) this.saveList(k);
    return e;
  }

  // ---- orders & tickets ----
  order(id) {
    return this.orders.find((o) => o.id === id) || null;
  }

  orderByToken(token) {
    return (token && this.orders.find((o) => o.token === token)) || null;
  }

  ticketByToken(token) {
    return (token && this.tickets.find((t) => t.token === token)) || null;
  }

  ticketsOf(orderId) {
    return this.tickets.filter((t) => t.orderId === orderId).sort((a, b) => a.seq - b.seq);
  }

  addOrder(data, tickets, { save = true } = {}) {
    const order = { id: newId(), no: this.db.nextOrderNo++, token: newToken(), createdAt: new Date().toISOString(), ...data };
    this.orders.push(order);
    for (const t of tickets(order)) this.tickets.push({ id: newId(), token: newToken(), ...t });
    if (save) {
      this.save();
      for (const k of LISTS) this.saveList(k);
    }
    return order;
  }

  updateOrder(id, data) {
    const o = this.order(id);
    if (!o) return null;
    Object.assign(o, data, { updatedAt: new Date().toISOString() });
    this.saveList('orders');
    return o;
  }

  // ---- visits to the public page (written at most every few seconds) ----
  recordVisit(date = localDate()) {
    this.stats.visits[date] = (this.stats.visits[date] || 0) + 1;
    this.statsDirty = true;
    if (!this.statsTimer) {
      this.statsTimer = setTimeout(() => this.flushStats(), 5000);
      this.statsTimer.unref();
    }
  }

  flushStats(force) {
    clearTimeout(this.statsTimer);
    this.statsTimer = null;
    if (!this.statsDirty && !force) return;
    const keep = Object.keys(this.stats.visits).sort().slice(-VISIT_DAYS);
    this.stats.visits = Object.fromEntries(keep.map((k) => [k, this.stats.visits[k]]));
    writeJsonAtomic(this.statsFile, this.stats);
    this.statsDirty = false;
  }

  // ---- uploads ----
  isImageInUse(url) {
    const s = this.db.settings;
    if (s.logo === url || s.cover === url) return true;
    return this.db.events.some((e) => e.cover === url);
  }

  removeUploadIfUnused(url) {
    if (!url || !url.startsWith('/uploads/') || this.isImageInUse(url)) return;
    fs.rm(path.join(this.uploadsDir, path.basename(url)), { force: true }, () => {});
  }
}

module.exports = { Store, defaultSettings, newId, newToken, localDate, LISTS };
