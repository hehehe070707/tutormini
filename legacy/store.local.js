const util = require('../utils/util.js');
const session = require('../utils/session.js');
const location = require('../utils/location.js');

const DB_KEY = 'tutor_db_v1';
const NEARBY_KEY = 'nearby_km_v1';
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

function emit(eventName) {
  const list = listeners[eventName] || [];
  list.slice().forEach((fn) => {
    try {
      fn();
    } catch (e) {

    }
  });
}

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

let viewer = null;
let nearbyKm = util.NEARBY_KM;
let showAll = false;
let lastHidden = 0;

function loadNearbyKm() {
  let stored = null;
  try {
    stored = wx.getStorageSync(NEARBY_KEY);
  } catch (e) {
    stored = null;
  }

  if (stored === '' || stored === null || stored === undefined) {
    nearbyKm = util.NEARBY_KM;
    return;
  }
  const value = Number(stored);
  nearbyKm = isFinite(value) && value >= 0 ? value : util.NEARBY_KM;
}

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
  try {
    wx.setStorageSync(NEARBY_KEY, nearbyKm);
  } catch (e) {

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

function nearbyActive() {
  return !showAll && nearbyKm > 0 && !!viewer;
}

function distanceOf(row) {
  if (!viewer) return -1;
  return util.distanceKm(viewer.latitude, viewer.longitude, row && row.lat, row && row.lng);
}

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

function byNearest(a, b) {
  const ka = a.distanceKm >= 0 ? a.distanceKm : Infinity;
  const kb = b.distanceKm >= 0 ? b.distanceKm : Infinity;
  if (ka !== kb) return ka - kb;
  return a.id - b.id;
}

function fallbackCoords(source) {
  if (source && util.hasCoords(source.lat, source.lng)) {
    return { lat: Number(source.lat), lng: Number(source.lng) };
  }
  const here = location.current();
  if (here) return { lat: here.latitude, lng: here.longitude };
  return null;
}

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

function seedIfEmpty() {
  const data = load();
  if (data.teachers.length > 0) return;
  addTeacher('王数学', '数学', '99 元/小时');
  addTeacher('李英语', '英语', '88 元/小时');
  addTeacher('张物理', '物理', '77 元/小时');
}

function teachers(subject, keyword) {
  const data = load();
  const picked = util.plain(subject);
  const filterSubject = picked !== '' && picked !== '全部';
  const key = util.plain(keyword).toLowerCase();

  startFilter();
  return data.teachers
    .filter((t) => util.plain(t.subject) !== '')
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
  copy.distanceKm = distanceOf(teacher);
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
    lat: 0,
    lng: 0,
    password: util.hashPassword(util.DEFAULT_PASSWORD)
  });
  save();
  emit('teachersChanged');
  return true;
}

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
    subject: '',
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

    target.name = name;
    target.school = util.plain(student.school);
    target.grade = util.plain(student.grade);
    target.phone = util.plain(student.phone);
  }
  save();
  emit('studentsChanged');
  return true;
}

function displayDay(dayIso) {
  return util.displayDay(dayIso);
}

function displayTime(dayIso, period) {
  return util.displayTime(dayIso, period);
}

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

function bookingWeight(status) {
  if (status === util.STATUS_PENDING) return 0;
  if (status === util.STATUS_CONFIRMED) return 1;
  return 2;
}

function sortBookings(list) {
  return list.sort((a, b) => {
    const diff = bookingWeight(a.status) - bookingWeight(b.status);
    if (diff !== 0) return diff;

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

function totalSpent(studentId) {
  let total = 0;
  bookingsForStudent(studentId).forEach((booking) => {
    if (booking.status === util.STATUS_CANCELLED || booking.status === util.STATUS_REJECTED) return;
    total += util.priceValue(booking.price);
  });
  return total;
}

function createBooking(teacherId, studentId, time, remark) {
  if (teacherId < 0 || studentId < 0) return setError('请先登录后再预约。');
  const when = util.plain(time);
  if (when === '') return setError('请先填写上课时间。');

  const data = load();
  const active = (b) => b.status !== util.STATUS_CANCELLED && b.status !== util.STATUS_REJECTED;

  const teacherBusy = data.bookings.some((b) =>
    b.teacher_id === Number(teacherId) && displayTime(b.day, b.period) === when && active(b));
  if (teacherBusy) return setError('这个时间已经被预约了，换一个吧。');

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
    price: util.plain(teacher ? teacher.price : ''),
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

function messagesFor(studentId, teacherId) {
  return load().messages
    .filter((m) => (m.student_id !== 0 && m.student_id === Number(studentId)) ||
                   (m.teacher_id !== 0 && m.teacher_id === Number(teacherId)))
    .sort((a, b) => b.id - a.id)
    .map(util.clone);
}

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
  if (!hasBooked(studentId, teacherId)) return false;
  return reviewBy(studentId, teacherId).id < 0;
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
    distanceKm: distanceOf(row)
  };
}

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

  if (util.plain(post.time) === '') return setError('上课时间不能为空。');

  const data = load();

  const coords = fallbackCoords(post);
  data.posts.push({
    id: nextId('posts'),
    publisher_role: post.publisherIsTeacher ? util.ROLE_TEACHER : util.ROLE_STUDENT,
    publisher_id: Number(post.publisherId),
    publisher_name: util.plain(post.publisherName),
    subject: util.plain(post.subject),
    day: util.plain(post.time),
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

function takePost(postId, asTeacher, accountId) {
  const data = load();
  const row = data.posts.find((p) => p.id === Number(postId));
  if (!row) return setError('找不到这条发布。');

  const post = readPost(row);
  if (post.publisherIsTeacher === asTeacher) return setError('这是你自己发布的，不用自己接。');
  if (post.status !== util.POST_OPEN) return setError('这条发布已经被选走了。');

  const teacherId = post.publisherIsTeacher ? post.publisherId : Number(accountId);
  const studentId = post.publisherIsTeacher ? Number(accountId) : post.publisherId;

  const when = displayTime(post.day, post.period);
  const active = (b) => b.status !== util.STATUS_CANCELLED && b.status !== util.STATUS_REJECTED;
  const busy = data.bookings.some((b) =>
    displayTime(b.day, b.period) === when && active(b) &&
    (b.teacher_id === teacherId || b.student_id === studentId));
  if (busy) return setError('这个时间已经有课了，换一条吧。');

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
    status: util.STATUS_CONFIRMED,
    created_at: takenAt
  });
  row.booking_id = bookingId;
  save();

  if (post.publisherIsTeacher) {

    addMessage('选课成功',
      '你选了 ' + teacher.name + ' 老师的' + post.subject + '课，时间：' + when + '，已确认。',
      studentId, 0);
    addMessage('有学生选了你的课',
      studentName + ' 同学选了你发布的' + post.subject + '课，时间：' + when + '，已确认。',
      0, teacherId);
  } else {

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
    .sort((a, b) => b.lastId - a.lastId);
}

function unreadChatCount(asTeacher, accountId) {
  if (accountId < 0) return 0;
  const peerSenderRole = asTeacher ? util.ROLE_STUDENT : util.ROLE_TEACHER;
  return load().chats.filter((c) =>
    (asTeacher ? c.teacher_id : c.student_id) === Number(accountId) &&
    c.sender_role === peerSenderRole && Number(c.is_read) === 0).length;
}

function unreadWith(asTeacher, accountId, peerId) {
  if (accountId < 0 || peerId < 0) return 0;
  const peerSenderRole = asTeacher ? util.ROLE_STUDENT : util.ROLE_TEACHER;
  return load().chats.filter((c) =>
    (asTeacher ? c.teacher_id === Number(accountId) && c.student_id === Number(peerId)
               : c.student_id === Number(accountId) && c.teacher_id === Number(peerId)) &&
    c.sender_role === peerSenderRole && Number(c.is_read) === 0).length;
}

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

function sendChatMessage(asTeacher, accountId, peerId, body) {
  const text = util.plain(body);
  if (accountId < 0 || peerId < 0) return setError('请先登录再聊天。');
  if (text === '') return setError('消息不能为空。');

  const teacherId = asTeacher ? Number(accountId) : Number(peerId);
  const studentId = asTeacher ? Number(peerId) : Number(accountId);

  const data = load();
  data.chats.push({
    id: nextId('chats'),
    student_id: studentId,
    teacher_id: teacherId,
    sender_role: asTeacher ? util.ROLE_TEACHER : util.ROLE_STUDENT,
    body: text,
    is_read: 0,
    created_at: util.nowText()
  });
  save();
  emit('chatsChanged');
  return true;
}

function rememberLogin(studentId, teacherId) {
  if (studentId < 0 && teacherId < 0) return setError('没有登录账号，不能记住登录状态。');

  const asTeacher = studentId < 0;
  const role = asTeacher ? util.ROLE_TEACHER : util.ROLE_STUDENT;
  const accountId = asTeacher ? Number(teacherId) : Number(studentId);
  const data = load();

  data.sessions = [];

  const now = new Date();
  const token = util.newToken();
  const expires = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
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

  const renew = new Date(new Date().getTime() + 90 * 24 * 60 * 60 * 1000);
  record.expires_at = util.nowText(renew);
  save();
  return true;
}

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

function reset() {
  db = emptyDb();
  save();
}

module.exports = {

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
