/*
 * 外部 Agent 接入域（只留接口和钩子，不含任何 LLM / 对话策略）。
 *
 * 三块东西：
 *   1) 虚拟账号 agents + 访问令牌 agent_tokens
 *      外部 Agent 带 X-Agent-Token 调接口；库里只存摘要，绑定一个学生账号（平台账号），
 *      可以吊销。老师在消息中心看到的「官方助手」就是这里的虚拟账号。
 *   2) 事件钩子 agent_events
 *      关键节点（老师投递 / 平台确认 / 平台拒绝 / 合同可发）先落库；
 *      配了 AGENT_WEBHOOK_URL 就异步 POST 出去，外部 Agent 收到后自己决定干什么。
 *   3) 消息中心
 *      Agent 发的消息写进 chats（老师能回）和 messages（统一收件箱，合同消息点开看链接）。
 */

const util = require('../lib/util.js');
const { ApiError } = require('../lib/errors.js');

const EVENT_BOOKING_CREATED = 'booking_created';
const EVENT_BOOKING_CONFIRMED = 'booking_confirmed';
const EVENT_BOOKING_REJECTED = 'booking_rejected';
const EVENT_CONTRACT_READY = 'contract_ready';
const DEFAULT_AGENT_NAME = '平台助手';
const DEFAULT_AGENT_INTRO = '平台官方助手，负责发单、通知和合同。';

function readAgent(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    avatar: row.avatar || '🤖',
    intro: row.intro || '',
    ownerStudentId: Number(row.owner_student_id) || 0,
    isOfficial: Number(row.is_official) === 1
  };
}

// 一个平台账号对应一个官方助手：没有就建一个（第一次用 Agent 接口 / 发单时自动生成）
async function ensureAgent(db, studentId, options) {
  const sid = Number(studentId);
  if (!(sid >= 0)) throw new ApiError('这个助手没有绑定平台账号。');
  const opts = options || {};
  const existing = await db.get(
    'SELECT * FROM agents WHERE owner_student_id = ? ORDER BY id LIMIT 1',
    [sid]
  );
  if (existing) return readAgent(existing);

  const result = await db.run(
    `INSERT INTO agents (name, avatar, intro, owner_student_id, is_official, created_at)
     VALUES (?, ?, ?, ?, 1, ?)`,
    [
      util.plain(opts.name) || DEFAULT_AGENT_NAME,
      util.plain(opts.avatar) || '🤖',
      util.plain(opts.intro) || DEFAULT_AGENT_INTRO,
      sid,
      util.nowText()
    ]
  );
  const row = await db.get('SELECT * FROM agents WHERE id = ?', [Number(result.lastId)]);
  return readAgent(row);
}

async function agentById(db, agentId) {
  const row = await db.get('SELECT * FROM agents WHERE id = ?', [Number(agentId)]);
  return readAgent(row);
}

/*
 * 签发 Agent 令牌：返回明文（只在这一刻给出去一次），库里只留 SHA-256 摘要。
 * 日常用 tools/agent-token.js 这个脚本调，不在小程序里暴露入口。
 */
async function issueToken(db, studentId, agentId, label) {
  const token = util.newToken();
  await db.run(
    `INSERT INTO agent_tokens (token_hash, agent_id, student_id, label, revoked, created_at, last_used_at)
     VALUES (?, ?, ?, ?, 0, ?, '')`,
    [util.sha256(token), Number(agentId), Number(studentId), util.plain(label), util.nowText()]
  );
  return token;
}

async function revokeToken(db, tokenId) {
  await db.run('UPDATE agent_tokens SET revoked = 1 WHERE id = ?', [Number(tokenId)]);
  return true;
}

// 校验 X-Agent-Token → { tokenId, agentId, studentId }；无效 / 已吊销返回 null
async function resolveToken(db, token) {
  const text = util.plain(token);
  if (text === '') return null;
  const row = await db.get('SELECT * FROM agent_tokens WHERE token_hash = ?', [util.sha256(text)]);
  if (!row || Number(row.revoked) === 1) return null;
  await db.run('UPDATE agent_tokens SET last_used_at = ? WHERE id = ?', [util.nowText(), Number(row.id)]);
  return {
    tokenId: Number(row.id),
    agentId: Number(row.agent_id),
    studentId: Number(row.student_id)
  };
}

// ==================== 事件钩子 ====================

/*
 * 落一条事件。payload 传对象，存成 JSON 字符串。
 * 注意：这个函数经常在事务里被调用，所以只写库、不发网络请求；真正的 webhook
 * 投递在事务提交之后由 flush() 完成。
 */
async function emit(db, type, payload, meta) {
  const data = meta || {};
  const result = await db.run(
    `INSERT INTO agent_events (type, payload, ref_id, student_id, teacher_id, status, attempts,
                               created_at, delivered_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, '')`,
    [
      util.plain(type),
      JSON.stringify(payload || {}),
      Number(data.refId) || 0,
      Number(data.studentId) || 0,
      Number(data.teacherId) || 0,
      util.nowText()
    ]
  );
  return Number(result.lastId);
}

function readEvent(row) {
  let payload = {};
  try {
    payload = JSON.parse(row.payload || '{}');
  } catch (e) {
    payload = {};
  }
  return {
    id: Number(row.id),
    type: row.type,
    payload,
    refId: Number(row.ref_id) || 0,
    studentId: Number(row.student_id) || 0,
    teacherId: Number(row.teacher_id) || 0,
    status: row.status,
    attempts: Number(row.attempts) || 0,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at || ''
  };
}

// 外部 Agent 主动拉（和 webhook 二选一）：since = 上次拿到的最大 id
async function listEvents(db, since, limit) {
  const from = Number(since) || 0;
  const size = Math.min(200, Math.max(1, Number(limit) || 50));
  const rows = await db.all(
    'SELECT * FROM agent_events WHERE id > ? ORDER BY id LIMIT ' + size,
    [from]
  );
  return rows.map(readEvent);
}

/*
 * 把还没投出去的事件 POST 给 AGENT_WEBHOOK_URL。
 * 零依赖：用 Node 自带的 fetch；失败记 attempts，下次还有机会（不阻塞主流程）。
 * 没配 webhook 就直接返回，事件留在库里等外部 Agent 自己来拉。
 */
async function flush(db, config) {
  const url = config && config.agentWebhookUrl ? String(config.agentWebhookUrl) : '';
  if (url === '') return { sent: 0, skipped: true };
  const rows = await db.all(
    "SELECT * FROM agent_events WHERE status = 'pending' ORDER BY id LIMIT 20"
  );
  let sent = 0;
  for (const row of rows) {
    const event = readEvent(row);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      let ok = false;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: event.type, data: event }),
          signal: controller.signal
        });
        ok = res.ok;
      } finally {
        clearTimeout(timer);
      }
      if (ok) {
        sent++;
        await db.run(
          "UPDATE agent_events SET status = 'delivered', delivered_at = ?, attempts = attempts + 1 WHERE id = ?",
          [util.nowText(), Number(row.id)]
        );
      } else {
        await db.run(
          "UPDATE agent_events SET attempts = attempts + 1 WHERE id = ?",
          [Number(row.id)]
        );
      }
    } catch (e) {
      // 网络不通 / 超时：留在 pending，下次请求再试
      await db.run('UPDATE agent_events SET attempts = attempts + 1 WHERE id = ?', [Number(row.id)]);
    }
  }
  return { sent, skipped: false };
}

// ==================== 消息中心 ====================

async function listMessages(db, role, accountId, limit) {
  const id = Number(accountId);
  if (!(id >= 0)) return [];
  const size = Math.min(200, Math.max(1, Number(limit) || 50));
  const column = role === util.ROLE_TEACHER ? 'teacher_id' : 'student_id';
  const rows = await db.all(
    'SELECT * FROM messages WHERE ' + column + ' = ? ORDER BY id DESC LIMIT ' + size,
    [id]
  );
  const list = [];
  for (const row of rows) {
    const agent = Number(row.agent_id) > 0 ? await agentById(db, Number(row.agent_id)) : null; // eslint-disable-line no-await-in-loop
    list.push(readMessage(row, agent));
  }
  return list;
}

// 一条通知的展示结构（列表 / 单子卡片详情共用）
function readMessage(row, agent) {
  return {
    id: Number(row.id),
    title: row.title,
    body: row.body,
    senderType: row.sender_type || util.SENDER_SYSTEM,
    isAgent: row.sender_type === util.SENDER_AGENT,
    senderName: agent ? agent.name : '',
    kind: row.kind || 'system',
    contractUrl: row.contract_url || '',
    // 挂在哪条单子下面（0 = 不挂单子：合同 / 系统公告这类）
    postId: Number(row.post_id) || 0,
    isRead: Number(row.is_read) === 1,
    createdAt: row.created_at
  };
}

async function markMessageRead(db, messageId, role, accountId) {
  const column = role === util.ROLE_TEACHER ? 'teacher_id' : 'student_id';
  const row = await db.get('SELECT * FROM messages WHERE id = ?', [Number(messageId)]);
  if (!row) throw new ApiError('找不到这条通知。');
  if (Number(row[column]) !== Number(accountId)) throw new ApiError('这条通知不是你的。');
  await db.run('UPDATE messages SET is_read = 1 WHERE id = ?', [Number(messageId)]);
  return true;
}

async function unreadMessageCount(db, role, accountId) {
  const id = Number(accountId);
  if (!(id >= 0)) return 0;
  const column = role === util.ROLE_TEACHER ? 'teacher_id' : 'student_id';
  const row = await db.get(
    'SELECT COUNT(*) AS total FROM messages WHERE ' + column + ' = ? AND is_read = 0',
    [id]
  );
  return row ? Number(row.total) : 0;
}

// ==================== 老师端「我的单子」卡片 ====================
/*
 * 老师投一次简历，就在消息页多一张单子卡片（标题是单号，比如 20261008-1），
 * 用来从头到尾看这条单子走到哪一步了：待确认 / 试课中 / 主订单进行中 / 已结束……
 * 卡片 = 同一张单子（messages.post_id）下发给这位老师的全部通知。
 * 每张卡片带一份 list（这条单子的全部消息，时间正序）：消息页把消息直接铺在卡片上，
 * 不用点进去；状态变了只改卡片上的状态那一栏，不会再多出一张卡片。
 * 注意：这里只查库，不 require posts.js —— posts.js 反过来依赖本文件的 emit，
 * 免得绕成循环依赖。
 */

function postStatusText(status) {
  const text = util.plain(status);
  if (text === util.POST_PENDING_REVIEW) return '待上架';
  return text;
}

/*
 * 一张卡片上的「单子全部属性」：老师端不点进去就要看到整条需求
 * （科目 / 年级 / 时间 / 价格 / 位置 / 说明 / 对老师的要求 / 家长原话 / 发布时间）。
 * 和 posts.js 的 readPost 一套字段，只是这里不去碰 match、投递那些列表相关的部分；
 * 要求那句中文由客户端用 requirementsText 拼（和接单页同一个函数）。
 */
function boxPostView(post) {
  if (!post) return null;
  return {
    id: Number(post.id),
    code: post.code || '',
    // 老师端只看到「平台」，客户姓名 / 电话不下发
    publisherName: util.PLATFORM_NAME,
    subject: post.subject || '',
    grade: post.grade || '',
    timeText: util.displayTime(post.day, post.period),
    price: post.price || '',
    area: post.area || '',
    note: post.note || '',
    // 结构化要求（性别 / 学历 / 教龄 / 证书 / 授课方式 / 时薪）；老数据是「不限」，照旧全不显示
    requirements: util.parseRequirements(post.requirements),
    // 家长原话：只展示，不参与筛选和匹配
    rawText: post.raw_text || '',
    createdAt: post.created_at || ''
  };
}

/*
 * 一张卡片的状态：
 *   老师端 → 我自己投的那条预约走到哪一步（没投过就显示单子本身的状态）
 *   中介端 → 这条单子走到哪一步（已成交就显示那位老师的订单状态；已撤销就是已撤销）
 * 两边都用同一份单子属性（boxPostView），页面上的卡片长得一样。
 */
async function boxStatusOf(db, postId, role, accountId) {
  const pid = Number(postId);
  const post = await db.get('SELECT * FROM posts WHERE id = ?', [pid]);
  let booking = null;
  if (role === util.ROLE_TEACHER) {
    booking = await db.get(
      'SELECT id, status FROM bookings WHERE post_id = ? AND teacher_id = ? ORDER BY id DESC LIMIT 1',
      [pid, Number(accountId)]
    );
  } else if (post) {
    // 中介侧：优先看单子上记的那条订单，没有就找最近一条没被取消的投递
    if (Number(post.booking_id) > 0) {
      booking = await db.get('SELECT id, status FROM bookings WHERE id = ?', [Number(post.booking_id)]);
    }
    if (!booking) {
      booking = await db.get(
        'SELECT id, status FROM bookings WHERE post_id = ? AND status <> ? ORDER BY id DESC LIMIT 1',
        [pid, util.STATUS_CANCELLED]
      );
    }
  }
  // 单子已经撤销：状态就说撤销，别再拿订单状态盖过去
  const used = post && post.status === util.POST_CLOSED ? null : booking;
  return {
    post: boxPostView(post),
    booking,
    status: used ? used.status : (post ? post.status : ''),
    statusText: used
      ? util.bookingStatusText(used.status)
      : postStatusText(post ? post.status : '')
  };
}

// 老师端 / 中介端都能用：按角色取自己那一列（teacher_id / student_id）
async function messageBoxes(db, role, accountId) {
  const id = Number(accountId);
  if (!(id >= 0)) return [];
  const column = role === util.ROLE_TEACHER ? 'teacher_id' : 'student_id';
  const rows = await db.all(
    'SELECT * FROM messages WHERE ' + column + ' = ? AND post_id > 0 ORDER BY id',
    [id]
  );
  const seen = {};
  const order = [];
  for (const row of rows) {
    const postId = Number(row.post_id);
    if (!seen[postId]) {
      seen[postId] = { postId, unread: 0, count: 0, last: row };
      order.push(postId);
    }
    const box = seen[postId];
    box.last = row;
    box.count++;
    if (Number(row.is_read) === 0) box.unread++;
  }

  const list = [];
  for (const postId of order) {
    const box = seen[postId];
    const info = await boxStatusOf(db, postId, role, id);   // eslint-disable-line no-await-in-loop
    /*
     * 消息页不再点进二级页看，所以卡片直接把这条单子的全部消息带上（时间正序）。
     * 数据量很小（一条单子几条到十几条），一次请求拿全，比逐个卡片再发一次请求省事。
     */
    const msgs = await db.all(                          // eslint-disable-line no-await-in-loop
      'SELECT * FROM messages WHERE ' + column + ' = ? AND post_id = ? ORDER BY id',
      [id, postId]
    );
    // 卡片 = 这条单子的全部属性 + 状态 + 全部消息（用 Object.assign 铺开，字段不够时页面会兜空）
    const card = Object.assign({}, info.post, {
      postId,
      status: info.status,
      statusText: info.statusText,
      bookingId: info.booking ? Number(info.booking.id) : 0,
      unread: box.unread,
      count: box.count,
      lastTitle: box.last.title,
      lastBody: box.last.body,
      lastAt: box.last.created_at,
      lastId: Number(box.last.id),
      list: msgs.map((row) => readMessage(row))
    });
    // 中介端多带一份投递情况：卡片 / 工作台上要写"收到几条投递、待你确认几条"
    if (role === util.ROLE_STUDENT) {
      const all = await db.get(                          // eslint-disable-line no-await-in-loop
        'SELECT COUNT(*) AS total FROM bookings WHERE post_id = ? AND status <> ?',
        [postId, util.STATUS_CANCELLED]
      );
      const wait = await db.get(                         // eslint-disable-line no-await-in-loop
        'SELECT COUNT(*) AS total FROM bookings WHERE post_id = ? AND status = ?',
        [postId, util.STATUS_PENDING]
      );
      card.inviteCount = all ? Number(all.total) : 0;
      card.pendingCount = wait ? Number(wait.total) : 0;
    }
    list.push(card);
  }
  // 最近有动静的单子排前面
  return list.sort((a, b) => b.lastId - a.lastId);
}

// 一张卡片点开：这条单子给这位老师的全部通知（按时间正序，像一段聊天记录）
async function messageThread(db, role, accountId, postId) {
  const id = Number(accountId);
  const pid = Number(postId);
  if (!(id >= 0) || !(pid > 0)) return null;
  const info = await boxStatusOf(db, pid, role, id);
  if (!info.post) return null;
  const column = role === util.ROLE_TEACHER ? 'teacher_id' : 'student_id';
  const rows = await db.all(
    'SELECT * FROM messages WHERE ' + column + ' = ? AND post_id = ? ORDER BY id',
    [id, pid]
  );
  // 和卡片同一份属性（这条单子走到哪一步 + 它本身长什么样）
  return {
    post: Object.assign({}, info.post, {
      status: info.status,
      statusText: info.statusText
    }),
    list: rows.map((row) => readMessage(row))
  };
}

// 进了消息页就把这条单子的通知全部标已读（底部导航红点跟着减）
async function markThreadRead(db, role, accountId, postId) {
  const column = role === util.ROLE_TEACHER ? 'teacher_id' : 'student_id';
  const result = await db.run(
    'UPDATE messages SET is_read = 1 WHERE ' + column + ' = ? AND post_id = ? AND is_read = 0',
    [Number(accountId), Number(postId)]
  );
  return result.changes > 0;
}

// ==================== 老师和「官方助手」的会话 ====================

function readAgentMessage(row, agent) {
  return {
    id: Number(row.id),
    fromAgent: row.sender_role === util.ROLE_AGENT || row.sender_type === util.SENDER_AGENT,
    body: row.body,
    agentName: agent ? agent.name : '',
    createdAt: row.created_at
  };
}

async function agentChatList(db, teacherId, agentId) {
  const rows = await db.all(
    'SELECT * FROM chats WHERE teacher_id = ? AND agent_id = ? ORDER BY id',
    [Number(teacherId), Number(agentId)]
  );
  const agent = await agentById(db, agentId);
  return rows.map((row) => readAgentMessage(row, agent));
}

// 老师发给助手：不受"轮流一条"限制（对面是平台官方，不是陌生老师/家长）
async function agentChatSend(db, teacherId, agentId, body) {
  const text = util.plain(body);
  if (text === '') throw new ApiError('消息不能为空。');
  const agent = await agentById(db, agentId);
  if (!agent) throw new ApiError('找不到这个官方助手。');
  const result = await db.run(
    `INSERT INTO chats (student_id, teacher_id, agent_id, sender_role, sender_type, body, is_read, created_at)
     VALUES (?, ?, ?, ?, 'user', ?, 0, ?)`,
    [Number(agent.ownerStudentId), Number(teacherId), Number(agentId), util.ROLE_TEACHER, text, util.nowText()]
  );
  return { id: Number(result.lastId) };
}

// 助手发给老师：写会话 +（合同 / 系统消息）写统一收件箱
async function agentMessage(db, agentId, teacherId, type, content, contractUrl) {
  const agent = await agentById(db, agentId);
  if (!agent) throw new ApiError('找不到这个官方助手。');
  const teacher = await db.get('SELECT id FROM teachers WHERE id = ?', [Number(teacherId)]);
  if (!teacher) throw new ApiError('找不到这位老师。');

  const text = util.plain(content);
  if (text === '' && util.plain(contractUrl) === '') throw new ApiError('消息内容不能为空。');
  const kind = ['text', 'contract', 'system'].indexOf(util.plain(type)) >= 0 ? util.plain(type) : 'text';
  const now = util.nowText();

  const result = await db.run(
    `INSERT INTO chats (student_id, teacher_id, agent_id, sender_role, sender_type, body, is_read, created_at)
     VALUES (?, ?, ?, ?, 'agent', ?, 0, ?)`,
    [Number(agent.ownerStudentId), Number(teacherId), Number(agentId), util.ROLE_AGENT, text, now]
  );

  // 合同 / 系统类额外进统一收件箱（纯聊天只留会话，免得同一条出现两遍）
  if (kind !== 'text') {
    await db.run(
      `INSERT INTO messages (title, body, student_id, teacher_id, sender_type, agent_id, kind,
                             contract_url, is_read, created_at)
       VALUES (?, ?, 0, ?, ?, ?, ?, ?, 0, ?)`,
      [
        kind === 'contract' ? '合同已送达' : agent.name,
        text === '' ? '（点开查看合同）' : text,
        Number(teacherId),
        util.SENDER_AGENT,
        Number(agentId),
        kind,
        util.plain(contractUrl),
        now
      ]
    );
  }
  return { id: Number(result.lastId), kind };
}

async function agentChatUnread(db, teacherId, agentId) {
  const row = await db.get(
    `SELECT COUNT(*) AS total FROM chats
     WHERE teacher_id = ? AND agent_id = ? AND sender_role = ? AND is_read = 0`,
    [Number(teacherId), Number(agentId), util.ROLE_AGENT]
  );
  return row ? Number(row.total) : 0;
}

async function agentChatMarkRead(db, teacherId, agentId) {
  const result = await db.run(
    `UPDATE chats SET is_read = 1
     WHERE teacher_id = ? AND agent_id = ? AND sender_role = ? AND is_read = 0`,
    [Number(teacherId), Number(agentId), util.ROLE_AGENT]
  );
  return result.changes > 0;
}

// 老师在「官方助手」会话里的未读总数（底部导航红点用）
async function unreadAgentChatCount(db, teacherId) {
  const tid = Number(teacherId);
  if (!(tid >= 0)) return 0;
  const row = await db.get(
    `SELECT COUNT(*) AS total FROM chats
     WHERE teacher_id = ? AND agent_id > 0 AND sender_role = ? AND is_read = 0`,
    [tid, util.ROLE_AGENT]
  );
  return row ? Number(row.total) : 0;
}

// 消息页用：老师这边有会话的官方助手（带最后一条 + 未读）
async function agentPeers(db, teacherId) {
  const tid = Number(teacherId);
  if (!(tid >= 0)) return [];
  const rows = await db.all(
    'SELECT * FROM chats WHERE teacher_id = ? AND agent_id > 0 ORDER BY id',
    [tid]
  );
  const seen = {};
  const list = [];
  for (const row of rows) {
    const agentId = Number(row.agent_id);
    if (!seen[agentId]) {
      seen[agentId] = { last: row, unread: 0 };
    } else {
      seen[agentId].last = row;
    }
    if (row.sender_role === util.ROLE_AGENT && Number(row.is_read) === 0) seen[agentId].unread++;
  }
  for (const key of Object.keys(seen)) {
    const agentId = Number(key);
    const agent = await agentById(db, agentId);   // eslint-disable-line no-await-in-loop
    if (!agent) continue;
    list.push({
      id: agentId,
      isAgent: true,
      official: agent.isOfficial,
      name: agent.name,
      avatar: agent.avatar,
      lastBody: seen[key].last.body,
      lastAt: seen[key].last.created_at,
      unread: seen[key].unread,
      lastId: Number(seen[key].last.id)
    });
  }
  return list.sort((a, b) => b.lastId - a.lastId);
}

module.exports = {
  EVENT_BOOKING_CREATED,
  EVENT_BOOKING_CONFIRMED,
  EVENT_BOOKING_REJECTED,
  EVENT_CONTRACT_READY,
  DEFAULT_AGENT_NAME,
  readAgent,
  ensureAgent,
  agentById,
  issueToken,
  revokeToken,
  resolveToken,
  emit,
  flush,
  listEvents,
  listMessages,
  markMessageRead,
  unreadMessageCount,
  messageBoxes,
  messageThread,
  markThreadRead,
  agentChatList,
  agentChatSend,
  agentMessage,
  agentChatUnread,
  agentChatMarkRead,
  unreadAgentChatCount,
  agentPeers
};
