/*
 * 【已停用的旧实现，留作对照，可整个 legacy/ 目录删掉】
 * 这是改造前的数据层：小程序版的 DatabaseManager，所有业务数据都存在本机 wx.storage 里。
 * 现在业务数据在后端（server/），页面用的是 utils/store.js（API 客户端）。
 *
 * 数据层：小程序版的 DatabaseManager。
 * 对应 Qt 版 data/databasemanager.cpp —— 原来读写 SQLite，这里读写 wx 本地缓存
 * （一个 key 里放 7 张"表"数组 + 自增 id），对外接口名、校验规则、消息通知、
 * 信号（xxxChanged）都跟 C++ 版一一对应。
 *
 * 用法和 C++ 一致：函数返回 bool / id，失败原因放在 store.lastError 里。
 * 页面读数据用 store.xxxChanged(fn) 订阅，等价于 Qt 的 connect(...signal...)。
 */

const util = require('../utils/util.js');
const session = require('../utils/session.js');
const location = require('../utils/location.js');

const DB_KEY = 'tutor_db_v1';
const NEARBY_KEY = 'nearby_km_v1';   // 半径选过就记住，下次打开还是这个值
const TABLES = ['teachers', 'students', 'bookings', 'messages', 'reviews', 'posts', 'chats', 'sessions'];
const EVENTS = ['teachersChanged', 'bookingsChanged', 'messagesChanged', 'studentsChanged',
                'reviewsChanged', 'postsChanged', 'chatsChanged'];

let db = null;
let lastError = '';

const listeners = {};
EVENTS.forEach((name) => { listeners[name] = []; });

function emptyDb() {
  const fresh = { seq: {} };
  TABLES.forEach((table) => {
    fresh[table] = [];
    fresh.seq[table] = 0;
  });
  return fresh;
}

function load() {
  if (db) return db;
  let stored = null;
  try {
    stored = wx.getStorageSync(DB_KEY);
  } catch (e) {
    stored = null;
  }
  db = stored && typeof stored === 'object' ? stored : emptyDb();
  // 老版本/半截数据兜底：缺哪张表补哪张
  TABLES.forEach((table) => {
    if (!Array.isArray(db[table])) db[table] = [];
  });
  if (!db.seq || typeof db.seq !== 'object') db.seq = {};
  TABLES.forEach((table) => {
    if (typeof db.seq[table] !== 'number') {
      db.seq[table] = db[table].reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);
    }
  });
  return db;
}

function save() {
  try {
    wx.setStorageSync(DB_KEY, load());
  } catch (e) {
    lastError = '写入本地数据失败：' + (e && e.message ? e.message : e);
  }
}

function nextId(table) {
  const data = load();
  data.seq[table] = (data.seq[table] || 0) + 1;
  return data.seq[table];
}

// ---------- 信号（等价于 Qt 的 xxxChanged()）----------
function emit(eventName) {
  const list = listeners[eventName] || [];
  list.slice().forEach((fn) => {
    try {
      fn();
    } catch (e) {
      // 页面回调出错不影响数据层，跟 Qt 里信号槽互不干扰一个意思
    }
  });
}

function on(eventName, fn) {
  if (!listeners[eventName]) listeners[eventName] = [];
  // 同一个回调重复订阅只留一份（页面 onShow 会重新订阅）
  if (listeners[eventName].indexOf(fn) < 0) listeners[eventName].push(fn);
}

function off(eventName, fn) {
  const list = listeners[eventName];
  if (!list) return;
  const index = list.indexOf(fn);
  if (index >= 0) list.splice(index, 1);
}

function setError(message) {
  lastError = message;
  return false;
}

function findTeacher(id) {
  return load().teachers.find((t) => t.id === Number(id)) || null;
}

function findStudent(id) {
  return load().students.find((s) => s.id === Number(id)) || null;
}

// ==================== 附近筛选（小程序特有）====================
// 对应说明：Qt 版没有"只看多远以内"，这里给列表页加一层距离过滤。
// 浏览者的定位存在 utils/location.js（本地缓存 my_location_v1），这里只管：
//   用哪个定位（viewer）、多远以内（nearbyKm）、要不要看全部（showAll）。
// showAll 不写缓存：下次进来默认还是"只看附近"，免得"看全部"变成长期状态把限制绕过去。

let viewer = null;
let nearbyKm = util.NEARBY_KM;
let showAll = false;
let lastHidden = 0;      // 上一次列表筛掉了多少条（页面提示用）

function loadNearbyKm() {
  let stored = null;
  try {
    stored = wx.getStorageSync(NEARBY_KEY);
  } catch (e) {
    stored = null;
  }
  // 没存过时 wx.getStorageSync 给的是空串：不能当 0（0 = 不限距离）用
  if (stored === '' || stored === null || stored === undefined) {
    nearbyKm = util.NEARBY_KM;
    return;
  }
  const value = Number(stored);
  nearbyKm = isFinite(value) && value >= 0 ? value : util.NEARBY_KM;
}

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
  try {
    wx.setStorageSync(NEARBY_KEY, nearbyKm);
  } catch (e) {
    // 存不下也不影响这次筛选
  }
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

// 真正在筛的条件：有定位 + 定了半径 + 没点"看全部"
function nearbyActive() {
  return !showAll && nearbyKm > 0 && !!viewer;
}

// 这一条离我多远（公里）；没有坐标返回 -1
function distanceOf(row) {
  if (!viewer) return -1;
  return util.distanceKm(viewer.latitude, viewer.longitude, row && row.lat, row && row.lng);
}

/*
 * 距离过滤：超出半径的藏起来并计数。
 * 没有坐标的老数据（老版本发的单、示例老师）不藏 —— 定位没授权、老数据没位置时
 * 宁可多显示几条 + 页面给提示，也别让列表凭空空掉。
 */
function passNearby(row) {
  if (!nearbyActive()) return true;
  const km = distanceOf(row);
  if (km < 0) return true;
  if (km <= nearbyKm) return true;
  lastHidden++;
  return false;
}

function startFilter() {
  lastHidden = 0;
}

// 近的排前面；没有距离的一律排最后（再按原来的 id / 时间排）
function byNearest(a, b) {
  const ka = a.distanceKm >= 0 ? a.distanceKm : Infinity;
  const kb = b.distanceKm >= 0 ? b.distanceKm : Infinity;
  if (ka !== kb) return ka - kb;
  return a.id - b.id;
}

// 资料/发布单没手选位置时，用自己的当前定位兜底（保证新数据都算得出距离）
function fallbackCoords(source) {
  if (source && util.hasCoords(source.lat, source.lng)) {
    return { lat: Number(source.lat), lng: Number(source.lng) };
  }
  const here = location.current();
  if (here) return { lat: here.latitude, lng: here.longitude };
  return null;
}

// ==================== 初始化 ====================

// 对应 DatabaseManager::init()：成功返回 ''，失败返回错误文案
function init() {
  try {
    load();
    loadNearbyKm();
    seedIfEmpty();
    save();
    return '';
  } catch (e) {
    return '打开数据库失败：' + (e && e.message ? e.message : e);
  }
}

// 首次启动：teachers 表为空时写入示例老师
// （Qt 版会先尝试导入桌面 teachers.txt，小程序没有本地文件入口，直接给示例数据）
function seedIfEmpty() {
  const data = load();
  if (data.teachers.length > 0) return;
  addTeacher('王数学', '数学', '99 元/小时');
  addTeacher('李英语', '英语', '88 元/小时');
  addTeacher('张物理', '物理', '77 元/小时');
}

// ==================== 老师 ====================

// 科目 + 关键词（姓名/科目/位置）叠加筛选，空串或“全部”代表该条件不筛；
// 再叠加一层"只看附近"（有定位时按半径过滤，近的排前面）
function teachers(subject, keyword) {
  const data = load();
  const picked = util.plain(subject);
  const filterSubject = picked !== '' && picked !== '全部';
  const key = util.plain(keyword).toLowerCase();

  startFilter();
  return data.teachers
    .filter((t) => util.plain(t.subject) !== '')   // 资料没填完的老师先不上架
    .filter((t) => !filterSubject || t.subject === picked)
    .filter((t) => {
      if (key === '') return true;
      const name = util.plain(t.name).toLowerCase();
      const subj = util.plain(t.subject).toLowerCase();
      const area = util.plain(t.area).toLowerCase();
      return name.indexOf(key) >= 0 || subj.indexOf(key) >= 0 || area.indexOf(key) >= 0;
    })
    .map((t) => {
      const copy = util.clone(t);
      copy.distanceKm = distanceOf(t);
      return copy;
    })
    .filter(passNearby)
    .sort(byNearest);
}

// 库里已有的科目（给筛选下拉用）
function subjects() {
  const set = [];
  load().teachers.forEach((t) => {
    const subject = util.plain(t.subject);
    if (subject !== '' && set.indexOf(subject) < 0) set.push(subject);
  });
  return set.sort();
}

function teacherById(id) {
  const teacher = findTeacher(id);
  if (!teacher) {
    return { id: -1, name: '', subject: '', price: '', intro: '', rating: 5, area: '', lat: 0, lng: 0 };
  }
  const copy = util.clone(teacher);
  copy.distanceKm = distanceOf(teacher);   // 详情页也能顺手显示离我多远
  return copy;
}

function addTeacher(name, subject, price) {
  const teacherName = util.plain(name);
  if (teacherName === '') return setError('姓名不能为空。');

  const data = load();
  data.teachers.push({
    id: nextId('teachers'),
    name: teacherName,
    subject: util.plain(subject),
    price: util.plain(price),
    intro: teacherName + '老师，擅长' + util.plain(subject) + '辅导，' + util.DEFAULT_INTRO,
    rating: 5.0,
    area: '',
    lat: 0,        // 示例数据没有坐标：列表里按"距离未知"照常显示
    lng: 0,
    password: util.hashPassword(util.DEFAULT_PASSWORD)
  });
  save();
  emit('teachersChanged');
  return true;
}

// 老师登录：姓名 + 密码。重名不要紧，用密码区分（同名不同密码算两位老师）
function loginTeacher(name, password) {
  const teacherName = util.plain(name);
  if (teacherName === '' || util.plain(password) === '') {
    setError('姓名和密码都要填。');
    return -1;
  }

  const hashed = util.hashPassword(password);
  const found = load().teachers.find((t) => t.name === teacherName && t.password === hashed);
  if (!found) {
    setError('姓名或密码不对。新老师请点【注册新老师】。');
    return -1;
  }
  return found.id;
}

// 老师注册：只要姓名 + 密码，科目/价格去“我的”页补。
// 同名同密码已经存在时直接返回那条记录，避免同一个人反复注册出多条。
function registerTeacher(name, password) {
  const teacherName = util.plain(name);
  if (teacherName === '' || util.plain(password) === '') {
    setError('姓名和密码都要填。');
    return -1;
  }

  const hashed = util.hashPassword(password);
  const existing = load().teachers.find((t) => t.name === teacherName && t.password === hashed);
  if (existing) return existing.id;

  const data = load();
  const id = nextId('teachers');
  data.teachers.push({
    id,
    name: teacherName,
    subject: '',        // 科目/价格留空，等老师去“我的”页填
    price: '',
    intro: '',
    rating: 5.0,
    area: '',
    password: hashed
  });
  save();
  emit('teachersChanged');
  return id;
}

// 老师端“我的”页保存资料：teacherId < 0 时新建一条，返回老师 id；失败返回 -1
function saveTeacherProfile(teacherId, teacher) {
  const name = util.plain(teacher && teacher.name);
  if (name === '') {
    setError('姓名不能为空。');
    return -1;
  }

  const subject = util.plain(teacher.subject);
  const intro = util.plain(teacher.intro) === ''
    ? name + '老师，擅长' + subject + '辅导，' + util.DEFAULT_INTRO
    : util.plain(teacher.intro);

  const data = load();
  // 位置坐标：手选了位置就用选的；没选就用自己的当前定位兜底
  const pickedCoords = util.hasCoords(teacher.lat, teacher.lng)
    ? { lat: Number(teacher.lat), lng: Number(teacher.lng) } : null;
  const myCoords = fallbackCoords(null);
  const coords = pickedCoords || myCoords;
  if (teacherId < 0) {
    const id = nextId('teachers');
    data.teachers.push({
      id,
      name,
      subject,
      price: util.plain(teacher.price),
      intro,
      rating: 5.0,
      area: util.plain(teacher.area),
      lat: coords ? coords.lat : 0,
      lng: coords ? coords.lng : 0,
      password: util.hashPassword(util.DEFAULT_PASSWORD)
    });
    save();
    emit('teachersChanged');
    return id;
  }

  const target = data.teachers.find((t) => t.id === Number(teacherId));
  if (!target) {
    setError('找不到这位老师的资料。');
    return -1;
  }

  target.name = name;
  target.subject = subject;
  target.price = util.plain(teacher.price);
  target.intro = intro;
  target.area = util.plain(teacher.area);
  // 这次没带坐标（比如登录页只是顺手补科目）就保留原来的，别把老坐标冲掉；
  // 老数据本来就没坐标时才用当前定位补一次
  if (pickedCoords) {
    target.lat = pickedCoords.lat;
    target.lng = pickedCoords.lng;
  } else if (!util.hasCoords(target.lat, target.lng) && myCoords) {
    target.lat = myCoords.lat;
    target.lng = myCoords.lng;
  }
  save();
  emit('teachersChanged');
  return Number(teacherId);
}

// ==================== 学生账号 / 资料 ====================

function loginStudent(name, password) {
  const studentName = util.plain(name);
  if (studentName === '' || util.plain(password) === '') {
    setError('姓名和密码都要填。');
    return -1;
  }

  const hashed = util.hashPassword(password);
  const found = load().students.find((s) => s.name === studentName && s.password === hashed);
  if (!found) {
    setError('姓名或密码不对。还没有账号请点【注册新学生】。');
    return -1;
  }
  return found.id;
}

function registerStudent(name, password) {
  const studentName = util.plain(name);
  if (studentName === '' || util.plain(password) === '') {
    setError('姓名和密码都要填。');
    return -1;
  }

  const hashed = util.hashPassword(password);
  const existing = load().students.find((s) => s.name === studentName && s.password === hashed);
  if (existing) return existing.id;

  const data = load();
  const id = nextId('students');
  data.students.push({
    id,
    name: studentName,
    password: hashed,
    school: '',
    grade: '',
    phone: '',
    created_at: util.nowText()
  });
  save();
  emit('studentsChanged');
  return id;
}

function studentProfile(studentId) {
  const student = studentId >= 0 ? findStudent(studentId) : null;
  if (!student) return { id: -1, name: '', school: '', grade: '', phone: '' };
  return util.clone(student);
}

function saveStudentProfile(student) {
  const name = util.plain(student && student.name);
  if (name === '') return setError('姓名不能为空。');

  const data = load();
  if (student.id < 0) {
    data.students.push({
      id: nextId('students'),
      name,
      password: '',
      school: util.plain(student.school),
      grade: util.plain(student.grade),
      phone: util.plain(student.phone),
      created_at: util.nowText()
    });
  } else {
    const target = data.students.find((s) => s.id === Number(student.id));
    if (!target) return setError('找不到这位学生的资料。');
    // 只改资料，不动密码
    target.name = name;
    target.school = util.plain(student.school);
    target.grade = util.plain(student.grade);
    target.phone = util.plain(student.phone);
  }
  save();
  emit('studentsChanged');
  return true;
}

// ==================== 时间显示（对应 Qt 的 displayDay / displayTime）====================

function displayDay(dayIso) {
  return util.displayDay(dayIso);
}

function displayTime(dayIso, period) {
  return util.displayTime(dayIso, period);
}

// ==================== 预约 ====================

// 对应 bookingSelect()：老师名字/科目来自 teachers 表，价格优先用订单里的快照
function readBooking(booking) {
  const teacher = findTeacher(booking.teacher_id);
  return {
    id: booking.id,
    teacherId: booking.teacher_id,
    teacherName: teacher ? teacher.name : '',
    subject: teacher ? util.plain(teacher.subject) : '',
    day: booking.day,
    period: booking.period,
    timeText: displayTime(booking.day, booking.period),
    price: util.plain(booking.price) !== '' ? util.plain(booking.price)
                                            : (teacher ? util.plain(teacher.price) : ''),
    remark: booking.remark,
    status: booking.status,
    createdAt: booking.created_at,
    studentName: booking.student_name,
    studentId: booking.student_id
  };
}

// 未结束的订单（待确认、已确认）排前面，其余按上课时间排
function bookingWeight(status) {
  if (status === util.STATUS_PENDING) return 0;
  if (status === util.STATUS_CONFIRMED) return 1;
  return 2;
}

function sortBookings(list) {
  return list.sort((a, b) => {
    const diff = bookingWeight(a.status) - bookingWeight(b.status);
    if (diff !== 0) return diff;
    // 上课时间是自由文本：老数据是「日期+时段」，按日期字符串排就行
    if (a.day !== b.day) return a.day < b.day ? -1 : 1;
    return a.id - b.id;
  });
}

function bookingsForStudent(studentId) {
  if (studentId < 0) return [];
  const list = load().bookings
    .filter((b) => b.student_id === Number(studentId))
    .map(readBooking);
  return sortBookings(list);
}

function bookingsForTeacher(teacherId) {
  if (teacherId < 0) return [];
  const list = load().bookings
    .filter((b) => b.teacher_id === Number(teacherId))
    .map(readBooking);
  return sortBookings(list);
}

function activeBookingCount(studentId) {
  return load().bookings.filter((b) =>
    b.student_id === Number(studentId) &&
    b.status !== util.STATUS_CANCELLED &&
    b.status !== util.STATUS_REJECTED).length;
}

// 价格是自由文本，统计时用订单里的价格快照，只累加能看出数字的那些
function totalSpent(studentId) {
  let total = 0;
  bookingsForStudent(studentId).forEach((booking) => {
    if (booking.status === util.STATUS_CANCELLED || booking.status === util.STATUS_REJECTED) return;
    total += util.priceValue(booking.price);
  });
  return total;
}

// 对应 createBooking()：上课时间改成学生自己填的自由文本（不再走时段表），落库在 day 里，period 留空
function createBooking(teacherId, studentId, time, remark) {
  if (teacherId < 0 || studentId < 0) return setError('请先登录后再预约。');
  const when = util.plain(time);
  if (when === '') return setError('请先填写上课时间。');

  const data = load();
  const active = (b) => b.status !== util.STATUS_CANCELLED && b.status !== util.STATUS_REJECTED;

  // 时间是自由文本，没法机器比对，只能挡「文字一模一样」的撞课：老师这边
  const teacherBusy = data.bookings.some((b) =>
    b.teacher_id === Number(teacherId) && displayTime(b.day, b.period) === when && active(b));
  if (teacherBusy) return setError('这个时间已经被预约了，换一个吧。');

  // 同一个学生同一时间也不能约两位老师
  const studentBusy = data.bookings.some((b) =>
    b.student_id === Number(studentId) && displayTime(b.day, b.period) === when && active(b));
  if (studentBusy) return setError('这个时间你已经约了别的老师，换个时间或者先取消那一条吧。');

  const teacher = findTeacher(teacherId);
  const student = findStudent(studentId);
  const studentName = !student || util.plain(student.name) === ''
    ? session.defaultStudentName()
    : util.plain(student.name);

  data.bookings.push({
    id: nextId('bookings'),
    teacher_id: Number(teacherId),
    day: when,
    period: '',
    remark: util.plain(remark),
    student_name: studentName,
    student_id: Number(studentId),
    price: util.plain(teacher ? teacher.price : ''),   // 价格快照：老师改价不影响这条订单
    status: util.STATUS_PENDING,
    created_at: util.nowText()
  });
  save();

  addMessage('预约已提交',
    '你已提交 ' + teacher.name + ' 老师的' + util.plain(teacher.subject) + '课程预约，时间：' +
      when + '，费用：' + (util.plain(teacher.price) === '' ? '未填写' : teacher.price) +
      '，等待老师确认。',
    Number(studentId), 0);
  addMessage('收到新的预约申请',
    studentName + ' 同学预约了你的' + util.plain(teacher.subject) + '课程，时间：' +
      when + '，记得去【收到的预约】处理。',
    0, Number(teacherId));

  emit('bookingsChanged');
  return true;
}

// 老师确认 / 拒绝共用一套流程：先校验归属和状态，再改库、发消息、通知页面刷新
function setBookingHandled(bookingId, teacherId, accept) {
  const booking = load().bookings.find((b) => b.id === Number(bookingId));
  if (!booking) return setError('找不到这条预约记录。');
  if (booking.teacher_id !== Number(teacherId)) return setError('这条预约不是你的课，不能处理。');
  if (booking.status !== util.STATUS_PENDING) return setError('这条预约已经处理过了。');

  booking.status = accept ? util.STATUS_CONFIRMED : util.STATUS_REJECTED;
  save();

  const teacher = findTeacher(teacherId);
  const when = displayTime(booking.day, booking.period);
  if (accept) {
    addMessage('预约已确认',
      '老师 ' + teacher.name + ' 已确认你 ' + when + ' 的' + util.plain(teacher.subject) +
        '课程预约，记得按时上课。',
      booking.student_id, 0);
  } else {
    addMessage('预约被拒绝',
      '很遗憾，' + teacher.name + ' 老师拒绝了你 ' + when + ' 的' + util.plain(teacher.subject) +
        '课程预约，可以换一位老师或改个时间再约。',
      booking.student_id, 0);
  }

  emit('bookingsChanged');
  return true;
}

function acceptBooking(bookingId, teacherId) {
  return setBookingHandled(bookingId, teacherId, true);
}

function rejectBooking(bookingId, teacherId) {
  return setBookingHandled(bookingId, teacherId, false);
}

function cancelBooking(bookingId, studentId) {
  const booking = load().bookings.find((b) => b.id === Number(bookingId));
  if (!booking) return setError('找不到这条预约记录。');
  if (booking.student_id !== Number(studentId)) return setError('这条预约不是你的，不能取消。');
  if (booking.status !== util.STATUS_PENDING && booking.status !== util.STATUS_CONFIRMED) {
    return setError('这条预约已经处理过了，不能取消。');
  }

  booking.status = util.STATUS_CANCELLED;
  save();

  const teacher = findTeacher(booking.teacher_id);
  const when = displayTime(booking.day, booking.period);
  addMessage('预约已取消',
    '与 ' + teacher.name + ' 老师 ' + when + ' 的课程已取消，如需继续上课请重新预约。',
    booking.student_id, 0);
  addMessage('学生取消了预约',
    '学生取消了你 ' + when + ' 的' + util.plain(teacher.subject) + '课程，这个时间已经空出来了。',
    0, booking.teacher_id);

  emit('bookingsChanged');
  return true;
}

// ==================== 消息 ====================

function messagesFor(studentId, teacherId) {
  return load().messages
    .filter((m) => (m.student_id !== 0 && m.student_id === Number(studentId)) ||
                   (m.teacher_id !== 0 && m.teacher_id === Number(teacherId)))
    .sort((a, b) => b.id - a.id)   // ORDER BY id DESC
    .map(util.clone);
}

// studentId / teacherId 传 0 表示这一侧不收
function addMessage(title, body, studentId, teacherId) {
  const data = load();
  data.messages.push({
    id: nextId('messages'),
    title,
    body,
    student_id: Number(studentId) || 0,
    teacher_id: Number(teacherId) || 0,
    created_at: util.nowText()
  });
  save();
  emit('messagesChanged');
}

// ==================== 评价 ====================
// 规则：只有下过单的学生才能评价，一位学生对一位老师只能发一条纯文字评价；
// 老师对每条评价只能回复一次（reply 从空串变有内容即“已回复”）。

function reviewBy(studentId, teacherId) {
  const review = load().reviews.find((r) =>
    r.student_id === Number(studentId) && r.teacher_id === Number(teacherId));
  if (!review || studentId < 0 || teacherId < 0) {
    return { id: -1, studentId: -1, teacherId: -1, studentName: '', content: '', reply: '',
             createdAt: '', repliedAt: '' };
  }
  const student = findStudent(review.student_id);
  return {
    id: review.id,
    studentId: review.student_id,
    teacherId: review.teacher_id,
    studentName: student ? student.name : '',
    content: review.content,
    reply: review.reply,
    createdAt: review.created_at,
    repliedAt: review.replied_at
  };
}

function hasBooked(studentId, teacherId) {
  return load().bookings.some((b) =>
    b.student_id === Number(studentId) && b.teacher_id === Number(teacherId));
}

function canReview(studentId, teacherId) {
  if (studentId < 0 || teacherId < 0) return false;
  if (!hasBooked(studentId, teacherId)) return false;   // 没点过单
  return reviewBy(studentId, teacherId).id < 0;         // 已经评过就不能再评
}

function submitReview(studentId, teacherId, content) {
  const text = util.plain(content);
  if (text === '') return setError('评价内容不能为空。');
  if (!hasBooked(studentId, teacherId)) return setError('预约过这位老师之后才能评价。');
  if (reviewBy(studentId, teacherId).id >= 0) return setError('你已经评价过这位老师了，只能发一次。');

  const data = load();
  data.reviews.push({
    id: nextId('reviews'),
    student_id: Number(studentId),
    teacher_id: Number(teacherId),
    content: text,
    reply: '',
    created_at: util.nowText(),
    replied_at: ''
  });
  save();

  const student = findStudent(studentId);
  addMessage('收到新的评价',
    (student && util.plain(student.name) !== '' ? student.name : session.defaultStudentName()) +
      ' 同学给了你一条评价：' + text,
    0, Number(teacherId));

  emit('reviewsChanged');
  return true;
}

function reviewsForTeacher(teacherId) {
  if (teacherId < 0) return [];
  return load().reviews
    .filter((r) => r.teacher_id === Number(teacherId))
    .sort((a, b) => b.id - a.id)
    .map((r) => {
      const student = findStudent(r.student_id);
      return {
        id: r.id,
        studentId: r.student_id,
        teacherId: r.teacher_id,
        studentName: student ? student.name : '',
        content: r.content,
        reply: r.reply,
        createdAt: r.created_at,
        repliedAt: r.replied_at
      };
    });
}

function reviewCountForTeacher(teacherId) {
  if (teacherId < 0) return 0;
  return load().reviews.filter((r) => r.teacher_id === Number(teacherId)).length;
}

// 老师回复评价：只能回一次，而且只能回给自己的评价
function replyReview(reviewId, teacherId, reply) {
  const text = util.plain(reply);
  if (text === '') return setError('回复内容不能为空。');

  const review = load().reviews.find((r) => r.id === Number(reviewId));
  if (!review) return setError('找不到这条评价。');
  if (review.teacher_id !== Number(teacherId)) return setError('这条评价不是给你的，不能回复。');
  if (util.plain(review.reply) !== '') return setError('这条评价你已经回复过了，只能回一次。');

  review.reply = text;
  review.replied_at = util.nowText();
  save();

  const teacher = findTeacher(teacherId);
  addMessage('老师回复了你的评价', teacher.name + ' 老师回复：' + text, review.student_id, 0);

  emit('reviewsChanged');
  return true;
}

// ==================== 发布单（双边都能发布 / 都能选）====================

function readPost(row) {
  return {
    id: row.id,
    publisherIsTeacher: row.publisher_role === util.ROLE_TEACHER,
    publisherId: row.publisher_id,
    publisherName: row.publisher_name,
    subject: row.subject,
    day: row.day,
    period: row.period,
    timeText: displayTime(row.day, row.period),
    price: row.price,
    area: row.area,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    lat: Number(row.lat) || 0,
    lng: Number(row.lng) || 0,
    distanceKm: distanceOf(row)          // 离我多远（公里），-1 = 没坐标
  };
}

// 别人发的、还在招募中的单；自己发的不需要自己接
function postsForTaking(asTeacher, accountId) {
  if (accountId < 0) return [];
  const myRole = asTeacher ? util.ROLE_TEACHER : util.ROLE_STUDENT;
  startFilter();
  return load().posts
    .filter((p) => p.status === util.POST_OPEN)
    .filter((p) => !(p.publisher_role === myRole && p.publisher_id === Number(accountId)))
    .filter(passNearby)
    .sort((a, b) => {
      if (a.day !== b.day) return a.day < b.day ? -1 : 1;
      return a.id - b.id;
    })
    .map(readPost);
}

function myPosts(asTeacher, accountId) {
  if (accountId < 0) return [];
  const myRole = asTeacher ? util.ROLE_TEACHER : util.ROLE_STUDENT;
  return load().posts
    .filter((p) => p.publisher_role === myRole && p.publisher_id === Number(accountId))
    .sort((a, b) => b.id - a.id)
    .map(readPost);
}

// 小程序特有：访客（还没选身份登录）也能浏览所有「招募中」的单
function allOpenPosts() {
  startFilter();
  return load().posts
    .filter((p) => p.status === util.POST_OPEN)
    .filter(passNearby)
    .sort((a, b) => {
      if (a.day !== b.day) return a.day < b.day ? -1 : 1;
      return a.id - b.id;
    })
    .map(readPost);
}

function createPost(post) {
  if (!post || post.publisherId < 0) return setError('请先登录再发布。');
  if (util.plain(post.subject) === '') return setError('科目不能为空。');
  // 对应 PostDialog：上课时间由发布人自己填（日期+时段合成一句话），不再从时段表里选
  if (util.plain(post.time) === '') return setError('上课时间不能为空。');

  const data = load();
  // 位置坐标：手选了位置就用选的，没选就用自己的当前定位兜底
  const coords = fallbackCoords(post);
  data.posts.push({
    id: nextId('posts'),
    publisher_role: post.publisherIsTeacher ? util.ROLE_TEACHER : util.ROLE_STUDENT,
    publisher_id: Number(post.publisherId),
    publisher_name: util.plain(post.publisherName),
    subject: util.plain(post.subject),
    day: util.plain(post.time),   // 自由文本的时间存在 day 里，period 留空
    period: '',
    price: util.plain(post.price),
    area: util.plain(post.area),
    lat: coords ? coords.lat : 0,
    lng: coords ? coords.lng : 0,
    note: util.plain(post.note),
    status: util.POST_OPEN,
    created_at: util.nowText(),
    taker_role: '',
    taker_id: 0,
    booking_id: 0,
    taken_at: ''
  });
  save();
  emit('postsChanged');
  return true;
}

// 选课 / 接单：双方意愿都齐了，直接生成一条“已确认”的预约，并把帖子标记成已成交
function takePost(postId, asTeacher, accountId) {
  const data = load();
  const row = data.posts.find((p) => p.id === Number(postId));
  if (!row) return setError('找不到这条发布。');

  const post = readPost(row);
  if (post.publisherIsTeacher === asTeacher) return setError('这是你自己发布的，不用自己接。');
  if (post.status !== util.POST_OPEN) return setError('这条发布已经被选走了。');

  const teacherId = post.publisherIsTeacher ? post.publisherId : Number(accountId);
  const studentId = post.publisherIsTeacher ? Number(accountId) : post.publisherId;

  // 时间冲突两个维度都要查（别人的单也不能撞你自己的课）；
  // 时间是自由文本，只能挡「文字一模一样」的
  const when = displayTime(post.day, post.period);
  const active = (b) => b.status !== util.STATUS_CANCELLED && b.status !== util.STATUS_REJECTED;
  const busy = data.bookings.some((b) =>
    displayTime(b.day, b.period) === when && active(b) &&
    (b.teacher_id === teacherId || b.student_id === studentId));
  if (busy) return setError('这个时间已经有课了，换一条吧。');

  // 先抢单：状态已经不是“招募中”说明被别人抢先了
  if (row.status !== util.POST_OPEN) return setError('这条发布已经被选走了。');
  const takenAt = util.nowText();
  row.status = util.POST_TAKEN;
  row.taker_role = asTeacher ? util.ROLE_TEACHER : util.ROLE_STUDENT;
  row.taker_id = Number(accountId);
  row.taken_at = takenAt;

  const teacher = findTeacher(teacherId);
  const student = findStudent(studentId);
  const studentName = !student || util.plain(student.name) === ''
    ? session.defaultStudentName()
    : util.plain(student.name);
  const price = util.plain(post.price) === '' ? util.plain(teacher ? teacher.price : '') : post.price;

  const bookingId = nextId('bookings');
  data.bookings.push({
    id: bookingId,
    teacher_id: teacherId,
    day: post.day,
    period: post.period,
    remark: util.plain(post.note),
    student_name: studentName,
    student_id: studentId,
    price: util.plain(price),
    status: util.STATUS_CONFIRMED,     // 发布=已同意、接单=已同意
    created_at: takenAt
  });
  row.booking_id = bookingId;
  save();

  if (post.publisherIsTeacher) {
    // 学生选了老师发布的课
    addMessage('选课成功',
      '你选了 ' + teacher.name + ' 老师的' + post.subject + '课，时间：' + when + '，已确认。',
      studentId, 0);
    addMessage('有学生选了你的课',
      studentName + ' 同学选了你发布的' + post.subject + '课，时间：' + when + '，已确认。',
      0, teacherId);
  } else {
    // 老师接了学生发布的需求
    addMessage('接单成功',
      '你接了 ' + studentName + ' 同学的' + post.subject + '需求，时间：' + when + '，已确认。',
      0, teacherId);
    addMessage('老师接了你的需求',
      teacher.name + ' 老师接了你的' + post.subject + '需求，时间：' + when + '，已确认。',
      studentId, 0);
  }

  emit('bookingsChanged');
  emit('postsChanged');
  return true;
}

function closePost(postId, asTeacher, accountId) {
  const myRole = asTeacher ? util.ROLE_TEACHER : util.ROLE_STUDENT;
  const row = load().posts.find((p) =>
    p.id === Number(postId) && p.publisher_role === myRole && p.publisher_id === Number(accountId));
  if (!row || row.status !== util.POST_OPEN) {
    return setError('这条发布不能撤销（不是你的，或者已经成交/撤销了）。');
  }
  row.status = util.POST_CLOSED;
  save();
  emit('postsChanged');
  return true;
}

// ==================== 聊天 ====================

// 一段会话由 (student_id, teacher_id) 唯一确定，不建会话表
function chatWith(studentId, teacherId) {
  if (studentId < 0 || teacherId < 0) return [];
  return load().chats
    .filter((c) => c.student_id === Number(studentId) && c.teacher_id === Number(teacherId))
    .sort((a, b) => a.id - b.id)
    .map((c) => ({
      id: c.id,
      senderIsTeacher: c.sender_role === util.ROLE_TEACHER,
      body: c.body,
      createdAt: c.created_at
    }));
}

// 我聊过的人：我 = 老师时对方是学生，反之亦然；未读 = 对方发给我、is_read = 0 的那些
function chatPeers(asTeacher, accountId) {
  if (accountId < 0) return [];
  const mine = load().chats.filter((c) =>
    (asTeacher ? c.teacher_id : c.student_id) === Number(accountId));

  const pairs = [];
  const seen = {};
  mine.forEach((c) => {
    const key = c.student_id + '|' + c.teacher_id;
    if (seen[key]) return;
    seen[key] = true;
    pairs.push({
      peerId: asTeacher ? c.student_id : c.teacher_id,
      studentId: c.student_id,
      teacherId: c.teacher_id,
      lastId: c.id
    });
  });

  const peerSenderRole = asTeacher ? util.ROLE_STUDENT : util.ROLE_TEACHER;
  return pairs
    .map((pair) => {
      const messages = mine.filter((c) =>
        c.student_id === pair.studentId && c.teacher_id === pair.teacherId);
      const last = messages[messages.length - 1];
      const peer = asTeacher ? findStudent(pair.peerId) : findTeacher(pair.peerId);
      const unread = messages.filter((c) =>
        c.sender_role === peerSenderRole && Number(c.is_read) === 0).length;
      return {
        id: pair.peerId,
        name: peer ? peer.name : '',
        lastBody: last.body,
        lastAt: last.created_at,
        unread,
        lastId: last.id
      };
    })
    .sort((a, b) => b.lastId - a.lastId);   // 按最后一条排序
}

function unreadChatCount(asTeacher, accountId) {
  if (accountId < 0) return 0;
  const peerSenderRole = asTeacher ? util.ROLE_STUDENT : util.ROLE_TEACHER;
  return load().chats.filter((c) =>
    (asTeacher ? c.teacher_id : c.student_id) === Number(accountId) &&
    c.sender_role === peerSenderRole && Number(c.is_read) === 0).length;
}

// 某一会话里对方发来、我还没看的条数（聊天页用来判断“要不要标已读”）
function unreadWith(asTeacher, accountId, peerId) {
  if (accountId < 0 || peerId < 0) return 0;
  const peerSenderRole = asTeacher ? util.ROLE_STUDENT : util.ROLE_TEACHER;
  return load().chats.filter((c) =>
    (asTeacher ? c.teacher_id === Number(accountId) && c.student_id === Number(peerId)
               : c.student_id === Number(accountId) && c.teacher_id === Number(peerId)) &&
    c.sender_role === peerSenderRole && Number(c.is_read) === 0).length;
}

// 打开会话就把对方发来的消息标记成已读（红点消失）
function markChatRead(asTeacher, accountId, peerId) {
  if (accountId < 0 || peerId < 0) return;
  const peerSenderRole = asTeacher ? util.ROLE_STUDENT : util.ROLE_TEACHER;
  let changed = false;
  load().chats.forEach((c) => {
    const mine = (asTeacher ? c.teacher_id : c.student_id) === Number(accountId);
    const peer = (asTeacher ? c.student_id : c.teacher_id) === Number(peerId);
    if (mine && peer && c.sender_role === peerSenderRole && Number(c.is_read) === 0) {
      c.is_read = 1;
      changed = true;
    }
  });
  if (changed) {
    save();
    emit('chatsChanged');
  }
}

// asTeacher：我是老师，peerId 是学生；否则我是学生，peerId 是老师
function sendChatMessage(asTeacher, accountId, peerId, body) {
  const text = util.plain(body);
  if (accountId < 0 || peerId < 0) return setError('请先登录再聊天。');
  if (text === '') return setError('消息不能为空。');

  // 注意：老师 id 和学生 id 来自两张表，数值可能一样，不能用 id 相等判断“跟自己聊天”
  const teacherId = asTeacher ? Number(accountId) : Number(peerId);
  const studentId = asTeacher ? Number(peerId) : Number(accountId);

  const data = load();
  data.chats.push({
    id: nextId('chats'),
    student_id: studentId,
    teacher_id: teacherId,
    sender_role: asTeacher ? util.ROLE_TEACHER : util.ROLE_STUDENT,
    body: text,
    is_read: 0,      // 新消息对收件人来说是未读（自己发的自己不用看红点）
    created_at: util.nowText()
  });
  save();
  emit('chatsChanged');
  return true;
}

// ==================== 登录状态 / 自动登录（会话令牌）====================

// 登录成功后调用：库里存令牌摘要，本地缓存存令牌原文
function rememberLogin(studentId, teacherId) {
  if (studentId < 0 && teacherId < 0) return setError('没有登录账号，不能记住登录状态。');

  const asTeacher = studentId < 0;
  const role = asTeacher ? util.ROLE_TEACHER : util.ROLE_STUDENT;
  const accountId = asTeacher ? Number(teacherId) : Number(studentId);
  const data = load();

  // 本地只能存一枚令牌，所以库里也只留最新的一枚：换账号登录就把旧的作废
  data.sessions = [];

  const now = new Date();
  const token = util.newToken();
  const expires = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);   // 有效期三个月
  data.sessions.push({
    token_hash: util.hashPassword(token),
    role,
    account_id: accountId,
    created_at: util.nowText(now),
    expires_at: util.nowText(expires)
  });
  save();

  try {
    wx.setStorageSync('session_token', token);
  } catch (e) {
    return setError('令牌已经生成，但写本地缓存失败，这次不能自动登录。');
  }
  return true;
}

// 启动时调用：有本地令牌且没过期就直接把身份恢复到 Session 里
function restoreLogin() {
  let token = '';
  try {
    token = util.plain(wx.getStorageSync('session_token'));
  } catch (e) {
    token = '';
  }
  if (token === '') return false;

  const hashed = util.hashPassword(token);
  const now = util.nowText();
  const record = load().sessions.find((s) => s.token_hash === hashed && s.expires_at >= now);
  if (!record) {
    // 令牌无效或已过期：本地也清掉，回登录页重新选身份
    wx.removeStorageSync('session_token');
    return false;
  }

  if (record.role === util.ROLE_TEACHER) {
    const teacher = findTeacher(record.account_id);
    if (!teacher) {
      wx.removeStorageSync('session_token');
      return false;
    }
    session.startAsTeacher();
    session.bindTeacher(teacher.id, teacher.name);
  } else {
    const student = findStudent(record.account_id);
    if (!student) {
      wx.removeStorageSync('session_token');
      return false;
    }
    session.startAsStudent();
    session.bindStudent(student.id, student.name);
  }

  // 每次自动登录顺手续期，常用的人不会被踢下线
  const renew = new Date(new Date().getTime() + 90 * 24 * 60 * 60 * 1000);
  record.expires_at = util.nowText(renew);
  save();
  return true;
}

// 退出登录：库里那条令牌删掉，本地也删掉
function forgetLogin() {
  let token = '';
  try {
    token = util.plain(wx.getStorageSync('session_token'));
  } catch (e) {
    token = '';
  }
  const data = load();
  if (token !== '') {
    const hashed = util.hashPassword(token);
    data.sessions = data.sessions.filter((s) => s.token_hash !== hashed);
    save();
  }
  wx.removeStorageSync('session_token');
}

// 测试用：清空整库
function reset() {
  db = emptyDb();
  save();
}

module.exports = {
  // 常量
  statusPending: () => util.STATUS_PENDING,
  statusConfirmed: () => util.STATUS_CONFIRMED,
  statusRejected: () => util.STATUS_REJECTED,
  statusCancelled: () => util.STATUS_CANCELLED,
  postOpen: () => util.POST_OPEN,
  postTaken: () => util.POST_TAKEN,
  postClosed: () => util.POST_CLOSED,
  nearbyDefault: () => util.NEARBY_KM,
  nearbyChoices: () => util.NEARBY_CHOICES.slice(),

  get lastError() { return lastError; },
  set lastError(value) { lastError = value; },
  // 上一次列表筛掉了几条（超出半径被隐藏的），页面拿它给提示
  get lastHidden() { return lastHidden; },

  init, on, off, reset,

  setViewerLocation, viewerLocation, setNearbyKm, nearbyKmValue,
  setShowAll, showAllValue, nearbyActive,

  teachers, subjects, teacherById, addTeacher, saveTeacherProfile,
  loginTeacher, registerTeacher,
  loginStudent, registerStudent, studentProfile, saveStudentProfile,
  displayDay, displayTime,
  bookingsForStudent, bookingsForTeacher, activeBookingCount, totalSpent,
  createBooking, acceptBooking, rejectBooking, cancelBooking,
  messagesFor,
  canReview, submitReview, reviewBy, reviewsForTeacher, reviewCountForTeacher, replyReview,
  postsForTaking, myPosts, createPost, takePost, closePost,
  allOpenPosts,
  chatWith, chatPeers, sendChatMessage, unreadChatCount, unreadWith, markChatRead,
  rememberLogin, restoreLogin, forgetLogin
};
