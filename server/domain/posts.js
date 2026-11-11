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

    publisherName: util.PLATFORM_NAME,
    subject: row.subject,
    grade: row.grade || '',
    gender: row.gender || '',
    day: row.day,
    period: row.period || '',
    timeText: util.displayTime(row.day, row.period),
    price: row.price,
    area: row.area || '',
    note: row.note || '',
    status: row.status,
    source: row.source || util.SOURCE_MANUAL,
    batchId: row.batch_id || '',

    requirements: util.parseRequirements(row.requirements),

    rawText: row.raw_text || '',
    bookingId: Number(row.booking_id) || 0,
    invites: [],
    createdAt: row.created_at,
    lat,
    lng,
    distanceKm: viewer ? nearby.distanceOf(viewer, { lat, lng }) : -1
  };
}

function dayTexts(date) {
  const d = date || new Date();
  const mm = d.getMonth() + 1 < 10 ? '0' + (d.getMonth() + 1) : '' + (d.getMonth() + 1);
  const dd = d.getDate() < 10 ? '0' + d.getDate() : '' + d.getDate();
  return {
    code: '' + d.getFullYear() + mm + dd,
    iso: d.getFullYear() + '-' + mm + '-' + dd
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

function hourlyOf(post) {
  const price = util.requirementPrice(post && post.requirements);
  return price.min > 0 ? price.min : util.priceValue(post && post.price);
}

async function agentMapOfStudents(db) {
  const rows = await db.all('SELECT id, owner_student_id FROM agents ORDER BY id');
  const map = {};
  rows.forEach((row) => {
    const sid = Number(row.owner_student_id);
    if (!map[sid]) map[sid] = Number(row.id);
  });
  return map;
}

async function postsForTaking(db, asTeacher, accountId, viewer, filters) {
  const id = Number(accountId);
  if (!(id >= 0)) return { list: [], hidden: 0 };
  const myRole = asTeacher ? util.ROLE_TEACHER : util.ROLE_STUDENT;

  const agentMap = await agentMapOfStudents(db);

  const me = asTeacher ? await db.get('SELECT * FROM teachers WHERE id = ?', [id]) : null;

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

  const wantGrade = util.plain(f.grade);
  const wantSubject = util.plain(f.subject);
  const wantTime = util.plain(f.time);

  const wantGender = util.toList(f.gender);
  const wantEducation = util.toList(f.education);
  const wantYears = util.toList(f.minYears).map(util.toInt).filter((v) => v > 0);
  const wantCertificate = util.toList(f.certificate);
  const wantTeachMode = util.toList(f.teachMode);

  const myGender = util.plain(f.myGender);
  const myEducation = util.toList(f.myEducation);
  const myYears = util.toList(f.myYears).map(util.toInt).filter((v) => v > 0);
  const myCertificate = util.toList(f.myCertificate);
  const myTeachMode = util.toList(f.myTeachMode);
  const minPrice = Number(f.minPrice) || 0;
  const maxPrice = Number(f.maxPrice) || 0;
  const onlyMatch = f.onlyMatch === true || f.onlyMatch === 1 ||
    f.onlyMatch === '1' || f.onlyMatch === 'true';
  const explicit = (list) => util.toList(list).some((value) => value !== util.REQ_UNLIMITED);
  const filtered = wantGrade !== '' || wantSubject !== '' || wantTime !== '' ||
    [wantGender, wantEducation, wantYears, wantCertificate, wantTeachMode].some(explicit) ||
    myGender !== '' ||
    [myEducation, myYears, myCertificate, myTeachMode].some((list) => util.toList(list).length > 0) ||
    minPrice > 0 || maxPrice > 0;

  const requirementById = {};
  rows.forEach((row) => { requirementById[Number(row.id)] = util.parseRequirements(row.requirements); });
  const requirementsOf = (row) =>
    requirementById[Number(row.id)] || util.parseRequirements(row.requirements);

  const genderNeedOf = (row) => {
    const req = requirementsOf(row);
    return util.hasRequirement(req, 'gender') ? req.gender : util.plain(row.gender);
  };

  const myEducationRank = myEducation.length > 0
    ? Math.max.apply(null, myEducation.map(util.educationRank)) : -1;
  const myYearsValue = myYears.length > 0 ? Math.max.apply(null, myYears) : 0;

  const passMine = (row) => {
    const req = requirementsOf(row);

    if (myGender !== '') {
      const need = genderNeedOf(row);
      if (need !== '' && need !== util.REQ_UNLIMITED && need !== myGender) return false;
    }

    if (myEducationRank >= 0 && util.hasRequirement(req, 'education')) {
      const need = util.educationRank(req.education);
      if (need >= 0 && need > myEducationRank) return false;
    }

    if (myYearsValue > 0 && util.hasRequirement(req, 'minYears')) {
      if (util.requirementYears(req) > myYearsValue) return false;
    }

    if (myCertificate.length > 0 && util.hasRequirement(req, 'certificate') &&
        myCertificate.indexOf(req.certificate) < 0) return false;
    if (myTeachMode.length > 0 && util.hasRequirement(req, 'teachMode') &&
        myTeachMode.indexOf(req.teachMode) < 0) return false;
    return true;
  };

  const priceNeedOf = (row) => {
    const price = util.requirementPrice(requirementsOf(row));
    return price.min > 0 ? price.min : util.priceValue(row.price);
  };
  const priceMaxOf = (row) => {
    const price = util.requirementPrice(requirementsOf(row));
    return price.max > 0 ? price.max : util.priceValue(row.price);
  };

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

    .filter((row) => {
      if (!explicit(wantGender)) return true;
      const need = genderNeedOf(row);
      return need === '' || need === util.REQ_UNLIMITED || wantGender.indexOf(need) >= 0;
    })

    .filter((row) => {
      if (!explicit(wantEducation)) return true;
      const req = requirementsOf(row);
      if (!util.hasRequirement(req, 'education')) return true;
      return wantEducation.indexOf(req.education) >= 0;
    })

    .filter((row) => {
      if (wantYears.length === 0) return true;
      const req = requirementsOf(row);
      if (!util.hasRequirement(req, 'minYears')) return true;
      return wantYears.indexOf(util.requirementYears(req)) >= 0;
    })

    .filter((row) => {
      if (!explicit(wantCertificate)) return true;
      const req = requirementsOf(row);
      if (!util.hasRequirement(req, 'certificate')) return true;
      return wantCertificate.indexOf(req.certificate) >= 0;
    })

    .filter((row) => {
      if (!explicit(wantTeachMode)) return true;
      const req = requirementsOf(row);
      if (!util.hasRequirement(req, 'teachMode')) return true;
      return wantTeachMode.indexOf(req.teachMode) >= 0;
    })

    .filter((row) => passMine(row))

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
    if (la !== lb) return lb - la;
    const sa = Number(a.matchScore) || 0;
    const sb = Number(b.matchScore) || 0;
    if (sa !== sb) return sb - sa;
    const ka = a.distanceKm >= 0 ? a.distanceKm : Infinity;
    const kb = b.distanceKm >= 0 ? b.distanceKm : Infinity;
    if (ka !== kb) return ka - kb;
    if (!!a.timeConflict !== !!b.timeConflict) return a.timeConflict ? 1 : -1;
    if (filtered) {
      const pa = hourlyOf(a);
      const pb = hourlyOf(b);
      if (pa !== pb) return pb - pa;
    }
    return a.id - b.id;
  });
  return result;
}

async function recommended(db, teacherId, viewer, filters) {
  const merged = Object.assign({}, filters || {}, { onlyMatch: true });
  return postsForTaking(db, true, teacherId, viewer, merged);
}

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
    post.invites = await invitesOf(db, Number(row.id));
    list.push(post);
  }
  return list;
}

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

async function getPost(db, postId, viewer) {
  const row = await db.get('SELECT * FROM posts WHERE id = ?', [Number(postId)]);
  if (!row) return null;
  return readPost(row, viewer);
}

async function allOpenPosts(db, viewer) {
  const rows = await db.all('SELECT * FROM posts WHERE status = ? ORDER BY id', [util.POST_OPEN]);
  const result = nearby.split(viewer, rows.map((row) => readPost(row, viewer)));
  result.list.sort(byDayThenId);
  return result;
}

async function createPost(db, post, viewer) {
  const payload = post || {};
  const publisherId = Number(payload.publisherId);
  if (!(publisherId >= 0)) throw new ApiError('请先登录再发布。');

  if (payload.publisherIsTeacher) throw new ApiError('老师不能发单，只能接单。');
  if (util.plain(payload.subject) === '') throw new ApiError('科目不能为空。');
  if (util.plain(payload.time) === '') throw new ApiError('上课时间不能为空。');

  const status = util.plain(payload.status) === util.POST_PENDING_REVIEW
    ? util.POST_PENDING_REVIEW : util.POST_OPEN;
  const source = util.plain(payload.source) === util.SOURCE_AGENT ? util.SOURCE_AGENT : util.SOURCE_MANUAL;
  const externalId = util.plain(payload.externalId);
  const batchId = util.plain(payload.batchId);

  const rawText = util.stripContacts(payload.rawText);

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
      '',
      source,
      externalId === '' ? null : externalId,
      batchId,
      util.stringifyRequirements(payload.requirements),
      rawText
    ]
  );
  const id = Number(result.lastId);

  await db.run('UPDATE posts SET code = ? WHERE id = ?', [await nextPostCode(db, id), id]);
  return id;
}

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

async function takePost(db, postId, asTeacher, accountId, resume, options) {
  const id = Number(accountId);
  if (!(id >= 0)) throw new ApiError('请先登录再接单。');

  if (!asTeacher) throw new ApiError('只有老师账号能接单。');
  const pid = Number(postId);
  const force = !!(options && options.force);

  return db.transaction(async (tx) => {
    const row = await tx.get('SELECT * FROM posts WHERE id = ?', [pid]);
    if (!row) throw new ApiError('找不到这条发布。');

    const isTeacherPost = row.publisher_role === util.ROLE_TEACHER;
    if (isTeacherPost) throw new ApiError('这是老师发的旧单，接不了。');
    if (row.status !== util.POST_OPEN) throw new ApiError('这条单平台已经定下来了，不能再投递。');

    const post = readPost(row, null);
    const teacherId = id;
    const studentId = post.publisherId;

    const dup = await tx.get(
      'SELECT id FROM bookings WHERE post_id = ? AND teacher_id = ? AND status = ?',
      [pid, teacherId, util.STATUS_PENDING]
    );
    if (dup) throw new ApiError('你已经投递过这条单了，等平台确认吧。');

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
        util.plain(resume),
        util.STATUS_PENDING,
        takenAt
      ]
    );

    const bookingId = result.lastId;

    await tx.run(
      'UPDATE posts SET taker_role = ?, taker_id = ?, taken_at = ? WHERE id = ?',
      [util.ROLE_TEACHER, teacherId, takenAt, pid]
    );
    await notifyTake(tx, bookingId, teacherId, studentId, post, when);

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

async function markTaken(db, postId, bookingId, teacherId) {
  await db.run(
    `UPDATE posts SET status = ?, taker_role = ?, taker_id = ?, booking_id = ?, taken_at = ?
     WHERE id = ?`,
    [util.POST_TAKEN, util.ROLE_TEACHER, Number(teacherId), Number(bookingId), util.nowText(), Number(postId)]
  );
  return true;
}

async function priceOf(post, teacherId, tx) {
  if (util.plain(post.price) !== '') return post.price;
  const teacher = await tx.get('SELECT price FROM teachers WHERE id = ?', [Number(teacherId)]);
  return teacher ? util.plain(teacher.price) : '';
}

async function notifyTake(tx, bookingId, teacherId, studentId, post, when) {
  const teacher = await tx.get('SELECT name FROM teachers WHERE id = ?', [Number(teacherId)]);
  const teacherName = teacher ? teacher.name : '';

  const postId = Number(post.id) || 0;

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

  const pendingRows = await db.all(
    'SELECT * FROM bookings WHERE post_id = ? AND status = ?',
    [Number(postId), util.STATUS_PENDING]
  );
  const when = util.displayTime(row.day, row.period);
  for (const booking of pendingRows) {
    await db.run('UPDATE bookings SET status = ? WHERE id = ?',
      [util.STATUS_CANCELLED, Number(booking.id)]);
    await notify.addMessage(
      db,
      '平台撤销了这条需求',
      '你投递过的' + row.subject + '需求（' + when + '）平台已经撤销，这次不用再等确认了。',
      0, Number(booking.teacher_id), Number(postId)
    );
  }
  return true;
}

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
