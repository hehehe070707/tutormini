/*
 * 数据层：小程序端的「后端 API 客户端」。
 *
 * 改造前：这个文件是本地缓存版的 DatabaseManager，7 张表全存在 wx.storage 的 tutor_db_v1 里，
 *         换手机 / 清缓存数据就没了。
 * 改造后：业务数据（用户、订单、发布、消息、课次）全在后端数据库里（server/），
 *         本机只留一枚登录令牌（session_token），手机 / 模拟器 / 任何设备看到的是同一份数据。
 *         另有唯一一条浏览偏好存在本机：消息页把哪些结束的单子卡片收起来了
 *         （tutor_hidden_boxes_v1，见下面的 hiddenBoxes / saveHiddenBoxes），它不碰业务数据。
 *
 * 对页面的约定和原来一致：函数返回 id / bool / 列表，失败原因读 store.lastError。
 * 唯一的区别：所有函数都变成异步的（要走网络），页面里要 await。
 * 数据变更的本地通知还是 store.on('xxxChanged', fn)（只通知本机页面刷新，不代表别的设备）。
 */

const api = require('./api.js');
const util = require('./util.js');
const session = require('./session.js');
const location = require('./location.js');

let lastError = '';
let lastHidden = 0;                  // 上一次列表被后端筛掉了几条（页面提示用）

// ---------- 本地事件总线（等价于 Qt 的 xxxChanged 信号）----------
// 只在本机改过数据之后发一次，让当前页面/别的常驻 tab 刷新；跨设备靠 onShow 重新拉数据。
const EVENTS = ['teachersChanged', 'bookingsChanged', 'messagesChanged', 'studentsChanged',
                'postsChanged', 'chatsChanged', 'unreadChanged'];
const listeners = {};
EVENTS.forEach((name) => { listeners[name] = []; });

function on(eventName, fn) {
  if (!listeners[eventName]) listeners[eventName] = [];
  if (listeners[eventName].indexOf(fn) < 0) listeners[eventName].push(fn);
}

function off(eventName, fn) {
  const list = listeners[eventName];
  if (!list) return;
  const index = list.indexOf(fn);
  if (index >= 0) list.splice(index, 1);
}

function emit(eventName) {
  (listeners[eventName] || []).slice().forEach((fn) => {
    try {
      fn();
    } catch (e) {
      // 页面回调出错不影响数据层，跟 Qt 里信号槽互不干扰一个意思
    }
  });
}

function setError(message) {
  lastError = message;
  return false;
}

// 读接口失败不该让页面崩：给个空值 + 记下原因
async function read(promise, fallback) {
  try {
    return await promise;
  } catch (e) {
    lastError = e.message;
    return fallback;
  }
}

function wxLoginCode() {
  return new Promise((resolve) => {
    if (typeof wx === 'undefined' || typeof wx.login !== 'function') {
      resolve('');
      return;
    }
    wx.login({
      success: (res) => resolve(res && res.code ? res.code : ''),
      fail: () => resolve('')
    });
  });
}

// ==================== 附近筛选（纯本机偏好 + 定位）====================

let viewer = null;
let nearbyKm = util.NEARBY_KM;
let showAll = false;

// 页面刷新时把最新的定位交给数据层；返回 true 表示定位变了
function setViewerLocation(loc) {
  const next = loc && util.hasCoords(loc.latitude, loc.longitude)
    ? { latitude: Number(loc.latitude), longitude: Number(loc.longitude) }
    : null;
  const same = (!next && !viewer) ||
               (!!next && !!viewer && next.latitude === viewer.latitude && next.longitude === viewer.longitude);
  viewer = next;
  return !same;
}

function viewerLocation() {
  return viewer ? util.clone(viewer) : null;
}

// 半径：>0 表示只看这个公里数以内；0 表示不限距离
function setNearbyKm(km) {
  const value = Number(km);
  nearbyKm = isFinite(value) && value > 0 ? value : 0;
}

function nearbyKmValue() {
  return nearbyKm;
}

function setShowAll(flag) {
  showAll = !!flag;
}

function showAllValue() {
  return showAll;
}

// 真正在筛的条件：有定位 + 定了半径 + 没点"看全部"（判断和展示用，筛选在后端做）
function nearbyActive() {
  return !showAll && nearbyKm > 0 && !!viewer;
}

// 列表接口要带的定位/半径参数
function viewQuery() {
  const query = { km: nearbyKm, all: showAll ? 1 : 0 };
  if (viewer) {
    query.lat = viewer.latitude;
    query.lng = viewer.longitude;
  }
  return query;
}

// 保存资料/发布时"没手选位置就用当前定位兜底"的两个字段
function viewerFields() {
  const here = location.current();
  return here ? { viewerLat: here.latitude, viewerLng: here.longitude } : {};
}

// ==================== 初始化 / 登录状态 ====================

// 对应原来 store.init()：成功返回 ''，失败返回错误文案（现在是探一下后端通不通）
async function init() {
  lastError = '';
  try {
    await api.get('/health', undefined, true);   // 探活：绕过"冷静期"，随时可以重试
    return '';
  } catch (e) {
    lastError = e.message;
    return e.message;
  }
}

/*
 * 启动时恢复登录（对应原来的 restoreLogin）：
 *   1) 本地有令牌 → 问后端这枚令牌还算不算数（后端说了算）；
 *   2) 没有 / 失效 → 试一次 wx.login 走 openid 自动登录（后端绑过就免密进）。
 * 身份只以后端返回的为准，前端改本地缓存改不动。
 */
async function restoreLogin() {
  if (api.token() !== '') {
    try {
      const data = await api.get('/auth/me');
      session.applyProfile(data.profile);
      return true;
    } catch (e) {
      // 401 时 api 层已经把本地令牌清掉了；网络不通就当访客，别把令牌误删
    }
  }
  if (api.token() !== '') return false;   // 后端没起来：先当访客，不打搅用户
  return wxAutoLogin();
}

// wx.login → code → 后端换 openid → 查绑定发令牌
async function wxAutoLogin() {
  const code = await wxLoginCode();
  if (code === '') return false;
  try {
    const data = await api.post('/auth/wx-login', { code });
    if (!data || !data.token) return false;    // 没绑过账号：让用户自己选身份登录
    api.setToken(data.token);
    session.applyProfile(data.profile);
    return true;
  } catch (e) {
    return false;
  }
}

// 登录 / 注册共用一套：拿令牌 → 存令牌 → 按后端给的身份进会话
async function loginAs(role, name, password, register) {
  lastError = '';
  try {
    // 顺手带上 code：后端把 openid 绑到这个账号，下次同一台微信就能自动登录
    const code = await wxLoginCode();
    const data = await api.post(register ? '/auth/register' : '/auth/login', {
      role, name, password, code
    });
    api.setToken(data.token);
    session.applyProfile(data.profile);
    return Number(data.id);
  } catch (e) {
    setError(e.message);
    return -1;
  }
}

function loginStudent(name, password) {
  return loginAs(util.ROLE_STUDENT, name, password, false);
}

function registerStudent(name, password) {
  return loginAs(util.ROLE_STUDENT, name, password, true);
}

function loginTeacher(name, password) {
  return loginAs(util.ROLE_TEACHER, name, password, false);
}

function registerTeacher(name, password) {
  return loginAs(util.ROLE_TEACHER, name, password, true);
}

// 退出登录：后端作废这一枚令牌，本地也清掉（别的设备不受影响）
async function forgetLogin() {
  try {
    await api.post('/auth/logout', {});
  } catch (e) {
    // 后端连不上也要让用户能退出：本地照样清干净
  }
  api.clearToken();
  session.logout();
  return true;
}

// ==================== 老师 ====================

/*
 * 老师列表（对应原来 store.teachers）。
 * 科目 + 关键词 + 附近筛选全在后端做，返回 { list, hidden }；hidden 给页面提示"另有 N 位超出范围"。
 */
async function teachers(subject, keyword) {
  const data = await read(api.get('/teachers', Object.assign({
    subject: util.plain(subject),
    keyword: util.plain(keyword)
  }, viewQuery())), { list: [], hidden: 0 });
  lastHidden = Number(data.hidden) || 0;
  return data.list || [];
}

// 库里已有的科目（给筛选下拉用）
async function subjects() {
  const data = await read(api.get('/teachers/subjects'), { list: [] });
  return data.list || [];
}

async function teacherById(id) {
  const data = await read(api.get('/teachers/' + Number(id), viewQuery()), null);
  if (!data || !data.teacher) {
    return {
      id: -1, name: '', subject: '', price: '', intro: '', rating: 5,
      education: '', school: '', years: '', certificate: '', times: '',
      area: '', lat: 0, lng: 0, distanceKm: -1
    };
  }
  return data.teacher;
}

/*
 * 保存老师资料（对应 saveTeacherProfile）。
 * 改的是"当前登录的这个老师账号"，所以不再需要 teacherId —— 传了也以后端令牌为准。
 * 没手选位置时，把本机当前定位一起传上去做兜底。
 */
async function saveTeacherProfile(teacherId, teacher) {
  lastError = '';
  if (!session.isTeacher()) return setError('这个操作需要老师账号。');
  try {
    const data = await api.put('/teachers/me', Object.assign({
      name: util.plain(teacher && teacher.name),
      // 性别：单子写了性别要求时，后端用它判断"我符不符合"
      gender: util.plain(teacher && teacher.gender),
      subject: util.plain(teacher && teacher.subject),
      price: util.plain(teacher && teacher.price),
      area: util.plain(teacher && teacher.area),
      intro: util.plain(teacher && teacher.intro),
      lat: teacher && teacher.lat ? teacher.lat : 0,
      lng: teacher && teacher.lng ? teacher.lng : 0
    }, viewerFields()));
    emit('teachersChanged');
    return Number(data.id);
  } catch (e) {
    lastError = e.message;
    return -1;
  }
}

// 「我的简历」页保存（学历 / 学校 / 教龄 / 证书 / 可教科目 / 价格 / 可教时段 / 自我介绍）
async function saveTeacherResume(resume) {
  lastError = '';
  if (!session.isTeacher()) return setError('这个操作需要老师账号。');
  try {
    const data = await api.put('/teachers/me/resume', {
      education: util.plain(resume && resume.education),
      school: util.plain(resume && resume.school),
      years: util.plain(resume && resume.years),
      certificate: util.plain(resume && resume.certificate),
      subject: util.plain(resume && resume.subject),
      price: util.plain(resume && resume.price),
      times: util.plain(resume && resume.times),
      intro: util.plain(resume && resume.intro)
    });
    emit('teachersChanged');
    return Number(data.id);
  } catch (e) {
    lastError = e.message;
    return -1;
  }
}

// ==================== 学生 ====================

async function studentProfile(studentId) {
  const data = await read(api.get('/students/me'), null);
  if (!data || !data.student) return { id: -1, name: '', school: '', grade: '', phone: '' };
  return data.student;
}

async function saveStudentProfile(student) {
  lastError = '';
  if (!session.isStudent()) return setError('这个操作需要学生账号。');
  try {
    const data = await api.put('/students/me', {
      name: util.plain(student && student.name),
      school: util.plain(student && student.school),
      grade: util.plain(student && student.grade),
      phone: util.plain(student && student.phone)
    });
    emit('studentsChanged');
    return Number(data.id);
  } catch (e) {
    lastError = e.message;
    return false;
  }
}

/*
 * 「我的」页一次拿齐：身份 + 自己的资料 + 统计 +（老师）收到的单子历史 + 科目选项。
 * 原来要打好几个接口，现在后端一次返回，少几个来回。
 */
async function dashboard() {
  const data = await read(api.get('/me'), { role: 'none' });
  return data || { role: 'none' };
}

// ==================== 预约 ====================

async function myBookings() {
  const data = await read(api.get('/bookings/mine'), { list: [] });
  return data.list || [];
}

function bookingsForStudent(studentId) {
  if (!session.isStudent() || Number(studentId) < 0) return Promise.resolve([]);
  return myBookings();
}

function bookingsForTeacher(teacherId) {
  if (!session.isTeacher() || Number(teacherId) < 0) return Promise.resolve([]);
  return myBookings();
}

/*
 * 确认 / 拒绝（对应 acceptBooking / rejectBooking）——归属和状态由后端校验：
 *   平台确认老师发来的"接单申请"（确认＝接单成功，并可以带上合同金额 / 合同链接），
 *   平台拒绝＝换一位老师，那条单会重新回到「可接的单」。
 */
async function handleBooking(bookingId, accept, extra) {
  lastError = '';
  try {
    await api.post('/bookings/' + Number(bookingId) + (accept ? '/accept' : '/reject'),
      accept ? (extra || {}) : {});
    emit('bookingsChanged');
    emit('postsChanged');       // 拒绝接单时单子会重新开放，发单页也要跟着刷
    return true;
  } catch (e) {
    return setError(e.message);
  }
}

function acceptBooking(bookingId, extra) {
  return handleBooking(bookingId, true, extra);
}

function rejectBooking(bookingId) {
  return handleBooking(bookingId, false);
}

// 取消预约：学生和老师都能取消自己那一侧的课；取消后单子会回到「招募中」
async function cancelBooking(bookingId) {
  lastError = '';
  try {
    await api.post('/bookings/' + Number(bookingId) + '/cancel', {});
    emit('bookingsChanged');
    emit('postsChanged');       // 单子重新开放，发单/接单页也要跟着刷
    return true;
  } catch (e) {
    return setError(e.message);
  }
}

// ==================== 课次（试课 / 正式课，新流程）====================

/*
 * 老师提交课次：
 *   kind = 试课（提交试课完成）/ 正式（完成本次）；content 是这次课的情况，可留空。
 * 提交后课次变「待确认」，等平台确认（或判定试课结果）。
 */
async function submitLesson(bookingId, kind, content) {
  lastError = '';
  try {
    const data = await api.post('/bookings/' + Number(bookingId) + '/lessons', {
      kind: util.plain(kind),
      content: util.plain(content)
    });
    emit('bookingsChanged');
    return data || {};
  } catch (e) {
    setError(e.message);
    return null;
  }
}

// 平台有异议后，老师改完重新提交（还是「待确认」，只改内容）
async function resubmitLesson(lessonId, content) {
  lastError = '';
  try {
    await api.post('/lessons/' + Number(lessonId) + '/resubmit', { content: util.plain(content) });
    emit('bookingsChanged');
    return true;
  } catch (e) {
    return setError(e.message);
  }
}

// 老师撤回还没被平台确认的课次（撤回后可以重新提交）
async function withdrawLesson(lessonId) {
  lastError = '';
  try {
    await api.post('/lessons/' + Number(lessonId) + '/withdraw', {});
    emit('bookingsChanged');
    return true;
  } catch (e) {
    return setError(e.message);
  }
}

// 平台「确认本次」：正式课次变已确认，计入已确认次数和待支付金额
async function confirmLesson(lessonId) {
  lastError = '';
  try {
    await api.post('/lessons/' + Number(lessonId) + '/confirm', {});
    emit('bookingsChanged');
    return true;
  } catch (e) {
    return setError(e.message);
  }
}

// 平台「有异议」：填原因，课次退回待确认并通知老师
async function disputeLesson(lessonId, reason) {
  lastError = '';
  const text = util.plain(reason);
  if (text === '') return setError('先写一下这次课哪里有问题。');
  try {
    await api.post('/lessons/' + Number(lessonId) + '/dispute', { reason: text });
    emit('bookingsChanged');
    return true;
  } catch (e) {
    return setError(e.message);
  }
}

/*
 * 平台判定试课：pass = true（通过 → 主订单进行中）/ false（不通过 → 订单已结束）。
 * 试课要付费：half = true 收半价、false 收全价（不传按半价）。不通过也要收试课费。
 */
async function trialResult(lessonId, pass, half) {
  lastError = '';
  try {
    await api.post('/lessons/' + Number(lessonId) + '/trial', {
      pass: !!pass,
      half: half === undefined ? true : !!half
    });
    emit('bookingsChanged');
    return true;
  } catch (e) {
    return setError(e.message);
  }
}

// 结束订单（主订单收尾）：两边都能点；还有课次没确认时后端会挡
async function finishOrder(bookingId) {
  lastError = '';
  try {
    await api.post('/bookings/' + Number(bookingId) + '/finish', {});
    emit('bookingsChanged');
    return true;
  } catch (e) {
    return setError(e.message);
  }
}

// ==================== 收款 / 退款（平台和老师之间的钱）====================

// 平台发合同 + 收款码：amount 是合同金额（整数元），contractUrl 是合同 / 收款码链接
async function setContract(bookingId, amount, contractUrl, note) {
  lastError = '';
  try {
    const data = await api.post('/bookings/' + Number(bookingId) + '/contract', {
      amount: Number(amount) || 0,
      contractUrl: util.plain(contractUrl),
      note: util.plain(note)
    });
    emit('bookingsChanged');
    return data || {};
  } catch (e) {
    setError(e.message);
    return null;
  }
}

// 老师点「我已付款」
async function claimPaid(paymentId) {
  lastError = '';
  try {
    await api.post('/payments/' + Number(paymentId) + '/paid', {});
    emit('bookingsChanged');
    return true;
  } catch (e) {
    return setError(e.message);
  }
}

// 平台核对到账后「确认收款」
async function confirmPayment(paymentId) {
  lastError = '';
  try {
    await api.post('/payments/' + Number(paymentId) + '/confirm', {});
    emit('bookingsChanged');
    return true;
  } catch (e) {
    return setError(e.message);
  }
}

// 平台「确认退款」：amount 留空＝全额退，填了就按填的退（上过一次课按合同扣）
async function refundPayment(paymentId, amount, note) {
  lastError = '';
  try {
    const data = await api.post('/payments/' + Number(paymentId) + '/refund', {
      amount: amount === '' || amount === undefined ? '' : Number(amount) || 0,
      note: util.plain(note)
    });
    emit('bookingsChanged');
    return data || {};
  } catch (e) {
    setError(e.message);
    return null;
  }
}

// ==================== 发布单（学生发单 / 老师接单）====================

// 访客：所有「招募中」的单
async function allOpenPosts() {
  const data = await read(api.get('/posts/open', viewQuery()), { list: [], hidden: 0 });
  lastHidden = Number(data.hidden) || 0;
  return data.list || [];
}

/*
 * 老师接单用：还在招募中的、平台发的单（后端按身份自动排除自己发的）。
 * 双向筛选，和老师端面板一一对应（都是可选的）：
 *   单子本身：{ grade, subject, time, minPrice }（价格只留"最低时薪"）
 *   单子的要求（多选）：{ gender, education, minYears, certificate, teachMode }
 *   我自己的情况（多选）：{ myGender, myEducation, myYears, myCertificate, myTeachMode }
 * 多选传数组，这里拼成逗号串；空 / 全「不限」= 这条不筛（家长没提的单照样展示）。
 * 距离范围用页面上设的 nearbyKm（接单页默认 30 公里）。
 * 返回的每条单带 matchLevel / matchScore / matchReasons / matchDetails（"我符不符合"那一层）。
 */
async function postsForTaking(filters) {
  const f = filters || {};
  const join = (list) => (Array.isArray(list) ? list.filter((v) => util.plain(v) !== '').join(',') : util.plain(list));
  const query = Object.assign({}, viewQuery(), {
    grade: util.plain(f.grade),
    subject: util.plain(f.subject),
    time: util.plain(f.time),
    gender: join(f.gender),
    education: join(f.education),
    minYears: join(f.minYears),
    certificate: join(f.certificate),
    teachMode: join(f.teachMode),
    myGender: util.plain(f.myGender),
    myEducation: join(f.myEducation),
    myYears: join(f.myYears),
    myCertificate: join(f.myCertificate),
    myTeachMode: join(f.myTeachMode)
  });
  if (Number(f.minPrice) > 0) query.minPrice = Number(f.minPrice);
  if (f.onlyMatch) query.onlyMatch = 1;
  const data = await read(api.get('/posts/open', query), { list: [], hidden: 0 });
  lastHidden = Number(data.hidden) || 0;
  return data.list || [];
}

async function myPosts() {
  const data = await read(api.get('/posts/mine', viewQuery()), { list: [] });
  return data.list || [];
}

async function createPost(post) {
  lastError = '';
  if (!session.isLoggedIn()) return setError('请先登录再发布。');
  try {
    const data = await api.post('/posts', Object.assign({
      subject: util.plain(post && post.subject),
      grade: util.plain(post && post.grade),
      gender: util.plain(post && post.gender),
      time: util.plain(post && post.time),
      price: util.plain(post && post.price),
      area: util.plain(post && post.area),
      lat: post && post.lat ? post.lat : 0,
      lng: post && post.lng ? post.lng : 0,
      note: util.plain(post && post.note),
      requirements: (post && post.requirements) || {},
      // 家长原话：后端存下来给老师看，也会过一遍脱敏
      rawText: util.plain(post && post.rawText)
    }, viewerFields()));
    emit('postsChanged');
    return Number(data.id);
  } catch (e) {
    return setError(e.message);
  }
}

/*
 * 家长原话 → 结构化要求（POST /api/agent/parse）。
 * 解析交给后端 / 外部 Agent；解析失败不阻塞发单 —— 后端会把 5 个字段都填「不限」，
 * 原话照原样带回来。这里拿不到结果（后端连不上）就返回 null，页面按"没要求"处理。
 */
async function parseRequirement(text) {
  lastError = '';
  const raw = util.plain(text);
  if (raw === '') return null;
  try {
    return await api.post('/agent/parse', { text: raw });
  } catch (e) {
    setError(e.message);
    return null;
  }
}

// 批量解析：一次把多条原话发过去（批量发单页用），失败返回 []
async function parseRequirements(texts) {
  lastError = '';
  const list = (Array.isArray(texts) ? texts : []).map((item) => util.plain(item));
  if (list.length === 0) return [];
  try {
    const data = await api.post('/agent/parse', { texts: list });
    return data.list || [];
  } catch (e) {
    setError(e.message);
    return [];
  }
}

/*
 * 批量发单：一次贴多条（手动加几条 / 粘贴 JSON、表格解析出来的）。
 * 后端逐条落库，返回 { ok: [{ index, id, code }], failed: [{ index, reason }] }；
 * 整批都没成（比如没登录）返回 null，原因读 store.lastError。
 */
async function batchCreatePosts(posts) {
  lastError = '';
  if (!session.isLoggedIn()) return setError('请先登录再发布。');
  const list = Array.isArray(posts) ? posts : [];
  if (list.length === 0) return setError('还没有要发的单。');
  try {
    const data = await api.post('/posts/batch', Object.assign({ posts: list }, viewerFields()));
    emit('postsChanged');
    return {
      ok: data.ok || [],
      failed: data.failed || [],
      batchId: data.batchId || ''
    };
  } catch (e) {
    setError(e.message);
    return null;
  }
}

/*
 * 投递简历接单：老师带上简历发过去，后端先生成一条"待确认"的课，等平台确认。
 * 时间撞上自己已有的课不拦，只提醒：
 *   返回 { conflict: true, timeText } → 页面弹一条提醒，老师点确定后带 force 再调一次；
 *   成功返回 { conflict: false }；出错返回 null（原因读 store.lastError）。
 */
async function takePost(postId, resume, force) {
  lastError = '';
  try {
    const data = await api.post('/posts/' + Number(postId) + '/take', {
      resume: util.plain(resume),
      force: !!force
    });
    if (data && data.conflict) return { conflict: true, timeText: data.timeText || '' };
    emit('postsChanged');
    emit('bookingsChanged');
    return { conflict: false };
  } catch (e) {
    setError(e.message);
    return null;
  }
}

async function closePost(postId, asTeacher, accountId) {
  lastError = '';
  try {
    await api.post('/posts/' + Number(postId) + '/close', {});
    emit('postsChanged');
    return true;
  } catch (e) {
    return setError(e.message);
  }
}

// ==================== 消息（真人聊天已下线，只剩官方助手 + 系统通知）====================

// 我的官方助手会话（老师端消息页置顶显示，标官方）
async function myAgents() {
  const data = await read(api.get('/agents/mine'), { list: [] });
  return data.list || [];
}

/*
 * 未读总数（底部导航红点用）：单子卡片未读 + 系统通知未读 + 官方助手会话未读。
 *
 * 红点要"读一条就当场少一条"，所以这里不能只靠 onShow 那一次请求：
 *   - 记住上一次的数字只是省请求（3 秒内不重复问后端）；
 *   - 一读了消息就把本地数字先减下来，并发 unreadChanged 让底部导航立刻重画；
 *   - 同时把记忆作废，下一次 onShow / 切页时再去后端核对真实值（减错了也能纠正回来）。
 */
let unreadMemo = { at: 0, value: 0 };
let unreadLoading = null;
/*
 * 工作台那格的红点（中介端）：有多少条「我发布的单」还挂着没处理的投递。
 * 按"单子数"算，不按投递条数（3 位老师投同一条单只算 1）；跟着 /me/unread 一起回来，
 * 工作台页自己算出来之后用 setTodoPosts 先改一下，红点当场就准，不用等下一次请求。
 */
let todoPostsMemo = 0;

function setUnreadCount(value) {
  unreadMemo = { at: Date.now(), value: Math.max(0, Number(value) || 0) };
  emit('unreadChanged');
  return unreadMemo.value;
}

// 读了 N 条：本地先减，别等下一个请求回来才更新红点
function bumpUnread(removed) {
  const count = Math.max(0, Number(removed) || 0);
  unreadMemo = { at: 0, value: Math.max(0, unreadMemo.value - count) };
  emit('unreadChanged');
}

// 红点当前显示的数字（不发请求，给底部导航订阅事件时同步用）
function unreadChatCountCached() {
  return unreadMemo.value;
}

function setTodoPosts(value) {
  const next = Math.max(0, Number(value) || 0);
  if (next === todoPostsMemo) return next;
  todoPostsMemo = next;
  emit('unreadChanged');
  return next;
}

// 红点当前显示的待办单数（不发请求，给底部导航订阅事件时同步用）
function todoPostCountCached() {
  return todoPostsMemo;
}

async function unreadChatCount() {
  // 退出登录 / 访客：红点归零，别把上一个账号的数字留在导航上
  if (!session.isLoggedIn()) {
    if (unreadMemo.value !== 0) setUnreadCount(0);
    if (todoPostsMemo !== 0) setTodoPosts(0);
    return 0;
  }
  if (unreadMemo.at && Date.now() - unreadMemo.at < 3000) return unreadMemo.value;
  if (unreadLoading) return unreadLoading;
  unreadLoading = (async () => {
    try {
      // 拉失败就把当前数字再记一次，别把红点清空
      const data = await read(api.get('/me/unread'),
        { count: unreadMemo.value, todoPosts: todoPostsMemo });
      setTodoPosts(data.todoPosts);
      return setUnreadCount(Number(data.count) || 0);
    } finally {
      unreadLoading = null;
    }
  })();
  return unreadLoading;
}

// ==================== 老师端「我的单子」卡片（消息页）====================

// 投一次简历就有一张卡片（标题＝单号 20261008-1），用来查看这条单子走到哪一步了
async function messageBoxes() {
  if (!session.isLoggedIn()) return [];
  const data = await read(api.get('/messages/boxes'), { list: [] });
  return data.list || [];
}

// 一张卡片的全部通知（按时间正序，像一段聊天记录）
async function messageThread(postId) {
  if (!session.isLoggedIn() || !(Number(postId) > 0)) return { post: null, list: [] };
  const data = await read(api.get('/messages/boxes/' + Number(postId)), { post: null, list: [] });
  return { post: data.post || null, list: data.list || [] };
}

// ==================== 消息页：把结束的单子卡片收起来（纯本机记忆）====================

/*
 * 「已经结束的单子卡片」可以在消息页点一下隐藏，收进「已隐藏」里。
 * 这是本机的一个浏览偏好，不进后端（单子、消息、订单永远以后端为准，这条不影响业务数据）：
 *   key = tutor_hidden_boxes_v1，按账号分一份：{ 't4' / 's1': { '<单子id>': 隐藏时最后一条消息的 id } }
 * 记下最后一条消息的 id 是为了「这张单子又有新动静就自动放出来」，不用用户自己取消隐藏；
 * 换个账号登录，看到的是自己那份隐藏记录。
 */
const HIDDEN_BOXES_KEY = 'tutor_hidden_boxes_v1';
// 中介工作台：「这条单子的简历已经发给家长了」记一笔（待交付 → 待定老师）
const DELIVERED_KEY = 'tutor_delivered_v1';

// 本机记忆按账号分开：老师 t<id>、学生 s<id>，没登录就没有
function accountKey() {
  if (session.isTeacher()) return 't' + session.teacherId();
  if (session.isLoggedIn()) return 's' + session.studentId();
  return '';
}

function localMap(key) {
  const who = accountKey();
  if (who === '') return {};
  try {
    const all = wx.getStorageSync(key);
    const mine = all && typeof all === 'object' ? all[who] : null;
    return mine && typeof mine === 'object' ? mine : {};
  } catch (e) {
    return {};
  }
}

function saveLocalMap(key, map) {
  const who = accountKey();
  if (who === '') return setError('请先登录。');
  try {
    const all = wx.getStorageSync(key);
    const next = all && typeof all === 'object' ? all : {};
    const mine = {};
    Object.keys(map && typeof map === 'object' ? map : {}).forEach((k) => {
      const text = String(k);
      if (text !== '') mine[text] = map[k];
    });
    if (Object.keys(mine).length > 0) next[who] = mine;
    else delete next[who];
    wx.setStorageSync(key, next);
    return true;
  } catch (e) {
    return setError('本机记忆没存下来。');
  }
}

function hiddenBoxes() {
  return localMap(HIDDEN_BOXES_KEY);
}

// 页面改完一整份交回来（带 key 的负数这种脏数据不收）
function saveHiddenBoxes(map) {
  const clean = {};
  Object.keys(map && typeof map === 'object' ? map : {}).forEach((key) => {
    const postId = Number(key);
    if (postId > 0) clean[String(postId)] = Number(map[key]) || 0;
  });
  return saveLocalMap(HIDDEN_BOXES_KEY, clean);
}

// 「这条单子的简历已经发给家长了」：记下当时的投递人数，人数变了会重新变成待交付
function deliveredMap() {
  return localMap(DELIVERED_KEY);
}

function saveDeliveredMap(map) {
  return saveLocalMap(DELIVERED_KEY, map);
}

// ==================== 修正（中介工作台）====================

/*
 * 修正：中介手动改单子 / 订单状态、补录一条线下成交的订单、把单子作废。
 * 这是真正的数据改动（不是本机记忆），改完广播一下让工作台 / 消息页 / 我的页都刷新。
 */
async function correctPost(postId, payload) {
  lastError = '';
  try {
    const data = await api.post('/posts/' + Number(postId) + '/correct', payload || {});
    emit('postsChanged');
    emit('bookingsChanged');
    return data || {};
  } catch (e) {
    setError(e.message);
    return null;
  }
}

async function correctBooking(bookingId, payload) {
  lastError = '';
  try {
    const data = await api.post('/bookings/' + Number(bookingId) + '/correct', payload || {});
    emit('bookingsChanged');
    emit('postsChanged');
    return data || {};
  } catch (e) {
    setError(e.message);
    return null;
  }
}

// 这条单子 / 订单最近改过几次（修正弹层里那几行）
async function corrections(target, targetId) {
  const data = await read(api.get('/corrections', {
    target: util.plain(target),
    targetId: Number(targetId) || 0,
    limit: 5
  }), { list: [] });
  return data.list || [];
}

// 点开卡片：这条单子的通知全部标已读（unread = 本地先减几条）
async function readMessageThread(postId, unread) {
  lastError = '';
  try {
    await api.post('/messages/boxes/' + Number(postId) + '/read', {});
    bumpUnread(Number(unread) || 0);
    return true;
  } catch (e) {
    return setError(e.message);
  }
}

// ==================== 官方助手会话（老师 ↔ Agent）====================

// 和某个官方助手的一段会话：消息列表 + 未读（真人聊天已下线，这条通道不限额）
async function agentChatSession(agentId) {
  if (!session.isLoggedIn() || !(Number(agentId) >= 0)) {
    return { agent: null, list: [], unread: 0 };
  }
  const data = await read(api.get('/chats/agent/' + Number(agentId)), { list: [], unread: 0, agent: null });
  return {
    agent: data.agent || null,
    list: data.list || [],
    unread: Number(data.unread) || 0
  };
}

async function sendAgentChatMessage(agentId, body) {
  lastError = '';
  const text = util.plain(body);
  if (!session.isLoggedIn()) return setError('请先登录再聊天。');
  if (text === '') return setError('消息不能为空。');
  try {
    await api.post('/chats/agent/' + Number(agentId), { body: text });
    emit('chatsChanged');
    return true;
  } catch (e) {
    return setError(e.message);
  }
}

async function markAgentChatRead(agentId, unread) {
  try {
    const data = await api.post('/chats/agent/' + Number(agentId) + '/read', {});
    if (data && data.changed) {
      bumpUnread(Number(unread) || 1);
      emit('chatsChanged');
    }
    return true;
  } catch (e) {
    return setError(e.message);
  }
}

// ==================== 消息中心（系统通知 / 合同 / Agent 消息）====================

async function messages() {
  const data = await read(api.get('/messages/mine'), { list: [], unread: 0 });
  return { list: data.list || [], unread: Number(data.unread) || 0 };
}

async function readMessage(messageId) {
  lastError = '';
  try {
    await api.post('/messages/' + Number(messageId) + '/read', {});
    bumpUnread(1);
    emit('messagesChanged');
    return true;
  } catch (e) {
    return setError(e.message);
  }
}

module.exports = {
  // 常量（和原来一致，页面里直接用）
  statusPending: () => util.STATUS_PENDING,
  statusConfirmed: () => util.STATUS_CONFIRMED,
  statusRejected: () => util.STATUS_REJECTED,
  statusCancelled: () => util.STATUS_CANCELLED,
  statusTrial: () => util.STATUS_TRIAL,
  statusMain: () => util.STATUS_MAIN,
  statusEnded: () => util.STATUS_ENDED,
  lessonTrial: () => util.LESSON_TRIAL,
  lessonFormal: () => util.LESSON_FORMAL,
  postOpen: () => util.POST_OPEN,
  postTaken: () => util.POST_TAKEN,
  postClosed: () => util.POST_CLOSED,
  nearbyDefault: () => util.NEARBY_KM,
  nearbyChoices: () => util.NEARBY_CHOICES.slice(),

  get lastError() { return lastError; },
  get lastHidden() { return lastHidden; },

  init, on, off,
  restoreLogin, forgetLogin,

  setViewerLocation, viewerLocation, setNearbyKm, nearbyKmValue,
  setShowAll, showAllValue, nearbyActive,

  teachers, subjects, teacherById, saveTeacherProfile, saveTeacherResume,
  loginTeacher, registerTeacher,
  loginStudent, registerStudent, studentProfile, saveStudentProfile,
  dashboard,
  bookingsForStudent, bookingsForTeacher,
  acceptBooking, rejectBooking, cancelBooking,
  setContract, claimPaid, confirmPayment, refundPayment,
  submitLesson, resubmitLesson, withdrawLesson, confirmLesson, disputeLesson, trialResult, finishOrder,
  postsForTaking, myPosts, createPost, batchCreatePosts, takePost, closePost, allOpenPosts,
  parseRequirement, parseRequirements,
  unreadChatCount, unreadChatCountCached, myAgents,
  todoPostCountCached, setTodoPosts,
  agentChatSession, sendAgentChatMessage, markAgentChatRead,
  messages, readMessage, messageBoxes, messageThread, readMessageThread,
  hiddenBoxes, saveHiddenBoxes,
  deliveredMap, saveDeliveredMap,
  correctPost, correctBooking, corrections
};
