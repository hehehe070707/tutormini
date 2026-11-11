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

async function listEvents(db, since, limit) {
  const from = Number(since) || 0;
  const size = Math.min(200, Math.max(1, Number(limit) || 50));
  const rows = await db.all(
    'SELECT * FROM agent_events WHERE id > ? ORDER BY id LIMIT ' + size,
    [from]
  );
  return rows.map(readEvent);
}

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

      await db.run('UPDATE agent_events SET attempts = attempts + 1 WHERE id = ?', [Number(row.id)]);
    }
  }
  return { sent, skipped: false };
}

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
    const agent = Number(row.agent_id) > 0 ? await agentById(db, Number(row.agent_id)) : null;
    list.push(readMessage(row, agent));
  }
  return list;
}

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

function postStatusText(status) {
  const text = util.plain(status);
  if (text === util.POST_PENDING_REVIEW) return '待上架';
  return text;
}

function boxPostView(post) {
  if (!post) return null;
  return {
    id: Number(post.id),
    code: post.code || '',

    publisherName: util.PLATFORM_NAME,
    subject: post.subject || '',
    grade: post.grade || '',
    timeText: util.displayTime(post.day, post.period),
    price: post.price || '',
    area: post.area || '',
    note: post.note || '',

    requirements: util.parseRequirements(post.requirements),

    rawText: post.raw_text || '',
    createdAt: post.created_at || ''
  };
}

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
    const info = await boxStatusOf(db, postId, role, id);

    const msgs = await db.all(
      'SELECT * FROM messages WHERE ' + column + ' = ? AND post_id = ? ORDER BY id',
      [id, postId]
    );

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

    if (role === util.ROLE_STUDENT) {
      const all = await db.get(
        'SELECT COUNT(*) AS total FROM bookings WHERE post_id = ? AND status <> ?',
        [postId, util.STATUS_CANCELLED]
      );
      const wait = await db.get(
        'SELECT COUNT(*) AS total FROM bookings WHERE post_id = ? AND status = ?',
        [postId, util.STATUS_PENDING]
      );
      card.inviteCount = all ? Number(all.total) : 0;
      card.pendingCount = wait ? Number(wait.total) : 0;
    }
    list.push(card);
  }

  return list.sort((a, b) => b.lastId - a.lastId);
}

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

  return {
    post: Object.assign({}, info.post, {
      status: info.status,
      statusText: info.statusText
    }),
    list: rows.map((row) => readMessage(row))
  };
}

async function markThreadRead(db, role, accountId, postId) {
  const column = role === util.ROLE_TEACHER ? 'teacher_id' : 'student_id';
  const result = await db.run(
    'UPDATE messages SET is_read = 1 WHERE ' + column + ' = ? AND post_id = ? AND is_read = 0',
    [Number(accountId), Number(postId)]
  );
  return result.changes > 0;
}

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
    const agent = await agentById(db, agentId);
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
