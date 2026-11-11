const store = require('../../utils/store.js');
const session = require('../../utils/session.js');
const location = require('../../utils/location.js');

Page({
  data: {
    intentTip: '',
    role: 'student',
    studentName: '',
    studentPassword: '',
    teacherName: '',
    teacherPassword: ''
  },

  onLoad(options) {

    this.intent = (options && options.intent) || '';

    this.redirect = (options && options.redirect) || '';

    const force = (options && options.force) === '1';
    this.force = force;

    const tips = {
      student: '登录学生账号后就能继续发单、确认接单。',
      teacher: '登录老师账号后就能接单、投递简历。'
    };

    const role = (this.intent === 'student' || this.intent === 'teacher') ? this.intent : 'student';
    this.setData({ intentTip: tips[this.intent] || '', role });

    if (session.isLoggedIn() && !force) this.afterLogin();
  },

  refresh() {
    if (session.isLoggedIn() && !this.force) this.afterLogin();
  },

  onPickRole(event) {
    this.setData({ role: event.currentTarget.dataset.role });
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    const patch = {};
    patch[field] = event.detail.value;
    this.setData(patch);
  },

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

  afterLogin() {
    if (this.redirect) {
      wx.reLaunch({ url: this.redirect });
      return;
    }
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }

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
