/**
 * shekh.com.bd — মাহফিল / তদবির ফর্মের সার্ভার অংশ (Google Apps Script)
 *
 * সাইট থেকে আসা আবেদন যাচাই করে Google Sheet-এ সংরক্ষণ করে:
 *  - Cloudflare Turnstile টোকেন যাচাই (স্ক্রিপ্ট দিয়ে সরাসরি পাঠানো আবেদন বাতিল হয়)
 *  - প্রতিটি ঘরের দৈর্ঘ্য, মোবাইল নম্বর, তারিখ ও বয়স যাচাই
 *  - একই নম্বর থেকে এবং মোট আবেদনের সংখ্যার সীমা
 *
 * সেটআপের ধাপ: apps-script/README.md দেখুন।
 * Turnstile-এর secret key কোডে নয়, Script Properties-এ TURNSTILE_SECRET নামে রাখুন।
 */

// ### সাইটের ডোমেইন — Turnstile এই ডোমেইন ছাড়া অন্য কোথাও থেকে আসা টোকেন গ্রহণ করবে না
const ALLOWED_HOSTNAMES = ['shekh.com.bd', 'www.shekh.com.bd'];

// ### সীমা
const MAX_PER_PHONE = 2;          // একই মোবাইল নম্বর থেকে প্রতি PHONE_WINDOW_SEC-এ সর্বোচ্চ আবেদন
const PHONE_WINDOW_SEC = 6 * 3600; // ৬ ঘণ্টা (CacheService-এর সর্বোচ্চ সময়)
const MAX_PER_HOUR = 30;          // সব মিলিয়ে প্রতি ঘণ্টায় সর্বোচ্চ আবেদন

const TEXT_MAX = 200;
const TEXTAREA_MAX = 2000;

// প্রতিটি ফর্মের ঘর: [নাম, শিটের কলামের শিরোনাম, বাধ্যতামূলক?, ধরন]
const FORMS = {
  mahfil: {
    sheet: 'মাহফিল',
    fields: [
      ['inviter_name', 'দাওয়াতকারীর নাম', true, 'text'],
      ['phone', 'মোবাইল নম্বর', true, 'phone'],
      ['mahfil_type', 'মাহফিলের ধরন', true, 'text'],
      ['venue', 'মাহফিলের স্থান', true, 'text'],
      ['date', 'মাহফিলের তারিখ', true, 'date'],
      ['topic', 'বিষয়', false, 'text'],
      ['extra', 'অতিরিক্ত তথ্য', false, 'textarea'],
    ],
  },
  tadbir: {
    sheet: 'তদবির',
    fields: [
      ['applicant_name', 'আবেদনকারীর নাম', true, 'text'],
      ['relationship', 'রোগীর সাথে সম্পর্ক', true, 'text'],
      ['patient_name', 'রোগীর নাম', true, 'text'],
      ['age', 'বয়স', true, 'age'],
      ['occupation', 'রোগীর পেশা', true, 'text'],
      ['father_name', 'বাবার নাম', true, 'text'],
      ['mother_name', 'মায়ের নাম', true, 'text'],
      ['problem', 'সমস্যা', true, 'text'],
      ['duration', 'সমস্যার সময়কাল', false, 'text'],
      ['phone', 'মোবাইল নম্বর', true, 'phone'],
      ['details', 'বিস্তারিত আবেদন', true, 'textarea'],
      ['extra', 'অতিরিক্ত তথ্য', false, 'textarea'],
    ],
  },
};

function doPost(e) {
  const p = (e && e.parameter) || {};
  const form = FORMS[p.form];
  if (!form) return reply_(false, 'bad_form');

  // honeypot ভরা থাকলে বট — সংরক্ষণ না করে "সফল" জানাই
  if (p.website) return reply_(true);

  if (!verifyTurnstile_(p['cf-turnstile-response'], p.form)) return reply_(false, 'captcha');

  const row = [new Date()];
  let phone = '';
  for (const [name, , required, type] of form.fields) {
    const raw = String(p[name] || '').trim();
    if (!raw) {
      if (required) return reply_(false, 'missing');
      row.push('');
      continue;
    }
    const val = clean_(raw, type);
    if (val === null) return reply_(false, type === 'phone' ? 'phone' : 'invalid');
    if (type === 'phone') phone = val;
    row.push(val);
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return reply_(false, 'busy');
  try {
    if (!takeQuota_(phone)) return reply_(false, 'rate');
    sheet_(form).appendRow(row.map(safeCell_));
  } finally {
    lock.releaseLock();
  }
  return reply_(true);
}

// ঘরের মান যাচাই ও স্বাভাবিক রূপে আনা; ভুল হলে null
function clean_(v, type) {
  switch (type) {
    case 'phone': {
      const n = v.replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/[\s-]/g, '')
        .replace(/^\+?88/, '');
      return /^01[3-9]\d{8}$/.test(n) ? n : null;
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    case 'age': {
      const n = Number(v);
      return Number.isInteger(n) && n >= 0 && n <= 150 ? String(n) : null;
    }
    case 'textarea':
      return v.length <= TEXTAREA_MAX ? v : null;
    default:
      return v.length <= TEXT_MAX ? v : null;
  }
}

function verifyTurnstile_(token, action) {
  if (!token || token.length > 2048) return false;
  const secret = PropertiesService.getScriptProperties().getProperty('TURNSTILE_SECRET');
  if (!secret) throw new Error('Script Properties-এ TURNSTILE_SECRET নেই');
  const res = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'post',
    payload: { secret: secret, response: token },
    muteHttpExceptions: true,
  });
  let out;
  try { out = JSON.parse(res.getContentText()); } catch (_) { return false; }
  // Cloudflare-এর টেস্ট কী-তে ডোমেইন ও action আসল থাকে না — তখন শুধু success দেখি
  if (secret === '1x0000000000000000000000000000000AA') return out.success === true;
  return out.success === true && out.action === action &&
    ALLOWED_HOSTNAMES.indexOf(out.hostname) !== -1;
}

// নম্বরপ্রতি ও ঘণ্টাপ্রতি সীমা; সীমার মধ্যে থাকলে গণনা বাড়িয়ে true
function takeQuota_(phone) {
  const cache = CacheService.getScriptCache();
  const hourKey = 'h_' + Math.floor(Date.now() / 3600000);
  const phoneKey = 'p_' + phone;
  const hour = Number(cache.get(hourKey) || 0);
  const perPhone = Number(cache.get(phoneKey) || 0);
  if (hour >= MAX_PER_HOUR || (phone && perPhone >= MAX_PER_PHONE)) return false;
  cache.put(hourKey, String(hour + 1), 3600);
  if (phone) cache.put(phoneKey, String(perPhone + 1), PHONE_WINDOW_SEC);
  return true;
}

function sheet_(form) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(form.sheet);
  if (!sh) {
    sh = ss.insertSheet(form.sheet);
    sh.appendRow(['সময়'].concat(form.fields.map(f => f[1])));
    sh.setFrozenRows(1);
  }
  return sh;
}

// =, +, -, @ দিয়ে শুরু হওয়া লেখা শিটে সূত্র হিসেবে চলতে না দেওয়া
function safeCell_(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

function reply_(ok, error) {
  return ContentService.createTextOutput(JSON.stringify(ok ? { ok: true } : { ok: false, error: error }))
    .setMimeType(ContentService.MimeType.JSON);
}
