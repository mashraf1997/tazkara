(() => {
  'use strict';

  // ======================= i18n =======================
  const LANG_KEY = 'tazkara-admin-lang';
  let lang = (() => {
    try { return localStorage.getItem(LANG_KEY); } catch { return null; }
  })();
  let S = {};
  let LANGUAGES = [{ code: 'en', name: 'English' }];
  const T = (k) => S[k] || k;

  async function setLang(next) {
    const data = await (await fetch(`/api/i18n/${encodeURIComponent(next || 'en')}`)).json();
    S = data.strings;
    LANGUAGES = data.languages;
    lang = LANGUAGES.some((l) => l.code === next) ? next : 'en';
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
    document.documentElement.lang = lang;
    document.documentElement.dir = T('dir');
  }

  // ======================= helpers =======================
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const app = $('#app');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ICONS = '/img/icons.svg';
  const ic = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="${ICONS}#i-${name}"/></svg>`;
  const hue = (text) => {
    let h = 0;
    for (const ch of String(text || '')) h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
  };
  const trend = (pct) =>
    pct === null || pct === undefined ? '' : `<span class="trend ${pct >= 0 ? 'up' : 'down'}" title="${esc(T('vsPrevious'))}">${ic(pct >= 0 ? 'trend-up' : 'trend-down')}${Math.abs(pct)}%</span>`;

  let toastTimer;
  function toast(msg, bad) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast show${bad ? ' bad' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = 'toast'), 2200);
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Tazkara': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && !url.endsWith('/login') && !url.endsWith('/password')) {
      boot();
      throw new Error('unauthorized');
    }
    if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error });
    return data;
  }

  const PREFIX = ['$', '€', '£', '¥', '₹', '₺', 'R$', 'US$', 'C$', 'A$'];
  const money = (n) => {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    const s = v.toLocaleString('en', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
    const cur = state.data ? state.data.settings.currency : '';
    return PREFIX.includes(cur) ? `${cur}${s}` : `${s} ${cur}`.trim();
  };
  const pad = (n) => String(n).padStart(2, '0');
  const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
  const toMin = (s) => {
    const [h, m] = String(s).split(':').map(Number);
    return h * 60 + m;
  };
  const timeLabel = (min) => new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1, Math.floor(min / 60), min % 60)));
  const fmtDate = (date, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat(lang, { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const addDays = (date, n) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const dow = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
  const dayName = (i, style = 'long') => new Intl.DateTimeFormat(lang, { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + i)));
  const dur = (m) => {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return !h ? `${r}m` : r ? `${h}h ${r}m` : `${h}h`;
  };
  const sw = (name, checked, label, attrs = '') =>
    `<label class="check"><span class="switch"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''} ${attrs}><i></i></span><span>${label}</span></label>`;
  const browserTimezone = () => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
  };
  const timezones = () => {
    try { return Intl.supportedValuesOf('timeZone'); } catch { return []; }
  };

  async function fileToDataUrl(file, max) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let data = c.toDataURL('image/webp', 0.85);
      if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/jpeg', 0.85);
      return data;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function uploadFile(file, max = 1200) {
    const dataUrl = await fileToDataUrl(file, max);
    return (await api('POST', '/api/admin/upload', { dataUrl })).url;
  }

  function timeAgo(iso) {
    const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    if (s < 60) return rtf.format(-s, 'second');
    if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
    if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
    return rtf.format(-Math.round(s / 86400), 'day');
  }

  // ======================= state =======================
  const state = { data: null, tab: 'home', ordEvent: '', ordStatus: '', q: '', ciEvent: '', stopScan: null, lastNo: null };
  let demo = null;

  async function loadData() {
    state.data = await api('GET', '/api/admin/data');
    document.documentElement.style.setProperty('--brand', state.data.settings.color);
  }
  const today = () => state.data.now.date;
  const eventById = (id) => state.data.events.find((e) => e.id === id);
  const fill = (s, vars) => Object.entries(vars).reduce((o, [k, v]) => o.split(`{${k}}`).join(v), s);
  const chip = (st) => `<span class="chip st-${st}">${esc(T(`st_${st}`))}</span>`;
  const dateBadge = (date) => `<span class="date-badge"><b>${esc(fmtDate(date, { day: 'numeric' }))}</b><small>${esc(fmtDate(date, { month: 'short' }))}</small></span>`;
  const evThumb = (e) => `<span class="ev-thumb" style="--h:${hue(e.title)}">${e.cover ? `<img src="${esc(e.cover)}" alt="">` : esc(e.emoji || '🎟️')}</span>`;
  const daysUntil = (date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 864e5);
  const whenShort = (e) => `${fmtDate(e.date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${timeLabel(e.start)}`;
  const upcomingEvents = () => state.data.events.filter((e) => !e.past);
  const defaultEvent = () => {
    const up = upcomingEvents();
    return (up.find((e) => e.date === today()) || up[0] || state.data.events[state.data.events.length - 1] || {}).id || '';
  };
  async function openWa(url) {
    const win = window.open(url, '_blank');
    if (win) win.opener = null;
    else location.href = url;
  }
  const bar = (value, total, cls = '') => `<div class="meter ${cls}"><i style="width:${total ? Math.min(100, (value / total) * 100) : 0}%"></i></div>`;

  // ======================= boot / auth =======================
  async function boot() {
    let s;
    try {
      s = await api('GET', '/api/state');
    } catch {
      app.innerHTML = '<div class="auth"><div class="auth-main"><p class="error">Error</p></div></div>';
      return;
    }
    demo = s.demo;
    agencyBrand = s.brand && s.brand.name ? s.brand : null;
    await setLang(lang || s.lang);
    if (!s.setupDone) return renderSetup(s);
    if (!s.authed) return renderLogin();
    await loadData();
    renderShell();
    swRegistration().catch(() => {});
    startPolling();
  }

  const langSwitch = () =>
    `<select class="lang-select" data-act-change="lang" aria-label="Language">${LANGUAGES.map((l) => `<option value="${esc(l.code)}" ${l.code === lang ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>`;
  const langOptions = (selected) => LANGUAGES.map((l) => `<option value="${esc(l.code)}" ${l.code === selected ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  const CURRENCY_GUESS = { ar: 'EGP', en: 'USD', es: 'MXN', pt: 'BRL', fr: 'EUR', tr: 'TRY', id: 'IDR', hi: 'INR' };

  let agencyBrand = null; // white-label (agency mode)
  const authShell = (form) => `
    <div class="auth">
      <aside class="auth-side">
        <div class="auth-brand">${agencyBrand ? `<b>${esc(agencyBrand.name)}</b>` : '<img src="/img/icon.svg" alt="" width="40" height="40"><b>Tazkara</b>'}</div>
        <h2>${esc(T('authTagline'))}</h2>
        <ul>${['authPoint1', 'authPoint2', 'authPoint3'].map((k) => `<li>${ic('check')}<span>${esc(T(k))}</span></li>`).join('')}</ul>
        <div class="auth-mock" aria-hidden="true">
          <div class="m-bubble">🎟️ <b>#1042</b> · 2× VIP<br><small>Friday Night Live · 20:00</small></div>
          <div class="m-bubble me">✅ ${esc(T('st_paid'))}</div>
        </div>
      </aside>
      <div class="auth-main">${form}</div>
    </div>`;

  function renderSetup(s) {
    app.innerHTML = authShell(`<form class="auth-card" id="setup" autocomplete="off">
        <div style="text-align:end">${langSwitch()}</div>
        <img class="mark" src="/img/icon.svg" alt="">
        <h1>${esc(T('setupTitle'))}</h1>
        <p class="sub">${esc(T('setupSub'))}</p>
        ${s.needsSetupCode ? `<label class="field"><span>${ic('lock')}${esc(T('setupCode'))}</span><input name="setupCode" required maxlength="12" placeholder="ABCD-EFGH" autocapitalize="characters" spellcheck="false" style="letter-spacing:.15em;font-weight:700"><small>${esc(T('setupCodeHint'))}</small></label>` : ''}
        <label class="field"><span>${esc(T('orgName'))}</span><input name="name" required maxlength="80"></label>
        <label class="field"><span>${esc(T('eventType'))}</span><select name="type">${s.eventTypes.map((k) => `<option value="${k}">${esc(T(`etype_${k}`))}</option>`).join('')}</select></label>
        <label class="field"><span>${esc(T('whatsapp'))}</span><input name="whatsapp" type="tel" inputmode="tel" maxlength="20" placeholder="201001234567"><small>${esc(T('whatsappHint'))}</small></label>
        <div class="grid2">
          <label class="field"><span>${esc(T('currency'))}</span><input name="currency" value="${CURRENCY_GUESS[lang] || 'USD'}" maxlength="12"></label>
          <label class="field"><span>${esc(T('defaultLang'))}</span><select name="lang">${langOptions(lang)}</select></label>
        </div>
        <label class="field"><span>${esc(T('password'))}</span><input name="password" type="password" required minlength="8" autocomplete="new-password"><small>${esc(T('passwordHint'))}</small></label>
        ${sw('sample', true, `${esc(T('sampleData'))} <small class="muted">— ${esc(T('sampleHint'))}</small>`)}
        <button class="btn block" type="submit">${esc(T('start'))}</button>
        <p class="error" id="err"></p>
      </form>`);
    const f = $('#setup');
    (f.setupCode || f.name).focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (f.password.value.length < 8) return ($('#err').textContent = T('weakPassword'));
      f.querySelector('button[type=submit]').disabled = true;
      try {
        await api('POST', '/api/setup', {
          setupCode: f.setupCode ? f.setupCode.value : '', name: f.name.value, type: f.type.value, whatsapp: f.whatsapp.value,
          currency: f.currency.value, lang: f.lang.value, password: f.password.value, sample: f.sample.checked, timezone: browserTimezone(),
        });
        await setLang(f.lang.value);
        boot();
      } catch (err) {
        $('#err').textContent = T({ weak_password: 'weakPassword', invalid_setup_code: 'invalidSetupCode', rate_limited: 'rateLimited' }[err.code] || 'error');
        f.querySelector('button[type=submit]').disabled = false;
      }
    });
  }

  function renderLogin() {
    app.innerHTML = authShell(`<form class="auth-card" id="login">
        <div style="text-align:end">${langSwitch()}</div>
        <img class="mark" src="/img/icon.svg" alt="">
        <h1>${esc(T('loginTitle'))}</h1>
        <p class="sub">${esc(T('loginSub'))}</p>
        ${demo ? `<p class="demo-note">${ic('sparkles')} ${esc(T('demoLogin'))} <b>${esc(demo.password)}</b></p>` : ''}
        <label class="field"><span>${esc(T('password'))}</span><input name="password" type="password" required autocomplete="current-password" value="${demo ? esc(demo.password) : ''}"></label>
        <button class="btn block" type="submit">${esc(T('login'))}</button>
        <p class="error" id="err"></p>
      </form>`);
    $('#login [name=password]').focus();
    $('#login').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/login', { password: e.target.password.value });
        boot();
      } catch (err) {
        $('#err').textContent = err.code === 'rate_limited' ? T('rateLimited') : T('wrongPassword');
      }
    });
  }

  // ======================= shell =======================
  const TABS = [
    ['home', 'dashboard'], ['events', 'calendar'], ['orders', 'receipt'], ['checkin', 'qr'],
    ['appearance', 'palette'], ['share', 'megaphone'], ['connect', 'plug'], ['settings', 'settings'],
  ];

  function renderShell() {
    const s = state.data.settings;
    const hash = location.hash.slice(1);
    if (TABS.some(([k]) => k === hash)) state.tab = hash;
    app.innerHTML = `
      ${demo ? `<div class="demo-bar">${ic('sparkles')} ${esc(T('demoLogin'))} <b>${esc(demo.password)}</b></div>` : ''}
      <header class="top">
        <img src="${esc(s.logo || '/img/icon.svg')}" alt="" width="36" height="36">
        <div class="shop">${esc(s.name)}<small class="muted">${esc(fmtDate(today(), { weekday: 'long', day: 'numeric', month: 'long' }))}</small></div>
        ${langSwitch()}
        <a class="btn sm" href="/" target="_blank" rel="noopener">${ic('external')}<span class="hide-sm">${esc(T('viewPage'))}</span></a>
        <button class="icon-btn" data-act="logout" title="${esc(T('logout'))}" aria-label="${esc(T('logout'))}" type="button">${ic('logout')}</button>
      </header>
      <div class="layout">
        <nav class="nav">${TABS.map(([k, icon]) => `<button type="button" data-tab="${k}" class="${state.tab === k ? 'active' : ''}">${ic(icon, 'i ico')}<span>${esc(T(k))}</span>${k === 'orders' ? '<span class="dot" id="pending-dot" hidden></span>' : ''}</button>`).join('')}</nav>
        <main class="view" id="view"></main>
      </div>`;
    setPendingDot(state.data.pending);
    renderTab();
  }

  async function renderTab() {
    $$('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
    const activeTab = document.querySelector('.nav button.active');
    if (activeTab && activeTab.scrollIntoView) activeTab.scrollIntoView({ inline: 'center', block: 'nearest' });
    if (state.stopScan && state.tab !== 'checkin') {
      state.stopScan();
      state.stopScan = null;
    }
    const view = $('#view');
    if (!view) return;
    view.onclick = null;
    try {
      await VIEWS[state.tab](view);
    } catch (err) {
      if (err.message !== 'unauthorized') {
        console.error(err);
        toast(T('error'), true);
      }
    }
  }

  function setPendingDot(n) {
    const dot = $('#pending-dot');
    if (dot) {
      dot.hidden = !n;
      dot.textContent = n;
    }
    document.title = `${n ? `(${n}) ` : ''}Tazkara — ${state.data ? state.data.settings.name : ''}`;
  }

  // ======================= modal =======================
  function openModal(html, cls = '') {
    closeModal();
    const el = document.createElement('div');
    el.className = 'modal';
    el.id = 'modal';
    el.innerHTML = `<div class="back" data-close></div><div class="box ${cls}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeModal();
    });
    return $('.box', el);
  }
  function closeModal() {
    const m = $('#modal');
    if (m) m.remove();
    document.body.style.overflow = '';
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  const VIEWS = {};
  const refresh = async () => {
    await loadData();
    if (['home', 'events', 'orders', 'checkin'].includes(state.tab)) renderTab();
  };

  async function markPaid(id) {
    const r = await api('PUT', `/api/admin/orders/${id}`, { status: 'paid' });
    toast(T('markedPaid'));
    return r;
  }

  // ======================= HOME =======================
  VIEWS.home = async (view) => {
    const st = await api('GET', '/api/admin/stats');
    state.lastNo = st.latestNo;
    setPendingDot(st.pending.count);
    const s = state.data.settings;
    const up = upcomingEvents();
    const next = up[0];
    const steps = [
      [!!s.whatsapp, T('stepWhatsapp'), 'settings'],
      [state.data.events.length > 0, T('stepEvent'), 'events'],
      [!!s.paymentInfo || !!s.paymentLink, T('stepPayment'), 'settings'],
      [!!s.logo, T('stepLogo'), 'appearance'],
      [st.latestNo > 0, T('stepShare'), 'share'],
    ];
    const allDone = demo || steps.every((x) => x[0]);
    const maxDay = Math.max(1, ...st.days.map((d) => d.count));
    const inDays = (e) => {
      const n = daysUntil(e.date);
      return n === 0 ? T('today') : n === 1 ? T('tomorrow') : fill(T('inDays'), { n });
    };
    view.innerHTML = `
      <div class="page-head"><h2 class="title">${esc(T('home'))}</h2><span style="flex:1"></span>
        <button class="btn line" data-tab="checkin" type="button">${ic('qr')}<span class="hide-sm">${esc(T('checkin'))}</span></button>
        <button class="btn" data-act="new-event" type="button">${ic('plus')}${esc(T('newEvent'))}</button></div>
      <div class="kpis">
        <div class="kpi"><div class="kpi-ic c1">${ic('tag')}</div><div class="kpi-body"><span class="label">${esc(T('sold30'))}</span><div class="value">${st.sold30}</div><span class="sub">${st.visits.month ? `${st.visits.month} ${esc(T('visitors')).toLowerCase()}` : '&nbsp;'}</span></div></div>
        <div class="kpi"><div class="kpi-ic c2">${ic('cash')}</div><div class="kpi-body"><span class="label">${esc(T('revenue30'))}</span><div class="value">${esc(money(st.revenue.month))}${trend(st.revenue.change)}</div><span class="sub">&nbsp;</span></div></div>
        <div class="kpi"><div class="kpi-ic c3">${ic('clock')}</div><div class="kpi-body"><span class="label">${esc(T('awaitingPayment'))}</span><div class="value">${st.pending.count}</div><span class="sub">${esc(money(st.pending.amount))}</span></div></div>
        <div class="kpi"><div class="kpi-ic c4">${ic('calendar')}</div><div class="kpi-body"><span class="label">${esc(T('nextEvent'))}</span><div class="value sm">${next ? esc(inDays(next)) : '—'}</div><span class="sub">${next ? esc(next.title) : esc(T('noUpcoming'))}</span></div></div>
      </div>
      ${st.pending.count ? `<div class="card pending-card"><h3>${ic('clock')}${esc(T('awaitingPayment'))}<span class="count">${st.pending.count}</span></h3><p class="muted small" style="margin-top:-8px">${esc(T('awaitingHint'))}</p>${st.pending.list.map((o) => `<div class="remind-row"><div class="bd"><b data-order="${o.id}" class="link">#${o.no} · ${esc(o.customer.name)}</b><span>${esc(o.eventTitle)} · ${o.count}× · ${esc(timeAgo(o.createdAt))}</span></div><b class="amt">${esc(money(o.total))}</b><div class="acts"><button class="icon-btn wa" type="button" data-wa="${o.id}" aria-label="WhatsApp">${ic('whatsapp')}</button><button class="btn sm" type="button" data-paid="${o.id}">${ic('check')}<span class="hide-sm">${esc(T('markPaid'))}</span></button></div></div>`).join('')}</div>` : ''}
      <div class="dash-cols">
        <div>
          ${up.length ? up.slice(0, 3).map((e) => eventCardAdmin(e, true)).join('') : `<div class="card"><div class="empty-state"><div class="big">🎟️</div><p>${esc(T('noUpcoming'))}</p><button class="btn" data-act="new-event" type="button">${ic('plus')}${esc(T('newEvent'))}</button></div></div>`}
          <div class="card"><h3>${ic('trend-up')}${esc(T('sales14'))}</h3>
            <div class="wk-bars tall">${st.days.map((d) => `<div title="${esc(fmtDate(d.date))}: ${d.count}" class="${d.date === today() ? 'peak' : ''}"><em>${d.count || ''}</em><i style="height:${(d.count / maxDay) * 100}%"></i>${esc(fmtDate(d.date, { day: 'numeric' }))}</div>`).join('')}</div></div>
        </div>
        <div>
          <div class="card"><h3>${ic('receipt')}${esc(T('recentOrders'))}</h3>${st.recent.length ? st.recent.map((o) => `<div class="list-row" data-order="${o.id}"><div class="bd"><b>#${o.no} · ${esc(o.customer.name)}</b><span>${esc(o.eventTitle)} · ${o.count}× · ${esc(timeAgo(o.createdAt))}</span></div>${chip(o.state)}</div>`).join('') : `<p class="muted">${esc(T('noOrders'))}</p>`}</div>
          ${allDone ? '' : `<div class="card"><h3>${ic('rocket')}${esc(T('getStarted'))}</h3><div class="progress"><i style="width:${(steps.filter((x) => x[0]).length / steps.length) * 100}%"></i></div><ul class="checklist">${steps.map(([done, label, tab]) => `<li class="${done ? 'done' : ''}"><span class="tick">${done ? ic('check') : ''}</span>${done ? esc(label) : `<a href="#${tab}" data-tab="${tab}">${esc(label)}</a>`}</li>`).join('')}</ul></div>`}
          <div class="card"><h3>${ic('link')}${esc(T('yourLink'))}</h3><div class="share-row"><input class="input" readonly value="${esc(state.data.baseUrl)}"><button class="btn sm" data-act="copy" data-text="${esc(state.data.baseUrl)}" type="button">${ic('copy')}</button></div></div>
        </div>
      </div>`;
    view.onclick = eventCardClicks;
  };

  function eventCardAdmin(e, compact = false) {
    const st = e.stats;
    const flags = [!e.published && `<span class="chip">${esc(T('draft'))}</span>`, e.past && `<span class="chip">${esc(T('ended'))}</span>`, !e.past && e.published && !e.salesOpen && `<span class="chip st-pending">${esc(T('salesPaused'))}</span>`, !e.past && st.soldOut && `<span class="chip st-cancelled">${esc(T('soldOut'))}</span>`].filter(Boolean).join('');
    const isToday = e.date === today();
    return `<div class="card ev-admin${e.past ? ' past' : ''}" data-ev="${e.id}">
      <div class="ev-row">${evThumb(e)}<div class="bd"><b>${esc(e.title)} ${flags}</b><span>${dateBadge(e.date)} ${esc(whenShort(e))}${e.venue ? ` · ${esc(e.venue)}` : ''}</span></div>
        <div class="acts"><button class="btn sm line" type="button" data-edit="${e.id}">${ic('edit')}<span class="hide-sm">${esc(T('edit'))}</span></button>${compact ? '' : `<button class="icon-btn" type="button" data-more="${e.id}" aria-label="${esc(T('more'))}">${ic('dots')}</button>`}</div></div>
      <div class="ev-stats">
        <div><small>${esc(T('sold'))}</small><b>${st.sold}${st.capacity ? ` / ${st.capacity}` : ''}</b>${bar(st.sold, st.capacity || st.sold + st.pending || 1)}</div>
        <div><small>${esc(T('revenue'))}</small><b>${esc(money(st.revenue))}</b>${st.pending ? `<small class="warn-t">+${st.pending} ${esc(T('unpaidTickets'))}</small>` : ''}</div>
        <div><small>${esc(T('checkedIn'))}</small><b>${st.checkedIn}${st.sold ? ` / ${st.sold}` : ''}</b>${bar(st.checkedIn, st.sold, 'ok')}</div>
      </div>
      ${!compact || isToday ? '' : `<div class="type-bars">${st.byType.map((t) => `<div><span>${esc(t.name)}</span><b>${t.sold}${t.quantity ? ` / ${t.quantity}` : ''}</b></div>`).join('')}</div>`}
      ${isToday && !e.past ? `<button class="btn block" type="button" data-door="${e.id}">${ic('qr')}${esc(T('startCheckin'))}</button>` : ''}
    </div>`;
  }

  async function eventCardClicks(e) {
    const el = e.target.closest('[data-edit],[data-more],[data-door],[data-order],[data-paid],[data-wa]');
    if (!el) return;
    try {
      if (el.dataset.edit) eventModal(eventById(el.dataset.edit));
      else if (el.dataset.more) eventMenu(eventById(el.dataset.more));
      else if (el.dataset.door) {
        state.ciEvent = el.dataset.door;
        state.tab = 'checkin';
        history.replaceState(null, '', '#checkin');
        renderTab();
      } else if (el.dataset.order) orderModal(el.dataset.order);
      else if (el.dataset.paid) {
        e.stopPropagation();
        const r = await markPaid(el.dataset.paid);
        if (r.autoSent) toast(T('cxAutoSent'));
        else if (r.customer.phone && confirm(T('sendTicketsNow'))) openWa(r.whatsappUrl);
        refresh();
      } else if (el.dataset.wa) openWa((await api('GET', `/api/admin/orders/${el.dataset.wa}/whatsapp`)).url);
    } catch (err) {
      if (err.message !== 'unauthorized') toast(T('error'), true);
    }
  }

  // ======================= EVENTS =======================
  VIEWS.events = async (view) => {
    const up = upcomingEvents();
    const past = state.data.events.filter((e) => e.past).reverse();
    view.innerHTML = `
      <div class="page-head"><h2 class="title">${esc(T('events'))}</h2><span style="flex:1"></span><button class="btn" data-act="new-event" type="button">${ic('plus')}${esc(T('newEvent'))}</button></div>
      ${up.length ? up.map((e) => eventCardAdmin(e)).join('') : `<div class="card"><div class="empty-state"><div class="big">🎟️</div><p>${esc(T('noUpcoming'))}</p></div></div>`}
      ${past.length ? `<h3 class="sec-title">${ic('clock')}${esc(T('pastEvents'))}</h3>${past.map((e) => eventCardAdmin(e)).join('')}` : ''}`;
    view.onclick = eventCardClicks;
  };

  function eventMenu(e) {
    const box = openModal(`<h3>${evThumb(e)} ${esc(e.title)}</h3>
      <div class="menu-list">
        <a class="menu-item" href="${esc(e.url)}" target="_blank" rel="noopener">${ic('external')}<span>${esc(T('openPage'))}</span></a>
        <button class="menu-item" type="button" data-copy-link>${ic('link')}<span>${esc(T('copyLink'))}</span></button>
        <button class="menu-item" type="button" data-door>${ic('qr')}<span>${esc(T('doorLink'))}</span><small>${esc(T('doorLinkHint'))}</small></button>
        <a class="menu-item" href="/api/admin/events/${e.id}/attendees.csv" download>${ic('download')}<span>${esc(T('attendeesCsv'))}</span></a>
        <a class="menu-item" href="/admin/poster?event=${e.id}" target="_blank">${ic('print')}<span>${esc(T('printPoster'))}</span></a>
        <button class="menu-item" type="button" data-dup>${ic('copy')}<span>${esc(T('duplicate'))}</span></button>
        <button class="menu-item danger" type="button" data-del>${ic('trash')}<span>${esc(T('deleteEvent'))}</span></button>
      </div>`);
    box.addEventListener('click', async (ev) => {
      try {
        if (ev.target.closest('[data-copy-link]')) {
          await navigator.clipboard.writeText(e.url);
          toast(T('copied'));
        } else if (ev.target.closest('[data-door]')) doorModal(e);
        else if (ev.target.closest('[data-dup]')) {
          const copy = await api('POST', `/api/admin/events/${e.id}/duplicate`, {});
          await loadData();
          eventModal(eventById(copy.id));
          renderTab();
        } else if (ev.target.closest('[data-del]')) {
          let body = {};
          if (e.stats.sold) {
            const typed = prompt(fill(T('deleteEventConfirmSold'), { n: e.stats.sold, slug: e.slug }));
            if (typed === null) return;
            body = { confirm: typed.trim() };
          } else if (!confirm(T('deleteEventConfirm'))) return;
          await api('DELETE', `/api/admin/events/${e.id}`, body);
          closeModal();
          toast(T('deleted'));
          refresh();
        }
      } catch (err) {
        toast(err.code === 'has_orders' ? T('typeToConfirm') : T('error'), true);
      }
    });
  }

  function doorModal(e) {
    const box = openModal(`<h3>${ic('qr')}${esc(T('doorLink'))}</h3><p class="muted">${esc(T('doorHint'))}</p>
      <ol class="steps-list"><li>${esc(T('doorStep1'))}</li><li>${esc(T('doorStep2'))}</li><li>${esc(T('doorStep3'))}</li></ol>
      <div class="share-row"><input class="input" readonly value="${esc(e.scanUrl)}" dir="ltr"><button class="btn sm" data-act="copy" data-text="${esc(e.scanUrl)}" type="button">${ic('copy')}</button></div>
      <div class="modal-actions"><a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(`${T('doorShareText').replace('{event}', e.title)}\n${e.scanUrl}`)}" target="_blank" rel="noopener">${ic('whatsapp')}${esc(T('sendToTeam'))}</a><a class="btn line" href="${esc(e.scanUrl)}" target="_blank" rel="noopener">${ic('external')}${esc(T('openScanner'))}</a></div>
      <button class="btn ghost sm" type="button" data-reset style="margin-top:12px">${ic('lock')}${esc(T('resetDoorLink'))}</button>`);
    $('[data-reset]', box).addEventListener('click', async () => {
      if (!confirm(T('resetDoorConfirm'))) return;
      try {
        await api('POST', `/api/admin/events/${e.id}/scan-reset`, {});
        await loadData();
        doorModal(eventById(e.id));
      } catch (err) {
        toast(err.code === 'demo' ? T('demoBlocked') : T('error'), true);
      }
    });
  }

  const EMOJIS = ['🎟️', '🎸', '🎤', '🎻', '🎭', '🎉', '💡', '📸', '🏺', '🏃', '🎾', '⚽', '🍽️', '🌇'];
  const typeRow = (t = {}) => `<div class="type-edit" data-tid="${esc(t.id || '')}">
    <div class="grid3">
      <label class="field"><span>${esc(T('ticketName'))}</span><input data-k="name" maxlength="60" value="${esc(t.name || '')}" placeholder="${esc(T('ticketNamePh'))}"></label>
      <label class="field"><span>${esc(T('price'))}</span><input data-k="price" type="number" min="0" step="any" inputmode="decimal" value="${esc(t.price === undefined ? '' : t.price)}" placeholder="0 = ${esc(T('free'))}"></label>
      <label class="field"><span>${esc(T('quantity'))}</span><input data-k="quantity" type="number" min="0" value="${esc(t.quantity || '')}" placeholder="∞"></label>
    </div>
    <details${t.description || t.salesEnd || t.hidden || (t.maxPerOrder && t.maxPerOrder !== 10) ? ' open' : ''}><summary>${esc(T('moreOptions'))}</summary>
      <div class="grid3">
        <label class="field"><span>${esc(T('ticketDesc'))}</span><input data-k="description" maxlength="200" value="${esc(t.description || '')}"></label>
        <label class="field"><span>${esc(T('maxPerOrder'))}</span><input data-k="maxPerOrder" type="number" min="1" max="50" value="${esc(t.maxPerOrder || 10)}"></label>
        <label class="field"><span>${esc(T('salesEnd'))}</span><input data-k="salesEnd" type="date" value="${esc(t.salesEnd || '')}"></label>
      </div>
      <label class="check"><span class="switch"><input type="checkbox" data-k="hidden" ${t.hidden ? 'checked' : ''}><i></i></span><span>${esc(T('hideType'))}</span></label>
    </details>
    <button type="button" class="icon-btn rm" data-rm aria-label="${esc(T('delete'))}">${ic('trash')}</button>
  </div>`;

  function eventModal(e) {
    const v = e || { title: '', subtitle: '', emoji: '🎟️', cover: '', date: addDays(today(), 14), endDate: '', start: 20 * 60, end: 23 * 60, venue: '', address: '', mapUrl: '', description: '', capacity: 0, published: true, salesOpen: true, tickets: [{ name: T('defaultTicket'), price: '', quantity: 100, maxPerOrder: 10 }] };
    const holder = { cover: v.cover };
    const box = openModal(`<h3>${ic('calendar')}${esc(e ? T('editEvent') : T('newEvent'))}</h3><form id="evf">
      <label class="field"><span>${esc(T('eventTitle'))} *</span><input name="title" required maxlength="120" value="${esc(v.title)}" placeholder="${esc(T('eventTitlePh'))}"></label>
      <label class="field"><span>${esc(T('subtitle'))}</span><input name="subtitle" maxlength="160" value="${esc(v.subtitle)}"></label>
      <div class="cover-row">
        <label class="cover-pick" id="cover-pick" style="--h:${hue(v.title || '?')}">${v.cover ? `<img src="${esc(v.cover)}" alt="">` : `${ic('image')}<small>${esc(T('coverImage'))}</small>`}<input type="file" accept="image/*" hidden id="cover-file"></label>
        <div class="emoji-pick">${EMOJIS.map((x) => `<button type="button" data-emoji="${x}" class="${x === v.emoji ? 'active' : ''}">${x}</button>`).join('')}<input name="emoji" maxlength="8" value="${esc(v.emoji || '')}" aria-label="Emoji"></div>
      </div>
      <div class="grid3">
        <label class="field"><span>${esc(T('date'))} *</span><input name="date" type="date" required value="${esc(v.date)}"></label>
        <label class="field"><span>${esc(T('from'))}</span><input name="start" type="time" value="${hhmm(v.start)}"></label>
        <label class="field"><span>${esc(T('to'))}</span><input name="end" type="time" value="${hhmm(v.end)}"></label>
      </div>
      <label class="field"><span>${esc(T('endDate'))}</span><input name="endDate" type="date" value="${esc(v.endDate || '')}"><small>${esc(T('endDateHint'))}</small></label>
      <div class="grid2">
        <label class="field"><span>${esc(T('venue'))}</span><input name="venue" maxlength="120" value="${esc(v.venue)}"></label>
        <label class="field"><span>${esc(T('address'))}</span><input name="address" maxlength="200" value="${esc(v.address)}"></label>
      </div>
      <label class="field"><span>${esc(T('mapUrl'))}</span><input name="mapUrl" type="url" maxlength="500" value="${esc(v.mapUrl)}" placeholder="https://maps.app.goo.gl/…" dir="ltr"></label>
      <label class="field"><span>${esc(T('description'))}</span><textarea name="description" rows="5" maxlength="4000" placeholder="${esc(T('descriptionPh'))}">${esc(v.description)}</textarea></label>
      <h4 class="sub-title">${ic('tag')}${esc(T('ticketTypes'))}</h4>
      <div id="types">${v.tickets.map(typeRow).join('')}</div>
      <button type="button" class="btn line sm" data-add-type>${ic('plus')}${esc(T('addTicketType'))}</button>
      <div class="sep"></div>
      <div class="grid2"><label class="field"><span>${esc(T('capacity'))}</span><input name="capacity" type="number" min="0" value="${esc(v.capacity || '')}" placeholder="∞"><small>${esc(T('capacityHint'))}</small></label></div>
      ${sw('published', v.published !== false, `${esc(T('published'))} <small class="muted">— ${esc(T('publishedHint'))}</small>`)}
      ${sw('salesOpen', v.salesOpen !== false, esc(T('salesOpenLabel')))}
      <div class="modal-actions"><button class="btn" type="submit">${ic('check')}${esc(T('save'))}</button><button class="btn ghost" type="button" data-close>${esc(T('cancel'))}</button></div>
      <p class="error" id="err"></p></form>`, 'wide');
    const f = $('#evf', box);
    const wireCover = () => {
      $('#cover-file', box).addEventListener('change', async (ev) => {
        const file = ev.target.files[0];
        if (!file) return;
        try {
          holder.cover = await uploadFile(file, 1600);
          $('#cover-pick', box).innerHTML = `<img src="${esc(holder.cover)}" alt=""><input type="file" accept="image/*" hidden id="cover-file">`;
          wireCover();
        } catch {
          toast(T('tooLarge'), true);
        }
      });
    };
    wireCover();
    box.addEventListener('click', (ev) => {
      const em = ev.target.closest('[data-emoji]');
      if (em) {
        f.emoji.value = em.dataset.emoji;
        $$('[data-emoji]', box).forEach((b) => b.classList.toggle('active', b === em));
      }
      if (ev.target.closest('[data-add-type]')) $('#types', box).insertAdjacentHTML('beforeend', typeRow({ maxPerOrder: 10 }));
      const rm = ev.target.closest('[data-rm]');
      if (rm && $$('.type-edit', box).length > 1) rm.closest('.type-edit').remove();
    });
    f.title.focus();
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const tickets = $$('.type-edit', box).map((row) => {
        const get = (k) => $(`[data-k="${k}"]`, row);
        return { id: row.dataset.tid, name: get('name').value, price: get('price').value || 0, quantity: get('quantity').value || 0, description: get('description').value, maxPerOrder: get('maxPerOrder').value, salesEnd: get('salesEnd').value, hidden: get('hidden').checked };
      });
      const body = { title: f.title.value, subtitle: f.subtitle.value, emoji: f.emoji.value, cover: holder.cover || '', date: f.date.value, endDate: f.endDate.value, start: f.start.value, end: f.end.value, venue: f.venue.value, address: f.address.value, mapUrl: f.mapUrl.value, description: f.description.value, capacity: f.capacity.value || 0, published: f.published.checked, salesOpen: f.salesOpen.checked, tickets };
      try {
        await api(e ? 'PUT' : 'POST', e ? `/api/admin/events/${e.id}` : '/api/admin/events', body);
        closeModal();
        toast(T('saved'));
        refresh();
      } catch (err) {
        $('#err', box).textContent = T({ title_required: 'titleRequired', invalid_date: 'dateRequired', no_tickets: 'ticketRequired' }[err.code] || 'error');
      }
    });
  }

  // ======================= ORDERS =======================
  const STATUS_FILTERS = ['', 'pending', 'paid', 'cancelled', 'expired'];
  VIEWS.orders = async (view) => {
    const evOpts = state.data.events.slice().reverse().map((e) => `<option value="${e.id}" ${state.ordEvent === e.id ? 'selected' : ''}>${esc(e.title)} · ${esc(fmtDate(e.date, { day: 'numeric', month: 'short' }))}</option>`).join('');
    view.innerHTML = `
      <div class="page-head"><h2 class="title">${esc(T('orders'))}</h2><span style="flex:1"></span><button class="btn" type="button" data-new-order>${ic('plus')}${esc(T('newOrder'))}</button></div>
      <div class="ord-tools"><select class="input" id="oe"><option value="">${esc(T('allEvents'))}</option>${evOpts}</select><input class="input" type="search" id="oq" placeholder="${esc(T('searchOrders'))}" value="${esc(state.q)}"></div>
      <div class="filters" id="of"></div>
      <div class="card" style="padding:6px 16px"><div id="olist"><div class="skeleton-list"></div></div></div>`;
    const load = async () => {
      const r = await api('GET', `/api/admin/orders?event=${state.ordEvent}&status=${state.ordStatus}&q=${encodeURIComponent(state.q)}`);
      $('#of', view).innerHTML = STATUS_FILTERS.map((f) => `<button type="button" data-filter="${f}" class="${state.ordStatus === f ? 'active' : ''}">${esc(T(f ? `st_${f}` : 'all'))} <small>${r.counts[f || 'all']}</small></button>`).join('');
      $('#olist', view).innerHTML = r.orders.length
        ? r.orders.map((o) => `<div class="list-row" data-order="${o.id}"><div class="when"><b>#${o.no}</b>${esc(timeAgo(o.createdAt))}</div><div class="bd"><b>${esc(o.customer.name)}</b><span>${esc(o.eventTitle)} · ${o.items.map((i) => `${i.qty}× ${esc(i.name)}`).join(', ')}</span></div><div class="m-side"><b>${esc(o.total ? money(o.total) : T('free'))}</b>${chip(o.state)}${o.used ? `<small class="muted">${o.used}/${o.count} ${esc(T('inside'))}</small>` : ''}</div></div>`).join('')
        : `<div class="empty-state"><div class="big">🧾</div><p>${esc(T('noOrders'))}</p></div>`;
    };
    $('#oe', view).addEventListener('change', (e) => {
      state.ordEvent = e.target.value;
      load();
    });
    let timer;
    $('#oq', view).addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.q = e.target.value.trim();
        load();
      }, 200);
    });
    view.onclick = (e) => {
      const f = e.target.closest('[data-filter]');
      const o = e.target.closest('[data-order]');
      if (f) {
        state.ordStatus = f.dataset.filter;
        load();
      } else if (o) orderModal(o.dataset.order);
      else if (e.target.closest('[data-new-order]')) newOrderModal();
    };
    await load();
  };

  async function orderModal(id) {
    let o;
    try {
      o = await api('GET', `/api/admin/orders/${id}`);
    } catch {
      return toast(T('error'), true);
    }
    const box = openModal(`
      <div class="detail-head"><div class="bd"><small class="muted">${esc(T('order'))} #${o.no} · ${esc(timeAgo(o.createdAt))}${o.source === 'admin' ? ` · ${esc(T('addedByYou'))}` : ''}</small><h3>${esc(o.customer.name)}</h3><div class="row-chips">${chip(o.state)}${o.customer.phone ? `<a href="tel:${esc(o.customer.phone)}" dir="ltr">${esc(o.customer.phone)}</a>` : ''}${o.customer.email ? `<a href="mailto:${esc(o.customer.email)}">${esc(o.customer.email)}</a>` : ''}</div></div>
        <button class="icon-btn" type="button" data-close aria-label="${esc(T('close'))}">${ic('x')}</button></div>
      <div class="order-box"><b>${esc(o.eventTitle)}</b> <span class="muted">${esc(fmtDate(o.eventDate, { weekday: 'short', day: 'numeric', month: 'short' }))}</span>
        <ul class="lines">${o.items.map((i) => `<li><span>${i.qty}× ${esc(i.name)}</span><b>${esc(i.price ? money(i.price * i.qty) : T('free'))}</b></li>`).join('')}<li class="tot"><span>${esc(T('total'))}</span><b>${esc(o.total ? money(o.total) : T('free'))}</b></li></ul></div>
      <div class="quick-acts">
        ${o.state === 'pending' || o.state === 'expired' ? `<button class="btn sm" type="button" data-o="paid">${ic('check')}${esc(T('markPaid'))}</button>` : ''}
        ${o.customer.phone ? `<button class="btn sm wa" type="button" data-o="wa">${ic('whatsapp')}${esc(o.state === 'paid' ? T('sendTickets') : T('sendPayment'))}</button>` : ''}
        <a class="btn sm ghost" href="${esc(o.orderUrl)}" target="_blank" rel="noopener">${ic('external')}${esc(T('openOrderPage'))}</a>
        ${o.state === 'cancelled' ? `<button class="btn sm line" type="button" data-o="restore">${esc(T('restoreOrder'))}</button>` : `<button class="btn sm danger" type="button" data-o="cancel">${ic('x')}${esc(T('cancelOrder'))}</button>`}
      </div>
      <h4 class="sub-title">${ic('tag')}${esc(T('tickets'))}</h4>
      <div class="tk-admin">${o.tickets.map((t) => `<div class="ci-row"><span class="seat">${t.seq}</span><div class="bd"><b>${esc(t.holder || o.customer.name)}</b><span>${esc(t.typeName)}${t.usedAt ? ` · ${ic('check', 'i xs')} ${esc(new Date(t.usedAt).toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' }))} ${esc(fmtDate(t.usedAt.slice(0, 10), { day: 'numeric', month: 'short' }))}` : ''}</span></div>${o.state === 'paid' ? (t.usedAt ? `<button class="btn sm ghost" type="button" data-undo="${t.id}">${esc(T('undo'))}</button>` : `<button class="btn sm line" type="button" data-ci="${t.id}">${ic('check')}${esc(T('checkInNow'))}</button>`) : ''}</div>`).join('')}</div>
      ${o.customer.notes ? `<p class="note-box">${esc(o.customer.notes)}</p>` : ''}`, 'wide');
    box.addEventListener('click', async (e) => {
      const el = e.target.closest('[data-o],[data-ci],[data-undo]');
      if (!el) return;
      try {
        const act = el.dataset.o;
        if (act === 'paid') {
          const r = await markPaid(id);
          if (r.autoSent) toast(T('cxAutoSent'));
        else if (r.customer.phone && confirm(T('sendTicketsNow'))) openWa(r.whatsappUrl);
        } else if (act === 'wa') return openWa((await api('GET', `/api/admin/orders/${id}/whatsapp`)).url);
        else if (act === 'cancel') {
          if (!confirm(T('cancelOrderConfirm'))) return;
          await api('PUT', `/api/admin/orders/${id}`, { status: 'cancelled' });
        } else if (act === 'restore') await api('PUT', `/api/admin/orders/${id}`, { status: 'pending' });
        else if (el.dataset.ci) {
          const r = await api('POST', '/api/admin/checkin', { ticketId: el.dataset.ci });
          toast(r.ok ? T('checkedInOk') : T(`why_${r.reason}`), !r.ok);
        } else if (el.dataset.undo) await api('DELETE', `/api/admin/tickets/${el.dataset.undo}/checkin`);
        orderModal(id);
        loadData().then(() => setPendingDot(state.data.pending));
        if (state.tab !== 'checkin') refreshList();
      } catch (err) {
        if (err.message !== 'unauthorized') toast(T('error'), true);
      }
    });
  }
  const refreshList = () => (['home', 'orders', 'events'].includes(state.tab) ? renderTab() : null);

  function newOrderModal() {
    const up = state.data.events.filter((e) => !e.past);
    if (!up.length) return toast(T('noUpcoming'), true);
    const pick = state.ordEvent && eventById(state.ordEvent) && !eventById(state.ordEvent).past ? state.ordEvent : up[0].id;
    const typeInputs = (e) => e.tickets.map((t) => `<label class="field qty-field"><span>${esc(t.name)} <small class="muted">${esc(t.price ? money(t.price) : T('free'))}${t.hidden ? ` · ${esc(T('hidden'))}` : ''}${e.stats.remaining[t.id] !== null && e.stats.remaining[t.id] !== undefined ? ` · ${esc(fill(T('leftN'), { n: e.stats.remaining[t.id] }))}` : ''}</small></span><input type="number" min="0" max="50" value="0" data-type="${t.id}"></label>`).join('');
    const box = openModal(`<h3>${ic('plus')}${esc(T('newOrder'))}</h3><p class="muted small">${esc(T('newOrderHint'))}</p><form id="nof">
      <label class="field"><span>${esc(T('event'))}</span><select name="event">${up.map((e) => `<option value="${e.id}" ${e.id === pick ? 'selected' : ''}>${esc(e.title)} · ${esc(fmtDate(e.date, { day: 'numeric', month: 'short' }))}</option>`).join('')}</select></label>
      <div id="qtys" class="grid2">${typeInputs(eventById(pick))}</div>
      <div class="grid2">
        <label class="field"><span>${esc(T('buyerName'))} *</span><input name="name" required maxlength="80"></label>
        <label class="field"><span>${esc(T('phone'))}</span><input name="phone" type="tel" maxlength="30" dir="ltr"></label>
      </div>
      <label class="field"><span>Email</span><input name="email" type="email" maxlength="120" dir="ltr"></label>
      ${sw('paid', true, `${esc(T('alreadyPaid'))} <small class="muted">— ${esc(T('alreadyPaidHint'))}</small>`)}
      <div class="modal-actions"><button class="btn" type="submit">${ic('check')}${esc(T('createOrder'))}</button><button class="btn ghost" type="button" data-close>${esc(T('cancel'))}</button></div>
      <p class="error" id="err"></p></form>`);
    const f = $('#nof', box);
    f.event.addEventListener('change', () => ($('#qtys', box).innerHTML = typeInputs(eventById(f.event.value))));
    f.name.focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const items = $$('[data-type]', box).map((i) => ({ ticketTypeId: i.dataset.type, qty: Number(i.value) || 0 })).filter((i) => i.qty > 0);
      try {
        const r = await api('POST', '/api/admin/orders', { eventId: f.event.value, items, customer: { name: f.name.value, phone: f.phone.value, email: f.email.value }, paid: f.paid.checked });
        closeModal();
        toast(T('saved'));
        if (r.customer.phone) openModal(`<div class="ready-head"><div class="big">🎟️</div><h3>${esc(T('orderCreated'))} #${r.no}</h3><p class="muted">${esc(T('sendTicketsHint'))}</p></div><div class="modal-actions"><a class="btn wa" href="${esc(r.whatsappUrl)}" target="_blank" rel="noopener">${ic('whatsapp')}${esc(T('sendTickets'))}</a><a class="btn ghost" href="${esc(r.orderUrl)}" target="_blank" rel="noopener">${ic('external')}${esc(T('openOrderPage'))}</a></div>`);
        refresh();
      } catch (err) {
        $('#err', box).textContent = T({ no_tickets: 'pickTickets', sold_out: 'notEnoughLeft', name_required: 'nameRequired', invalid_email: 'invalidEmail' }[err.code] || 'error');
      }
    });
  }

  // ======================= CHECK-IN =======================
  VIEWS.checkin = async (view) => {
    if (!state.ciEvent || !eventById(state.ciEvent)) state.ciEvent = defaultEvent();
    const e = eventById(state.ciEvent);
    if (!e) {
      view.innerHTML = `<div class="page-head"><h2 class="title">${esc(T('checkin'))}</h2></div><div class="card"><div class="empty-state"><div class="big">🎟️</div><p>${esc(T('noUpcoming'))}</p></div></div>`;
      return;
    }
    view.innerHTML = `
      <div class="page-head"><h2 class="title">${esc(T('checkin'))}</h2><span style="flex:1"></span>
        <select class="input ev-select" id="cie">${state.data.events.slice().reverse().map((x) => `<option value="${x.id}" ${x.id === e.id ? 'selected' : ''}>${esc(x.title)} · ${esc(fmtDate(x.date, { day: 'numeric', month: 'short' }))}</option>`).join('')}</select></div>
      <div class="card ci-progress"><div><small>${esc(T('checkedIn'))}</small><b id="ci-n">–</b></div><div class="grow">${bar(0, 1)}</div><button class="btn sm line" type="button" data-door>${ic('tablet')}<span class="hide-sm">${esc(T('doorLink'))}</span></button></div>
      <div class="dash-cols ci-cols">
        <div>
          <div class="card scan-card">
            <div class="scan-box" id="scanbox"><video id="video" playsinline muted></video><span class="corners"></span>
              <button type="button" class="btn" id="cam">${ic('qr')}${esc(T('startCamera'))}</button></div>
            <div class="ci-search">${ic('search')}<input class="input" id="ciq" type="search" placeholder="${esc(T('searchAttendee'))}" autocomplete="off"></div>
            <div id="ci-hits" class="ci-hits"></div>
          </div>
          <div id="ci-result"></div>
        </div>
        <div><div class="card"><h3>${ic('check')}${esc(T('recentCheckins'))}</h3><div class="checkin-list" id="ci-list"></div></div></div>
      </div>`;
    const load = async () => {
      const r = await api('GET', `/api/admin/events/${e.id}/checkins`);
      $('#ci-n', view).textContent = `${r.checkedIn} / ${r.sold}`;
      $('.ci-progress .meter i', view).style.width = `${r.sold ? (r.checkedIn / r.sold) * 100 : 0}%`;
      $('#ci-list', view).innerHTML = r.checkins.length ? r.checkins.map((c) => `<div class="ci-row"><span class="av" style="--h:${hue(c.holder)}">${esc((c.holder || '?').charAt(0).toUpperCase())}</span><div class="bd"><b>${esc(c.holder)}</b><span>${esc(c.typeName)} · #${c.orderNo} · ${esc(new Date(c.usedAt).toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' }))} · ${esc(T(c.usedBy === 'door' ? 'byDoor' : 'byDesk'))}</span></div><button class="icon-btn" type="button" data-undo="${c.id}" title="${esc(T('undo'))}" aria-label="${esc(T('undo'))}">${ic('trash')}</button></div>`).join('') : `<p class="muted">${esc(T('noCheckins'))}</p>`;
    };
    const showResult = (r) => {
      const cls = r.ok ? 'ok' : r.reason === 'used' ? 'warn' : 'bad';
      const why = r.ok ? T('checkedInOk') : r.reason === 'used' ? fill(T('alreadyUsedAt'), { time: new Date(r.usedAt).toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' }) }) : r.reason === 'other_event' ? fill(T('otherEventT'), { event: r.eventTitle }) : T(`why_${r.reason}`);
      $('#ci-result', view).innerHTML = `<div class="card result-card ${cls}"><span class="av xl" style="--h:${hue(r.holder || '?')}">${esc((r.holder || '?').charAt(0).toUpperCase())}</span><div class="bd"><small>#${r.orderNo} · ${esc(fill(T('ticketOfT'), { n: r.seq, of: r.of }))}</small><h3>${esc(r.holder)}</h3><p>${ic(r.ok ? 'check' : 'x-circle')}<b>${esc(why)}</b></p><span class="muted">${esc(r.typeName)}</span></div></div>`;
      if (window.QrScanner) window.QrScanner.beep(r.ok);
      load();
    };
    const checkIn = async (body) => {
      try {
        showResult(await api('POST', '/api/admin/checkin', { ...body, eventId: e.id }));
      } catch (err) {
        if (err.code === 'unknown_ticket') {
          if (window.QrScanner) window.QrScanner.beep(false);
          $('#ci-result', view).innerHTML = `<div class="card result-card bad"><div class="bd"><h3>${esc(T('unknownTicket'))}</h3></div></div>`;
        } else toast(T('error'), true);
      }
    };
    $('#cie', view).addEventListener('change', (ev) => {
      state.ciEvent = ev.target.value;
      if (state.stopScan) {
        state.stopScan();
        state.stopScan = null;
      }
      renderTab();
    });
    $('#cam', view).addEventListener('click', async () => {
      try {
        if (!window.QrScanner) await new Promise((res, rej) => {
          const sc = document.createElement('script');
          sc.src = '/js/scanner.js';
          sc.onload = res;
          sc.onerror = rej;
          document.head.appendChild(sc);
        });
        state.stopScan = await window.QrScanner.start($('#video', view), (code) => checkIn({ code }));
        $('#scanbox', view).classList.add('live');
      } catch {
        toast(T('cameraError'), true);
      }
    });
    let timer;
    const q = $('#ciq', view);
    q.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const v = q.value.trim();
        const box = $('#ci-hits', view);
        if (!v) return (box.innerHTML = '');
        const r = await api('GET', `/api/admin/orders?event=${e.id}&q=${encodeURIComponent(v)}`);
        const orders = r.orders.slice(0, 5);
        const details = await Promise.all(orders.map((o) => api('GET', `/api/admin/orders/${o.id}`)));
        box.innerHTML = details.map((o) => `<div class="ci-order"><div class="hd"><b>#${o.no} · ${esc(o.customer.name)}</b>${chip(o.state)}</div>${o.tickets.map((t) => `<div class="ci-tk"><span>${t.seq}. ${esc(t.holder || o.customer.name)} · ${esc(t.typeName)}</span>${o.state !== 'paid' ? '' : t.usedAt ? `<small class="muted">${ic('check', 'i xs')} ${esc(new Date(t.usedAt).toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' }))}</small>` : `<button class="btn sm" type="button" data-ci="${t.id}">${esc(T('checkInNow'))}</button>`}</div>`).join('')}${o.state === 'pending' ? `<button class="btn sm line" type="button" data-pay="${o.id}">${esc(T('markPaid'))}</button>` : ''}</div>`).join('') || `<p class="muted small">${esc(T('noMatches'))}</p>`;
      }, 250);
    });
    view.onclick = async (ev) => {
      const ci = ev.target.closest('[data-ci]');
      const un = ev.target.closest('[data-undo]');
      const pay = ev.target.closest('[data-pay]');
      if (ci) {
        await checkIn({ ticketId: ci.dataset.ci });
        q.dispatchEvent(new Event('input'));
      } else if (un) {
        await api('DELETE', `/api/admin/tickets/${un.dataset.undo}/checkin`);
        load();
      } else if (pay) {
        await markPaid(pay.dataset.pay);
        q.dispatchEvent(new Event('input'));
      } else if (ev.target.closest('[data-door]')) doorModal(e);
    };
    load();
    q.focus();
  };

  // ======================= SHARE =======================
  VIEWS.share = async (view) => {
    const s = state.data.settings;
    const link = state.data.baseUrl;
    const qr = `/api/admin/qr.svg?text=${encodeURIComponent(link)}`;
    const text = `${T('shareText').replace('{name}', s.name)}\n${link}`;
    view.innerHTML = `
      <h2 class="title">${esc(T('shareTitle'))}</h2>
      <div class="card"><div class="qr-box"><img src="${qr}" alt="QR"><div>
        <p class="muted">${esc(T('shareSub'))}</p>
        <div class="share-row" style="margin-bottom:10px"><input class="input" readonly value="${esc(link)}"><button class="btn sm" data-act="copy" data-text="${esc(link)}">${ic('copy')}${esc(T('copy'))}</button></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn line sm" href="${qr}" download="qr-${esc(s.name)}.svg">${ic('download')}${esc(T('downloadQr'))}</a>
          <a class="btn line sm" href="/admin/poster" target="_blank">${ic('print')}${esc(T('printPoster'))}</a>
          <a class="btn wa sm" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${ic('whatsapp')}${esc(T('shareWhatsApp'))}</a>
        </div></div></div></div>
      ${upcomingEvents().length ? `<div class="card"><h3>${ic('calendar')}${esc(T('eventLinks'))}</h3>${upcomingEvents().map((e) => `<div class="list-row static">${evThumb(e)}<div class="bd"><b>${esc(e.title)}</b><span dir="ltr">${esc(e.url)}</span></div><div class="acts"><button class="btn sm ghost" type="button" data-act="copy" data-text="${esc(e.url)}">${ic('copy')}</button><a class="btn sm ghost" href="/admin/poster?event=${e.id}" target="_blank" aria-label="${esc(T('printPoster'))}">${ic('print')}</a><a class="btn sm wa" href="https://wa.me/?text=${encodeURIComponent(`${e.title} — ${whenShort(e)}\n${e.url}`)}" target="_blank" rel="noopener" aria-label="WhatsApp">${ic('whatsapp')}</a></div></div>`).join('')}</div>` : ''}
      <div class="card"><h3>${ic('bulb')}${esc(T('tipsTitle'))}</h3><ul class="checklist">${['tip1', 'tip2', 'tip3', 'tip4'].map((k) => `<li><span class="tick">${ic('sparkles')}</span>${esc(T(k))}</li>`).join('')}</ul></div>`;
  };

  // ======================= DESIGN =======================
  const COLORS = ['#7c3aed', '#db2777', '#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0f766e', '#0284c7', '#2563eb', '#111827'];
  const themeMini = (th) => `<div class="tp tp-${th}" aria-hidden="true"><i class="h"></i><div class="rows"><i><b></b></i><i><b></b></i><i><b></b></i><i><b></b></i></div></div>`;
  function loadFontCss(fonts) {
    for (const f of fonts) {
      if ($(`link[data-font-css="${f.key}"]`)) continue;
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = f.href;
      l.dataset.fontCss = f.key;
      document.head.appendChild(l);
    }
  }

  VIEWS.appearance = async (view) => {
    const s = state.data.settings;
    const opts = state.data.appearance;
    const draft = { theme: s.theme || 'fresh', color: s.color, font: s.font || 'cairo', logo: s.logo, cover: s.cover };
    const KEYS = Object.keys(draft);
    loadFontCss(opts.fonts);
    const imgPick = (key, wide) => `<div class="img-pick"><div class="preview${wide ? ' wide' : ''}" id="${key}-prev"></div><div style="display:grid;gap:6px"><label class="btn sm line" style="cursor:pointer">${ic('upload')}${esc(T('uploadImage'))}<input type="file" accept="image/*" id="${key}-file" hidden></label><button type="button" class="btn sm ghost" id="${key}-rm">${ic('trash')}${esc(T('removeImage'))}</button></div></div>`;
    view.innerHTML = `
      <div class="page-head"><h2 class="title">${esc(T('appearance'))}</h2><span class="unsaved" id="unsaved" hidden><i></i>${esc(T('unsaved'))}</span></div>
      <div class="design">
        <div class="design-controls">
          <div class="card"><h3>${ic('sparkles')}${esc(T('themeLabel'))}</h3>
            <div class="themes">${opts.themes.map((th) => `<button type="button" class="theme-card" data-theme="${th}">${themeMini(th)}<b>${esc(T(`theme_${th}`))}</b><span>${esc(T(`themeDesc_${th}`))}</span></button>`).join('')}</div></div>
          <div class="card"><h3>${ic('palette')}${esc(T('brandColor'))}</h3>
            <div class="swatches" id="swatches">${COLORS.map((c) => `<button type="button" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}<label class="custom-color"><input type="color" id="color" value="${esc(draft.color)}"></label></div></div>
          <div class="card"><h3><span class="aa">Aa</span>${esc(T('font'))}</h3>
            <div class="fonts">${opts.fonts.map((f) => `<button type="button" class="font-card" data-font="${f.key}" style="font-family:${esc(f.stack)}"><span class="sample">Aa أب</span><small>${esc(f.label)}</small></button>`).join('')}</div></div>
          <div class="card"><h3>${ic('image')}${esc(T('logo'))} · ${esc(T('cover'))}</h3>
            <div class="grid2"><div class="field"><span>${esc(T('logo'))}</span>${imgPick('logo')}</div><div class="field"><span>${esc(T('cover'))}</span>${imgPick('cover', true)}</div></div></div>
          <div class="save-bar"><button class="btn block" type="button" id="dsave">${ic('check')}${esc(T('save'))}</button></div>
        </div>
        <div class="design-preview">
          <div class="phone"><div class="notch"></div><iframe id="pv" src="/?preview=1&lang=${encodeURIComponent(s.lang)}" title="${esc(T('livePreview'))}"></iframe></div>
          <p class="muted small preview-hint">${ic('eye')}<span>${esc(T('previewHint'))}</span></p>
        </div>
      </div>`;
    const pv = $('#pv');
    const send = () => {
      const font = opts.fonts.find((f) => f.key === draft.font) || opts.fonts[0];
      if (pv.contentWindow) pv.contentWindow.postMessage({ type: 'tazkara-preview', theme: draft.theme, color: draft.color, fontStack: font.stack, fontHref: font.href, logo: draft.logo, cover: draft.cover }, location.origin);
    };
    const sync = () => {
      $$('.theme-card', view).forEach((b) => b.classList.toggle('active', b.dataset.theme === draft.theme));
      $$('.font-card', view).forEach((b) => b.classList.toggle('active', b.dataset.font === draft.font));
      $$('#swatches [data-color]', view).forEach((b) => b.classList.toggle('active', b.dataset.color.toLowerCase() === draft.color.toLowerCase()));
      $('#color').value = draft.color;
      view.style.setProperty('--c', draft.color);
      $('#logo-prev').innerHTML = draft.logo ? `<img src="${esc(draft.logo)}" alt="">` : ic('store');
      $('#cover-prev').innerHTML = draft.cover ? `<img src="${esc(draft.cover)}" alt="">` : ic('image');
      $('#logo-rm').hidden = !draft.logo;
      $('#cover-rm').hidden = !draft.cover;
      $('#unsaved').hidden = !KEYS.some((k) => (draft[k] || '') !== (s[k] || ''));
      send();
    };
    pv.addEventListener('load', send);
    view.onclick = (e) => {
      const th = e.target.closest('[data-theme]');
      const fo = e.target.closest('[data-font]');
      const co = e.target.closest('[data-color]');
      if (th) draft.theme = th.dataset.theme;
      else if (fo) draft.font = fo.dataset.font;
      else if (co) draft.color = co.dataset.color;
      else return;
      sync();
    };
    $('#color').addEventListener('input', (e) => { draft.color = e.target.value; sync(); });
    for (const [key, max] of [['logo', 512], ['cover', 1600]]) {
      $(`#${key}-file`).addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try { draft[key] = await uploadFile(f, max); sync(); } catch { toast(T('tooLarge'), true); }
      });
      $(`#${key}-rm`).addEventListener('click', () => { draft[key] = ''; sync(); });
    }
    $('#dsave').addEventListener('click', async () => {
      try {
        const { settings } = await api('PUT', '/api/admin/settings', draft);
        state.data.settings = settings;
        document.documentElement.style.setProperty('--brand', settings.color);
        toast(T('saved'));
        renderShell();
      } catch {
        toast(T('error'), true);
      }
    });
    sync();
  };

  // ======================= CONNECTIONS =======================
  // Shared by every app: online payments, automatic WhatsApp, email,
  // Telegram, push notifications on this device, automatic backups.
  const copyRow = (value) => `<div class="share-row"><input class="input" readonly value="${esc(value)}" dir="ltr"><button class="btn sm" data-act="copy" data-text="${esc(value)}" type="button">${ic('copy')}</button></div>`;
  const failMsg = (err) => (err.code === 'demo' ? T('demoBlocked') : T({ invalid_key: 'cxInvalidKey', invalid_currency: 'cxInvalidCurrency', invalid_integration: 'cxInvalidIntegration', invalid_email: 'cxInvalidEmail', invalid_host: 'cxInvalidHost', invalid_port: 'cxInvalidPort', invalid_phone_id: 'cxInvalidPhoneId', invalid_template: 'cxInvalidTemplate', invalid_phone: 'cxInvalidPhone', not_ready: 'cxNotReady', payments_off: 'cxNotReady' }[err.code] || 'error'));
  const connChip = (on, label) => (on ? `<span class="ok-chip">${ic('check')}${esc(label || T('notifyConnected'))}</span>` : '');
  const fval = (f, name) => (f[name] ? (f[name].type === 'checkbox' ? f[name].checked : f[name].value) : undefined);

  async function renderPayments(box) {
    const p = await api('GET', '/api/admin/payments');
    const curGuess = /^[A-Z]{3}$/.test(state.data.settings.currency || '') ? state.data.settings.currency : 'EGP';
    box.innerHTML = `
      <h3>${ic('cash')}${esc(T('cxPayments'))}${connChip(p.ready, p.testMode ? T('cxTestMode') : T('cxLive'))}</h3>
      <p class="muted small" style="margin-top:-6px">${esc(T('cxPaymentsHint'))}</p>
      <form id="payf">
        <div class="grid2">
          <label class="field"><span>${esc(T('cxProvider'))}</span><select name="provider"><option value="">${esc(T('cxNone'))}</option><option value="paymob" ${p.provider === 'paymob' ? 'selected' : ''}>Paymob (${esc(T('cxPaymobWhere'))})</option><option value="stripe" ${p.provider === 'stripe' ? 'selected' : ''}>Stripe (${esc(T('cxStripeWhere'))})</option></select></label>
          <label class="field"><span>${esc(T('cxCurrency'))}</span><input name="currency" maxlength="3" value="${esc(p.currency || curGuess)}" dir="ltr" style="text-transform:uppercase"><small>${esc(T('cxCurrencyHint'))}</small></label>
        </div>
        <div data-for="stripe" ${p.provider === 'stripe' ? '' : 'hidden'}>
          <ol class="steps-list"><li>${esc(T('cxStripeStep1'))}</li><li>${esc(T('cxStripeStep2'))}</li></ol>
          <label class="field"><span>${esc(T('cxSecretKey'))}</span><input name="stripeSecret" autocomplete="off" spellcheck="false" placeholder="sk_live_… / sk_test_…" dir="ltr">${p.stripeHasKey ? `<small>${esc(T('tokenSaved').replace('{hint}', p.stripeHint))}</small>` : ''}</label>
          <label class="field"><span>${esc(T('cxWebhookSecret'))} <small class="muted">(${esc(T('optional'))})</small></span><input name="stripeWebhookSecret" autocomplete="off" spellcheck="false" placeholder="whsec_…" dir="ltr"><small>${esc(T('cxStripeWebhookHint'))}</small></label>
          ${copyRow(p.stripeWebhookUrl)}
        </div>
        <div data-for="paymob" ${p.provider === 'paymob' ? '' : 'hidden'}>
          <ol class="steps-list"><li>${esc(T('cxPaymobStep1'))}</li><li>${esc(T('cxPaymobStep2'))}</li></ol>
          <div class="grid2">
            <label class="field"><span>${esc(T('cxRegion'))}</span><select name="paymobRegion">${[['eg', '🇪🇬 Egypt'], ['sa', '🇸🇦 Saudi Arabia'], ['ae', '🇦🇪 UAE'], ['om', '🇴🇲 Oman']].map(([k, l]) => `<option value="${k}" ${p.paymobRegion === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field"><span>${esc(T('cxIntegrationIds'))}</span><input name="paymobIntegrations" value="${esc(p.paymobIntegrations)}" placeholder="1234567, 7654321" dir="ltr"></label>
            <label class="field"><span>${esc(T('cxPublicKey'))}</span><input name="paymobPublic" value="${esc(p.paymobPublic)}" placeholder="egy_pk_…" dir="ltr" spellcheck="false"></label>
            <label class="field"><span>${esc(T('cxSecretKey'))}</span><input name="paymobSecret" autocomplete="off" placeholder="${p.paymobHasSecret ? '••••••••' : 'egy_sk_…'}" dir="ltr" spellcheck="false"></label>
            <label class="field"><span>HMAC</span><input name="paymobHmac" autocomplete="off" placeholder="${p.paymobHasHmac ? '••••••••' : ''}" dir="ltr" spellcheck="false"></label>
          </div>
          <small class="muted">${esc(T('cxPaymobCallbackHint'))}</small>${copyRow(p.paymobCallbackUrl)}
        </div>
        <div class="btn-row"><button class="btn" type="submit">${ic('check')}${esc(T('save'))}</button>
          <button class="btn line" type="button" data-pay-test ${p.ready ? '' : 'disabled'}>${ic('external')}${esc(T('cxTestPayment'))}</button>
          ${p.provider ? `<button class="btn danger" type="button" data-pay-clear>${esc(T('disconnect'))}</button>` : ''}</div>
      </form>`;
    const f = $('#payf', box);
    f.provider.addEventListener('change', () => $$('[data-for]', box).forEach((d) => (d.hidden = d.dataset.for !== f.provider.value)));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      for (const k of ['provider', 'currency', 'stripeSecret', 'stripeWebhookSecret', 'paymobRegion', 'paymobIntegrations', 'paymobPublic', 'paymobSecret', 'paymobHmac']) body[k] = fval(f, k);
      try {
        await api('PUT', '/api/admin/payments', body);
        toast(T('saved'));
        renderPayments(box);
      } catch (err) { toast(failMsg(err), true); }
    });
    box.addEventListener('click', async (e) => {
      try {
        if (e.target.closest('[data-pay-test]')) {
          const r = await api('POST', '/api/admin/payments/test', {});
          window.open(r.url, '_blank');
        } else if (e.target.closest('[data-pay-clear]')) {
          if (!confirm(T('cxDisconnectConfirm'))) return;
          await api('PUT', '/api/admin/payments', { clear: true });
          renderPayments(box);
        }
      } catch (err) { toast(err.message && err.code === 'provider_error' ? `${T('cxProviderError')}` : failMsg(err), true); }
    });
  }

  async function renderWhatsApp(box) {
    const w = await api('GET', '/api/admin/whatsapp');
    const sample = (k) => (k.sample[lang] || k.sample.en || '').replace(/\{\{(\d)\}\}/g, (m, n) => `{{${n}}}`);
    box.innerHTML = `
      <h3>${ic('whatsapp')}${esc(T('cxWhatsApp'))}${connChip(w.ready)}</h3>
      <p class="muted small" style="margin-top:-6px">${esc(T('cxWhatsAppHint'))}</p>
      <details class="how"><summary>${esc(T('cxHowToConnect'))}</summary><ol class="steps-list"><li>${esc(T('cxWaStep1'))}</li><li>${esc(T('cxWaStep2'))}</li><li>${esc(T('cxWaStep3'))}</li><li>${esc(T('cxWaStep4'))}</li></ol></details>
      <form id="waf">
        <div class="grid2">
          <label class="field"><span>${esc(T('cxPhoneNumberId'))}</span><input name="phoneNumberId" value="${esc(w.phoneNumberId)}" inputmode="numeric" dir="ltr"></label>
          <label class="field"><span>${esc(T('cxTemplateLang'))}</span><input name="language" value="${esc(w.language || (lang === 'ar' ? 'ar' : 'en'))}" dir="ltr" maxlength="10"><small>ar · en · en_US · es · fr · tr · id · hi · pt_BR</small></label>
        </div>
        <label class="field"><span>${esc(T('cxAccessToken'))}</span><input name="token" autocomplete="off" spellcheck="false" placeholder="EAAG…" dir="ltr">${w.hasToken ? `<small>${esc(T('tokenSaved').replace('{hint}', w.tokenHint))}</small>` : ''}</label>
        <h4 class="sub-title">${ic('sparkles')}${esc(T('cxAutoMessages'))}</h4>
        <p class="muted small">${esc(T('cxTemplatesHint'))}</p>
        <div class="tpl-list">${w.kinds.map((k) => `<div class="tpl" data-kind="${esc(k.key)}">
          <label class="check"><span class="switch"><input type="checkbox" data-k="enabled" ${k.enabled ? 'checked' : ''}><i></i></span><span><b>${esc(T(`wa_${k.key}`))}</b></span></label>
          <div class="tpl-body"><code dir="auto">${esc(sample(k))}</code><button class="icon-btn" type="button" data-act="copy" data-text="${esc(sample(k))}" aria-label="${esc(T('copy'))}">${ic('copy')}</button></div>
          <label class="field tpl-name"><span>${esc(T('cxTemplateName'))}</span><input data-k="name" value="${esc(k.name)}" dir="ltr" spellcheck="false"></label>
        </div>`).join('')}</div>
        <div class="btn-row"><button class="btn" type="submit">${ic('check')}${esc(T('save'))}</button>${w.hasToken ? `<button class="btn danger" type="button" data-wa-clear>${esc(T('disconnect'))}</button>` : ''}</div>
      </form>
      ${w.ready ? `<div class="share-row" style="margin-top:14px"><input class="input" id="wa-to" placeholder="${esc(T('cxTestNumber'))}" dir="ltr" inputmode="tel"><button class="btn line" type="button" data-wa-test>${ic('whatsapp')}${esc(T('sendTest'))}</button></div>` : ''}
      ${w.log.length ? `<details class="how"><summary>${esc(T('cxRecentMessages'))}</summary><ul class="wa-log">${w.log.map((l) => `<li class="${l.ok ? 'ok' : 'bad'}">${ic(l.ok ? 'check' : 'x-circle', 'i xs')}<span>${esc(new Date(l.at).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' }))} · ${esc(l.kind)} · ${esc(l.to)}</span>${l.error ? `<small>${esc(l.error)}</small>` : ''}</li>`).join('')}</ul></details>` : ''}`;
    const f = $('#waf', box);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const templates = {};
      for (const row of $$('.tpl', box)) templates[row.dataset.kind] = { enabled: $('[data-k=enabled]', row).checked, name: $('[data-k=name]', row).value };
      try {
        await api('PUT', '/api/admin/whatsapp', { token: f.token.value, phoneNumberId: f.phoneNumberId.value, language: f.language.value, templates });
        toast(T('saved'));
        renderWhatsApp(box);
      } catch (err) { toast(failMsg(err), true); }
    });
    box.addEventListener('click', async (e) => {
      try {
        if (e.target.closest('[data-wa-test]')) {
          await api('POST', '/api/admin/whatsapp/test', { to: $('#wa-to', box).value });
          toast(T('testSent'));
          renderWhatsApp(box);
        } else if (e.target.closest('[data-wa-clear]')) {
          if (!confirm(T('cxDisconnectConfirm'))) return;
          await api('PUT', '/api/admin/whatsapp', { clear: true });
          renderWhatsApp(box);
        }
      } catch (err) { toast(err.code ? failMsg(err) : T('testFailed'), true); renderWhatsApp(box); }
    });
  }

  async function renderEmail(box) {
    const m = await api('GET', '/api/admin/email');
    box.innerHTML = `
      <h3>${ic('mail')}${esc(T('cxEmail'))}${connChip(m.ready)}</h3>
      <p class="muted small" style="margin-top:-6px">${esc(T('cxEmailHint'))}</p>
      <form id="emf">
        <div class="grid3">
          <label class="field"><span>${esc(T('cxSmtpHost'))}</span><input name="host" value="${esc(m.host)}" placeholder="smtp.hostinger.com" dir="ltr" spellcheck="false"></label>
          <label class="field"><span>${esc(T('cxPort'))}</span><input name="port" type="number" value="${esc(m.port)}" dir="ltr"></label>
          <label class="field"><span>&nbsp;</span>${sw('secure', m.secure, 'SSL/TLS (465)')}</label>
          <label class="field"><span>${esc(T('cxUsername'))}</span><input name="user" value="${esc(m.user)}" autocomplete="off" dir="ltr" spellcheck="false"></label>
          <label class="field"><span>${esc(T('password'))}</span><input name="pass" type="password" autocomplete="new-password" placeholder="${m.hasPass ? '••••••••' : ''}"></label>
          <label class="field"><span>${esc(T('cxFrom'))}</span><input name="from" value="${esc(m.from)}" placeholder="${esc(state.data.settings.name)} &lt;hello@yourdomain.com&gt;" dir="ltr"></label>
        </div>
        <label class="field"><span>${esc(T('cxOwnerEmail'))}</span><input name="ownerEmail" type="email" value="${esc(m.ownerEmail)}" dir="ltr"></label>
        ${sw('alerts', m.alerts, esc(T('cxEmailAlerts')))}
        ${sw('backups', m.backups, esc(T('cxEmailBackups')))}
        <div class="btn-row"><button class="btn" type="submit">${ic('check')}${esc(T('save'))}</button><button class="btn line" type="button" data-em-test ${m.ready ? '' : 'disabled'}>${ic('mail')}${esc(T('sendTest'))}</button>${m.host ? `<button class="btn danger" type="button" data-em-clear>${esc(T('disconnect'))}</button>` : ''}</div>
      </form>`;
    const f = $('#emf', box);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      for (const k of ['host', 'port', 'secure', 'user', 'pass', 'from', 'ownerEmail', 'alerts', 'backups']) body[k] = fval(f, k);
      try {
        await api('PUT', '/api/admin/email', body);
        toast(T('saved'));
        renderEmail(box);
      } catch (err) { toast(failMsg(err), true); }
    });
    box.addEventListener('click', async (e) => {
      try {
        if (e.target.closest('[data-em-test]')) {
          await api('POST', '/api/admin/email/test', { text: T('testMessage') });
          toast(T('testSent'));
        } else if (e.target.closest('[data-em-clear]')) {
          if (!confirm(T('cxDisconnectConfirm'))) return;
          await api('PUT', '/api/admin/email', { clear: true });
          renderEmail(box);
        }
      } catch (err) { toast(err.code === 'not_ready' ? T('cxNotReady') : `${T('testFailed')}`, true); }
    });
  }

  async function swRegistration() {
    if (!('serviceWorker' in navigator)) return null;
    return navigator.serviceWorker.register('/admin-sw.js', { scope: '/admin' });
  }

  async function renderPush(box) {
    const p = await api('GET', '/api/admin/push');
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    let sub = null;
    if (supported) {
      try { const reg = await swRegistration(); sub = reg && (await reg.pushManager.getSubscription()); } catch { sub = null; }
    }
    const ios = /iPhone|iPad/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches;
    box.innerHTML = `
      <h3>${ic('bell')}${esc(T('cxPush'))}${connChip(!!sub, T('cxThisDeviceOn'))}</h3>
      <p class="muted small" style="margin-top:-6px">${esc(T('cxPushHint'))}</p>
      ${ios ? `<p class="note-box">${ic('external', 'i xs')} ${esc(T('cxIosHint'))}</p>` : ''}
      <p class="muted small">${esc(T('cxDevices').replace('{n}', p.devices))}</p>
      <div class="btn-row">${!supported ? `<span class="muted">${esc(T('cxPushUnsupported'))}</span>` : sub ? `<button class="btn line" type="button" data-push-test>${ic('bell')}${esc(T('sendTest'))}</button><button class="btn danger" type="button" data-push-off>${esc(T('cxTurnOff'))}</button>` : `<button class="btn" type="button" data-push-on>${ic('bell')}${esc(T('cxTurnOn'))}</button>`}</div>`;
    box.onclick = async (e) => {
      try {
        if (e.target.closest('[data-push-on]')) {
          if ((await Notification.requestPermission()) !== 'granted') return toast(T('cxPushDenied'), true);
          const reg = await swRegistration();
          const key = Uint8Array.from(atob(p.publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
          const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
          await api('POST', '/api/admin/push/subscribe', { subscription: s.toJSON() });
          toast(T('saved'));
          renderPush(box);
        } else if (e.target.closest('[data-push-test]')) {
          const r = await api('POST', '/api/admin/push/test', { text: T('testMessage') });
          toast(r.sent ? T('testSent') : T('testFailed'), !r.sent);
        } else if (e.target.closest('[data-push-off]')) {
          const reg = await swRegistration();
          const s = await reg.pushManager.getSubscription();
          if (s) {
            await api('POST', '/api/admin/push/unsubscribe', { endpoint: s.endpoint });
            await s.unsubscribe();
          }
          renderPush(box);
        }
      } catch {
        toast(T('error'), true);
      }
    };
  }

  async function renderBackups(box) {
    const b = await api('GET', '/api/admin/backups');
    const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;
    box.innerHTML = `
      <h3>${ic('download')}${esc(T('cxBackups'))}</h3>
      <p class="muted small" style="margin-top:-6px">${esc(T('cxBackupsHint').replace('{n}', b.keep))}</p>
      ${b.backups.length ? `<ul class="backup-list">${b.backups.map((x) => `<li><span>${esc(fmtDate(x.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</span><small class="muted">${kb(x.size)}</small><a class="btn sm ghost" href="/api/admin/backups/${x.date}" download>${ic('download')}</a></li>`).join('')}</ul>` : `<p class="muted">${esc(T('cxNoBackups'))}</p>`}
      <button class="btn line sm" type="button" data-bk-now>${ic('download')}${esc(T('cxBackupNow'))}</button>`;
    box.onclick = async (e) => {
      if (!e.target.closest('[data-bk-now]')) return;
      try {
        await api('POST', '/api/admin/backups/now', {});
        toast(T('saved'));
        renderBackups(box);
      } catch (err) { toast(failMsg(err), true); }
    };
  }

  VIEWS.connect = async (view) => {
    view.innerHTML = `
      <h2 class="title">${esc(T('connect'))}</h2>
      <p class="muted" style="margin:-10px 0 16px">${esc(T('cxIntro'))}</p>
      <div class="card" id="cx-pay"></div>
      <div class="card" id="cx-wa"></div>
      <div class="grid2 gap cx-cols"><div class="card" id="cx-push"></div><div class="card" id="notify-card"></div></div>
      <div class="card" id="cx-email"></div>
      <div class="card" id="cx-backup"></div>`;
    await Promise.all([
      renderPayments($('#cx-pay', view)),
      renderWhatsApp($('#cx-wa', view)),
      renderPush($('#cx-push', view)),
      renderNotify($('#notify-card', view)),
      renderEmail($('#cx-email', view)),
      renderBackups($('#cx-backup', view)),
    ]);
  };

  // ======================= SETTINGS =======================
  // ---- Telegram notifications card (Settings) ----
  async function renderNotify(box) {
    const n = await api('GET', '/api/admin/notify');
    box.innerHTML = `
      <h3>${ic('bell')}${esc(T('notifications'))}${n.connected ? `<span class="ok-chip">${ic('check')}${esc(T('notifyConnected'))}</span>` : ''}</h3>
      <p class="muted small" style="margin-top:-6px">${esc(T('notifyHint'))}</p>
      <ol class="steps-list"><li>${esc(T('notifyStep1'))}</li><li>${esc(T('notifyStep2'))}</li><li>${esc(T('notifyStep3'))}</li></ol>
      <form id="nf">
        <label class="field"><span>${esc(T('botToken'))}</span><input name="token" autocomplete="off" spellcheck="false" placeholder="123456789:AA…" dir="ltr">${n.hasToken ? `<small>${esc(T('tokenSaved').replace('{hint}', n.tokenHint))}</small>` : ''}</label>
        <div class="share-row" style="align-items:flex-end">
          <label class="field" style="flex:1;margin:0"><span>${esc(T('chatId'))}</span><input name="chat" value="${esc(n.telegramChat)}" dir="ltr"></label>
          <button class="btn line" type="button" id="ndetect">${ic('search')}${esc(T('detectChat'))}</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
          <button class="btn" type="submit">${ic('check')}${esc(T('save'))}</button>
          <button class="btn line" type="button" id="ntest" ${n.connected ? '' : 'disabled'}>${ic('bell')}${esc(T('sendTest'))}</button>
          ${n.hasToken ? `<button class="btn danger" type="button" id="nclear">${esc(T('disconnect'))}</button>` : ''}
        </div>
      </form>`;
    const f = $('#nf', box);
    const fail = (err, fallback) => toast(err.code === 'demo' ? T('demoBlocked') : err.code === 'invalid_token' ? T('invalidToken') : T(fallback), true);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('PUT', '/api/admin/notify', { telegramToken: f.token.value, telegramChat: f.chat.value });
        toast(T('saved'));
        renderNotify(box);
      } catch (err) { fail(err, 'error'); }
    });
    $('#ndetect', box).addEventListener('click', async () => {
      try {
        const r = await api('POST', '/api/admin/notify/detect', { telegramToken: f.token.value });
        if (!r.chats.length) return toast(T('chatNotFound'), true);
        f.chat.value = r.chats[0].id;
        toast(`${T('chatFound')} ${r.chats[0].name}`);
      } catch (err) { fail(err, 'chatNotFound'); }
    });
    $('#ntest', box).addEventListener('click', async () => {
      try {
        await api('POST', '/api/admin/notify/test', { text: T('testMessage') });
        toast(T('testSent'));
      } catch (err) { fail(err, 'testFailed'); }
    });
    const clear = $('#nclear', box);
    if (clear) clear.addEventListener('click', async () => {
      try { await api('PUT', '/api/admin/notify', { clear: true }); renderNotify(box); } catch (err) { fail(err, 'error'); }
    });
  }

  VIEWS.settings = async (view) => {
    const s = state.data.settings;
    view.innerHTML = `
      <h2 class="title">${esc(T('settings'))}</h2>
      <form id="sf">
        <div class="card"><h3>${ic('store')}${esc(T('organizer'))}</h3>
          <div class="grid2">
            <label class="field"><span>${esc(T('orgName'))}</span><input name="name" maxlength="80" value="${esc(s.name)}"></label>
            <label class="field"><span>${esc(T('defaultLang'))}</span><select name="lang">${langOptions(s.lang)}</select></label>
          </div>
          <label class="field"><span>${esc(T('tagline'))}</span><input name="tagline" maxlength="140" value="${esc(s.tagline)}"></label>
          <label class="field"><span>${esc(T('about'))}</span><textarea name="about" rows="2" maxlength="1000">${esc(s.about)}</textarea></label>
          <div class="grid2">
            <label class="field"><span>${esc(T('whatsapp'))}</span><input name="whatsapp" type="tel" maxlength="20" value="${esc(s.whatsapp)}"><small>${esc(T('whatsappHint'))}</small></label>
            <label class="field"><span>${esc(T('currency'))}</span><input name="currency" maxlength="12" value="${esc(s.currency)}"></label>
          </div>
          <label class="field"><span>${esc(T('timezone'))}</span><input name="timezone" list="tzlist" value="${esc(s.timezone || browserTimezone())}"></label>
          <datalist id="tzlist">${timezones().map((z) => `<option value="${esc(z)}">`).join('')}</datalist>
        </div>
        <div class="card"><h3>${ic('cash')}${esc(T('payments'))}</h3>
          <p class="muted small" style="margin-top:-6px">${esc(T('paymentsHint'))}</p>
          <label class="field"><span>${esc(T('paymentInfo'))}</span><textarea name="paymentInfo" rows="2" maxlength="400" placeholder="${esc(T('paymentInfoPh'))}">${esc(s.paymentInfo || '')}</textarea></label>
          <div class="grid2">
            <label class="field"><span>${esc(T('paymentLink'))}</span><input name="paymentLink" type="url" maxlength="500" value="${esc(s.paymentLink || '')}" placeholder="https://…" dir="ltr"></label>
            <label class="field"><span>${esc(T('holdHours'))}</span><div class="unit"><input name="holdHours" type="number" min="0" max="720" value="${esc(s.holdHours)}"><span>${esc(T('unitHours'))}</span></div><small>${esc(T('holdHoursHint'))}</small></label>
          </div>
          <label class="field"><span>${esc(T('policy'))}</span><textarea name="policy" rows="2" maxlength="800" placeholder="${esc(T('policyPh'))}">${esc(s.policy)}</textarea></label>
        </div>
        <div class="card"><h3>${ic('phone')}${esc(T('contact'))}</h3>
          <div class="grid2">
            <label class="field"><span>${esc(T('phone'))}</span><input name="phone" type="tel" maxlength="30" value="${esc(s.phone)}"></label>
            <label class="field"><span>Email</span><input name="email" type="email" maxlength="120" value="${esc(s.email || '')}"></label>
            <label class="field"><span>Instagram</span><input name="instagram" maxlength="200" value="${esc(s.instagram)}" placeholder="@yourevents"></label>
            <label class="field"><span>TikTok</span><input name="tiktok" maxlength="200" value="${esc(s.tiktok)}"></label>
            <label class="field"><span>Facebook</span><input name="facebook" maxlength="200" value="${esc(s.facebook)}"></label>
          </div>
        </div>
        <div class="save-bar" style="margin-bottom:16px"><button class="btn block" type="submit">${ic('check')}${esc(T('save'))}</button></div>
      </form>
      <div class="card"><h3>${ic('lock')}${esc(T('security'))}</h3>
        <form id="pw" class="grid2">
          <label class="field"><span>${esc(T('currentPassword'))}</span><input name="current" type="password" autocomplete="current-password" required></label>
          <label class="field"><span>${esc(T('newPassword'))}</span><input name="next" type="password" autocomplete="new-password" minlength="8" required></label>
          <div><button class="btn line" type="submit">${esc(T('changePassword'))}</button></div>
        </form></div>
      <div class="card"><h3>${ic('download')}${esc(T('backup'))}</h3><p class="muted small">${esc(T('backupHint'))}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn line" href="/api/admin/export" download>${ic('download')}${esc(T('exportData'))}</a>
        <label class="btn line" style="cursor:pointer">${ic('upload')}${esc(T('importData'))}<input type="file" accept="application/json,.json" id="imp" hidden></label></div></div>`;
    const f = $('#sf', view);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      for (const el of f.elements) {
        if (!el.name) continue;
        body[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      }
      try {
        const { settings } = await api('PUT', '/api/admin/settings', body);
        state.data.settings = settings;
        toast(T('saved'));
        await loadData();
        renderShell();
      } catch {
        toast(T('error'), true);
      }
    });
    $('#pw', view).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('PUT', '/api/admin/password', { current: e.target.current.value, next: e.target.next.value });
        e.target.reset();
        toast(T('passwordChanged'));
      } catch (err) {
        toast(err.code === 'demo' ? T('demoBlocked') : err.code === 'weak_password' ? T('weakPassword') : T('wrongPassword'), true);
      }
    });
    $('#imp', view).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file || !confirm(T('importConfirm'))) return;
      try {
        await api('POST', '/api/admin/import', JSON.parse(await file.text()));
        await loadData();
        toast(T('imported'));
        renderShell();
      } catch (err) {
        toast(err.code === 'demo' ? T('demoBlocked') : T('invalidBackup'), true);
      }
    });
  };

  // ======================= global events =======================
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-tab],[data-act]');
    if (!el) return;
    try {
      if (el.dataset.tab) {
        e.preventDefault();
        closeModal();
        state.tab = el.dataset.tab;
        history.replaceState(null, '', `#${state.tab}`);
        renderTab();
        window.scrollTo(0, 0);
        return;
      }
      const act = el.dataset.act;
      if (act === 'logout') {
        await api('POST', '/api/logout');
        state.data = null;
        return boot();
      }
      if (act === 'copy') {
        await navigator.clipboard.writeText(el.dataset.text);
        return toast(T('copied'));
      }
      if (act === 'new-event') return eventModal(null);
    } catch (err) {
      if (err.message !== 'unauthorized') toast(T('error'), true);
    }
  });
  document.addEventListener('change', async (e) => {
    if (e.target.dataset && e.target.dataset.actChange === 'lang') {
      await setLang(e.target.value);
      if (state.data) renderShell();
      else boot();
    }
  });
  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (state.data && TABS.some(([k]) => k === h) && h !== state.tab) {
      state.tab = h;
      renderTab();
    }
  });

  // ======================= new-order alerts =======================
  let pollTimer;
  function chime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18].forEach((d) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.2, ctx.currentTime + d);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + d + 0.15);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + d);
        o.stop(ctx.currentTime + d + 0.16);
      });
    } catch { /* audio not allowed yet */ }
  }
  function startPolling() {
    clearInterval(pollTimer);
    const tick = async () => {
      if (!state.data) return;
      try {
        const p = await api('GET', '/api/admin/ping');
        setPendingDot(p.pending);
        if (state.lastNo !== null && p.lastOrder > state.lastNo) {
          chime();
          toast(T('newOrderAlert'));
          if (['home', 'orders'].includes(state.tab) && !$('#modal')) {
            await loadData();
            renderTab();
          }
        }
        state.lastNo = p.lastOrder;
      } catch { /* offline */ }
    };
    tick();
    pollTimer = setInterval(tick, 20000);
  }

  boot();
})();
