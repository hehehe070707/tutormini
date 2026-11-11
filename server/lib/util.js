const crypto = require('node:crypto');

const WEEK_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

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
const POST_PENDING_REVIEW = 'pending_review';
const ROLE_STUDENT = 'student';
const ROLE_TEACHER = 'teacher';
const ROLE_AGENT = 'agent';
const SENDER_USER = 'user';
const SENDER_SYSTEM = 'system';
const SENDER_AGENT = 'agent';
const SOURCE_MANUAL = 'manual';
const SOURCE_AGENT = 'agent';

const PAY_PENDING = '待收款';
const PAY_CLAIMED = '待确认收款';
const PAY_RECEIVED = '已收款';
const PAY_REFUNDED = '已退款';
const PAY_CHARGE = 'charge';
const PAY_REFUND = 'refund';

const PLATFORM_NAME = '平台';
const DEFAULT_INTRO = '教学经验丰富，善于根据学生情况定制学习计划。';
const DEFAULT_PASSWORD = '123456';
const DEFAULT_STUDENT_NAME = '张三';
const NEARBY_KM = 45;

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

function displayDay(dayIso) {
  const parts = String(dayIso || '').split('-');
  if (parts.length !== 3) return String(dayIso || '');
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(d.getTime())) return String(dayIso);
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + WEEK_CN[(d.getDay() + 6) % 7];
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

function stripContacts(value) {
  let text = plain(value);
  if (text === '') return '';

  text = text.replace(/(?:\+?86[\s-]?)?1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/g, '');

  text = text.replace(/(?:微信|徽信|薇信|vx|VX|wx|WX|weixin|WeChat|电话|手机|手机号|联系方式|QQ|qq|企鹅)\s*(?:号|号码)?\s*[:：=是]?\s*[0-9a-zA-Z_\-]{5,}/g, '');
  return text.replace(/\s{2,}/g, ' ').trim();
}

const REQ_UNLIMITED = '不限';
const REQ_GENDERS = ['不限', '男', '女'];
const REQ_EDUCATIONS = ['不限', '本科', '硕士', '博士'];
const REQ_MIN_YEARS = ['不限', '1', '3', '5'];
const REQ_CERTIFICATES = ['不限', '教师资格证', '普通话证书', '四六级', '雅思托福'];
const REQ_TEACH_MODES = ['不限', '线下', '线上'];
const REQ_FIELDS = ['gender', 'education', 'minYears', 'certificate', 'teachMode', 'priceMin', 'priceMax'];

const DEFAULT_LESSON_HOURS = 2;

const EDU_RANK = {
  '小学': 0, '初中': 1, '高中': 2, '中专': 2, '职高': 2, '技校': 2,
  '大专': 3, '专科': 3, '本科': 4, '学士': 4,
  '硕士': 5, '研究生': 5, '博士': 6
};

function educationRank(text) {
  const value = plain(text);
  if (value === '') return -1;
  let best = -1;
  Object.keys(EDU_RANK).forEach((key) => {
    if (value.indexOf(key) >= 0 && EDU_RANK[key] > best) best = EDU_RANK[key];
  });
  return best;
}

function toInt(value) {
  const text = plain(value);
  const matched = text.match(/\d+/);
  return matched ? Number(matched[0]) : 0;
}

function toList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => plain(item)).filter((item) => item !== '');
  }
  const text = plain(value);
  if (text === '') return [];
  return text.split(/[，,、;；\/|]+/).map((item) => item.trim()).filter((item) => item !== '');
}

function blankRequirements() {
  return {
    gender: REQ_UNLIMITED,
    education: REQ_UNLIMITED,
    minYears: REQ_UNLIMITED,
    certificate: REQ_UNLIMITED,
    teachMode: REQ_UNLIMITED,
    priceMin: REQ_UNLIMITED,
    priceMax: REQ_UNLIMITED
  };
}

function genderLevel(value) {
  const text = plain(value);
  return text === '男' || text === '女' ? text : REQ_UNLIMITED;
}

function educationLevel(value) {
  const text = plain(value);
  if (text === '' || text === REQ_UNLIMITED) return REQ_UNLIMITED;
  if (text.indexOf('博士') >= 0) return '博士';
  if (text.indexOf('硕士') >= 0 || text.indexOf('研究生') >= 0) return '硕士';
  if (text.indexOf('本科') >= 0 || text.indexOf('学士') >= 0) return '本科';
  return REQ_UNLIMITED;
}

function yearsLevel(value) {
  const years = toInt(value);
  if (years >= 5) return '5';
  if (years >= 3) return '3';
  if (years >= 1) return '1';
  return REQ_UNLIMITED;
}

function certificateLevel(value) {
  const text = toList(value).join('、');
  if (text.indexOf('教师资格') >= 0) return '教师资格证';
  if (text.indexOf('普通话') >= 0) return '普通话证书';
  if (/四六级|四级|六级|CET|四级证|六级证/.test(text)) return '四六级';
  if (/雅思|托福|IELTS|TOEFL/i.test(text)) return '雅思托福';
  return REQ_UNLIMITED;
}

function teachModeLevel(value) {
  const text = plain(value);
  if (text.indexOf('线下') >= 0 || text.indexOf('上门') >= 0) return '线下';
  if (text.indexOf('线上') >= 0 || text.indexOf('网课') >= 0 || text.indexOf('在线') >= 0) return '线上';
  return REQ_UNLIMITED;
}

function yuanize(value) {
  const n = Number(value);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.max(1, Math.round(n));
}

function rangeOf(low, high) {
  const lo = yuanize(low);
  const hi = yuanize(high === undefined || high === null || high === '' ? low : high);
  if (lo <= 0) return null;
  return [lo, Math.max(lo, hi)];
}

function allMatches(text, re) {
  const list = [];
  re.lastIndex = 0;
  let m = re.exec(text);
  while (m !== null) {
    list.push(m);
    if (re.lastIndex === m.index) re.lastIndex++;
    m = re.exec(text);
  }
  return list;
}

const CN_HOURS = { '半': 0.5, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6 };

function durationOf(text) {
  const m = text.match(/(\d+(?:\.\d+)?|[半一二两三四五六])\s*(?:个)?\s*(?:小时|钟头)/);
  if (!m) return 0;
  const raw = m[1];
  if (CN_HOURS[raw] !== undefined) return CN_HOURS[raw];
  return Number(raw) || 0;
}

function priceTextToHourly(value, lessonHours) {
  const text = plain(value);
  if (text === '') return null;

  if (/(面议|面谈|具体聊|具体再议|再谈|看情况|待定|私聊|详聊)/.test(text)) return null;

  const duration = durationOf(text);
  const span = duration > 0 ? duration : (Number(lessonHours) > 0 ? Number(lessonHours) : DEFAULT_LESSON_HOURS);

  const hourly = [];
  allMatches(text, /(\d+)(?!\d)\s*(?:[-~～—至到]\s*(\d+)(?!\d))?\s*元?\s*\/\s*(?:个)?\s*(?:小时|钟头|课时|时)/g)
    .forEach((m) => hourly.push([m[1], m[2]]));
  allMatches(text, /(\d+)(?!\d)\s*(?:[-~～—至到]\s*(\d+)(?!\d))?\s*元\s*(?:每|一)?\s*(?:个)?\s*(?:小时|钟头|课时|时)/g)
    .forEach((m) => hourly.push([m[1], m[2]]));

  allMatches(text, /(\d+)(?!\d)\s*(?:[-~～—至到]\s*(\d+)(?!\d))?\s*(?:元)?\s*(?:一|每)\s*(?:个)?\s*(?:小时|钟头|课时)/g)
    .forEach((m) => hourly.push([m[1], m[2]]));
  allMatches(text, /(?:每小时|一小时|每个小时|一小时课|课时费|课时)\s*(?:是|收|给)?\s*(\d+)(?!\d)\s*(?:[-~～—至到]\s*(\d+)(?!\d))?\s*元?/g)
    .forEach((m) => hourly.push([m[1], m[2]]));
  if (hourly.length > 1) return null;
  if (hourly.length === 1) return rangeOf(hourly[0][0], hourly[0][1]);

  const perLesson = [];
  allMatches(text, /(\d+)(?!\d)\s*(?:[-~～—至到]\s*(\d+)(?!\d))?\s*元\s*\/?\s*(?:次|节|节课|堂)/g)
    .forEach((m) => perLesson.push([m[1], m[2]]));

  allMatches(text, /(?:一次|一节课|每次|每节课|每节|单次)\s*(?:是|收|给)?\s*(\d+)(?!\d)\s*(?:[-~～—至到]\s*(\d+)(?!\d))?\s*(?:元|块)?(?![^\d]{0,2}(?:小时|钟头))/g)
    .forEach((m) => perLesson.push([m[1], m[2]]));
  if (perLesson.length > 1) return null;
  if (perLesson.length === 1) {
    const range = rangeOf(perLesson[0][0], perLesson[0][1]);
    if (!range) return null;
    return [yuanize(range[0] / span), yuanize(range[1] / span)];
  }

  const loose = text.match(/(\d{2,5})(?!\d)\s*(?:元)?[^\d]{0,6}?(\d+(?:\.\d+)?|[一二两三四五六])\s*(?:个)?\s*(?:小时|钟头)/);
  if (loose && CN_HOURS[loose[2]] !== undefined) {
    return rangeOf(Number(loose[1]) / CN_HOURS[loose[2]]);
  }
  if (loose) return rangeOf(Number(loose[1]) / Number(loose[2]));

  return null;
}

function parsePrice(value, lessonHours) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const min = toInt(value.priceMin !== undefined ? value.priceMin : value.budgetMin) ||
      toInt(value.hourly) || toInt(value.min);
    const max = toInt(value.priceMax !== undefined ? value.priceMax : value.budgetMax) ||
      toInt(value.max);
    if (min > 0 || max > 0) {
      const lo = min > 0 ? min : max;
      const hi = max > 0 ? max : min;
      const range = rangeOf(lo, hi);
      if (range) return { min: range[0], max: range[1] };
    }
    return priceTextToHourly(value.priceText || value.price || value.text, lessonHours) ||
      { min: 0, max: 0 };
  }

  const text = plain(value);
  if (text === '' || text === REQ_UNLIMITED) return { min: 0, max: 0 };

  if (/^\d+(?:\.\d+)?$/.test(text)) {
    return { min: yuanize(text), max: yuanize(text) };
  }
  const range = priceTextToHourly(text, lessonHours);
  return range ? { min: range[0], max: range[1] } : { min: 0, max: 0 };
}

function requirementPrice(req) {
  const r = req || {};
  const min = toInt(r.priceMin) || toInt(r.budgetMin);
  const max = toInt(r.priceMax) || toInt(r.budgetMax) || min;
  return { min, max };
}

function parseRequirements(value, options) {
  let raw = value;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text === '') return blankRequirements();
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return blankRequirements();
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return blankRequirements();

  const out = blankRequirements();
  out.gender = genderLevel(raw.gender);
  out.education = educationLevel(raw.education);
  out.minYears = yearsLevel(raw.minYears);
  out.certificate = certificateLevel(raw.certificate);
  out.teachMode = teachModeLevel(raw.teachMode);

  const hours = options && options.lessonHours;
  const price = parsePrice({
    priceMin: raw.priceMin, priceMax: raw.priceMax,
    budgetMin: raw.budgetMin, budgetMax: raw.budgetMax,
    hourly: raw.hourly, price: raw.price, priceText: raw.priceText
  }, hours);
  if (price.min > 0) out.priceMin = price.min;
  if (price.max > 0) out.priceMax = price.max;

  const school = plain(raw.school);
  if (school !== '' && school !== '不限') out.school = school;
  return out;
}

function hasRequirement(req, key) {
  const value = req ? req[key] : '';
  if (value === undefined || value === null) return false;
  const text = plain(value);
  return text !== '' && text !== REQ_UNLIMITED && text !== '0';
}

function stringifyRequirements(value) {
  const full = parseRequirements(value);
  const out = {};
  REQ_FIELDS.forEach((key) => {
    if (hasRequirement(full, key)) out[key] = full[key];
  });
  if (hasRequirement(full, 'school')) out.school = full.school;
  return Object.keys(out).length > 0 ? JSON.stringify(out) : '';
}

function requirementYears(req) {
  return toInt(req && req.minYears);
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

function toNumber(value, fallback) {
  const n = Number(value);
  return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
}

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
  if (text === LESSON_PENDING) {
    return outcome === TRIAL_PASS ? '待确认（通过？）'
      : outcome === TRIAL_FAIL ? '待确认（不通过？）' : '待平台确认';
  }
  if (text === LESSON_CONFIRMED) {
    if (outcome === TRIAL_PASS) return '已确认 · 通过';
    if (outcome === TRIAL_FAIL) return '已确认 · 不通过';
    return '已确认';
  }
  if (text === LESSON_UNPAID) return '待支付';
  if (text === LESSON_PAID) return '已支付';
  return text;
}

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
  const km = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  return isFinite(km) ? km : -1;
}

function sha256(text) {
  return crypto.createHash('sha256')
    .update(String(text === null || text === undefined ? '' : text), 'utf8')
    .digest('hex');
}

function hashPassword(password) {
  return sha256(password);
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  WEEK_CN,
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
  POST_PENDING_REVIEW,
  ROLE_STUDENT,
  ROLE_TEACHER,
  ROLE_AGENT,
  SENDER_USER,
  SENDER_SYSTEM,
  SENDER_AGENT,
  SOURCE_MANUAL,
  SOURCE_AGENT,
  PLATFORM_NAME,
  REQ_UNLIMITED,
  REQ_GENDERS,
  REQ_EDUCATIONS,
  REQ_MIN_YEARS,
  REQ_CERTIFICATES,
  REQ_TEACH_MODES,
  REQ_FIELDS,
  DEFAULT_LESSON_HOURS,
  PAY_PENDING,
  PAY_CLAIMED,
  PAY_RECEIVED,
  PAY_REFUNDED,
  PAY_CHARGE,
  PAY_REFUND,
  DEFAULT_INTRO,
  DEFAULT_PASSWORD,
  DEFAULT_STUDENT_NAME,
  NEARBY_KM,
  nowText,
  displayDay,
  displayTime,
  plain,
  stripContacts,
  educationRank,
  toInt,
  toList,
  blankRequirements,
  parseRequirements,
  stringifyRequirements,
  parsePrice,
  requirementPrice,
  hasRequirement,
  requirementYears,
  priceValue,
  toNumber,
  bookingStatusText,
  isActiveBooking,
  lessonStatusText,
  hasCoords,
  distanceKm,
  sha256,
  hashPassword,
  newToken
};
