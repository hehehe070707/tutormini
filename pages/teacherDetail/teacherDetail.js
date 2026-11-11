const store = require('../../utils/store.js');
const util = require('../../utils/util.js');
const location = require('../../utils/location.js');

Page({
  data: {
    teacherId: -1,
    name: '',
    subjectText: '',
    priceText: '',
    areaText: '',
    introText: '',
    notFound: false,

    resumeRows: [],
    resumeIntro: '',
    copyText: ''
  },

  onLoad(options) {
    this.setData({ teacherId: Number(options.id) });
    this.refresh = this.refresh.bind(this);
    this.seq = 0;
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
    const seq = ++this.seq;
    const teacherId = this.data.teacherId;
    if (!(teacherId >= 0)) return;

    store.setViewerLocation(location.current());

    const teacher = await store.teacherById(teacherId);
    if (seq !== this.seq) return;
    if (teacher.id < 0) {
      this.setData({ notFound: true, name: '找不到这位老师', resumeRows: [], copyText: '' });
      return;
    }

    const distanceText = teacher.distanceKm < 0 ? '' : '　　距离 ' + util.formatDistance(teacher.distanceKm);
    const rows = [
      { label: '性别', value: util.plain(teacher.gender) },
      { label: '学历', value: util.plain(teacher.education) },
      { label: '学校', value: util.plain(teacher.school) },
      { label: '教龄', value: util.plain(teacher.years) },
      { label: '证书', value: util.plain(teacher.certificate) },
      { label: '可教科目', value: util.plain(teacher.subject) },
      { label: '价格', value: util.plain(teacher.price) },
      { label: '可教时段', value: util.plain(teacher.times) }
    ];
    const intro = util.plain(teacher.intro);

    this.setData({
      notFound: false,
      name: teacher.name,
      subjectText: '科目：' + (util.plain(teacher.subject) === '' ? '未填写' : teacher.subject),
      priceText: '价格：' + (util.plain(teacher.price) === '' ? '未填写' : teacher.price),
      areaText: '位置：' + (util.plain(teacher.area) === '' ? '未填写' : teacher.area) + distanceText,
      introText: intro === '' ? '这位老师还没有填写简介。' : intro,
      resumeRows: rows,
      resumeIntro: intro,
      copyText: resumeText(teacher, rows, intro)
    });
  },

  onCopyResume() {
    const text = this.data.copyText;
    if (text === '') {
      wx.showModal({ title: '提示', content: '这位老师还没有可复制的简历。', showCancel: false });
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '简历已复制', icon: 'none' })
    });
  },

  onBack() {
    wx.navigateBack();
  }
});

function resumeText(teacher, rows, intro) {
  const lines = [teacher.name + '（' + (util.plain(teacher.subject) === '' ? '科目未填' : teacher.subject) + '）'];
  if (util.plain(teacher.price) !== '') lines.push('价格：' + teacher.price);
  rows.forEach((row) => {
    if (util.plain(row.value) !== '' && row.label !== '价格' && row.label !== '可教科目') {
      lines.push(row.label + '：' + row.value);
    }
  });
  if (util.plain(intro) !== '') lines.push('自我介绍：' + intro);
  return lines.join('\n');
}
