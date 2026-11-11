const api = require('./api.js');
const util = require('./util.js');
const session = require('./session.js');
const location = require('./location.js');

let lastError = '';
let lastHidden = 0;

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

    }
  });
}

function setError(message) {
  lastError = message;
  return false;
}

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

let viewer = null;
let nearbyKm = util.NEARBY_KM;
let showAll = false;

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

function nearbyActive() {
  return !showAll && nearbyKm > 0 && !!viewer;
}

function viewQuery() {
  const query = { km: nearbyKm, all: showAll ? 1 : 0 };
  if (viewer) {
    query.lat = viewer.latitude;
    query.lng = viewer.longitude;
  }
  return query;
}

function viewerFields() {
  const here = location.current();
  return here ? { viewerLat: here.latitude, viewerLng: here.longitude } : {};
}

async function init() {
  lastError = '';
  try {
    await api.get('/health', undefined, true);
    return '';
  } catch (e) {
    lastError = e.message;
    return e.message;
  }
}

async function restoreLogin() {
  if (api.token() !== '') {
    try {
      const data = await api.get('/auth/me');
      session.applyProfile(data.profile);
      return true;
    } catch (e) {

    }
  }
  if (api.token() !== '') return false;
  return wxAutoLogin();
}

async function wxAutoLogin() {
  const code = await wxLoginCode();
  if (code === '') return false;
  try {
    const data = await api.post('/auth/wx-login', { code });
    if (!data || !data.token) return false;
    api.setToken(data.token);
    session.applyProfile(data.profile);
    return true;
  } catch (e) {
    return false;
  }
}

async function loginAs(role, name, password, register) {
  lastError = '';
  try {

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

async function forgetLogin() {
  try {
    await api.post('/auth/logout', {});
  } catch (e) {

  }
  api.clearToken();
  session.logout();
  return true;
}

async function teachers(subject, keyword) {
  const data = await read(api.get('/teachers', Object.assign({
    subject: util.plain(subject),
    keyword: util.plain(keyword)
  }, viewQuery())), { list: [], hidden: 0 });
  lastHidden = Number(data.hidden) || 0;
  return data.list || [];
}

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

async function saveTeacherProfile(teacherId, teacher) {
  lastError = '';
  if (!session.isTeacher()) return setError('这个操作需要老师账号。');
  try {
    const data = await api.put('/teachers/me', Object.assign({
      name: util.plain(teacher && teacher.name),

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

async function dashboard() {
  const data = await read(api.get('/me'), { role: 'none' });
  return data || { role: 'none' };
}

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

async function handleBooking(bookingId, accept, extra) {
  lastError = '';
  try {
    await api.post('/bookings/' + Number(bookingId) + (accept ? '/accept' : '/reject'),
      accept ? (extra || {}) : {});
    emit('bookingsChanged');
    emit('postsChanged');
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

async function cancelBooking(bookingId) {
  lastError = '';
  try {
    await api.post('/bookings/' + Number(bookingId) + '/cancel', {});
    emit('bookingsChanged');
    emit('postsChanged');
    return true;
  } catch (e) {
    return setError(e.message);
  }
}

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

async function allOpenPosts() {
  const data = await read(api.get('/posts/open', viewQuery()), { list: [], hidden: 0 });
  lastHidden = Number(data.hidden) || 0;
  return data.list || [];
}

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

      rawText: util.plain(post && post.rawText)
    }, viewerFields()));
    emit('postsChanged');
    return Number(data.id);
  } catch (e) {
    return setError(e.message);
  }
}

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

async function myAgents() {
  const data = await read(api.get('/agents/mine'), { list: [] });
  return data.list || [];
}

let unreadMemo = { at: 0, value: 0 };
let unreadLoading = null;

let todoPostsMemo = 0;

function setUnreadCount(value) {
  unreadMemo = { at: Date.now(), value: Math.max(0, Number(value) || 0) };
  emit('unreadChanged');
  return unreadMemo.value;
}

function bumpUnread(removed) {
  const count = Math.max(0, Number(removed) || 0);
  unreadMemo = { at: 0, value: Math.max(0, unreadMemo.value - count) };
  emit('unreadChanged');
}

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

function todoPostCountCached() {
  return todoPostsMemo;
}

async function unreadChatCount() {

  if (!session.isLoggedIn()) {
    if (unreadMemo.value !== 0) setUnreadCount(0);
    if (todoPostsMemo !== 0) setTodoPosts(0);
    return 0;
  }
  if (unreadMemo.at && Date.now() - unreadMemo.at < 3000) return unreadMemo.value;
  if (unreadLoading) return unreadLoading;
  unreadLoading = (async () => {
    try {

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

async function messageBoxes() {
  if (!session.isLoggedIn()) return [];
  const data = await read(api.get('/messages/boxes'), { list: [] });
  return data.list || [];
}

async function messageThread(postId) {
  if (!session.isLoggedIn() || !(Number(postId) > 0)) return { post: null, list: [] };
  const data = await read(api.get('/messages/boxes/' + Number(postId)), { post: null, list: [] });
  return { post: data.post || null, list: data.list || [] };
}

const HIDDEN_BOXES_KEY = 'tutor_hidden_boxes_v1';

const DELIVERED_KEY = 'tutor_delivered_v1';

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

function saveHiddenBoxes(map) {
  const clean = {};
  Object.keys(map && typeof map === 'object' ? map : {}).forEach((key) => {
    const postId = Number(key);
    if (postId > 0) clean[String(postId)] = Number(map[key]) || 0;
  });
  return saveLocalMap(HIDDEN_BOXES_KEY, clean);
}

function deliveredMap() {
  return localMap(DELIVERED_KEY);
}

function saveDeliveredMap(map) {
  return saveLocalMap(DELIVERED_KEY, map);
}

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

async function corrections(target, targetId) {
  const data = await read(api.get('/corrections', {
    target: util.plain(target),
    targetId: Number(targetId) || 0,
    limit: 5
  }), { list: [] });
  return data.list || [];
}

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
