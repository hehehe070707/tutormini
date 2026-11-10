/*
 * 账号域：学生 / 老师的注册登录、资料读写、会话令牌、微信 openid 绑定。
 * 对应 Qt 版 DatabaseManager 里的 loginTeacher / registerTeacher / loginStudent /
 * registerStudent / saveTeacherProfile / saveStudentProfile / rememberLogin / restoreLogin 等。
 *
 * 这里是「唯一真实数据源」：小程序端不再存任何用户资料，只留一枚 token。
 */

const util = require('../lib/util.js');
const { ApiError } = require('../lib/errors.js');
const nearby = require('./nearby.js');

// ==================== 会话令牌 ====================

function expiryText(days) {
  return util.nowText(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
}

/*
 * 登录成功后签发令牌（对应 DatabaseManager::rememberLogin）：
 * 库里只存 SHA-256 摘要，原文只返回给这一台设备；多设备登录互不影响（各自一枚）。
 */
async function issueToken(db, role, accountId, tokenDays) {
  const token = util.newToken();
  const now = util.nowText();
  await db.run('DELETE FROM sessions WHERE expires_at < ?', [now]);   // 顺手清理过期令牌
  await db.run(
    `INSERT INTO sessions (token_hash, role, account_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [util.sha256(token), role, Number(accountId), now, expiryText(tokenDays)]
  );
  return token;
}

// 校验令牌 → { role, accountId, sessionId }；无效或过期返回 null
async function resolveSession(db, token) {
  const text = util.plain(token);
  if (text === '') return null;
  const row = await db.get('SELECT * FROM sessions WHERE token_hash = ?', [util.sha256(text)]);
  if (!row) return null;
  if (String(row.expires_at) < util.nowText()) {
    await db.run('DELETE FROM sessions WHERE id = ?', [row.id]);
    return null;
  }
  return { role: row.role, accountId: Number(row.account_id), sessionId: Number(row.id) };
}

// 常用的人顺手续期，别被踢下线（对应小程序端 restoreLogin 的续期）
async function renewSession(db, sessionId, tokenDays) {
  await db.run('UPDATE sessions SET expires_at = ? WHERE id = ?', [expiryText(tokenDays), Number(sessionId)]);
}

// 退出登录：只作废当前这一枚令牌，别的设备照样在线
async function revokeToken(db, token) {
  const text = util.plain(token);
  if (text === '') return;
  await db.run('DELETE FROM sessions WHERE token_hash = ?', [util.sha256(text)]);
}

// 令牌对应的身份资料；账号被删了就返回 null
async function profileOf(db, role, accountId) {
  if (role === util.ROLE_TEACHER) {
    const teacher = await db.get('SELECT id, name FROM teachers WHERE id = ?', [Number(accountId)]);
    if (!teacher) return null;
    return {
      role: util.ROLE_TEACHER,
      accountId: Number(teacher.id),
      name: teacher.name,
      hasTeacherProfile: true
    };
  }
  const student = await db.get('SELECT id, name FROM students WHERE id = ?', [Number(accountId)]);
  if (!student) return null;
  return {
    role: util.ROLE_STUDENT,
    accountId: Number(student.id),
    name: student.name,
    hasTeacherProfile: false
  };
}

// ==================== 微信 openid 绑定（对应 wx.login → code2session）====================

async function findBinding(db, openid) {
  const text = util.plain(openid);
  if (text === '') return null;
  const row = await db.get('SELECT * FROM wx_bindings WHERE openid = ?', [text]);
  if (!row) return null;
  return { openid: row.openid, role: row.role, accountId: Number(row.account_id) };
}

// 绑定/改绑：同一个微信号换身份登录时覆盖旧绑定
async function bindOpenid(db, openid, role, accountId) {
  const text = util.plain(openid);
  if (text === '') return;
  const now = util.nowText();
  const existing = await db.get('SELECT openid FROM wx_bindings WHERE openid = ?', [text]);
  if (existing) {
    await db.run(
      'UPDATE wx_bindings SET role = ?, account_id = ?, created_at = ? WHERE openid = ?',
      [role, Number(accountId), now, text]
    );
    return;
  }
  await db.run(
    'INSERT INTO wx_bindings (openid, role, account_id, created_at) VALUES (?, ?, ?, ?)',
    [text, role, Number(accountId), now]
  );
}

// ==================== 老师 ====================

function readTeacher(row) {
  return {
    id: Number(row.id),
    name: row.name,
    subject: row.subject,
    price: row.price,
    intro: row.intro || '',
    rating: Number(row.rating) || 5,
    // 简历页（「我的简历」）的字段，对应小程序 pages/teacherResume
    education: row.education || '',
    school: row.school || '',
    years: row.years || '',
    certificate: row.certificate || '',
    times: row.times || '',
    gender: row.gender || '',      // 老师自己的性别：单子指定性别要求时用来判断
    area: row.area || '',
    lat: Number(row.lat) || 0,
    lng: Number(row.lng) || 0
  };
}

// 对应 DatabaseManager::loginTeacher：姓名 + 密码，重名不要紧，用密码区分
async function loginTeacher(db, name, password) {
  const teacherName = util.plain(name);
  if (teacherName === '' || util.plain(password) === '') {
    throw new ApiError('姓名和密码都要填。');
  }
  const row = await db.get(
    'SELECT * FROM teachers WHERE name = ? AND password = ?',
    [teacherName, util.hashPassword(password)]
  );
  if (!row) throw new ApiError('姓名或密码不对。新老师请点【注册新老师】。');
  return Number(row.id);
}

// 对应 registerTeacher：同名同密码已经存在时直接返回那条记录，避免反复注册出多条
async function registerTeacher(db, name, password) {
  const teacherName = util.plain(name);
  if (teacherName === '' || util.plain(password) === '') {
    throw new ApiError('姓名和密码都要填。');
  }
  const hashed = util.hashPassword(password);
  const existing = await db.get(
    'SELECT id FROM teachers WHERE name = ? AND password = ?',
    [teacherName, hashed]
  );
  if (existing) return Number(existing.id);

  const result = await db.run(
    `INSERT INTO teachers (name, password, subject, price, intro, rating, area, lat, lng, created_at)
     VALUES (?, ?, '', '', '', 5, '', 0, 0, ?)`,
    [teacherName, hashed, util.nowText()]
  );
  return result.lastId;
}

// 对应 teacherById：找不到返回一条空资料（id = -1）
async function teacherById(db, id, viewer) {
  const row = await db.get('SELECT * FROM teachers WHERE id = ?', [Number(id)]);
  if (!row) {
    return {
      id: -1, name: '', subject: '', price: '', intro: '', rating: 5,
      education: '', school: '', years: '', certificate: '', times: '',
      area: '', lat: 0, lng: 0, distanceKm: -1
    };
  }
  const teacher = readTeacher(row);
  teacher.distanceKm = nearby.distanceOf(viewer, row);
  return teacher;
}

/*
 * 对应 DatabaseManager::teachers：科目 + 关键词（姓名/科目/位置）叠加筛选，
 * 再叠加一层"只看附近"（后端按半径过滤，近的排前面）。
 */
async function listTeachers(db, options) {
  const opts = options || {};
  const rows = await db.all('SELECT * FROM teachers ORDER BY id');
  const picked = util.plain(opts.subject);
  const filterSubject = picked !== '' && picked !== '全部';
  const key = util.plain(opts.keyword).toLowerCase();
  const viewer = opts.viewer;

  const withDistance = rows
    .filter((row) => util.plain(row.subject) !== '')     // 资料没填完的老师先不上架
    .filter((row) => !filterSubject || row.subject === picked)
    .filter((row) => {
      if (key === '') return true;
      const name = util.plain(row.name).toLowerCase();
      const subject = util.plain(row.subject).toLowerCase();
      const area = util.plain(row.area).toLowerCase();
      return name.indexOf(key) >= 0 || subject.indexOf(key) >= 0 || area.indexOf(key) >= 0;
    })
    .map((row) => {
      const teacher = readTeacher(row);
      teacher.distanceKm = nearby.distanceOf(viewer, row);
      return teacher;
    });

  const result = nearby.split(viewer, withDistance);
  result.list.sort(nearby.byNearest);
  return result;
}

// 库里已有的科目（给筛选下拉用）
async function listSubjects(db) {
  const rows = await db.all('SELECT subject FROM teachers');
  const set = [];
  rows.forEach((row) => {
    const subject = util.plain(row.subject);
    if (subject !== '' && set.indexOf(subject) < 0) set.push(subject);
  });
  return set.sort();
}

/*
 * 对应 saveTeacherProfile：teacherId < 0 时新建一条，返回老师 id。
 * 位置坐标：手选了位置就用选的；没选就用自己的当前定位兜底（viewer）。
 * 这次没带坐标就保留原来的，别把老坐标冲掉。
 */
async function saveTeacherProfile(db, teacherId, teacher, viewer) {
  const payload = teacher || {};
  const name = util.plain(payload.name);
  if (name === '') throw new ApiError('姓名不能为空。');

  const subject = util.plain(payload.subject);
  const intro = util.plain(payload.intro) === ''
    ? name + '老师，擅长' + subject + '辅导，' + util.DEFAULT_INTRO
    : util.plain(payload.intro);

  const picked = util.hasCoords(payload.lat, payload.lng)
    ? { lat: Number(payload.lat), lng: Number(payload.lng) } : null;
  const fallback = viewer && util.hasCoords(viewer.lat, viewer.lng)
    ? { lat: Number(viewer.lat), lng: Number(viewer.lng) } : null;
  const coords = picked || fallback;

  if (Number(teacherId) < 0) {
    const result = await db.run(
      `INSERT INTO teachers (name, password, subject, price, intro, rating, area, lat, lng, gender, created_at)
       VALUES (?, ?, ?, ?, ?, 5, ?, ?, ?, ?, ?)`,
      [
        name,
        util.hashPassword(util.DEFAULT_PASSWORD),
        subject,
        util.plain(payload.price),
        intro,
        util.plain(payload.area),
        coords ? coords.lat : 0,
        coords ? coords.lng : 0,
        util.plain(payload.gender),
        util.nowText()
      ]
    );
    return result.lastId;
  }

  const target = await db.get('SELECT * FROM teachers WHERE id = ?', [Number(teacherId)]);
  if (!target) throw new ApiError('找不到这位老师的资料。');

  let lat = Number(target.lat) || 0;
  let lng = Number(target.lng) || 0;
  if (picked) {
    lat = picked.lat;
    lng = picked.lng;
  } else if (!util.hasCoords(lat, lng) && fallback) {
    lat = fallback.lat;
    lng = fallback.lng;
  }

  // 性别：这次没带这个字段就保留原来的（别让别的保存路径把性别冲掉）
  const nextGender = payload.gender === undefined
    ? util.plain(target.gender)
    : util.plain(payload.gender);

  await db.run(
    `UPDATE teachers SET name = ?, subject = ?, price = ?, intro = ?, area = ?, lat = ?, lng = ?, gender = ?
     WHERE id = ?`,
    [name, subject, util.plain(payload.price), intro, util.plain(payload.area), lat, lng,
      nextGender, Number(teacherId)]
  );
  return Number(teacherId);
}

/*
 * 「我的简历」页保存（对应 pages/teacherResume）：
 * 只更新简历那几列（学历 / 学校 / 教龄 / 证书 / 可教科目 / 价格 / 可教时段 / 自我介绍），
 * 不碰位置和坐标（那些还是「我的」页管），免得这边保存把定位冲掉。
 */
async function saveTeacherResume(db, teacherId, resume) {
  const id = Number(teacherId);
  const target = await db.get('SELECT id FROM teachers WHERE id = ?', [id]);
  if (!target) throw new ApiError('找不到这位老师的资料。');
  const payload = resume || {};
  await db.run(
    `UPDATE teachers SET education = ?, school = ?, years = ?, certificate = ?, subject = ?,
                         price = ?, times = ?, intro = ?
     WHERE id = ?`,
    [
      util.plain(payload.education),
      util.plain(payload.school),
      util.plain(payload.years),
      util.plain(payload.certificate),
      util.plain(payload.subject),
      util.plain(payload.price),
      util.plain(payload.times),
      util.plain(payload.intro),
      id
    ]
  );
  return id;
}

// ==================== 学生 ====================

async function loginStudent(db, name, password) {
  const studentName = util.plain(name);
  if (studentName === '' || util.plain(password) === '') {
    throw new ApiError('姓名和密码都要填。');
  }
  const row = await db.get(
    'SELECT * FROM students WHERE name = ? AND password = ?',
    [studentName, util.hashPassword(password)]
  );
  if (!row) throw new ApiError('姓名或密码不对。还没有账号请点【注册新学生】。');
  return Number(row.id);
}

async function registerStudent(db, name, password) {
  const studentName = util.plain(name);
  if (studentName === '' || util.plain(password) === '') {
    throw new ApiError('姓名和密码都要填。');
  }
  const hashed = util.hashPassword(password);
  const existing = await db.get(
    'SELECT id FROM students WHERE name = ? AND password = ?',
    [studentName, hashed]
  );
  if (existing) return Number(existing.id);

  const result = await db.run(
    `INSERT INTO students (name, password, school, grade, phone, created_at)
     VALUES (?, ?, '', '', '', ?)`,
    [studentName, hashed, util.nowText()]
  );
  return result.lastId;
}

async function studentProfile(db, studentId) {
  const id = Number(studentId);
  if (!(id >= 0)) return { id: -1, name: '', school: '', grade: '', phone: '' };
  const row = await db.get('SELECT * FROM students WHERE id = ?', [id]);
  if (!row) return { id: -1, name: '', school: '', grade: '', phone: '' };
  return { id: Number(row.id), name: row.name, school: row.school || '', grade: row.grade || '', phone: row.phone || '' };
}

// 对应 saveStudentProfile：只改资料，不动密码
async function saveStudentProfile(db, student) {
  const payload = student || {};
  const name = util.plain(payload.name);
  if (name === '') throw new ApiError('姓名不能为空。');

  const id = Number(payload.id);
  if (!(id >= 0)) {
    const result = await db.run(
      `INSERT INTO students (name, password, school, grade, phone, created_at)
       VALUES (?, '', ?, ?, ?, ?)`,
      [name, util.plain(payload.school), util.plain(payload.grade), util.plain(payload.phone), util.nowText()]
    );
    return result.lastId;
  }

  const target = await db.get('SELECT id FROM students WHERE id = ?', [id]);
  if (!target) throw new ApiError('找不到这位学生的资料。');
  await db.run(
    'UPDATE students SET name = ?, school = ?, grade = ?, phone = ? WHERE id = ?',
    [name, util.plain(payload.school), util.plain(payload.grade), util.plain(payload.phone), id]
  );
  return id;
}

// 还没填资料时用默认名，保证下单不会写空（对应 Session::defaultStudentName）
async function studentName(db, studentId) {
  const profile = await studentProfile(db, studentId);
  return util.plain(profile.name) === '' ? util.DEFAULT_STUDENT_NAME : profile.name;
}

module.exports = {
  issueToken,
  resolveSession,
  renewSession,
  revokeToken,
  profileOf,
  findBinding,
  bindOpenid,
  readTeacher,
  loginTeacher,
  registerTeacher,
  teacherById,
  listTeachers,
  listSubjects,
  saveTeacherProfile,
  saveTeacherResume,
  loginStudent,
  registerStudent,
  studentProfile,
  saveStudentProfile,
  studentName
};
