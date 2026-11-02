'use strict';

const { strings } = require('./i18n');
const { cleanTheme, fontHref, fontStack, hueFor } = require('./theme');
const D = require('./dates');
const T = require('./tickets');

const VERSION = require('../package.json').version;
const ICONS = `/img/icons.svg?v=${VERSION}`;

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineJson(data) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#7c3aed');
const safeUrl = (u) => (/^(https?:\/\/|\/uploads\/)/i.test(String(u || '').trim()) ? String(u).trim() : '');
const initials = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();
const icon = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="${ICONS}#i-${name}"/></svg>`;
const fill = T.fill;
const money = (n, s, t) => (Number(n) ? T.formatMoney(n, s.currency) : t.free);
const paragraphs = (text) => esc(text).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

function socialUrl(kind, value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  const h = encodeURIComponent(v.replace(/^@/, ''));
  return { instagram: `https://instagram.com/${h}`, facebook: `https://facebook.com/${h}`, tiktok: `https://www.tiktok.com/@${h}` }[kind];
}

function head({ s, lang, t, title, description, baseUrl, image = '', extra = '', robots = '' }) {
  const color = safeColor(s.color);
  const logo = safeUrl(s.logo);
  const og = safeUrl(image) || safeUrl(s.cover) || logo;
  return `<!doctype html>
<html lang="${esc(lang)}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="${color}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${og && baseUrl ? `<meta property="og:image" content="${esc(/^https?:/.test(og) ? og : baseUrl + og.replace(/^\//, ''))}">` : ''}
${robots ? `<meta name="robots" content="${robots}">` : ''}
${extra}
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="${logo ? esc(logo) : '/img/icon.svg'}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" id="font-css" href="${esc(fontHref(s.font, lang))}">
<link rel="stylesheet" href="/css/site.css?v=${VERSION}">
<style id="vars">:root{--brand:${color};--font:${fontStack(s.font)}}</style>
</head>`;
}

/** Small organizer bar used on event, order and ticket pages. */
function topBar(s, t, lang, languages = []) {
  const logo = safeUrl(s.logo);
  return `<header class="org-bar">
  <a class="org" href="/">${logo ? `<img src="${esc(logo)}" alt="">` : `<span>${esc(initials(s.name))}</span>`}<b>${esc(s.name)}</b></a>
  ${languages.length > 1 ? `<label class="lang">${icon('globe')}<select id="lang" aria-label="${esc(t.language)}">${languages.map((l) => `<option value="${esc(l.code)}"${l.code === lang ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>` : ''}
</header>`;
}

function homeHeader({ s, t, lang, languages }) {
  const cover = safeUrl(s.cover);
  const logo = safeUrl(s.logo);
  const digits = String(s.whatsapp || '').replace(/\D/g, '');
  const quick = [
    digits && `<a class="qa wa" href="https://wa.me/${esc(digits)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('whatsapp')}</a>`,
    s.phone && `<a class="qa" href="tel:${esc(s.phone)}" aria-label="${esc(t.call)}">${icon('phone')}</a>`,
    s.instagram && `<a class="qa" href="${esc(socialUrl('instagram', s.instagram))}" target="_blank" rel="noopener" aria-label="Instagram">${icon('instagram')}</a>`,
    s.tiktok && `<a class="qa" href="${esc(socialUrl('tiktok', s.tiktok))}" target="_blank" rel="noopener" aria-label="TikTok">${icon('tiktok')}</a>`,
    s.facebook && `<a class="qa" href="${esc(socialUrl('facebook', s.facebook))}" target="_blank" rel="noopener" aria-label="Facebook">${icon('facebook')}</a>`,
    `<button class="qa" type="button" id="share" aria-label="${esc(t.share)}">${icon('share')}</button>`,
  ].filter(Boolean);
  const langMenu = languages.length > 1
    ? `<label class="lang">${icon('globe')}<select id="lang" aria-label="${esc(t.language)}">${languages.map((l) => `<option value="${esc(l.code)}"${l.code === lang ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>`
    : '';
  return `<header class="hero">
  <div class="cover${cover ? ' has-img' : ''}" id="cover">${cover ? `<img src="${esc(cover)}" alt="" fetchpriority="high">` : ''}<div class="topbar">${langMenu}</div></div>
  <div class="shop-card">
    <div class="logo" id="logo">${logo ? `<img src="${esc(logo)}" alt="">` : `<span>${esc(initials(s.name))}</span>`}</div>
    <h1>${esc(s.name)}</h1>
    ${s.tagline ? `<p class="tagline">${esc(s.tagline)}</p>` : ''}
    <div class="quick">${quick.join('')}</div>
  </div>
</header>`;
}

const footer = (s, t) => `<footer class="footer">
  ${s.about || s.policy ? `<section class="info-card">${s.about ? `<p>${esc(s.about)}</p>` : ''}${s.policy ? `<h3>${icon('file')}${esc(t.policy)}</h3><p class="muted">${esc(s.policy)}</p>` : ''}</section>` : ''}
  ${powered(s, t)}
</footer>`;

/** "Powered by" line; agencies can rename it or hide it (white-label). */
function powered(s, t) {
  const b = s._brand;
  if (b && b.hideBranding) return '';
  if (b && b.name) {
    const u = safeUrl(b.url);
    return `<p class="powered">${esc(t.poweredBy)} ${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(b.name)}</a>` : esc(b.name)}</p>`;
  }
  return `<p class="powered">${esc(t.poweredBy)} <a href="https://github.com/mashraf1997/tazkara" target="_blank" rel="noopener">Tazkara</a></p>`;
}

/** Date badge: big day number + short month. */
function dateBadge(date, lang) {
  return `<span class="date-badge"><b>${esc(T.dateLabel(date, lang, { day: 'numeric' }))}</b><small>${esc(T.dateLabel(date, lang, { month: 'short' }))}</small></span>`;
}

function coverArt(e, cls = 'ev-cover') {
  const img = safeUrl(e.cover);
  return `<div class="${cls}${img ? ' has-img' : ''}" style="--h:${hueFor(e.title)}">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<span class="ev-emoji">${esc(e.emoji || '🎟️')}</span>`}</div>`;
}

function whenText(e, lang, t) {
  const date = T.dateLabel(e.date, lang);
  const times = `${T.timeLabel(e.start, lang)} – ${T.timeLabel(e.end, lang)}`;
  if (e.endDate && e.endDate > e.date) return `${date} → ${T.dateLabel(e.endDate, lang)} · ${times}`;
  return `${date} · ${times}`;
}

function priceFrom(e, s, t) {
  const prices = (e.tickets || []).filter((x) => !x.hidden).map((x) => Number(x.price) || 0);
  if (!prices.length) return '';
  const min = Math.min(...prices);
  return min ? fill(t.fromPrice, { price: T.formatMoney(min, s.currency) }) : t.free;
}

function eventCard(e, s, t, lang) {
  const st = e.stats;
  const few = !st.soldOut && Object.values(st.remaining).some((v) => v !== null && v > 0 && v <= 10);
  const chip = e.past ? `<span class="chip muted">${esc(t.ended)}</span>` : st.soldOut ? `<span class="chip bad">${esc(t.soldOut)}</span>` : few ? `<span class="chip warn">${esc(t.fewLeft)}</span>` : '';
  return `<a class="ev-card${e.past ? ' past' : ''}" href="/e/${esc(e.slug)}">
    ${coverArt(e)}
    <div class="ev-body">
      ${dateBadge(e.date, lang)}
      <div class="ev-text"><h3>${esc(e.title)}</h3>${e.subtitle ? `<p class="ev-sub">${esc(e.subtitle)}</p>` : ''}
        <p class="ev-meta">${icon('clock', 'i xs')}${esc(T.timeLabel(e.start, lang))}${e.venue ? ` · ${icon('pin', 'i xs')}${esc(e.venue)}` : ''}</p>
        <p class="ev-foot"><b>${esc(priceFrom(e, s, t))}</b>${chip}</p></div>
    </div>
  </a>`;
}

function renderHome({ settings: s, events, lang, baseUrl, now, demo = false, preview = false, languages = [] }) {
  const t = strings(lang);
  const theme = cleanTheme(s.theme);
  const upcoming = events.filter((e) => !e.past);
  const past = events.filter((e) => e.past).reverse().slice(0, 6);
  const jsonLd = upcoming.slice(0, 10).map((e) => ({
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: e.title,
    startDate: `${e.date}T${D.fmtTime(e.start)}`,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@type': 'Place', name: e.venue || s.name, address: e.address || '' },
    url: `${baseUrl}e/${e.slug}`,
    organizer: { '@type': 'Organization', name: s.name, url: baseUrl },
  }));
  const data = { lang, t, icons: ICONS, preview, org: { name: s.name } };
  return `${head({ s, lang, t, title: `${s.name}${s.tagline ? ` — ${s.tagline}` : ''}`, description: s.tagline || s.about || s.name, baseUrl, robots: preview ? 'noindex' : '', extra: jsonLd.length ? `<script type="application/ld+json">${inlineJson(jsonLd)}</script>` : '' })}
<body class="theme-${theme}">
${homeHeader({ s, t, lang, languages })}
${demo ? `<div class="notice demo" role="note">${icon('sparkles')}<span>${esc(t.demoBanner)}</span></div>` : ''}
<main class="flow">
  <section class="section"><h2>${icon('calendar')}${esc(t.upcoming)}</h2>
    ${upcoming.length ? `<div class="ev-grid">${upcoming.map((e) => eventCard(e, s, t, lang)).join('')}</div>` : `<p class="empty">${icon('calendar')}<br>${esc(t.noEvents)}</p>`}
  </section>
  ${past.length ? `<section class="section"><h2>${icon('clock')}${esc(t.pastEvents)}</h2><div class="ev-grid small">${past.map((e) => eventCard(e, s, t, lang)).join('')}</div></section>` : ''}
</main>
${footer(s, t)}
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>window.TAZKARA=${inlineJson(data)};</script>
<script src="/js/event.js?v=${VERSION}" defer></script>
</body>
</html>`;
}

function renderEventPage({ settings: s, event: e, avail, open, past, lang, baseUrl, now, demo = false, languages = [], draft = false }) {
  const t = strings(lang);
  const theme = cleanTheme(s.theme);
  const types = e.tickets.filter((x) => !x.hidden);
  const mapUrl = safeUrl(e.mapUrl) || (e.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([e.venue, e.address].filter(Boolean).join(', '))}` : '');
  const data = {
    lang, t, icons: ICONS, currency: s.currency, open, eventId: e.id,
    types: types.map((x) => ({ id: x.id, name: x.name, price: Number(x.price) || 0, left: avail.types[x.id], max: x.maxPerOrder || 10, closed: !!(x.salesEnd && x.salesEnd < now.date) })),
    capLeft: avail.capLeft,
  };
  const ticketRows = types.map((x) => {
    const left = avail.types[x.id];
    const closed = x.salesEnd && x.salesEnd < now.date;
    const out = left === 0;
    return `<div class="tk-type${out || closed ? ' out' : ''}" data-type="${esc(x.id)}">
      <div class="tk-info"><b>${esc(x.name)}</b>${x.description ? `<small>${esc(x.description)}</small>` : ''}
        <span class="tk-price">${esc(money(x.price, s, t))}</span>
        ${out ? `<span class="chip bad">${esc(t.soldOut)}</span>` : closed ? `<span class="chip muted">${esc(t.salesEnded)}</span>` : left !== null && left <= 10 ? `<span class="chip warn">${esc(fill(t.onlyLeft, { n: left }))}</span>` : x.salesEnd ? `<small class="muted">${esc(fill(t.salesUntil, { date: T.dateLabel(x.salesEnd, lang, { day: 'numeric', month: 'short' }) }))}</small>` : ''}
      </div>
      ${open && !out && !closed ? `<div class="stepper"><button type="button" data-dec aria-label="−">${icon('minus')}</button><output>0</output><button type="button" data-inc aria-label="+">${icon('plus')}</button></div>` : ''}
    </div>`;
  }).join('');
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: e.title,
    description: e.subtitle || e.description.slice(0, 200),
    startDate: `${e.date}T${D.fmtTime(e.start)}`,
    endDate: `${e.endDate || e.date}T${D.fmtTime(e.end)}`,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@type': 'Place', name: e.venue || s.name, address: e.address || '' },
    ...(safeUrl(e.cover) ? { image: [/^https?:/.test(e.cover) ? e.cover : baseUrl + e.cover.replace(/^\//, '')] } : {}),
    organizer: { '@type': 'Organization', name: s.name, url: baseUrl },
    offers: types.map((x) => ({ '@type': 'Offer', name: x.name, price: Number(x.price) || 0, priceCurrency: /^[A-Z]{3}$/.test(s.currency) ? s.currency : undefined, availability: avail.types[x.id] === 0 ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock', url: `${baseUrl}e/${e.slug}` })),
  };
  let notice = '';
  if (draft) notice = `<div class="notice demo">${icon('eye')}<span>${esc(t.draftNotice)}</span></div>`;
  else if (past) notice = `<div class="notice closed">${icon('clock')}<span>${esc(t.eventEnded)}</span></div>`;
  else if (!open) notice = `<div class="notice closed">${icon('lock')}<span>${esc(t.salesClosed)}</span></div>`;
  else if (avail.soldOut) notice = `<div class="notice closed">${icon('x-circle')}<span>${esc(t.soldOutNotice)}</span></div>`;
  return `${head({ s, lang, t, title: `${e.title} — ${s.name}`, description: `${T.dateLabel(e.date, lang)} · ${e.venue || ''} — ${e.subtitle || e.description.slice(0, 140)}`, baseUrl, image: e.cover, robots: draft ? 'noindex' : '', extra: `<script type="application/ld+json">${inlineJson(jsonLd)}</script>` })}
<body class="theme-${theme} event-page">
${topBar(s, t, lang, languages)}
${demo ? `<div class="notice demo" role="note">${icon('sparkles')}<span>${esc(t.demoBanner)}</span></div>` : ''}
<main class="flow">
  <article class="ev-hero">
    ${coverArt(e, 'ev-cover big')}
    <div class="ev-head">${dateBadge(e.date, lang)}<div><h1>${esc(e.title)}</h1>${e.subtitle ? `<p class="ev-sub">${esc(e.subtitle)}</p>` : ''}</div></div>
    <ul class="ev-facts">
      <li>${icon('calendar')}<span>${esc(whenText(e, lang, t))}</span><a href="/e/${esc(e.slug)}.ics" download class="link">${esc(t.addCalendar)}</a></li>
      ${e.venue || e.address ? `<li>${icon('pin')}<span><b>${esc(e.venue)}</b>${e.address ? `<small>${esc(e.address)}</small>` : ''}</span>${mapUrl ? `<a href="${esc(mapUrl)}" target="_blank" rel="noopener" class="link">${esc(t.directions)}</a>` : ''}</li>` : ''}
    </ul>
  </article>
  ${notice}
  <section class="section" id="tickets"><h2>${icon('tag')}${esc(t.tickets)}</h2><div class="tk-list">${ticketRows}</div></section>
  ${e.description ? `<section class="section about"><h2>${icon('file')}${esc(t.about)}</h2><div class="prose">${paragraphs(e.description)}</div></section>` : ''}
  <button type="button" class="btn ghost block" id="share">${icon('share')}${esc(t.shareEvent)}</button>
</main>
${footer(s, t)}
${open ? `<div class="bar" id="bar" hidden><div class="bar-in"><div class="bar-sum" id="bar-sum"></div><button type="button" class="btn" id="checkout">${esc(t.getTickets)}${icon('arrow-right', 'i flip')}</button></div></div>` : ''}
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>window.TAZKARA=${inlineJson(data)};</script>
<script src="/js/event.js?v=${VERSION}" defer></script>
</body>
</html>`;
}

const STATE_CLS = { paid: 'ok', pending: 'warn', cancelled: 'bad', expired: 'bad' };

function ticketCard(tk, order, state, t, lang) {
  const valid = state === 'paid' && !tk.cancelled;
  let status = '';
  if (tk.cancelled || state === 'cancelled' || state === 'expired') status = `<span class="pill bad">${esc(t.st_cancelled)}</span>`;
  else if (state === 'pending') status = `<span class="pill warn">${esc(t.st_pending)}</span>`;
  else if (tk.usedAt) status = `<span class="pill muted">${esc(fill(t.usedAt, { time: new Date(tk.usedAt).toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' }) }))}</span>`;
  else status = `<span class="pill ok">${esc(t.st_valid)}</span>`;
  return `<article class="tk-card${valid ? '' : ' locked'}${tk.usedAt ? ' used' : ''}" data-token="${esc(tk.token)}">
    <div class="tk-qr">${valid ? tk.qr : `<div class="qr-locked">${icon('lock')}</div>`}</div>
    <div class="tk-meta">
      <small>${esc(fill(t.ticketOf, { n: tk.seq, of: order.count }))} · ${esc(tk.typeName)}</small>
      ${tk.usedAt || !valid ? `<b class="holder">${esc(tk.holder || t.guest)}</b>` : `<label class="holder-edit"><span>${esc(t.nameOnTicket)}</span><input value="${esc(tk.holder)}" maxlength="80" placeholder="${esc(t.guestName)}" data-holder></label>`}
      ${status}
      <div class="tk-acts"><a class="btn sm ghost" href="${esc(tk.url)}">${icon('external')}${esc(t.openTicket)}</a>${valid && !tk.usedAt ? `<button class="btn sm ghost" type="button" data-send="${esc(tk.url)}">${icon('share')}${esc(t.sendTicket)}</button>` : ''}</div>
    </div>
  </article>`;
}

function eventSummary(e, s, t, lang) {
  if (!e) return '';
  return `<a class="ev-mini" href="/e/${esc(e.slug)}">${coverArt(e, 'ev-thumb')}<div><b>${esc(e.title)}</b><small>${esc(whenText(e, lang, t))}</small>${e.venue ? `<small>${icon('pin', 'i xs')}${esc(e.venue)}</small>` : ''}</div></a>`;
}

function renderOrderPage({ settings: s, order: o, state, event: e, tickets, lang, baseUrl, payOnline = false, payPending = false }) {
  const t = strings(lang);
  const theme = cleanTheme(s.theme);
  const digits = String(s.whatsapp || '').replace(/\D/g, '');
  const receipt = fill(t.receiptText, { no: o.no, name: o.customer.name, event: e ? e.title : '' });
  let banner;
  if (state === 'paid') banner = `<div class="banner ok"><svg class="check-anim" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44"/><path d="M30 52 l14 14 l27 -30"/></svg><h1>${esc(t.youreIn)}</h1><p>${esc(o.count > 1 ? t.showEachQr : t.showQr)}</p></div>`;
  else if (state === 'pending') {
    banner = `<div class="banner warn"><h1>${icon('clock')}${esc(fill(t.payToConfirm, { amount: T.formatMoney(o.total, s.currency) }))}</h1>
      ${s.paymentInfo ? `<p class="pay-info">${esc(s.paymentInfo)}</p>` : ''}
      <p class="muted small">${esc(s.holdHours ? fill(t.holdHint, { hours: s.holdHours }) : t.pendingHint)}</p>
      ${payPending ? `<p class="pay-confirming">${icon('clock', 'i xs')}${esc(t.payConfirming)}</p>` : ''}
      <div class="pay-acts">${payOnline ? `<button type="button" class="btn pay-online" data-pay-online="${esc(o.token)}">${icon('cash')}${esc(t.payOnline)}</button>` : ''}${!payOnline && safeUrl(s.paymentLink) ? `<a class="btn" href="${esc(safeUrl(s.paymentLink))}" target="_blank" rel="noopener">${icon('cash')}${esc(t.payNow)}</a>` : ''}${digits ? `<a class="btn wa" href="https://wa.me/${esc(digits)}?text=${esc(encodeURIComponent(receipt))}" target="_blank" rel="noopener">${icon('whatsapp')}${esc(t.sendReceipt)}</a>` : ''}</div></div>`;
  } else banner = `<div class="banner bad"><h1>${icon('x-circle')}${esc(state === 'expired' ? t.orderExpired : t.orderCancelled)}</h1>${e ? `<a class="btn" href="/e/${esc(e.slug)}">${esc(t.getTickets)}</a>` : ''}</div>`;
  return `${head({ s, lang, t, title: `${t.yourTickets} — ${e ? e.title : s.name}`, description: s.name, baseUrl, robots: 'noindex' })}
<body class="theme-${theme} order-page">
${topBar(s, t, lang)}
<main class="flow narrow">
  ${banner}
  ${eventSummary(e, s, t, lang)}
  <p class="order-line"><span>${esc(t.order)} #${esc(o.no)} · ${esc(o.customer.name)}</span><b>${esc(o.total ? T.formatMoney(o.total, s.currency) : t.free)}</b></p>
  <div class="tk-cards">${tickets.map((tk) => ticketCard(tk, o, state, t, lang)).join('')}</div>
  ${e && state === 'paid' ? `<a class="btn ghost block" href="/e/${esc(e.slug)}.ics" download>${icon('calendar-plus')}${esc(t.addCalendar)}</a>` : ''}
  <p class="muted small center">${icon('sparkles', 'i xs')} ${esc(t.keepLink)}</p>
</main>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>window.TAZKARA=${inlineJson({ lang, t, icons: ICONS, eventTitle: e ? e.title : '' })};</script>
<script src="/js/event.js?v=${VERSION}" defer></script>
</body>
</html>`;
}

function renderTicketPage({ settings: s, ticket: tk, order: o, state, event: e, qr, url, lang, baseUrl }) {
  const t = strings(lang);
  const theme = cleanTheme(s.theme);
  const valid = state === 'paid' && !tk.cancelled;
  return `${head({ s, lang, t, title: `${t.ticket} — ${e ? e.title : s.name}`, description: s.name, baseUrl, robots: 'noindex' })}
<body class="theme-${theme} order-page">
${topBar(s, t, lang)}
<main class="flow narrow">
  ${eventSummary(e, s, t, lang)}
  <div class="tk-single">${ticketCard({ ...tk, qr, url }, o, state, t, lang)}</div>
  ${valid && !tk.usedAt ? `<p class="qr-hint center">${icon('qr', 'i xs')}${esc(t.showQr)}</p>` : ''}
  ${e ? `<a class="btn ghost block" href="/e/${esc(e.slug)}.ics" download>${icon('calendar-plus')}${esc(t.addCalendar)}</a>` : ''}
  <p class="url-line">${esc(url)}</p>
</main>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>window.TAZKARA=${inlineJson({ lang, t, icons: ICONS, eventTitle: e ? e.title : '' })};</script>
<script src="/js/event.js?v=${VERSION}" defer></script>
</body>
</html>`;
}

/** Door scanner for staff and volunteers (secret per-event link). */
function renderScanPage({ settings: s, event: e, token, lang, languages = [] }) {
  const t = strings(lang);
  if (!e) {
    return `${head({ s, lang, t, title: s.name, description: s.name, baseUrl: '', robots: 'noindex' })}<body class="kiosk-page"><main class="kiosk"><p class="empty">${icon('x-circle')}<br>${esc(t.scanInvalid)}</p></main></body></html>`;
  }
  return `${head({ s, lang, t, title: `${t.doorScanner} — ${e.title}`, description: s.name, baseUrl: '', robots: 'noindex' })}
<body class="kiosk-page">
<main class="kiosk">
  <header class="kiosk-head"><span class="k-logo">${esc(e.emoji || '🎟️')}</span><div><b>${esc(e.title)}</b><small>${esc(T.dateLabel(e.date, lang, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${esc(T.timeLabel(e.start, lang))}</small></div>
    ${languages.length > 1 ? `<select id="lang" aria-label="${esc(t.language)}">${languages.map((l) => `<option value="${esc(l.code)}"${l.code === lang ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select>` : ''}</header>
  <div class="counter"><b id="cnt">–</b><span>${esc(t.checkedIn)}</span></div>
  <p class="net-badge" id="net" role="status" hidden></p>
  <section class="kiosk-scan">
    <div class="viewfinder" id="vf"><video id="video" playsinline muted></video><span class="corners"></span><button type="button" class="btn" id="start">${icon('qr')}${esc(t.startCamera)}</button></div>
    <p>${esc(t.scanHint)}</p>
  </section>
  <div class="kiosk-result" id="result" hidden></div>
</main>
<script>window.TAZKARA_SCAN=${inlineJson({ lang, t, token, icons: ICONS })};</script>
<script src="/js/scanner.js?v=${VERSION}"></script>
<script src="/js/scan.js?v=${VERSION}" defer></script>
</body>
</html>`;
}

function renderNotFound({ settings: s, lang }) {
  const t = strings(lang);
  return `${head({ s, lang, t, title: s.name, description: s.name, baseUrl: '', robots: 'noindex' })}
<body class="theme-${cleanTheme(s.theme)}">${topBar(s, t, lang)}<main class="flow narrow"><div class="banner bad"><h1>${icon('x-circle')}${esc(t.notFound)}</h1><a class="btn" href="/">${esc(t.seeEvents)}</a></div></main></body></html>`;
}

function renderPoster({ settings: s, event: e, svg, lang, url }) {
  const t = strings(lang);
  const color = safeColor(s.color);
  const logo = safeUrl(s.logo);
  const title = e ? e.title : s.name;
  const sub = e ? `${T.dateLabel(e.date, lang)} · ${T.timeLabel(e.start, lang)}${e.venue ? ` · ${e.venue}` : ''}` : s.tagline;
  return `<!doctype html>
<html lang="${esc(lang)}" dir="${t.dir}">
<head><meta charset="utf-8"><title>QR — ${esc(title)}</title>
<link rel="stylesheet" href="${esc(fontHref(s.font, lang))}">
<style>
  *{box-sizing:border-box} body{font-family:${fontStack(s.font)};margin:0;background:#f4f4f1;display:grid;place-items:center;min-height:100vh}
  .poster{width:148mm;background:#fff;border-radius:28px;overflow:hidden;text-align:center;box-shadow:0 4px 30px rgba(0,0,0,.08)}
  .top{background:${color};color:#fff;padding:34px 24px 90px}
  .logo{width:84px;height:84px;border-radius:24px;background:#fff;color:${color};display:grid;place-items:center;margin:0 auto 12px;font-weight:800;font-size:38px;overflow:hidden}
  .logo img{width:100%;height:100%;object-fit:cover}
  h1{margin:0;font-size:32px;line-height:1.2} .top p{margin:8px 0 0;font-size:17px;opacity:.9}
  .qr{background:#fff;width:70%;margin:-70px auto 0;padding:16px;border-radius:24px;box-shadow:0 10px 30px rgba(0,0,0,.14)}
  .qr svg{width:100%;height:auto;display:block}
  .cta{font-size:26px;font-weight:800;color:${color};margin:22px 0 4px} .url{color:#666;margin:0 0 30px;font-size:15px;direction:ltr}
  .bar{position:fixed;top:12px;inset-inline-end:12px} .bar button{font:inherit;font-weight:700;padding:10px 20px;border-radius:12px;border:0;background:${color};color:#fff;cursor:pointer}
  @media print{.bar{display:none}body{background:#fff}.poster{box-shadow:none}}
</style></head>
<body><div class="bar"><button onclick="window.print()">Print</button></div>
<div class="poster"><div class="top"><div class="logo">${logo ? `<img src="${esc(logo)}" alt="">` : esc(e && e.emoji ? e.emoji : initials(s.name))}</div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
<div class="qr">${svg}</div><p class="cta">🎟️ ${esc(t.posterCta)}</p><p class="url">${esc(url)}</p></div>
</body></html>`;
}

function renderManifest(s) {
  const logo = safeUrl(s.logo);
  return {
    name: s.name,
    short_name: String(s.name).slice(0, 12),
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: safeColor(s.color),
    icons: [logo ? { src: logo, sizes: '512x512' } : { src: '/img/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}

module.exports = { renderHome, renderEventPage, renderOrderPage, renderTicketPage, renderScanPage, renderNotFound, renderPoster, renderManifest, esc, safeUrl };
