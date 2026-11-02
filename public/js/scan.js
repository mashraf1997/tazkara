(() => {
  'use strict';

  const K = window.TAZKARA_SCAN;
  const t = K.t;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ic = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="${K.icons}#i-${name}"/></svg>`;
  const fill = (s, v) => Object.entries(v).reduce((o, [k, x]) => o.split(`{${k}}`).join(x), s);
  const clock = (iso) => new Date(iso).toLocaleTimeString(K.lang, { hour: 'numeric', minute: '2-digit' });
  const base = `/api/scan/${encodeURIComponent(K.token)}`;

  const result = $('#result');
  let hideTimer;
  let busy = false;

  const setCount = (r) => {
    if (r && r.sold !== undefined) $('#cnt').textContent = `${r.checkedIn} / ${r.sold}`;
  };

  function show(html, cls) {
    result.className = `kiosk-result ${cls}`;
    result.innerHTML = html;
    result.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (result.hidden = true), cls === 'ok' ? 2500 : 5000);
  }
  result.addEventListener('click', () => (result.hidden = true));

  // ------------------------------------------------------------ offline mode
  // A copy of this event's tickets (hashed codes) lives on the device. When the
  // network fails, scans are checked against it and queued, then synced.
  const KEY = `tz_door_${K.token.slice(0, 12)}`;
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  };
  let cache = load();
  cache.queue = cache.queue || [];
  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* full or blocked */ }
  };
  const POST = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tazkara': '1' }, body: JSON.stringify(body) });
  async function sha(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
  }
  const tokenOf = (code) => {
    const raw = String(code || '').trim();
    const m = /\/t\/([\w-]{8,40})/.exec(raw);
    return m ? m[1] : /^[\w-]{8,40}$/.test(raw) ? raw : '';
  };
  let offline = false;
  function badge() {
    const b = $('#net');
    if (!b) return;
    const n = cache.queue.length;
    b.hidden = !offline && !n;
    b.className = `net-badge ${offline ? 'off' : 'sync'}`;
    b.textContent = offline ? `${t.offlineMode}${n ? ` · ${fill(t.toSync, { n })}` : ''}` : fill(t.toSync, { n });
  }
  async function pull() {
    try {
      const r = await fetch(`${base}/list`);
      if (!r.ok) return;
      const d = await r.json();
      // Keep local check-ins the server hasn't seen yet.
      const local = new Map((cache.tickets || []).filter((x) => x.localUsed).map((x) => [x.h, x]));
      d.tickets.forEach((x) => {
        const l = local.get(x.h);
        if (l && !x.usedAt) Object.assign(x, { usedAt: l.usedAt, localUsed: true, reason: 'used' });
      });
      cache = { ...cache, at: d.at, tickets: d.tickets };
      persist();
      offline = false;
      setCount(d);
    } catch {
      offline = true;
    }
    badge();
  }
  async function flush() {
    if (!cache.queue.length) return;
    const batch = cache.queue.slice(0, 200);
    try {
      const r = await POST(`${base}/sync`, { scans: batch });
      if (!r.ok) return;
      const d = await r.json();
      cache.queue = cache.queue.slice(batch.length);
      persist();
      offline = false;
      setCount(d);
      if (d.conflicts) show(`<div class="big">${ic('x-circle')}</div><h2>${esc(fill(t.syncConflicts, { n: d.conflicts }))}</h2>`, 'warn');
    } catch {
      offline = true;
    }
    badge();
  }
  async function checkOffline(code) {
    const tok = tokenOf(code);
    const list = cache.tickets || [];
    const h = tok && crypto.subtle ? await sha(tok) : '';
    const x = h && list.find((y) => y.h === h);
    if (!x) return { notFound: true };
    if (x.reason && x.reason !== 'used') return { ...x, ok: false };
    if (x.usedAt) return { ...x, ok: false, reason: 'used' };
    x.usedAt = new Date().toISOString();
    x.localUsed = true;
    x.reason = 'used';
    cache.queue.push({ code: tok, at: x.usedAt });
    persist();
    return { ...x, ok: true, usedAt: x.usedAt, offline: true };
  }
  window.addEventListener('online', () => flush().then(pull));
  window.addEventListener('offline', () => {
    offline = true;
    badge();
  });

  async function onCode(code) {
    if (busy) return;
    busy = true;
    try {
      let res;
      let r;
      try {
        if (offline && !navigator.onLine) throw new Error('offline');
        res = await fetch(`${base}/checkin`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tazkara': '1' }, body: JSON.stringify({ code }), signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined });
        r = await res.json().catch(() => ({}));
        if (offline) {
          offline = false;
          flush();
        }
      } catch {
        // No network: decide on the device.
        offline = true;
        r = await checkOffline(code);
        badge();
        if (r.notFound) {
          window.QrScanner.beep(false);
          return show(`<div class="big">${ic('x-circle')}</div><h2>${esc(t.unknownTicket)}</h2><p>${esc(t.offlineUnknown)}</p>`, 'bad');
        }
        res = { ok: true, status: 200 };
      }
      if (!r.offline && r.ok !== undefined && res.ok) {
        // Server answered: keep the local copy in step.
        const tok = tokenOf(code);
        if (tok && crypto.subtle && cache.tickets) {
          sha(tok).then((h) => {
            const x = cache.tickets.find((y) => y.h === h);
            if (x && r.usedAt) Object.assign(x, { usedAt: r.usedAt, reason: 'used' });
            persist();
          });
        }
      }
      if (res.status === 404) {
        window.QrScanner.beep(false);
        return show(`<div class="big">${ic('x-circle')}</div><h2>${esc(t.unknownTicket)}</h2>`, 'bad');
      }
      if (!res.ok) throw new Error(r.error || 'error');
      setCount(r);
      const who = `<p class="k-type">${esc(r.typeName)}${r.of > 1 ? ` · ${esc(fill(t.ticketOf, { n: r.seq, of: r.of }))}` : ''} · #${esc(r.orderNo)}</p>`;
      if (r.ok) {
        window.QrScanner.beep(true);
        show(`<div class="big">${ic('check')}</div><h2>${esc(r.holder || t.guest)}</h2>${who}`, 'ok');
      } else {
        window.QrScanner.beep(false);
        const why = r.reason === 'used' ? fill(t.alreadyUsed, { time: clock(r.usedAt) }) : r.reason === 'other_event' ? fill(t.otherEvent, { event: r.eventTitle }) : t[`why_${r.reason}`] || t.error;
        show(`<div class="big">${ic('x-circle')}</div><h2>${esc(why)}</h2><p>${esc(r.holder || '')}</p>${who}`, r.reason === 'used' ? 'warn' : 'bad');
      }
    } catch {
      show(`<h2>${esc(t.error)}</h2>`, 'bad');
    } finally {
      setTimeout(() => (busy = false), 1000);
    }
  }

  const startBtn = $('#start');
  let started = false;
  async function start() {
    if (started) return;
    started = true;
    startBtn.hidden = true;
    try {
      await window.QrScanner.start($('#video'), onCode);
      $('#vf').classList.add('live');
    } catch {
      started = false;
      startBtn.hidden = false;
      show(`<div class="big">${ic('x-circle')}</div><h2>${esc(t.cameraError)}</h2>`, 'bad');
    }
  }
  startBtn.addEventListener('click', start);
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'camera' }).then((p) => p.state === 'granted' && start()).catch(() => {});
  }

  window.QrScanner.preload();
  pull().then(flush);
  setInterval(() => flush().then(pull), 60000);
  badge();

  const langSel = $('#lang');
  if (langSel) langSel.addEventListener('change', () => {
    const url = new URL(location.href);
    url.searchParams.set('lang', langSel.value);
    location.href = url.toString();
  });
  if ('wakeLock' in navigator) {
    const lock = () => navigator.wakeLock.request('screen').catch(() => {});
    lock();
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && lock());
  }
})();
