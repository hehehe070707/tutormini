const { ApiError } = require('../lib/errors.js');
const util = require('../lib/util.js');
const notify = require('./notify.js');
const posts = require('./posts.js');

const POST_FIX_STATUSES = [util.POST_OPEN, util.POST_TAKEN, util.POST_CLOSED];

const BOOKING_FIX_STATUSES = [
  util.STATUS_PENDING, util.STATUS_TRIAL, util.STATUS_MAIN, util.STATUS_ENDED, util.STATUS_CANCELLED
];

const RECORD_STATUSES = [util.STATUS_TRIAL, util.STATUS_MAIN, util.STATUS_ENDED];

async function logFix(db, role, accountId, target, targetId, fromStatus, toStatus, note) {
  await db.run(
    `INSERT INTO corrections
       (actor_role, actor_id, target, target_id, from_status, to_status, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      util.plain(role), Number(accountId) || 0, util.plain(target), Number(targetId) || 0,
      util.plain(fromStatus), util.plain(toStatus), util.plain(note), util.nowText()
    ]
  );
}

async function listCorrections(db, target, targetId, limit) {
  const size = Math.min(20, Math.max(1, Number(limit) || 5));
  const rows = await db.all(
    'SELECT * FROM corrections WHERE target = ? AND target_id = ? ORDER BY id DESC LIMIT ' + size,
    [util.plain(target), Number(targetId) || 0]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note,
    createdAt: row.created_at
  }));
}

function assertPostOwner(post, role, accountId) {
  if (post.publisher_role !== role || Number(post.publisher_id) !== Number(accountId)) {
    throw new ApiError('这条单子不是你的，不能修正。', 403);
  }
}

async function correctPost(db, postId, role, accountId, payload) {
  const pid = Number(postId);
  const post = await db.get('SELECT * FROM posts WHERE id = ?', [pid]);
  if (!post) throw new ApiError('找不到这条单子。');
  assertPostOwner(post, role, accountId);

  const body = payload || {};
  const action = util.plain(body.action) || 'status';
  const note = util.plain(body.note);
  const when = util.displayTime(post.day, post.period);
  const codeText = post.code || ('#' + pid);

  if (action === 'record') {
    const teacherId = Number(body.teacherId);
    if (!(teacherId > 0)) throw new ApiError('先选一位老师，再补录。');
    const teacher = await db.get('SELECT id, name FROM teachers WHERE id = ?', [teacherId]);
    if (!teacher) throw new ApiError('找不到这位老师。');
    const want = util.plain(body.status);
    const status = RECORD_STATUSES.indexOf(want) >= 0 ? want : util.STATUS_MAIN;
    const price = util.plain(body.price);

    const result = await db.run(
      `INSERT INTO bookings
         (teacher_id, student_id, post_id, day, period, remark, student_name, price, resume, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
      [
        teacherId, Number(post.publisher_id), pid, post.day, post.period || '',
        '中介补录', util.PLATFORM_NAME, price, status, util.nowText()
      ]
    );
    const bookingId = Number(result.lastId);
    await db.run(
      `UPDATE posts SET status = ?, taker_role = ?, taker_id = ?, booking_id = ?, taken_at = ?
       WHERE id = ?`,
      [util.POST_TAKEN, util.ROLE_TEACHER, teacherId, bookingId, util.nowText(), pid]
    );
    await logFix(db, role, accountId, 'post', pid, post.status, util.POST_TAKEN,
      (note ? note + '；' : '') + '补录订单 #' + bookingId + '（' + teacher.name + '）');
    if (body.notify) {
      await notify.addMessage(db, '平台给你补录了一条课',
        '中介把 ' + codeText + '（' + post.subject + '）这条需求记到了你名下，时间：' + when +
          (price === '' ? '' : '，价格：' + price) + '。',
        0, teacherId, pid);
    }
    return { ok: true, action, status: util.POST_TAKEN, bookingId };
  }

  if (action === 'void') {
    if (post.status === util.POST_CLOSED) return { ok: true, action, status: util.POST_CLOSED };
    await db.run('UPDATE posts SET status = ? WHERE id = ?', [util.POST_CLOSED, pid]);
    const pending = await db.all('SELECT * FROM bookings WHERE post_id = ? AND status = ?',
      [pid, util.STATUS_PENDING]);
    for (const booking of pending) {
      await db.run('UPDATE bookings SET status = ? WHERE id = ?',
        [util.STATUS_CANCELLED, Number(booking.id)]);
      await notify.addMessage(
        db, '这条需求被平台作废了',
        '你投递过的' + post.subject + '需求（' + when + '）平台已经作废，这次不用再等确认了。',
        0, Number(booking.teacher_id), pid
      );
    }
    await logFix(db, role, accountId, 'post', pid, post.status, util.POST_CLOSED, note);
    return { ok: true, action, status: util.POST_CLOSED };
  }

  const status = util.plain(body.status);
  if (POST_FIX_STATUSES.indexOf(status) < 0) {
    throw new ApiError('单子状态只能改成：' + POST_FIX_STATUSES.join(' / ') + '。');
  }
  if (status === post.status) return { ok: true, action: 'status', status };
  await db.run('UPDATE posts SET status = ? WHERE id = ?', [status, pid]);
  await logFix(db, role, accountId, 'post', pid, post.status, status, note);
  return { ok: true, action: 'status', status };
}

async function correctBooking(db, bookingId, role, accountId, payload) {
  const bid = Number(bookingId);
  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [bid]);
  if (!booking) throw new ApiError('找不到这条订单。');
  if (role !== util.ROLE_STUDENT || Number(booking.student_id) !== Number(accountId)) {
    throw new ApiError('这条订单不是你的，不能修正。', 403);
  }

  const body = payload || {};
  const status = util.plain(body.status);
  if (BOOKING_FIX_STATUSES.indexOf(status) < 0) {
    throw new ApiError('订单状态只能改成：' + BOOKING_FIX_STATUSES.join(' / ') + '。');
  }
  if (status === booking.status) return { ok: true, status };

  await db.run('UPDATE bookings SET status = ? WHERE id = ?', [status, bid]);
  if (status === util.STATUS_CANCELLED) await posts.reopenForBooking(db, bid);
  await logFix(db, role, accountId, 'booking', bid, booking.status, status, util.plain(body.note));
  if (body.notify) {
    await notify.addMessage(db, '平台修正了这条课的状态',
      '你接的这条课状态改成了「' + util.bookingStatusText(status) + '」。',
      0, Number(booking.teacher_id), Number(booking.post_id) || 0);
  }
  return { ok: true, status };
}

module.exports = {
  POST_FIX_STATUSES,
  BOOKING_FIX_STATUSES,
  correctPost,
  correctBooking,
  listCorrections
};
