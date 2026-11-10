/*
 * 极简路由：把 URL 映射到 handlers 里的函数，并在进业务之前把 token 换成身份。
 *
 * 鉴权一律以后端为准（对应目标里那句"前端 storage 被改也没用"）：
 *   小程序端只带 token，身份、归属、权限都在这儿重新查一遍。
 */

const { ApiError } = require('../lib/errors.js');
const util = require('../lib/util.js');
const accounts = require('../domain/accounts.js');
const agent = require('../domain/agent.js');
const handlers = require('./handlers.js');

// auth：none = 不用登录；optional = 带了就认；user = 必须登录；teacher/student = 必须是这个身份
const ROUTES = [
  { method: 'GET', path: '/api/health', auth: 'none', handler: handlers.health },

  { method: 'POST', path: '/api/auth/login', auth: 'none', handler: handlers.login },
  { method: 'POST', path: '/api/auth/register', auth: 'none', handler: handlers.register },
  { method: 'POST', path: '/api/auth/wx-login', auth: 'none', handler: handlers.wxLogin },
  { method: 'POST', path: '/api/auth/logout', auth: 'optional', handler: handlers.logout },
  { method: 'GET', path: '/api/auth/me', auth: 'user', handler: handlers.me },
  { method: 'GET', path: '/api/me', auth: 'optional', handler: handlers.dashboard },

  { method: 'GET', path: '/api/teachers', auth: 'none', handler: handlers.teachers },
  { method: 'GET', path: '/api/teachers/subjects', auth: 'none', handler: handlers.subjects },
  { method: 'PUT', path: '/api/teachers/me', auth: 'teacher', handler: handlers.saveTeacherProfile },
  { method: 'PUT', path: '/api/teachers/me/resume', auth: 'teacher', handler: handlers.saveTeacherResume },
  { method: 'GET', path: '/api/teachers/:id', auth: 'none', handler: handlers.teacherById },

  { method: 'GET', path: '/api/students/me', auth: 'student', handler: handlers.studentProfile },
  { method: 'PUT', path: '/api/students/me', auth: 'student', handler: handlers.saveStudentProfile },

  { method: 'GET', path: '/api/bookings/mine', auth: 'user', handler: handlers.myBookings },
  { method: 'POST', path: '/api/bookings/:id/accept', auth: 'user', handler: handlers.acceptBooking },
  { method: 'POST', path: '/api/bookings/:id/reject', auth: 'user', handler: handlers.rejectBooking },
  { method: 'POST', path: '/api/bookings/:id/cancel', auth: 'user', handler: handlers.cancelBooking },
  { method: 'POST', path: '/api/bookings/:id/finish', auth: 'user', handler: handlers.finishBooking },
  // 收款 / 退款：平台发合同和收款码 → 老师「我已付款」→ 平台确认收款 / 确认退款
  { method: 'POST', path: '/api/bookings/:id/contract', auth: 'user', handler: handlers.setContract },
  { method: 'POST', path: '/api/payments/:id/paid', auth: 'user', handler: handlers.claimPaid },
  { method: 'POST', path: '/api/payments/:id/confirm', auth: 'user', handler: handlers.confirmPayment },
  { method: 'POST', path: '/api/payments/:id/refund', auth: 'user', handler: handlers.refundPayment },
  // 老师提交课次：kind = 试课（提交试课完成）/ 正式（完成本次）
  { method: 'POST', path: '/api/bookings/:id/lessons', auth: 'user', handler: handlers.submitLesson },

  // 课次这一层的平台动作：试课通过/不通过、确认本次、有异议、付款；老师那边是改完重提
  { method: 'POST', path: '/api/lessons/:id/resubmit', auth: 'user', handler: handlers.resubmitLesson },
  { method: 'POST', path: '/api/lessons/:id/withdraw', auth: 'user', handler: handlers.withdrawLesson },
  { method: 'POST', path: '/api/lessons/:id/confirm', auth: 'user', handler: handlers.confirmLesson },
  { method: 'POST', path: '/api/lessons/:id/dispute', auth: 'user', handler: handlers.disputeLesson },
  { method: 'POST', path: '/api/lessons/:id/trial', auth: 'user', handler: handlers.trialResult },

  { method: 'GET', path: '/api/posts/open', auth: 'optional', handler: handlers.openPosts },
  // 和 /api/posts/open 同一个实现（接口文档用 /api/posts，页面用 /open）
  { method: 'GET', path: '/api/posts', auth: 'optional', handler: handlers.openPosts },
  { method: 'GET', path: '/api/posts/recommended', auth: 'teacher', handler: handlers.recommendedPosts },
  { method: 'GET', path: '/api/posts/mine', auth: 'user', handler: handlers.myPosts },
  { method: 'POST', path: '/api/posts', auth: 'user', handler: handlers.createPost },
  { method: 'POST', path: '/api/posts/batch', auth: 'user', handler: handlers.batchPosts },
  { method: 'POST', path: '/api/posts/:id/take', auth: 'user', handler: handlers.takePost },
  { method: 'POST', path: '/api/posts/:id/close', auth: 'user', handler: handlers.closePost },
  // 修正：中介手动改状态 / 补录订单 / 作废（受控状态，改一笔记一笔）
  { method: 'POST', path: '/api/posts/:id/correct', auth: 'user', handler: handlers.correctPost },
  { method: 'POST', path: '/api/bookings/:id/correct', auth: 'user', handler: handlers.correctBooking },
  { method: 'GET', path: '/api/corrections', auth: 'user', handler: handlers.listCorrections },

  /*
   * 家长原话 → 结构化要求：中介发单前调这个接口（小程序那边发单页 / 批量发单页）。
   * 解析交给外部 Agent（配了 AGENT_PARSE_URL），没配就用本地兜底规则；失败不阻塞发单。
   */
  { method: 'POST', path: '/api/agent/parse', auth: 'optional', handler: handlers.parseRequirement },

  // 真人聊天整条下线：只保留「老师 ↔ 官方助手」，以及统一的消息中心
  { method: 'GET', path: '/api/agents/mine', auth: 'user', handler: handlers.myAgents },
  { method: 'GET', path: '/api/me/unread', auth: 'user', handler: handlers.myUnread },

  // 官方助手会话：老师 ↔ Agent（和真人会话分开，互不影响）
  { method: 'GET', path: '/api/chats/agent/:agentId', auth: 'teacher', handler: handlers.agentChatWith },
  { method: 'POST', path: '/api/chats/agent/:agentId', auth: 'teacher', handler: handlers.sendAgentChat },
  { method: 'POST', path: '/api/chats/agent/:agentId/read', auth: 'teacher', handler: handlers.readAgentChat },

  // 消息中心：系统通知 / 合同消息 / Agent 消息统一入口
  { method: 'GET', path: '/api/messages/mine', auth: 'user', handler: handlers.myMessages },
  { method: 'POST', path: '/api/messages/:id/read', auth: 'user', handler: handlers.readMessage },
  // 「我的单子」卡片：老师端（投过简历的单）/ 中介端（自己发的单）各一份，一条单子一张卡片
  { method: 'GET', path: '/api/messages/boxes', auth: 'user', handler: handlers.myMessageBoxes },
  { method: 'GET', path: '/api/messages/boxes/:postId', auth: 'user', handler: handlers.myMessageThread },
  { method: 'POST', path: '/api/messages/boxes/:postId/read', auth: 'user', handler: handlers.readMessageThread },

  // ==================== 外部 Agent 专用（带 X-Agent-Token）====================
  { method: 'POST', path: '/api/agent/posts/batch', auth: 'agent', handler: handlers.agentBatchPosts },
  { method: 'POST', path: '/api/agent/message', auth: 'agent', handler: handlers.agentSendMessage },
  { method: 'POST', path: '/api/agent/chat/reply', auth: 'agent', handler: handlers.agentChatReply },
  { method: 'GET', path: '/api/agent/events', auth: 'agent', handler: handlers.agentListEvents }
];

// '/api/teachers/:id' 匹配 '/api/teachers/3' → { id: '3' }
function matchPath(pattern, pathname) {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    const expected = patternParts[i];
    const actual = pathParts[i];
    if (expected.charAt(0) === ':') {
      if (actual === '') return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

function tokenOf(req) {
  const header = util.plain(req.headers['authorization']);
  if (header.toLowerCase().indexOf('bearer ') === 0) return header.slice(7).trim();
  return util.plain(req.headers['x-token']);
}

// 外部 Agent 的令牌走单独的请求头，和登录令牌互不干扰
function agentTokenOf(req) {
  return util.plain(req.headers['x-agent-token']);
}

async function attachAuth(ctx) {
  const token = tokenOf(ctx.req);
  ctx.token = token;
  if (token === '') return;
  const session = await accounts.resolveSession(ctx.db, token);
  if (!session) return;
  const profile = await accounts.profileOf(ctx.db, session.role, session.accountId);
  if (!profile) return;
  ctx.auth = {
    role: session.role,
    accountId: session.accountId,
    sessionId: session.sessionId,
    profile
  };
}

// Agent 令牌 → ctx.agent = { agentId, studentId, tokenId }（不占用登录身份）
async function attachAgent(ctx) {
  const token = agentTokenOf(ctx.req);
  ctx.agentToken = token;
  if (token === '') return;
  const found = await agent.resolveToken(ctx.db, token);
  if (found) ctx.agent = found;
}

function requireAuth(ctx, need) {
  if (need === 'none') return;
  if (need === 'optional') return;
  if (need === 'agent') {
    if (!ctx.agent) throw new ApiError('Agent 令牌无效或已吊销。', 401);
    return;
  }
  if (!ctx.auth) throw new ApiError('登录状态已失效，请重新登录。', 401);
  if (need === 'teacher' && ctx.auth.role !== util.ROLE_TEACHER) {
    throw new ApiError('这个操作需要老师账号。', 403);
  }
  if (need === 'student' && ctx.auth.role !== util.ROLE_STUDENT) {
    throw new ApiError('这个操作需要学生账号。', 403);
  }
}

async function dispatch(ctx) {
  for (const route of ROUTES) {
    if (route.method !== ctx.method) continue;
    const params = matchPath(route.path, ctx.pathname);
    if (!params) continue;
    ctx.params = params;
    await attachAuth(ctx);
    await attachAgent(ctx);
    requireAuth(ctx, route.auth);
    return route.handler(ctx);
  }
  throw new ApiError('接口不存在：' + ctx.method + ' ' + ctx.pathname, 404);
}

module.exports = { dispatch, ROUTES };
