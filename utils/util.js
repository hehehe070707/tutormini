const PERIODS = ['上午', '下午', '晚上'];
const WEEK_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

function nowText(date) {
  const d = date || new Date();
  return (
    d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  );
}

function isoDay(date) {
  const d = date || new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function upcomingDays(days) {
  const list = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime());
    d.setDate(today.getDate() + i);
    list.push(isoDay(d));
  }
  return list;
}

function displayDay(dayIso) {
  const parts = String(dayIso || '').split('-');
  if (parts.length !== 3) return String(dayIso || '');
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(d.getTime())) return String(dayIso);
  const weekday = WEEK_CN[(d.getDay() + 6) % 7];
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + weekday;
}

function displayTime(dayIso, period) {
  const text = plain(period);
  if (text === '') return plain(dayIso);
  return displayDay(dayIso) + ' ' + text;
}

function plain(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function priceValue(price) {
  const text = plain(price);
  let index = 0;
  while (index < text.length && !(text[index] >= '0' && text[index] <= '9')) index++;
  let value = 0;
  while (index < text.length && text[index] >= '0' && text[index] <= '9') {
    value = value * 10 + (text.charCodeAt(index) - 48);
    index++;
  }
  return value;
}

const NEARBY_KM = 45;
const NEARBY_CHOICES = [5, 10, 20, 45, 100, 0];
const EARTH_RADIUS_KM = 6371;

function hasCoords(lat, lng) {
  const a = Number(lat);
  const o = Number(lng);
  if (!isFinite(a) || !isFinite(o)) return false;
  return !(a === 0 && o === 0);
}

function toRad(deg) {
  return Number(deg) * Math.PI / 180;
}

function distanceKm(lat1, lng1, lat2, lng2) {
  if (!hasCoords(lat1, lng1) || !hasCoords(lat2, lng2)) return -1;
  const a1 = Number(lat1);
  const o1 = Number(lng1);
  const a2 = Number(lat2);
  const o2 = Number(lng2);
  if (a1 === a2 && o1 === o2) return 0;

  const dLat = toRad(a2 - a1);
  const dLng = toRad(o2 - o1);
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(a1)) * Math.cos(toRad(a2)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const km = 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  return isFinite(km) ? km : -1;
}

function formatDistance(km) {
  if (km < 0) return '距离未知';
  if (km < 1) return Math.round(km * 1000) + ' 米';
  if (km < 10) return km.toFixed(1) + ' 公里';
  return Math.round(km) + ' 公里';
}

function formatRadius(km) {
  const value = Number(km);
  if (!isFinite(value) || value <= 0) return '不限距离';
  return value + ' 公里内';
}

const STATUS_PENDING = '待确认';
const STATUS_CONFIRMED = '已确认';
const STATUS_REJECTED = '已拒绝';
const STATUS_CANCELLED = '已取消';
const STATUS_LEGACY_BOOKED = '已预约';

const STATUS_TRIAL = '试课中';
const STATUS_MAIN = '主订单进行中';
const STATUS_ENDED = '已结束';

const LESSON_PENDING = '待确认';
const LESSON_CONFIRMED = '已确认';
const LESSON_UNPAID = '待支付';
const LESSON_PAID = '已支付';
const LESSON_TRIAL = '试课';
const LESSON_FORMAL = '正式';
const TRIAL_PASS = '通过';
const TRIAL_FAIL = '不通过';
const POST_OPEN = '招募中';
const POST_TAKEN = '已成交';
const POST_CLOSED = '已关闭';

const PAY_PENDING = '待收款';
const PAY_CLAIMED = '待确认收款';
const PAY_RECEIVED = '已收款';
const PAY_REFUNDED = '已退款';

const MATCH_FULL = 'full';
const MATCH_PARTIAL = 'partial';
const MATCH_NONE = 'none';
const ROLE_STUDENT = 'student';
const ROLE_TEACHER = 'teacher';
const DEFAULT_INTRO = '教学经验丰富，善于根据学生情况定制学习计划。';

function bookingStatusText(status) {
  const text = plain(status);
  if (text === STATUS_PENDING) return '待平台确认';
  if (text === STATUS_CONFIRMED || text === STATUS_LEGACY_BOOKED) return '主订单进行中';
  if (text === STATUS_TRIAL) return '试课中';
  if (text === STATUS_MAIN) return '主订单进行中';
  if (text === STATUS_ENDED) return '已结束';
  if (text === STATUS_REJECTED) return '未选上';
  if (text === STATUS_CANCELLED) return '已取消';
  return text;
}

function isActiveBooking(status) {
  const text = plain(status);
  return text === STATUS_PENDING || text === STATUS_TRIAL || text === STATUS_MAIN ||
         text === STATUS_CONFIRMED || text === STATUS_LEGACY_BOOKED;
}

function lessonStatusText(status, result) {
  const text = plain(status);
  const outcome = plain(result);
  if (text === LESSON_PENDING) return outcome === '' ? '待平台确认' : '待确认（' + outcome + '？）';
  if (text === LESSON_CONFIRMED) return outcome === '' ? '已确认' : '已确认 · ' + outcome;
  if (text === LESSON_UNPAID) return '待支付';
  if (text === LESSON_PAID) return '已支付';
  return text;
}

function bookingStatusClass(status) {
  const text = plain(status);
  if (text === STATUS_PENDING || text === STATUS_TRIAL) return 'st-pending';
  if (text === STATUS_MAIN || text === STATUS_CONFIRMED || text === STATUS_LEGACY_BOOKED) return 'st-confirmed';
  if (text === STATUS_REJECTED) return 'st-rejected';
  if (text === STATUS_ENDED) return 'st-closed';
  return 'st-cancelled';
}

function lessonStatusClass(status, result) {
  const outcome = plain(result);
  if (outcome === TRIAL_FAIL) return 'st-rejected';
  const text = plain(status);
  if (text === LESSON_PENDING || text === LESSON_UNPAID) return 'st-pending';
  if (text === LESSON_CONFIRMED || text === LESSON_PAID) return 'st-confirmed';
  return 'st-closed';
}

function payStatusClass(status) {
  const text = plain(status);
  if (text === PAY_PENDING || text === PAY_CLAIMED) return 'st-pending';
  if (text === PAY_RECEIVED) return 'st-confirmed';
  return 'st-closed';
}

function matchLevelText(level) {
  if (level === MATCH_FULL) return '✅ 完全符合';
  if (level === MATCH_PARTIAL) return '⚠️ 部分符合';
  if (level === MATCH_NONE) return '❌ 不符合';
  return '';
}

function matchLevelClass(level) {
  if (level === MATCH_FULL) return 'st-confirmed';
  if (level === MATCH_PARTIAL) return 'st-pending';
  if (level === MATCH_NONE) return 'st-rejected';
  return '';
}

const GRADE_OPTIONS = ['不限', '小学', '初一', '初二', '初三', '高一', '高二', '高三', '小学奥数', '大一', '大二'];
const GENDER_OPTIONS = ['不限', '男', '女'];
const EDUCATION_OPTIONS = ['不限', '大专及以上', '本科及以上', '硕士及以上'];
const TEACH_MODE_OPTIONS = ['不限', '线下', '线上'];
const CERTIFICATE_OPTIONS = ['教师资格证', '普通话二甲', '英语专八', '雅思/托福'];

const EDUCATION_LEVEL_OPTIONS = ['不限', '本科', '硕士', '博士'];
const MIN_YEARS_OPTIONS = ['不限', '1', '3', '5'];
const REQUIRE_CERTIFICATE_OPTIONS = ['不限', '教师资格证', '普通话证书', '四六级', '雅思托福'];

const GENDER_PICK = ['男', '女'];
const EDUCATION_PICK = ['本科', '硕士', '博士'];
const YEARS_PICK = ['1', '3', '5'];
const CERTIFICATE_PICK = ['教师资格证', '普通话证书', '四六级', '雅思托福'];
const TEACH_MODE_PICK = ['线下', '线上'];
const REQ_UNLIMITED = '不限';

function priceText(min, max) {
  const lo = Number(min) || 0;
  const hi = Number(max) || 0;
  if (lo <= 0 && hi <= 0) return '';
  if (lo > 0 && hi > 0 && lo !== hi) return lo + '-' + hi + ' 元/小时';
  return (lo || hi) + ' 元/小时';
}

function requirementsText(req) {
  const r = req || {};
  const has = (value) => {
    const text = plain(value);
    return text !== '' && text !== REQ_UNLIMITED && text !== '0';
  };
  const parts = [];
  if (has(r.education)) parts.push(r.education);
  if (has(r.minYears) && Number(r.minYears) > 0) parts.push(r.minYears + ' 年以上教龄');
  if (Array.isArray(r.certificate)) {
    if (r.certificate.length > 0) parts.push(r.certificate.join('、'));
  } else if (has(r.certificate)) {
    parts.push(r.certificate);
  }
  if (has(r.gender)) parts.push(r.gender + '老师');
  if (has(r.school)) parts.push('学校：' + r.school);
  const hourly = priceText(Number(r.priceMin) || Number(r.budgetMin), Number(r.priceMax) || Number(r.budgetMax));
  if (hourly !== '') parts.push(hourly);
  if (has(r.teachMode)) parts.push(r.teachMode);
  return parts.join(' · ');
}

const DEFAULT_PASSWORD = '123456';
const DEFAULT_SUBJECTS = ['数学', '语文', '英语', '物理', '化学', '生物'];

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotr(x, n) {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function utf8Bytes(str) {
  const out = [];
  const text = String(str);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const low = text.charCodeAt(++i);
      const cp = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
  }
  return out;
}

function sha256(input) {
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
             0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const bytes = utf8Bytes(input);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);

  bytes.push(0, 0, 0, 0,
             (bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

  const w = new Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let t = 0; t < 16; t++) {
      const i = offset + t * 4;
      w[t] = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t++) {
      const s0 = (rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    let a = H[0], b = H[1], c = H[2], d = H[3];
    let e = H[4], f = H[5], g = H[6], h = H[7];

    for (let t = 0; t < 64; t++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  let out = '';
  for (let i = 0; i < 8; i++) {
    const hex = H[i].toString(16);
    out += '00000000'.slice(hex.length) + hex;
  }
  return out;
}

function hashPassword(password) {
  return sha256(String(password === null || password === undefined ? '' : password));
}

function newToken() {
  let token = '';
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      token += Math.floor(Math.random() * 16).toString(16);
    }
  }
  return token;
}

function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone);
  const out = {};
  Object.keys(value).forEach((key) => { out[key] = clone(value[key]); });
  return out;
}

module.exports = {
  PERIODS,
  DEFAULT_SUBJECTS,
  DEFAULT_INTRO,
  DEFAULT_PASSWORD,
  NEARBY_KM,
  NEARBY_CHOICES,
  STATUS_PENDING,
  STATUS_CONFIRMED,
  STATUS_REJECTED,
  STATUS_CANCELLED,
  STATUS_LEGACY_BOOKED,
  STATUS_TRIAL,
  STATUS_MAIN,
  STATUS_ENDED,
  LESSON_PENDING,
  LESSON_CONFIRMED,
  LESSON_UNPAID,
  LESSON_PAID,
  LESSON_TRIAL,
  LESSON_FORMAL,
  TRIAL_PASS,
  TRIAL_FAIL,
  POST_OPEN,
  POST_TAKEN,
  POST_CLOSED,
  PAY_PENDING,
  PAY_CLAIMED,
  PAY_RECEIVED,
  PAY_REFUNDED,
  MATCH_FULL,
  MATCH_PARTIAL,
  MATCH_NONE,
  GRADE_OPTIONS,
  GENDER_OPTIONS,
  EDUCATION_OPTIONS,
  TEACH_MODE_OPTIONS,
  CERTIFICATE_OPTIONS,
  EDUCATION_LEVEL_OPTIONS,
  MIN_YEARS_OPTIONS,
  REQUIRE_CERTIFICATE_OPTIONS,
  GENDER_PICK,
  EDUCATION_PICK,
  YEARS_PICK,
  CERTIFICATE_PICK,
  TEACH_MODE_PICK,
  REQ_UNLIMITED,
  bookingStatusText,
  isActiveBooking,
  lessonStatusText,
  bookingStatusClass,
  lessonStatusClass,
  payStatusClass,
  matchLevelText,
  matchLevelClass,
  requirementsText,
  priceText,
  ROLE_STUDENT,
  ROLE_TEACHER,
  nowText,
  isoDay,
  upcomingDays,
  displayDay,
  displayTime,
  plain,
  priceValue,
  hasCoords,
  distanceKm,
  formatDistance,
  formatRadius,
  sha256,
  hashPassword,
  newToken,
  clone
};
