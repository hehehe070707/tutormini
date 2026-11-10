/*
 * 课次域（新流程）：一条订单下面挂每一次课，试课也算一条（kind = 试课）。
 *
 * 订单流转：
 *   平台确认接单 → 订单「试课中」→ 老师提交试课完成（课次「待确认」）
 *     → 平台点通过：订单「主订单进行中」，这条试课课次「已确认」（计入待支付）
 *     → 平台点不通过：订单「已结束」，这条试课课次「已确认 · 不通过」（试课费照样要付）
 *     两种情况平台都要选试课费按「半价」还是「全价」，金额写在 lessons.fee 里。
 *   主订单里每上一次课：老师「完成本次」（课次「待确认」）→ 平台「确认本次」
 *     （课次「已确认」，计入已确认次数和待支付金额）→ 支付（课次「已支付」）
 *   平台「有异议」：填原因，课次退回「待确认」并通知老师，老师改完重新提交。
 *
 * 对应 Qt 版没有的东西（Qt 版只有一条订单，没有课次表），是这次新加的规则。
 */

const util = require('../lib/util.js');
const { ApiError } = require('../lib/errors.js');
const notify = require('./notify.js');
const payments = require('./payments.js');

function readLesson(row) {
  const status = row.status;
  const result = row.result || '';
  return {
    id: Number(row.id),
    bookingId: Number(row.booking_id),
    kind: row.kind,
    isTrial: row.kind === util.LESSON_TRIAL,
    seq: Number(row.seq) || 0,
    status,
    result,
    fee: Number(row.fee) || 0,        // 这条课次的课时费（整数元）
    content: row.content || '',
    reason: row.reason || '',
    statusText: util.lessonStatusText(status, result),
    pending: status === util.LESSON_PENDING,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at || '',
    paidAt: row.paid_at || ''
  };
}

/*
 * 一条订单的课次账（金额按每条课次自己存的 fee 累加）：
 *   已确认次数 = 已确认 + 待支付 + 已支付（试课不论通过与否都算一次课）
 *   待支付金额 = 未付的那几条的 fee 之和
 * 试课是要付费的：平台判定通过 / 不通过时选「半价」或「全价」，fee 当时定下来。
 */
function statsOf(booking, lessons) {
  let confirmed = 0;
  let unpaid = 0;
  let paid = 0;
  let pending = 0;
  let unpaidAmount = 0;
  let paidAmount = 0;
  lessons.forEach((lesson) => {
    const fee = Number(lesson.fee) || 0;
    if (lesson.status === util.LESSON_PENDING) {
      pending++;
      return;
    }
    if (lesson.status === util.LESSON_PAID) {
      paid++;
      confirmed++;
      paidAmount += fee;
      return;
    }
    if (lesson.status === util.LESSON_UNPAID || lesson.status === util.LESSON_CONFIRMED) {
      unpaid++;
      confirmed++;
      unpaidAmount += fee;
    }
  });
  return {
    confirmedCount: confirmed,
    unpaidCount: unpaid,
    paidCount: paid,
    pendingCount: pending,
    unit: util.priceValue(booking.price),
    unpaidAmount,
    paidAmount
  };
}

// 一次查好一批订单的课次，贴到 booking.lessons / booking.lessonStats 上
async function attach(db, list) {
  for (const booking of list) {
    const rows = await db.all(
      'SELECT * FROM lessons WHERE booking_id = ? ORDER BY id',
      [Number(booking.id)]
    );
    const lessons = rows.map(readLesson);
    booking.lessons = lessons;                       // eslint-disable-line no-param-reassign
    booking.lessonStats = statsOf(booking, lessons); // eslint-disable-line no-param-reassign
  }
  return list;
}

async function listForBooking(db, bookingId) {
  const rows = await db.all(
    'SELECT * FROM lessons WHERE booking_id = ? ORDER BY id',
    [Number(bookingId)]
  );
  return rows.map(readLesson);
}

async function loadBooking(db, bookingId) {
  const row = await db.get('SELECT * FROM bookings WHERE id = ?', [Number(bookingId)]);
  if (!row) throw new ApiError('找不到这条订单。');
  return row;
}

async function loadLesson(db, lessonId) {
  const row = await db.get('SELECT * FROM lessons WHERE id = ?', [Number(lessonId)]);
  if (!row) throw new ApiError('找不到这条课次记录。');
  return row;
}

// 老师那一侧：这条订单是不是我接的
function assertTeacherOwns(booking, accountId) {
  if (Number(booking.teacher_id) !== Number(accountId)) {
    throw new ApiError('这条课不是你接的，不能操作。');
  }
}

// 平台那一侧：这条订单是不是我发的
function assertStudentOwns(booking, accountId) {
  if (Number(booking.student_id) !== Number(accountId)) {
    throw new ApiError('这条订单不是你的，不能操作。');
  }
}

async function bookingNames(db, booking) {
  const teacher = await db.get('SELECT name FROM teachers WHERE id = ?', [Number(booking.teacher_id)]);
  return {
    teacherName: teacher ? teacher.name : '',
    // 老师端的一律显示「平台」：发单方真实信息不外露
    studentName: util.PLATFORM_NAME
  };
}

/*
 * 老师提交课次：
 *   kind = 试课 → 订单必须在「试课中」，而且只能提交一次；
 *   kind = 正式 → 订单必须在「主订单进行中」，上一次课确认完才能提交下一次。
 */
async function submit(db, bookingId, role, accountId, kind, content) {
  if (role !== util.ROLE_TEACHER) throw new ApiError('只有老师能提交课次。', 403);
  const booking = await loadBooking(db, bookingId);
  assertTeacherOwns(booking, accountId);

  const type = util.plain(kind) === util.LESSON_FORMAL ? util.LESSON_FORMAL : util.LESSON_TRIAL;
  if (type === util.LESSON_TRIAL && booking.status !== util.STATUS_TRIAL) {
    throw new ApiError('这条订单现在不在试课中，提交不了试课。');
  }
  if (type === util.LESSON_FORMAL && booking.status !== util.STATUS_MAIN) {
    throw new ApiError('试课通过之后才能提交正式课次。');
  }
  // 平台发过收款码的：确认收款之后才能开始试课（没走收款流程的不拦）
  if (type === util.LESSON_TRIAL) await payments.assertTrialUnlocked(db, booking);

  const pending = await db.get(
    'SELECT id FROM lessons WHERE booking_id = ? AND status = ? LIMIT 1',
    [Number(booking.id), util.LESSON_PENDING]
  );
  if (pending) throw new ApiError('上一次课还没确认，等平台确认后再提交下一次。');

  if (type === util.LESSON_TRIAL) {
    const trial = await db.get(
      'SELECT id FROM lessons WHERE booking_id = ? AND kind = ? LIMIT 1',
      [Number(booking.id), util.LESSON_TRIAL]
    );
    if (trial) throw new ApiError('试课已经提交过了。');
  }

  const count = await db.get(
    'SELECT COUNT(*) AS total FROM lessons WHERE booking_id = ? AND kind = ?',
    [Number(booking.id), util.LESSON_FORMAL]
  );
  const seq = type === util.LESSON_FORMAL ? Number(count.total) + 1 : 0;
  /*
   * 课时费：正式课＝订单价格快照全额；试课先按半价挂上（平台判定通过 / 不通过时
   * 再改成「半价」或「全价」，见 trialResult）。价格是自由文本，取开头数字。
   */
  const unit = util.priceValue(booking.price);
  const fee = type === util.LESSON_FORMAL ? unit : Math.round(unit / 2);

  const result = await db.run(
    `INSERT INTO lessons (booking_id, kind, seq, status, result, fee, content, reason,
                          created_at, confirmed_at, paid_at)
     VALUES (?, ?, ?, ?, '', ?, ?, '', ?, '', '')`,
    [Number(booking.id), type, seq, util.LESSON_PENDING, fee, util.plain(content), util.nowText()]
  );

  const names = await bookingNames(db, booking);
  const day = util.displayTime(booking.day, booking.period);
  if (type === util.LESSON_TRIAL) {
    await notify.addMessage(
      db,
      '老师提交了试课',
      names.teacherName + ' 老师提交了 ' + day + ' 的试课，请确认这次试课通过了没有，' +
        '并选试课费按半价还是全价。',
      Number(booking.student_id), 0, Number(booking.post_id) || 0);
    await notify.addMessage(
      db,
      '试课已提交',
      '你提交了 ' + day + ' 的试课，等平台确认。',
      0, Number(booking.teacher_id), Number(booking.post_id) || 0);
  } else {
    await notify.addMessage(
      db,
      '老师完成了第 ' + seq + ' 次课',
      names.teacherName + ' 老师提交了第 ' + seq + ' 次课，确认无误后请点「确认本次」。',
      Number(booking.student_id), 0, Number(booking.post_id) || 0);
    await notify.addMessage(
      db,
      '第 ' + seq + ' 次课已提交',
      '你提交了第 ' + seq + ' 次课，等平台确认。',
      0, Number(booking.teacher_id), Number(booking.post_id) || 0);
  }
  return { id: Number(result.lastId), seq, kind: type };
}

// 平台有异议后，老师改完重新提交（还在「待确认」，只改内容）
async function resubmit(db, lessonId, role, accountId, content) {
  if (role !== util.ROLE_TEACHER) throw new ApiError('只有老师能重新提交课次。', 403);
  const lesson = await loadLesson(db, lessonId);
  const booking = await loadBooking(db, lesson.booking_id);
  assertTeacherOwns(booking, accountId);
  if (lesson.status !== util.LESSON_PENDING) throw new ApiError('这条课次已经确认过了，不用重新提交。');

  await db.run('UPDATE lessons SET content = ? WHERE id = ?', [util.plain(content), Number(lesson.id)]);
  await notify.addMessage(
    db,
    '老师重新提交了课次',
    util.plain(content) === ''
      ? '老师修改后重新提交了，请再确认一次。'
      : '老师修改后重新提交了：' + util.plain(content),
    Number(booking.student_id), 0, Number(booking.post_id) || 0);
  return true;
}

/*
 * 老师撤回课次：只撤「待确认」的那条（平台还没确认、也还没计费）。
 * 撤回后这条记录删掉，订单留在原状态，老师可以重新提交。
 * 已确认 / 待支付 / 已支付的不让撤（钱已经定了），要收尾走「取消预约 / 结束订单」。
 */
async function withdraw(db, lessonId, role, accountId) {
  if (role !== util.ROLE_TEACHER) throw new ApiError('只有老师能撤回课次。', 403);
  const lesson = await loadLesson(db, lessonId);
  const booking = await loadBooking(db, lesson.booking_id);
  assertTeacherOwns(booking, accountId);
  if (lesson.status !== util.LESSON_PENDING) throw new ApiError('这条课次已经确认过了，撤不回来。');
  if (booking.status !== util.STATUS_TRIAL && booking.status !== util.STATUS_MAIN) {
    throw new ApiError('这条订单已经结束了，不用撤回课次。');
  }

  await db.run('DELETE FROM lessons WHERE id = ?', [Number(lesson.id)]);
  const label = lesson.kind === util.LESSON_TRIAL ? '试课' : '第 ' + Number(lesson.seq) + ' 次课';
  await notify.addMessage(
    db,
    '老师撤回了课次',
    '老师撤回了这次' + label + '提交，等老师重新提交后再确认。',
    Number(booking.student_id), 0, Number(booking.post_id) || 0);
  await notify.addMessage(
    db,
    '已撤回课次',
    '你撤回了这次' + label + '提交，准备好后可以重新提交。',
    0, Number(booking.teacher_id), Number(booking.post_id) || 0);
  return true;
}

// 平台确认本次（正式课）：课次「已确认」，计入已确认次数和待支付金额
async function confirm(db, lessonId, role, accountId) {
  if (role !== util.ROLE_STUDENT) throw new ApiError('只有平台端能确认课次。', 403);
  const lesson = await loadLesson(db, lessonId);
  if (lesson.kind !== util.LESSON_FORMAL) throw new ApiError('试课要走「通过 / 不通过」。');
  const booking = await loadBooking(db, lesson.booking_id);
  assertStudentOwns(booking, accountId);
  if (lesson.status !== util.LESSON_PENDING) throw new ApiError('这条课次已经确认过了。');
  if (booking.status !== util.STATUS_MAIN) throw new ApiError('这条订单现在不是主订单进行中。');

  await db.run(
    'UPDATE lessons SET status = ?, confirmed_at = ?, reason = ? WHERE id = ?',
    [util.LESSON_CONFIRMED, util.nowText(), '', Number(lesson.id)]
  );
  const names = await bookingNames(db, booking);
  await notify.addMessage(
    db,
    '平台确认了第 ' + Number(lesson.seq) + ' 次课',
    '第 ' + Number(lesson.seq) + ' 次课已确认，这笔课时费记在待支付里。',
    0, Number(booking.teacher_id), Number(booking.post_id) || 0);
  return true;
}

/*
 * 平台有异议：填原因，课次退回「待确认」（本来就是待确认，只把原因存下来），通知老师改。
 */
async function dispute(db, lessonId, role, accountId, reason) {
  if (role !== util.ROLE_STUDENT) throw new ApiError('只有平台端能提异议。', 403);
  const text = util.plain(reason);
  if (text === '') throw new ApiError('先写一下这次课哪里有问题。');

  const lesson = await loadLesson(db, lessonId);
  const booking = await loadBooking(db, lesson.booking_id);
  assertStudentOwns(booking, accountId);
  if (lesson.status !== util.LESSON_PENDING) throw new ApiError('这条课次已经确认过了，提不了异议。');

  await db.run('UPDATE lessons SET reason = ? WHERE id = ?', [text, Number(lesson.id)]);
  const label = lesson.kind === util.LESSON_TRIAL ? '试课' : '第 ' + Number(lesson.seq) + ' 次课';
  await notify.addMessage(
    db,
    '平台对这次课有异议',
    '平台对 ' + label + ' 有异议：' + text + '。改完重新提交吧。',
    0, Number(booking.teacher_id), Number(booking.post_id) || 0);
  await notify.addMessage(
    db,
    '已把异议发给老师',
    '你对 ' + label + ' 的异议已发给老师：' + text + '，等老师改完重新提交。',
    Number(booking.student_id), 0, Number(booking.post_id) || 0);
  return true;
}

/*
 * 平台判定试课：通过 → 订单进主订单；不通过 → 订单结束。
 * 试课是要付费的：feeHalf = true 收半价、false 收全价（不传按半价，和提交时的暂定价一致）。
 * 不管通过还是不通过，这条试课费都记进待支付。
 */
async function trialResult(db, lessonId, role, accountId, pass, feeHalf) {
  if (role !== util.ROLE_STUDENT) throw new ApiError('只有平台端能确认试课结果。', 403);
  const lesson = await loadLesson(db, lessonId);
  if (lesson.kind !== util.LESSON_TRIAL) throw new ApiError('这条课次不是试课。');
  const booking = await loadBooking(db, lesson.booking_id);
  assertStudentOwns(booking, accountId);
  if (lesson.status !== util.LESSON_PENDING) throw new ApiError('这次试课已经确认过了。');
  if (booking.status !== util.STATUS_TRIAL) throw new ApiError('这条订单现在不在试课中。');

  const passed = !!pass;
  const result = passed ? util.TRIAL_PASS : util.TRIAL_FAIL;
  const nextStatus = passed ? util.STATUS_MAIN : util.STATUS_ENDED;
  const unit = util.priceValue(booking.price);
  const half = feeHalf === undefined || feeHalf === null ? true : !!feeHalf;
  const fee = half ? Math.round(unit / 2) : unit;
  const feeText = fee > 0 ? fee + ' 元' + (half ? '（半价）' : '（全价）') : '（价格未填写）';

  await db.run(
    'UPDATE lessons SET status = ?, result = ?, fee = ?, confirmed_at = ?, reason = ? WHERE id = ?',
    [util.LESSON_CONFIRMED, result, fee, util.nowText(), '', Number(lesson.id)]
  );
  await db.run('UPDATE bookings SET status = ? WHERE id = ?', [nextStatus, Number(booking.id)]);

  const names = await bookingNames(db, booking);
  if (passed) {
    await notify.addMessage(
      db,
      '试课通过',
      '你通过了 ' + names.teacherName + ' 老师的试课，试课费 ' + feeText +
        '，订单进入主订单进行中，以后每次上完课记得确认。',
      Number(booking.student_id), 0, Number(booking.post_id) || 0);
    await notify.addMessage(
      db,
      '试课通过了',
      '平台通过了你的试课，试课费 ' + feeText +
        '，订单进入主订单进行中，上完课记得点「完成本次」。',
      0, Number(booking.teacher_id), Number(booking.post_id) || 0);
  } else {
    await notify.addMessage(
      db,
      '试课没通过',
      '你没有通过 ' + names.teacherName + ' 老师的试课，这条订单已经结束，试课费 ' +
        feeText + ' 记在待支付里。',
      Number(booking.student_id), 0, Number(booking.post_id) || 0);
    await notify.addMessage(
      db,
      '试课没通过',
      '平台没有通过你的试课，这条订单已经结束，试课费 ' + feeText + '。',
      0, Number(booking.teacher_id), Number(booking.post_id) || 0);
  }
  return { pass: passed, fee, half };
}

module.exports = {
  readLesson,
  statsOf,
  attach,
  listForBooking,
  submit,
  resubmit,
  withdraw,
  confirm,
  dispute,
  trialResult,
  loadBooking,
  loadLesson,
  assertTeacherOwns,
  assertStudentOwns
};
