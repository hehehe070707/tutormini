const util = require('../lib/util.js');

const LEVEL_FULL = 'full';
const LEVEL_PARTIAL = 'partial';
const LEVEL_NONE = 'none';

const COMFORT_KM = 30;

function splitSubjects(text) {
  return util.plain(text).split(/[，,、\/\s]+/).map((item) => item.trim()).filter((item) => item !== '');
}

const TIER_KEYS = ['985', '211', '双一流', '师范', '一本', '二本', '重点'];

function schoolMatches(want, mine) {
  const need = util.plain(want);
  const have = util.plain(mine);
  if (have === '') return false;
  const tiers = TIER_KEYS.filter((key) => need.indexOf(key) >= 0);
  if (tiers.length > 0) return tiers.some((key) => have.indexOf(key) >= 0);
  return have.indexOf(need) >= 0 || need.indexOf(have) >= 0;
}

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

      if (key !== 'distance') score += isHard ? 2 : 1;
      return;
    }
    reasons.push((isHard ? '❌ ' : '⚠️ ') + text);
    if (isHard) hardFail = true; else softFail = true;
  }

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

  if (util.hasRequirement(req, 'gender')) {
    const mine = util.plain(me.gender);
    if (mine === '') {
      check('gender', false, '你的性别没填，无法判断（这单要求' + req.gender + '老师）', false);
    } else {
      const ok = mine === req.gender;
      check('gender', ok, ok ? '性别符合' : '性别不符合（这单要求' + req.gender + '老师）', true);
    }
  }

  if (util.hasRequirement(req, 'certificate')) {
    const mineCert = util.plain(me.certificate);
    if (mineCert === '') {
      check('certificate', false, '你的证书没填，无法判断（要求' + req.certificate + '）', false);
    } else {
      const ok = certHit(mineCert, req.certificate);
      check('certificate', ok, ok ? '证书满足（' + req.certificate + '）' : '缺' + req.certificate, false);
    }
  }

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

function priceLabel(price) {
  const min = Number(price && price.min) || 0;
  const max = Number(price && price.max) || 0;
  if (min <= 0 && max <= 0) return '不限';
  if (min > 0 && max > 0 && min !== max) return min + '-' + max + ' 元/小时';
  return (min || max) + ' 元/小时';
}

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
