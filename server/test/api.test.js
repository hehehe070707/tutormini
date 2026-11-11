const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert');

const config = require('../config.js');
const { openDatabase } = require('../db/index.js');
const { createServer } = require('../server.js');

let passed = 0;
function ok(name, condition, detail) {
  passed++;
  if (condition) {
    console.log('  ✓ ' + name);
    return;
  }
  console.error('  ✗ ' + name + (detail ? ' → ' + detail : ''));
  throw new Error('测试失败：' + name);
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tutormini-test-'));
  const dbFile = path.join(dir, 'test.db');
  const db = await openDatabase(Object.assign({}, config, {
    dbDriver: 'sqlite',
    sqliteFile: dbFile,
    seedDemo: false
  }));
  const { server } = await createServer(db);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;

  async function api(method, url, options) {
    const opts = options || {};
    const headers = { 'Content-Type': 'application/json' };
    if (opts.token) headers['X-Token'] = opts.token;
    if (opts.agentToken) headers['X-Agent-Token'] = opts.agentToken;
    const response = await fetch(base + url, {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const json = await response.json();
    return { status: response.status, code: json.code, message: json.message, data: json.data };
  }

  try {
    console.log('\n[1] 健康检查 / 登录注册 / 令牌');
    const health = await api('GET', '/api/health');
    ok('健康检查返回 sqlite 驱动', health.data.driver === 'sqlite', JSON.stringify(health.data));

    const badLogin = await api('POST', '/api/auth/login', { body: { role: 'student', name: '小明', password: '' } });
    ok('空密码登录被挡住', badLogin.code === 1 && badLogin.message === '姓名和密码都要填。', badLogin.message);

    const studentReg = await api('POST', '/api/auth/register', { body: { role: 'student', name: '小明', password: '123456' } });
    ok('学生注册成功并拿到 token', studentReg.code === 0 && !!studentReg.data.token, studentReg.message);
    const studentToken = studentReg.data.token;
    const studentId = studentReg.data.id;
    ok('注册后 role 是学生', studentReg.data.profile.role === 'student');

    const again = await api('POST', '/api/auth/register', { body: { role: 'student', name: '小明', password: '123456' } });
    ok('同名同密码重复注册直接返回原账号', again.data.id === studentId);

    const dup = await api('POST', '/api/auth/register', { body: { role: 'student', name: '小明', password: '999999' } });
    ok('同名不同密码算另一个人', dup.data.id !== studentId);
    const dupToken = dup.data.token;

    const me = await api('GET', '/api/auth/me', { token: studentToken });
    ok('token 换回身份（自动登录用）', me.code === 0 && me.data.profile.accountId === studentId, me.message);

    const badToken = await api('GET', '/api/auth/me', { token: 'deadbeef' });
    ok('乱写 token 一定被拒（前端缓存改了也没用）', badToken.status === 401, String(badToken.status));

    const wxLogin = await api('POST', '/api/auth/wx-login', { body: { code: 'fake-code' } });
    ok('没配微信密钥时返回 needBind（本地开发降级）', wxLogin.data.needBind === true);

    console.log('\n[2] 老师资料 / 列表 / 筛选 / 附近');
    const teacherReg = await api('POST', '/api/auth/register', { body: { role: 'teacher', name: '王数学', password: 'abc123' } });
    const teacherToken = teacherReg.data.token;
    const teacherId = teacherReg.data.id;
    ok('老师注册成功', teacherReg.code === 0 && teacherId > 0);

    const emptyList = await api('GET', '/api/teachers');
    ok('没填科目的老师不上架', emptyList.data.list.length === 0, JSON.stringify(emptyList.data.list));

    const saveProfile = await api('PUT', '/api/teachers/me', {
      token: teacherToken,
      body: { name: '王数学', subject: '数学', price: '99 元/小时', area: '北京海淀', lat: 39.98, lng: 116.30 }
    });
    ok('老师资料保存成功', saveProfile.code === 0 && saveProfile.data.id === teacherId, saveProfile.message);

    const list = await api('GET', '/api/teachers?subject=全部&keyword=');
    ok('首页能看到这位老师', list.data.list.length === 1 && list.data.list[0].name === '王数学');

    const filtered = await api('GET', '/api/teachers?subject=英语');
    ok('科目筛选生效', filtered.data.list.length === 0);

    const keyword = await api('GET', '/api/teachers?keyword=海淀');
    ok('关键词搜位置生效', keyword.data.list.length === 1);

    const near = await api('GET', '/api/teachers?lat=39.98&lng=116.30&km=5&all=0');
    ok('附近筛选：同坐标距离 0，看得见', near.data.list.length === 1 && near.data.list[0].distanceKm < 0.01);
    const far = await api('GET', '/api/teachers?lat=31.23&lng=121.47&km=5&all=0');
    ok('附近筛选：上海看北京看不到，并给出隐藏条数', far.data.list.length === 0 && far.data.hidden === 1, JSON.stringify(far.data));
    const farAll = await api('GET', '/api/teachers?lat=31.23&lng=121.47&km=5&all=1');
    ok('点“看全部”就都出来了', farAll.data.list.length === 1);

    console.log('\n[3] 旧流程下线 / 权限');
    const otherTeacher = await api('POST', '/api/auth/register', { body: { role: 'teacher', name: '李英语', password: 'abc123' } });
    ok('第二个老师账号注册成功', otherTeacher.code === 0 && otherTeacher.data.id > 0);

    ok('学生直接约老师的接口已下线',
      (await api('POST', '/api/bookings', {
        token: studentToken, body: { teacherId, time: '2026-10-01 上午' }
      })).status === 404);
    ok('学生写评价的接口已下线',
      (await api('POST', '/api/reviews', {
        token: studentToken, body: { teacherId, content: 'x', rating: 5 }
      })).status === 404);
    ok('老师收到的评价接口已下线',
      (await api('GET', '/api/teachers/' + teacherId + '/reviews')).status === 404);
    ok('老师简历接口还留着（看简历 / 复制简历用）',
      (await api('GET', '/api/teachers/' + teacherId)).code === 0);

    console.log('\n[4] 发单 / 接单（学生发单，老师接单）');
    const teacherPost = await api('POST', '/api/posts', {
      token: teacherToken,
      body: { subject: '数学', time: '2026-10-03 上午', price: '120 元/次', area: '北京海淀', lat: 39.98, lng: 116.30, note: '老师发的' }
    });
    ok('老师发单被挡住（老师只能接单）', teacherPost.status === 403, String(teacherPost.status));

    const post = await api('POST', '/api/posts', {
      token: studentToken,
      body: { subject: '数学', time: '2026-10-02 下午', price: '120 元/次', area: '北京海淀', lat: 39.98, lng: 116.30, note: '初二' }
    });
    ok('学生发布需求成功', post.code === 0 && post.data.id > 0, post.message);
    const postId = post.data.id;

    const guestOpen = await api('GET', '/api/posts/open');
    ok('访客也能看到招募中的单', guestOpen.data.list.length === 1 && guestOpen.data.list[0].publisherName === '平台');
    ok('每条单都带一个能复制给人看的单号',
      /^\d{8}-\d+$/.test(guestOpen.data.list[0].code), guestOpen.data.list[0].code);
    ok('发单方的真实姓名不下发给老师（只显示平台）',
      guestOpen.data.list[0].publisherName === '平台');

    const minePosts = await api('GET', '/api/posts/mine', { token: studentToken });
    ok('“我发布的”只有自己那条', minePosts.data.list.length === 1);

    const takeOwn = await api('POST', '/api/posts/' + postId + '/take', { token: studentToken });
    ok('学生接单被挡住（接单要老师账号）', takeOwn.status === 403, String(takeOwn.status));

    const takeNoResume = await api('POST', '/api/posts/' + postId + '/take', { token: teacherToken });
    ok('老师不带简历接单被挡住',
      takeNoResume.code === 1 && takeNoResume.message.indexOf('简历') >= 0, takeNoResume.message);

    const take = await api('POST', '/api/posts/' + postId + '/take', {
      token: teacherToken,
      body: { resume: '我是王数学老师，带初二数学 8 年，周末有空。' }
    });
    ok('老师带简历投递成功', take.code === 0, take.message);

    const studentBoxesEarly = await api('GET', '/api/messages/boxes', { token: studentToken });
    ok('中介端也能拿自己的单子卡片', studentBoxesEarly.code === 0 && Array.isArray(studentBoxesEarly.data.list),
      JSON.stringify(studentBoxesEarly.data));
    const boxes = await api('GET', '/api/messages/boxes', { token: teacherToken });
    const myBox = (boxes.data.list || []).find((b) => b.postId === postId);
    ok('投简历后消息页多一张单子卡片', !!myBox && myBox.statusText === '待平台确认',
      JSON.stringify(boxes.data.list));
    ok('卡片标题就是单号（当日日期 + 当天第几个单）',
      !!myBox && /^\d{8}-\d+$/.test(myBox.code) && myBox.code === guestOpen.data.list[0].code,
      myBox && myBox.code);
    ok('卡片上有未读', !!myBox && myBox.unread > 0, myBox && String(myBox.unread));

    ok('卡片上直接带着这条单子的消息（不用点进去）',
      !!myBox && Array.isArray(myBox.list) && myBox.list.length > 0 &&
        myBox.list.every((m) => m.postId === postId) &&
        myBox.list[myBox.list.length - 1].title === myBox.lastTitle,
      myBox && JSON.stringify(myBox.list));
    const thread = await api('GET', '/api/messages/boxes/' + postId, { token: teacherToken });
    ok('点开卡片是这条单子的全部消息',
      thread.data.list.length > 0 && thread.data.post.code === myBox.code &&
        thread.data.list.every((m) => m.postId === postId),
      JSON.stringify(thread.data.post));
    ok('点开卡片能把这条单子标已读',
      (await api('POST', '/api/messages/boxes/' + postId + '/read', { token: teacherToken }))
        .data.changed === true);
    const boxesAfterRead = await api('GET', '/api/messages/boxes', { token: teacherToken });
    ok('标已读后卡片不再有未读',
      boxesAfterRead.data.list.find((b) => b.postId === postId).unread === 0);

    const takenAgain = await api('POST', '/api/posts/' + postId + '/take', {
      token: otherTeacher.data.token,
      body: { resume: '我是李英语老师，数学也能带。' }
    });
    ok('一条单可以被多位老师投递', takenAgain.code === 0, takenAgain.message);

    const mineWithInvites = await api('GET', '/api/posts/mine', { token: studentToken });
    ok('学生「我发布的」看到收到 2 条投递',
      mineWithInvites.data.list[0].invites.length === 2 &&
        mineWithInvites.data.list[0].invites.every((invite) => invite.statusText === '待平台确认'),
      JSON.stringify(mineWithInvites.data.list[0].invites));
    const unreadAfterTwoInvites = await api('GET', '/api/me/unread', { token: studentToken });
    ok('工作台红点按「单子」算：两位老师投同一条单也只算 1',
      unreadAfterTwoInvites.data.todoPosts === 1, JSON.stringify(unreadAfterTwoInvites.data));
    ok('同一位老师不能重复投递同一条单',
      (await api('POST', '/api/posts/' + postId + '/take', {
        token: teacherToken, body: { resume: '再来一次' }
      })).code === 1);

    const teacherAfterTake = await api('GET', '/api/bookings/mine', { token: teacherToken });
    const waiting = teacherAfterTake.data.list.find((b) => b.day === '2026-10-02 下午');
    ok('接单后先生成一条待确认的课（等平台确认）',
      !!waiting && waiting.status === '待确认', teacherAfterTake.data.list.map((b) => b.status));
    ok('老师投递的简历跟着这条课存下来了',
      !!waiting && waiting.resume.indexOf('王数学') >= 0, waiting && waiting.resume);

    const confirmByOtherTeacher = await api('POST', '/api/bookings/' + waiting.id + '/accept', { token: otherTeacher.data.token });
    ok('别的老师不能替这条接单确认',
      confirmByOtherTeacher.code === 1 && confirmByOtherTeacher.message.indexOf('不是你的') >= 0,
      confirmByOtherTeacher.message);

    const studentConfirm = await api('POST', '/api/bookings/' + waiting.id + '/accept', { token: studentToken });
    ok('学生确认后接单才成功', studentConfirm.code === 0, studentConfirm.message);
    ok('确认接单后工作台红点归零',
      (await api('GET', '/api/me/unread', { token: studentToken })).data.todoPosts === 0);
    const afterConfirm = await api('GET', '/api/bookings/mine', { token: teacherToken });
    ok('确认后那条课变试课中', afterConfirm.data.list.some((b) => b.id === waiting.id && b.status === '试课中'),
      afterConfirm.data.list.map((b) => b.status));

    const otherAfterConfirm = await api('GET', '/api/bookings/mine', { token: otherTeacher.data.token });
    const refusedInvite = otherAfterConfirm.data.list.find((b) => b.day === '2026-10-02 下午');
    ok('没被选上的投递变成已拒绝（平台选了别人）',
      !!refusedInvite && refusedInvite.status === '已拒绝', refusedInvite && refusedInvite.status);

    const postAfterConfirm = (await api('GET', '/api/posts/mine', { token: studentToken })).data.list[0];
    ok('平台确认后单子转「已成交」', postAfterConfirm.status === '已成交', postAfterConfirm.status);
    ok('已成交的单里另一位老师的投递显示「未选上」',
      postAfterConfirm.invites.some((invite) => invite.statusText === '未选上'),
      JSON.stringify(postAfterConfirm.invites));

    const closeMine = await api('POST', '/api/posts/' + postId + '/close', { token: studentToken });
    ok('已成交的单不能再撤销', closeMine.code === 1, closeMine.message);

    const teacherCancel = await api('POST', '/api/bookings/' + waiting.id + '/cancel', { token: teacherToken });
    ok('老师能取消自己接的课', teacherCancel.code === 0, teacherCancel.message);

    const reopened = await api('GET', '/api/posts/open');
    ok('取消预约后单子还是开放的', reopened.data.list.some((p) => p.id === postId));

    const studentAfterCancel = await api('GET', '/api/bookings/mine', { token: studentToken });
    ok('学生那边这条课变已取消',
      studentAfterCancel.data.list.some((b) => b.id === waiting.id && b.status === '已取消'));

    const retake = await api('POST', '/api/posts/' + postId + '/take', {
      token: otherTeacher.data.token,
      body: { resume: '我是李英语老师，英语专业，带过三届中考。' }
    });
    ok('重新开放的单别的老师还能接', retake.code === 0, retake.message);

    console.log('\n[4.1] 试课 → 主订单 → 课次 → 支付（新流程）');

    const flowStudent = await api('POST', '/api/auth/register', { body: { role: 'student', name: '小刚', password: '123456' } });
    const flowToken = flowStudent.data.token;

    const flowPost = await api('POST', '/api/posts', {
      token: flowToken,
      body: { subject: '物理', time: '2026-10-20 晚上', price: '100 元/次', area: '北京海淀', lat: 39.98, lng: 116.30, note: '新流程' }
    });
    ok('新流程：平台发单', flowPost.code === 0, flowPost.message);
    const flowPostId = flowPost.data.id;

    await api('POST', '/api/posts/' + flowPostId + '/take', {
      token: teacherToken, body: { resume: '王数学老师想带这门物理。' }
    });
    let flowBooking = (await api('GET', '/api/bookings/mine', { token: teacherToken }))
      .data.list.find((b) => b.day === '2026-10-20 晚上');
    ok('新流程：投递后先是一条待确认的课', !!flowBooking && flowBooking.status === '待确认', flowBooking && flowBooking.status);
    ok('新流程：还没确认接单时课次列表是空的',
      !!flowBooking && flowBooking.lessons.length === 0, JSON.stringify(flowBooking && flowBooking.lessons));
    const flowBookingId = flowBooking.id;

    async function flowOf(token) {
      const data = await api('GET', '/api/bookings/mine', { token });
      return data.data.list.find((b) => b.id === flowBookingId);
    }

    const flowConfirm = await api('POST', '/api/bookings/' + flowBookingId + '/accept', { token: flowToken });
    ok('新流程：平台确认接单', flowConfirm.code === 0, flowConfirm.message);
    flowBooking = await flowOf(flowToken);
    ok('新流程：确认接单后订单进入试课中', flowBooking.status === '试课中', flowBooking.status);

    const studentSubmitTrial = await api('POST', '/api/bookings/' + flowBookingId + '/lessons', {
      token: flowToken, body: { kind: '试课', content: '' }
    });
    ok('试课只有老师能提交', studentSubmitTrial.code === 1 && studentSubmitTrial.status === 403, studentSubmitTrial.message);

    const submitTrial = await api('POST', '/api/bookings/' + flowBookingId + '/lessons', {
      token: teacherToken, body: { kind: '试课', content: '试课讲了受力分析' }
    });
    ok('老师提交试课完成', submitTrial.code === 0 && submitTrial.data.kind === '试课', submitTrial.message);
    const trialLessonId = submitTrial.data.id;

    flowBooking = await flowOf(teacherToken);
    ok('试课挂成一条「待确认」的课次',
      flowBooking.lessons.length === 1 && flowBooking.lessons[0].kind === '试课' &&
        flowBooking.lessons[0].status === '待确认', JSON.stringify(flowBooking.lessons));

    const dupTrial = await api('POST', '/api/bookings/' + flowBookingId + '/lessons', {
      token: teacherToken, body: { kind: '试课' }
    });
    ok('有课次待确认时不能再提交下一条', dupTrial.code === 1 && dupTrial.message.indexOf('还没确认') >= 0, dupTrial.message);

    const dispute = await api('POST', '/api/lessons/' + trialLessonId + '/dispute', {
      token: flowToken, body: { reason: '试课时间太短了' }
    });
    ok('平台能对课次提异议', dispute.code === 0, dispute.message);
    flowBooking = await flowOf(flowToken);
    ok('异议后课次还是待确认，并记下原因',
      flowBooking.lessons[0].status === '待确认' && flowBooking.lessons[0].reason === '试课时间太短了',
      JSON.stringify(flowBooking.lessons[0]));
    ok('老师能看到平台写的异议',
      (await flowOf(teacherToken)).lessons[0].reason === '试课时间太短了');

    const emptyReason = await api('POST', '/api/lessons/' + trialLessonId + '/dispute', { token: flowToken, body: { reason: '  ' } });
    ok('异议必须写原因', emptyReason.code === 1, emptyReason.message);

    const resubmit = await api('POST', '/api/lessons/' + trialLessonId + '/resubmit', {
      token: teacherToken, body: { content: '补了 20 分钟，重新讲了受力分析' }
    });
    ok('老师改完重新提交', resubmit.code === 0, resubmit.message);
    flowBooking = await flowOf(flowToken);
    ok('重新提交后内容更新，还是待确认',
      flowBooking.lessons[0].status === '待确认' &&
        flowBooking.lessons[0].content.indexOf('补了 20 分钟') >= 0,
      JSON.stringify(flowBooking.lessons[0]));

    const trialPass = await api('POST', '/api/lessons/' + trialLessonId + '/trial', {
      token: flowToken, body: { pass: true, half: false }
    });
    ok('平台判定试课通过', trialPass.code === 0, trialPass.message);
    flowBooking = await flowOf(flowToken);
    ok('试课通过后订单进入主订单进行中', flowBooking.status === '主订单进行中', flowBooking.status);
    ok('试课那条课次「已确认 · 通过」并计入待支付',
      flowBooking.lessons[0].statusText === '已确认 · 通过' &&
        flowBooking.lessonStats.confirmedCount === 1 &&
        flowBooking.lessons[0].fee === 100 &&
        flowBooking.lessonStats.unpaidAmount === 100,
      JSON.stringify(flowBooking.lessonStats));

    const formalSubmit = await api('POST', '/api/bookings/' + flowBookingId + '/lessons', {
      token: teacherToken, body: { kind: '正式', content: '第二次课讲了牛顿定律' }
    });
    ok('主订单里老师能提交「完成本次」', formalSubmit.code === 0 && formalSubmit.data.seq === 1, formalSubmit.message);
    const formalLessonId = formalSubmit.data.id;

    const finishWithPending = await api('POST', '/api/bookings/' + flowBookingId + '/finish', { token: flowToken });
    ok('还有课次没确认时不能结束订单',
      finishWithPending.code === 1 && finishWithPending.message.indexOf('没确认') >= 0, finishWithPending.message);

    const lessonConfirm = await api('POST', '/api/lessons/' + formalLessonId + '/confirm', { token: flowToken });
    ok('平台确认本次', lessonConfirm.code === 0, lessonConfirm.message);
    flowBooking = await flowOf(flowToken);
    ok('确认本次后计入已确认次数和待支付金额',
      flowBooking.lessonStats.confirmedCount === 2 && flowBooking.lessonStats.unpaidAmount === 200 &&
        flowBooking.lessonStats.pendingCount === 0,
      JSON.stringify(flowBooking.lessonStats));

    flowBooking = await flowOf(flowToken);
    ok('两条已确认的课次合计记在待支付里（100 + 100）',
      flowBooking.lessonStats.unpaidAmount === 200 && flowBooking.lessonStats.confirmedCount === 2,
      JSON.stringify(flowBooking.lessonStats));

    const flowFinish = await api('POST', '/api/bookings/' + flowBookingId + '/finish', { token: teacherToken });
    ok('老师也能给主订单收尾', flowFinish.code === 0, flowFinish.message);
    ok('结束订单后状态是已结束', (await flowOf(flowToken)).status === '已结束');

    const failPost = await api('POST', '/api/posts', {
      token: flowToken,
      body: { subject: '化学', time: '2026-10-21 晚上', price: '90 元/次', area: '北京海淀', lat: 39.98, lng: 116.30, note: '试课不通过' }
    });
    await api('POST', '/api/posts/' + failPost.data.id + '/take', {
      token: teacherToken, body: { resume: '王数学老师也能带化学。' }
    });
    const failBooking = (await api('GET', '/api/bookings/mine', { token: teacherToken }))
      .data.list.find((b) => b.day === '2026-10-21 晚上');
    await api('POST', '/api/bookings/' + failBooking.id + '/accept', { token: flowToken });
    const failTrial = await api('POST', '/api/bookings/' + failBooking.id + '/lessons', {
      token: teacherToken, body: { kind: '试课', content: '试课' }
    });
    const failResult = await api('POST', '/api/lessons/' + failTrial.data.id + '/trial', {
      token: flowToken, body: { pass: false, half: true }
    });
    ok('平台判定试课不通过', failResult.code === 0, failResult.message);
    const failedBooking = (await api('GET', '/api/bookings/mine', { token: flowToken }))
      .data.list.find((b) => b.id === failBooking.id);
    ok('试课不通过订单直接结束', failedBooking.status === '已结束', failedBooking.status);
    ok('试课不通过也要付试课费（90 的半价 45）',
      failedBooking.lessons[0].fee === 45 &&
        failedBooking.lessonStats.confirmedCount === 1 &&
        failedBooking.lessonStats.unpaidAmount === 45,
      JSON.stringify(failedBooking.lessonStats));
    console.log('\n[4.2] 接单撞时间：只提醒，不拦投递');

    const clash1 = await api('POST', '/api/posts', {
      token: flowToken,
      body: { subject: '语文', time: '2026-10-23 晚上', price: '80 元/次', area: '北京海淀' }
    });
    await api('POST', '/api/posts/' + clash1.data.id + '/take', {
      token: teacherToken, body: { resume: '先投一条占住时段' }
    });
    const clashBooking = (await api('GET', '/api/bookings/mine', { token: teacherToken }))
      .data.list.find((b) => b.day === '2026-10-23 晚上');
    await api('POST', '/api/bookings/' + clashBooking.id + '/accept', { token: flowToken });
    ok('先占住这个时段（订单试课中）',
      (await api('GET', '/api/bookings/mine', { token: flowToken }))
        .data.list.some((b) => b.id === clashBooking.id && b.status === '试课中'));

    const clash2 = await api('POST', '/api/posts', {
      token: flowToken,
      body: { subject: '语文', time: '2026-10-23 晚上', price: '80 元/次', area: '北京海淀' }
    });
    const clashList = await api('GET', '/api/posts/open', { token: teacherToken });
    const clashItem = clashList.data.list.find((p) => p.id === clash2.data.id);
    ok('接单列表里就标出「时间冲突」（只提醒，不挡）',
      !!clashItem && clashItem.timeConflict === true, JSON.stringify(clashItem && clashItem.timeConflict));
    ok('时间不撞的单不会误标',
      clashList.data.list.every((p) => p.timeConflict === (p.id === clash2.data.id)),
      JSON.stringify(clashList.data.list.map((p) => [p.id, p.timeConflict])));

    const warned = await api('POST', '/api/posts/' + clash2.data.id + '/take', {
      token: teacherToken, body: { resume: '想接这一条' }
    });
    ok('时间冲突时只返回提醒，不报错',
      warned.code === 0 && warned.data.conflict === true &&
        warned.data.timeText.indexOf('2026-10-23') >= 0,
      JSON.stringify(warned.data));
    ok('提醒那一步没有落库',
      !(await api('GET', '/api/bookings/mine', { token: teacherToken }))
        .data.list.some((b) => Number(b.postId) === clash2.data.id));

    const forced = await api('POST', '/api/posts/' + clash2.data.id + '/take', {
      token: teacherToken, body: { resume: '想接这一条', force: true }
    });
    ok('老师在提醒上确认后照样能投递',
      forced.code === 0 && forced.data.conflict === false, JSON.stringify(forced.data));
    ok('确认之后确实生成了投递',
      (await api('GET', '/api/bookings/mine', { token: teacherToken }))
        .data.list.some((b) => Number(b.postId) === clash2.data.id));

    console.log('\n[4.3] 双方取消：撤回投递 / 撤销发布 / 撤回课次 / 取消清课次');

    const wdPost = await api('POST', '/api/posts', {
      token: flowToken,
      body: { subject: '生物', time: '2026-11-01 下午', price: '110 元/次', area: '北京海淀' }
    });
    const wdTake1 = await api('POST', '/api/posts/' + wdPost.data.id + '/take', {
      token: teacherToken, body: { resume: '先投了看看' }
    });
    ok('撤回投递：先有一条待确认的投递', wdTake1.code === 0 && wdTake1.data.bookingId > 0, wdTake1.message);
    ok('老师能撤回投递',
      (await api('POST', '/api/bookings/' + wdTake1.data.bookingId + '/cancel', { token: teacherToken })).code === 0);
    ok('撤回后那条投递变已取消',
      (await api('GET', '/api/bookings/mine', { token: teacherToken }))
        .data.list.find((b) => b.id === wdTake1.data.bookingId).status === '已取消');
    ok('撤回投递后单子还在「招募中」',
      (await api('GET', '/api/posts/open')).data.list.some((p) => p.id === wdPost.data.id));
    const boxesAfterWithdraw = await api('GET', '/api/messages/boxes', { token: teacherToken });
    ok('撤回投递后消息页不再留这次投递的卡片（不影响结果就不留记录）',
      !(boxesAfterWithdraw.data.list || []).some((b) => b.postId === wdPost.data.id),
      JSON.stringify((boxesAfterWithdraw.data.list || []).map((b) => b.postId)));
    const studentBoxesAfterWithdraw = await api('GET', '/api/messages/boxes', { token: flowToken });
    ok('中介那边这次投递留下的通知也一并清掉（投递又撤回＝没发生）',
      !(studentBoxesAfterWithdraw.data.list || []).some((b) => b.postId === wdPost.data.id),
      JSON.stringify((studentBoxesAfterWithdraw.data.list || []).map((b) => b.postId)));
    const wdTake2 = await api('POST', '/api/posts/' + wdPost.data.id + '/take', {
      token: teacherToken, body: { resume: '重新投一次' }
    });
    ok('撤回后老师还能再投同一条单', wdTake2.code === 0 && wdTake2.data.bookingId > 0, wdTake2.message);

    ok('学生撤销发布成功',
      (await api('POST', '/api/posts/' + wdPost.data.id + '/close', { token: flowToken })).code === 0);
    ok('撤销发布后老师那条投递一起变已取消',
      (await api('GET', '/api/bookings/mine', { token: teacherToken }))
        .data.list.find((b) => b.id === wdTake2.data.bookingId).status === '已取消');
    ok('撤销后单子不再对老师开放',
      !(await api('GET', '/api/posts/open')).data.list.some((p) => p.id === wdPost.data.id));

    const lpPost = await api('POST', '/api/posts', {
      token: flowToken,
      body: { subject: '生物', time: '2026-11-02 下午', price: '110 元/次', area: '北京海淀' }
    });
    const lpTake = await api('POST', '/api/posts/' + lpPost.data.id + '/take', {
      token: teacherToken, body: { resume: '生物也能带' }
    });
    await api('POST', '/api/bookings/' + lpTake.data.bookingId + '/accept', { token: flowToken });
    const lpTrial = await api('POST', '/api/bookings/' + lpTake.data.bookingId + '/lessons', {
      token: teacherToken, body: { kind: '试课', content: '先提交一版' }
    });
    ok('老师提交试课课次成功', lpTrial.code === 0, lpTrial.message);
    ok('学生不能撤回老师的课次',
      (await api('POST', '/api/lessons/' + lpTrial.data.id + '/withdraw', { token: flowToken })).status === 403);
    ok('老师撤回待确认课次成功',
      (await api('POST', '/api/lessons/' + lpTrial.data.id + '/withdraw', { token: teacherToken })).code === 0);
    let lpBooking = (await api('GET', '/api/bookings/mine', { token: flowToken }))
      .data.list.find((b) => b.id === lpTake.data.bookingId);
    ok('撤回后课次列表空了，订单还在试课中',
      lpBooking.lessons.length === 0 && lpBooking.status === '试课中', JSON.stringify(lpBooking));
    ok('撤回后能重新提交试课',
      (await api('POST', '/api/bookings/' + lpTake.data.bookingId + '/lessons', {
        token: teacherToken, body: { kind: '试课', content: '重新提交' }
      })).code === 0);

    ok('学生取消这条试课中的订单',
      (await api('POST', '/api/bookings/' + lpTake.data.bookingId + '/cancel', { token: flowToken })).code === 0);
    lpBooking = (await api('GET', '/api/bookings/mine', { token: flowToken }))
      .data.list.find((b) => b.id === lpTake.data.bookingId);
    ok('取消后待确认的课次一并作废',
      lpBooking.status === '已取消' && lpBooking.lessons.length === 0, JSON.stringify(lpBooking.lessons));
    ok('取消后需求重新开放给别的老师',
      (await api('GET', '/api/posts/open')).data.list.some((p) => p.id === lpPost.data.id));

    const unpaidPost = await api('POST', '/api/posts', {
      token: flowToken,
      body: { subject: '生物', time: '2026-11-03 下午', price: '110 元/次', area: '北京海淀' }
    });
    const unpaidTake = await api('POST', '/api/posts/' + unpaidPost.data.id + '/take', {
      token: teacherToken, body: { resume: '再带一门生物' }
    });
    await api('POST', '/api/bookings/' + unpaidTake.data.bookingId + '/accept', { token: flowToken });
    const unpaidTrial = await api('POST', '/api/bookings/' + unpaidTake.data.bookingId + '/lessons', {
      token: teacherToken, body: { kind: '试课', content: '试课' }
    });
    await api('POST', '/api/lessons/' + unpaidTrial.data.id + '/trial', {
      token: flowToken, body: { pass: true, half: false }
    });
    ok('学生取消已经确认过课次的订单',
      (await api('POST', '/api/bookings/' + unpaidTake.data.bookingId + '/cancel', { token: flowToken })).code === 0);
    const unpaidAfter = (await api('GET', '/api/bookings/mine', { token: flowToken }))
      .data.list.find((b) => b.id === unpaidTake.data.bookingId);
    ok('取消不免已确认的课时费（待支付还在）',
      unpaidAfter.status === '已取消' && unpaidAfter.lessonStats.unpaidAmount === 110,
      JSON.stringify(unpaidAfter.lessonStats));

    console.log('\n[5] 真人聊天已下线（只留官方助手）/ 未读红点');
    ok('给老师发消息的接口已下线',
      (await api('POST', '/api/chats/with/' + teacherId, {
        token: studentToken, body: { body: '你好' }
      })).status === 404);
    ok('会话列表接口已下线',
      (await api('GET', '/api/chats/peers', { token: teacherToken })).status === 404);
    ok('未读总数接口换成了 /api/me/unread',
      (await api('GET', '/api/me/unread', { token: teacherToken })).code === 0
        && typeof (await api('GET', '/api/me/unread', { token: teacherToken })).data.count === 'number');
    ok('官方助手列表接口在（老师端消息页用）',
      (await api('GET', '/api/agents/mine', { token: teacherToken })).code === 0);

    console.log('\n[6] 老师简历');
    const saveResume = await api('PUT', '/api/teachers/me/resume', {
      token: teacherToken,
      body: {
        education: '本科', school: '北京师范大学', years: '8 年', certificate: '教师资格证',
        subject: '数学', price: '99 元/小时', times: '周末全天', intro: '带过三届中考，讲题清楚。'
      }
    });
    ok('老师保存简历成功', saveResume.code === 0, saveResume.message);

    const teacherDetail = await api('GET', '/api/teachers/' + teacherId);
    ok('老师详情带完整简历',
      teacherDetail.data.teacher.education === '本科' &&
        teacherDetail.data.teacher.school === '北京师范大学' &&
        teacherDetail.data.teacher.years === '8 年' &&
        teacherDetail.data.teacher.times === '周末全天',
      JSON.stringify(teacherDetail.data.teacher));

    const listBeforeReview = await api('GET', '/api/teachers');
    const wangBefore = listBeforeReview.data.list.find((t) => t.name === '王数学');
    ok('老师列表不再下发评价数据（评价体系已下线）',
      !!wangBefore && wangBefore.reviewCount === undefined && wangBefore.ratingAvg === undefined,
      JSON.stringify(wangBefore));

    console.log('\n[7] 批量发单 / 单号 / 联系方式脱敏');
    const batch = await api('POST', '/api/posts/batch', {
      token: studentToken,
      body: {
        posts: [
          { subject: '数学', time: '2026-11-10 晚上', price: '150 元/小时', area: '海淀 · 中关村', note: '初二，电话 13800000000', externalId: 'X-1' },
          { subject: '英语', time: '2026-11-11 晚上', price: '140 元/小时', area: '海淀 · 五道口', note: '想补口语' },
          { subject: '', time: '2026-11-12 晚上', note: '这条故意没写科目' }
        ]
      }
    });
    ok('批量发单返回成功 / 失败两张清单',
      batch.code === 0 && batch.data.ok.length === 2 && batch.data.failed.length === 1,
      JSON.stringify(batch.data));
    ok('失败清单指出是第几条、为什么',
      batch.data.failed[0].index === 2 && batch.data.failed[0].reason.indexOf('科目') >= 0,
      JSON.stringify(batch.data.failed));
    ok('整批带同一个批次号', typeof batch.data.batchId === 'string' && batch.data.batchId.length > 0);

    const batchMine = await api('GET', '/api/posts/mine', { token: studentToken });
    const cleanPost = batchMine.data.list.find((p) => p.code === batch.data.ok[0].code);
    ok('批量发的单也带单号，source 标 manual',
      !!cleanPost && cleanPost.source === 'manual' && !!cleanPost.code, JSON.stringify(cleanPost));
    const batchCodes = batch.data.ok.map((row) => row.code);
    ok('同一天发出去的单号按 1、2、3 往下排',
      batchCodes.length > 1 && batchCodes[0].split('-')[0] === batchCodes[1].split('-')[0] &&
        Number(batchCodes[1].split('-')[1]) === Number(batchCodes[0].split('-')[1]) + 1,
      JSON.stringify(batchCodes));
    ok('位置 / 说明里的手机号被抹掉（不外泄客户联系方式）',
      !!cleanPost && cleanPost.note.indexOf('13800000000') < 0 && cleanPost.note.indexOf('初') >= 0,
      cleanPost && cleanPost.note);

    const idem = await api('POST', '/api/posts/batch', {
      token: studentToken,
      body: { posts: [{ subject: '数学', time: '2026-11-10 晚上', externalId: 'X-1' }] }
    });
    ok('同一个外部单号重复导入不会建出新单（幂等）',
      idem.code === 0 && idem.data.ok.length === 1 && idem.data.ok[0].id === batch.data.ok[0].id,
      JSON.stringify(idem.data));

    console.log('\n[7.1] 单子结构化要求 + 老师端匹配 + 双向筛选');

    await api('PUT', '/api/teachers/me/resume', {
      token: teacherToken,
      body: {
        education: '本科', school: '北京师范大学', years: '8 年', certificate: '教师资格证、普通话二甲、英语六级',
        subject: '数学', price: '150 元/小时', times: '周末全天', intro: '带过三届中考，讲题清楚。'
      }
    });
    await api('PUT', '/api/teachers/me', {
      token: teacherToken,
      body: { name: '王数学', subject: '数学', price: '150 元/小时', area: '北京海淀', lat: 39.98, lng: 116.30, gender: '男' }
    });

    const fitPost = await api('POST', '/api/posts', {
      token: studentToken,
      body: {
        subject: '数学', grade: '初二', gender: '男', time: '2026-11-15 晚上', price: '180 元/小时',
        area: '海淀 · 中关村', lat: 39.98, lng: 116.30, note: '初二补函数',
        requirements: {
          education: '本科及以上', school: '985/211优先', minYears: 2,
          certificate: ['教师资格证'], gender: '男', teachMode: '线下',
          budgetMin: 100, budgetMax: 200
        }
      }
    });
    ok('平台发单能带结构化要求', fitPost.code === 0, fitPost.message);
    const fitMine = (await api('GET', '/api/posts/mine', { token: studentToken }))
      .data.list.find((p) => p.id === fitPost.data.id);
    ok('要求存下来了（学历 / 教龄 / 证书 / 时薪）',
      !!fitMine && fitMine.requirements.education === '本科' &&
        fitMine.requirements.minYears === '1' &&
        fitMine.requirements.certificate === '教师资格证' &&
        fitMine.requirements.priceMin === 100 &&
        fitMine.requirements.priceMax === 200,
      JSON.stringify(fitMine && fitMine.requirements));

    const teacherList = await api('GET', '/api/posts/open?lat=39.98&lng=116.30&km=45', { token: teacherToken });
    const fitItem = teacherList.data.list.find((p) => p.id === fitPost.data.id);
    ok('老师端每条单带匹配档位和理由',
      !!fitItem && fitItem.matchLevel === 'full' && fitItem.matchReasons.length > 0,
      JSON.stringify(fitItem && [fitItem.matchLevel, fitItem.matchReasons]));
    ok('完全符合的单理由是 ✅',
      !!fitItem && fitItem.matchReasons.every((text) => text.indexOf('✅') === 0),
      JSON.stringify(fitItem && fitItem.matchReasons));

    const noPost = await api('POST', '/api/posts', {
      token: studentToken,
      body: {
        subject: '数学', grade: '高三', gender: '女', time: '2026-11-16 晚上', price: '180 元/小时',
        area: '海淀 · 五道口',
        requirements: { education: '硕士及以上', minYears: 5, gender: '女' }
      }
    });
    const allList = await api('GET', '/api/posts/open?lat=39.98&lng=116.30&km=45&onlyMatch=0', { token: teacherToken });
    const noItem = allList.data.list.find((p) => p.id === noPost.data.id);
    ok('硬条件不满足 → matchLevel = none，理由是 ❌',
      !!noItem && noItem.matchLevel === 'none' &&
        noItem.matchReasons.some((text) => text.indexOf('❌') === 0),
      JSON.stringify(noItem && [noItem.matchLevel, noItem.matchReasons]));

    const onlyFit = await api('GET', '/api/posts/open?lat=39.98&lng=116.30&km=45&onlyMatch=1', { token: teacherToken });
    ok('onlyMatch=1 时不符合的单被隐藏',
      !onlyFit.data.list.some((p) => p.id === noPost.data.id) &&
        onlyFit.data.list.some((p) => p.id === fitPost.data.id),
      JSON.stringify(onlyFit.data.list.map((p) => [p.id, p.matchLevel])));
    ok('onlyMatch=0 时"显示全部单"能看到不符合的',
      allList.data.list.some((p) => p.id === noPost.data.id));

    const byGrade = await api('GET', '/api/posts/open?lat=39.98&lng=116.30&km=45&onlyMatch=0&grade=初二', { token: teacherToken });
    ok('按年级筛选生效',
      byGrade.data.list.every((p) => p.grade.indexOf('初二') >= 0) &&
        byGrade.data.list.some((p) => p.id === fitPost.data.id),
      JSON.stringify(byGrade.data.list.map((p) => p.grade)));
    const byGender = await api('GET', '/api/posts/open?lat=39.98&lng=116.30&km=45&onlyMatch=0&gender=女', { token: teacherToken });
    ok('按"要女老师"筛选生效',
      byGender.data.list.every((p) => p.gender === '' || p.gender === '女') &&
        byGender.data.list.some((p) => p.id === noPost.data.id),
      JSON.stringify(byGender.data.list.map((p) => p.gender)));
    const byPrice = await api('GET', '/api/posts/open?lat=39.98&lng=116.30&km=45&onlyMatch=0&minPrice=170&maxPrice=190', { token: teacherToken });
    ok('按时薪区间筛选生效',
      byPrice.data.list.length > 0 &&
        byPrice.data.list.every((p) => {
          const value = Number(String(p.price).match(/\d+/) || [0]);
          return value >= 170 && value <= 190;
        }),
      JSON.stringify(byPrice.data.list.map((p) => p.price)));
    const byRadius = await api('GET', '/api/posts/open?lat=39.98&lng=116.30&radius=1&onlyMatch=0', { token: teacherToken });
    ok('接口文档里的 radius 参数也认（按距离筛）',
      byRadius.code === 0 && byRadius.data.list.every((p) => p.distanceKm < 0 || p.distanceKm <= 1),
      JSON.stringify(byRadius.data.list.map((p) => p.distanceKm)));

    ok('GET /api/posts 和 /api/posts/open 是同一个实现',
      (await api('GET', '/api/posts?lat=39.98&lng=116.30&km=45', { token: teacherToken })).code === 0);

    const rec = await api('GET', '/api/posts/recommended?lat=39.98&lng=116.30&km=45', { token: teacherToken });
    ok('推荐接口只给能投的单',
      rec.code === 0 && !rec.data.list.some((p) => p.matchLevel === 'none'),
      JSON.stringify(rec.data.list.map((p) => [p.id, p.matchLevel])));
    ok('推荐排序：完全符合排在部分符合前面',
      rec.data.list.every((p, i) => i === 0 || rec.data.list[i - 1].matchLevel === 'full' || p.matchLevel !== 'full'),
      JSON.stringify(rec.data.list.map((p) => p.matchLevel)));
    ok('学生（平台）账号调推荐被挡住',
      (await api('GET', '/api/posts/recommended', { token: studentToken })).status === 403);

    console.log('\n[7.1.1] 家长原话 → 结构化要求（POST /api/agent/parse）');
    const parsed = await api('POST', '/api/agent/parse', {
      body: { text: '要女老师，硕士以上，最好有经验，能线下，有教师资格证' }
    });
    ok('没配外部 Agent 时用本地兜底规则解析（固定 5 字段）',
      parsed.code === 0 && parsed.data.gender === '女' && parsed.data.education === '硕士' &&
        parsed.data.certificate === '教师资格证' && parsed.data.teachMode === '线下',
      JSON.stringify(parsed.data));
    ok('含糊的「最好有经验」不猜年限 → 教龄「不限」', parsed.data.minYears === '不限', JSON.stringify(parsed.data));
    ok('原话原样带回来（raw_text）',
      parsed.data.raw_text === '要女老师，硕士以上，最好有经验，能线下，有教师资格证',
      parsed.data.raw_text);

    const batchParsed = await api('POST', '/api/agent/parse', {
      body: { texts: ['要男老师，3 年以上教龄', '博士，普通话证书，线上'] }
    });
    ok('批量解析：一次贴多条原话，逐条返回',
      batchParsed.code === 0 && batchParsed.data.list.length === 2 &&
        batchParsed.data.list[0].gender === '男' && batchParsed.data.list[0].minYears === '3' &&
        batchParsed.data.list[1].education === '博士' && batchParsed.data.list[1].certificate === '普通话证书' &&
        batchParsed.data.list[1].teachMode === '线上',
      JSON.stringify(batchParsed.data.list));
    ok('空原话不让解析（前端 bug 要看得见）',
      (await api('POST', '/api/agent/parse', { body: { text: '   ' } })).code === 1);

    const hourlyParse = await api('POST', '/api/agent/parse', { body: { text: '一次 400 元（一次两小时），要女老师' } });
    ok('按次给钱能折算时薪（400 元 / 2 小时 = 200）',
      hourlyParse.data.priceMin === 200 && hourlyParse.data.priceMax === 200,
      JSON.stringify(hourlyParse.data));
    const perClassParse = await api('POST', '/api/agent/parse', { body: { text: '300 元/节课，有教师资格证' } });
    ok('没写时长的按次价按默认 2 小时折算（300 → 150）',
      perClassParse.data.priceMin === 150 && perClassParse.data.priceMax === 150,
      JSON.stringify(perClassParse.data));
    const exactParse = await api('POST', '/api/agent/parse', { body: { text: '80-120 元/小时，硕士优先' } });
    ok('按小时给价直接用（区间也认）',
      exactParse.data.priceMin === 80 && exactParse.data.priceMax === 120,
      JSON.stringify(exactParse.data));
    const fuzzyParse = await api('POST', '/api/agent/parse', { body: { text: '价格面议，要能上门的老师' } });
    ok('算不出来 / 比较复杂的价格 → 不限（不瞎猜）',
      fuzzyParse.data.priceMin === '不限' && fuzzyParse.data.priceMax === '不限' &&
        fuzzyParse.data.teachMode === '线下',
      JSON.stringify(fuzzyParse.data));

    const cetParse = await api('POST', '/api/agent/parse', { body: { text: '要有英语四六级证书，能线下' } });
    ok('证书能解析出「四六级」', cetParse.data.certificate === '四六级', JSON.stringify(cetParse.data));
    const ieltsParse = await api('POST', '/api/agent/parse', { body: { text: '雅思托福优先' } });
    ok('证书能解析出「雅思托福」', ieltsParse.data.certificate === '雅思托福', JSON.stringify(ieltsParse.data));
    const cetLegacy = await api('POST', '/api/posts', {
      token: studentToken,
      body: {
        subject: '英语', time: '2026-12-08 晚上', price: '150 元/小时', area: '海淀 · 中关村',
        requirements: { certificate: ['英语四级'] }
      }
    });
    const cetPost = (await api('GET', '/api/posts/mine', { token: studentToken }))
      .data.list.find((p) => p.id === cetLegacy.data.id);
    ok('老写法的证书也归一到固定档（英语四级 → 四六级）',
      !!cetPost && cetPost.requirements.certificate === '四六级',
      JSON.stringify(cetPost && cetPost.requirements));

    const http = require('node:http');
    const fakeAgent = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        const text = JSON.parse(raw || '{}').text || '';
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({

          requirements: text.indexOf('脏') >= 0
            ? { gender: '女性', education: '研究生', minYears: '三年', certificate: '奥数教练证', teachMode: '网课' }
            : { gender: '男', education: '博士', minYears: 5, certificate: '普通话证书', teachMode: '线上' },
          echo: text
        }));
      });
    });
    await new Promise((resolve) => fakeAgent.listen(0, '127.0.0.1', resolve));
    config.agentParseUrl = 'http://127.0.0.1:' + fakeAgent.address().port + '/parse';
    const viaAgent = await api('POST', '/api/agent/parse', { body: { text: '随便一句话' } });
    ok('配了 AGENT_PARSE_URL 就把原话转给外部 Agent（认 {requirements:{...}} 这种写法）',
      viaAgent.code === 0 && viaAgent.data.gender === '男' && viaAgent.data.education === '博士' &&
        viaAgent.data.minYears === '5' && viaAgent.data.certificate === '普通话证书' &&
        viaAgent.data.teachMode === '线上',
      JSON.stringify(viaAgent.data));
    const dirtyAgent = await api('POST', '/api/agent/parse', { body: { text: '脏数据一条' } });
    ok('外部 Agent 给的字段过白名单（认不出的写法一律「不限」）',
      dirtyAgent.data.gender === '不限' && dirtyAgent.data.education === '硕士' &&
        dirtyAgent.data.minYears === '不限' && dirtyAgent.data.certificate === '不限' &&
        dirtyAgent.data.teachMode === '线上',
      JSON.stringify(dirtyAgent.data));

    config.agentParseUrl = 'http://127.0.0.1:1/parse';
    const broken = await api('POST', '/api/agent/parse', { body: { text: '女老师，硕士，能线下' } });
    ok('外部 Agent 挂了：解析失败也返回全「不限」+ 原话保留',
      broken.code === 0 && broken.data.gender === '不限' && broken.data.education === '不限' &&
        broken.data.minYears === '不限' && broken.data.certificate === '不限' &&
        broken.data.teachMode === '不限' && broken.data.raw_text === '女老师，硕士，能线下',
      JSON.stringify(broken.data));
    config.agentParseUrl = '';
    fakeAgent.close();

    console.log('\n[7.1.2] 发单带家长原话 + 老师端按固定字段筛选 / 推荐排序');
    const rawPost = await api('POST', '/api/posts', {
      token: studentToken,
      body: {
        subject: '英语', grade: '高一', time: '2026-12-05 晚上', price: '200 元/小时',
        area: '海淀 · 中关村',
        rawText: '家长原话：要女老师，硕士，普通话证书，线上，联系电话 13800000000',
        requirements: { gender: '女', education: '硕士', minYears: '3', certificate: '普通话证书', teachMode: '线上' }
      }
    });
    ok('发单能带家长原话', rawPost.code === 0, rawPost.message);
    const rawMine = (await api('GET', '/api/posts/mine', { token: studentToken }))
      .data.list.find((p) => p.id === rawPost.data.id);
    ok('家长原话存下来了，老师端能看',
      !!rawMine && rawMine.rawText.indexOf('要女老师') >= 0, rawMine && rawMine.rawText);
    ok('原话里的手机号入库前被抹掉（不外泄客户联系方式）',
      !!rawMine && rawMine.rawText.indexOf('13800000000') < 0, rawMine && rawMine.rawText);
    ok('固定 5 字段原样存下来',
      !!rawMine && rawMine.requirements.gender === '女' && rawMine.requirements.education === '硕士' &&
        rawMine.requirements.minYears === '3' && rawMine.requirements.certificate === '普通话证书' &&
        rawMine.requirements.teachMode === '线上',
      JSON.stringify(rawMine && rawMine.requirements));

    const filterBase = '?lat=39.98&lng=116.30&km=45&onlyMatch=0';
    const byReqGender = await api('GET', '/api/posts/open' + filterBase + '&gender=女', { token: teacherToken });
    ok('按性别要求筛：只留「要女老师」的和「不限」的单',
      byReqGender.data.list.every((p) => p.requirements.gender === '女' || p.requirements.gender === '不限') &&
        byReqGender.data.list.some((p) => p.id === rawPost.data.id) &&
        !byReqGender.data.list.some((p) => p.id === fitPost.data.id),
      JSON.stringify(byReqGender.data.list.map((p) => [p.id, p.requirements.gender])));
    const byReqEdu = await api('GET', '/api/posts/open' + filterBase + '&education=本科', { token: teacherToken });
    ok('按学历筛（档位）：要本科 / 不限的单要，要硕士的不要',
      byReqEdu.data.list.every((p) => ['本科', '不限'].indexOf(p.requirements.education) >= 0) &&
        byReqEdu.data.list.some((p) => p.id === fitPost.data.id) &&
        !byReqEdu.data.list.some((p) => p.id === rawPost.data.id),
      JSON.stringify(byReqEdu.data.list.map((p) => [p.id, p.requirements.education])));
    const byReqCert = await api('GET', '/api/posts/open' + filterBase + '&certificate=普通话证书', { token: teacherToken });
    ok('按证书筛：要普通话证书 / 不限的单要，要教师资格证的不要',
      byReqCert.data.list.every((p) => ['普通话证书', '不限'].indexOf(p.requirements.certificate) >= 0) &&
        byReqCert.data.list.some((p) => p.id === rawPost.data.id) &&
        !byReqCert.data.list.some((p) => p.id === fitPost.data.id),
      JSON.stringify(byReqCert.data.list.map((p) => [p.id, p.requirements.certificate])));
    const byReqMode = await api('GET', '/api/posts/open' + filterBase + '&teachMode=线上', { token: teacherToken });
    ok('按授课方式筛：要线上 / 不限的单要，要线下的不要',
      byReqMode.data.list.every((p) => ['线上', '不限'].indexOf(p.requirements.teachMode) >= 0) &&
        byReqMode.data.list.some((p) => p.id === rawPost.data.id) &&
        !byReqMode.data.list.some((p) => p.id === fitPost.data.id),
      JSON.stringify(byReqMode.data.list.map((p) => [p.id, p.requirements.teachMode])));
    const byReqYears = await api('GET', '/api/posts/open' + filterBase + '&minYears=3', { token: teacherToken });
    ok('按教龄筛（档位）：要求 5 年的单对 3 年老师不显示',
      byReqYears.data.list.every((p) => p.requirements.minYears !== '5') &&
        byReqYears.data.list.some((p) => p.id === rawPost.data.id),
      JSON.stringify(byReqYears.data.list.map((p) => [p.id, p.requirements.minYears])));
    ok('「不限」的字段不参与筛选：没写要求的单照样在',
      byReqMode.data.list.some((p) => p.requirements.teachMode === '不限'));

    const bothGender = await api('GET', '/api/posts/open' + filterBase + '&gender=男,女', { token: teacherToken });
    ok('单子要求能多选（gender=男,女 两种都留）',
      bothGender.data.list.some((p) => p.id === fitPost.data.id) &&
        bothGender.data.list.some((p) => p.id === rawPost.data.id) &&
        bothGender.data.list.every((p) =>
          p.requirements.gender === '不限' || ['男', '女'].indexOf(p.requirements.gender) >= 0),
      JSON.stringify(bothGender.data.list.map((p) => [p.id, p.requirements.gender])));
    const bothEdu = await api('GET', '/api/posts/open' + filterBase + '&education=本科,硕士', { token: teacherToken });
    ok('学历要求也能多选', bothEdu.data.list.some((p) => p.id === fitPost.data.id) &&
      bothEdu.data.list.some((p) => p.id === rawPost.data.id), JSON.stringify(bothEdu.data.list.length));

    const myMale = await api('GET', '/api/posts/open' + filterBase + '&myGender=男', { token: teacherToken });
    ok('我勾"男老师"：要女老师的单被藏起来',
      myMale.data.list.some((p) => p.id === fitPost.data.id) &&
        !myMale.data.list.some((p) => p.id === rawPost.data.id),
      JSON.stringify(myMale.data.list.map((p) => [p.id, p.requirements.gender])));
    const myBachelor = await api('GET', '/api/posts/open' + filterBase + '&myEducation=本科', { token: teacherToken });
    ok('我勾"本科"：要硕士的单被藏起来',
      myBachelor.data.list.some((p) => p.id === fitPost.data.id) &&
        !myBachelor.data.list.some((p) => p.id === rawPost.data.id),
      JSON.stringify(myBachelor.data.list.map((p) => [p.id, p.requirements.education])));
    const myYear1 = await api('GET', '/api/posts/open' + filterBase + '&myYears=1', { token: teacherToken });
    ok('我勾"1 年教龄"：要 3 年 / 5 年的单被藏起来，要 1 年的留着',
      myYear1.data.list.some((p) => p.id === fitPost.data.id) &&
        !myYear1.data.list.some((p) => p.id === rawPost.data.id) &&
        !myYear1.data.list.some((p) => p.id === noPost.data.id),
      JSON.stringify(myYear1.data.list.map((p) => [p.id, p.requirements.minYears])));
    const myCert = await api('GET', '/api/posts/open' + filterBase + '&myCertificate=教师资格证', { token: teacherToken });
    ok('我勾"教师资格证"：只认普通话证书的单被藏起来',
      !myCert.data.list.some((p) => p.id === rawPost.data.id) &&
        myCert.data.list.some((p) => p.id === fitPost.data.id),
      JSON.stringify(myCert.data.list.map((p) => [p.id, p.requirements.certificate])));
    const myOnline = await api('GET', '/api/posts/open' + filterBase + '&myTeachMode=线上', { token: teacherToken });
    ok('我勾"线上"：要线下的单被藏起来，要线上 / 不限的留着',
      !myOnline.data.list.some((p) => p.id === fitPost.data.id) &&
        myOnline.data.list.some((p) => p.id === rawPost.data.id),
      JSON.stringify(myOnline.data.list.map((p) => [p.id, p.requirements.teachMode])));

    const cetList = await api('GET', '/api/posts/open' + filterBase + '&certificate=四六级', { token: teacherToken });
    const cetItem = cetList.data.list.find((p) => p.id === cetLegacy.data.id);
    ok('按「四六级」筛：能筛到要四六级的单',
      !!cetItem && cetList.data.list.every((p) =>
        ['四六级', '不限'].indexOf(p.requirements.certificate) >= 0),
      JSON.stringify(cetList.data.list.map((p) => [p.id, p.requirements.certificate])));
    ok('老师简历里写的"英语六级"算有「四六级」（证书命中，不是 ❌）',
      !!cetItem &&
        cetItem.matchReasons.some((text) => text.indexOf('✅ 证书满足（四六级）') === 0) &&
        !cetItem.matchReasons.some((text) => text.indexOf('❌') === 0 && text.indexOf('证书') >= 0),
      JSON.stringify(cetItem && [cetItem.matchLevel, cetItem.matchReasons]));

    const byMinHourly = await api('GET', '/api/posts/open' + filterBase + '&minPrice=180', { token: teacherToken });
    ok('最低时薪筛：单子时薪下限 100（<180）藏起来，200 的显示',
      !byMinHourly.data.list.some((p) => p.id === fitPost.data.id) &&
        byMinHourly.data.list.some((p) => p.id === rawPost.data.id),
      JSON.stringify(byMinHourly.data.list.map((p) => [p.id, p.price])));
    const lowerHourly = await api('GET', '/api/posts/open' + filterBase + '&minPrice=100', { token: teacherToken });
    ok('老师把最低时薪降到 100 就又能看到了（按单子的时薪下限比）',
      lowerHourly.data.list.some((p) => p.id === fitPost.data.id),
      JSON.stringify(lowerHourly.data.list.map((p) => [p.id, p.price])));

    const plainPost = await api('POST', '/api/posts', {
      token: studentToken,
      body: { subject: '数学', time: '2026-12-06 晚上', price: '150 元/小时', area: '海淀 · 中关村' }
    });
    const richPost = await api('POST', '/api/posts', {
      token: studentToken,
      body: {
        subject: '数学', time: '2026-12-07 晚上', price: '150 元/小时', area: '海淀 · 中关村',
        requirements: { gender: '男', certificate: '教师资格证' }
      }
    });
    const rec2 = await api('GET', '/api/posts/recommended?lat=39.98&lng=116.30&km=45', { token: teacherToken });
    const richIndex = rec2.data.list.findIndex((p) => p.id === richPost.data.id);
    const plainIndex = rec2.data.list.findIndex((p) => p.id === plainPost.data.id);
    ok('推荐列表里带匹配度打分',
      rec2.data.list.some((p) => Number(p.matchScore) > 0),
      JSON.stringify(rec2.data.list.map((p) => [p.id, p.matchScore])));
    ok('推荐排序：都符合时，满足的明确要求多的单排在前面',
      richIndex >= 0 && plainIndex >= 0 && richIndex < plainIndex,
      JSON.stringify([richIndex, plainIndex, rec2.data.list.map((p) => [p.id, p.matchScore])]));

    console.log('\n[7.2] 外部 Agent：令牌 / 批量发单 / 消息 / 事件');
    const agentDomain = require('../domain/agent.js');
    const agentInfo = await agentDomain.ensureAgent(db, studentId);
    const agentToken = await agentDomain.issueToken(db, studentId, agentInfo.id, '测试令牌');

    ok('没有令牌调 Agent 接口被拒',
      (await api('POST', '/api/agent/posts/batch', { body: { posts: [] } })).status === 401);
    ok('乱写令牌也被拒',
      (await api('POST', '/api/agent/posts/batch', { agentToken: 'deadbeef', body: { posts: [] } })).status === 401);

    const agentBatch = await api('POST', '/api/agent/posts/batch', {
      agentToken,
      body: {
        posts: [
          { subject: '化学', time: '2026-11-20 晚上', price: '160 元/小时', area: '海淀 · 学院路', externalId: 'A-1' }
        ]
      }
    });
    ok('Agent 能凭令牌批量发单', agentBatch.code === 0 && agentBatch.data.ok.length === 1, JSON.stringify(agentBatch.data));
    const agentPosts = await api('GET', '/api/posts/mine', { token: studentToken });
    ok('Agent 发的单挂在令牌绑定的平台账号下，source 标 agent',
      agentPosts.data.list.some((p) => p.source === 'agent' && p.subject === '化学'));

    const events = await api('GET', '/api/agent/events?since=0', { agentToken });
    ok('老师投递这类关键节点落成了事件',
      events.code === 0 && events.data.list.some((e) => e.type === 'booking_created'),
      JSON.stringify(events.data.list.map((e) => e.type)));
    ok('平台确认 / 拒绝也有事件',
      events.data.list.some((e) => e.type === 'booking_confirmed') &&
        events.data.list.some((e) => e.type === 'contract_ready'),
      JSON.stringify(events.data.list.map((e) => e.type)));

    const agentMsg = await api('POST', '/api/agent/message', {
      agentToken,
      body: {
        to_user_id: teacherId,
        type: 'contract',
        content: '合同和收款码发你了，按合同付款后开始试课。',
        contract_url: 'https://example.com/contract/abc.pdf'
      }
    });
    ok('Agent 能给老师发合同消息', agentMsg.code === 0 && agentMsg.data.kind === 'contract', agentMsg.message);

    const teacherPeers = await api('GET', '/api/agents/mine', { token: teacherToken });
    ok('老师的消息列表里有官方助手（置顶那栏）',
      teacherPeers.data.list.length === 1 && teacherPeers.data.list[0].official === true,
      JSON.stringify(teacherPeers.data.list));
    const agentId = teacherPeers.data.list[0].id;
    const agentChat = await api('GET', '/api/chats/agent/' + agentId, { token: teacherToken });
    ok('点开官方助手能看到那条合同消息',
      agentChat.data.list.length === 1 && agentChat.data.list[0].fromAgent === true, JSON.stringify(agentChat.data.list));
    ok('官方助手会话只返回会话本身（「轮流一条」的限额字段已下线）',
      Array.isArray(agentChat.data.list) && agentChat.data.quota === undefined,
      JSON.stringify(agentChat.data.quota));

    const teacherAsk = await api('POST', '/api/chats/agent/' + agentId, {
      token: teacherToken, body: { body: '合同里的第二次课时间能改吗？' }
    });
    ok('老师能给官方助手发消息', teacherAsk.code === 0, teacherAsk.message);
    const agentReply = await api('POST', '/api/agent/chat/reply', {
      agentToken, body: { teacher_id: teacherId, content: '可以的，我帮你改一下。' }
    });
    ok('外部 Agent 能回复老师的聊天', agentReply.code === 0, agentReply.message);
    const agentChat2 = await api('GET', '/api/chats/agent/' + agentId, { token: teacherToken });
    ok('一来一回都在会话里',
      agentChat2.data.list.length === 3 &&
        agentChat2.data.list[2].fromAgent === true &&
        agentChat2.data.list[2].body.indexOf('帮你改') >= 0,
      JSON.stringify(agentChat2.data.list));

    const box = await api('GET', '/api/messages/mine', { token: teacherToken });
    ok('消息中心能看到 Agent 发的合同消息',
      box.data.list.some((m) => m.kind === 'contract' && m.contractUrl.indexOf('example.com') >= 0),
      JSON.stringify(box.data.list));
    ok('消息中心有未读数', box.data.unread > 0, String(box.data.unread));
    const firstUnread = box.data.list.find((m) => !m.isRead);
    ok('点开通知能标已读',
      (await api('POST', '/api/messages/' + firstUnread.id + '/read', { token: teacherToken })).code === 0);

    console.log('\n[7.3] 收款 / 退款（平台和老师之间）');
    const payPost = await api('POST', '/api/posts', {
      token: studentToken,
      body: { subject: '物理', time: '2026-12-01 晚上', price: '200 元/次', area: '北京海淀' }
    });
    const payTake = await api('POST', '/api/posts/' + payPost.data.id + '/take', {
      token: teacherToken, body: { resume: '收款流程走一遍' }
    });
    const payBookingId = payTake.data.bookingId;
    await api('POST', '/api/bookings/' + payBookingId + '/accept', {
      token: studentToken,
      body: { amount: 500, contractUrl: 'https://example.com/contract/1' }
    });
    let payBooking = (await api('GET', '/api/bookings/mine', { token: studentToken }))
      .data.list.find((b) => b.id === payBookingId);
    const charge = payBooking.payStats.charge;
    ok('平台确认接单后生成一条待收款（合同金额 500）',
      !!charge && charge.amount === 500 && charge.status === '待收款', JSON.stringify(charge));

    const gated = await api('POST', '/api/bookings/' + payBookingId + '/lessons', {
      token: teacherToken, body: { kind: '试课', content: '' }
    });
    ok('还没确认收款时老师提交试课被挡住',
      gated.code === 1 && gated.message.indexOf('收款') >= 0, gated.message);

    ok('老师能标记「我已付款」',
      (await api('POST', '/api/payments/' + charge.id + '/paid', { token: teacherToken })).code === 0);
    ok('老师不能自己确认收款',
      (await api('POST', '/api/payments/' + charge.id + '/confirm', { token: teacherToken })).status === 403);
    ok('平台确认收款',
      (await api('POST', '/api/payments/' + charge.id + '/confirm', { token: studentToken })).code === 0);
    payBooking = (await api('GET', '/api/bookings/mine', { token: teacherToken }))
      .data.list.find((b) => b.id === payBookingId);
    ok('确认收款后状态是已收款', payBooking.payStats.charge.status === '已收款', JSON.stringify(payBooking.payStats));

    const paidTrial = await api('POST', '/api/bookings/' + payBookingId + '/lessons', {
      token: teacherToken, body: { kind: '试课', content: '试课' }
    });
    ok('确认收款后老师能提交试课', paidTrial.code === 0, paidTrial.message);
    await api('POST', '/api/lessons/' + paidTrial.data.id + '/trial', {
      token: studentToken, body: { pass: false, half: true }
    });
    const refunded = await api('POST', '/api/payments/' + charge.id + '/refund', {
      token: studentToken, body: { note: '没上成，全额退' }
    });
    ok('没上成：平台确认全额退款', refunded.code === 0 && refunded.data.amount === 500, JSON.stringify(refunded.data));
    payBooking = (await api('GET', '/api/bookings/mine', { token: studentToken }))
      .data.list.find((b) => b.id === payBookingId);
    ok('退款后收款变已退款，退款金额记下来',
      payBooking.payStats.charge.status === '已退款' && payBooking.payStats.refunded === 500,
      JSON.stringify(payBooking.payStats));

    const partPost = await api('POST', '/api/posts', {
      token: studentToken,
      body: { subject: '语文', time: '2026-12-02 晚上', price: '200 元/次', area: '北京海淀' }
    });
    const partTake = await api('POST', '/api/posts/' + partPost.data.id + '/take', {
      token: teacherToken, body: { resume: '部分退款走一遍' }
    });
    await api('POST', '/api/bookings/' + partTake.data.bookingId + '/accept', {
      token: studentToken, body: { amount: 600 }
    });
    const partCharge = (await api('GET', '/api/bookings/mine', { token: studentToken }))
      .data.list.find((b) => b.id === partTake.data.bookingId).payStats.charge;
    await api('POST', '/api/payments/' + partCharge.id + '/confirm', { token: studentToken });
    const partRefund = await api('POST', '/api/payments/' + partCharge.id + '/refund', {
      token: studentToken, body: { amount: 400, note: '上了一次，扣一次课的钱' }
    });
    ok('上过一次课：按合同只退一部分（600 退 400）',
      partRefund.code === 0 && partRefund.data.amount === 400, JSON.stringify(partRefund.data));

    console.log('\n[7.4] 中介工作台：单子卡片 + 修正（改状态 / 补录 / 作废）');

    const fixPost = await api('POST', '/api/posts', {
      token: studentToken,
      body: { subject: '数学', time: '2026-12-20 晚上', price: '150 元/次', area: '北京海淀' }
    });
    const fixPostId = fixPost.data.id;
    await api('POST', '/api/posts/' + fixPostId + '/take', {
      token: teacherToken, body: { resume: '修正流程走一遍' }
    });
    const studentBoxes = await api('GET', '/api/messages/boxes', { token: studentToken });
    const fixBox = (studentBoxes.data.list || []).find((b) => b.postId === fixPostId);
    ok('中介端也能看到自己的单子卡片（一条单一张）',
      !!fixBox && fixBox.statusText === '待平台确认' && fixBox.inviteCount === 1 && fixBox.pendingCount === 1,
      JSON.stringify(fixBox));
    ok('中介端卡片上带这条单子的属性', !!fixBox && fixBox.subject === '数学' && fixBox.price === '150 元/次');
    const fixBookingId = fixBox ? fixBox.bookingId : 0;
    ok('卡片上带着这条订单的 id（修正要用）', fixBookingId > 0, String(fixBookingId));

    const fixStatus = await api('POST', '/api/posts/' + fixPostId + '/correct', {
      token: studentToken, body: { action: 'status', status: '已成交', note: '家长线下定了' }
    });
    ok('中介能把单子状态改成已成交', fixStatus.code === 0 && fixStatus.data.status === '已成交',
      JSON.stringify(fixStatus.data));
    const mineAfterFix = await api('GET', '/api/posts/mine', { token: studentToken });
    ok('改完之后「我发布的」里就是已成交',
      mineAfterFix.data.list.find((p) => p.id === fixPostId).status === '已成交');

    ok('别人的单不能修正（403）',
      (await api('POST', '/api/posts/' + fixPostId + '/correct', {
        token: teacherToken, body: { action: 'status', status: '已撤销' }
      })).status === 403);

    const fixBooking = await api('POST', '/api/bookings/' + fixBookingId + '/correct', {
      token: studentToken, body: { status: '已结束', note: '家长说不用上了', notify: true }
    });
    ok('中介能把订单状态改成已结束', fixBooking.code === 0 && fixBooking.data.status === '已结束',
      JSON.stringify(fixBooking.data));
    const boxesAfterFix = await api('GET', '/api/messages/boxes', { token: studentToken });
    ok('订单状态一变，卡片的「状态这一栏」跟着变（不新增卡片）',
      (boxesAfterFix.data.list || []).find((b) => b.postId === fixPostId).statusText === '已结束');

    const recordPost = await api('POST', '/api/posts', {
      token: studentToken,
      body: { subject: '英语', time: '2026-12-21 晚上', price: '180 元/次', area: '北京海淀' }
    });
    const recordFix = await api('POST', '/api/posts/' + recordPost.data.id + '/correct', {
      token: studentToken,
      body: { action: 'record', teacherId, price: '180 元/次', status: '主订单进行中', note: '线下成交补录' }
    });
    ok('中介能补录一条线下成交的订单',
      recordFix.code === 0 && recordFix.data.bookingId > 0, JSON.stringify(recordFix.data));
    const teacherBookingsAfter = await api('GET', '/api/bookings/mine', { token: teacherToken });
    ok('补录的订单落在老师名下（老师「我的课」能看到）',
      teacherBookingsAfter.data.list.some((b) => b.id === recordFix.data.bookingId &&
        b.status === '主订单进行中'));

    const voidPost = await api('POST', '/api/posts', {
      token: studentToken,
      body: { subject: '化学', time: '2026-12-22 晚上', price: '160 元/次', area: '北京海淀' }
    });
    await api('POST', '/api/posts/' + voidPost.data.id + '/take', {
      token: teacherToken, body: { resume: '投了又被作废' }
    });
    const voidFix = await api('POST', '/api/posts/' + voidPost.data.id + '/correct', {
      token: studentToken, body: { action: 'void', note: '家长不找了' }
    });
    ok('中介能把单子作废（软删，不是真删）',
      voidFix.code === 0 && voidFix.data.status === '已关闭', JSON.stringify(voidFix.data));
    const voidBoxes = await api('GET', '/api/messages/boxes', { token: studentToken });
    const voidBox = (voidBoxes.data.list || []).find((b) => b.postId === voidPost.data.id);
    ok('作废的单子卡片还在（历史能翻），状态是已关闭',
      !!voidBox && voidBox.statusText === '已关闭' && voidBox.pendingCount === 0,
      JSON.stringify(voidBox));

    const fixLog = await api('GET', '/api/corrections?target=post&targetId=' + fixPostId,
      { token: studentToken });
    ok('修正有记录可查', fixLog.code === 0 && fixLog.data.list.length >= 1 &&
      fixLog.data.list[0].toStatus === '已成交', JSON.stringify(fixLog.data.list));
    ok('修正记录里能看到谁在什么时候改的（含备注）',
      String(fixLog.data.list[0].note).indexOf('家长线下定了') >= 0 && !!fixLog.data.list[0].createdAt);

    console.log('\n[8] 「我的」页汇总 / 退出登录');
    const studentDash = await api('GET', '/api/me', { token: studentToken });
    ok('学生汇总：资料 + 统计', studentDash.data.role === 'student' && studentDash.data.student.name === '小明');
    ok('统计里累计消费按价格快照算（是数字、不为负）',
      typeof studentDash.data.stats.totalSpent === 'number' && studentDash.data.stats.totalSpent >= 0,
      JSON.stringify(studentDash.data.stats));

    const saveStudent = await api('PUT', '/api/students/me', {
      token: studentToken,
      body: { name: '小明', school: '人大附中', grade: '初二', phone: '13800000000' }
    });
    ok('学生资料保存成功', saveStudent.code === 0, saveStudent.message);

    const teacherBookings = await api('GET', '/api/bookings/mine', { token: teacherToken });
    ok('老师拿到的订单里发单方只显示「平台」',
      teacherBookings.data.list.every((b) => b.studentName === '平台'),
      JSON.stringify(teacherBookings.data.list.map((b) => b.studentName)));
    ok('老师那侧的数据里带不出客户的手机号',
      JSON.stringify(teacherBookings.data).indexOf('13800000000') < 0);

    const logout = await api('POST', '/api/auth/logout', { token: studentToken });
    ok('退出登录成功', logout.code === 0);
    const afterLogout = await api('GET', '/api/auth/me', { token: studentToken });
    ok('退出后那枚 token 立刻失效', afterLogout.status === 401, String(afterLogout.status));
    const teacherStillOk = await api('GET', '/api/auth/me', { token: teacherToken });
    ok('别的设备/账号不受影响（多端各自一枚令牌）', teacherStillOk.code === 0);

    console.log('\n全部通过：' + passed + ' 项\n');
  } finally {

    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('\n测试中断：' + (e && e.message ? e.message : e));
  process.exit(1);
});
