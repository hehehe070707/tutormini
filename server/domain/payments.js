/*
 * 收款 / 退款域（平台侧和老师之间的钱）。
 *
 * 实际流程（群里跑的）：平台确认接单之后发合同 + 收款码给老师 → 老师付款 →
 * 平台核对到账 → 开始试课；试课没上成 → 平台确认退款（全额）；上过一次课 →
 * 按合同退款（扣掉已上的次数，具体金额由平台填，这里只记账不判断比例）。
 *
 * 钱走的是微信收款码，平台外完成，小程序这边只记「谁该收多少、收到没有、退了多少」。
 * payments 表：一条 charge（收款）+ 若干条 refund（退款）。
 */

const util = require('../lib/util.js');
const { ApiError } = require('../lib/errors.js');
const notify = require('./notify.js');

function readPayment(row) {
  return {
    id: Number(row.id),
    bookingId: Number(row.booking_id),
    kind: row.kind === util.PAY_REFUND ? util.PAY_REFUND : util.PAY_CHARGE,
    isRefund: row.kind === util.PAY_REFUND,
    amount: Number(row.amount) || 0,
    status: row.status,
    method: row.method || '',
    note: row.note || '',
    contractUrl: row.contract_url || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at || ''
  };
}

async function listForBooking(db, bookingId) {
  const rows = await db.all(
    'SELECT * FROM payments WHERE booking_id = ? ORDER BY id',
    [Number(bookingId)]
  );
  return rows.map(readPayment);
}

/*
 * 一次查好一批订单的收款记录，贴到 booking.payments / booking.payStats 上。
 * payStats 给页面直接用：
 *   charge        当前那条收款（没有就是 null）
 *   received      是否已确认收款（老师付款到位）
 *   refunded      退款总额
 *   netAmount     算下来平台这边实际留下多少（收款 - 退款）
 */
async function attach(db, bookings) {
  for (const booking of bookings) {
    const list = await listForBooking(db, booking.id);
    const charge = list.filter((item) => !item.isRefund).slice(-1)[0] || null;
    const refunded = list.filter((item) => item.isRefund)
      .reduce((sum, item) => sum + item.amount, 0);
    booking.payments = list;                              // eslint-disable-line no-param-reassign
    booking.payStats = {                                  // eslint-disable-line no-param-reassign
      charge,
      received: !!charge && charge.status === util.PAY_RECEIVED,
      refunded,
      netAmount: (charge ? charge.amount : 0) - refunded
    };
  }
  return bookings;
}

async function loadBooking(db, bookingId) {
  const row = await db.get('SELECT * FROM bookings WHERE id = ?', [Number(bookingId)]);
  if (!row) throw new ApiError('找不到这条订单。');
  return row;
}

function assertStudentOwns(booking, accountId) {
  if (Number(booking.student_id) !== Number(accountId)) {
    throw new ApiError('这条订单不是你的，不能操作。');
  }
}

function assertTeacherOwns(booking, accountId) {
  if (Number(booking.teacher_id) !== Number(accountId)) {
    throw new ApiError('这条课不是你接的，不能操作。');
  }
}

/*
 * 平台发合同 + 收款码：写一条（或更新）收款记录。
 * 订单还没最后结束、而且还没确认收到钱的时候才能改（收到钱之后再改金额没意义）。
 */
async function setContract(db, bookingId, role, accountId, options) {
  if (role !== util.ROLE_STUDENT) throw new ApiError('只有平台端能设置合同和收款。', 403);
  const opts = options || {};
  const amount = Math.max(0, Math.round(Number(opts.amount) || 0));
  const contractUrl = util.plain(opts.contractUrl);
  const note = util.stripContacts(opts.note);

  const booking = await loadBooking(db, bookingId);
  assertStudentOwns(booking, accountId);
  if (!util.isActiveBooking(booking.status)) throw new ApiError('这条订单已经结束了，不用再发合同。');

  const existing = await db.get(
    'SELECT * FROM payments WHERE booking_id = ? AND kind = ? ORDER BY id DESC LIMIT 1',
    [Number(booking.id), util.PAY_CHARGE]
  );
  if (existing && existing.status === util.PAY_RECEIVED) {
    throw new ApiError('已经确认收到这笔款了，不能再改合同金额。');
  }
  const now = util.nowText();
  if (existing) {
    await db.run(
      'UPDATE payments SET amount = ?, contract_url = ?, note = ?, updated_at = ? WHERE id = ?',
      [amount, contractUrl, note, now, Number(existing.id)]
    );
    return { id: Number(existing.id), amount, contractUrl };
  }

  const result = await db.run(
    `INSERT INTO payments (booking_id, teacher_id, student_id, kind, amount, status, method, note,
                           contract_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)`,
    [
      Number(booking.id), Number(booking.teacher_id), Number(booking.student_id),
      util.PAY_CHARGE, amount, util.PAY_PENDING, note, contractUrl, now, now
    ]
  );
  await notify.addMessage(
    db,
    '合同和收款码已发出',
    '订单的合同和收款码已经发出，金额 ' + (amount > 0 ? amount + ' 元' : '待确认') +
      '，付款后点一下「我已付款」，平台核对到账就可以开始试课。',
    0, Number(booking.teacher_id), Number(booking.post_id) || 0);
  return { id: Number(result.lastId), amount, contractUrl };
}

// 老师点「我已付款」：只是告诉平台"我付了"，真正算数的是平台确认
async function markPaid(db, paymentId, role, accountId) {
  const payment = await db.get('SELECT * FROM payments WHERE id = ?', [Number(paymentId)]);
  if (!payment) throw new ApiError('找不到这条收款记录。');
  if (payment.kind !== util.PAY_CHARGE) throw new ApiError('这条不是收款记录。');
  if (role !== util.ROLE_TEACHER) throw new ApiError('只有老师能标记「我已付款」。', 403);
  const booking = await loadBooking(db, payment.booking_id);
  assertTeacherOwns(booking, accountId);
  if (payment.status === util.PAY_RECEIVED) throw new ApiError('这笔款平台已经确认收到了。');
  if (payment.status === util.PAY_REFUNDED) throw new ApiError('这笔款已经退了。');

  await db.run(
    'UPDATE payments SET status = ?, updated_at = ? WHERE id = ?',
    [util.PAY_CLAIMED, util.nowText(), Number(payment.id)]
  );
  await notify.addMessage(
    db,
    '老师已付款',
    '老师点了「我已付款」，金额 ' + (Number(payment.amount) > 0 ? payment.amount + ' 元' : '待确认') +
      '，核对一下到账后点「确认收款」。',
    Number(booking.student_id), 0, Number(booking.post_id) || 0);
  return true;
}

// 平台点「确认收款」：这一单才算真的收到钱，之后老师才能开始试课
async function confirmReceipt(db, paymentId, role, accountId) {
  const payment = await db.get('SELECT * FROM payments WHERE id = ?', [Number(paymentId)]);
  if (!payment) throw new ApiError('找不到这条收款记录。');
  if (payment.kind !== util.PAY_CHARGE) throw new ApiError('这条不是收款记录。');
  if (role !== util.ROLE_STUDENT) throw new ApiError('只有平台端能确认收款。', 403);
  const booking = await loadBooking(db, payment.booking_id);
  assertStudentOwns(booking, accountId);
  if (payment.status === util.PAY_RECEIVED) throw new ApiError('这笔款已经确认过了。');
  if (payment.status === util.PAY_REFUNDED) throw new ApiError('这笔款已经退了，不能再确认收款。');

  await db.run(
    'UPDATE payments SET status = ?, updated_at = ? WHERE id = ?',
    [util.PAY_RECEIVED, util.nowText(), Number(payment.id)]
  );
  await notify.addMessage(
    db,
    '收款已确认',
    '平台已经确认收到你的付款，可以按约定时间开始试课了。',
    0, Number(booking.teacher_id), Number(booking.post_id) || 0);
  return true;
}

/*
 * 平台确认退款：没上成退全额，上过一次按合同扣（金额由平台填）。
 * 一条退款记录单独存下来，收款那条标成「已退款」，两边都看得见。
 */
async function refund(db, paymentId, role, accountId, options) {
  const payment = await db.get('SELECT * FROM payments WHERE id = ?', [Number(paymentId)]);
  if (!payment) throw new ApiError('找不到这条收款记录。');
  if (payment.kind !== util.PAY_CHARGE) throw new ApiError('这条不是收款记录。');
  if (role !== util.ROLE_STUDENT) throw new ApiError('只有平台端能确认退款。', 403);
  const booking = await loadBooking(db, payment.booking_id);
  assertStudentOwns(booking, accountId);

  const opts = options || {};
  const chargeAmount = Number(payment.amount) || 0;
  let amount = opts.amount === undefined || opts.amount === null || opts.amount === ''
    ? chargeAmount : Math.round(Number(opts.amount) || 0);
  if (amount < 0) amount = 0;
  if (amount > chargeAmount) amount = chargeAmount;
  const note = util.stripContacts(opts.note);
  const now = util.nowText();

  const result = await db.run(
    `INSERT INTO payments (booking_id, teacher_id, student_id, kind, amount, status, method, note,
                           contract_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, '', ?, ?)`,
    [
      Number(booking.id), Number(booking.teacher_id), Number(booking.student_id),
      util.PAY_REFUND, amount, util.PAY_REFUNDED, note, now, now
    ]
  );
  await db.run(
    'UPDATE payments SET status = ?, updated_at = ? WHERE id = ?',
    [util.PAY_REFUNDED, now, Number(payment.id)]
  );
  await notify.addMessage(
    db,
    '已确认退款',
    '平台已确认退款 ' + amount + ' 元' + (note === '' ? '。' : '（' + note + '）。'),
    0, Number(booking.teacher_id), Number(booking.post_id) || 0);
  return { id: Number(result.lastId), amount };
}

// 老师提交试课前查一下：平台发了收款码但还没确认收到钱，就先别开课
async function assertTrialUnlocked(db, booking) {
  const charge = await db.get(
    'SELECT * FROM payments WHERE booking_id = ? AND kind = ? ORDER BY id DESC LIMIT 1',
    [Number(booking.id), util.PAY_CHARGE]
  );
  if (!charge) return true;                    // 没走过收款流程（老数据 / 没发合同）不拦
  if (charge.status !== util.PAY_RECEIVED) {
    throw new ApiError('平台还没确认收到付款，等确认收款后再提交试课。');
  }
  return true;
}

module.exports = {
  readPayment,
  listForBooking,
  attach,
  setContract,
  markPaid,
  confirmReceipt,
  refund,
  assertTrialUnlocked
};
