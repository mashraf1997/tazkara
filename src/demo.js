'use strict';

// Demo mode: a public, self-resetting showcase (DEMO_MODE=true).

const auth = require('./auth');
const D = require('./dates');
const T = require('./tickets');
const { loadSample } = require('./sample');

const DEMO_PASSWORD = 'demo1234';

function demoConfig(env = process.env) {
  if (!/^(1|true|yes)$/i.test(env.DEMO_MODE || '')) return null;
  return {
    password: env.DEMO_PASSWORD || DEMO_PASSWORD,
    resetMinutes: Math.max(5, Number(env.DEMO_RESET_MINUTES) || 60),
    lang: env.DEMO_LANG || 'en',
    type: env.DEMO_TYPE || 'concert',
  };
}

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const FIRST = ['Adam', 'Omar', 'Ali', 'Karim', 'Youssef', 'Hassan', 'Ziad', 'Malek', 'Tarek', 'Sami', 'Maya', 'Lina', 'Hana', 'Nour', 'Yara', 'Salma', 'Dina', 'Mona', 'Rana', 'Farah'];
const LAST = ['Hassan', 'Adel', 'Fouad', 'Nabil', 'Saleh', 'Kamal', 'Rashed', 'Mansour', 'Haddad', 'Farouk'];
const FIRST_AR = ['آدم', 'عمر', 'علي', 'كريم', 'يوسف', 'حسن', 'زياد', 'مالك', 'طارق', 'سامي', 'مايا', 'لينا', 'هنا', 'نور', 'يارا', 'سلمى', 'دينا', 'منى', 'رنا', 'فرح'];
const LAST_AR = ['حسن', 'عادل', 'فؤاد', 'نبيل', 'صالح', 'كمال', 'راشد', 'منصور', 'حداد', 'فاروق'];

/** Fills events with orders: sold over the past weeks, some unpaid, the past/tonight events partly checked in. */
function seedOrders(store, now, nowMs = Date.now()) {
  const r = rng(5);
  const ar = store.settings.lang === 'ar';
  const first = ar ? FIRST_AR : FIRST;
  const last = ar ? LAST_AR : LAST;
  for (const e of store.db.events) {
    const daysAway = D.daysBetween(now.date, e.date);
    const fill = daysAway < 0 ? 0.9 : daysAway === 0 ? 0.8 : Math.max(0.25, 0.75 - daysAway / 60);
    for (const t of e.tickets) {
      const target = Math.round((t.quantity || 60) * fill * (0.75 + r() * 0.25));
      let sold = 0;
      while (sold < target) {
        const qty = Math.min(target - sold, 1 + Math.floor(r() * Math.min(4, t.maxPerOrder)));
        const ageDays = Math.max(0, Math.floor(r() * Math.min(30, 30 + daysAway)));
        const createdMs = Math.min(nowMs - 3600e3, nowMs - ageDays * 864e5 - Math.floor(r() * 864e5));
        const roll = r();
        const status = t.price === 0 ? 'paid' : roll < 0.08 && daysAway > 0 ? 'pending' : roll < 0.11 ? 'cancelled' : 'paid';
        const name = `${first[Math.floor(r() * first.length)]} ${last[Math.floor(r() * last.length)]}`;
        const order = {
          eventId: e.id,
          items: [{ ticketTypeId: t.id, name: t.name, price: t.price, qty }],
          count: qty,
          total: T.round2(t.price * qty),
          customer: { name, phone: `010${String(10000000 + Math.floor(r() * 89999999))}`, email: '', notes: '' },
          status,
          paidAt: status === 'paid' ? new Date(createdMs + 3600e3).toISOString() : '',
          source: 'online',
        };
        const o = store.addOrder(order, T.ticketsFor, { save: false });
        // Pending orders are recent (still within their hold time).
        o.createdAt = new Date(status === 'pending' ? nowMs - Math.floor(r() * 20) * 3600e3 : createdMs).toISOString();
        if (status === 'paid' && daysAway <= 0) {
          for (const tk of store.tickets.filter((x) => x.orderId === o.id)) {
            if (r() < (daysAway < 0 ? 0.88 : 0.45)) {
              tk.usedAt = new Date(nowMs - Math.floor(r() * (daysAway < 0 ? 864e5 * -daysAway : 90 * 60e3))).toISOString();
              tk.usedBy = r() < 0.7 ? 'door' : 'desk';
            }
          }
        }
        sold += qty;
      }
    }
  }
}

function resetDemo(store, cfg, now = () => D.nowIn(store.settings.timezone)) {
  store.reset();
  const ar = cfg.lang === 'ar';
  store.updateSettings({
    name: ar ? 'ستيدج 11' : 'Stage Eleven',
    lang: cfg.lang,
    currency: ar ? 'ج.م' : '$',
    whatsapp: '',
    color: '#7c3aed',
    theme: 'elegant',
    font: 'cairo',
    instagram: '@tazkara',
    paymentInfo: ar ? 'إنستاباي: stage11@instapay · فودافون كاش 01001234567' : 'Bank transfer: IBAN EG00 0000 0000 0000 · or pay at the box office',
    policy: ar ? 'التذاكر مش بترجع، بس تقدر تديها لحد تاني. الدخول بالـ QR بس.' : 'Tickets are non-refundable but transferable. Entry with the QR code only.',
  });
  store.db.auth = auth.hashPassword(cfg.password);
  store.db.setupDone = true;
  const n = now();
  loadSample(store, cfg.type, cfg.lang, n);
  // Tonight's event (for the door scanner) and one that already happened.
  const t = (en, a) => (ar ? a : en);
  store.addEvent({
    title: t('Open Mic Night', 'ليلة الأوبن مايك'), slug: 'open-mic', subtitle: t('Tonight! Comedy, poetry and music', 'النهارده! كوميديا وشعر ومزيكا'),
    description: t('Ten performers, five minutes each. Sign up at the door to perform.', '10 فقرات، كل واحدة 5 دقايق. سجّل على الباب لو عايز تطلع.'),
    date: n.date, endDate: '', start: 21 * 60, end: 23 * 60 + 30, venue: t('The Garage', 'الجراچ'), address: t('12 Market St', 'شارع 9، المعادي'), mapUrl: '', cover: '', emoji: '🎤',
    capacity: 0, published: true, salesOpen: true, tickets: [{ id: 'mic-ga', name: t('Entry', 'دخول'), description: '', price: ar ? 150 : 8, quantity: 120, maxPerOrder: 6, salesEnd: '', hidden: false }],
  });
  store.addEvent({
    title: t('Summer Rooftop Party', 'حفلة السطوح'), slug: 'rooftop', subtitle: t('Sunset DJ set', 'دي جي مع الغروب'),
    description: t('Thanks to everyone who came!', 'شكرًا لكل اللي جه!'),
    date: D.addDays(n.date, -12), endDate: '', start: 18 * 60, end: 23 * 60, venue: t('Sky Terrace', 'سكاي تراس'), address: '', mapUrl: '', cover: '', emoji: '🌇',
    capacity: 0, published: true, salesOpen: false, tickets: [{ id: 'roof-ga', name: t('Entry', 'دخول'), description: '', price: ar ? 300 : 12, quantity: 150, maxPerOrder: 6, salesEnd: '', hidden: false }],
  });
  seedOrders(store, n);
  for (let i = 0; i < 30; i++) store.stats.visits[D.addDays(n.date, -i)] = 40 + ((i * 37) % 90);
  store.statsDirty = true;
  store.orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  store.orders.forEach((o, i) => (o.no = 1001 + i));
  store.db.nextOrderNo = 1001 + store.orders.length;
  store.save();
  store.saveList('orders');
  store.saveList('tickets');
  store.flushStats(true);
}

module.exports = { demoConfig, resetDemo, seedOrders, DEMO_PASSWORD };
