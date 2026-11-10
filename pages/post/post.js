/*
 * 发单 / 接单页：对应 Qt 版的 PostPage + PostDialog。
 * 已改成单边流程：平台侧（学生账号）发单，老师接单 —— 老师不能发布，学生账号不接单。
 *   平台侧：发布需求（单条 / 批量）+ 我发布的单（可撤销，可复制单号、需求文本、简历合集）
 *   老师：可接的单（平台发来的需求，点投递简历）+ 我接到的课
 *   访客：所有招募中的单只读浏览，动手（发单 / 接单）时才让选身份
 */

const store = require('../../utils/store.js');
const session = require('../../utils/session.js');
const util = require('../../utils/util.js');
const auth = require('../../utils/auth.js');
const location = require('../../utils/location.js');
/*
 * 单号 / 需求 / 简历合集那三段文本和一键复制在 utils/postText.js：
 * 中介那边的【工作台】【我发布的】【单子管理】三个页面共用；这一页只剩发单和接单。
 */

// 筛选面板里的多选选项：name 是提交给后端的值，label 是显示的文字
function pickItems(list, suffix) {
  return list.map((name) => ({ name: name, label: suffix ? name + suffix : name, checked: false }));
}

// 教龄那两条筛选已经删掉（页面不再提供，接口参数还留着给外部调用）
const FILTER_FIELDS = ['gender', 'education', 'certificate', 'teachMode',
  'myGender', 'myEducation', 'myCertificate', 'myTeachMode'];

function blankPicked() {
  const picked = {};
  FILTER_FIELDS.forEach((field) => { picked[field] = []; });
  return picked;
}

function blankPickItems() {
  return {
    gender: pickItems(util.GENDER_PICK),
    education: pickItems(util.EDUCATION_PICK),
    certificate: pickItems(util.CERTIFICATE_PICK),
    teachMode: pickItems(util.TEACH_MODE_PICK),
    myGender: pickItems(util.GENDER_PICK),
    myEducation: pickItems(util.EDUCATION_PICK),
    myCertificate: pickItems(util.CERTIFICATE_PICK),
    myTeachMode: pickItems(util.TEACH_MODE_PICK)
  };
}

// 匹配徽章下面那行：优先列"没满足 / 存疑"的，全满足就给一句结论
function matchTipOf(post) {
  const reasons = post.matchReasons || [];
  const notOk = reasons.filter((text) => text.indexOf('✅') !== 0);
  if (notOk.length > 0) return notOk.join('；');
  return reasons.length > 0 ? '符合全部要求' : '';
}

// 详情弹层里逐条列匹配情况
function matchDetailTextOf(post) {
  const details = post.matchDetails || [];
  if (details.length === 0) return '';
  return details
    .map((item) => (item.ok ? '✅ ' : (item.hard ? '❌ ' : '⚠️ ')) + item.text)
    .join('\n');
}

Page({
  data: {
    title: '发单',
    publishText: '',        // 有空才显示右上角发布按钮（只有学生这一侧有）
    hint: '',

    guest: false,
    guestList: [],
    studentMode: false,
    teacherMode: false,
    showNearby: false,      // 距离筛选条（访客浏览用；老师这边合并进筛选面板）

    // 老师接单页的筛选面板：双向筛选，单子的要求和我自己的情况都能多选（不勾＝不筛）
    showFilter: false,
    filterGradeIndex: 0,
    filterSubject: '',
    filterTime: '',
    filterMinPrice: '',
    filterItems: blankPickItems(),   // 多选控件：每一项带 checked（WXML 里不能算）
    filterPicked: blankPicked(),     // 当前勾了哪些（值数组）
    // 默认显示全部单：不符合的排在后面、中间拉一条分界线（不藏起来）；打开开关才只看符合的
    onlyMatch: false,
    gradeOptions: util.GRADE_OPTIONS,
    genderOptions: util.GENDER_OPTIONS,
    filterSummary: '',

    takeList: [],
    takeEmpty: '',
    firstNonMatch: -1,      // 第一条"不完全符合"的位置：在这前面插分界线（-1 = 不插）
    nonMatchTip: '',

    mineList: [],
    mineEmpty: '',

    coursesTitle: '',
    courses: [],
    coursesEmpty: '',

    // 附近筛选：半径可选，默认 45 公里（和原来同一套规则）
    radiusOptions: [],
    radiusIndex: 0,
    nearbyTip: '',
    nearbyAction: '',        // '' / locate（去开定位） / all（看全部） / nearby（只看附近）
    nearbyActionText: '',

    // 发布弹窗（对应 PostDialog）：只有学生能发，资料全部自己填
    showPublish: false,
    subject: '',
    time: '',
    price: '',
    area: '',
    areaLat: 0,              // 选点地图带回来的坐标：发布时一起写库，用来算距离
    areaLng: 0,
    note: '',
    // 家长原话（中介粘进来，点【智能解析】→ 自动填下面的要求；解析结果直接发布，不用确认）
    rawText: '',
    parsing: false,
    parseTip: '',
    parsedText: '',         // 上一次解析用的原话（发布时拿它比对，没解析过就先补解析）
    // 发布时对老师的要求（结构化，存 posts.requirements）
    gradeOptions: util.GRADE_OPTIONS,
    genderOptions: util.GENDER_OPTIONS,
    eduOptions: util.EDUCATION_LEVEL_OPTIONS,
    yearsOptions: util.MIN_YEARS_OPTIONS,
    teachModeOptions: util.TEACH_MODE_OPTIONS,
    certOptions: util.REQUIRE_CERTIFICATE_OPTIONS,
    publishGradeIndex: 0,
    publishGenderIndex: 0,
    reqEducationIndex: 0,
    reqSchool: '',
    reqYearsIndex: 0,
    reqCertIndex: 0,
    reqTeachModeIndex: 0,
    // 家长给的时薪（元/小时）：按次给钱的由解析折成时薪，折不了就是空＝不限
    reqPriceMin: '',
    reqPriceMax: '',

    // 投递简历弹窗（老师点【投递简历】时弹出来写自我介绍）
    showResume: false,
    resumePostId: 0,
    resumeTitle: '',
    resumeText: '',

    // 单子详情弹层：列表里位置/说明挤在一行显示不全，点一下弹出来看完整的
    showDetail: false,
    detailTitle: '',
    detailRows: []
  },

  onLoad() {
    this.refresh = this.refresh.bind(this);
    this.seq = 0;
    const radius = this.buildRadius();
    this.setData({ radiusOptions: radius.options, radiusIndex: radius.index });
  },

  // tab 页会被系统缓存：每次显示才订阅 + 刷数据 + 更新底部导航
  onShow() {
    store.on('postsChanged', this.refresh);
    store.on('bookingsChanged', this.refresh);
    // 定位回来得比首屏晚：定位变了就自己刷一遍
    location.watch(this.refresh);
    this.refresh();
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.refresh();
  },

  onHide() {
    store.off('postsChanged', this.refresh);
    store.off('bookingsChanged', this.refresh);
    location.unwatch(this.refresh);
  },

  onUnload() {
    this.onHide();
  },

  // 单子全在后端：访客看全部招募中的单，学生看"我发布的"，老师看"可接的 + 我接到的"
  async refresh() {
    const seq = ++this.seq;
    // 每次刷新都把最新定位交给数据层，请求时一起发给后端按半径筛
    store.setViewerLocation(location.current());
    // 半径是全局设置，每次刷新都重新取一次，别让下拉和实际筛选对不上
    const radius = this.buildRadius();

    if (!session.isLoggedIn()) {
      await this.refreshGuest(seq, radius);
      return;
    }
    if (session.isTeacher()) {
      await this.refreshTeacher(seq, radius);
      return;
    }
    await this.refreshStudent(seq, radius);
  },

  // ---------- 访客：大家的单可以随便看，动手时才让选身份 ----------
  async refreshGuest(seq, radius) {
    wx.setNavigationBarTitle({ title: '📢 单子' });
    const guestList = (await store.allOpenPosts()).map((post) => ({
      id: post.id,
      code: post.code || '',
      publisherName: post.publisherName,
      roleText: post.publisherIsTeacher ? '老师发的旧单' : '平台发的需求',
      subject: post.subject,
      timeText: post.timeText,
      price: util.plain(post.price) === '' ? '未填写' : post.price,
      area: util.plain(post.area) === '' ? '—' : post.area,
      distanceText: post.distanceKm < 0 ? '' : '距离 ' + util.formatDistance(post.distanceKm),
      note: util.plain(post.note) === '' ? '—' : post.note
    }));
    if (seq !== this.seq) return;
    const hidden = store.lastHidden;

    this.setData({
      guest: true,
      guestList,
      studentMode: false,
      teacherMode: false,
      showNearby: true,
      title: '大家的单子',
      publishText: '登录后发单',
      hint: '浏览不用登录：发单、接单时才需要先选一个身份。',
      takeList: [],
      takeEmpty: '现在还没有人发单，登录后自己发一条也行～',
      mineList: [], mineEmpty: '',
      coursesTitle: '', courses: [], coursesEmpty: '',
      radiusOptions: radius.options,
      radiusIndex: radius.index
    });
    this.setData(this.nearbyTips(hidden));
  },

  // ---------- 老师：可接的单 + 我接到的课 ----------
  async refreshTeacher(seq, radius) {
    wx.setNavigationBarTitle({ title: '📋 接单' });
    /*
     * 选单页就一个列表（没有推荐 / 附近这些 tab）：
     *   第一层筛选（单子本身）：年级 / 科目 / 性别要求 / 上课时间 / 时薪区间 / 距离范围
     *   第二层筛选（我符不符合）：只看我符合的（默认开）——关掉就是"显示全部单"
     * 排序由后端算：完全符合 → 部分符合 → 不符合，再距离由近到远，再看时间冲突 / 价格。
     */
    // 接单页的距离默认 30 公里（用户自己调过就不再覆盖）
    if (!this.kmReady) {
      this.kmReady = true;
      if (store.nearbyKmValue() === util.NEARBY_KM) store.setNearbyKm(30);
    }
    const filters = this.currentFilters();
    const source = await store.postsForTaking(filters);
    const takeList = source.map((post) => ({
      id: post.id,
      code: post.code || '',
      publisherId: post.publisherId,
      publisherName: post.publisherName,
      subject: post.subject,
      grade: util.plain(post.grade) === '' ? '' : post.grade,
      timeText: post.timeText,
      price: util.plain(post.price) === '' ? '未填写' : post.price,
      area: util.plain(post.area) === '' ? '—' : post.area,
      distanceText: post.distanceKm < 0 ? '' : '距离 ' + util.formatDistance(post.distanceKm),
      note: util.plain(post.note) === '' ? '—' : post.note,
      requirementText: util.requirementsText(post.requirements),   // 这单对老师的要求
      rawText: util.plain(post.rawText),                            // 家长原话：只展示，不参与筛选
      matchLevel: post.matchLevel || '',
      matchBadge: util.matchLevelText(post.matchLevel),
      matchClass: util.matchLevelClass(post.matchLevel),
      // 徽章下面那行：优先显示没满足 / 存疑的，全满足就写一句"符合全部要求"
      matchTip: matchTipOf(post),
      matchDetailText: matchDetailTextOf(post),
      applied: !!post.applied,       // 已经投递过、还在等平台确认：按钮改成"已投递"
      timeConflict: !!post.timeConflict   // 和后端一致：撞时间只提醒，不挡投递
    }));
    const hidden = store.lastHidden;
    /*
     * 不符合的单不藏起来（老板说了：要求不符合也显示），排在符合的后面，
     * 中间拉一条分界线 + 一句话，老师一眼能看出"下面是勉强能投的"。
     */
    let firstNonMatch = -1;
    let nonMatchCount = 0;
    takeList.forEach((item, index) => {
      if (item.matchLevel !== util.MATCH_NONE) return;
      if (firstNonMatch < 0) firstNonMatch = index;
      nonMatchCount++;
    });
    /*
     * 我的课（第 6 条）：投递中（待平台确认）+ 试课中 + 主订单进行中。
     * 首页只放进行中的，没选上 / 已取消 / 已结束的历史收在【我的】页。
     * 每次上课老师在这里提交一条课次，平台确认（或对试课判定通过 / 不通过）。
     */
    const courses = (await store.bookingsForTeacher(session.teacherId()))
      .filter((booking) => util.isActiveBooking(booking.status))
      .map((booking) => {
        const stats = booking.lessonStats || {};
        // 收款：平台发合同 + 收款码 → 老师「我已付款」→ 平台确认收款后才能提交试课
        const pay = booking.payStats || {};
        const charge = pay.charge || null;
        const lessons = (booking.lessons || []).map((lesson) => ({
          id: lesson.id,
          label: lesson.isTrial ? '试课' : '第 ' + lesson.seq + ' 次课',
          statusText: lesson.statusText,
          statusClass: util.lessonStatusClass(lesson.status, lesson.result),
          content: lesson.content,
          reason: lesson.reason,
          pending: lesson.pending,
          // 试课判定完之后才有确定金额（半价 / 全价）
          feeText: lesson.isTrial && !lesson.pending && Number(lesson.fee) > 0
            ? '试课费 ' + lesson.fee + ' 元' : '',
          // 平台有异议时，老师才需要改完重新提交
          needsFix: lesson.pending && util.plain(lesson.reason) !== '',
          // 还没被平台确认的课次都能撤回（撤回后可以重新提交）
          withdrawable: lesson.pending
        }));
        const trialSubmitted = (booking.lessons || []).some((lesson) => lesson.isTrial);
        return {
          id: booking.id,
          name: booking.studentName,
          subject: booking.subject,
          timeText: booking.timeText,
          price: util.plain(booking.price) === '' ? '未填写' : booking.price,
          status: util.bookingStatusText(booking.status),
          statusClass: util.bookingStatusClass(booking.status),
          // 已经定下来的课（试课中 / 主订单）能取消，取消后单子回到「可接的单」
          cancellable: booking.status === util.STATUS_TRIAL || booking.status === util.STATUS_MAIN,
          // 投递还在等平台确认：老师能撤回投递（单子还在「可接的单」里）
          withdrawable: booking.status === util.STATUS_PENDING,
          // 订单收尾：还有课次等着确认时后端会挡，这里先把按钮藏起来
          canFinish: (booking.status === util.STATUS_TRIAL || booking.status === util.STATUS_MAIN) &&
                     !(Number(stats.pendingCount) > 0),
          // 试课中、还没提交试课 → 「提交试课完成」
          canSubmitTrial: booking.status === util.STATUS_TRIAL && !trialSubmitted,
          // 主订单进行中、没有等着确认的课次 → 「完成本次」
          canSubmitFormal: booking.status === util.STATUS_MAIN && !(Number(stats.pendingCount) > 0),
          lessons,
          confirmedCount: Number(stats.confirmedCount) || 0,
          unpaidAmount: Number(stats.unpaidAmount) || 0,
          paidAmount: Number(stats.paidAmount) || 0,
          // 收款 / 退款
          chargeId: charge ? charge.id : 0,
          chargeAmount: charge ? charge.amount : 0,
          chargeStatusText: charge
            ? '收款 ' + (charge.amount > 0 ? charge.amount + ' 元' : '金额待定') + ' · ' + charge.status
            : '',
          chargeClass: charge ? util.payStatusClass(charge.status) : '',
          refundedAmount: Number(pay.refunded) || 0,
          contractUrl: charge ? charge.contractUrl : '',
          canClaimPaid: !!charge && charge.status === util.PAY_PENDING,
          // 还没确认收款时先别让老师提交试课（后端也会挡，这里提前提示）
          payGateTip: (booking.status === util.STATUS_TRIAL && charge &&
            charge.status !== util.PAY_RECEIVED && charge.status !== util.PAY_REFUNDED)
            ? '等平台确认收款后再提交试课' : ''
        };
      });
    if (seq !== this.seq) return;

    // 刚注册的老师还没填资料：先提示去填
    const hint = session.hasTeacherProfile()
      ? '看到合适的单子点【投递简历】（自动带出「我的简历」里那份），平台挑中你才算接下来。'
      : '先去【我的】页填好资料，再到「我的简历」补上学历和教龄，平台发单时才好找到你～';

    this.setData({
      guest: false, guestList: [],
      studentMode: false, teacherMode: true,
      showNearby: false,
      title: '接单',
      publishText: '',
      hint,
      takeList,
      takeEmpty: takeList.length === 0
        ? (this.data.onlyMatch
            ? '暂时没有你符合（或部分符合）的单。关掉「只看我符合的」就能看到全部，或者把「我的简历」里的可教科目、学历、教龄、证书补全。'
            : (store.nearbyActive()
                ? '附近 ' + util.formatRadius(store.nearbyKmValue()) + ' 暂时没有平台发的单，把距离范围调大试试。'
                : '暂时没有平台发的单，等等吧～'))
        : '',
      firstNonMatch,
      nonMatchTip: nonMatchCount > 0
        ? '以下 ' + nonMatchCount + ' 条不完全符合你的情况，也可以看看' : '',
      mineList: [], mineEmpty: '',
      coursesTitle: '我的课' + (courses.length > 0 ? '（' + courses.length + ' 条）' : ''),
      courses,
      coursesEmpty: courses.length === 0 ? '还没有进行中的课，上面看到合适的就点【投递简历】吧。投递之后这条单子的动静在【消息】页的单子卡片里。' : '',
      radiusOptions: radius.options,
      radiusIndex: radius.index,
      filterSummary: this.filterSummaryText(hidden)
    });
    this.setData({
      nearbyTip: '', nearbyAction: '', nearbyActionText: ''
    });
  },

  /*
   * ---------- 中介（登录身份是「学生」）：这一页只剩"发单" ----------
   *
   * 中介端的主界面是【工作台】（pages/workbench/workbench）：待办、我发布的入口都在那儿，
   * 单子详情 / 修正在三级页 pages/postManage。这一页对中介只干一件事：
   * 右上角【发布需求】弹出表单发单，旁边【批量发单】去 pages/postBatch。
   */
  async refreshStudent(seq, radius) {
    wx.setNavigationBarTitle({ title: '📢 发单' });
    if (seq !== this.seq) return;
    this.setData({
      guest: false, guestList: [],
      studentMode: true, teacherMode: false,
      showNearby: false,
      title: '发单',
      publishText: '发布需求',
      hint: '写下想补的科目、时间和心理价位发出去，老师会来投递；投递、定老师、合同收款都在【工作台】的待办里。',
      takeList: [], takeEmpty: '',
      mineList: [], mineEmpty: '',
      coursesTitle: '', courses: [], coursesEmpty: '',
      radiusOptions: radius.options,
      radiusIndex: radius.index,
      nearbyTip: '', nearbyAction: '', nearbyActionText: ''
    });
  },

  // ---------- 附近筛选（小程序特有，和原来同一套规则）----------

  // 半径下拉的选项：直接用数据层给的那几个档位（45 公里是默认档）
  buildRadius() {
    const choices = store.nearbyChoices();
    const options = choices.map((km) => util.formatRadius(km));
    let index = choices.indexOf(store.nearbyKmValue());
    if (index < 0) index = choices.indexOf(store.nearbyDefault());
    return { options, index: index < 0 ? 0 : index };
  },

  // 提示文案 + 右侧按钮（没定位→开定位 / 看了全部→收回附近 / 有隐藏→看全部）
  nearbyTips(hidden) {
    const radiusText = util.formatRadius(store.nearbyKmValue());
    const hasLocation = !!store.viewerLocation();

    if (!hasLocation) {
      return {
        nearbyTip: '还没拿到定位，先显示全部单子。开启定位后就只看附近 ' + radiusText + ' 的单。',
        nearbyAction: 'locate',
        nearbyActionText: '开启定位'
      };
    }
    if (store.showAllValue()) {
      return {
        nearbyTip: '现在显示全部单子，不受距离限制。',
        nearbyAction: 'nearby',
        nearbyActionText: '只看附近'
      };
    }
    if (hidden > 0) {
      return {
        nearbyTip: '只看 ' + radiusText + '：另有 ' + hidden + ' 条单子超出范围，没显示。',
        nearbyAction: 'all',
        nearbyActionText: '看全部'
      };
    }
    return {
      nearbyTip: '只看 ' + radiusText + '：附近的单子都在这儿了。',
      nearbyAction: '',
      nearbyActionText: ''
    };
  },

  onRadiusChange(event) {
    const index = Number(event.detail.value);
    const choices = store.nearbyChoices();
    store.setNearbyKm(choices[index]);
    store.setShowAll(false);
    this.setData({ radiusIndex: index });
    this.refresh();
  },

  onNearbyAction() {
    if (this.data.nearbyAction === 'locate') {
      location.requestNow(() => this.refresh());
      return;
    }
    store.setShowAll(this.data.nearbyAction === 'all');
    this.refresh();
  },

  // ---------- 老师：投递简历 / 撤回投递 ----------
  // 点单子（老师接单列表 / 访客浏览列表）看完整需求：列表里说明只露两行
  onShowPostDetail(event) {
    const source = event.currentTarget.dataset.src;
    const index = Number(event.currentTarget.dataset.index);
    const list = source === 'guest' ? this.data.guestList : this.data.takeList;
    const item = list[index];
    if (!item) return;

    const rows = [];
    if (item.roleText) rows.push({ label: '谁发的', value: item.roleText });
    rows.push({ label: '科目', value: item.subject });
    rows.push({ label: '上课时间', value: item.timeText });
    rows.push({ label: '价格', value: item.price });
    rows.push({
      label: '位置',
      value: util.plain(item.area) + (item.distanceText ? '　' + item.distanceText : '')
    });
    rows.push({ label: '说明', value: util.plain(item.note) === '' ? '（没写说明）' : item.note });
    // 这单对老师的要求 + 我符不符合（新加的匹配这一层）
    if (item.requirementText) rows.push({ label: '对老师的要求', value: item.requirementText });
    // 家长原话：原样给老师看，帮老师判断要不要投（不参与筛选和匹配）
    if (item.rawText) rows.push({ label: '家长原话', value: item.rawText });
    if (item.matchBadge) {
      rows.push({
        label: '我能投吗',
        value: item.matchBadge + (item.matchDetailText ? '\n' + item.matchDetailText : '')
      });
    }

    this.setData({
      showDetail: true,
      detailTitle: item.publisherName + ' · ' + item.subject,
      detailRows: rows
    });
  },

  closePostDetail() {
    this.setData({ showDetail: false });
  },

  // 不能一键接单：先写一份简历（自我介绍）投递给平台，平台确认后这单才算接下来
  async onTake(event) {
    if (!auth.requireRole('teacher', 'teacher')) return;
    const post = this.data.takeList[Number(event.currentTarget.dataset.index)];
    if (!post) return;

    /*
     * 时间撞上自己已有的课：先弹一条提醒，老师确认后照常写简历投递。
     * 一天可以排好几节课，所以这里只是提醒，不是不让接。
     */
    if (post.timeConflict) {
      wx.showModal({
        title: '时间冲突提醒',
        content: '这条单的时间和你的另一节课撞了：确定没问题就继续写简历投递。',
        confirmText: '继续投递',
        cancelText: '再想想',
        success: (res) => {
          if (res.confirm) this.openResume(post);
        }
      });
      return;
    }
    this.openResume(post);
  },

  // 打开投递简历弹窗：简历直接读「我的简历」（pages/teacherResume）那份，改一改就能发
  async openResume(post) {
    // 简历直接读「我的简历」（pages/teacherResume）那份，改一改就能发
    const me = await store.teacherById(session.teacherId());
    const parts = [];
    if (util.plain(me.education) !== '') parts.push('学历：' + me.education);
    if (util.plain(me.school) !== '') parts.push('学校：' + me.school);
    if (util.plain(me.years) !== '') parts.push('教龄：' + me.years);
    if (util.plain(me.certificate) !== '') parts.push('证书：' + me.certificate);
    if (util.plain(me.subject) !== '') parts.push('可教科目：' + me.subject);
    if (util.plain(me.price) !== '') parts.push('价格：' + me.price);
    if (util.plain(me.times) !== '') parts.push('可教时段：' + me.times);
    if (util.plain(me.intro) !== '') parts.push(me.intro);
    const resumeText = parts.join('\n');

    this.setData({
      showResume: true,
      resumePostId: post.id,
      resumeTitle: post.publisherName + ' · ' + post.subject + '（' + post.timeText + '）',
      resumeText
    });
  },

  closeResume() {
    this.setData({ showResume: false });
  },

  onResumeInput(event) {
    this.setData({ resumeText: event.detail.value });
  },

  async confirmResume() {
    if (!auth.requireRole('teacher', 'teacher')) return;
    const text = String(this.data.resumeText).trim();
    if (text === '') {
      wx.showModal({ title: '提示', content: '先写几句简历（自我介绍）再投递。', showCancel: false });
      return;
    }
    const result = await store.takePost(this.data.resumePostId, text);
    if (!result) {
      wx.showModal({ title: '投递失败', content: store.lastError, showCancel: false });
      return;
    }
    /*
     * 时间撞上自己已有的课：只弹一条提醒，不挡投递。
     * 一天可以排好几节课，老师确认没问题后带 force 再调一次，照常把简历投出去。
     */
    if (result.conflict) {
      wx.showModal({
        title: '时间冲突提醒',
        content: '这条单的时间和你的另一节课撞了：' + result.timeText +
                 '\n一天可以排好几节课，确认没问题就继续投递简历。',
        confirmText: '继续投递',
        cancelText: '再想想',
        success: async (res) => {
          if (!res.confirm) return;
          const again = await store.takePost(this.data.resumePostId, text, true);
          if (!again) {
            wx.showModal({ title: '投递失败', content: store.lastError, showCancel: false });
            return;
          }
          this.afterTake();
        }
      });
      return;
    }
    this.afterTake();
  },

  // 投递成功：收掉简历弹窗 + 提示一句，然后刷新列表
  afterTake() {
    this.setData({ showResume: false });
    wx.showModal({
      title: '简历已投递',
      content: '等平台确认后就算接单成功，课记在下面「我的课」里。',
      showCancel: false,
      success: () => this.refresh()
    });
  },

  /*
   * ---------- 接单页筛选（双向 + 多选）----------
   *   第一向 单子本身：grade（年级）/ subject / time / minPrice（最低时薪，价格只留这一个）
   *   第二向 A 单子的要求（多选）：gender / education / certificate / teachMode
   *   第二向 B 我自己的情况（多选）：myGender / myEducation / myCertificate / myTeachMode
   *   （教龄那两个筛选页面上已经删掉；接口的 minYears / myYears 参数留着给外部调用）
   * 一个都不勾＝这条不筛；「不限」的单（家长没提）永远展示。
   */
  currentFilters() {
    const d = this.data;
    const grade = d.gradeOptions[d.filterGradeIndex];
    const p = d.filterPicked;
    return {
      grade: grade === '不限' ? '' : grade,
      subject: d.filterSubject,
      time: d.filterTime,
      minPrice: d.filterMinPrice,
      gender: p.gender,
      education: p.education,
      certificate: p.certificate,
      teachMode: p.teachMode,
      // 性别是二选一的：只勾一个才算"我是 X"，都不勾或都勾＝不限
      myGender: p.myGender.length === 1 ? p.myGender[0] : '',
      myEducation: p.myEducation,
      myCertificate: p.myCertificate,
      myTeachMode: p.myTeachMode,
      onlyMatch: d.onlyMatch
    };
  },

  // 勾选值 → 显示文字（'女' → '女'、'3' → '3 年'）
  pickLabel(field, values) {
    const items = this.data.filterItems[field] || [];
    return values.map((value) => {
      const hit = items.filter((item) => item.name === value)[0];
      return hit ? hit.label : value;
    }).join(' / ');
  },

  // 筛选面板上面那行摘要（让老师一眼知道现在在筛什么）
  filterSummaryText(hidden) {
    const f = this.currentFilters();
    const p = this.data.filterPicked;
    const parts = [];
    if (f.grade !== '') parts.push(f.grade);
    if (f.subject !== '') parts.push(f.subject);
    if (f.time !== '') parts.push(f.time);
    if (Number(f.minPrice) > 0) parts.push(f.minPrice + ' 元起');
    // 单子的要求
    if (p.gender.length > 0) parts.push('要求' + this.pickLabel('gender', p.gender) + '老师');
    if (p.education.length > 0) parts.push('要求' + this.pickLabel('education', p.education));
    if (p.certificate.length > 0) parts.push('要求' + this.pickLabel('certificate', p.certificate));
    if (p.teachMode.length > 0) parts.push('要求' + this.pickLabel('teachMode', p.teachMode));
    // 我自己的情况
    const mine = [];
    ['myGender', 'myEducation', 'myCertificate', 'myTeachMode'].forEach((field) => {
      if (p[field].length > 0) mine.push(this.pickLabel(field, p[field]));
    });
    if (mine.length > 0) parts.push('我：' + mine.join(' / '));
    parts.push(util.formatRadius(store.nearbyKmValue()));
    if (Number(hidden) > 0) parts.push('另有 ' + hidden + ' 条超出范围');
    return (f.onlyMatch ? '只看我符合的' : '显示全部单') + ' · ' + parts.join(' · ');
  },

  onToggleFilter() {
    this.setData({ showFilter: !this.data.showFilter });
  },

  // 关掉就是"显示全部单"（连不符合的也列出来）
  onToggleOnlyMatch(event) {
    this.setData({ onlyMatch: !!event.detail.value });
    this.refresh();
  },

  onFilterGrade(event) {
    this.setData({ filterGradeIndex: Number(event.detail.value) });
  },

  onFilterSubject(event) {
    this.setData({ filterSubject: event.detail.value });
  },

  onFilterTime(event) {
    this.setData({ filterTime: event.detail.value });
  },

  onFilterMinPrice(event) {
    this.setData({ filterMinPrice: event.detail.value });
  },

  // 多选框：单子的要求 / 我自己的情况，都是这一个处理函数
  onFilterCheck(event) {
    const field = event.currentTarget.dataset.field;
    if (FILTER_FIELDS.indexOf(field) < 0) return;
    const values = event.detail.value || [];
    const picked = Object.assign({}, this.data.filterPicked);
    picked[field] = values;
    const items = Object.assign({}, this.data.filterItems);
    items[field] = (items[field] || []).map((item) => Object.assign({}, item, {
      checked: values.indexOf(item.name) >= 0
    }));
    this.setData({ filterPicked: picked, filterItems: items });
  },

  onApplyFilter() {
    this.setData({ showFilter: false });
    this.refresh();
  },

  onResetFilter() {
    this.setData({
      filterGradeIndex: 0,
      filterSubject: '',
      filterTime: '',
      filterMinPrice: '',
      filterItems: blankPickItems(),
      filterPicked: blankPicked(),
      onlyMatch: false        // 重置＝回到"显示全部单"（不符合的排在后面）
    });
    store.setNearbyKm(30);
    this.refresh();
  },

  // 老师点「我已付款」：只是告诉平台付了，等平台确认收款才能开始试课
  onClaimPaid(event) {
    if (!auth.requireRole('teacher', 'teacher')) return;
    const { chargeId, chargeAmount } = event.currentTarget.dataset;
    const id = Number(chargeId);
    if (!id) return;
    wx.showModal({
      title: '我已付款',
      content: '确认已经按合同付了 ' + (Number(chargeAmount) > 0 ? chargeAmount + ' 元' : '这笔款') +
               '吗？平台核对到账后就可以开始试课了。',
      confirmText: '我已付款',
      success: async (res) => {
        if (!res.confirm) return;
        if (!(await store.claimPaid(id))) {
          wx.showModal({ title: '操作失败', content: store.lastError, showCancel: false });
          return;
        }
        wx.showToast({ title: '已通知平台', icon: 'none' });
        this.refresh();
      }
    });
  },

  // 复制平台发来的合同 / 收款码链接
  onCopyContract(event) {
    const url = event.currentTarget.dataset.url;
    if (util.plain(url) === '') return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'none' })
    });
  },

  // 老师撤回投递（还在等平台确认的那条）：单子留在「可接的单」里，别人还能投
  onWithdrawApply(event) {
    if (!auth.requireRole('teacher', 'teacher')) return;
    const course = this.data.courses[Number(event.currentTarget.dataset.index)];
    if (!course) return;

    wx.showModal({
      title: '撤回投递',
      content: '撤回对 ' + course.name + ' 同学 ' + course.timeText + ' 的投递吗？\n' +
               '撤回后这条需求还在「可接的单」里，别人还能投，你也可以再投。',
      confirmText: '撤回投递',
      cancelText: '再想想',
      success: async (res) => {
        if (!res.confirm) return;
        if (!(await store.cancelBooking(course.id))) {
          wx.showModal({ title: '撤回失败', content: store.lastError, showCancel: false });
          return;
        }
        wx.showToast({ title: '已撤回', icon: 'none' });
        this.refresh();
      }
    });
  },

  // 老师结束订单（订单收尾）：还有课次等着确认时后端会挡
  onFinishOrder(event) {
    if (!auth.requireRole('teacher', 'teacher')) return;
    const course = this.data.courses[Number(event.currentTarget.dataset.index)];
    if (!course) return;

    wx.showModal({
      title: '结束订单',
      content: '结束和 ' + course.name + ' 同学的这条订单吗？\n' +
               '结束前先确认没有等着确认的课次。',
      confirmText: '结束订单',
      cancelText: '再想想',
      success: async (res) => {
        if (!res.confirm) return;
        if (!(await store.finishOrder(course.id))) {
          wx.showModal({ title: '结束失败', content: store.lastError, showCancel: false });
          return;
        }
        wx.showToast({ title: '订单已结束', icon: 'success' });
        this.refresh();
      }
    });
  },

  // 老师取消自己接的课：课变已取消，单子回到「可接的单」（别的老师还能接）
  onCancelCourse(event) {
    if (!auth.requireRole('teacher', 'teacher')) return;
    const course = this.data.courses[Number(event.currentTarget.dataset.index)];
    if (!course) return;

    wx.showModal({
      title: '取消预约',
      content: '取消 ' + course.name + ' 同学 ' + course.timeText + ' 的课吗？\n' +
               '取消后这条需求会重新回到「可接的单」，别的老师还能接。',
      confirmText: '取消预约',
      cancelText: '再想想',
      success: async (res) => {
        if (!res.confirm) return;
        if (!(await store.cancelBooking(course.id))) {
          wx.showModal({ title: '取消失败', content: store.lastError, showCancel: false });
          return;
        }
        wx.showToast({ title: '已取消', icon: 'success' });
        this.refresh();
      }
    });
  },

  // ---------- 老师：提交课次（试课完成 / 完成本次 / 异议后重新提交）----------

  // 试课中：提交试课完成 → 生成一条「待确认」的试课课次，等平台点通过 / 不通过
  onSubmitTrial(event) {
    if (!auth.requireRole('teacher', 'teacher')) return;
    const course = this.data.courses[Number(event.currentTarget.dataset.index)];
    if (!course) return;
    this.submitLesson(course.id, store.lessonTrial(), '试课情况（可留空）');
  },

  // 主订单进行中：完成本次 → 生成一条「待确认」的正式课次，等平台确认本次
  onSubmitFormal(event) {
    if (!auth.requireRole('teacher', 'teacher')) return;
    const course = this.data.courses[Number(event.currentTarget.dataset.index)];
    if (!course) return;
    this.submitLesson(course.id, store.lessonFormal(), '这次课的情况（可留空）');
  },

  // 提交 / 重新提交共用：弹一句上课情况（可以留空）
  submitLesson(bookingId, kind, placeholder) {
    wx.showModal({
      title: kind === store.lessonTrial() ? '提交试课完成' : '完成本次',
      editable: true,
      placeholderText: placeholder || '这次课的情况（可留空）',
      confirmText: '提交',
      success: async (res) => {
        if (!res.confirm) return;
        const data = await store.submitLesson(Number(bookingId), kind, res.content);
        if (!data) {
          wx.showModal({ title: '提交失败', content: store.lastError, showCancel: false });
          return;
        }
        wx.showToast({ title: '已提交，等平台确认', icon: 'none' });
        this.refresh();
      }
    });
  },

  // 平台有异议后：改完重新提交（还是「待确认」，只改内容）
  onResubmitLesson(event) {
    if (!auth.requireRole('teacher', 'teacher')) return;
    const lessonId = Number(event.currentTarget.dataset.lessonId);
    if (!lessonId) return;
    wx.showModal({
      title: '修改后重新提交',
      editable: true,
      placeholderText: '写下改完后的情况（可留空）',
      confirmText: '重新提交',
      success: async (res) => {
        if (!res.confirm) return;
        if (!(await store.resubmitLesson(lessonId, res.content))) {
          wx.showModal({ title: '提交失败', content: store.lastError, showCancel: false });
          return;
        }
        wx.showToast({ title: '已重新提交', icon: 'none' });
        this.refresh();
      }
    });
  },

  // 老师撤回还没被平台确认的课次：撤回后平台那边不用确认了，可以重新提交
  onWithdrawLesson(event) {
    if (!auth.requireRole('teacher', 'teacher')) return;
    const lessonId = Number(event.currentTarget.dataset.lessonId);
    if (!lessonId) return;
    wx.showModal({
      title: '撤回课次',
      content: '撤回这次提交吗？撤回后平台那边就不用确认了，你可以重新提交。',
      confirmText: '撤回',
      cancelText: '再想想',
      success: async (res) => {
        if (!res.confirm) return;
        if (!(await store.withdrawLesson(lessonId))) {
          wx.showModal({ title: '撤回失败', content: store.lastError, showCancel: false });
          return;
        }
        wx.showToast({ title: '已撤回', icon: 'none' });
        this.refresh();
      }
    });
  },

  // ---------- 批量发单（一条条发用右上角的【发布需求】弹窗）----------
  onBatch() {
    if (!auth.requireRole('student', 'student')) return;
    wx.navigateTo({ url: '/pages/postBatch/postBatch' });
  },

  // ---------- 发布（对应 PostDialog，只有学生能发）----------
  async openPublish() {
    // 访客点"登录后发布"、老师误点：都先走身份确认（老师会问一句要不要切身份）
    if (!auth.requireRole('student', 'student')) return;
    this.setData({
      showPublish: true,
      subject: '',
      time: '',
      price: '',
      area: '',
      areaLat: 0,
      areaLng: 0,
      note: '',
      rawText: '',
      parsing: false,
      parseTip: '',
      parsedText: '',
      publishGradeIndex: 0,
      publishGenderIndex: 0,
      reqEducationIndex: 0,
      reqSchool: '',
      reqYearsIndex: 0,
      reqCertIndex: 0,
      reqTeachModeIndex: 0,
      reqPriceMin: '',
      reqPriceMax: ''
    });
  },

  closePublish() {
    this.setData({ showPublish: false });
  },

  onSubjectInput(event) {
    this.setData({ subject: event.detail.value });
  },

  // 上课时间自己填（日期 + 时段合成一句话），不再从时段表里选
  onTimeInput(event) {
    this.setData({ time: event.detail.value });
  },

  onPriceInput(event) {
    this.setData({ price: event.detail.value });
  },

  onAreaInput(event) {
    // 手改位置文字就不认原来的坐标了（文字和坐标对不上会算错距离），
    // 到时候用发布人自己的当前定位兜底
    this.setData({ area: event.detail.value, areaLat: 0, areaLng: 0 });
  },

  // 点「📍定位」→ 微信选点地图：打开先定位到当前位置，直接完成＝用当前位置，
  // 拖地图/搜索＝改成别的地点，选完填进位置输入框（还能接着手改）
  onChooseArea() {
    location.pick((text, coords) => {
      this.setData({
        area: text,
        areaLat: coords ? coords.latitude : 0,
        areaLng: coords ? coords.longitude : 0
      });
    });
  },

  onNoteInput(event) {
    this.setData({ note: event.detail.value });
  },

  // ---------- 家长原话 → 智能解析（POST /api/agent/parse）----------
  onRawTextInput(event) {
    this.setData({ rawText: event.detail.value, parseTip: '' });
  },

  /*
   * 点【智能解析】：把家长原话交给后端（后端转给外部 Agent），拿回固定 5 字段自动填上。
   * 中介不用确认 —— 解析结果就是发布时用的要求；解析不出来就全「不限」，照常能发。
   */
  async onParseRawText() {
    const text = util.plain(this.data.rawText);
    if (text === '') {
      wx.showModal({ title: '提示', content: '先把家长的原话粘进来再解析。', showCancel: false });
      return;
    }
    if (this.data.parsing) return;
    this.setData({ parsing: true, parseTip: '' });
    const result = await store.parseRequirement(text);
    const patch = this.requirementsPatch(result);
    patch.parsing = false;
    patch.parsedText = text;
    patch.parseTip = result
      ? (util.requirementsText(result) === ''
          ? '这条原话里没有明确要求，按「不限」处理。'
          : '已解析：' + util.requirementsText(result))
      : (store.lastError || '解析没成功，按「不限」处理，不影响发单。');
    this.setData(patch);
  },

  // 解析结果 → 页面上那 5 个选择器的下标（解析不出来就全回到「不限」）
  requirementsPatch(result) {
    const req = result || {};
    const indexOf = (options, value) => {
      const index = options.indexOf(util.plain(value));
      return index < 0 ? 0 : index;
    };
    // 时薪：解析出来是数字就填上，不限就留空（'不限' 不是数字，Number('不限')=NaN → 0）
    const yuan = (value) => (Number(value) > 0 ? String(Number(value)) : '');
    return {
      publishGenderIndex: indexOf(this.data.genderOptions, req.gender),
      reqEducationIndex: indexOf(this.data.eduOptions, req.education),
      reqYearsIndex: indexOf(this.data.yearsOptions, req.minYears),
      reqCertIndex: indexOf(this.data.certOptions, req.certificate),
      reqTeachModeIndex: indexOf(this.data.teachModeOptions, req.teachMode),
      reqPriceMin: yuan(req.priceMin),
      reqPriceMax: yuan(req.priceMax)
    };
  },

  // ---------- 发布时填"对老师的要求"（固定字段 + 学校要求那个补充项）----------
  onGradePick(event) {
    this.setData({ publishGradeIndex: Number(event.detail.value) });
  },

  onGenderPick(event) {
    const index = Number(event.detail.value);
    this.setData({ publishGenderIndex: index });
  },

  onReqEducationPick(event) {
    this.setData({ reqEducationIndex: Number(event.detail.value) });
  },

  onReqYearsPick(event) {
    this.setData({ reqYearsIndex: Number(event.detail.value) });
  },

  onReqCertPick(event) {
    this.setData({ reqCertIndex: Number(event.detail.value) });
  },

  onReqSchoolInput(event) {
    this.setData({ reqSchool: event.detail.value });
  },

  onReqTeachModePick(event) {
    this.setData({ reqTeachModeIndex: Number(event.detail.value) });
  },

  onReqPriceMinInput(event) {
    this.setData({ reqPriceMin: event.detail.value });
  },

  onReqPriceMaxInput(event) {
    this.setData({ reqPriceMax: event.detail.value });
  },

  async confirmPublish() {
    if (!session.isStudent()) {
      wx.showModal({ title: '提示', content: '只有学生（平台）账号能发布需求。', showCancel: false });
      return;
    }
    /*
     * 家长原话还没解析过（中介直接点了发布）→ 这里补解析一次，解析结果直接用来发布，
     * 中介不需要确认；解析不出来（后端返回全「不限」）照样能发。
     */
    const rawText = util.plain(this.data.rawText);
    let parsed = null;
    if (rawText !== '' && rawText !== util.plain(this.data.parsedText)) {
      parsed = await store.parseRequirement(rawText);
      const patch = this.requirementsPatch(parsed);
      patch.parsedText = rawText;
      this.setData(patch);
    }
    const grade = this.data.gradeOptions[this.data.publishGradeIndex];
    // 性别要求就是这个单子对老师的性别要求（解析出来的结果会覆盖到 picker 上）
    const gender = parsed ? util.plain(parsed.gender) : this.data.genderOptions[this.data.publishGenderIndex];
    const education = parsed ? util.plain(parsed.education) : this.data.eduOptions[this.data.reqEducationIndex];
    const minYears = parsed ? util.plain(parsed.minYears) : this.data.yearsOptions[this.data.reqYearsIndex];
    const certificate = parsed ? util.plain(parsed.certificate) : this.data.certOptions[this.data.reqCertIndex];
    const teachMode = parsed ? util.plain(parsed.teachMode) : this.data.teachModeOptions[this.data.reqTeachModeIndex];
    // 时薪：解析出来的优先（家长按次给钱的已经折成时薪），没解析出来就用中介填的
    const priceMin = parsed && Number(parsed.priceMin) > 0
      ? String(Number(parsed.priceMin)) : util.plain(this.data.reqPriceMin);
    const priceMax = parsed && Number(parsed.priceMax) > 0
      ? String(Number(parsed.priceMax)) : util.plain(this.data.reqPriceMax);
    const post = {
      subject: this.data.subject,
      grade: grade === '不限' ? '' : grade,
      gender: gender === '不限' ? '' : gender,
      time: this.data.time,
      price: this.data.price,
      area: this.data.area,
      lat: this.data.areaLat,
      lng: this.data.areaLng,
      note: this.data.note,
      rawText,
      requirements: {
        gender,
        education,
        minYears,
        certificate,
        teachMode,
        priceMin,
        priceMax,
        // 学校要求不参与解析，是中介愿意补充才填的（可留空）
        school: this.data.reqSchool
      }
    };

    const id = await store.createPost(post);
    if (!(Number(id) > 0)) {
      wx.showModal({ title: '发布失败', content: store.lastError, showCancel: false });
      return;
    }
    this.setData({ showPublish: false });
    wx.showToast({ title: '发布成功', icon: 'success' });
    this.refresh();
  },

  // 访客点"登录后发布"走这里
  onLogin() {
    auth.requireRole('', '');
  }
});
