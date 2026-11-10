/*
 * 登录页：对应 Qt 版的 LoginPage。
 * 学生 / 老师共用一页：先选身份，只显示这一种身份的登录注册表单。
 * 老师这边只收姓名 + 密码：科目 / 价格 / 位置 / 简介登录后去【我的】页填
 * （资料页填完学生才按位置搜得到，也才有得看）。
 */

const store = require('../../utils/store.js');
const session = require('../../utils/session.js');
const location = require('../../utils/location.js');

Page({
  data: {
    intentTip: '',
    role: 'student',     // 当前显示的身份：student / teacher
    studentName: '',
    studentPassword: '',
    teacherName: '',
    teacherPassword: ''
  },

  onLoad(options) {
    // intent：从哪个动作跳过来的（student=发单/确认接单，teacher=接单/投递简历）
    this.intent = (options && options.intent) || '';
    // redirect：登录成功后要去的页面，不传就回上一页
    this.redirect = (options && options.redirect) || '';
    // force=1：已经是登录状态也照样显示表单（用来切换身份）
    const force = (options && options.force) === '1';
    this.force = force;

    const tips = {
      student: '登录学生账号后就能继续发单、确认接单。',
      teacher: '登录老师账号后就能接单、投递简历。'
    };
    // intent 里已经带了身份（发单/接单跳过来、或“切换身份”）就直接定位到那一种
    const role = (this.intent === 'student' || this.intent === 'teacher') ? this.intent : 'student';
    this.setData({ intentTip: tips[this.intent] || '', role });

    // 已经是登录状态（含自动登录）就不用再选身份了
    if (session.isLoggedIn() && !force) this.afterLogin();
  },

  // 令牌校验 / 微信自动登录回来得比 onLoad 晚：app.js 会再叫一次，这里补判断
  refresh() {
    if (session.isLoggedIn() && !this.force) this.afterLogin();
  },

  // 切换身份
  onPickRole(event) {
    this.setData({ role: event.currentTarget.dataset.role });
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    const patch = {};
    patch[field] = event.detail.value;
    this.setData(patch);
  },

  // 学生身份进入 / 注册
  async loginStudent() {
    const id = await store.loginStudent(this.data.studentName, this.data.studentPassword);
    if (id < 0) return this.tip('登录失败', store.lastError);
    this.start('student', id);
  },

  async registerStudent() {
    const id = await store.registerStudent(this.data.studentName, this.data.studentPassword);
    if (id < 0) return this.tip('注册失败', store.lastError);
    this.start('student', id, '账号已创建，去【我的】页补上学校、年级和手机号吧。');
  },

  // 老师身份登录 / 注册
  async loginTeacher() {
    const id = await store.loginTeacher(this.data.teacherName, this.data.teacherPassword);
    if (id < 0) return this.tip('登录失败', store.lastError);
    this.start('teacher', id);
  },

  async registerTeacher() {
    const id = await store.registerTeacher(this.data.teacherName, this.data.teacherPassword);
    if (id < 0) return this.tip('注册失败', store.lastError);
    this.start('teacher', id, '账号已创建，去【我的】页填科目、价格和位置吧。');
  },

  // 登录成功：令牌已经由 store 存好（后端发的），这里只清密码框、进主界面
  start(role, id, tipText) {
    const name = role === 'student'
      ? String(this.data.studentName).trim()
      : String(this.data.teacherName).trim();

    if (role === 'student') {
      session.startAsStudent();
      session.bindStudent(id, name);
      this.setData({ studentPassword: '' });
    } else {
      session.startAsTeacher();
      session.bindTeacher(id, name);
      this.setData({ teacherPassword: '' });
    }

    // 登录成功（学生 / 老师都一样）先自动定位一次：列表页据此只看附近的人 / 单。
    // 静默定位：没授权不弹窗，回列表页会看到"开启定位"的提示条
    location.locate();

    if (tipText) {
      wx.showModal({
        title: '注册成功',
        content: tipText,
        showCancel: false,
        success: () => this.afterLogin()
      });
      return;
    }
    this.afterLogin();
  },

  // 登录完回到刚才在做的事：有上一页就返回，没有就去主界面
  afterLogin() {
    if (this.redirect) {
      wx.reLaunch({ url: this.redirect });
      return;
    }
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }
    // 中介的第一页是【工作台】，老师的是【接单】（同一个发单页按身份渲染）
    wx.switchTab({ url: session.isTeacher() ? '/pages/post/post' : '/pages/workbench/workbench' });
  },

  onBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: '/pages/post/post' });
  },

  tip(title, content) {
    wx.showModal({ title, content, showCancel: false });
  }
});
