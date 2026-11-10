/*
 * 预约/订单域：对应 Qt 版 DatabaseManager 的 createBooking / acceptBooking /
 * rejectBooking / cancelBooking / bookingsForStudent / bookingsForTeacher /
 * activeBookingCount / totalSpent。
 *
 * 规则（取消这一条按新的两层规则改过）：
 *   - 上课时间是学生自己填的自由文本，落库在 day 里，period 留空；
 *   - 时间是自由文本没法机器比对，只能挡「文字一模一样」的撞课（老师侧 + 学生侧两个维度）；
 *   - 下单时存价格快照，老师之后改价不影响这条订单；
 *   - 没被接单之前取消的是订单（学生撤销发布），已经被接了取消的是预约：学生和老师都能取消
 *     自己那一侧的课，取消后单子回到「招募中」；
 *   - 订单进行状态三种：试课中 → 主订单进行中 → 已结束（试课不通过直接结束），
 *     课次（试课 / 正式课）挂在 lessons 表里，见 domain/lessons.js。
 */

const util = require('../lib/util.js');
const { ApiError } = require('../lib/errors.js');
const notify = require('./notify.js');
const posts = require('./posts.js');
const lessons = require('./lessons.js');
const agent = require('./agent.js');

// 老师名字/科目来自 teachers 表，价格优先用订单里的快照（对应 bookingSelect）
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
    postId: Number(row.post_id) || 0,     // 投递单挂在哪条发布单下面（0 = 老式直接预约）
    teacherName: teacher ? teacher.name : '',
    subject: teacher ? util.plain(teacher.subject) : '',
    day: row.day,
    period: row.period || '',
    timeText: util.displayTime(row.day, row.period),
    price: snapshot !== '' ? snapshot : (teacher ? util.plain(teacher.price) : ''),
    remark: row.remark || '',
    resume: util.plain(row.resume),      // 老师投递简历时写的内容
    status: row.status,
    createdAt: row.created_at,
    // 老师端看到的一律是「平台」：发单方的真实客户信息不下发
    studentName: util.PLATFORM_NAME,
    studentId: Number(row.student_id),
    // 这条课对应的官方助手（有的话老师直接找助手，找不到就退回和平台账号聊）
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

// 还在进行中的订单（待确认、试课中、主订单进行中）排前面，其余按上课时间排
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
    list.push(await readBooking(db, row, map));   // eslint-disable-line no-await-in-loop
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

// 价格是自由文本，统计时用订单里的价格快照，只累加能看出数字的那些
function spentOf(list) {
  let total = 0;
  list.forEach((booking) => {
    if (booking.status === util.STATUS_CANCELLED || booking.status === util.STATUS_REJECTED) return;
    total += util.priceValue(booking.price);
  });
  return total;
}

/*
 * 工作台红点（中介端）：有多少条「我发布的单」还挂着没处理的投递（待确认）。
 * 按"单子数"算，不按投递条数 —— 3 位老师投同一条单也只算 1 条，页面上的数字才对得上待办。
 */
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
  /*
   * 课次账（新流程）：待支付金额 / 已确认次数取自每条订单挂的 lessons，
   * 顺序和顺序跟着「我的课程」页走，这里只是把数加起来。
   */
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

/*
 * 确认 / 拒绝共用一套流程：先校验归属和状态，再改库、发消息。
 *   - 老师那一侧：确认学生直接下的预约（老流程，小程序里已经没入口）；
 *   - 学生那一侧：处理老师的"接单申请" —— 确认＝接单成功；拒绝＝换一位老师，
 *     单子重新回到「可接的单」。
 */
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
      // 老师确认学生直接下的预约：订单进「试课中」
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
    // 学生确认：这单才算接单成功，订单进「试课中」
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

    // 单子转「已成交」，同一条单上其他还在等的投递统一变成「平台选了别人」
    const postId = Number(booking.post_id) || 0;
    if (postId > 0) {
      await posts.markTaken(db, postId, bookingId, booking.teacher_id);
      const others = await db.all(
        'SELECT * FROM bookings WHERE post_id = ? AND id <> ? AND status = ?',
        [postId, Number(bookingId), util.STATUS_PENDING]
      );
      for (const other of others) {
        await db.run('UPDATE bookings SET status = ? WHERE id = ?',
          [util.STATUS_REJECTED, Number(other.id)]);   // eslint-disable-line no-await-in-loop
        await notify.addMessage(                       // eslint-disable-line no-await-in-loop
          db,
          '这次没选上',
          '平台选了另一位老师，这次没选上。' + when + ' 的' + subject + '需求已经定下来了。',
          0, Number(other.teacher_id), Number(booking.post_id) || 0);
      }
    }
    /*
     * 事件钩子：平台确认接单 → 通知外部 Agent「接单成功」+「合同可以发了」。
     * Agent 收到后自己决定发合同 / 收款码，调 /api/agent/message。
     */
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
    // 学生拒绝：换一位老师（单子还在「招募中」，同一条单上别的投递不受影响）
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
    // 课作废，但单子还是开放的
    await posts.reopenForBooking(db, bookingId);
    // 事件钩子：平台没选这位老师 → 外部 Agent 可以自动发一条「未通过」
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

/*
 * 取消预约：学生和老师都能取消自己那一侧的课（老师接错了、学生临时有事）。
 * 取消后把单子放回「招募中」——课没了，但平台的需求还是开放的，别的老师还能接。
 * （没被接单之前走的是「撤销发布」，那个才是把订单本身作废。）
 * 老师取消「待确认」的那条＝撤回投递：单子本来就在「招募中」，撤回后别人还能投。
 * 取消时把还「待确认」的课次一并作废；已确认 / 待支付的课次保留，费用照旧算。
 */
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
  const isPendingInvite = booking.status === util.STATUS_PENDING;   // 还没被平台确认的投递

  await db.run('UPDATE bookings SET status = ? WHERE id = ?', [util.STATUS_CANCELLED, Number(bookingId)]);

  /*
   * 还「待确认」的课次跟着订单一起作废：课次没被平台确认，不该挂在一张已取消的订单上。
   * 已经确认 / 待支付 / 已支付的课次保留，费用照旧计入待支付（取消不免已确认的课时费）。
   */
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
      /*
       * 老师撤回投递：投递又撤回不影响任何结果（单子还在「招募中」，谁也没定下来），
       * 所以既不发新通知，也不留旧记录 —— 把这次投递写下的两条通知一起抹掉。
       */
      await notify.removeByBooking(db, Number(bookingId));
    } else {
      // 老师取消：学生那边的课变已取消，需求重新开放
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
      // 学生（平台）取消某位老师的待确认投递：同样是不影响结果的来回，一样不留记录
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

  // 课取消掉，但单子回到「招募中」（对应 Qt 版取消后时段重新开放）
  await posts.reopenForBooking(db, bookingId);
  return true;
}

/*
 * 结束订单：主订单上到一段落（或者平台不想继续了）收尾用的。
 * 试课不通过是自动结束，这里管的是「主订单进行中」的收尾，两边都能点，谁先点算谁的。
 * 还有课次等着确认 / 等着支付时不让结束，先把账结清。
 */
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
