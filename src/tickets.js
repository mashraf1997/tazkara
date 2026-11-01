'use strict';

// Events, orders and tickets.
//
// An event has ticket types (name, price, quantity). A customer places an
// order for some tickets; free orders are confirmed at once, paid orders wait
// as "pending" until the organizer confirms the payment (InstaPay, wallet,
// transfer, payment link…). Pending orders hold their seats for a limited
// time (settings.holdHours), then expire and release them.
// Every ticket in an order has its own QR link, so tickets can be forwarded.

const D = require('./dates');
const { strings } = require('./i18n');

const STATUSES = ['pending', 'paid', 'cancelled'];
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clean = (v, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// ---------- money & labels ----------
const PREFIX_SYMBOLS = ['$', '€', '£', '¥', '₹', '₺', 'R$', 'US$', 'C$', 'A$'];
function formatMoney(amount, currency) {
  const n = round2(amount);
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2);
  if (!currency) return s;
  return PREFIX_SYMBOLS.includes(currency) ? `${currency}${s}` : `${s} ${currency}`;
}

function dateLabel(date, lang, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  try {
    return new Intl.DateTimeFormat(lang, { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  } catch {
    return date;
  }
}

function timeLabel(minutes, lang) {
  const d = new Date(Date.UTC(2024, 0, 1, Math.floor(minutes / 60) % 24, minutes % 60));
  try {
    return new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(d);
  } catch {
    return D.fmtTime(minutes);
  }
}

// ---------- availability ----------

/** Has a pending order run out of time to pay? */
function isExpired(order, holdHours, nowMs = Date.now()) {
  return order.status === 'pending' && holdHours > 0 && nowMs - Date.parse(order.createdAt) > holdHours * 3600e3;
}

/** Orders that currently take seats: paid, plus pending ones still within their hold time. */
const holdsSeats = (order, holdHours, nowMs) => order.status === 'paid' || (order.status === 'pending' && !isExpired(order, holdHours, nowMs));

/** { [ticketTypeId]: taken } and the event total. */
function takenCounts(event, orders, holdHours, nowMs = Date.now()) {
  const byType = {};
  let total = 0;
  for (const o of orders) {
    if (o.eventId !== event.id || !holdsSeats(o, holdHours, nowMs)) continue;
    for (const it of o.items) {
      byType[it.ticketTypeId] = (byType[it.ticketTypeId] || 0) + it.qty;
      total += it.qty;
    }
  }
  return { byType, total };
}

/** Remaining per ticket type (null = unlimited), honouring the event capacity too. */
function availability(event, orders, holdHours, nowMs = Date.now()) {
  const taken = takenCounts(event, orders, holdHours, nowMs);
  const capLeft = event.capacity ? Math.max(0, event.capacity - taken.total) : null;
  const types = {};
  for (const t of event.tickets || []) {
    let left = t.quantity ? Math.max(0, t.quantity - (taken.byType[t.id] || 0)) : null;
    if (capLeft !== null) left = left === null ? capLeft : Math.min(left, capLeft);
    types[t.id] = left;
  }
  const values = Object.values(types);
  const soldOut = values.length > 0 && values.every((v) => v === 0);
  return { types, taken: taken.total, capLeft, soldOut };
}

/** Is the event's start in the past (local time)? */
function hasStarted(event, now) {
  return event.date < now.date || (event.date === now.date && now.minutes >= event.start);
}
/** Is the event completely over? */
function isPast(event, now) {
  const endDate = event.endDate && event.endDate > event.date ? event.endDate : event.date;
  if (endDate !== event.date) return endDate < now.date;
  const end = event.end > event.start ? event.end : 1440;
  return event.date < now.date || (event.date === now.date && now.minutes >= end);
}

function salesOpen(event, now) {
  if (!event.published || event.salesOpen === false) return false;
  return !isPast(event, now);
}

/**
 * Validates an order against live availability.
 * input: { eventId, items: [{ticketTypeId, qty}], customer: {name, phone, email} }
 * Returns { order } or { error }.
 */
function buildOrder(input, { event, orders, settings, now, admin = false, nowMs = Date.now() }) {
  if (!event) return { error: 'invalid_event' };
  if (!admin && !salesOpen(event, now)) return { error: 'sales_closed' };
  const requested = Array.isArray(input.items) ? input.items : [];
  const avail = availability(event, orders, settings.holdHours, nowMs);
  const items = [];
  let count = 0;
  for (const r of requested) {
    const type = (event.tickets || []).find((t) => t.id === String(r && r.ticketTypeId));
    const qty = Math.round(Number(r && r.qty) || 0);
    if (!type || qty <= 0) continue;
    if (!admin && type.hidden) continue;
    if (!admin && type.salesEnd && type.salesEnd < now.date) return { error: 'type_closed', ticketTypeId: type.id };
    const max = type.maxPerOrder || 10;
    if (!admin && qty > max) return { error: 'too_many', ticketTypeId: type.id, max };
    const left = avail.types[type.id];
    if (left !== null && left !== undefined && qty > left) return { error: 'sold_out', ticketTypeId: type.id, left };
    items.push({ ticketTypeId: type.id, name: type.name, price: round2(type.price), qty });
    count += qty;
  }
  if (!items.length) return { error: 'no_tickets' };
  if (count > 50) return { error: 'too_many', max: 50 };
  if (avail.capLeft !== null && count > avail.capLeft) return { error: 'sold_out', left: avail.capLeft };
  const c = input.customer || {};
  const customer = { name: clean(c.name, 80), phone: clean(c.phone, 30), email: clean(c.email, 120).toLowerCase(), notes: clean(c.notes, 500) };
  if (!customer.name) return { error: 'name_required' };
  if (!admin && !customer.phone) return { error: 'phone_required' };
  if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) return { error: 'invalid_email' };
  const total = round2(items.reduce((s, it) => s + it.price * it.qty, 0));
  const paid = admin ? input.paid !== false : total === 0;
  return {
    order: {
      eventId: event.id,
      items,
      count,
      total,
      customer,
      status: paid ? 'paid' : 'pending',
      paidAt: paid ? new Date(nowMs).toISOString() : '',
      source: admin ? 'admin' : 'online',
    },
  };
}

/** One ticket per seat; the first holder is the buyer, the rest can be renamed. */
function ticketsFor(order) {
  const out = [];
  let seq = 0;
  for (const it of order.items) {
    for (let i = 0; i < it.qty; i++) {
      seq++;
      out.push({ orderId: order.id, eventId: order.eventId, ticketTypeId: it.ticketTypeId, typeName: it.name, seq, holder: seq === 1 ? order.customer.name : '', usedAt: '', usedBy: '' });
    }
  }
  return out;
}

/** Why a ticket can't be used right now ('' = it can). */
function ticketProblem(ticket, order, event) {
  if (!order || order.status === 'cancelled' || ticket.cancelled) return 'cancelled';
  if (order.status !== 'paid') return 'unpaid';
  if (event && ticket.eventId !== event.id) return 'other_event';
  if (ticket.usedAt) return 'used';
  return '';
}

/** Pulls a ticket token out of a scanned QR (full URL or bare token). */
function tokenFromCode(code) {
  const raw = String(code || '').trim();
  const m = /\/t\/([\w-]{8,40})/.exec(raw);
  if (m) return m[1];
  return /^[\w-]{8,40}$/.test(raw) ? raw : '';
}

// ---------- messages ----------
const fill = (template, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), template);

function whenLine(event, lang) {
  return `${dateLabel(event.date, lang)} · ${timeLabel(event.start, lang)}`;
}

/** Sent to the buyer (WhatsApp) — tickets link, and how to pay if pending. */
function orderMessage(order, event, settings, orderUrl) {
  const t = strings(settings.lang);
  const out = [`🎟️ *${event.title}*`, `🗓️ ${whenLine(event, settings.lang)}`];
  if (event.venue) out.push(`📍 ${event.venue}`);
  out.push('━━━━━━━━━━');
  for (const it of order.items) out.push(`${it.qty}× ${it.name}${it.price ? ` — ${formatMoney(it.price * it.qty, settings.currency)}` : ''}`);
  if (order.total) out.push(`${t.msgTotal}: ${formatMoney(order.total, settings.currency)}`);
  if (order.status === 'pending') {
    out.push('', `⏳ ${t.msgAwaitingPayment}`);
    if (settings.paymentInfo) out.push(`💳 ${settings.paymentInfo}`);
  }
  out.push('', `${t.msgYourTickets} (#${order.no}):`, orderUrl);
  return out.join('\n');
}

/** Sent to the organizer (Telegram / WhatsApp) when someone orders. */
function newOrderMessage(order, event, settings) {
  const t = strings(settings.lang);
  const out = [`🎟️ *${t.msgNewOrder} #${order.no}*`, `${event.title} · ${dateLabel(event.date, settings.lang, { day: 'numeric', month: 'short' })}`, '━━━━━━━━━━'];
  for (const it of order.items) out.push(`${it.qty}× ${it.name}`);
  if (order.total) out.push(`💰 ${formatMoney(order.total, settings.currency)}${order.status === 'pending' ? ` (${t.msgUnpaid})` : ''}`);
  out.push(`🙋 ${order.customer.name}`);
  if (order.customer.phone) out.push(`📞 ${order.customer.phone}`);
  return out.join('\n');
}

function whatsappUrl(number, text) {
  const digits = String(number || '').replace(/\D/g, '');
  const q = `text=${encodeURIComponent(text)}`;
  return digits ? `https://wa.me/${digits}?${q}` : `https://wa.me/?${q}`;
}

// ---------- calendar file ----------
function zonedToUtc(date, minutes, timezone) {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const n = D.nowIn(timezone, new Date(guess));
    const [ny, nm, nd] = n.date.split('-').map(Number);
    const seen = Date.UTC(ny, nm - 1, nd, Math.floor(n.minutes / 60), n.minutes % 60);
    guess += wall - seen;
  }
  return new Date(guess);
}
const icsDate = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s) => String(s || '').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');

function ics(event, settings, url) {
  const start = zonedToUtc(event.date, event.start, settings.timezone);
  const endDate = event.endDate && event.endDate > event.date ? event.endDate : event.date;
  const endMin = event.end > event.start || endDate !== event.date ? event.end : Math.min(1439, event.start + 120);
  const end = zonedToUtc(endDate, endMin, settings.timezone);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tazkara//Tickets//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@tazkara`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(event.title)}`,
    `DESCRIPTION:${icsText(url)}`,
    event.venue || event.address ? `LOCATION:${icsText([event.venue, event.address].filter(Boolean).join(', '))}` : '',
    'BEGIN:VALARM',
    'TRIGGER:-PT3H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(event.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}

module.exports = {
  STATUSES,
  round2,
  formatMoney,
  dateLabel,
  timeLabel,
  isExpired,
  holdsSeats,
  takenCounts,
  availability,
  hasStarted,
  isPast,
  salesOpen,
  buildOrder,
  ticketsFor,
  ticketProblem,
  tokenFromCode,
  fill,
  whenLine,
  orderMessage,
  newOrderMessage,
  whatsappUrl,
  zonedToUtc,
  ics,
};
