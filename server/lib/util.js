/*
 * 服务端通用工具：日期格式化、价格取值、距离计算、SHA-256 摘要、令牌生成。
 * 对应小程序端 utils/util.js —— 业务规则（校验、排序、冲突判断）现在只在服务端实现一份，
 * 小程序端那份只剩「展示格式化」，避免两边规则跑偏。
 */

const crypto = require('node:crypto');

const WEEK_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const STATUS_PENDING = '待确认';
const STATUS_CONFIRMED = '已确认';
const STATUS_REJECTED = '已拒绝';
const STATUS_CANCELLED = '已取消';
const STATUS_LEGACY_BOOKED = '已预约';   // 老版本的"已预约"，等价于"已确认"（老库导入时可能还留着）
// 订单（bookings）新流程：确认接单后先试课，通过了才进主订单
const STATUS_TRIAL = '试课中';           // 确认接单后的第一阶段
const STATUS_MAIN = '主订单进行中';       // 试课通过后
const STATUS_ENDED = '已结束';           // 试课不通过 / 课程全部结束
// 课次（lessons）状态
const LESSON_PENDING = '待确认';         // 老师已提交，等平台确认
const LESSON_CONFIRMED = '已确认';       // 平台确认（计入待支付金额）
const LESSON_UNPAID = '待支付';          // 账单已发起，等支付
const LESSON_PAID = '已支付';
const LESSON_TRIAL = '试课';             // 课次类型
const LESSON_FORMAL = '正式';
const TRIAL_PASS = '通过';
const TRIAL_FAIL = '不通过';
const POST_OPEN = '招募中';
const POST_TAKEN = '已成交';
const POST_CLOSED = '已关闭';
const POST_PENDING_REVIEW = 'pending_review';   // 外部 Agent / 批量导入先落库、不上架的状态
const ROLE_STUDENT = 'student';
const ROLE_TEACHER = 'teacher';
const ROLE_AGENT = 'agent';                     // 虚拟助手（不是登录身份，只在消息 / 会话里用）
const SENDER_USER = 'user';
const SENDER_SYSTEM = 'system';
const SENDER_AGENT = 'agent';
const SOURCE_MANUAL = 'manual';
const SOURCE_AGENT = 'agent';
// 收款 / 退款（payments 表）：平台发合同和收款码 → 老师付款 → 平台确认收款 → 试课
const PAY_PENDING = '待收款';         // 合同已发，等老师付款
const PAY_CLAIMED = '待确认收款';     // 老师点了「我已付款」，等平台核对
const PAY_RECEIVED = '已收款';        // 平台确认到账，可以开始试课
const PAY_REFUNDED = '已退款';        // 平台确认退款完成
const PAY_CHARGE = 'charge';
const PAY_REFUND = 'refund';
/*
 * 发单方对老师只显示这个统一名字：平台后面的真实客户信息（姓名 / 电话 / 门牌号）
 * 不落到老师端。老师端看到的永远是「平台单 + 单号」。
 */
const PLATFORM_NAME = '平台';
const DEFAULT_INTRO = '教学经验丰富，善于根据学生情况定制学习计划。';
const DEFAULT_PASSWORD = '123456';   // 老数据里的老师统一用这个初始密码（示例数据也用）
const DEFAULT_STUDENT_NAME = '张三'; // 还没填资料时用默认名，保证下单不会写空（对应 Session::defaultStudentName）
const NEARBY_KM = 45;

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

// 对应 displayDay：2026-09-17 -> 09-17 周四
function displayDay(dayIso) {
  const parts = String(dayIso || '').split('-');
  if (parts.length !== 3) return String(dayIso || '');
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(d.getTime())) return String(dayIso);
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + WEEK_CN[(d.getDay() + 6) % 7];
}

// 对应 displayTime：上课时间是自由文本，时段为空就直接显示这句话
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

/*
 * 脱敏：单子的位置 / 说明是中介从群里粘过来的，很容易带上客户本人的手机号、
 * 微信 / QQ 号。这里统一在入库前抹掉，保证老师端永远看不到客户的联系方式。
 * 规则：
 *   11 位手机号（含 +86 / 空格 / 横杠分隔）→ 清掉
 *   「电话 / 手机 / 微信 / vx / VX / wx / QQ / 企鹅」后面跟的一串数字 / 字母 → 清掉
 * 看不懂的先原样留着，不做过度处理。
 */
function stripContacts(value) {
  let text = plain(value);
  if (text === '') return '';
  // 11 位手机号（中间可以有空格或横杠）
  text = text.replace(/(?:\+?86[\s-]?)?1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/g, '');
  // 「微信 / 电话 / QQ = xxx」这类：连标签一起去掉，只留前面的内容
  text = text.replace(/(?:微信|徽信|薇信|vx|VX|wx|WX|weixin|WeChat|电话|手机|手机号|联系方式|QQ|qq|企鹅)\s*(?:号|号码)?\s*[:：=是]?\s*[0-9a-zA-Z_\-]{5,}/g, '');
  return text.replace(/\s{2,}/g, ' ').trim();
}

// ---------- 单子要求（posts.requirements，存 JSON 文本）----------
/*
 * 固定字段（家长自由文本解析出来的结构，见 domain/parse.js）：
 *   gender      不限 / 男 / 女
 *   education   不限 / 本科 / 硕士 / 博士
 *   minYears    不限 / 1 / 3 / 5
 *   certificate 不限 / 教师资格证 / 普通话证书
 *   teachMode   不限 / 线下 / 线上
 *   priceMin / priceMax  不限 / 整数（元/小时）—— 家长按次给钱时折算成时薪
 * 全部默认「不限」＝家长没提这条，不参与筛选、也不参与匹配。
 * 另外兼容老单子里的补充字段 school（学校层次）和旧键名 budgetMin / budgetMax（当 priceMin / priceMax 用），
 * 有才存、有才用。
 */
const REQ_UNLIMITED = '不限';
const REQ_GENDERS = ['不限', '男', '女'];
const REQ_EDUCATIONS = ['不限', '本科', '硕士', '博士'];
const REQ_MIN_YEARS = ['不限', '1', '3', '5'];
const REQ_CERTIFICATES = ['不限', '教师资格证', '普通话证书', '四六级', '雅思托福'];
const REQ_TEACH_MODES = ['不限', '线下', '线上'];
const REQ_FIELDS = ['gender', 'education', 'minYears', 'certificate', 'teachMode', 'priceMin', 'priceMax'];
// 按次 / 按节给价、又没说一次上几个小时的，按这个时长折算时薪
const DEFAULT_LESSON_HOURS = 2;

// 学历层级：用来比"本科及以上"这类要求
const EDU_RANK = {
  '小学': 0, '初中': 1, '高中': 2, '中专': 2, '职高': 2, '技校': 2,
  '大专': 3, '专科': 3, '本科': 4, '学士': 4,
  '硕士': 5, '研究生': 5, '博士': 6
};

// '本科及以上' / '硕士' → 4 / 5；看不出层级返回 -1
function educationRank(text) {
  const value = plain(text);
  if (value === '') return -1;
  let best = -1;
  Object.keys(EDU_RANK).forEach((key) => {
    if (value.indexOf(key) >= 0 && EDU_RANK[key] > best) best = EDU_RANK[key];
  });
  return best;
}

// '8 年' / '8年' → 8；没写数字返回 0
function toInt(value) {
  const text = plain(value);
  const matched = text.match(/\d+/);
  return matched ? Number(matched[0]) : 0;
}

// 证书统一成数组：['教师资格证'] / '教师资格证，普通话二甲' / 空
function toList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => plain(item)).filter((item) => item !== '');
  }
  const text = plain(value);
  if (text === '') return [];
  return text.split(/[，,、;；\/|]+/).map((item) => item.trim()).filter((item) => item !== '');
}

// 固定 5 字段的默认值：全是「不限」
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

// 性别：认「男」「女」，别的（含旧数据里的空值）都算「不限」
function genderLevel(value) {
  const text = plain(value);
  return text === '男' || text === '女' ? text : REQ_UNLIMITED;
}

/*
 * 学历：固定档位只有 本科 / 硕士 / 博士。
 * 老数据里的「本科及以上」→ 本科，「硕士及以上」→ 硕士；
 * 「大专及以上」在固定档位里没有对应项，当「不限」（宁可放宽，不误杀老师）。
 */
function educationLevel(value) {
  const text = plain(value);
  if (text === '' || text === REQ_UNLIMITED) return REQ_UNLIMITED;
  if (text.indexOf('博士') >= 0) return '博士';
  if (text.indexOf('硕士') >= 0 || text.indexOf('研究生') >= 0) return '硕士';
  if (text.indexOf('本科') >= 0 || text.indexOf('学士') >= 0) return '本科';
  return REQ_UNLIMITED;
}

/*
 * 教龄：固定档位 不限 / 1 / 3 / 5。
 * 取"不超过原值"的最大档位（2 年 → 1，8 年 → 5），只放宽不收紧，免得把老师误杀。
 */
function yearsLevel(value) {
  const years = toInt(value);
  if (years >= 5) return '5';
  if (years >= 3) return '3';
  if (years >= 1) return '1';
  return REQ_UNLIMITED;
}

/*
 * 证书：固定档位 不限 / 教师资格证 / 普通话证书 / 四六级 / 雅思托福。
 * 老数据里的"普通话二甲""英语四级""CET-6""IELTS"这些写法都往这五档里归一。
 */
function certificateLevel(value) {
  const text = toList(value).join('、');
  if (text.indexOf('教师资格') >= 0) return '教师资格证';
  if (text.indexOf('普通话') >= 0) return '普通话证书';
  if (/四六级|四级|六级|CET|四级证|六级证/.test(text)) return '四六级';
  if (/雅思|托福|IELTS|TOEFL/i.test(text)) return '雅思托福';
  return REQ_UNLIMITED;
}

// 授课方式：不限 / 线下 / 线上
function teachModeLevel(value) {
  const text = plain(value);
  if (text.indexOf('线下') >= 0 || text.indexOf('上门') >= 0) return '线下';
  if (text.indexOf('线上') >= 0 || text.indexOf('网课') >= 0 || text.indexOf('在线') >= 0) return '线上';
  return REQ_UNLIMITED;
}

/* ---------------- 价格：一律折成"元/小时" ----------------
 * 家长给钱的方式不统一：「150 元/小时」好办，「200 元/次」「一节课 300」就得折算。
 * 规矩（和产品说好的）：
 *   1) 能算时薪就算：按次 / 按节给钱的，文本里说了"一次几小时"就按实际时长除，
 *      没说就按 DEFAULT_LESSON_HOURS（2 小时）折算；
 *   2) 算不了或者比较复杂（面议、一次课和一小时混着说、好几个价）→ 返回 0 = 不限，
 *      宁可不筛，也不瞎猜。
 */

function yuanize(value) {
  const n = Number(value);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.max(1, Math.round(n));
}

// '100-150 元/小时' 这种区间：返回 [100, 150]
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
    if (re.lastIndex === m.index) re.lastIndex++;   // 防零宽死循环
    m = re.exec(text);
  }
  return list;
}

// 纯文本 → 时薪区间 [min, max]；算不出来返回 null（= 不限）
const CN_HOURS = { '半': 0.5, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6 };

// 文本里写没写"一次上几个小时"（中文数字也认："一次两小时"）
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
  // 面议 / 看情况这类：没有明确数字，直接不限
  if (/(面议|面谈|具体聊|具体再议|再谈|看情况|待定|私聊|详聊)/.test(text)) return null;

  // 文本里写了的"一次上几个小时"
  const duration = durationOf(text);
  const span = duration > 0 ? duration : (Number(lessonHours) > 0 ? Number(lessonHours) : DEFAULT_LESSON_HOURS);

  // ① 按小时给价：'150 元/小时'、'150-200 元/课时'、'150/小时'、'每小时 150 元'
  const hourly = [];
  allMatches(text, /(\d+)(?!\d)\s*(?:[-~～—至到]\s*(\d+)(?!\d))?\s*元?\s*\/\s*(?:个)?\s*(?:小时|钟头|课时|时)/g)
    .forEach((m) => hourly.push([m[1], m[2]]));
  allMatches(text, /(\d+)(?!\d)\s*(?:[-~～—至到]\s*(\d+)(?!\d))?\s*元\s*(?:每|一)?\s*(?:个)?\s*(?:小时|钟头|课时|时)/g)
    .forEach((m) => hourly.push([m[1], m[2]]));
  // '150 一小时' / '100~150 一小时'（不写"元"也认，但必须是"一/每+小时"这种说法）
  allMatches(text, /(\d+)(?!\d)\s*(?:[-~～—至到]\s*(\d+)(?!\d))?\s*(?:元)?\s*(?:一|每)\s*(?:个)?\s*(?:小时|钟头|课时)/g)
    .forEach((m) => hourly.push([m[1], m[2]]));
  allMatches(text, /(?:每小时|一小时|每个小时|一小时课|课时费|课时)\s*(?:是|收|给)?\s*(\d+)(?!\d)\s*(?:[-~～—至到]\s*(\d+)(?!\d))?\s*元?/g)
    .forEach((m) => hourly.push([m[1], m[2]]));
  if (hourly.length > 1) return null;              // 说了好几个价，太复杂
  if (hourly.length === 1) return rangeOf(hourly[0][0], hourly[0][1]);

  // ② 按次 / 按节给价：'200 元/次'、'一次 300'、'一节课 280 元'
  const perLesson = [];
  allMatches(text, /(\d+)(?!\d)\s*(?:[-~～—至到]\s*(\d+)(?!\d))?\s*元\s*\/?\s*(?:次|节|节课|堂)/g)
    .forEach((m) => perLesson.push([m[1], m[2]]));
  // 「一次 300 元」这种；后面紧挨着"小时"的是时长不是价钱，别当价格
  allMatches(text, /(?:一次|一节课|每次|每节课|每节|单次)\s*(?:是|收|给)?\s*(\d+)(?!\d)\s*(?:[-~～—至到]\s*(\d+)(?!\d))?\s*(?:元|块)?(?![^\d]{0,2}(?:小时|钟头))/g)
    .forEach((m) => perLesson.push([m[1], m[2]]));
  if (perLesson.length > 1) return null;
  if (perLesson.length === 1) {
    const range = rangeOf(perLesson[0][0], perLesson[0][1]);
    if (!range) return null;
    return [yuanize(range[0] / span), yuanize(range[1] / span)];
  }

  /*
   * ③ 裸价格 + 明确时长：'150 一次，两小时'、'两百？不猜中文数字'。
   * 只认两位以上的数字（金额），避免把"3 年以上"当成钱。
   */
  const loose = text.match(/(\d{2,5})(?!\d)\s*(?:元)?[^\d]{0,6}?(\d+(?:\.\d+)?|[一二两三四五六])\s*(?:个)?\s*(?:小时|钟头)/);
  if (loose && CN_HOURS[loose[2]] !== undefined) {
    return rangeOf(Number(loose[1]) / CN_HOURS[loose[2]]);
  }
  if (loose) return rangeOf(Number(loose[1]) / Number(loose[2]));

  return null;
}

/*
 * 价格字段统一成 { min, max }（元/小时，整数；0 = 不限）。
 * 认这些写法：
 *   对象   { priceMin, priceMax } / { budgetMin, budgetMax }（旧键名）/ { hourly } / { price: '150 元/小时' }
 *   字符串 '150 元/小时' / '150-200 一小时' / '200 元/次（一次 2 小时）' / '150'（纯数字当小时价）
 */
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
  // 只有一个数字：当小时价
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    return { min: yuanize(text), max: yuanize(text) };
  }
  const range = priceTextToHourly(text, lessonHours);
  return range ? { min: range[0], max: range[1] } : { min: 0, max: 0 };
}

// 单子要求的时薪（0 = 不限）；老键名 budgetMin / budgetMax 也认
function requirementPrice(req) {
  const r = req || {};
  const min = toInt(r.priceMin) || toInt(r.budgetMin);
  const max = toInt(r.priceMax) || toInt(r.budgetMax) || min;
  return { min, max };
}

/*
 * 把 requirements 统一成固定 5 字段（固定顺序、缺省「不限」）+ 可选补充字段。
 * 兼容三种写法：JSON 文本 / 对象 / 空（老数据没有要求 → 全「不限」）。
 */
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

  // 价格统一折成"元/小时"：priceMin / priceMax；旧单子的 budgetMin / budgetMax 当同义键名用
  const hours = options && options.lessonHours;
  const price = parsePrice({
    priceMin: raw.priceMin, priceMax: raw.priceMax,
    budgetMin: raw.budgetMin, budgetMax: raw.budgetMax,
    hourly: raw.hourly, price: raw.price, priceText: raw.priceText
  }, hours);
  if (price.min > 0) out.priceMin = price.min;
  if (price.max > 0) out.priceMax = price.max;

  // 老单子的可选补充：学校层次（固定字段以外的，留着照旧生效）
  const school = plain(raw.school);
  if (school !== '' && school !== '不限') out.school = school;
  return out;
}

// 这条要求里某个字段是不是"家长明确提了"（「不限」＝没提，不参与筛选 / 匹配）
function hasRequirement(req, key) {
  const value = req ? req[key] : '';
  if (value === undefined || value === null) return false;
  const text = plain(value);
  return text !== '' && text !== REQ_UNLIMITED && text !== '0';
}

/*
 * 存库前统一一下：把「不限」的字段丢掉，只留明确提了的 + 可选补充字段；
 * 一条明确要求都没有就存空串（老数据也是空串，读出来照样是全「不限」）。
 */
function stringifyRequirements(value) {
  const full = parseRequirements(value);
  const out = {};
  REQ_FIELDS.forEach((key) => {
    if (hasRequirement(full, key)) out[key] = full[key];
  });
  if (hasRequirement(full, 'school')) out.school = full.school;
  return Object.keys(out).length > 0 ? JSON.stringify(out) : '';
}

// 教龄档位 → 数字（「不限」= 0），比较用
function requirementYears(req) {
  return toInt(req && req.minYears);
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

function toNumber(value, fallback) {
  const n = Number(value);
  return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
}

/*
 * 状态统一文案（第 6 条：两个端显示同一个词）。
 * 库里还是存 待确认 / 已确认 / 已拒绝 / 已取消，展示时统一成同一套说法。
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

// 订单生命周期里"还在进行中"的三个状态（首页 / 我的课程只放这些，其余进历史）
function isActiveBooking(status) {
  const text = plain(status);
  return text === STATUS_PENDING || text === STATUS_TRIAL || text === STATUS_MAIN ||
         text === STATUS_CONFIRMED || text === STATUS_LEGACY_BOOKED;
}

/*
 * 课次状态统一文案（第 6 条：两个端显示同一个词）。
 * 试课那条额外带一个确认结果（通过 / 不通过）。
 */
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

// 两点球面距离（公里）；任一点没有坐标返回 -1
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

// 密码只存摘要，不落明文（和 Qt 版 hashPassword 一致：SHA-256 十六进制小写）
function sha256(text) {
  return crypto.createHash('sha256')
    .update(String(text === null || text === undefined ? '' : text), 'utf8')
    .digest('hex');
}

function hashPassword(password) {
  return sha256(password);
}

// 生成 64 位十六进制随机令牌（对应 DatabaseManager::newToken，改成密码学安全随机）
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
