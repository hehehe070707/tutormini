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

    studentName: '',
    school: '',
    grade: '',
    phone: '',

    teacherName: '',
    subject: '',
    subjectOptions: util.DEFAULT_SUBJECTS,
    subjectIndex: 0,
    gender: '',
    genderOptions: util.GENDER_OPTIONS,
    genderIndex: 0,
    price: '',
    area: '',
    areaLat: 0,
    areaLng: 0,
    intro: '',

  },

  onLoad() {
    this.refresh = this.refresh.bind(this);

    this.dirty = false;
  },

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

  async refresh() {

    if (!session.isLoggedIn()) {
      this.showGuest();
      return;
    }

    const dash = await store.dashboard();

    if (dash.role === 'student') {

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

      this.showGuest();
      return;
    }

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

      subjectOptions
    };

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

  onOpenResume() {
    wx.navigateTo({ url: '/pages/teacherResume/teacherResume' });
  },

  showGuest() {
    this.dirty = false;
    this.setData({
      role: 'guest',
      roleName: '未登录',
      avatar: '👤',
      nameText: '还没选身份',
      stat1: '浏览不用登录：发单、接单时才需要身份',
      stat2: ''
    });
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    const patch = {};
    patch[field] = event.detail.value;
    this.dirty = true;

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

  onGenderPick(event) {
    const index = Number(event.detail.value);
    this.dirty = true;
    this.setData({ genderIndex: index, gender: util.GENDER_OPTIONS[index] });
  },

  onChooseArea() {

    this.dirty = true;
    location.pick((text, coords) => {
      this.setData({
        area: text,
        areaLat: coords ? coords.latitude : 0,
        areaLng: coords ? coords.longitude : 0
      });
    });
  },

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
    this.dirty = false;
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

  onLogin(event) {
    auth.requireRole('', event.currentTarget.dataset.intent || '');
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后下次打开需要重新选身份登录，确定吗？',
      success: async (res) => {
        if (!res.confirm) return;
        await store.forgetLogin();

        wx.switchTab({ url: '/pages/post/post' });
      }
    });
  }
});
