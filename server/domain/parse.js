const util = require('../lib/util.js');

const SOURCE_AGENT = 'agent';
const SOURCE_LOCAL = 'local';
const SOURCE_NONE = 'none';
const SOURCE_EMPTY = 'empty';

const DEFAULT_TIMEOUT_MS = 5000;

function blankResult(rawText) {
  return {
    gender: util.REQ_UNLIMITED,
    education: util.REQ_UNLIMITED,
    minYears: util.REQ_UNLIMITED,
    certificate: util.REQ_UNLIMITED,
    teachMode: util.REQ_UNLIMITED,
    priceMin: util.REQ_UNLIMITED,
    priceMax: util.REQ_UNLIMITED,
    raw_text: util.plain(rawText)
  };
}

function hasExplicit(result) {
  return util.REQ_FIELDS.some((key) => util.hasRequirement(result, key));
}

function pickPayload(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const inner = data.requirements || data.data || data.result;
  return inner && typeof inner === 'object' ? inner : data;
}

function localParse(text, lessonHours) {
  const raw = util.plain(text);
  const out = {};
  if (raw === '') return out;

  const wantWoman = /(女老师|女教师|女家教|女性老师)/.test(raw) ||
    /(性别|要求)[：:是]?\s*女/.test(raw) ||
    /(^|[，,。；;、\s])女(的)?([，,。；;、\s]|$)/.test(raw);
  const wantMan = /(男老师|男教师|男家教|男性老师)/.test(raw) ||
    /(性别|要求)[：:是]?\s*男/.test(raw) ||
    /(^|[，,。；;、\s])男(的)?([，,。；;、\s]|$)/.test(raw);
  if (wantWoman !== wantMan) out.gender = wantWoman ? '女' : '男';

  if (/博士/.test(raw)) out.education = '博士';
  else if (/(硕士|研究生)/.test(raw)) out.education = '硕士';
  else if (/(本科|学士|一本|重点大学)/.test(raw)) out.education = '本科';

  const years = raw.match(/(\d{1,2})\s*年/);
  if (years && /(教龄|经验|教学|带过|以上)/.test(raw)) out.minYears = years[1];

  if (/教师资格|教师证/.test(raw)) out.certificate = '教师资格证';
  else if (/普通话/.test(raw)) out.certificate = '普通话证书';
  else if (/四六级|四级|六级|CET/.test(raw)) out.certificate = '四六级';
  else if (/雅思|托福|IELTS|TOEFL/i.test(raw)) out.certificate = '雅思托福';

  const offline = /(线下|上门|面授)/.test(raw);
  const online = /(线上|网课|在线|远程)/.test(raw);
  if (offline !== online) out.teachMode = offline ? '线下' : '线上';

  const price = util.parsePrice(raw, lessonHours);
  if (price.min > 0) {
    out.priceMin = price.min;
    out.priceMax = price.max;
  }

  return out;
}

async function requestAgent(config, text) {
  const url = util.plain(config && config.agentParseUrl);
  if (url === '') return null;
  const timeoutMs = Number(config && config.agentParseTimeoutMs) || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const header = { 'Content-Type': 'application/json' };
    const token = util.plain(config && config.agentParseToken);
    if (token !== '') header['X-Agent-Token'] = token;
    const res = await fetch(url, {
      method: 'POST',
      headers: header,
      body: JSON.stringify({ text: util.plain(text) }),
      signal: controller.signal
    });
    if (!res.ok) return null;
    const data = await res.json();
    const payload = pickPayload(data);

    return payload && typeof payload === 'object' ? payload : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function parseText(config, text) {
  const raw = util.plain(text);
  if (raw === '') {
    const empty = blankResult('');
    empty.source = SOURCE_EMPTY;
    return empty;
  }

  if (util.plain(config && config.agentParseUrl) !== '') {
    const payload = await requestAgent(config, raw);
    if (!payload) {

      const failed = blankResult(raw);
      failed.source = SOURCE_NONE;
      return failed;
    }
    const normalized = util.parseRequirements(payload, { lessonHours: config && config.lessonHours });
    const result = blankResult(raw);
    util.REQ_FIELDS.forEach((key) => { result[key] = normalized[key]; });
    result.source = hasExplicit(result) ? SOURCE_AGENT : SOURCE_NONE;
    return result;
  }

  const normalized = util.parseRequirements(localParse(raw, config && config.lessonHours));
  const result = blankResult(raw);
  util.REQ_FIELDS.forEach((key) => { result[key] = normalized[key]; });
  result.source = hasExplicit(result) ? SOURCE_LOCAL : SOURCE_NONE;
  return result;
}

async function parseTexts(config, texts) {
  const list = Array.isArray(texts) ? texts : [];
  const out = [];
  for (const text of list.slice(0, 50)) {
    out.push(await parseText(config, text));
  }
  return out;
}

function requirementPayload(result) {
  const out = {};
  util.REQ_FIELDS.forEach((key) => { out[key] = result ? result[key] : util.REQ_UNLIMITED; });
  return out;
}

module.exports = {
  SOURCE_AGENT,
  SOURCE_LOCAL,
  SOURCE_NONE,
  SOURCE_EMPTY,
  blankResult,
  hasExplicit,
  localParse,
  parseText,
  parseTexts,
  requirementPayload
};
