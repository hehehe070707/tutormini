/*
 * 老师 ↔ 单子 的匹配判断（对应"单子上写了家长/平台对老师的要求"这套新规则）。
 *
 * matchTeacher(post, teacher, options) → { level, reasons, details }
 *   level: 'full' 全部满足 / 'partial' 部分满足 / 'none' 硬条件不满足
 *   reasons: 给老师看的文字（✅ 已满足 / ⚠️ 存疑或软条件不满足 / ❌ 硬条件不满足）
 *   details: [{ key, ok, hard, text }]，页面详情里逐条列出来用
 *
 * 哪些算硬条件（不满足就是 none）：
 *   可教科目、教龄（单子写了最低年限）、性别（单子指定了）、学历（单子写了层级）
 * 哪些算软条件（不满足只是 partial）：
 *   证书、学校层次、预算、距离
 * 授课方式（线上 / 线下）只当提示：老师资料里没这个字段，判断不了，不参与打分。
 * 没写的要求直接当"老师满足"（旧数据没有 requirements 时就是全 ✅）。
 * 老师那边某个字段没填 → 算"存疑"（partial），不算"不满足"，免得误杀。
 * score 是匹配度打分（硬条件 2 分、软条件 1 分，距离不计分），推荐排序用。
 */

const util = require('../lib/util.js');

const LEVEL_FULL = 'full';
const LEVEL_PARTIAL = 'partial';
const LEVEL_NONE = 'none';

// 距离超过这个公里数就算"较远"（只是软提示，不挡住投递）
const COMFORT_KM = 30;

function splitSubjects(text) {
  return util.plain(text).split(/[，,、\/\s]+/).map((item) => item.trim()).filter((item) => item !== '');
}

// 学校层次：单子写"985/211优先"这类关键词时，老师学校要命中其一
const TIER_KEYS = ['985', '211', '双一流', '师范', '一本', '二本', '重点'];

function schoolMatches(want, mine) {
  const need = util.plain(want);
  const have = util.plain(mine);
  if (have === '') return false;
  const tiers = TIER_KEYS.filter((key) => need.indexOf(key) >= 0);
  if (tiers.length > 0) return tiers.some((key) => have.indexOf(key) >= 0);
  return have.indexOf(need) >= 0 || need.indexOf(have) >= 0;
}

// 证书命中：单子要"教师资格证"，老师填"教师资格证、普通话二甲"算满足；
// 四六级 / 雅思托福可能有多种写法，命中任一关键词就算有
const CERT_KEYS = {
  '教师资格证': ['教师资格'],
  '普通话证书': ['普通话'],
  '四六级': ['四六级', '四级', '六级', 'CET'],
  '雅思托福': ['雅思', '托福', 'IELTS', 'TOEFL']
};

function certHit(mine, need) {
  const keys = CERT_KEYS[need] || [need];
  const text = util.plain(mine);
  return keys.some((key) => text.indexOf(key) >= 0);
}

function matchTeacher(post, teacher, options) {
  const req = util.parseRequirements(post && post.requirements);
  const opts = options || {};
  const me = teacher || {};
  const reasons = [];
  const details = [];
  let hardFail = false;
  let softFail = false;
  let score = 0;

  function check(key, ok, text, hard) {
    const isHard = !!hard;
    details.push({ key, ok: !!ok, hard: isHard, text });
    if (ok) {
      reasons.push('✅ ' + text);
      // 距离人人都有，不计进匹配度；只看"家长明确提了的要求"
      if (key !== 'distance') score += isHard ? 2 : 1;
      return;
    }
    reasons.push((isHard ? '❌ ' : '⚠️ ') + text);
    if (isHard) hardFail = true; else softFail = true;
  }

  // 可教科目（硬）：单子科目和老师的可教科目互相包含就算匹配
  const wantSubject = util.plain(post && post.subject);
  if (wantSubject !== '') {
    const mineSubjects = splitSubjects(me.subject);
    if (mineSubjects.length === 0) {
      check('subject', false, '你的可教科目还没填，无法判断科目是否匹配', false);
    } else {
      const hit = mineSubjects.some((item) =>
        wantSubject.indexOf(item) >= 0 || item.indexOf(wantSubject) >= 0);
      check('subject', hit, hit ? '科目匹配（' + wantSubject + '）' : '科目不匹配（这单要' + wantSubject + '）', true);
    }
  }

  // 学历（硬）：单子写了本科 / 硕士 / 博士，老师的学历层级要够
  if (util.hasRequirement(req, 'education')) {
    const need = util.educationRank(req.education);
    const mine = util.educationRank(me.education);
    if (mine < 0) {
      check('education', false, '你的学历没填，无法判断（要求' + req.education + '）', false);
    } else {
      const ok = need <= 0 || mine >= need;
      check('education', ok, ok
        ? '学历满足（' + util.plain(me.education) + '）'
        : '学历不满足（要求' + req.education + '）', true);
    }
  }

  // 教龄（硬）：单子写了最低年限（1 / 3 / 5）
  if (util.hasRequirement(req, 'minYears')) {
    const need = util.requirementYears(req);
    const mine = util.toInt(me.years);
    if (mine <= 0) {
      check('years', false, '你的教龄没填，无法判断（要求 ' + need + ' 年以上）', false);
    } else {
      const ok = mine >= need;
      check('years', ok, ok
        ? '教龄满足（' + mine + ' 年）'
        : '教龄不足（要求 ' + need + ' 年，你填了 ' + mine + ' 年）', true);
    }
  }

  // 性别（硬）：单子指定了要男老师 / 女老师
  if (util.hasRequirement(req, 'gender')) {
    const mine = util.plain(me.gender);
    if (mine === '') {
      check('gender', false, '你的性别没填，无法判断（这单要求' + req.gender + '老师）', false);
    } else {
      const ok = mine === req.gender;
      check('gender', ok, ok ? '性别符合' : '性别不符合（这单要求' + req.gender + '老师）', true);
    }
  }

  // 证书（软）：固定档位 教师资格证 / 普通话证书，缺哪本提示哪本
  if (util.hasRequirement(req, 'certificate')) {
    const mineCert = util.plain(me.certificate);
    if (mineCert === '') {
      check('certificate', false, '你的证书没填，无法判断（要求' + req.certificate + '）', false);
    } else {
      const ok = certHit(mineCert, req.certificate);
      check('certificate', ok, ok ? '证书满足（' + req.certificate + '）' : '缺' + req.certificate, false);
    }
  }

  /*
   * 授课方式：老师资料里本来没这个字段（简历只有学历 / 学校 / 教龄 / 证书 / 时段）。
   * 筛选面板里填了"我能线上/线下"就按它判断；没填就只当提示，不判断也不计分。
   */
  if (util.hasRequirement(req, 'teachMode')) {
    const mine = util.plain(me.teachMode);
    if (mine === '') {
      details.push({ key: 'teachMode', ok: true, hard: false, text: '这单要' + req.teachMode + '授课' });
      reasons.push('✅ 授课方式：' + req.teachMode);
    } else {
      const ok = mine.indexOf(req.teachMode) >= 0;
      check('teachMode', ok, ok
        ? '授课方式符合（' + req.teachMode + '）'
        : '授课方式不匹配（这单要' + req.teachMode + '）', false);
    }
  }

  /*
   * 学校层次（软）：一般写的是"985/211 优先"这种偏好。
   * 带"优先"两个字 = 加分项，不挡投递；不带"优先"（例如"师范类"）才按匹配算，
   * 不匹配也只是 partial（软条件）。
   */
  if (util.hasRequirement(req, 'school')) {
    const mineSchool = util.plain(me.school);
    const preferred = req.school.indexOf('优先') >= 0;
    if (mineSchool === '') {
      check('school', false, '你的学校没填，无法判断（要求' + req.school + '）', false);
    } else if (preferred) {
      const tierHit = TIER_KEYS.some((key) =>
        req.school.indexOf(key) >= 0 && mineSchool.indexOf(key) >= 0);
      check('school', true, tierHit
        ? '学校层次是加分项，你满足'
        : '学校要求「' + req.school + '」是加分项，不挡投递', false);
    } else {
      const ok = schoolMatches(req.school, mineSchool);
      check('school', ok, ok ? '学校满足（' + mineSchool + '）' : '学校可能不满足（要求' + req.school + '）', false);
    }
  }

  /*
   * 时薪（软）：单子的价格一律是"元/小时"（家长按次给钱的在解析时折算过）。
   * 我的报价高于家长能给的最高时薪 → 提示一句；比家长的下限还低 → 只是句信息。
   */
  const price = util.requirementPrice(req);
  const myPrice = util.priceValue(me.price);
  if (price.max > 0) {
    if (myPrice <= 0) {
      check('price', false, '你的报价没填，无法判断（家长给' + priceLabel(price) + '）', false);
    } else {
      const ok = myPrice <= price.max;
      check('price', ok, ok
        ? '报价在家长的预算内'
        : '报价高于家长预算（' + priceLabel(price) + '，你填了 ' + myPrice + ' 元/小时）', false);
    }
  } else if (price.min > 0 && myPrice > 0 && myPrice < price.min) {
    check('price', true, '报价低于家长预算（' + priceLabel(price) + '），可以适当谈', false);
  }

  // 距离（软）：只是提示远近，不挡住投递
  const km = Number(opts.distanceKm);
  if (isFinite(km) && km >= 0) {
    const ok = km <= COMFORT_KM;
    check('distance', ok, ok
      ? '距离合适（' + formatKm(km) + '）'
      : '距离较远（' + formatKm(km) + '）', false);
  }

  let level = LEVEL_FULL;
  if (hardFail) level = LEVEL_NONE;
  else if (softFail) level = LEVEL_PARTIAL;
  return { level, score, reasons, details };
}

function formatKm(km) {
  if (km < 1) return Math.round(km * 1000) + ' 米';
  if (km < 10) return km.toFixed(1) + ' km';
  return Math.round(km) + ' km';
}

// 单子时薪的一句话：'150 元/小时' / '150-200 元/小时'
function priceLabel(price) {
  const min = Number(price && price.min) || 0;
  const max = Number(price && price.max) || 0;
  if (min <= 0 && max <= 0) return '不限';
  if (min > 0 && max > 0 && min !== max) return min + '-' + max + ' 元/小时';
  return (min || max) + ' 元/小时';
}

// 排序权重：完全符合 > 部分符合 > 不符合
function levelWeight(level) {
  if (level === LEVEL_FULL) return 2;
  if (level === LEVEL_PARTIAL) return 1;
  return 0;
}

module.exports = {
  LEVEL_FULL,
  LEVEL_PARTIAL,
  LEVEL_NONE,
  COMFORT_KM,
  matchTeacher,
  levelWeight
};
