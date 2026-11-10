/*
 * 站内通知（对应 Qt 版 DatabaseManager 里的 messages 表 + addMessage）。
 * 投递、确认接单、合同、收款、课次这些动作都会写一条，老师端在「消息」页看。
 *
 * studentId / teacherId 传 0 表示这一侧不收。
 * postId 是这条通知挂在哪条单子下面（0 = 不挂单子）：
 *   老师端「消息」页靠它把同一张单子的通知归成一张单子卡片，投一次简历就有一张卡片。
 * bookingId 是这条通知由哪一条投递产生（0 = 跟具体投递无关）：
 *   投递又撤回这种"不影响结果"的动作要把这次投递的通知整条抹掉，靠它定位（见 removeByBooking）。
 */

const util = require('../lib/util.js');

async function addMessage(db, title, body, studentId, teacherId, postId, bookingId) {
  await db.run(
    `INSERT INTO messages (title, body, student_id, teacher_id, post_id, booking_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      title, body, Number(studentId) || 0, Number(teacherId) || 0,
      Number(postId) || 0, Number(bookingId) || 0, util.nowText()
    ]
  );
}

/*
 * 抹掉某一条投递产生的全部通知（双方各一条）。
 * 用在"老师撤回投递 / 平台取消这条投递"上：投递又撤回不影响任何结果，
 * 所以不留记录、不提醒 —— 消息页那张卡片和红点都当这次投递没发生过。
 */
async function removeByBooking(db, bookingId) {
  const id = Number(bookingId);
  if (!(id > 0)) return 0;
  const result = await db.run('DELETE FROM messages WHERE booking_id = ?', [id]);
  return (result && Number(result.changes)) || 0;
}

module.exports = { addMessage, removeByBooking };
