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

async function removeByBooking(db, bookingId) {
  const id = Number(bookingId);
  if (!(id > 0)) return 0;
  const result = await db.run('DELETE FROM messages WHERE booking_id = ?', [id]);
  return (result && Number(result.changes)) || 0;
}

module.exports = { addMessage, removeByBooking };
