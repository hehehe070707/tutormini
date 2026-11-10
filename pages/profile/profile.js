/*
 * 「我的」页：对应 Qt 版的 ProfilePage。
 * 这一页只管"我是谁"：学生端（平台账号）填联系人 / 备注 / 电话（只有自己看得见，老师端只会显示
 * 「平台」），老师填 姓名/科目/价格/位置/简介；上面两行统计看一眼就够了。
 * 单子 / 订单的记录不在这儿重复 —— 中介看【单子】那格（pages/myPosts → pages/postManage），
 * 老师看【接单】页的「我的课」和【消息】页的单子卡片。
 */

const store = require('../../utils/store.js');
const session = require('../../utils/session.js');
const util = require('../../utils/util.js');
const auth = require('../../utils/auth.js');
const location = require('../../utils/location.js');

Page({
  data: {
    role: 'none',
    roleName: '',
    avatar: '👤',
    nameText: '未填写资料',
    stat1: '',
    stat2: '',

    // 学生资料
    studentName: '',
    school: '',
    grade: '',
    phone: '',

    // 老师资料
    teacherName: '',
    subject: '',
    subjectOptions: util.DEFAULT_SUBJECTS,
    subjectIndex: 0,
    gender: '',
    genderOptions: util.GENDER_OPTIONS,
    genderIndex: 0,
    price: '',
    area: '',
    areaLat: 0,        // 选点地图带回来的坐标：保存时写库，学生按距离才搜得到你
    areaLng: 0,
    intro: '',

    // 订单 / 单子记录都在【单子】那格，这一页不再放历史
  },

  onLoad() {
    this.refresh = this.refresh.bind(this);
    /*
     * 表单有没有被手动改过（打字 / 选科目 / 点定位）。
     * 点「📍定位」会先切走再回来，onShow 会再刷一次数据；要是把库里那份盖回来，
     * 刚选好的位置就"消失"了 —— 所以改过的表单不再被刷新覆盖，保存后清掉这个标记。
     */
    this.dirty = false;
  },

  // tab 页会被系统缓存：每次显示才订阅 + 刷数据 + 更新底部导航
  onShow() {
    store.on('bookingsChanged', this.refresh);
    store.on('postsChanged', this.refresh);
    store.on('studentsChanged', this.refresh);
    store.on('teachersChanged', this.refresh);
    this.refresh();
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.refresh();
  },

  onHide() {
    store.off('bookingsChanged', this.refresh);
    store.off('postsChanged', this.refresh);
    store.off('studentsChanged', this.refresh);
    store.off('teachersChanged', this.refresh);
  },

  onUnload() {
    this.onHide();
  },

  // 身份 + 资料 + 统计，后端一次给全（对应原来打好几个本地接口）
  async refresh() {
    // 访客：不赶人去登录，只说明“要用到身份的动作”才需要选账号
    if (!session.isLoggedIn()) {
      this.showGuest();
      return;
    }

    const dash = await store.dashboard();

    // ---------- 学生 ----------
    if (dash.role === 'student') {
      // 刚从别的身份切过来（或退出后重新登录）：表单要换成学生那一份
      if (this.data.role !== 'student') this.dirty = false;
      const student = dash.student || {};
      const stats = dash.stats || { activeBookings: 0, totalSpent: 0 };
      const patch = {
        role: 'student',
        roleName: '学生',
        avatar: '🧑‍🎓',
        nameText: util.plain(student.name) === '' ? '未填写资料' : student.name,
        stat1: '正在进行的课：' + stats.activeBookings + ' 节',
        stat2: '待支付：' + Number(stats.unpaidAmount || 0) + ' 元'
      };
      // 正在填的资料不覆盖（跟老师那一侧同一个道理）
      if (!this.dirty) {
        patch.studentName = student.name;
        patch.school = student.school;
        patch.grade = student.grade;
        patch.phone = student.phone;
      }
      this.setData(patch);
      return;
    }

    if (dash.role !== 'teacher') {
      // 令牌失效之类：当访客处理，别把页面卡在空白
      this.showGuest();
      return;
    }

    // ---------- 老师 ----------
    if (this.data.role !== 'teacher') this.dirty = false;
    const teacher = dash.teacher || {};
    const stats = dash.stats || { total: 0, pending: 0 };

    const options = dash.subjects || [];
    const subjectOptions = options.length > 0 ? options : util.DEFAULT_SUBJECTS;
    const index = subjectOptions.indexOf(teacher.subject);

    const patch = {
      role: 'teacher',
      roleName: '老师',
      avatar: '🧑‍🏫',
      nameText: util.plain(teacher.name) === '' ? session.teacherName() : teacher.name,
      stat1: '进行中的课：' +
        (Number(stats.pending || 0) + Number(stats.trial || 0) + Number(stats.ongoing || 0)) + ' 节',
      stat2: '待平台确认：' + Number(stats.pending || 0) + ' 节',
      // 老师这边不放「接单的历史」：投递、试课、主订单都看【接单】页的「我的课」，
      // 每张单子走到哪一步在消息页的单子卡片里。
      subjectOptions
    };
    /*
     * 只有没在填的时候才把库里的资料刷进表单：
     * 点「📍定位」是跳出去选点再回来，onShow 会再刷一次，一盖就把刚选好的位置盖没了。
     */
    if (!this.dirty) {
      patch.teacherName = teacher.name;
      patch.subject = teacher.subject;
      patch.subjectIndex = index >= 0 ? index : 0;
      patch.gender = util.plain(teacher.gender);
      patch.genderIndex = Math.max(0, util.GENDER_OPTIONS.indexOf(util.plain(teacher.gender)));
      patch.price = teacher.price;
      patch.area = teacher.area;
      patch.areaLat = teacher.lat || 0;
      patch.areaLng = teacher.lng || 0;
      patch.intro = teacher.intro;
    }
    this.setData(patch);
  },

  // 老师维护简历（学历 / 学校 / 教龄 / 证书 / 可教科目 / 价格 / 时段 / 自我介绍）
  onOpenResume() {
    wx.navigateTo({ url: '/pages/teacherResume/teacherResume' });
  },

  showGuest() {
    this.dirty = false;      // 访客没有表单在填
    this.setData({
      role: 'guest',
      roleName: '未登录',
      avatar: '👤',
      nameText: '还没选身份',
      stat1: '浏览不用登录：发单、接单时才需要身份',
      stat2: ''
    });
  },

  // ---------- 表单输入 ----------
  onInput(event) {
    const field = event.currentTarget.dataset.field;
    const patch = {};
    patch[field] = event.detail.value;
    this.dirty = true;      // 手动改过：刷新时不要再拿库里的旧资料盖回来
    // 手改位置文字就不认原来的坐标了（文字和坐标对不上会算错距离），保存时用当前定位兜底
    if (field === 'area') {
      patch.areaLat = 0;
      patch.areaLng = 0;
    }
    this.setData(patch);
  },

  onSubjectPick(event) {
    const index = Number(event.detail.value);
    this.dirty = true;
    this.setData({ subjectIndex: index, subject: this.data.subjectOptions[index] });
  },

  // 性别：单子如果指定了要男老师 / 女老师，老师端"我符不符合"就靠这个判断
  onGenderPick(event) {
    const index = Number(event.detail.value);
    this.dirty = true;
    this.setData({ genderIndex: index, gender: util.GENDER_OPTIONS[index] });
  },

  // 点「📍定位」→ 微信选点地图：打开先定位到当前位置，直接完成＝用当前位置，
  // 拖地图/搜索＝改成别的地点，选完填进位置输入框（还能接着手改）
  onChooseArea() {
    // 选点地图会把页面切走（onShow 再刷一次），这里先立个标记，免得刚选的位置被旧资料盖掉
    this.dirty = true;
    location.pick((text, coords) => {
      this.setData({
        area: text,
        areaLat: coords ? coords.latitude : 0,
        areaLng: coords ? coords.longitude : 0
      });
    });
  },

  // ---------- 保存资料 ----------
  async onSaveProfile() {
    if (!session.isTeacher()) {
      const name = String(this.data.studentName).trim();
      if (name === '') {
        wx.showModal({ title: '提示', content: '先填一个称呼吧。', showCancel: false });
        return;
      }

    const student = {
        id: session.studentId(),
        name,
        school: this.data.school,
        grade: this.data.grade,
        phone: this.data.phone
      };
    if (!(await store.saveStudentProfile(student))) {
      wx.showModal({ title: '保存失败', content: store.lastError, showCancel: false });
      return;
    }
    session.bindStudent(student.id, student.name);
    this.dirty = false;      // 存好了：之后刷新可以放心用库里的资料
    await this.refresh();
    wx.showToast({ title: '个人信息已保存', icon: 'success' });
    return;
    }

    const teacherName = String(this.data.teacherName).trim();
    if (teacherName === '') {
      wx.showModal({ title: '提示', content: '先填一下姓名吧。', showCancel: false });
      return;
    }

    const teacher = {
      name: teacherName,
      gender: this.data.gender,
      subject: this.data.subject,
      price: this.data.price,
      area: this.data.area,
      lat: this.data.areaLat,
      lng: this.data.areaLng,
      intro: this.data.intro
    };
    const teacherId = await store.saveTeacherProfile(session.teacherId(), teacher);
    if (teacherId < 0) {
      wx.showModal({ title: '保存失败', content: store.lastError, showCancel: false });
      return;
    }
    session.bindTeacher(teacherId, teacher.name);
    this.dirty = false;
    await this.refresh();
    wx.showToast({ title: '老师资料已保存', icon: 'success' });
  },

  // 访客从“我的”页去登录 / 注册
  onLogin(event) {
    auth.requireRole('', event.currentTarget.dataset.intent || '');
  },

  // ---------- 退出登录 ----------
  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后下次打开需要重新选身份登录，确定吗？',
      success: async (res) => {
        if (!res.confirm) return;
        await store.forgetLogin();   // 后端作废这枚令牌，本地也清掉
        // 退出后回第一页当访客继续浏览，不逼着重新登录
        wx.switchTab({ url: '/pages/post/post' });
      }
    });
  }
});
