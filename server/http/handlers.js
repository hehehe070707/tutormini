const util = require('../lib/util.js');
const { ApiError } = require('../lib/errors.js');
const nearby = require('../domain/nearby.js');
const accounts = require('../domain/accounts.js');
const bookings = require('../domain/bookings.js');
const lessons = require('../domain/lessons.js');
const payments = require('../domain/payments.js');
const posts = require('../domain/posts.js');
const agent = require('../domain/agent.js');
const correct = require('../domain/correct.js');
const parse = require('../domain/parse.js');
const wx = require('../auth/wx.js');

function auth(ctx) {
  if (!ctx.auth) throw new ApiError('请先登录。', 401);
  return ctx.auth;
}

function body(ctx) {
  return ctx.body || {};
}

function view(ctx) {
  return nearby.parseViewer(ctx.query);
}

function fallbackView(src) {
  return {
    lat: util.toNumber(src && src.viewerLat, 0),
    lng: util.toNumber(src && src.viewerLng, 0),
    km: 0,
    all: true
  };
}

async function grant(ctx, role, accountId, code) {
  const token = await accounts.issueToken(ctx.db, role, accountId, ctx.config.tokenDays);
  if (util.plain(code) !== '') {
    const openid = await wx.codeToOpenid(ctx.config, code);
    if (openid !== '') await accounts.bindOpenid(ctx.db, openid, role, accountId);
  }
  const profile = await accounts.profileOf(ctx.db, role, accountId);
  return { id: Number(accountId), token, profile };
}

function postFilters(src) {
  const q = src || {};

  const km = util.toNumber(q.km, 0) || util.toNumber(q.radius, 0);
  const onlyMatch = q.onlyMatch === '1' || q.onlyMatch === 'true' || q.onlyMatch === true;

  const list = (value) => util.toList(value);
  return {
    grade: util.plain(q.grade),
    subject: util.plain(q.subject),
    time: util.plain(q.time),
    gender: list(q.gender),
    education: list(q.education),
    minYears: list(q.minYears !== undefined ? q.minYears : q.years),
    certificate: list(q.certificate),
    teachMode: list(q.teachMode),
    myGender: util.plain(q.myGender),
    myEducation: list(q.myEducation),
    myYears: list(q.myYears),
    myCertificate: list(q.myCertificate),
    myTeachMode: list(q.myTeachMode),
    minPrice: Number(q.minPrice) || 0,
    maxPrice: Number(q.maxPrice) || 0,
    onlyMatch
  };
}

const handlers = {

  async health(ctx) {
    return { ok: true, driver: ctx.db.driver, location: ctx.db.location, wechatLogin: wx.configured(ctx.config) };
  },

  async login(ctx) {
    const data = body(ctx);
    const role = util.plain(data.role) === util.ROLE_TEACHER ? util.ROLE_TEACHER : util.ROLE_STUDENT;
    const id = role === util.ROLE_TEACHER
      ? await accounts.loginTeacher(ctx.db, data.name, data.password)
      : await accounts.loginStudent(ctx.db, data.name, data.password);
    return grant(ctx, role, id, data.code);
  },

  async register(ctx) {
    const data = body(ctx);
    const role = util.plain(data.role) === util.ROLE_TEACHER ? util.ROLE_TEACHER : util.ROLE_STUDENT;
    const id = role === util.ROLE_TEACHER
      ? await accounts.registerTeacher(ctx.db, data.name, data.password)
      : await accounts.registerStudent(ctx.db, data.name, data.password);
    return grant(ctx, role, id, data.code);
  },

  async wxLogin(ctx) {
    const data = body(ctx);
    const openid = await wx.codeToOpenid(ctx.config, data.code);
    if (openid === '') return { needBind: true, wechat: wx.configured(ctx.config) };

    const binding = await accounts.findBinding(ctx.db, openid);
    if (!binding) return { needBind: true, wechat: true };

    const profile = await accounts.profileOf(ctx.db, binding.role, binding.accountId);
    if (!profile) return { needBind: true, wechat: true };

    const token = await accounts.issueToken(ctx.db, binding.role, binding.accountId, ctx.config.tokenDays);
    return { token, profile };
  },

  async logout(ctx) {
    await accounts.revokeToken(ctx.db, ctx.token);
    return {};
  },

  async me(ctx) {
    if (!ctx.auth) throw new ApiError('登录状态已失效，请重新登录。', 401);
    await accounts.renewSession(ctx.db, ctx.auth.sessionId, ctx.config.tokenDays);
    return { profile: ctx.auth.profile };
  },

  async dashboard(ctx) {
    if (!ctx.auth) return { role: 'none' };
    const role = ctx.auth.role;
    const accountId = ctx.auth.accountId;

    if (role === util.ROLE_STUDENT) {
      const student = await accounts.studentProfile(ctx.db, accountId);
      const stat = await bookings.statsForStudent(ctx.db, accountId);
      return { role: util.ROLE_STUDENT, student, stats: stat };
    }

    const teacher = await accounts.teacherById(ctx.db, accountId, null);
    const stat = await bookings.statsForTeacher(ctx.db, accountId);
    const subjects = await accounts.listSubjects(ctx.db);
    return { role: util.ROLE_TEACHER, teacher, stats: stat, subjects };
  },

  async teachers(ctx) {
    return accounts.listTeachers(ctx.db, {
      subject: ctx.query.subject,
      keyword: ctx.query.keyword,
      viewer: view(ctx)
    });
  },

  async subjects(ctx) {
    return { list: await accounts.listSubjects(ctx.db) };
  },

  async teacherById(ctx) {
    const teacher = await accounts.teacherById(ctx.db, ctx.params.id, view(ctx));
    if (Number(teacher.id) < 0) throw new ApiError('找不到这位老师。', 404);
    return { teacher };
  },

  async saveTeacherProfile(ctx) {
    const me = auth(ctx);
    if (me.role !== util.ROLE_TEACHER) throw new ApiError('这个操作需要老师账号。', 403);
    const data = body(ctx);
    const id = await accounts.saveTeacherProfile(ctx.db, me.accountId, data, fallbackView(data));
    return { id };
  },

  async saveTeacherResume(ctx) {
    const me = auth(ctx);
    if (me.role !== util.ROLE_TEACHER) throw new ApiError('这个操作需要老师账号。', 403);
    const id = await accounts.saveTeacherResume(ctx.db, me.accountId, body(ctx));
    return { id };
  },

  async studentProfile(ctx) {
    const me = auth(ctx);
    if (me.role !== util.ROLE_STUDENT) return { student: { id: -1, name: '', school: '', grade: '', phone: '' } };
    return { student: await accounts.studentProfile(ctx.db, me.accountId) };
  },

  async saveStudentProfile(ctx) {
    const me = auth(ctx);
    if (me.role !== util.ROLE_STUDENT) throw new ApiError('这个操作需要学生账号。', 403);
    const data = body(ctx);
    const id = await accounts.saveStudentProfile(ctx.db, {
      id: me.accountId,
      name: data.name,
      school: data.school,
      grade: data.grade,
      phone: data.phone
    });
    return { id };
  },

  async myBookings(ctx) {
    const me = auth(ctx);
    const list = me.role === util.ROLE_TEACHER
      ? await bookings.listForTeacher(ctx.db, me.accountId)
      : await bookings.listForStudent(ctx.db, me.accountId);

    await lessons.attach(ctx.db, list);

    await payments.attach(ctx.db, list);
    return { list };
  },

  async acceptBooking(ctx) {
    const me = auth(ctx);
    const data = body(ctx);

    await bookings.acceptBooking(ctx.db, ctx.params.id, me.role, me.accountId);

    if (me.role === util.ROLE_STUDENT &&
        (util.plain(data.contractUrl) !== '' || Number(data.amount) > 0)) {
      await payments.setContract(ctx.db, ctx.params.id, me.role, me.accountId, {
        amount: data.amount,
        contractUrl: data.contractUrl,
        note: data.note
      });
    }
    return {};
  },

  async rejectBooking(ctx) {
    const me = auth(ctx);

    await bookings.rejectBooking(ctx.db, ctx.params.id, me.role, me.accountId);
    return {};
  },

  async cancelBooking(ctx) {
    const me = auth(ctx);

    await bookings.cancelBooking(ctx.db, ctx.params.id, me.role, me.accountId);
    return {};
  },

  async finishBooking(ctx) {
    const me = auth(ctx);

    await bookings.finishOrder(ctx.db, ctx.params.id, me.role, me.accountId);
    return {};
  },

  async setContract(ctx) {
    const me = auth(ctx);
    const data = body(ctx);
    return await payments.setContract(ctx.db, ctx.params.id, me.role, me.accountId, {
      amount: data.amount,
      contractUrl: data.contractUrl,
      note: data.note
    });
  },

  async claimPaid(ctx) {
    const me = auth(ctx);
    await payments.markPaid(ctx.db, ctx.params.id, me.role, me.accountId);
    return {};
  },

  async confirmPayment(ctx) {
    const me = auth(ctx);
    await payments.confirmReceipt(ctx.db, ctx.params.id, me.role, me.accountId);
    return {};
  },

  async refundPayment(ctx) {
    const me = auth(ctx);
    const data = body(ctx);
    return await payments.refund(ctx.db, ctx.params.id, me.role, me.accountId, {
      amount: data.amount,
      note: data.note
    });
  },

  async submitLesson(ctx) {
    const me = auth(ctx);
    const data = body(ctx);

    return await lessons.submit(ctx.db, ctx.params.id, me.role, me.accountId, data.kind, data.content);
  },

  async resubmitLesson(ctx) {
    const me = auth(ctx);

    await lessons.resubmit(ctx.db, ctx.params.id, me.role, me.accountId, body(ctx).content);
    return {};
  },

  async withdrawLesson(ctx) {
    const me = auth(ctx);

    await lessons.withdraw(ctx.db, ctx.params.id, me.role, me.accountId);
    return {};
  },

  async confirmLesson(ctx) {
    const me = auth(ctx);

    await lessons.confirm(ctx.db, ctx.params.id, me.role, me.accountId);
    return {};
  },

  async disputeLesson(ctx) {
    const me = auth(ctx);

    await lessons.dispute(ctx.db, ctx.params.id, me.role, me.accountId, body(ctx).reason);
    return {};
  },

  async trialResult(ctx) {
    const me = auth(ctx);

    const data = body(ctx);
    return await lessons.trialResult(ctx.db, ctx.params.id, me.role, me.accountId, data.pass, data.half);
  },

  async openPosts(ctx) {
    const viewer = view(ctx);

    if (!viewer.km && ctx.query.radius) viewer.km = util.toNumber(ctx.query.radius, 0);
    if (!ctx.auth) return posts.allOpenPosts(ctx.db, viewer);
    return posts.postsForTaking(
      ctx.db,
      ctx.auth.role === util.ROLE_TEACHER,
      ctx.auth.accountId,
      viewer,
      postFilters(ctx.query)
    );
  },

  async recommendedPosts(ctx) {
    const me = auth(ctx);
    if (me.role !== util.ROLE_TEACHER) throw new ApiError('只有老师能看推荐单。', 403);
    const viewer = view(ctx);
    if (!viewer.km && ctx.query.radius) viewer.km = util.toNumber(ctx.query.radius, 0);
    return await posts.recommended(ctx.db, me.accountId, viewer, postFilters(ctx.query));
  },

  async myPosts(ctx) {
    const me = auth(ctx);
    return {
      list: await posts.myPosts(ctx.db, me.role === util.ROLE_TEACHER, me.accountId, view(ctx))
    };
  },

  async createPost(ctx) {
    const me = auth(ctx);

    if (me.role !== util.ROLE_STUDENT) throw new ApiError('老师不能发单，只能接单。', 403);
    const data = body(ctx);
    const id = await posts.createPost(ctx.db, {
      publisherIsTeacher: false,
      publisherId: me.accountId,
      publisherName: ctx.auth.profile.name,
      subject: data.subject,
      grade: data.grade,
      gender: data.gender,
      time: data.time,
      price: data.price,
      area: data.area,
      lat: data.lat,
      lng: data.lng,
      note: data.note,
      requirements: data.requirements,
      rawText: data.rawText || data.raw_text
    }, fallbackView(data));
    return { id };
  },

  async parseRequirement(ctx) {
    const data = body(ctx);
    if (Array.isArray(data.texts)) {
      return { list: await parse.parseTexts(ctx.config, data.texts) };
    }
    const text = util.plain(data.text || data.raw_text);
    if (text === '') throw new ApiError('把家长的原始要求贴进来再解析。');
    return await parse.parseText(ctx.config, text);
  },

  async batchPosts(ctx) {
    const me = auth(ctx);
    if (me.role !== util.ROLE_STUDENT) throw new ApiError('只有平台端能发布需求。', 403);
    const data = body(ctx);
    return await posts.batchCreate(
      ctx.db,
      { id: me.accountId, name: ctx.auth.profile.name },
      fallbackView(data),
      data.posts,
      { source: util.SOURCE_MANUAL, batchId: data.batchId }
    );
  },

  async takePost(ctx) {
    const me = auth(ctx);

    if (me.role !== util.ROLE_TEACHER) throw new ApiError('只有老师账号能接单。', 403);

    const data = body(ctx);
    const resume = util.plain(data.resume);
    if (resume === '') throw new ApiError('先写一份简历（自我介绍）再投递给平台。');

    return await posts.takePost(ctx.db, ctx.params.id, true, me.accountId, resume, { force: !!data.force });
  },

  async closePost(ctx) {
    const me = auth(ctx);
    await posts.closePost(ctx.db, ctx.params.id, me.role === util.ROLE_TEACHER, me.accountId);
    return {};
  },

  async myAgents(ctx) {
    const me = auth(ctx);
    if (me.role !== util.ROLE_TEACHER) return { list: [] };
    return { list: await agent.agentPeers(ctx.db, me.accountId) };
  },

  async myUnread(ctx) {
    const me = auth(ctx);
    let count = await agent.unreadMessageCount(ctx.db, me.role, me.accountId);
    if (me.role === util.ROLE_TEACHER) count += await agent.unreadAgentChatCount(ctx.db, me.accountId);
    const todoPosts = me.role === util.ROLE_STUDENT
      ? await bookings.pendingInvitePostCount(ctx.db, me.accountId)
      : 0;
    return { count, todoPosts };
  },

  async myMessages(ctx) {
    const me = auth(ctx);
    return {
      list: await agent.listMessages(ctx.db, me.role, me.accountId, ctx.query.limit),
      unread: await agent.unreadMessageCount(ctx.db, me.role, me.accountId)
    };
  },

  async readMessage(ctx) {
    const me = auth(ctx);
    await agent.markMessageRead(ctx.db, ctx.params.id, me.role, me.accountId);
    return {};
  },

  async myMessageBoxes(ctx) {
    const me = auth(ctx);
    return { list: await agent.messageBoxes(ctx.db, me.role, me.accountId) };
  },

  async myMessageThread(ctx) {
    const me = auth(ctx);
    const box = await agent.messageThread(ctx.db, me.role, me.accountId, ctx.params.postId);
    if (!box) throw new ApiError('找不到这张单子。', 404);
    return box;
  },

  async readMessageThread(ctx) {
    const me = auth(ctx);
    const changed = await agent.markThreadRead(ctx.db, me.role, me.accountId, ctx.params.postId);
    return { changed };
  },

  async correctPost(ctx) {
    const me = auth(ctx);
    return await correct.correctPost(ctx.db, ctx.params.id, me.role, me.accountId, body(ctx));
  },

  async correctBooking(ctx) {
    const me = auth(ctx);
    return await correct.correctBooking(ctx.db, ctx.params.id, me.role, me.accountId, body(ctx));
  },

  async listCorrections(ctx) {
    auth(ctx);
    return {
      list: await correct.listCorrections(ctx.db, ctx.query.target, ctx.query.targetId, ctx.query.limit)
    };
  },

  async agentChatWith(ctx) {
    const me = auth(ctx);
    if (me.role !== util.ROLE_TEACHER) throw new ApiError('只有老师能和官方助手聊天。', 403);
    const agentId = Number(ctx.params.agentId);
    const info = await agent.agentById(ctx.db, agentId);
    if (!info) throw new ApiError('找不到这个官方助手。', 404);
    return {
      agent: info,
      list: await agent.agentChatList(ctx.db, me.accountId, agentId),
      unread: await agent.agentChatUnread(ctx.db, me.accountId, agentId)
    };
  },

  async sendAgentChat(ctx) {
    const me = auth(ctx);
    if (me.role !== util.ROLE_TEACHER) throw new ApiError('只有老师能和官方助手聊天。', 403);
    return await agent.agentChatSend(ctx.db, me.accountId, ctx.params.agentId, body(ctx).body);
  },

  async readAgentChat(ctx) {
    const me = auth(ctx);
    if (me.role !== util.ROLE_TEACHER) throw new ApiError('只有老师能和官方助手聊天。', 403);
    const changed = await agent.agentChatMarkRead(ctx.db, me.accountId, ctx.params.agentId);
    return { changed };
  },

  async agentBatchPosts(ctx) {
    const data = body(ctx);
    const student = await accounts.studentProfile(ctx.db, ctx.agent.studentId);
    return await posts.batchCreate(
      ctx.db,
      { id: ctx.agent.studentId, name: student.name },
      fallbackView(data),
      data.posts,
      { source: util.SOURCE_AGENT, batchId: data.batchId }
    );
  },

  async agentSendMessage(ctx) {
    const data = body(ctx);
    const teacherId = Number(data.to_user_id);
    if (!(teacherId >= 0)) throw new ApiError('要发给哪位老师？带上 to_user_id。');
    return await agent.agentMessage(
      ctx.db, ctx.agent.agentId, teacherId, data.type, data.content, data.contract_url
    );
  },

  async agentChatReply(ctx) {
    const data = body(ctx);
    const teacherId = Number(data.teacher_id || data.to_user_id);
    if (!(teacherId >= 0)) throw new ApiError('要回复哪位老师？带上 teacher_id。');
    return await agent.agentMessage(
      ctx.db, ctx.agent.agentId, teacherId, 'text', data.content, ''
    );
  },

  async agentListEvents(ctx) {
    return { list: await agent.listEvents(ctx.db, ctx.query.since, ctx.query.limit) };
  }
};

module.exports = handlers;
