const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const config = require('../server/config.js');
const { openDatabase } = require('../server/db/index.js');
const { createServer } = require('../server/server.js');

const ROOT = path.join(__dirname, '..');
let passed = 0;

let simApiBase = 'http://127.0.0.1:' + config.port + '/api';

function ok(name, condition, detail) {
  passed++;
  if (condition) {
    console.log('  ✓ ' + name);
    return;
  }
  console.error('  ✗ ' + name + (detail === undefined ? '' : ' → ' + JSON.stringify(detail)));
  throw new Error('模拟测试失败：' + name);
}

function fakeWx(storage) {
  return {
    getStorageSync(key) {
      return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : '';
    },
    setStorageSync(key, value) {
      storage[key] = value;
    },
    removeStorageSync(key) {
      delete storage[key];
    },
    login(options) {

      setTimeout(() => options.success({ code: 'simulated-code' }), 0);
    },
    request(options) {
      const method = options.method || 'GET';
      let url = options.url;
      const init = { method, headers: options.header || {} };
      if (method === 'GET') {
        if (options.data) {
          const pairs = [];
          Object.keys(options.data).forEach((key) => {
            const value = options.data[key];
            if (value === undefined || value === null) return;
            pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
          });
          if (pairs.length > 0) url += (url.indexOf('?') >= 0 ? '&' : '?') + pairs.join('&');
        }
      } else {
        init.body = JSON.stringify(options.data || {});
      }
      fetch(url, init)
        .then(async (response) => {
          options.success({ statusCode: response.status, data: await response.json() });
        })
        .catch((e) => options.fail({ errMsg: String(e) }));
    },
    showModal() {},
    showToast() {}
  };
}

function createRuntime() {
  const storage = {};
  const cache = {};
  const sandbox = {
    wx: fakeWx(storage),
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    JSON,
    Math,
    Object,
    Array,
    Error,
    Number,
    String,
    Boolean,
    isFinite,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent
  };
  const context = vm.createContext(sandbox);

  function loadModule(fullPath) {
    const full = path.resolve(fullPath);

    if (full.replace(/\\/g, '/').endsWith('utils/config.js')) {
      return {
        IS_DEV: true,
        DEV_BASES: [simApiBase],
        PROD_BASE: simApiBase,
        apiBases: () => [simApiBase],
        apiBase: () => simApiBase
      };
    }
    if (cache[full]) return cache[full].exports;
    const module = { exports: {} };
    cache[full] = module;
    const dir = path.dirname(full);
    const localRequire = (request) => {
      if (request.charAt(0) !== '.') throw new Error('模拟环境不支持第三方模块：' + request);
      let target = path.resolve(dir, request);
      if (!target.endsWith('.js')) target += '.js';
      return loadModule(target);
    };
    const source = fs.readFileSync(full, 'utf8');
    const factory = vm.runInContext(
      '(function (exports, require, module, __filename, __dirname) {' + source + '\n})',
      context,
      { filename: full }
    );
    factory(module.exports, localRequire, module, full, dir);
    return module.exports;
  }

  return { storage, load: (rel) => loadModule(path.join(ROOT, rel)) };
}

function newDevice(name) {
  const runtime = createRuntime();
  return {
    name,
    storage: runtime.storage,
    store: runtime.load('utils/store.js'),
    session: runtime.load('utils/session.js')
  };
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tutormini-sim-'));
  const db = await openDatabase(Object.assign({}, config, {
    dbDriver: 'sqlite',
    sqliteFile: path.join(dir, 'sim.db'),
    seedDemo: false
  }));
  const { server } = await createServer(db);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  simApiBase = 'http://127.0.0.1:' + server.address().port + '/api';
  console.log('临时后端：' + simApiBase + '（数据库 ' + db.location + '）\n');

  try {
    console.log('[1] 启动 / 登录：小程序端只存令牌');
    const phone = newDevice('手机');
    const sim = newDevice('模拟器');

    ok('init 探到后端', (await phone.store.init()) === '');
    ok('没登录时 restoreLogin 返回 false', (await phone.store.restoreLogin()) === false);
    ok('访客没有任何登录态', phone.session.isLoggedIn() === false);

    const studentId = await phone.store.registerStudent('小明', '123456');
    ok('注册/登录学生成功并拿到 id', studentId > 0, studentId);
    ok('会话里身份是学生', phone.session.isStudent() === true);
    ok('wx.storage 里只有一枚令牌', Object.keys(phone.storage).join(',') === 'session_token', Object.keys(phone.storage));
    ok('数据不再落本地库（tutor_db_v1 不存在）', phone.storage.tutor_db_v1 === undefined);

    const badPassword = await phone.store.loginStudent('小明', '错误密码');
    ok('密码不对登录失败', badPassword === -1);
    ok('失败原因就是原来的文案', phone.store.lastError.indexOf('姓名或密码不对') >= 0, phone.store.lastError);

    console.log('\n[2] 老师资料 / 两台设备看到同一份数据');
    const teacherId = await sim.store.registerTeacher('王数学', 'abc123');
    ok('老师在另一台设备上注册成功', teacherId > 0, teacherId);

    const savedId = await sim.store.saveTeacherProfile(teacherId, {
      name: '王数学', subject: '数学', price: '99 元/小时', area: '北京海淀',
      lat: 39.98, lng: 116.30, intro: ''
    });
    ok('老师资料保存成功', savedId === teacherId, savedId);

    const list = await phone.store.teachers('全部', '');
    ok('学生这台设备立刻能看到老师（跨设备同一份数据）', list.length === 1 && list[0].name === '王数学', list);
    ok('科目下拉来自后端', (await phone.store.subjects()).indexOf('数学') >= 0);

    console.log('\n[3] 附近筛选（后端按传上来的定位筛）');
    phone.store.setViewerLocation({ latitude: 39.98, longitude: 116.30 });
    ok('同城能看到这位老师', (await phone.store.teachers('全部', '')).length === 1);
    phone.store.setViewerLocation({ latitude: 31.23, longitude: 121.47 });
    phone.store.setNearbyKm(5);
    ok('上海看北京看不到，并给出隐藏条数', (await phone.store.teachers('全部', '')).length === 0 && phone.store.lastHidden === 1);
    phone.store.setShowAll(true);
    ok('点"看全部"就都出来了', (await phone.store.teachers('全部', '')).length === 1);
    phone.store.setShowAll(false);
    phone.store.setNearbyKm(0);

    console.log('\n[4] 旧的下单接口已下线（改成平台发单、老师投递）');

    ok('数据层不再暴露 createBooking', phone.store.createBooking === undefined);
    ok('数据层不再暴露评价相关方法', phone.store.submitReview === undefined && phone.store.replyReview === undefined);

    console.log('\n[5] 发单 / 接单（学生发单，老师接单）');
    const teacherPost = await sim.store.createPost({
      publisherIsTeacher: true, publisherId: teacherId, publisherName: '王数学',
      subject: '数学', time: '2026-10-03 上午', price: '120 元/次', area: '北京海淀',
      lat: 39.98, lng: 116.30, note: '初二数学'
    });
    ok('老师发单被挡住（老师只能接单）',
      teacherPost === false && sim.store.lastError.indexOf('老师不能发单') >= 0, sim.store.lastError);

    const postId = await phone.store.createPost({
      subject: '数学', time: '2026-10-02 下午', price: '120 元/次', area: '北京海淀',
      lat: 39.98, lng: 116.30, note: '初二数学'
    });
    ok('学生（家长）发单成功', postId > 0, postId);

    const guest = newDevice('访客');
    await guest.store.restoreLogin();
    ok('访客能看到招募中的单', (await guest.store.allOpenPosts()).length === 1);
    ok('学生这边没有"可接的单"（接单是老师的事）', (await phone.store.postsForTaking()).length === 0);

    const takeList = await sim.store.postsForTaking();
    ok('老师看到学生发的单', takeList.length === 1 && takeList[0].publisherIsTeacher === false, takeList);
    ok('学生接单被挡住（接单要老师账号）',
      (await phone.store.takePost(takeList[0].id)) === null &&
        phone.store.lastError.indexOf('老师账号') >= 0,
      phone.store.lastError);
    ok('老师不带简历接单被挡住',
      (await sim.store.takePost(takeList[0].id)) === null && sim.store.lastError.indexOf('简历') >= 0,
      sim.store.lastError);
    ok('老师带简历投递成功',
      !!((await sim.store.takePost(takeList[0].id, '我是王数学老师，带初二数学 8 年。')) || {}).conflict === false,
      sim.store.lastError);

    const teacher2 = newDevice('李老师');
    const teacher2Id = await teacher2.store.registerTeacher('李英语', 'abc123');
    ok('一条单可以被多位老师投递',
      !!((await teacher2.store.takePost(takeList[0].id, '我是李英语老师，数学也能带。')) || {}).conflict === false,
      teacher2.store.lastError);
    ok('同一位老师不能重复投递同一条单',
      (await sim.store.takePost(takeList[0].id, '再来一次')) === null, sim.store.lastError);

    const waitingCourse = (await phone.store.bookingsForStudent(studentId))
      .find((b) => b.day === '2026-10-02 下午');
    ok('接单后先生成一条待确认的课（等家长确认）',
      !!waitingCourse && waitingCourse.status === '待确认', waitingCourse);
    ok('老师投递的简历跟着这条课存下来了',
      waitingCourse.resume.indexOf('王数学') >= 0, waitingCourse.resume);
    const mineWithInvites = (await phone.store.myPosts()).find((p) => p.id === takeList[0].id);
    ok('学生「我发布的」看到收到 2 条投递',
      mineWithInvites.invites.length === 2, mineWithInvites.invites);
    ok('学生确认之后才算接单成功', (await phone.store.acceptBooking(waitingCourse.id)) === true, phone.store.lastError);
    ok('确认后这条课变试课中',
      (await phone.store.bookingsForStudent(studentId)).some((b) => b.id === waitingCourse.id && b.status === '试课中'));
    ok('没被选上的那位老师看到「家长选了别人」',
      (await teacher2.store.bookingsForTeacher(teacher2Id)).some((b) => b.status === '已拒绝'),
      await teacher2.store.bookingsForTeacher(teacher2Id));
    ok('"我发布的"里能看到自己发的那条', (await phone.store.myPosts()).length === 1);

    ok('老师能取消自己接的课', (await sim.store.cancelBooking(waitingCourse.id)) === true, sim.store.lastError);
    ok('取消预约后单子重新回到可接的单', (await sim.store.postsForTaking()).length === 1);
    ok('取消后那条课的状态是已取消',
      (await phone.store.bookingsForStudent(studentId)).some((b) => b.id === waitingCourse.id && b.status === '已取消'));
    ok('重新开放的单老师还能再投递',
      !!((await sim.store.takePost(takeList[0].id, '简历再来一次')) || {}).conflict === false,
      sim.store.lastError);

    const refusedCourse = (await phone.store.bookingsForStudent(studentId))
      .find((b) => b.status === '待确认');
    ok('学生能回绝这次接单（换一位老师）',
      (await phone.store.rejectBooking(refusedCourse.id)) === true, phone.store.lastError);
    ok('回绝后单子又回到可接的单', (await sim.store.postsForTaking()).length === 1);

    ok('老师再投递一次',
      !!((await sim.store.takePost(takeList[0].id, '第三次投递')) || {}).conflict === false, sim.store.lastError);
    const finalCourse = (await phone.store.bookingsForStudent(studentId)).find((b) => b.status === '待确认');
    ok('学生再确认一次', (await phone.store.acceptBooking(finalCourse.id)) === true, phone.store.lastError);

    const submitTrial = await sim.store.submitLesson(finalCourse.id, sim.store.lessonTrial(), '试课讲了函数');
    ok('老师提交试课完成', !!submitTrial && submitTrial.kind === '试课', sim.store.lastError);
    const trialLessonId = submitTrial.id;

    ok('家长通过试课（试课费按半价）',
      (await phone.store.trialResult(trialLessonId, true, true)) === true, phone.store.lastError);
    const afterTrial = (await phone.store.bookingsForStudent(studentId)).find((b) => b.id === finalCourse.id);
    ok('试课通过后订单进入主订单进行中', afterTrial.status === '主订单进行中', afterTrial.status);
    ok('试课那条按半价 60 计入待支付金额',
      afterTrial.lessons[0].fee === 60 &&
        afterTrial.lessonStats.confirmedCount === 1 && afterTrial.lessonStats.unpaidAmount === 60,
      afterTrial.lessonStats);

    const submitFormal = await sim.store.submitLesson(finalCourse.id, sim.store.lessonFormal(), '第二次课');
    ok('主订单里老师提交「完成本次」', !!submitFormal && submitFormal.seq === 1, sim.store.lastError);
    ok('家长有异议：填原因课次退回待确认',
      (await phone.store.disputeLesson(submitFormal.id, '板书看不清')) === true, phone.store.lastError);
    ok('异议后还是待确认，老师这边能看到原因',
      (await sim.store.bookingsForTeacher(teacherId))
        .find((b) => b.id === finalCourse.id).lessons
        .some((l) => l.id === submitFormal.id && l.pending && l.reason === '板书看不清'),
      sim.store.lastError);
    ok('老师改完重新提交',
      (await sim.store.resubmitLesson(submitFormal.id, '板书重写了一遍')) === true, sim.store.lastError);
    ok('家长确认本次', (await phone.store.confirmLesson(submitFormal.id)) === true, phone.store.lastError);
    const afterConfirmLesson = (await phone.store.bookingsForStudent(studentId)).find((b) => b.id === finalCourse.id);
    ok('确认本次后计入已确认次数和待支付金额',
      afterConfirmLesson.lessonStats.confirmedCount === 2 && afterConfirmLesson.lessonStats.unpaidAmount === 180,
      afterConfirmLesson.lessonStats);
    ok('两条已确认的课次都记在待支付里（试课 60 + 正式课 120）',
      afterConfirmLesson.lessonStats.unpaidCount === 2 &&
        afterConfirmLesson.lessonStats.unpaidAmount === 180,
      afterConfirmLesson.lessonStats);

    console.log('\n[6] 真人聊天已下线（只留官方助手）');
    ok('数据层不再暴露真人聊天方法',
      phone.store.sendChatMessage === undefined && phone.store.chatSession === undefined &&
        phone.store.chatPeers === undefined && phone.store.markChatRead === undefined);
    ok('未读接口还在（底部导航红点用）', typeof (await sim.store.unreadChatCount()) === 'number');

    console.log('\n[7] 批量发单 / 匹配 / 官方助手 / 收款退款');

    const batch = await phone.store.batchCreatePosts([
      { subject: '英语', time: '2026-11-05 晚上', price: '130 元/小时', area: '海淀 · 五道口', note: '客户手机 13800000000' },
      { subject: '物理', time: '2026-11-06 晚上', price: '140 元/小时', area: '海淀 · 学院路' },
      { subject: '', time: '2026-11-07 晚上' }
    ]);
    ok('批量发单返回成功 / 失败清单',
      !!batch && batch.ok.length === 2 && batch.failed.length === 1, batch);
    const batchPosts = await phone.store.myPosts();
    ok('批量发的单带单号，说明里的手机号被抹掉',
      batchPosts.some((p) => !!p.code && p.note.indexOf('13800000000') < 0),
      batchPosts.map((p) => [p.code, p.note]));
    ok('单号能拿去群里发（形如 20261111-1）',
      batchPosts.every((p) => /^\d{8}-\d+$/.test(p.code || '')), batchPosts.map((p) => p.code));

    await sim.store.saveTeacherResume({
      education: '本科', school: '北京师范大学', years: '8 年', certificate: '教师资格证',
      subject: '数学', price: '150 元/小时', times: '周末全天', intro: '带过三届中考'
    });
    await sim.store.saveTeacherProfile(teacherId, {
      name: '王数学', gender: '男', subject: '数学', price: '150 元/小时',
      area: '北京海淀', lat: 39.98, lng: 116.30, intro: ''
    });
    const reqPostId = await phone.store.createPost({
      subject: '数学', grade: '初二', gender: '男', time: '2026-11-20 晚上', price: '180 元/小时',
      area: '海淀 · 中关村', lat: 39.98, lng: 116.30, note: '带结构化要求',
      requirements: {
        education: '本科及以上', minYears: 2, certificate: ['教师资格证'], gender: '男',
        budgetMin: 100, budgetMax: 200
      }
    });
    ok('发单能带结构化要求', reqPostId > 0, reqPostId);
    const reqMine = (await phone.store.myPosts()).find((p) => p.id === reqPostId);
    ok('要求存下来了（固定档位：本科 / 1 年 / 教师资格证）',
      !!reqMine && reqMine.requirements.education === '本科' &&
        reqMine.requirements.minYears === '1' &&
        reqMine.requirements.certificate === '教师资格证', reqMine && reqMine.requirements);

    const onlyFit = await sim.store.postsForTaking({ onlyMatch: true });
    const fitItem = onlyFit.find((p) => p.id === reqPostId);
    ok('老师端每条单带匹配档位和理由',
      !!fitItem && fitItem.matchLevel === 'full' && fitItem.matchReasons.length > 0,
      fitItem && [fitItem.matchLevel, fitItem.matchReasons]);

    const badPostId = await phone.store.createPost({
      subject: '数学', grade: '高三', gender: '女', time: '2026-11-21 晚上', price: '180 元/小时',
      requirements: { education: '硕士及以上', minYears: 5, gender: '女' }
    });
    const hideList = await sim.store.postsForTaking({ onlyMatch: true });
    ok('默认隐藏"我完全不符合"的单',
      !hideList.some((p) => p.id === badPostId) && hideList.some((p) => p.id === reqPostId),
      hideList.map((p) => [p.id, p.matchLevel]));
    const showList = await sim.store.postsForTaking({ onlyMatch: false });
    const badItem = showList.find((p) => p.id === badPostId);
    ok('关掉开关（显示全部单）能看到 ❌ 不符合的单',
      !!badItem && badItem.matchLevel === 'none' &&
        badItem.matchReasons.some((text) => text.indexOf('❌') === 0),
      badItem && [badItem.matchLevel, badItem.matchReasons]);
    ok('不符合的单排在符合的后面（页面就在这个位置插分界线 + 提示）',
      showList.some((p) => p.id === badPostId) && showList.some((p) => p.id === reqPostId) &&
        showList.findIndex((p) => p.matchLevel === 'none') >
          showList.findIndex((p) => p.matchLevel === 'full'),
      showList.map((p) => [p.id, p.matchLevel]));

    const byGrade = await sim.store.postsForTaking({ grade: '高三', onlyMatch: false });
    ok('按年级筛选生效',
      byGrade.length > 0 && byGrade.every((p) => p.grade.indexOf('高三') >= 0) &&
        byGrade.some((p) => p.id === badPostId),
      byGrade.map((p) => p.grade));
    const byPrice = await sim.store.postsForTaking({ minPrice: 180, onlyMatch: false });
    ok('按最低时薪筛选生效（价格只留这一个条件）',
      byPrice.length > 0 && byPrice.every((p) => {
        const hourly = Number(p.requirements.priceMin) || Number(String(p.price).match(/\d+/) || [0]);
        return hourly <= 0 || hourly >= 180;
      }),
      byPrice.map((p) => p.price));

    const rawText = '要女老师，硕士以上，最好有经验，能线下，一次 400 元（一次两小时），联系电话 13800000000';
    const parsed = await phone.store.parseRequirement(rawText);
    ok('家长原话解析出固定字段（含糊的"有经验"不猜年限）',
      !!parsed && parsed.gender === '女' && parsed.education === '硕士' &&
        parsed.minYears === '不限' && parsed.certificate === '不限' &&
        parsed.teachMode === '线下' && parsed.raw_text === rawText,
      parsed);
    ok('按次给钱也能折成时薪（一次 400 元 / 2 小时 = 200）',
      Number(parsed.priceMin) === 200 && Number(parsed.priceMax) === 200, parsed);
    const cetParsed = await phone.store.parseRequirement('要求雅思 6.5 以上，能线下');
    ok('证书多了"四六级 / 雅思托福"两档', cetParsed.certificate === '雅思托福', cetParsed);
    const rawPostId = await phone.store.createPost({
      subject: '英语', time: '2026-11-22 晚上', price: '200 元/小时', area: '海淀 · 中关村',
      rawText: parsed.raw_text, requirements: parsed
    });
    ok('解析结果直接发布（中介不用确认）', rawPostId > 0, phone.store.lastError);
    const rawMine = (await phone.store.myPosts()).find((p) => p.id === rawPostId);
    ok('家长原话存下来了，老师端能看',
      !!rawMine && rawMine.rawText.indexOf('要女老师') >= 0, rawMine && rawMine.rawText);
    ok('原话里的手机号入库前被抹掉（不外泄客户联系方式）',
      !!rawMine && rawMine.rawText.indexOf('13800000000') < 0, rawMine && rawMine.rawText);
    const byRawGender = await sim.store.postsForTaking({ gender: ['女'], onlyMatch: false });
    ok('单子的要求（多选）：要女老师的单 + 不限的单',
      byRawGender.some((p) => p.id === rawPostId) &&
        byRawGender.every((p) => p.requirements.gender === '女' || p.requirements.gender === '不限'),
      byRawGender.map((p) => [p.id, p.requirements.gender]));
    const byRawMode = await sim.store.postsForTaking({ teachMode: ['线上'], onlyMatch: false });
    ok('按授课方式筛：要线上 / 不限的单要，要线下的不要',
      byRawMode.every((p) => ['线上', '不限'].indexOf(p.requirements.teachMode) >= 0) &&
        !byRawMode.some((p) => p.id === rawPostId),
      byRawMode.map((p) => [p.id, p.requirements.teachMode]));
    const byRawEdu = await sim.store.postsForTaking({ education: ['本科'], onlyMatch: false });
    ok('按学历筛（档位）：要本科 / 不限的单要，要硕士的不要',
      byRawEdu.every((p) => ['本科', '不限'].indexOf(p.requirements.education) >= 0) &&
        !byRawEdu.some((p) => p.id === rawPostId),
      byRawEdu.map((p) => [p.id, p.requirements.education]));

    const myBachelor = await sim.store.postsForTaking({ myEducation: ['本科'], onlyMatch: false });
    ok('我勾"本科"：要硕士的单被藏起来',
      !myBachelor.some((p) => p.id === rawPostId) &&
        myBachelor.some((p) => p.id === reqPostId),
      myBachelor.map((p) => [p.id, p.requirements.education]));
    const myOnline = await sim.store.postsForTaking({ myTeachMode: ['线上'], onlyMatch: false });
    ok('我勾"线上"：要线下授课的单被藏起来，要求不限的留着',
      !myOnline.some((p) => p.id === rawPostId) &&
        myOnline.some((p) => p.id === reqPostId) &&
        myOnline.every((p) => ['线上', '不限'].indexOf(p.requirements.teachMode) >= 0),
      myOnline.map((p) => [p.id, p.requirements.teachMode]));
    const myMale = await sim.store.postsForTaking({ myGender: '男', onlyMatch: false });
    ok('我勾"男老师"：要女老师的单被藏起来',
      !myMale.some((p) => p.id === rawPostId) &&
        myMale.some((p) => p.id === reqPostId),
      myMale.map((p) => [p.id, p.requirements.gender]));

    const agentDomain = require('../server/domain/agent.js');
    const agentInfo = await agentDomain.ensureAgent(db, studentId);
    await agentDomain.issueToken(db, studentId, agentInfo.id, '模拟');
    await agentDomain.agentMessage(db, agentInfo.id, teacherId, 'contract',
      '合同和收款码发你了。', 'https://example.com/contract/sim.pdf');
    const agentList = await sim.store.myAgents();
    ok('老师的消息列表里有官方助手（标官方）',
      agentList.length === 1 && agentList[0].official === true, agentList);
    const agentId = agentList[0].id;
    ok('老师能点开官方助手会话',
      typeof (await sim.store.agentChatSession(agentId)).unread === 'number');
    ok('老师能给官方助手发消息',
      (await sim.store.sendAgentChatMessage(agentId, '合同里的时间能改吗？')) === true, sim.store.lastError);
    const box = await sim.store.messages();
    ok('消息中心能看到 Agent 发的合同消息',
      box.list.some((m) => m.kind === 'contract' && m.contractUrl.indexOf('example.com') >= 0),
      box.list);

    const payPostId = await phone.store.createPost({
      subject: '化学', time: '2026-11-08 晚上', price: '200 元/次', area: '海淀 · 中关村'
    });
    ok('平台发一条新单', payPostId > 0, payPostId);
    ok('老师投递',
      !!((await sim.store.takePost(payPostId, '收款流程走一遍')) || {}).conflict === false, sim.store.lastError);
    const payBooking = (await sim.store.bookingsForTeacher(teacherId))
      .find((b) => b.day === '2026-11-08 晚上');
    ok('平台确认接单并带上合同金额',
      (await phone.store.acceptBooking(payBooking.id, { amount: 500, contractUrl: 'https://example.com/c1' })) === true,
      phone.store.lastError);
    let payInfo = (await phone.store.bookingsForStudent(studentId)).find((b) => b.id === payBooking.id);
    ok('生成一条待收款 500',
      payInfo.payStats.charge.amount === 500 && payInfo.payStats.charge.status === '待收款',
      payInfo.payStats);
    ok('还没确认收款时老师提交试课被挡住',
      (await sim.store.submitLesson(payBooking.id, sim.store.lessonTrial(), '')) === null &&
        sim.store.lastError.indexOf('收款') >= 0, sim.store.lastError);
    const chargeId = payInfo.payStats.charge.id;
    ok('老师点「我已付款」', (await sim.store.claimPaid(chargeId)) === true, sim.store.lastError);
    ok('平台确认收款', (await phone.store.confirmPayment(chargeId)) === true, phone.store.lastError);
    ok('确认收款后老师能提交试课',
      !!(await sim.store.submitLesson(payBooking.id, sim.store.lessonTrial(), '试课')));
    ok('平台确认全额退款', !!(await phone.store.refundPayment(chargeId, '', '没上成，全额退')));
    payInfo = (await phone.store.bookingsForStudent(studentId)).find((b) => b.id === payBooking.id);
    ok('退款后收款变已退款，退款金额记下来',
      payInfo.payStats.charge.status === '已退款' && payInfo.payStats.refunded === 500,
      payInfo.payStats);

    const studentDash = await phone.store.dashboard();
    ok('学生的「我的」页统计拿到数字（不再依赖评价数据）',
      typeof studentDash.stats.totalSpent === 'number' && studentDash.stats.activeBookings >= 1,
      studentDash.stats);

    console.log('\n[8] 令牌：前端改不了，后端说了算');
    const forged = newDevice('被改过的设备');
    forged.storage.session_token = 'forged-token-0123456789';
    ok('假令牌无效，自动降级成访客', (await forged.store.restoreLogin()) === false);
    ok('假令牌被本地清掉', forged.storage.session_token === undefined, forged.storage);
    ok('假令牌拿不到自己的订单', (await forged.store.bookingsForStudent(1)).length === 0);

    const other = newDevice('第三台设备');
    await other.store.restoreLogin();
    ok('没登录看不到"我发布的"', (await other.store.myPosts(false, 1)).length === 0);

    console.log('\n[9] 退出登录 / 多端各自一枚令牌');
    await phone.store.forgetLogin();
    ok('退出后本地令牌没了', phone.storage.session_token === undefined);
    ok('退出后读不到自己的订单', (await phone.store.bookingsForStudent(studentId)).length === 0);
    ok('退出这台设备不影响老师那台', (await sim.store.bookingsForTeacher(teacherId)).length > 0);
    ok('退出后还能用同样的账号密码登回来', (await phone.store.loginStudent('小明', '123456')) === studentId);
    const backAgain = await phone.store.bookingsForStudent(studentId);

    ok('登回来数据还在（后端唯一数据源）',
      backAgain.filter((b) => b.status === '试课中').length === 1 &&
        backAgain.filter((b) => b.status === '主订单进行中').length === 1 &&
        backAgain.length === 5,
      backAgain.map((b) => b.status));

    const clashPost = await phone.store.createPost({
      subject: '语文', time: '2026-10-02 下午', price: '99 元/小时', area: '北京海淀',
      lat: 39.98, lng: 116.30, note: '和已有的课撞时间'
    });
    ok('再发一条撞时间的单', clashPost > 0, clashPost);
    const clashItem = (await sim.store.postsForTaking()).find((p) => p.id === clashPost);
    ok('接单列表里就标出「时间冲突」（只提醒，不挡）',
      !!clashItem && clashItem.timeConflict === true, clashItem && clashItem.timeConflict);
    const warned = await sim.store.takePost(clashPost, '我想接这一条');
    ok('时间冲突只提醒（不报错）', !!warned && warned.conflict === true && warned.timeText.indexOf('2026-10-02') >= 0, JSON.stringify(warned));
    ok('提醒那一步没生成投递',
      (await sim.store.bookingsForTeacher(teacherId)).every((b) => Number(b.postId) !== clashPost));
    const forcedTake = await sim.store.takePost(clashPost, '我想接这一条', true);
    ok('老师确认后照样能投递', !!forcedTake && forcedTake.conflict === false, sim.store.lastError);
    ok('确认之后确实生成了投递',
      (await sim.store.bookingsForTeacher(teacherId)).some((b) => Number(b.postId) === clashPost));

    console.log('\n模拟测试全部通过：' + passed + ' 项\n');
    process.exitCode = 0;
  } finally {

    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('\n模拟测试中断：' + (e && e.message ? e.message : e));
  process.exit(1);
});
