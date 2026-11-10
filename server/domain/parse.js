/*
 * 家长自由文本 → 结构化要求（对应"中介把家长的话粘进小程序，系统自动解析"这套流程）。
 *
 * 只留接口和兜底规则，**不实现 Agent 本体**：
 *   1) 配了 AGENT_PARSE_URL（外部 Agent 的解析接口）→ 把 { text } POST 过去，
 *      拿回来的字段过一遍白名单（util.parseRequirements），脏值一律当「不限」；
 *   2) 没配（本地开发 / 没接 Agent）→ 用下面的保守关键词规则顶一下，功能今天就能跑通；
 *   3) 外部接口报错 / 超时 → 解析失败，固定字段全「不限」，家长原话照原样保留 ——
 *      发单不能被解析拖住，中介那边也不需要确认。
 *
 * 固定字段（全默认「不限」＝家长没提，不参与筛选）：
 *   gender 男/女 · education 本科/硕士/博士 · minYears 1/3/5
 *   certificate 教师资格证/普通话证书 · teachMode 线下/线上
 *   priceMin / priceMax 元/小时（家长按次给钱的折算成时薪，折不了就不限）
 */

const util = require('../lib/util.js');

const SOURCE_AGENT = 'agent';       // 外部 Agent 解析出来的
const SOURCE_LOCAL = 'local';       // 没配外部 Agent，本地规则兜底
const SOURCE_NONE = 'none';         // 解析失败 / 没识别出任何要求
const SOURCE_EMPTY = 'empty';       // 压根没给原话

const DEFAULT_TIMEOUT_MS = 5000;

// 固定字段全「不限」 + 原话：解析失败、没识别出来时的结果
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

// 这条解析结果里有没有"家长明确提了"的字段（全「不限」＝什么都没识别出来）
function hasExplicit(result) {
  return util.REQ_FIELDS.some((key) => util.hasRequirement(result, key));
}

/*
 * 外部 Agent 的返回可能是这几种写法，都认：
 *   { gender, education, ... } / { requirements: {...} } / { data: {...} } / { result: {...} }
 * 认不出的字段过白名单 → 「不限」，所以外部写错词也不会污染库里的数据。
 */
function pickPayload(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const inner = data.requirements || data.data || data.result;
  return inner && typeof inner === 'object' ? inner : data;
}

/*
 * 本地兜底规则：只认"明说"的，模糊的一律不猜
 *   「最好有经验」「有经验优先」→ minYears 不限（不猜年限，这是产品定的规矩）
 *   「女」「女生」这种没跟老师/教师/性别连在一起的词不算（多半说的是孩子）
 */
function localParse(text, lessonHours) {
  const raw = util.plain(text);
  const out = {};
  if (raw === '') return out;

  /*
   * 性别：不认孤立的一个"女"字（"学生是女生"说的是孩子，不是老师）。
   * 只认三种写法：① 女老师 / 女家教；② "性别：女" / "要求女"；③ 单独一个"女"字成词。
   */
  const wantWoman = /(女老师|女教师|女家教|女性老师)/.test(raw) ||
    /(性别|要求)[：:是]?\s*女/.test(raw) ||
    /(^|[，,。；;、\s])女(的)?([，,。；;、\s]|$)/.test(raw);
  const wantMan = /(男老师|男教师|男家教|男性老师)/.test(raw) ||
    /(性别|要求)[：:是]?\s*男/.test(raw) ||
    /(^|[，,。；;、\s])男(的)?([，,。；;、\s]|$)/.test(raw);
  if (wantWoman !== wantMan) out.gender = wantWoman ? '女' : '男';

  // 学历
  if (/博士/.test(raw)) out.education = '博士';
  else if (/(硕士|研究生)/.test(raw)) out.education = '硕士';
  else if (/(本科|学士|一本|重点大学)/.test(raw)) out.education = '本科';

  /*
   * 教龄：只认带数字的（"3 年以上" / "5 年教龄"）。
   * 中文数字、'有经验' 这类模糊说法都不猜。
   */
  const years = raw.match(/(\d{1,2})\s*年/);
  if (years && /(教龄|经验|教学|带过|以上)/.test(raw)) out.minYears = years[1];

  // 证书（固定五档：教师资格证 / 普通话证书 / 四六级 / 雅思托福）
  if (/教师资格|教师证/.test(raw)) out.certificate = '教师资格证';
  else if (/普通话/.test(raw)) out.certificate = '普通话证书';
  else if (/四六级|四级|六级|CET/.test(raw)) out.certificate = '四六级';
  else if (/雅思|托福|IELTS|TOEFL/i.test(raw)) out.certificate = '雅思托福';

  // 授课方式：两种都说了就当年限不明确，算「不限」
  const offline = /(线下|上门|面授)/.test(raw);
  const online = /(线上|网课|在线|远程)/.test(raw);
  if (offline !== online) out.teachMode = offline ? '线下' : '线上';

  // 价格：一律折成元/小时（按次给钱的按"一次几小时"或默认时长折算，折不了就不限）
  const price = util.parsePrice(raw, lessonHours);
  if (price.min > 0) {
    out.priceMin = price.min;
    out.priceMax = price.max;
  }

  return out;
}

// 调外部 Agent 的解析接口；没配 / 报错 / 超时都返回 null（交给上层当解析失败处理）
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
    // 外部可能把结果裹在 data 里再套一层 { code, data }，认不出来就当没解析出来
    return payload && typeof payload === 'object' ? payload : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/*
 * 解析一条家长原话 → { gender, education, minYears, certificate, teachMode, raw_text, source }
 *   source: agent（外部） / local（本地兜底） / none（解析失败或没识别出要求） / empty（没原话）
 * 任何情况下都不抛错：解析不出来就是全「不限」+ 原话原样保留。
 */
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
      // 外部 Agent 没接上 / 报错：不阻塞发单，按"没要求"处理
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

// 批量：一次贴多条原话（每条一条单），逐条解析
async function parseTexts(config, texts) {
  const list = Array.isArray(texts) ? texts : [];
  const out = [];
  for (const text of list.slice(0, 50)) {
    out.push(await parseText(config, text));   // eslint-disable-line no-await-in-loop
  }
  return out;
}

// 存库用：解析结果的固定 5 字段 + 原话（原话入库前先脱敏，见 posts.createPost）
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
