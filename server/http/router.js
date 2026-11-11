const { ApiError } = require('../lib/errors.js');
const util = require('../lib/util.js');
const accounts = require('../domain/accounts.js');
const agent = require('../domain/agent.js');
const handlers = require('./handlers.js');

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

  { method: 'POST', path: '/api/bookings/:id/contract', auth: 'user', handler: handlers.setContract },
  { method: 'POST', path: '/api/payments/:id/paid', auth: 'user', handler: handlers.claimPaid },
  { method: 'POST', path: '/api/payments/:id/confirm', auth: 'user', handler: handlers.confirmPayment },
  { method: 'POST', path: '/api/payments/:id/refund', auth: 'user', handler: handlers.refundPayment },

  { method: 'POST', path: '/api/bookings/:id/lessons', auth: 'user', handler: handlers.submitLesson },

  { method: 'POST', path: '/api/lessons/:id/resubmit', auth: 'user', handler: handlers.resubmitLesson },
  { method: 'POST', path: '/api/lessons/:id/withdraw', auth: 'user', handler: handlers.withdrawLesson },
  { method: 'POST', path: '/api/lessons/:id/confirm', auth: 'user', handler: handlers.confirmLesson },
  { method: 'POST', path: '/api/lessons/:id/dispute', auth: 'user', handler: handlers.disputeLesson },
  { method: 'POST', path: '/api/lessons/:id/trial', auth: 'user', handler: handlers.trialResult },

  { method: 'GET', path: '/api/posts/open', auth: 'optional', handler: handlers.openPosts },

  { method: 'GET', path: '/api/posts', auth: 'optional', handler: handlers.openPosts },
  { method: 'GET', path: '/api/posts/recommended', auth: 'teacher', handler: handlers.recommendedPosts },
  { method: 'GET', path: '/api/posts/mine', auth: 'user', handler: handlers.myPosts },
  { method: 'POST', path: '/api/posts', auth: 'user', handler: handlers.createPost },
  { method: 'POST', path: '/api/posts/batch', auth: 'user', handler: handlers.batchPosts },
  { method: 'POST', path: '/api/posts/:id/take', auth: 'user', handler: handlers.takePost },
  { method: 'POST', path: '/api/posts/:id/close', auth: 'user', handler: handlers.closePost },

  { method: 'POST', path: '/api/posts/:id/correct', auth: 'user', handler: handlers.correctPost },
  { method: 'POST', path: '/api/bookings/:id/correct', auth: 'user', handler: handlers.correctBooking },
  { method: 'GET', path: '/api/corrections', auth: 'user', handler: handlers.listCorrections },

  { method: 'POST', path: '/api/agent/parse', auth: 'optional', handler: handlers.parseRequirement },

  { method: 'GET', path: '/api/agents/mine', auth: 'user', handler: handlers.myAgents },
  { method: 'GET', path: '/api/me/unread', auth: 'user', handler: handlers.myUnread },

  { method: 'GET', path: '/api/chats/agent/:agentId', auth: 'teacher', handler: handlers.agentChatWith },
  { method: 'POST', path: '/api/chats/agent/:agentId', auth: 'teacher', handler: handlers.sendAgentChat },
  { method: 'POST', path: '/api/chats/agent/:agentId/read', auth: 'teacher', handler: handlers.readAgentChat },

  { method: 'GET', path: '/api/messages/mine', auth: 'user', handler: handlers.myMessages },
  { method: 'POST', path: '/api/messages/:id/read', auth: 'user', handler: handlers.readMessage },

  { method: 'GET', path: '/api/messages/boxes', auth: 'user', handler: handlers.myMessageBoxes },
  { method: 'GET', path: '/api/messages/boxes/:postId', auth: 'user', handler: handlers.myMessageThread },
  { method: 'POST', path: '/api/messages/boxes/:postId/read', auth: 'user', handler: handlers.readMessageThread },

  { method: 'POST', path: '/api/agent/posts/batch', auth: 'agent', handler: handlers.agentBatchPosts },
  { method: 'POST', path: '/api/agent/message', auth: 'agent', handler: handlers.agentSendMessage },
  { method: 'POST', path: '/api/agent/chat/reply', auth: 'agent', handler: handlers.agentChatReply },
  { method: 'GET', path: '/api/agent/events', auth: 'agent', handler: handlers.agentListEvents }
];

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
