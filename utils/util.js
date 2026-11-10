/*
 * 通用工具：日期 / 时段、自由文本价格、文本清洗、密码摘要（SHA-256）。
 * 对应 Qt 版 databasemanager.cpp 里的匿名命名空间工具函数 + QDate/QLocale 那部分。
 */

const PERIODS = ['上午', '下午', '晚上'];   // 老数据里的时段；现在上课时间由用户自己填，只用来显示旧记录
const WEEK_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

// 对应 QDateTime::currentDateTime().toString("yyyy-MM-dd HH:mm")
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

// 对应 DatabaseManager::upcomingDays(days)：从今天起往后 days 天
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

// 对应 displayDay：2026-09-17 -> 09-17 周四
function displayDay(dayIso) {
  const parts = String(dayIso || '').split('-');
  if (parts.length !== 3) return String(dayIso || '');
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(d.getTime())) return String(dayIso);
  const weekday = WEEK_CN[(d.getDay() + 6) % 7];   // JS 里 0 是周日，转成周一开始
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + weekday;
}

// 对应 displayTime：09-17 周四 上午
// 上课时间现在由用户自己填（日期和时段合成一句话），时段为空就直接显示这句话
function displayTime(dayIso, period) {
  const text = plain(period);
  if (text === '') return plain(dayIso);
  return displayDay(dayIso) + ' ' + text;
}

// 对应 plain()：null/undefined 当空串，去掉首尾空格
function plain(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

// 对应 priceValue()：价格是自由文本，统计时只取开头的数字（“面议”算 0）
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

// 状态文案（和 Qt 版 DatabaseManager 的常量一字不差）
// ---------- 附近距离（小程序特有：Qt 版没有"只显示多远以内"的限制）----------
const NEARBY_KM = 45;                     // 默认只看 45 公里内
const NEARBY_CHOICES = [5, 10, 20, 45, 100, 0];   // 页面上可调；0 = 不限距离
const EARTH_RADIUS_KM = 6371;             // 地球平均半径，Haversine 用

// 有没有可用的经纬度：0/0 当"没定位过"（中国境内不会出现这个坐标）
function hasCoords(lat, lng) {
  const a = Number(lat);
  const o = Number(lng);
  if (!isFinite(a) || !isFinite(o)) return false;
  return !(a === 0 && o === 0);
}

function toRad(deg) {
  return Number(deg) * Math.PI / 180;
}

// 两点球面距离（公里）；任一点没有坐标返回 -1，调用方据此当"距离未知"处理
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

// 距离文字：1 公里以内报米，其余保留一位小数
function formatDistance(km) {
  if (km < 0) return '距离未知';
  if (km < 1) return Math.round(km * 1000) + ' 米';
  if (km < 10) return km.toFixed(1) + ' 公里';
  return Math.round(km) + ' 公里';
}

// 半径文案：0（或不合法）显示"不限距离"
function formatRadius(km) {
  const value = Number(km);
  if (!isFinite(value) || value <= 0) return '不限距离';
  return value + ' 公里内';
}

const STATUS_PENDING = '待确认';
const STATUS_CONFIRMED = '已确认';
const STATUS_REJECTED = '已拒绝';
const STATUS_CANCELLED = '已取消';
const STATUS_LEGACY_BOOKED = '已预约';   // 老版本的“已预约”，迁移成“已确认”
// 订单新流程：确认接单后先试课，通过了才进主订单（和服务端 server/lib/util.js 一套）
const STATUS_TRIAL = '试课中';
const STATUS_MAIN = '主订单进行中';
const STATUS_ENDED = '已结束';
// 课次状态（lessons 表）
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
// 收款 / 退款状态（payments 表）：和 server/lib/util.js 一套
const PAY_PENDING = '待收款';
const PAY_CLAIMED = '待确认收款';
const PAY_RECEIVED = '已收款';
const PAY_REFUNDED = '已退款';
// 老师 ↔ 单子 的匹配档位（和服务端 server/domain/match.js 一套）
const MATCH_FULL = 'full';
const MATCH_PARTIAL = 'partial';
const MATCH_NONE = 'none';
const ROLE_STUDENT = 'student';
const ROLE_TEACHER = 'teacher';
const DEFAULT_INTRO = '教学经验丰富，善于根据学生情况定制学习计划。';

/*
 * 状态统一文案（第 6 条：同一个状态两个端显示同一个词）。
 * 库里存的是 待确认 / 试课中 / 主订单进行中 / 已结束 / 已拒绝 / 已取消，
 * 课次存 待确认 / 已确认 / 待支付 / 已支付，页面上统一走这里。
 */
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

// 订单还在进行中（首页 / 我的课程只放这些，其余进「我的」历史）
function isActiveBooking(status) {
  const text = plain(status);
  return text === STATUS_PENDING || text === STATUS_TRIAL || text === STATUS_MAIN ||
         text === STATUS_CONFIRMED || text === STATUS_LEGACY_BOOKED;
}

// 课次状态文案：试课那条额外带确认结果（通过 / 不通过）
function lessonStatusText(status, result) {
  const text = plain(status);
  const outcome = plain(result);
  if (text === LESSON_PENDING) return outcome === '' ? '待平台确认' : '待确认（' + outcome + '？）';
  if (text === LESSON_CONFIRMED) return outcome === '' ? '已确认' : '已确认 · ' + outcome;
  if (text === LESSON_UNPAID) return '待支付';
  if (text === LESSON_PAID) return '已支付';
  return text;
}

// 状态对应哪个色（和 app.wxss 里的 st-* 一套）
function bookingStatusClass(status) {
  const text = plain(status);
  if (text === STATUS_PENDING || text === STATUS_TRIAL) return 'st-pending';
  if (text === STATUS_MAIN || text === STATUS_CONFIRMED || text === STATUS_LEGACY_BOOKED) return 'st-confirmed';
  if (text === STATUS_REJECTED) return 'st-rejected';
  if (text === STATUS_ENDED) return 'st-closed';
  return 'st-cancelled';
}

// 课次状态颜色：待确认 / 待支付是琥珀色，已确认 / 已支付是绿色，试课不通过是红的
function lessonStatusClass(status, result) {
  const outcome = plain(result);
  if (outcome === TRIAL_FAIL) return 'st-rejected';
  const text = plain(status);
  if (text === LESSON_PENDING || text === LESSON_UNPAID) return 'st-pending';
  if (text === LESSON_CONFIRMED || text === LESSON_PAID) return 'st-confirmed';
  return 'st-closed';
}

// 收款状态颜色：待收款 / 待确认 = 琥珀，已收款 = 绿，已退款 = 灰
function payStatusClass(status) {
  const text = plain(status);
  if (text === PAY_PENDING || text === PAY_CLAIMED) return 'st-pending';
  if (text === PAY_RECEIVED) return 'st-confirmed';
  return 'st-closed';
}

// 匹配徽章：完全符合 / 部分符合 / 不符合
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

// 发单页 / 筛选面板用的选项
const GRADE_OPTIONS = ['不限', '小学', '初一', '初二', '初三', '高一', '高二', '高三', '小学奥数', '大一', '大二'];
const GENDER_OPTIONS = ['不限', '男', '女'];
const EDUCATION_OPTIONS = ['不限', '大专及以上', '本科及以上', '硕士及以上'];
const TEACH_MODE_OPTIONS = ['不限', '线下', '线上'];
const CERTIFICATE_OPTIONS = ['教师资格证', '普通话二甲', '英语专八', '雅思/托福'];

/*
 * 单子对老师的要求（posts.requirements）：家长原话过一遍 Agent 解析出来的固定字段，
 * 和后端 lib/util.js 的 REQ_* 常量一一对应。全默认「不限」＝家长没提，不参与筛选。
 *   gender 男/女 · education 本科/硕士/博士 · minYears 1/3/5
 *   certificate 教师资格证/普通话证书 · teachMode 线下/线上
 */
const EDUCATION_LEVEL_OPTIONS = ['不限', '本科', '硕士', '博士'];
const MIN_YEARS_OPTIONS = ['不限', '1', '3', '5'];
const REQUIRE_CERTIFICATE_OPTIONS = ['不限', '教师资格证', '普通话证书', '四六级', '雅思托福'];
// 老师端筛选面板上的多选选项（「不限」不列出来：一个都不勾就是不限）
const GENDER_PICK = ['男', '女'];
const EDUCATION_PICK = ['本科', '硕士', '博士'];
const YEARS_PICK = ['1', '3', '5'];
const CERTIFICATE_PICK = ['教师资格证', '普通话证书', '四六级', '雅思托福'];
const TEACH_MODE_PICK = ['线下', '线上'];
const REQ_UNLIMITED = '不限';

/*
 * 时薪写法：'150 元/小时' / '100-200 元/小时'；不限返回空串
 */
function priceText(min, max) {
  const lo = Number(min) || 0;
  const hi = Number(max) || 0;
  if (lo <= 0 && hi <= 0) return '';
  if (lo > 0 && hi > 0 && lo !== hi) return lo + '-' + hi + ' 元/小时';
  return (lo || hi) + ' 元/小时';
}

/*
 * 把结构化要求拼成一句话（卡片上显示用）：
 * '本科 · 2 年以上 · 教师资格证 · 女老师 · 100-200 元/小时 · 线下'
 * 「不限」的字段不显示（家长没提就是没要求）。
 */
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

const DEFAULT_PASSWORD = '123456';       // 老数据里的老师统一用这个初始密码
const DEFAULT_SUBJECTS = ['数学', '语文', '英语', '物理', '化学', '生物'];

// ---------- SHA-256（小程序没有加密库，自己实现，保证库里不落明文密码）----------
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
  // 长度按 64 位大端写（高位补 0，够用）
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

// 密码只存摘要，不落明文（和 Qt 版 hashPassword 一致）
function hashPassword(password) {
  return sha256(String(password === null || password === undefined ? '' : password));
}

// 生成 64 位十六进制随机令牌（对应 DatabaseManager::newToken）
function newToken() {
  let token = '';
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      token += Math.floor(Math.random() * 16).toString(16);
    }
  }
  return token;
}

// 深拷贝：store 返回值都拷贝一份，页面改了不影响“库”（等价于 C++ 按值返回结构体）
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
