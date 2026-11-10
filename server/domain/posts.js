/*
 * 发布单域（单边发布：学生发单 / 老师接单）：对应 Qt 版 DatabaseManager 的 createPost / takePost /
 * closePost / postsForTaking / myPosts（小程序版再加一个 allOpenPosts 给访客浏览）。
 *
 * 规则改动：只有学生（平台）能发布「求教需求」，只有老师能接单；老师投递简历先生成
 * 一条「待确认」的课，平台确认后订单进「试课中」，帖子才转「已成交」。老师不能发单，
 * 学生也不能接单。
 */

const util = require('../lib/util.js');
const { ApiError } = require('../lib/errors.js');
const nearby = require('./nearby.js');
const notify = require('./notify.js');
const accounts = require('./accounts.js');
const agent = require('./agent.js');
const match = require('./match.js');

function readPost(row, viewer) {
  const lat = Number(row.lat) || 0;
  const lng = Number(row.lng) || 0;
  return {
    id: Number(row.id),
    code: row.code || '',
    publisherIsTeacher: row.publisher_role === util.ROLE_TEACHER,
    publisherId: Number(row.publisher_id),
    // 老师端永远只看到「平台 + 单号」：发单方的真实姓名 / 电话 / 门牌号不外露
    publisherName: util.PLATFORM_NAME,
    subject: row.subject,
    grade: row.grade || '',        // 年级（老师端筛单用）
    gender: row.gender || '',      // 对老师的性别要求：''/不限 = 不限
    day: row.day,
    period: row.period || '',
    timeText: util.displayTime(row.day, row.period),
    price: row.price,
    area: row.area || '',
    note: row.note || '',
    status: row.status,
    source: row.source || util.SOURCE_MANUAL,
    batchId: row.batch_id || '',
    // 结构化要求（性别 / 学历 / 教龄 / 证书 / 授课方式，缺省全「不限」）；旧数据也是全「不限」
    requirements: util.parseRequirements(row.requirements),
    // 家长原话：外部 Agent 解析用的原文，老师端只展示、不参与筛选和匹配
    rawText: row.raw_text || '',
    bookingId: Number(row.booking_id) || 0,   // 接单生成的哪条课（学生确认时要看这条的状态）
    invites: [],                              // 收到的投递（只有「我发布的」里才会填）
    createdAt: row.created_at,
    lat,
    lng,
    distanceKm: viewer ? nearby.distanceOf(viewer, { lat, lng }) : -1
  };
}

/*
 * 单号 = 当日日期 + 当天第几个单，例如 2026-10-08 发出去的第一个单是 20261008-1。
 * 序号数的是「今天已经入库、id 不大于这条」的单子数（用 id 数，两条同时发单也不会撞号），
 * 所以当天再发就是 -2、-3……批量发单在同一个事务里逐条建单，序号也跟着往上排。
 * （老的 YYMM-001 单号还留在老数据里，只用来显示，不影响新单。）
 */
function dayTexts(date) {
  const d = date || new Date();
  const mm = d.getMonth() + 1 < 10 ? '0' + (d.getMonth() + 1) : '' + (d.getMonth() + 1);
  const dd = d.getDate() < 10 ? '0' + d.getDate() : '' + d.getDate();
  return {
    code: '' + d.getFullYear() + mm + dd,          // 20261008
    iso: d.getFullYear() + '-' + mm + '-' + dd     // 2026-10-08（created_at 的日期部分）
  };
}

async function nextPostCode(db, id) {
  const day = dayTexts();
  const row = await db.get(
    'SELECT COUNT(*) AS total FROM posts WHERE id <= ? AND substr(created_at, 1, 10) = ?',
    [Number(id), day.iso]
  );
  const total = row ? Number(row.total) || 0 : 0;
  return day.code + '-' + total;
}

function byDayThenId(a, b) {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  return a.id - b.id;
}

// 一条单的时薪（元/小时）：优先用家长原话解析出来的，没解析出来就用价格文本开头的数字
function hourlyOf(post) {
  const price = util.requirementPrice(post && post.requirements);
  return price.min > 0 ? price.min : util.priceValue(post && post.price);
}

// 平台账号 → 官方助手 id 的对照表（一个账号一个助手；没有就不出现）
async function agentMapOfStudents(db) {
  const rows = await db.all('SELECT id, owner_student_id FROM agents ORDER BY id');
  const map = {};
  rows.forEach((row) => {
    const sid = Number(row.owner_student_id);
    if (!map[sid]) map[sid] = Number(row.id);
  });
  return map;
}

/*
 * 还有招募中的、平台发的「求教需求」；老师接单用（老师发的旧单不列）。
 *
 * 双向筛选（老师端面板就按这两向排的）：
 *   第一向 单子本身：grade / subject / time / minPrice（最低时薪，价格只留这一个条件）/ 距离范围
 *   第二向 A 单子的要求（家长原话解析出来的固定字段，都能多选，逗号或数组都认）：
 *            gender / education / minYears / certificate / teachMode
 *            —— 单子要求「不限」＝家长没提，一律留下；提了的必须在老师勾的选项里
 *   第二向 B 我自己的情况（老师勾自己的条件，多选；勾了才拿它去卡单子）：
 *            myGender / myEducation / myYears / myCertificate / myTeachMode
 *            —— 学历 / 教龄按"我的最高档"比（我 3 年，要求 1 年的单也该看得见）
 *   再加上 onlyMatch=1：只留 matchLevel !== 'none'（页面默认开着，按上面这份"我"来算）
 * 距离："km"（页面用）和 "radius"（接口文档用）都认，页面默认 30 公里。
 *
 * 每条单会带上（老师视角）：matchLevel（full|partial|none）、matchReasons（✅/⚠️/❌ 文字）、
 * matchDetails（逐条明细，详情弹层用）、matchScore（匹配度打分）。没有要求的老数据 = 全 ✅ = full。
 * 排序：完全符合 → 部分符合 → 不符合 → 匹配度高的 → 距离由近到远；一样近时"时间不冲突"优先，
 *       用了筛选再按价格由高到低（一起用，不另外分主次）。距离超范围的照旧藏起来并计数。
 */
async function postsForTaking(db, asTeacher, accountId, viewer, filters) {
  const id = Number(accountId);
  if (!(id >= 0)) return { list: [], hidden: 0 };
  const myRole = asTeacher ? util.ROLE_TEACHER : util.ROLE_STUDENT;
  // 每个平台账号对应的官方助手（老师点聊天时直接找助手，而不是客户本人）
  const agentMap = await agentMapOfStudents(db);
  // 老师本人的资料：判断"我符不符合这单的要求"用
  const me = asTeacher ? await db.get('SELECT * FROM teachers WHERE id = ?', [id]) : null;

  // 我已经投递过、还在等平台确认的那些单：页面上把按钮改成"已投递"
  // 老师这一侧再顺手算一下"时间冲突"：撞上自己已有的课只提醒，不挡投递（一天能排好几节课）
  let appliedIds = [];
  let busyTimes = [];
  if (asTeacher) {
    const mine = await db.all(
      'SELECT post_id FROM bookings WHERE teacher_id = ? AND status = ?',
      [id, util.STATUS_PENDING]
    );
    appliedIds = mine.map((row) => Number(row.post_id));
    const active = await db.all(
      'SELECT day, period FROM bookings WHERE teacher_id = ? AND status IN (?, ?, ?)',
      [id, util.STATUS_PENDING, util.STATUS_TRIAL, util.STATUS_MAIN]
    );
    busyTimes = active.map((row) => util.displayTime(row.day, row.period));
  }

  const rows = await db.all(
    'SELECT * FROM posts WHERE status = ? AND publisher_role = ?',
    [util.POST_OPEN, util.ROLE_STUDENT]
  );

  const f = filters || {};
  // ---- 第一向：单子本身（年级 / 科目 / 时间 / 距离 + 最低时薪）----
  const wantGrade = util.plain(f.grade);
  const wantSubject = util.plain(f.subject);
  const wantTime = util.plain(f.time);
  // ---- 第二向 A：单子的要求（家长原话解析出来的固定字段，都是多选）----
  // 传 '女' 或 '男,女' 都认；空 / 只有「不限」＝这条不筛。
  const wantGender = util.toList(f.gender);
  const wantEducation = util.toList(f.education);
  const wantYears = util.toList(f.minYears).map(util.toInt).filter((v) => v > 0);
  const wantCertificate = util.toList(f.certificate);
  const wantTeachMode = util.toList(f.teachMode);
  // ---- 第二向 B：我自己的情况（老师勾的条件，勾了才拿它去卡单子的要求）----
  const myGender = util.plain(f.myGender);
  const myEducation = util.toList(f.myEducation);
  const myYears = util.toList(f.myYears).map(util.toInt).filter((v) => v > 0);
  const myCertificate = util.toList(f.myCertificate);
  const myTeachMode = util.toList(f.myTeachMode);
  const minPrice = Number(f.minPrice) || 0;    // 最低时薪（只留这一个价格条件）
  const maxPrice = Number(f.maxPrice) || 0;    // 接口兼容用，页面上没有这个入口了
  const onlyMatch = f.onlyMatch === true || f.onlyMatch === 1 ||
    f.onlyMatch === '1' || f.onlyMatch === 'true';
  const explicit = (list) => util.toList(list).some((value) => value !== util.REQ_UNLIMITED);
  const filtered = wantGrade !== '' || wantSubject !== '' || wantTime !== '' ||
    [wantGender, wantEducation, wantYears, wantCertificate, wantTeachMode].some(explicit) ||
    myGender !== '' ||
    [myEducation, myYears, myCertificate, myTeachMode].some((list) => util.toList(list).length > 0) ||
    minPrice > 0 || maxPrice > 0;

  /*
   * 这条单"对老师的要求"（固定 5 字段，缺省全「不限」）。
   * 每条单只解析一次，筛选和后面算匹配度都用这一份。
   */
  const requirementById = {};
  rows.forEach((row) => { requirementById[Number(row.id)] = util.parseRequirements(row.requirements); });
  const requirementsOf = (row) =>
    requirementById[Number(row.id)] || util.parseRequirements(row.requirements);

  /*
   * 单子的性别要求：结构化要求里写了就用它，没写就回落到老的 posts.gender 列
   * （旧单子只有那一列）。两边都没有 = 不限，不参与筛选。
   */
  const genderNeedOf = (row) => {
    const req = requirementsOf(row);
    return util.hasRequirement(req, 'gender') ? req.gender : util.plain(row.gender);
  };

  /*
   * 单子要求 vs 我勾的选项：
   *   单子没提（不限）→ 一定留着；单子提了 → 必须在老师勾的选项里。
   * 学历 / 教龄是档位，按"我的最高档"比（勾了 3 年，要求 1 年的单也该看得见）。
   */
  const myEducationRank = myEducation.length > 0
    ? Math.max.apply(null, myEducation.map(util.educationRank)) : -1;
  const myYearsValue = myYears.length > 0 ? Math.max.apply(null, myYears) : 0;

  const passMine = (row) => {
    const req = requirementsOf(row);
    // 我是男/女：单子要女老师，我不是女就不显示
    if (myGender !== '') {
      const need = genderNeedOf(row);
      if (need !== '' && need !== util.REQ_UNLIMITED && need !== myGender) return false;
    }
    // 学历：单子要求的档位不能高于我的档位
    if (myEducationRank >= 0 && util.hasRequirement(req, 'education')) {
      const need = util.educationRank(req.education);
      if (need >= 0 && need > myEducationRank) return false;
    }
    // 教龄：单子要的年限不能高于我的教龄
    if (myYearsValue > 0 && util.hasRequirement(req, 'minYears')) {
      if (util.requirementYears(req) > myYearsValue) return false;
    }
    // 证书 / 授课方式：单子要的必须在我勾的里面
    if (myCertificate.length > 0 && util.hasRequirement(req, 'certificate') &&
        myCertificate.indexOf(req.certificate) < 0) return false;
    if (myTeachMode.length > 0 && util.hasRequirement(req, 'teachMode') &&
        myTeachMode.indexOf(req.teachMode) < 0) return false;
    return true;
  };

  // 单子的时薪下限：结构化要求里折算了就用它，没写就回落到价格文本开头的数字（旧单子）
  const priceNeedOf = (row) => {
    const price = util.requirementPrice(requirementsOf(row));
    return price.min > 0 ? price.min : util.priceValue(row.price);
  };
  const priceMaxOf = (row) => {
    const price = util.requirementPrice(requirementsOf(row));
    return price.max > 0 ? price.max : util.priceValue(row.price);
  };

  /*
   * "我"的资料：面板里勾了就用勾的，没勾就用简历上的（只影响这次筛选 / 匹配，简历不动）。
   */
  const meForMatch = me ? Object.assign({}, me, {
    gender: myGender !== '' ? myGender : util.plain(me.gender),
    education: myEducation.length > 0 ? myEducation.join('、') : util.plain(me.education),
    years: myYearsValue > 0 ? String(myYearsValue) : util.plain(me.years),
    certificate: myCertificate.length > 0 ? myCertificate.join('、') : util.plain(me.certificate),
    teachMode: myTeachMode.join('、')
  }) : null;

  const list = rows
    .filter((row) => !(row.publisher_role === myRole && Number(row.publisher_id) === id))
    .filter((row) => wantGrade === '' || util.plain(row.grade).indexOf(wantGrade) >= 0)
    .filter((row) => wantSubject === '' || util.plain(row.subject).indexOf(wantSubject) >= 0)
    .filter((row) => {
      if (wantTime === '') return true;
      return util.displayTime(row.day, row.period).indexOf(wantTime) >= 0;
    })
    // 单子的性别要求（多选）：要「不限」或要我在勾选里的单
    .filter((row) => {
      if (!explicit(wantGender)) return true;
      const need = genderNeedOf(row);
      return need === '' || need === util.REQ_UNLIMITED || wantGender.indexOf(need) >= 0;
    })
    // 单子的学历要求（多选）：档位字段，勾了几个档就是几个
    .filter((row) => {
      if (!explicit(wantEducation)) return true;
      const req = requirementsOf(row);
      if (!util.hasRequirement(req, 'education')) return true;
      return wantEducation.indexOf(req.education) >= 0;
    })
    // 单子的最低教龄（多选）：100 = 数字档位
    .filter((row) => {
      if (wantYears.length === 0) return true;
      const req = requirementsOf(row);
      if (!util.hasRequirement(req, 'minYears')) return true;
      return wantYears.indexOf(util.requirementYears(req)) >= 0;
    })
    // 单子的证书要求（多选）
    .filter((row) => {
      if (!explicit(wantCertificate)) return true;
      const req = requirementsOf(row);
      if (!util.hasRequirement(req, 'certificate')) return true;
      return wantCertificate.indexOf(req.certificate) >= 0;
    })
    // 单子的授课方式（多选）
    .filter((row) => {
      if (!explicit(wantTeachMode)) return true;
      const req = requirementsOf(row);
      if (!util.hasRequirement(req, 'teachMode')) return true;
      return wantTeachMode.indexOf(req.teachMode) >= 0;
    })
    // 我勾的"我的情况"：单子提的要求我都得满足
    .filter((row) => passMine(row))
    // 最低时薪：单子给的时薪下限要够；价格没写的（不限）不筛掉
    .filter((row) => {
      if (minPrice <= 0) return true;
      const value = priceNeedOf(row);
      return value <= 0 || value >= minPrice;
    })
    .filter((row) => {
      if (maxPrice <= 0) return true;
      const value = priceMaxOf(row);
      return value <= 0 || value <= maxPrice;
    })
    .map((row) => {
      const post = readPost(row, viewer);
      post.applied = appliedIds.indexOf(post.id) >= 0;
      post.timeConflict = busyTimes.indexOf(post.timeText) >= 0;
      post.agentId = agentMap[post.publisherId] || 0;
      if (meForMatch) {
        const result = match.matchTeacher(
          { subject: post.subject, requirements: requirementsOf(row) },
          meForMatch,
          { distanceKm: post.distanceKm }
        );
        post.matchLevel = result.level;
        post.matchScore = Number(result.score) || 0;
        post.matchReasons = result.reasons;
        post.matchDetails = result.details;
      } else {
        post.matchLevel = '';
        post.matchScore = 0;
        post.matchReasons = [];
        post.matchDetails = [];
      }
      return post;
    })
    .filter((post) => !onlyMatch || !meForMatch || post.matchLevel !== match.LEVEL_NONE);
  const result = nearby.split(viewer, list);
  result.list.sort((a, b) => {
    const la = match.levelWeight(a.matchLevel);
    const lb = match.levelWeight(b.matchLevel);
    if (la !== lb) return lb - la;                    // 完全符合 > 部分符合 > 不符合
    const sa = Number(a.matchScore) || 0;
    const sb = Number(b.matchScore) || 0;
    if (sa !== sb) return sb - sa;                    // 同一档里，匹配上的要求越多越靠前
    const ka = a.distanceKm >= 0 ? a.distanceKm : Infinity;
    const kb = b.distanceKm >= 0 ? b.distanceKm : Infinity;
    if (ka !== kb) return ka - kb;
    if (!!a.timeConflict !== !!b.timeConflict) return a.timeConflict ? 1 : -1;
    if (filtered) {
      const pa = hourlyOf(a);      // 用了筛选就按时薪从高到低排
      const pb = hourlyOf(b);
      if (pa !== pb) return pb - pa;
    }
    return a.id - b.id;
  });
  return result;
}

/*
 * 老师端「推荐」：和选单页是同一份数据、同一套排序（匹配度优先），默认只给能投的单。
 * 接口留着给外部/以后用；小程序里没有单独的"推荐"tab，排序直接体现在选单列表上。
 */
async function recommended(db, teacherId, viewer, filters) {
  const merged = Object.assign({}, filters || {}, { onlyMatch: true });
  return postsForTaking(db, true, teacherId, viewer, merged);
}

// 我发布的单（按 id 倒序，最新的在前）
async function myPosts(db, asTeacher, accountId, viewer) {
  const id = Number(accountId);
  if (!(id >= 0)) return [];
  const myRole = asTeacher ? util.ROLE_TEACHER : util.ROLE_STUDENT;
  const rows = await db.all(
    'SELECT * FROM posts WHERE publisher_role = ? AND publisher_id = ? ORDER BY id DESC',
    [myRole, id]
  );
  const list = [];
  for (const row of rows) {
    const post = readPost(row, viewer);
    post.invites = await invitesOf(db, Number(row.id));   // 这条单收到的投递（老师 + 状态 + 简历）
    list.push(post);
  }
  return list;
}

// 一条发布单收到的所有投递（对应 bookings 里 post_id = 这条单的那些记录）
async function invitesOf(db, postId) {
  const rows = await db.all(
    `SELECT b.*, t.name AS teacher_name, t.subject AS teacher_subject, t.price AS teacher_price
     FROM bookings b LEFT JOIN teachers t ON t.id = b.teacher_id
     WHERE b.post_id = ? ORDER BY b.id DESC`,
    [Number(postId)]
  );
  return rows.map((row) => ({
    bookingId: Number(row.id),
    teacherId: Number(row.teacher_id),
    teacherName: row.teacher_name || '',
    subject: util.plain(row.teacher_subject),
    price: util.plain(row.price) === '' ? util.plain(row.teacher_price) : util.plain(row.price),
    timeText: util.displayTime(row.day, row.period),
    resume: util.plain(row.resume),
    status: row.status,
    statusText: util.bookingStatusText(row.status),
    createdAt: row.created_at
  }));
}

// 聊天页顶部那张需求单卡片：按 id 取一条发布单
async function getPost(db, postId, viewer) {
  const row = await db.get('SELECT * FROM posts WHERE id = ?', [Number(postId)]);
  if (!row) return null;
  return readPost(row, viewer);
}

// 小程序特有：访客（还没选身份登录）也能浏览所有「招募中」的单
async function allOpenPosts(db, viewer) {
  const rows = await db.all('SELECT * FROM posts WHERE status = ? ORDER BY id', [util.POST_OPEN]);
  const result = nearby.split(viewer, rows.map((row) => readPost(row, viewer)));
  result.list.sort(byDayThenId);
  return result;
}

// 对应 createPost：上课时间由发布人自己填（存在 day 里，period 留空）
/*
 * 建单（单条）。批量发单和外部 Agent 也走这里，靠 payload 里的几个字段区分来源：
 *   source      manual | agent（外部 Agent 发的单）
 *   externalId  外部单号，用来幂等去重；同一条外部单第二次发进来直接返回原来的 id
 *   batchId     这一批的批次号
 *   status      默认「招募中」；传 pending_review 就先落库不上架，等平台确认后再开
 *   requirements 家长要求（固定 5 字段，见 lib/util.js 的 parseRequirements）
 *   rawText     家长原话（外部 Agent 解析用的原文，老师端只展示）
 * 位置 / 说明 / 家长原话会先过一遍脱敏（手机号、微信号这些一律抹掉）——
 * 原话解析在脱敏之前做（脱敏会破坏原文），存下来的原话里不会带客户联系方式。
 */
async function createPost(db, post, viewer) {
  const payload = post || {};
  const publisherId = Number(payload.publisherId);
  if (!(publisherId >= 0)) throw new ApiError('请先登录再发布。');
  // 单边发布：老师不能发单，只能接单
  if (payload.publisherIsTeacher) throw new ApiError('老师不能发单，只能接单。');
  if (util.plain(payload.subject) === '') throw new ApiError('科目不能为空。');
  if (util.plain(payload.time) === '') throw new ApiError('上课时间不能为空。');

  const status = util.plain(payload.status) === util.POST_PENDING_REVIEW
    ? util.POST_PENDING_REVIEW : util.POST_OPEN;
  const source = util.plain(payload.source) === util.SOURCE_AGENT ? util.SOURCE_AGENT : util.SOURCE_MANUAL;
  const externalId = util.plain(payload.externalId);
  const batchId = util.plain(payload.batchId);
  // 家长原话：老师端会看到，入库前必须过脱敏（手机号 / 微信号一律抹掉）
  const rawText = util.stripContacts(payload.rawText);

  // 幂等去重：外部单号已经导过就直接返回那条，不重复建单
  if (externalId !== '') {
    const existing = await db.get('SELECT id FROM posts WHERE external_id = ?', [externalId]);
    if (existing) return Number(existing.id);
  }

  const picked = util.hasCoords(payload.lat, payload.lng)
    ? { lat: Number(payload.lat), lng: Number(payload.lng) } : null;
  const fallback = viewer && util.hasCoords(viewer.lat, viewer.lng)
    ? { lat: Number(viewer.lat), lng: Number(viewer.lng) } : null;
  const coords = picked || fallback;

  const result = await db.run(
    `INSERT INTO posts (publisher_role, publisher_id, publisher_name, subject, grade, gender, day, period, price,
                        area, lat, lng, note, status, created_at, taker_role, taker_id, booking_id, taken_at,
                        code, source, external_id, batch_id, requirements, raw_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, '', 0, 0, '', ?, ?, ?, ?, ?, ?)`,
    [
      payload.publisherIsTeacher ? util.ROLE_TEACHER : util.ROLE_STUDENT,
      publisherId,
      util.plain(payload.publisherName),
      util.plain(payload.subject),
      util.plain(payload.grade),
      util.plain(payload.gender),
      util.plain(payload.time),
      util.plain(payload.price),
      util.stripContacts(payload.area),
      coords ? coords.lat : 0,
      coords ? coords.lng : 0,
      util.stripContacts(payload.note),
      status,
      util.nowText(),
      '',            // code 先占位，拿到 id 之后回填
      source,
      externalId === '' ? null : externalId,
      batchId,
      util.stringifyRequirements(payload.requirements),
      rawText
    ]
  );
  const id = Number(result.lastId);
  // 单号：当日日期 + 当天第几个单（20261008-1）；拿到 id 之后回填
  await db.run('UPDATE posts SET code = ? WHERE id = ?', [await nextPostCode(db, id), id]);
  return id;
}

/*
 * 批量发单：一次多条（中介手动加几条，或外部 Agent 一次推一批）。
 * 整批放在一个事务里，逐条 try/catch —— 某一条字段不全只把它自己判失败，别的照常落库。
 * 返回 { ok: [{ index, id, code }], failed: [{ index, reason }], batchId }。
 * externalId 重复的按幂等算成功（返回已有那条的 id）。
 */
async function batchCreate(db, student, viewer, list, options) {
  const rows = Array.isArray(list) ? list : [];
  if (rows.length === 0) throw new ApiError('这一批一条单都没有。');
  if (rows.length > 50) throw new ApiError('一次最多发 50 条，分批发吧。');

  const opts = options || {};
  const publisherId = Number(student && student.id);
  const publisherName = util.plain(student && student.name);
  if (!(publisherId >= 0)) throw new ApiError('请先登录再发布。');
  const batchId = util.plain(opts.batchId) ||
    ('B' + util.nowText().replace(/[^0-9]/g, '') + '-' + Math.random().toString(16).slice(2, 6));
  const source = util.plain(opts.source) === util.SOURCE_AGENT ? util.SOURCE_AGENT : util.SOURCE_MANUAL;

  return db.transaction(async (tx) => {
    const ok = [];
    const failed = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index] || {};
      try {
        const id = await createPost(tx, {
          publisherIsTeacher: false,
          publisherId,
          publisherName,
          subject: row.subject,
          grade: row.grade,
          gender: row.gender,
          time: row.time,
          price: row.price,
          area: row.area,
          lat: row.lat,
          lng: row.lng,
          note: row.note,
          requirements: row.requirements,
          rawText: row.rawText,
          status: row.status,
          source: row.source || source,
          externalId: row.externalId,
          batchId
        }, viewer);
        const saved = await tx.get('SELECT code FROM posts WHERE id = ?', [Number(id)]);
        ok.push({ index, id: Number(id), code: saved ? saved.code : '' });
      } catch (e) {
        failed.push({ index, reason: e && e.message ? e.message : '这条没能发布。' });
      }
    }
    return { ok, failed, batchId };
  });
}

/*
 * 对应 takePost：老师"投递简历" —— 老师不能一键接单，先写一份简历发过去，
 * 先生成一条"待平台确认"的投递记录。一条单可以同时收到多位老师的投递，
 * 平台在「我发布的」里挑一位确认（那位变「已确认」，其余的变「平台选了别人」）。
 * 单子只在平台确认之后才转「已成交」；确认之前一直留在「招募中」，别的老师还能投。
 * 整段放在一个事务里，避免两个老师同时投递时把冲突判断做漏。
 * 时间撞上自己已有的课只提醒不拦：第一次调用返回 { conflict: true, timeText }，
 * 前端弹一条提醒，老师确认后带 force 再调一次才真正落库。
 */
async function takePost(db, postId, asTeacher, accountId, resume, options) {
  const id = Number(accountId);
  if (!(id >= 0)) throw new ApiError('请先登录再接单。');
  // 单边接单：只有老师能接
  if (!asTeacher) throw new ApiError('只有老师账号能接单。');
  const pid = Number(postId);
  const force = !!(options && options.force);   // 老师在"时间冲突"提醒上确认过之后才带这个

  return db.transaction(async (tx) => {
    const row = await tx.get('SELECT * FROM posts WHERE id = ?', [pid]);
    if (!row) throw new ApiError('找不到这条发布。');

    const isTeacherPost = row.publisher_role === util.ROLE_TEACHER;
    if (isTeacherPost) throw new ApiError('这是老师发的旧单，接不了。');
    if (row.status !== util.POST_OPEN) throw new ApiError('这条单平台已经定下来了，不能再投递。');

    const post = readPost(row, null);
    const teacherId = id;
    const studentId = post.publisherId;

    // 同一位老师对同一条单只能有一份还在等的投递（被平台回绝过可以再投）
    const dup = await tx.get(
      'SELECT id FROM bookings WHERE post_id = ? AND teacher_id = ? AND status = ?',
      [pid, teacherId, util.STATUS_PENDING]
    );
    if (dup) throw new ApiError('你已经投递过这条单了，等平台确认吧。');

    /*
     * 时间冲突两个维度都要查（别人的单也不能撞你自己的课）；
     * 同一条单的多份投递本来就同一个时段，不算撞课。
     * 一天可以有好几节课，撞上同一个时段不一定是错：这里只当"提醒"，不当拦截 ——
     * 没带 force 时先不落库，把时段交回前端弹一条提醒，老师确认后带 force 再调一次。
     */
    const when = util.displayTime(post.day, post.period);
    const activeRows = await tx.all(
      'SELECT * FROM bookings WHERE status IN (?, ?, ?)',
      [util.STATUS_PENDING, util.STATUS_TRIAL, util.STATUS_MAIN]
    );
    const busy = activeRows.some((booking) => {
      if (util.displayTime(booking.day, booking.period) !== when) return false;
      if (Number(booking.post_id) === pid) return false;
      return Number(booking.teacher_id) === teacherId || Number(booking.student_id) === studentId;
    });
    if (busy && !force) return { conflict: true, timeText: when };

    const takenAt = util.nowText();
    const result = await tx.run(
      `INSERT INTO bookings (teacher_id, student_id, post_id, day, period, remark, student_name, price, resume, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        teacherId,
        studentId,
        pid,
        post.day,
        post.period,
        util.plain(post.note),
        await accounts.studentName(tx, studentId),
        util.plain(await priceOf(post, teacherId, tx)),
        util.plain(resume),             // 老师投递的简历（平台确认前先看这个）
        util.STATUS_PENDING,            // 投递简历只是"申请"，等平台确认才算接单成功
        takenAt
      ]
    );

    const bookingId = result.lastId;
    // 单子还是「招募中」：一条单可以同时被多位老师投递，平台确认某一位之后才转「已成交」
    await tx.run(
      'UPDATE posts SET taker_role = ?, taker_id = ?, taken_at = ? WHERE id = ?',
      [util.ROLE_TEACHER, teacherId, takenAt, pid]
    );
    await notifyTake(tx, bookingId, teacherId, studentId, post, when);
    /*
     * 事件钩子：老师投递了简历。外部 Agent 收到后可以自动通知平台（中介）。
     * 只落库，webhook 由请求结束后的 flush 统一发。
     */
    await agent.emit(tx, agent.EVENT_BOOKING_CREATED, {
      postId: pid,
      postCode: post.code,
      subject: post.subject,
      timeText: when,
      bookingId,
      teacherId,
      teacherName: (await tx.get('SELECT name FROM teachers WHERE id = ?', [teacherId]) || {}).name || ''
    }, { refId: bookingId, studentId, teacherId });
    return { conflict: false, bookingId };
  });
}

// 平台确认某一位老师的投递：单子转「已成交」，记下是哪条课
async function markTaken(db, postId, bookingId, teacherId) {
  await db.run(
    `UPDATE posts SET status = ?, taker_role = ?, taker_id = ?, booking_id = ?, taken_at = ?
     WHERE id = ?`,
    [util.POST_TAKEN, util.ROLE_TEACHER, Number(teacherId), Number(bookingId), util.nowText(), Number(postId)]
  );
  return true;
}

// 价格：帖子自己填了就用帖子的，没填就沿用老师资料里的价
async function priceOf(post, teacherId, tx) {
  if (util.plain(post.price) !== '') return post.price;
  const teacher = await tx.get('SELECT price FROM teachers WHERE id = ?', [Number(teacherId)]);
  return teacher ? util.plain(teacher.price) : '';
}

async function notifyTake(tx, bookingId, teacherId, studentId, post, when) {
  const teacher = await tx.get('SELECT name FROM teachers WHERE id = ?', [Number(teacherId)]);
  const teacherName = teacher ? teacher.name : '';

  const postId = Number(post.id) || 0;
  // 老师接了学生发布的需求：两边各发一条通知（学生还没确认，先别写"已确认"）
  await notify.addMessage(tx, '接单申请已发出',
    '你想接 ' + post.code + '（' + post.subject + '）这条需求，时间：' + when + '，等平台确认。',
    0, teacherId, postId, Number(bookingId));
  await notify.addMessage(tx, '有老师想接你的单',
    teacherName + ' 老师想接你的' + post.subject + '需求，时间：' + when +
      '，去确认一下才算接单成功。',
    studentId, 0, postId, Number(bookingId));
}

async function closePost(db, postId, asTeacher, accountId) {
  const myRole = asTeacher ? util.ROLE_TEACHER : util.ROLE_STUDENT;
  const row = await db.get(
    'SELECT * FROM posts WHERE id = ? AND publisher_role = ? AND publisher_id = ?',
    [Number(postId), myRole, Number(accountId)]
  );
  if (!row || row.status !== util.POST_OPEN) {
    throw new ApiError('这条发布不能撤销（不是你的，或者已经成交/撤销了）。');
  }
  await db.run('UPDATE posts SET status = ? WHERE id = ?', [util.POST_CLOSED, Number(postId)]);

  /*
   * 单子作废，还在等的投递一起作废（"每个流程双方都能取消"）：
   * 不改的话老师「我的课」里会永远挂着一条等不到确认的课，还占着时间冲突判断。
   */
  const pendingRows = await db.all(
    'SELECT * FROM bookings WHERE post_id = ? AND status = ?',
    [Number(postId), util.STATUS_PENDING]
  );
  const when = util.displayTime(row.day, row.period);
  for (const booking of pendingRows) {
    await db.run('UPDATE bookings SET status = ? WHERE id = ?',
      [util.STATUS_CANCELLED, Number(booking.id)]);   // eslint-disable-line no-await-in-loop
    await notify.addMessage(                           // eslint-disable-line no-await-in-loop
      db,
      '平台撤销了这条需求',
      '你投递过的' + row.subject + '需求（' + when + '）平台已经撤销，这次不用再等确认了。',
      0, Number(booking.teacher_id), Number(postId)
    );
  }
  return true;
}

/*
 * 取消预约时用：把这条课对应的单子放回「招募中」。
 * 规矩：没被接之前取消的是订单（学生撤销，单子作废）；已经被接了取消的是预约
 * （课取消掉，单子还是开放的，别的老师还能接）。
 */
async function reopenForBooking(db, bookingId) {
  const row = await db.get('SELECT * FROM posts WHERE booking_id = ?', [Number(bookingId)]);
  if (!row || row.status !== util.POST_TAKEN) return false;
  await db.run(
    `UPDATE posts SET status = ?, taker_role = '', taker_id = 0, taken_at = '', booking_id = 0
     WHERE id = ? AND status = ?`,
    [util.POST_OPEN, Number(row.id), util.POST_TAKEN]
  );
  return true;
}

module.exports = {
  readPost,
  postsForTaking,
  recommended,
  myPosts,
  getPost,
  allOpenPosts,
  createPost,
  batchCreate,
  takePost,
  markTaken,
  closePost,
  reopenForBooking
};
