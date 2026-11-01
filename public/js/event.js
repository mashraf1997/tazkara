(() => {
  'use strict';

  const D = window.TAZKARA || {};
  const t = D.t || {};
  const BUYER_KEY = 'tazkara-buyer';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ic = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="${D.icons}#i-${name}"/></svg>`;
  const fill = (s, v) => Object.entries(v).reduce((o, [k, x]) => o.split(`{${k}}`).join(x), s || '');
  const PREFIX = ['$', '€', '£', '¥', '₹', '₺', 'R$', 'US$', 'C$', 'A$'];
  const money = (n) => {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    if (!v) return t.free;
    const s = v.toLocaleString('en', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
    return PREFIX.includes(D.currency) ? `${D.currency}${s}` : `${s} ${D.currency || ''}`.trim();
  };
  const storage = {
    get(k, f) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? f : v; } catch { return f; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Tazkara': '1' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error, data });
    return data;
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.innerHTML = `${ic('check')}<span>${esc(msg)}</span>`;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // ------------------------------------------------------------ event page
  const cart = new Map();
  const types = new Map((D.types || []).map((x) => [x.id, x]));
  const totalQty = () => [...cart.values()].reduce((a, b) => a + b, 0);
  const totalPrice = () => [...cart.entries()].reduce((s, [id, q]) => s + types.get(id).price * q, 0);

  function syncBar() {
    const bar = $('#bar');
    if (!bar) return;
    const n = totalQty();
    bar.hidden = !n;
    $('#bar-sum').innerHTML = `<b>${esc(money(totalPrice()))}</b><small>${esc(fill(n === 1 ? t.oneTicket : t.nTickets, { n }))}</small>`;
  }

  const list = $('.tk-list');
  if (list && D.open) {
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-inc],[data-dec]');
      if (!btn) return;
      const row = btn.closest('[data-type]');
      const type = types.get(row.dataset.type);
      let q = cart.get(type.id) || 0;
      if (btn.hasAttribute('data-inc')) {
        const limit = Math.min(type.max, type.left === null || type.left === undefined ? Infinity : type.left);
        const capRoom = D.capLeft === null || D.capLeft === undefined ? Infinity : D.capLeft - totalQty();
        if (q >= limit || capRoom <= 0) return toast(fill(t.maxReached, { n: Math.min(limit, q) }));
        q++;
      } else q = Math.max(0, q - 1);
      if (q) cart.set(type.id, q);
      else cart.delete(type.id);
      $('output', row).textContent = q;
      row.classList.toggle('picked', q > 0);
      syncBar();
    });
  }

  function closeSheet() {
    const s = $('#sheet');
    if (!s) return;
    s.classList.add('closing');
    setTimeout(() => s.remove(), 200);
    document.body.style.overflow = '';
  }

  function openCheckout() {
    const saved = storage.get(BUYER_KEY, {});
    const el = document.createElement('div');
    el.className = 'sheet';
    el.id = 'sheet';
    const lines = [...cart.entries()].map(([id, q]) => `<li><span>${q}× ${esc(types.get(id).name)}</span><b>${esc(money(types.get(id).price * q))}</b></li>`).join('');
    el.innerHTML = `<div class="backdrop" data-close></div>
      <div class="panel" role="dialog" aria-modal="true" aria-labelledby="co-title">
        <span class="grab"></span>
        <button type="button" class="close" data-close aria-label="${esc(t.close)}">${ic('x')}</button>
        <div class="panel-body">
          <h2 id="co-title">${esc(t.checkoutTitle)}</h2>
          <ul class="co-lines">${lines}<li class="tot"><span>${esc(t.total)}</span><b>${esc(money(totalPrice()))}</b></li></ul>
          <form id="co" novalidate>
            <label class="field"><span>${esc(t.yourName)} *</span><input name="name" autocomplete="name" maxlength="80" value="${esc(saved.name || '')}" required></label>
            <label class="field"><span>${esc(t.yourPhone)} *</span><input name="phone" type="tel" autocomplete="tel" maxlength="30" value="${esc(saved.phone || '')}" required></label>
            <label class="field"><span>${esc(t.yourEmail)}</span><input name="email" type="email" autocomplete="email" maxlength="120" value="${esc(saved.email || '')}"></label>
            <button class="btn block" type="submit">${ic('check')}<span>${esc(totalPrice() ? t.reserve : t.confirmFree)}</span></button>
            <p class="note">${esc(totalPrice() ? t.payNextHint : t.freeHint)}</p>
            <p class="err" id="err" role="alert"></p>
          </form>
        </div>
      </div>`;
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeSheet();
    });
    const f = $('#co', el);
    (saved.name ? f.querySelector('[type=submit]') : f.name).focus({ preventScroll: true });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#err', el);
      if (!f.name.value.trim()) return (err.textContent = t.nameRequired);
      if (!f.phone.value.trim()) return (err.textContent = t.phoneRequired);
      const btn = f.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const r = await api('POST', '/api/orders', {
          eventId: D.eventId,
          items: [...cart.entries()].map(([ticketTypeId, qty]) => ({ ticketTypeId, qty })),
          customer: { name: f.name.value, phone: f.phone.value, email: f.email.value },
        });
        storage.set(BUYER_KEY, { name: f.name.value.trim(), phone: f.phone.value.trim(), email: f.email.value.trim() });
        location.href = r.orderUrl;
      } catch (ex) {
        const left = ex.data && ex.data.left;
        err.textContent = ex.code === 'sold_out' ? (left ? fill(t.onlyLeft, { n: left }) : t.soldOut) : ex.code === 'invalid_email' ? t.invalidEmail : ex.code === 'rate_limited' ? t.rateLimited : ex.code === 'sales_closed' ? t.salesClosed : t.error;
        btn.disabled = false;
      }
    });
  }

  const checkout = $('#checkout');
  if (checkout) checkout.addEventListener('click', () => totalQty() && openCheckout());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });

  // ------------------------------------------------------------ order / ticket page
  const cards = $$('.tk-card');
  for (const card of cards) {
    const input = $('[data-holder]', card);
    if (!input) continue;
    let last = input.value;
    const save = async () => {
      if (input.value.trim() === last) return;
      try {
        await api('PUT', `/api/tickets/${encodeURIComponent(card.dataset.token)}`, { holder: input.value });
        last = input.value.trim();
        toast(t.saved);
      } catch {
        toast(t.error);
      }
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-send]');
    if (!b) return;
    const url = b.dataset.send;
    const text = fill(t.sendText, { event: D.eventTitle || '' });
    try {
      if (navigator.share) await navigator.share({ title: D.eventTitle, text, url });
      else window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, '_blank');
    } catch { /* cancelled */ }
  });

  // ------------------------------------------------------------ shared
  const shareBtn = $('#share');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const url = location.origin + location.pathname;
      try {
        if (navigator.share) await navigator.share({ title: document.title, url });
        else { await navigator.clipboard.writeText(url); toast(t.linkCopied); }
      } catch { /* cancelled */ }
    });
  }
  const langSel = $('#lang');
  if (langSel) {
    langSel.addEventListener('change', () => {
      const url = new URL(location.href);
      url.searchParams.set('lang', langSel.value);
      location.href = url.toString();
    });
  }

  // Live preview from the admin's design screen (same origin only).
  if (D.preview) {
    addEventListener('message', (e) => {
      if (e.origin !== location.origin || !e.data || e.data.type !== 'tazkara-preview') return;
      const d = e.data;
      if (d.theme) document.body.className = document.body.className.replace(/theme-\w+/, `theme-${d.theme}`);
      if (d.color) document.documentElement.style.setProperty('--brand', d.color);
      if (d.fontStack) document.documentElement.style.setProperty('--font', d.fontStack);
      if (d.fontHref) $('#font-css').href = d.fontHref;
      if ('logo' in d) $('#logo').innerHTML = d.logo ? `<img src="${esc(d.logo)}" alt="">` : `<span>${esc(((D.org && D.org.name) || '?').charAt(0).toUpperCase())}</span>`;
      if ('cover' in d) {
        const cover = $('#cover');
        cover.classList.toggle('has-img', !!d.cover);
        const img = $('img', cover);
        if (d.cover) {
          if (img) img.src = d.cover;
          else cover.insertAdjacentHTML('afterbegin', `<img src="${esc(d.cover)}" alt="">`);
        } else if (img) img.remove();
      }
    });
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (a && !a.getAttribute('href').startsWith('#')) e.preventDefault();
    }, true);
  }
})();
