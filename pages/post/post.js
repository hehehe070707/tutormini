const store = require('../../utils/store.js');
const session = require('../../utils/session.js');
const util = require('../../utils/util.js');
const auth = require('../../utils/auth.js');
const location = require('../../utils/location.js');

function pickItems(list, suffix) {
  return list.map((name) => ({ name: name, label: suffix ? name + suffix : name, checked: false }));
}

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

function matchTipOf(post) {
  const reasons = post.matchReasons || [];
  const notOk = reasons.filter((text) => text.indexOf('✅') !== 0);
  if (notOk.length > 0) return notOk.join('；');
  return reasons.length > 0 ? '符合全部要求' : '';
}

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
    publishText: '',
    hint: '',

    guest: false,
    guestList: [],
    studentMode: false,
    teacherMode: false,
    showNearby: false,

    showFilter: false,
    filterGradeIndex: 0,
    filterSubject: '',
    filterTime: '',
    filterMinPrice: '',
    filterItems: blankPickItems(),
    filterPicked: blankPicked(),

    onlyMatch: false,
    gradeOptions: util.GRADE_OPTIONS,
    genderOptions: util.GENDER_OPTIONS,
    filterSummary: '',

    takeList: [],
    takeEmpty: '',
    firstNonMatch: -1,
    nonMatchTip: '',

    mineList: [],
    mineEmpty: '',

    coursesTitle: '',
    courses: [],
    coursesEmpty: '',

    radiusOptions: [],
    radiusIndex: 0,
    nearbyTip: '',
    nearbyAction: '',
    nearbyActionText: '',

    showPublish: false,
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

    reqPriceMin: '',
    reqPriceMax: '',

    showResume: false,
    resumePostId: 0,
    resumeTitle: '',
    resumeText: '',

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

  onShow() {
    store.on('postsChanged', this.refresh);
    store.on('bookingsChanged', this.refresh);

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

  async refresh() {
    const seq = ++this.seq;

    store.setViewerLocation(location.current());

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

  async refreshTeacher(seq, radius) {
    wx.setNavigationBarTitle({ title: '📋 接单' });

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
      requirementText: util.requirementsText(post.requirements),
      rawText: util.plain(post.rawText),
      matchLevel: post.matchLevel || '',
      matchBadge: util.matchLevelText(post.matchLevel),
      matchClass: util.matchLevelClass(post.matchLevel),

      matchTip: matchTipOf(post),
      matchDetailText: matchDetailTextOf(post),
      applied: !!post.applied,
      timeConflict: !!post.timeConflict
    }));
    const hidden = store.lastHidden;

    let firstNonMatch = -1;
    let nonMatchCount = 0;
    takeList.forEach((item, index) => {
      if (item.matchLevel !== util.MATCH_NONE) return;
      if (firstNonMatch < 0) firstNonMatch = index;
      nonMatchCount++;
    });

    const courses = (await store.bookingsForTeacher(session.teacherId()))
      .filter((booking) => util.isActiveBooking(booking.status))
      .map((booking) => {
        const stats = booking.lessonStats || {};

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

          feeText: lesson.isTrial && !lesson.pending && Number(lesson.fee) > 0
            ? '试课费 ' + lesson.fee + ' 元' : '',

          needsFix: lesson.pending && util.plain(lesson.reason) !== '',

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

          cancellable: booking.status === util.STATUS_TRIAL || booking.status === util.STATUS_MAIN,

          withdrawable: booking.status === util.STATUS_PENDING,

          canFinish: (booking.status === util.STATUS_TRIAL || booking.status === util.STATUS_MAIN) &&
                     !(Number(stats.pendingCount) > 0),

          canSubmitTrial: booking.status === util.STATUS_TRIAL && !trialSubmitted,

          canSubmitFormal: booking.status === util.STATUS_MAIN && !(Number(stats.pendingCount) > 0),
          lessons,
          confirmedCount: Number(stats.confirmedCount) || 0,
          unpaidAmount: Number(stats.unpaidAmount) || 0,
          paidAmount: Number(stats.paidAmount) || 0,

          chargeId: charge ? charge.id : 0,
          chargeAmount: charge ? charge.amount : 0,
          chargeStatusText: charge
            ? '收款 ' + (charge.amount > 0 ? charge.amount + ' 元' : '金额待定') + ' · ' + charge.status
            : '',
          chargeClass: charge ? util.payStatusClass(charge.status) : '',
          refundedAmount: Number(pay.refunded) || 0,
          contractUrl: charge ? charge.contractUrl : '',
          canClaimPaid: !!charge && charge.status === util.PAY_PENDING,

          payGateTip: (booking.status === util.STATUS_TRIAL && charge &&
            charge.status !== util.PAY_RECEIVED && charge.status !== util.PAY_REFUNDED)
            ? '等平台确认收款后再提交试课' : ''
        };
      });
    if (seq !== this.seq) return;

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

  buildRadius() {
    const choices = store.nearbyChoices();
    const options = choices.map((km) => util.formatRadius(km));
    let index = choices.indexOf(store.nearbyKmValue());
    if (index < 0) index = choices.indexOf(store.nearbyDefault());
    return { options, index: index < 0 ? 0 : index };
  },

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

    if (item.requirementText) rows.push({ label: '对老师的要求', value: item.requirementText });

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

  async onTake(event) {
    if (!auth.requireRole('teacher', 'teacher')) return;
    const post = this.data.takeList[Number(event.currentTarget.dataset.index)];
    if (!post) return;

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

  async openResume(post) {

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

  afterTake() {
    this.setData({ showResume: false });
    wx.showModal({
      title: '简历已投递',
      content: '等平台确认后就算接单成功，课记在下面「我的课」里。',
      showCancel: false,
      success: () => this.refresh()
    });
  },

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

      myGender: p.myGender.length === 1 ? p.myGender[0] : '',
      myEducation: p.myEducation,
      myCertificate: p.myCertificate,
      myTeachMode: p.myTeachMode,
      onlyMatch: d.onlyMatch
    };
  },

  pickLabel(field, values) {
    const items = this.data.filterItems[field] || [];
    return values.map((value) => {
      const hit = items.filter((item) => item.name === value)[0];
      return hit ? hit.label : value;
    }).join(' / ');
  },

  filterSummaryText(hidden) {
    const f = this.currentFilters();
    const p = this.data.filterPicked;
    const parts = [];
    if (f.grade !== '') parts.push(f.grade);
    if (f.subject !== '') parts.push(f.subject);
    if (f.time !== '') parts.push(f.time);
    if (Number(f.minPrice) > 0) parts.push(f.minPrice + ' 元起');

    if (p.gender.length > 0) parts.push('要求' + this.pickLabel('gender', p.gender) + '老师');
    if (p.education.length > 0) parts.push('要求' + this.pickLabel('education', p.education));
    if (p.certificate.length > 0) parts.push('要求' + this.pickLabel('certificate', p.certificate));
    if (p.teachMode.length > 0) parts.push('要求' + this.pickLabel('teachMode', p.teachMode));

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
      onlyMatch: false
    });
    store.setNearbyKm(30);
    this.refresh();
  },

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

  onCopyContract(event) {
    const url = event.currentTarget.dataset.url;
    if (util.plain(url) === '') return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'none' })
    });
  },

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

  onSubmitTrial(event) {
    if (!auth.requireRole('teacher', 'teacher')) return;
    const course = this.data.courses[Number(event.currentTarget.dataset.index)];
    if (!course) return;
    this.submitLesson(course.id, store.lessonTrial(), '试课情况（可留空）');
  },

  onSubmitFormal(event) {
    if (!auth.requireRole('teacher', 'teacher')) return;
    const course = this.data.courses[Number(event.currentTarget.dataset.index)];
    if (!course) return;
    this.submitLesson(course.id, store.lessonFormal(), '这次课的情况（可留空）');
  },

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

  onBatch() {
    if (!auth.requireRole('student', 'student')) return;
    wx.navigateTo({ url: '/pages/postBatch/postBatch' });
  },

  async openPublish() {

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

  onTimeInput(event) {
    this.setData({ time: event.detail.value });
  },

  onPriceInput(event) {
    this.setData({ price: event.detail.value });
  },

  onAreaInput(event) {

    this.setData({ area: event.detail.value, areaLat: 0, areaLng: 0 });
  },

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

  onRawTextInput(event) {
    this.setData({ rawText: event.detail.value, parseTip: '' });
  },

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

  requirementsPatch(result) {
    const req = result || {};
    const indexOf = (options, value) => {
      const index = options.indexOf(util.plain(value));
      return index < 0 ? 0 : index;
    };

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

    const rawText = util.plain(this.data.rawText);
    let parsed = null;
    if (rawText !== '' && rawText !== util.plain(this.data.parsedText)) {
      parsed = await store.parseRequirement(rawText);
      const patch = this.requirementsPatch(parsed);
      patch.parsedText = rawText;
      this.setData(patch);
    }
    const grade = this.data.gradeOptions[this.data.publishGradeIndex];

    const gender = parsed ? util.plain(parsed.gender) : this.data.genderOptions[this.data.publishGenderIndex];
    const education = parsed ? util.plain(parsed.education) : this.data.eduOptions[this.data.reqEducationIndex];
    const minYears = parsed ? util.plain(parsed.minYears) : this.data.yearsOptions[this.data.reqYearsIndex];
    const certificate = parsed ? util.plain(parsed.certificate) : this.data.certOptions[this.data.reqCertIndex];
    const teachMode = parsed ? util.plain(parsed.teachMode) : this.data.teachModeOptions[this.data.reqTeachModeIndex];

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

  onLogin() {
    auth.requireRole('', '');
  }
});
