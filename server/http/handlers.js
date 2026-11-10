/*
 * 接口实现：一个函数对应原来小程序端 store.js 里的一个方法。
 *
 * 约定（和原来完全一致，前端不用改文案）：
 *   - 校验失败抛 ApiError，message 就是原来的 store.lastError 文案；
 *   - 返回 id 的接口失败直接是错误响应，前端拿到 -1；
 *   - 页面只负责展示，所有业务规则都在这里 + domain/ 里。
 */

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

// 浏览者定位（列表筛选用）：?lat=&lng=&km=&all=1
function view(ctx) {
  return nearby.parseViewer(ctx.query);
}

// 保存资料时的"当前位置兜底"：body.viewerLat / viewerLng
function fallbackView(src) {
  return {
    lat: util.toNumber(src && src.viewerLat, 0),
    lng: util.toNumber(src && src.viewerLng, 0),
    km: 0,
    all: true
  };
}

// 登录 / 注册成功后统一做的事：签发令牌 +（有 code 时）绑定 openid
async function grant(ctx, role, accountId, code) {
  const token = await accounts.issueToken(ctx.db, role, accountId, ctx.config.tokenDays);
  if (util.plain(code) !== '') {
    const openid = await wx.codeToOpenid(ctx.config, code);
    if (openid !== '') await accounts.bindOpenid(ctx.db, openid, role, accountId);
  }
  const profile = await accounts.profileOf(ctx.db, role, accountId);
  return { id: Number(accountId), token, profile };
}

/*
 * 接单页的筛选条件（都是可选的），和老师端面板一一对应：
 *   单子本身：grade / subject / time / minPrice（最低时薪）/ km（或 radius）
 *   单子的要求（多选，'男,女' 或数组都认；「不限」＝不筛）：gender / education /
 *              minYears / certificate / teachMode
 *   我自己的情况（多选）：myGender / myEducation / myYears / myCertificate / myTeachMode
 * maxPrice 留着给外部调用，页面上已经没有"最高时薪"这个入口了。
 */
function postFilters(src) {
  const q = src || {};
  // 距离：页面用 km，接口文档写 radius，两个都认
  const km = util.toNumber(q.km, 0) || util.toNumber(q.radius, 0);
  const onlyMatch = q.onlyMatch === '1' || q.onlyMatch === 'true' || q.onlyMatch === true;
  // 多选：数组直接用，字符串按逗号拆（页面拼的就是 '男,女' 这种）
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
  // ==================== 健康检查 ====================
  async health(ctx) {
    return { ok: true, driver: ctx.db.driver, location: ctx.db.location, wechatLogin: wx.configured(ctx.config) };
  },

  // ==================== 登录 / 注册 / 会话 ====================
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

  // wx.login → code → openid → 查绑定自动登录；没绑过就把选择权交回前端
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

  // 启动时拿这枚令牌换身份（对应原来的 restoreLogin）
  async me(ctx) {
    if (!ctx.auth) throw new ApiError('登录状态已失效，请重新登录。', 401);
    await accounts.renewSession(ctx.db, ctx.auth.sessionId, ctx.config.tokenDays);
    return { profile: ctx.auth.profile };
  },

  // 「我的」页一次拿齐：身份 + 资料 + 统计 +（老师）收到的评价
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

  // ==================== 老师 ====================
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

  // 老师在「我的」页 / 注册时保存资料（对应 saveTeacherProfile）
  async saveTeacherProfile(ctx) {
    const me = auth(ctx);
    if (me.role !== util.ROLE_TEACHER) throw new ApiError('这个操作需要老师账号。', 403);
    const data = body(ctx);
    const id = await accounts.saveTeacherProfile(ctx.db, me.accountId, data, fallbackView(data));
    return { id };
  },

  // 老师在「我的简历」页保存简历（学历 / 学校 / 教龄 / 证书 / 可教科目 / 价格 / 时段 / 自我介绍）
  async saveTeacherResume(ctx) {
    const me = auth(ctx);
    if (me.role !== util.ROLE_TEACHER) throw new ApiError('这个操作需要老师账号。', 403);
    const id = await accounts.saveTeacherResume(ctx.db, me.accountId, body(ctx));
    return { id };
  },

  // ==================== 学生 ====================
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

  // ==================== 预约 ====================
  async myBookings(ctx) {
    const me = auth(ctx);
    const list = me.role === util.ROLE_TEACHER
      ? await bookings.listForTeacher(ctx.db, me.accountId)
      : await bookings.listForStudent(ctx.db, me.accountId);
    // 每条订单带上课次记录（试课 + 正式课）和课次账（已确认次数 / 待支付金额）
    await lessons.attach(ctx.db, list);
    // 收款 / 退款记录也一起带上（平台侧和老师侧都要看）
    await payments.attach(ctx.db, list);
    return { list };
  },

  async acceptBooking(ctx) {
    const me = auth(ctx);
    const data = body(ctx);
    // 平台确认老师发来的"接单申请"（归属在域里校验）
    await bookings.acceptBooking(ctx.db, ctx.params.id, me.role, me.accountId);
    // 确认接单时可以顺手把合同金额 / 合同链接记下来（发合同 + 收款码这一步）
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
    // 老师拒绝预约申请；学生拒绝老师的接单（单子会重新开放）
    await bookings.rejectBooking(ctx.db, ctx.params.id, me.role, me.accountId);
    return {};
  },

  async cancelBooking(ctx) {
    const me = auth(ctx);
    // 学生取消自己下的预约、老师取消自己接的课（归属在后端域里再校验一次）
    await bookings.cancelBooking(ctx.db, ctx.params.id, me.role, me.accountId);
    return {};
  },

  async finishBooking(ctx) {
    const me = auth(ctx);
    // 主订单收尾：两边都能点，归属在后端域里校验
    await bookings.finishOrder(ctx.db, ctx.params.id, me.role, me.accountId);
    return {};
  },

  // ==================== 收款 / 退款（平台和老师之间的钱）====================
  // 平台发合同 + 收款码（也可以在确认接单时一起带过来）
  async setContract(ctx) {
    const me = auth(ctx);
    const data = body(ctx);
    return await payments.setContract(ctx.db, ctx.params.id, me.role, me.accountId, {
      amount: data.amount,
      contractUrl: data.contractUrl,
      note: data.note
    });
  },

  // 老师点「我已付款」
  async claimPaid(ctx) {
    const me = auth(ctx);
    await payments.markPaid(ctx.db, ctx.params.id, me.role, me.accountId);
    return {};
  },

  // 平台核对到账后「确认收款」
  async confirmPayment(ctx) {
    const me = auth(ctx);
    await payments.confirmReceipt(ctx.db, ctx.params.id, me.role, me.accountId);
    return {};
  },

  // 平台「确认退款」（没上成退全额，上过一次按合同扣）
  async refundPayment(ctx) {
    const me = auth(ctx);
    const data = body(ctx);
    return await payments.refund(ctx.db, ctx.params.id, me.role, me.accountId, {
      amount: data.amount,
      note: data.note
    });
  },

  // ==================== 课次（试课 / 正式课）====================
  async submitLesson(ctx) {
    const me = auth(ctx);
    const data = body(ctx);
    // 老师提交：kind = 试课（提交试课完成）/ 正式（完成本次）
    return await lessons.submit(ctx.db, ctx.params.id, me.role, me.accountId, data.kind, data.content);
  },

  async resubmitLesson(ctx) {
    const me = auth(ctx);
    // 平台有异议后，老师改完重新提交（只改内容，还是「待确认」）
    await lessons.resubmit(ctx.db, ctx.params.id, me.role, me.accountId, body(ctx).content);
    return {};
  },

  async withdrawLesson(ctx) {
    const me = auth(ctx);
    // 老师撤回还没被平台确认的课次（撤回后可以重新提交）
    await lessons.withdraw(ctx.db, ctx.params.id, me.role, me.accountId);
    return {};
  },

  async confirmLesson(ctx) {
    const me = auth(ctx);
    // 平台「确认本次」：正式课次变已确认，计入待支付金额
    await lessons.confirm(ctx.db, ctx.params.id, me.role, me.accountId);
    return {};
  },

  async disputeLesson(ctx) {
    const me = auth(ctx);
    // 平台「有异议」：填原因，课次退回待确认并通知老师
    await lessons.dispute(ctx.db, ctx.params.id, me.role, me.accountId, body(ctx).reason);
    return {};
  },

  async trialResult(ctx) {
    const me = auth(ctx);
    // 平台判定试课：通过 → 主订单进行中；不通过 → 订单已结束
    // half = true 试课费收半价、false 收全价（试课不通过也要收）
    const data = body(ctx);
    return await lessons.trialResult(ctx.db, ctx.params.id, me.role, me.accountId, data.pass, data.half);
  },

  // ==================== 发布单 ====================
  async openPosts(ctx) {
    const viewer = view(ctx);
    // 接口文档里的半径参数叫 radius，页面传的是 km；没给 km 时用 radius 兜底
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

  // 老师端「推荐」：和选单同一份数据，排序按匹配度（完全符合优先），默认只给能投的单。
  // 小程序里没有单独的推荐 tab，接口留着给外部用。
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
    // 单边发布：只有学生（平台）能发单，老师只能接单
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

  /*
   * 家长原话 → 结构化要求（中介发单时调；外部 Agent 没接上就走本地兜底规则）。
   * 单条：body { text } → { gender, education, minYears, certificate, teachMode, raw_text, source }
   * 批量：body { texts: [...] } → { list: [ 上面那个结构, ... ] }
   * 解析不出来不让发单失败：固定字段全「不限」，raw_text 原样带回。
   */
  async parseRequirement(ctx) {
    const data = body(ctx);
    if (Array.isArray(data.texts)) {
      return { list: await parse.parseTexts(ctx.config, data.texts) };
    }
    const text = util.plain(data.text || data.raw_text);
    if (text === '') throw new ApiError('把家长的原始要求贴进来再解析。');
    return await parse.parseText(ctx.config, text);
  },

  // 批量发单：一次贴多条（手动加几条 / 粘贴 JSON、表格），逐条落库、返回成功失败清单
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
    // 单边接单：只有老师能接，学生发完单等着老师来接
    if (me.role !== util.ROLE_TEACHER) throw new ApiError('只有老师账号能接单。', 403);
    // 老师不能一键接单：必须带一份简历（自我介绍）投递过去，等平台确认
    const data = body(ctx);
    const resume = util.plain(data.resume);
    if (resume === '') throw new ApiError('先写一份简历（自我介绍）再投递给平台。');
    /*
     * 时间撞上自己已有的课只提醒不拦：
     *   第一次（没带 force）返回 { conflict: true, timeText }，前端弹提醒；
     *   老师确认后带 force 再调一次，照常投递。
     */
    return await posts.takePost(ctx.db, ctx.params.id, true, me.accountId, resume, { force: !!data.force });
  },

  async closePost(ctx) {
    const me = auth(ctx);
    await posts.closePost(ctx.db, ctx.params.id, me.role === util.ROLE_TEACHER, me.accountId);
    return {};
  },

  // ==================== 消息（真人聊天已下线，只留官方助手）====================
  // 我这边有会话的官方助手（老师端置顶显示，标官方）
  async myAgents(ctx) {
    const me = auth(ctx);
    if (me.role !== util.ROLE_TEACHER) return { list: [] };
    return { list: await agent.agentPeers(ctx.db, me.accountId) };
  },

  /*
   * 底部导航红点：官方助手会话未读 + 系统通知未读。
   * todoPosts 是中介端【工作台】那格的待办红点：有多少条单子还挂着没处理的投递
   * （按单子数算，不按投递条数），跟未读消息一起下发，导航栏一次请求就能拿全。
   */
  async myUnread(ctx) {
    const me = auth(ctx);
    let count = await agent.unreadMessageCount(ctx.db, me.role, me.accountId);
    if (me.role === util.ROLE_TEACHER) count += await agent.unreadAgentChatCount(ctx.db, me.accountId);
    const todoPosts = me.role === util.ROLE_STUDENT
      ? await bookings.pendingInvitePostCount(ctx.db, me.accountId)
      : 0;
    return { count, todoPosts };
  },

  // ==================== 消息中心 / 官方助手会话 ====================
  // 消息中心：系统通知 + 合同消息 + Agent 消息（统一收件箱）
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

  /*
   * 「我的单子」卡片：老师端投一次简历就有一张，中介端发一单就有一张（同一套结构）。
   * 卡片上带这条单子的全部属性和全部消息，页面上不用再点进二级页。
   */
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

  /*
   * 修正（中介工作台）：手动改单子 / 订单状态、补录一条线下成交的订单、把单子作废。
   * 谁能改、能改成什么，全在 domain/correct.js 里卡死；每次改动记一笔 corrections。
   */
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

  // 老师 ↔ 官方助手
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

  // ==================== 外部 Agent 接口（X-Agent-Token）====================
  // 批量发单：复用学生端那套，source 标成 agent，发单方算令牌绑定的平台账号
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

  // 给老师发消息 / 合同：to_user_id 是老师 id
  async agentSendMessage(ctx) {
    const data = body(ctx);
    const teacherId = Number(data.to_user_id);
    if (!(teacherId >= 0)) throw new ApiError('要发给哪位老师？带上 to_user_id。');
    return await agent.agentMessage(
      ctx.db, ctx.agent.agentId, teacherId, data.type, data.content, data.contract_url
    );
  },

  // 回复老师的聊天（会话里老师发过来的那条）
  async agentChatReply(ctx) {
    const data = body(ctx);
    const teacherId = Number(data.teacher_id || data.to_user_id);
    if (!(teacherId >= 0)) throw new ApiError('要回复哪位老师？带上 teacher_id。');
    return await agent.agentMessage(
      ctx.db, ctx.agent.agentId, teacherId, 'text', data.content, ''
    );
  },

  // 外部 Agent 主动拉事件（和 webhook 二选一）
  async agentListEvents(ctx) {
    return { list: await agent.listEvents(ctx.db, ctx.query.since, ctx.query.limit) };
  }
};

module.exports = handlers;
