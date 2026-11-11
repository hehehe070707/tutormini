const store = require('../../utils/store.js');
const session = require('../../utils/session.js');
const util = require('../../utils/util.js');
const auth = require('../../utils/auth.js');

Page({
  data: {
    subjectOptions: util.DEFAULT_SUBJECTS,
    subjectIndex: 0,
    education: '',
    school: '',
    years: '',
    certificate: '',
    subject: '',
    price: '',
    times: '',
    intro: '',
    hint: ''
  },

  onLoad() {
    this.refresh = this.refresh.bind(this);
  },

  onShow() {
    store.on('teachersChanged', this.refresh);
    this.refresh();
  },

  onHide() {
    store.off('teachersChanged', this.refresh);
  },

  onUnload() {
    this.onHide();
  },

  async refresh() {
    if (!session.isTeacher()) {
      this.setData({ hint: '这个页面只有老师账号能用。' });
      return;
    }
    const teacher = await store.teacherById(session.teacherId());
    const options = await store.subjects();
    const subjectOptions = options.length > 0 ? options : util.DEFAULT_SUBJECTS;
    const index = subjectOptions.indexOf(teacher.subject);
    this.setData({
      subjectOptions,
      subjectIndex: index >= 0 ? index : 0,
      education: teacher.education,
      school: teacher.school,
      years: teacher.years,
      certificate: teacher.certificate,
      subject: teacher.subject,
      price: teacher.price,
      times: teacher.times,
      intro: teacher.intro,
      hint: '保存后：课程里的老师详情页、投递简历弹窗、平台看简历都读这份。'
    });
  },

  onInput(event) {
    const patch = {};
    patch[event.currentTarget.dataset.field] = event.detail.value;
    this.setData(patch);
  },

  onSubjectPick(event) {
    const index = Number(event.detail.value);
    this.setData({ subjectIndex: index, subject: this.data.subjectOptions[index] });
  },

  async onSave() {
    if (!auth.requireRole('teacher', 'teacher')) return;
    const id = await store.saveTeacherResume({
      education: this.data.education,
      school: this.data.school,
      years: this.data.years,
      certificate: this.data.certificate,
      subject: this.data.subject,
      price: this.data.price,
      times: this.data.times,
      intro: this.data.intro
    });
    if (id < 0) {
      wx.showModal({ title: '保存失败', content: store.lastError, showCancel: false });
      return;
    }
    wx.showToast({ title: '简历已保存', icon: 'success' });
  },

  onBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: '/pages/profile/profile' });
  }
});
