'use strict';

// Sample events per type, so a fresh install looks alive. Dates are relative
// to today. Text is in English and Arabic; other languages use English.
// Ticket: [key, priceEN, priceAR, quantity, maxPerOrder]

const D = require('./dates');

const TYPES = {
  concert: {
    events: [
      { key: 'night', days: 9, start: '20:00', end: '23:30', emoji: '🎸', capacity: 0, tickets: [['ga', 15, 350, 250, 6], ['vip', 40, 900, 40, 4]] },
      { key: 'acoustic', days: 23, start: '19:30', end: '22:00', emoji: '🎻', capacity: 0, tickets: [['ga', 10, 250, 120, 6]] },
    ],
    text: {
      en: {
        tagline: 'Live music nights in the heart of the city',
        night: ['Friday Night Live', 'Three local bands, one big night', 'Doors open at 7:30 pm. Three bands, food trucks outside, and the best sound system in town.\n\nTickets are non-refundable but you can pass them to a friend: open your ticket and change the name.', 'The Garage', '12 Market St'],
        acoustic: ['Acoustic Sessions', 'An intimate evening, seated', 'Unplugged sets from rising songwriters. Limited seats, first come first seated.', 'The Loft', '5 River Rd'],
        ga: ['General admission', 'Standing'], vip: ['VIP', 'Front area + a free drink'],
      },
      ar: {
        tagline: 'سهرات مزيكا لايف في قلب البلد',
        night: ['ليلة الجمعة لايف', '3 فرق، وسهرة واحدة كبيرة', 'الأبواب بتفتح 7:30 بالليل. 3 فرق، وعربيات أكل برّه، وأحسن صوت في البلد.\n\nالتذاكر مش بترجع، بس تقدر تديها لصاحبك: افتح التذكرة وغيّر الاسم.', 'الجراچ', 'شارع 9، المعادي'],
        acoustic: ['جلسات أكوستيك', 'سهرة هادية وقعدة', 'مغنيين جداد من غير كهربا. الأماكن محدودة.', 'اللوفت', 'الزمالك'],
        ga: ['دخول عادي', 'وقوف'], vip: ['VIP', 'قدّام المسرح + مشروب ببلاش'],
      },
    },
  },
  workshop: {
    events: [
      { key: 'photo', days: 6, start: '11:00', end: '15:00', emoji: '📸', capacity: 20, tickets: [['early', 25, 500, 8, 2], ['regular', 35, 700, 0, 2]] },
      { key: 'pottery', days: 16, start: '17:00', end: '19:30', emoji: '🏺', capacity: 12, tickets: [['regular', 40, 800, 0, 2]] },
    ],
    text: {
      en: {
        tagline: 'Hands-on workshops, small groups',
        photo: ['Phone Photography Workshop', 'Shoot like a pro with the phone in your pocket', 'Composition, light and editing — all on your phone. Bring a charged phone; we provide the rest. Certificate included.', 'Studio 4', '18 Garden City'],
        pottery: ['Pottery for Beginners', 'Make your first mug', 'Learn the wheel, glaze your piece and pick it up a week later. Aprons and clay included.', 'Clay House', '3 Nile St'],
        early: ['Early bird', 'Limited'], regular: ['Regular', ''],
      },
      ar: {
        tagline: 'ورش عملية، ومجموعات صغيرة',
        photo: ['ورشة تصوير بالموبايل', 'صوّر زي المحترفين بموبايلك', 'التكوين والإضاءة والتعديل، كله على الموبايل. هات موبايلك مشحون والباقي علينا. فيه شهادة.', 'ستوديو 4', 'جاردن سيتي'],
        pottery: ['فخار للمبتدئين', 'اعمل أول مج بإيدك', 'اتعلم العجلة، ولوّن قطعتك، واستلمها بعد أسبوع. المريلة والطين معانا.', 'بيت الطين', 'شارع النيل'],
        early: ['حجز مبكر', 'عدد محدود'], regular: ['عادي', ''],
      },
    },
  },
  conference: {
    events: [
      { key: 'meetup', days: 12, start: '18:00', end: '21:00', emoji: '💡', capacity: 150, tickets: [['free', 0, 0, 0, 2]] },
      { key: 'summit', days: 34, start: '09:00', end: '17:00', emoji: '🎤', capacity: 0, tickets: [['student', 10, 200, 60, 1], ['standard', 30, 600, 200, 5]] },
    ],
    text: {
      en: {
        tagline: 'Talks and meetups for builders',
        meetup: ['Startup Meetup #12', 'Three talks, pizza and networking', 'Lightning talks from local founders, then pizza and networking. Free, but please register so we know how much pizza to order.', 'The Hub', '22 Tahrir Sq'],
        summit: ['Builders Summit', 'A full day of talks and workshops', 'Twelve talks, four workshops, lunch included. Student tickets need a valid student ID at the door.', 'Grand Hall', 'Conference Center'],
        free: ['Free registration', ''], student: ['Student', 'ID required at the door'], standard: ['Standard', 'Lunch included'],
      },
      ar: {
        tagline: 'محاضرات ولقاءات لأصحاب المشاريع',
        meetup: ['لقاء الستارت أب #12', '3 محاضرات وبيتزا وتعارف', 'محاضرات قصيرة من مؤسسين، وبعدها بيتزا وتعارف. ببلاش، بس سجّل عشان نعرف نطلب كام بيتزا.', 'ذا هَب', 'ميدان التحرير'],
        summit: ['قمة البنّائين', 'يوم كامل محاضرات وورش', '12 محاضرة و4 ورش والغدا معانا. تذكرة الطالب محتاجة كارنيه الكلية على الباب.', 'القاعة الكبرى', 'مركز المؤتمرات'],
        free: ['تسجيل مجاني', ''], student: ['طالب', 'الكارنيه مطلوب على الباب'], standard: ['عادي', 'الغدا معانا'],
      },
    },
  },
  sports: {
    events: [
      { key: 'run', days: 14, start: '07:00', end: '10:00', emoji: '🏃', capacity: 400, tickets: [['k5', 8, 150, 0, 4], ['k10', 12, 250, 0, 4]] },
      { key: 'padel', days: 27, start: '16:00', end: '22:00', emoji: '🎾', capacity: 32, tickets: [['team', 30, 600, 16, 1]] },
    ],
    text: {
      en: {
        tagline: 'Races, tournaments and community games',
        run: ['City Fun Run', '5 km or 10 km along the river', 'T-shirt, medal and water stations included. Pick up your bib on race morning with the QR on your ticket.', 'Riverside Park', 'Corniche, Gate 3'],
        padel: ['Padel Cup', 'Doubles tournament, all levels', 'Sixteen teams, group stage then knockouts. One ticket per team; put your partner’s name on the ticket.', 'Padel Club', '7 Sports City'],
        k5: ['5 km', 'All ages'], k10: ['10 km', '16+'], team: ['Team (2 players)', ''],
      },
      ar: {
        tagline: 'سباقات وبطولات وماتشات للكل',
        run: ['ماراثون المدينة', '5 أو 10 كيلو على النيل', 'تيشيرت وميدالية ومية. استلم رقمك يوم السباق بالـ QR اللي في التذكرة.', 'حديقة النيل', 'الكورنيش، بوابة 3'],
        padel: ['كاس البادل', 'بطولة زوجي لكل المستويات', '16 فريق، دور مجموعات وبعدين خروج المغلوب. تذكرة لكل فريق، واكتب اسم زميلك على التذكرة.', 'نادي البادل', 'المدينة الرياضية'],
        k5: ['5 كيلو', 'كل الأعمار'], k10: ['10 كيلو', '+16'], team: ['فريق (لاعبين)', ''],
      },
    },
  },
};

function loadSample(store, type, lang, now) {
  const def = TYPES[type] || TYPES.concert;
  const ar = lang === 'ar';
  const text = def.text[ar ? 'ar' : 'en'];
  const toMin = (s) => D.toMin(s);
  if (!store.settings.tagline) store.updateSettings({ tagline: text.tagline });
  const created = [];
  for (const ev of def.events) {
    const [title, subtitle, description, venue, address] = text[ev.key];
    const tickets = ev.tickets.map(([key, en, arPrice, quantity, maxPerOrder]) => ({ id: `${ev.key}-${key}`, name: text[key][0], description: text[key][1], price: ar ? arPrice : en, quantity, maxPerOrder, salesEnd: '', hidden: false }));
    created.push(
      store.addEvent({
        title,
        slug: ev.key,
        subtitle,
        description,
        date: D.addDays(now.date, ev.days),
        endDate: '',
        start: toMin(ev.start),
        end: toMin(ev.end),
        venue,
        address,
        mapUrl: '',
        cover: '',
        emoji: ev.emoji,
        capacity: ev.capacity,
        published: true,
        salesOpen: true,
        tickets,
      })
    );
  }
  return created;
}

module.exports = { loadSample, EVENT_TYPES: Object.keys(TYPES) };
