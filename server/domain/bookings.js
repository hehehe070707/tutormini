const util = require('../lib/util.js');
const { ApiError } = require('../lib/errors.js');
const notify = require('./notify.js');
const posts = require('./posts.js');
const lessons = require('./lessons.js');
const agent = require('./agent.js');

async function readBooking(db, row, teacherMap) {
  let teacher = teacherMap ? teacherMap.get(Number(row.teacher_id)) : null;
  if (!teacher) {
    teacher = await db.get('SELECT id, name, subject, price FROM teachers WHERE id = ?', [Number(row.teacher_id)]);
  }
  const agentRow = await db.get(
    'SELECT id FROM agents WHERE owner_student_id = ? ORDER BY id LIMIT 1',
    [Number(row.student_id)]
  );
  const snapshot = util.plain(row.price);
  return {
    id: Number(row.id),
    teacherId: Number(row.teacher_id),
    postId: Number(row.post_id) || 0,
    teacherName: teacher ? teacher.name : '',
    subject: teacher ? util.plain(teacher.subject) : '',
    day: row.day,
    period: row.period || '',
    timeText: util.displayTime(row.day, row.period),
    price: snapshot !== '' ? snapshot : (teacher ? util.plain(teacher.price) : ''),
    remark: row.remark || '',
    resume: util.plain(row.resume),
    status: row.status,
    createdAt: row.created_at,

    studentName: util.PLATFORM_NAME,
    studentId: Number(row.student_id),

    agentId: agentRow ? Number(agentRow.id) : 0
  };
}

function bookingWeight(status) {
  if (status === util.STATUS_PENDING) return 0;
  if (status === util.STATUS_TRIAL) return 1;
  if (status === util.STATUS_MAIN || status === util.STATUS_CONFIRMED ||
      status === util.STATUS_LEGACY_BOOKED) return 2;
  return 3;
}

function sortBookings(list) {
  return list.sort((a, b) => {
    const diff = bookingWeight(a.status) - bookingWeight(b.status);
    if (diff !== 0) return diff;
    if (a.day !== b.day) return a.day < b.day ? -1 : 1;
    return a.id - b.id;
  });
}

async function teacherMap(db) {
  const rows = await db.all('SELECT id, name, subject, price FROM teachers');
  const map = new Map();
  rows.forEach((row) => map.set(Number(row.id), row));
  return map;
}

async function listFor(db, column, accountId) {
  const id = Number(accountId);
  if (!(id >= 0)) return [];
  const where = column === 'student_id' ? 'student_id' : 'teacher_id';
  const rows = await db.all('SELECT * FROM bookings WHERE ' + where + ' = ?', [id]);
  const map = await teacherMap(db);
  const list = [];
  for (const row of rows) {
    list.push(await readBooking(db, row, map));
  }
  return sortBookings(list);
}

function listForStudent(db, studentId) {
  return listFor(db, 'student_id', studentId);
}

function listForTeacher(db, teacherId) {
  return listFor(db, 'teacher_id', teacherId);
}

function activeCount(list) {
  return list.filter((booking) => util.isActiveBooking(booking.status)).length;
}

function spentOf(list) {
  let total = 0;
  list.forEach((booking) => {
    if (booking.status === util.STATUS_CANCELLED || booking.status === util.STATUS_REJECTED) return;
    total += util.priceValue(booking.price);
  });
  return total;
}

async function pendingInvitePostCount(db, studentId) {
  const row = await db.get(
    `SELECT COUNT(DISTINCT post_id) AS total FROM bookings
     WHERE student_id = ? AND status = ? AND post_id > 0`,
    [Number(studentId) || 0, util.STATUS_PENDING]
  );
  return row ? Number(row.total) || 0 : 0;
}

async function statsForStudent(db, studentId) {
  const list = await listForStudent(db, studentId);

  await lessons.attach(db, list);
  let unpaidAmount = 0;
  let paidAmount = 0;
  let confirmedLessons = 0;
  list.forEach((booking) => {
    const stats = booking.lessonStats || {};
    unpaidAmount += Number(stats.unpaidAmount) || 0;
    paidAmount += Number(stats.paidAmount) || 0;
    confirmedLessons += Number(stats.confirmedCount) || 0;
  });
  return {
    activeBookings: activeCount(list),
    totalSpent: spentOf(list),
    total: list.length,
    confirmedLessons,
    unpaidAmount,
    paidAmount
  };
}

async function statsForTeacher(db, teacherId) {
  const list = await listForTeacher(db, teacherId);
  return {
    total: list.length,
    pending: list.filter((booking) => booking.status === util.STATUS_PENDING).length,
    trial: list.filter((booking) => booking.status === util.STATUS_TRIAL).length,
    ongoing: list.filter((booking) =>
      booking.status === util.STATUS_MAIN || booking.status === util.STATUS_CONFIRMED ||
      booking.status === util.STATUS_LEGACY_BOOKED).length,
    cancelled: list.filter((booking) => booking.status === util.STATUS_CANCELLED).length
  };
}

async function setHandled(db, bookingId, role, accountId, accept) {
  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [Number(bookingId)]);
  if (!booking) throw new ApiError('找不到这条预约记录。');
  const isTeacher = role === util.ROLE_TEACHER;
  const isMine = isTeacher
    ? Number(booking.teacher_id) === Number(accountId)
    : Number(booking.student_id) === Number(accountId);
  if (!isMine) {
    throw new ApiError(isTeacher ? '这条预约不是你的课，不能处理。' : '这条预约不是你的单，不能处理。');
  }
  if (booking.status !== util.STATUS_PENDING) throw new ApiError('这条预约已经处理过了。');

  const teacher = await db.get('SELECT * FROM teachers WHERE id = ?', [Number(booking.teacher_id)]);
  const when = util.displayTime(booking.day, booking.period);
  const teacherName = teacher ? teacher.name : '';
  const subject = teacher ? util.plain(teacher.subject) : '';
  const studentName = util.PLATFORM_NAME;

  await db.run(
    'UPDATE bookings SET status = ? WHERE id = ?',
    [accept ? util.STATUS_TRIAL : util.STATUS_REJECTED, Number(bookingId)]
  );

  if (isTeacher) {
    if (accept) {

      await notify.addMessage(
        db,
        '预约已确认，进入试课',
        '老师 ' + teacherName + ' 已确认你 ' + when + ' 的' + subject +
          '课程预约，先上一次试课，上完老师会提交试课结果。',
        Number(booking.student_id), 0, Number(booking.post_id) || 0);
    } else {
      await notify.addMessage(
        db,
        '预约被拒绝',
        '很遗憾，' + teacherName + ' 老师拒绝了你 ' + when + ' 的' + subject +
          '课程预约，可以换一位老师或改个时间再约。',
        Number(booking.student_id), 0, Number(booking.post_id) || 0);
    }
  } else if (accept) {

    await notify.addMessage(
      db,
      '接单成功',
      '你确认了 ' + teacherName + ' 老师的接单，' + when + ' 的' + subject +
        '课定下来了。先上一次试课，上完老师提交试课完成，你再点通过或不通过。',
      Number(booking.student_id), 0, Number(booking.post_id) || 0);
    await notify.addMessage(
      db,
      '平台确认了你的接单',
      studentName + ' 确认了你的接单，' + when + ' 的' + subject +
        '课定下来了。上完试课记得点「提交试课完成」。',
      0, Number(booking.teacher_id), Number(booking.post_id) || 0);

    const postId = Number(booking.post_id) || 0;
    if (postId > 0) {
      await posts.markTaken(db, postId, bookingId, booking.teacher_id);
      const others = await db.all(
        'SELECT * FROM bookings WHERE post_id = ? AND id <> ? AND status = ?',
        [postId, Number(bookingId), util.STATUS_PENDING]
      );
      for (const other of others) {
        await db.run('UPDATE bookings SET status = ? WHERE id = ?',
          [util.STATUS_REJECTED, Number(other.id)]);
        await notify.addMessage(
          db,
          '这次没选上',
          '平台选了另一位老师，这次没选上。' + when + ' 的' + subject + '需求已经定下来了。',
          0, Number(other.teacher_id), Number(booking.post_id) || 0);
      }
    }

    const eventData = {
      bookingId: Number(bookingId),
      postId: Number(booking.post_id) || 0,
      teacherId: Number(booking.teacher_id),
      subject,
      timeText: when
    };
    await agent.emit(db, agent.EVENT_BOOKING_CONFIRMED, eventData,
      { refId: Number(bookingId), studentId: Number(booking.student_id), teacherId: Number(booking.teacher_id) });
    await agent.emit(db, agent.EVENT_CONTRACT_READY, eventData,
      { refId: Number(bookingId), studentId: Number(booking.student_id), teacherId: Number(booking.teacher_id) });
  } else {

    await notify.addMessage(
      db,
      '已换一位老师',
      '你回绝了 ' + teacherName + ' 老师的接单，这条需求已经重新开放，等别的老师来接。',
      Number(booking.student_id), 0, Number(booking.post_id) || 0);
    await notify.addMessage(
      db,
      '这次没选上',
      '平台没选你的这次接单，' + when + ' 的' + subject + '需求重新开放了。',
      0, Number(booking.teacher_id), Number(booking.post_id) || 0);

    await posts.reopenForBooking(db, bookingId);

    await agent.emit(db, agent.EVENT_BOOKING_REJECTED, {
      bookingId: Number(bookingId),
      postId: Number(booking.post_id) || 0,
      teacherId: Number(booking.teacher_id),
      subject,
      timeText: when
    }, { refId: Number(bookingId), studentId: Number(booking.student_id), teacherId: Number(booking.teacher_id) });
  }
  return true;
}

function acceptBooking(db, bookingId, role, accountId) {
  return setHandled(db, bookingId, role, accountId, true);
}

function rejectBooking(db, bookingId, role, accountId) {
  return setHandled(db, bookingId, role, accountId, false);
}

async function cancelBooking(db, bookingId, role, accountId) {
  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [Number(bookingId)]);
  if (!booking) throw new ApiError('找不到这条预约记录。');
  const isTeacher = role === util.ROLE_TEACHER;
  const isMine = isTeacher
    ? Number(booking.teacher_id) === Number(accountId)
    : Number(booking.student_id) === Number(accountId);
  if (!isMine) {
    throw new ApiError(isTeacher ? '这条课不是你接的，不能取消。' : '这条预约不是你的，不能取消。');
  }
  if (!util.isActiveBooking(booking.status)) {
    throw new ApiError('这条预约已经处理过了，不能取消。');
  }

  const teacher = await db.get('SELECT * FROM teachers WHERE id = ?', [Number(booking.teacher_id)]);
  const when = util.displayTime(booking.day, booking.period);
  const teacherName = teacher ? teacher.name : '';
  const subject = teacher ? util.plain(teacher.subject) : '';
  const studentName = util.PLATFORM_NAME;
  const isPendingInvite = booking.status === util.STATUS_PENDING;

  await db.run('UPDATE bookings SET status = ? WHERE id = ?', [util.STATUS_CANCELLED, Number(bookingId)]);

  const staleLessons = await db.all(
    'SELECT id FROM lessons WHERE booking_id = ? AND status = ?',
    [Number(bookingId), util.LESSON_PENDING]
  );
  if (staleLessons.length > 0) {
    await db.run('DELETE FROM lessons WHERE booking_id = ? AND status = ?',
      [Number(bookingId), util.LESSON_PENDING]);
    await notify.addMessage(
      db,
      '课次已作废',
      '这条订单已取消，之前提交的「待确认」课次一并作废，不用再确认了。',
      isTeacher ? Number(booking.student_id) : 0,
      isTeacher ? 0 : Number(booking.teacher_id), Number(booking.post_id) || 0);
  }

  if (isTeacher) {
    if (isPendingInvite) {

      await notify.removeByBooking(db, Number(bookingId));
    } else {

      await notify.addMessage(
        db,
        '老师取消了这节课',
        teacherName + ' 老师取消了 ' + when + ' 的' + subject + '课。' +
          '你的需求已经重新开放，别的老师还能接。',
        Number(booking.student_id), 0, Number(booking.post_id) || 0);
      await notify.addMessage(
        db,
        '预约已取消',
        '你取消了 ' + studentName + ' 同学 ' + when + ' 的' + subject + '课，' +
          '这条需求已经放回可接的单里。',
        0, Number(booking.teacher_id), Number(booking.post_id) || 0);
    }
  } else {
    if (isPendingInvite) {

      await notify.removeByBooking(db, Number(bookingId));
    } else {
      await notify.addMessage(
        db,
        '预约已取消',
        '与 ' + teacherName + ' 老师 ' + when + ' 的课程已取消，你的需求已经重新开放，别的老师还能接。',
        Number(booking.student_id), 0, Number(booking.post_id) || 0);
      await notify.addMessage(
        db,
        '平台取消了预约',
        '平台取消了你 ' + when + ' 的' + subject + '课程，这个时间已经空出来了。',
        0, Number(booking.teacher_id), Number(booking.post_id) || 0);
    }
  }

  await posts.reopenForBooking(db, bookingId);
  return true;
}

async function finishOrder(db, bookingId, role, accountId) {
  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [Number(bookingId)]);
  if (!booking) throw new ApiError('找不到这条订单。');
  const isTeacher = role === util.ROLE_TEACHER;
  const isMine = isTeacher
    ? Number(booking.teacher_id) === Number(accountId)
    : Number(booking.student_id) === Number(accountId);
  if (!isMine) {
    throw new ApiError(isTeacher ? '这条课不是你接的，不能结束。' : '这条订单不是你的，不能结束。');
  }
  if (booking.status !== util.STATUS_TRIAL && booking.status !== util.STATUS_MAIN) {
    throw new ApiError('只有试课中 / 主订单进行中的订单才能结束。');
  }

  const lessonList = await lessons.listForBooking(db, booking.id);
  const stats = lessons.statsOf(booking, lessonList);
  if (stats.pendingCount > 0) throw new ApiError('还有课次没确认，先确认完再结束订单。');

  const teacher = await db.get('SELECT name FROM teachers WHERE id = ?', [Number(booking.teacher_id)]);
  const teacherName = teacher ? teacher.name : '';
  const studentName = util.PLATFORM_NAME;

  await db.run('UPDATE bookings SET status = ? WHERE id = ?', [util.STATUS_ENDED, Number(booking.id)]);
  await notify.addMessage(
    db,
    '订单已结束',
    '和 ' + teacherName + ' 老师的这条订单已经结束，记录收在【我的】页的历史里。',
    Number(booking.student_id), 0, Number(booking.post_id) || 0);
  await notify.addMessage(
    db,
    '订单已结束',
    studentName + ' 的这条订单已经结束' +
      (stats.unpaidCount > 0 ? '，还有 ' + stats.unpaidAmount + ' 元课时费待支付。' : '。'),
    0, Number(booking.teacher_id), Number(booking.post_id) || 0);
  return true;
}

module.exports = {
  readBooking,
  listForStudent,
  listForTeacher,
  activeCount,
  spentOf,
  statsForStudent,
  statsForTeacher,
  pendingInvitePostCount,
  acceptBooking,
  rejectBooking,
  cancelBooking,
  finishOrder
};
