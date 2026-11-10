/*
 * 「修正」：中介自己动手改状态的那一套（对应小程序工作台里的【修正】）。
 *
 * 为什么要有这个：家长不在小程序里，试课通过 / 课次确认这些本来是家长的动作，
 * 让中介替家长点就等于糊数据。所以改成——流程动作撤掉，中介线上问完家长之后，
 * 直接在这里把单子 / 订单的状态改成对的那一个，每次改都往 corrections 记一笔。
 *
 * 约束（故意做窄）：
 *   1) 只能改自己名下的单子和订单（越权一律 403）；
 *   2) 状态只能落在受控的那几个值里，不能随便塞字符串；
 *   3) 「作废」是软删——状态改成已撤销，数据一条不删，历史还能翻；
 *   4) 「补录订单」用来补线下成交（家长直接找了老师、没在 app 里投递）。
 * 对应 Qt 版没有这一套（小程序特有：中介工作台）。
 */

const { ApiError } = require('../lib/errors.js');
const util = require('../lib/util.js');
const notify = require('./notify.js');
const posts = require('./posts.js');

// 单子能被修正成哪几个状态（和发单 / 撤销那套一致）
const POST_FIX_STATUSES = [util.POST_OPEN, util.POST_TAKEN, util.POST_CLOSED];
// 订单能被修正成哪几个状态（课次那几个状态不在这里，属于老师的流水）
const BOOKING_FIX_STATUSES = [
  util.STATUS_PENDING, util.STATUS_TRIAL, util.STATUS_MAIN, util.STATUS_ENDED, util.STATUS_CANCELLED
];
// 补录订单允许的状态（还没定人 / 已取消这两种补录没意义）
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

// 这条单子 / 订单最近改过几次（页面上「修正记录」那几行用）
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

// 是不是这条单子的主人（只认发单方）
function assertPostOwner(post, role, accountId) {
  if (post.publisher_role !== role || Number(post.publisher_id) !== Number(accountId)) {
    throw new ApiError('这条单子不是你的，不能修正。', 403);
  }
}

/*
 * 单子修正：action = status（改状态）/ record（补录订单）/ void（作废）
 * body: { action, status, teacherId, price, note, notify }
 */
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

  // ① 补录一条线下成交的订单：挑老师 + 填价格 + 选状态
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

  // ② 作废＝软删（和「撤销」一个规矩：状态改掉，还在等的投递一起作废）
  if (action === 'void') {
    if (post.status === util.POST_CLOSED) return { ok: true, action, status: util.POST_CLOSED };
    await db.run('UPDATE posts SET status = ? WHERE id = ?', [util.POST_CLOSED, pid]);
    const pending = await db.all('SELECT * FROM bookings WHERE post_id = ? AND status = ?',
      [pid, util.STATUS_PENDING]);
    for (const booking of pending) {
      await db.run('UPDATE bookings SET status = ? WHERE id = ?',
        [util.STATUS_CANCELLED, Number(booking.id)]);   // eslint-disable-line no-await-in-loop
      await notify.addMessage(                          // eslint-disable-line no-await-in-loop
        db, '这条需求被平台作废了',
        '你投递过的' + post.subject + '需求（' + when + '）平台已经作废，这次不用再等确认了。',
        0, Number(booking.teacher_id), pid
      );
    }
    await logFix(db, role, accountId, 'post', pid, post.status, util.POST_CLOSED, note);
    return { ok: true, action, status: util.POST_CLOSED };
  }

  // ③ 改状态
  const status = util.plain(body.status);
  if (POST_FIX_STATUSES.indexOf(status) < 0) {
    throw new ApiError('单子状态只能改成：' + POST_FIX_STATUSES.join(' / ') + '。');
  }
  if (status === post.status) return { ok: true, action: 'status', status };
  await db.run('UPDATE posts SET status = ? WHERE id = ?', [status, pid]);
  await logFix(db, role, accountId, 'post', pid, post.status, status, note);
  return { ok: true, action: 'status', status };
}

/*
 * 订单修正：只能改状态（受控那 5 个）。改成「已取消」时顺手把单子放回招募中，
 * 和正常取消那条路保持一致，免得单子挂死在「已成交」上。
 */
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
