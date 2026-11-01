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

  async function onCode(code) {
    if (busy) return;
    busy = true;
    try {
      const res = await fetch(`${base}/checkin`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tazkara': '1' }, body: JSON.stringify({ code }) });
      const r = await res.json().catch(() => ({}));
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

  const refresh = () => fetch(`${base}/stats`).then((r) => r.json()).then(setCount).catch(() => {});
  refresh();
  setInterval(refresh, 15000);

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
