/*
 * 老师简历页：对应 Qt 版的 TeacherDetailPage（现在只当"简历页"用）。
 * 入口：学生「我的课程」里点老师名字。
 * 内容：资料 + 完整简历（不设查看限制）+ 底部一个动作【复制简历】——平台把这段
 * 文字转给客户看。评价区已下线：客户不在平台上，没有评价来源。
 */

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

    resumeRows: [],       // 完整简历（学历 / 学校 / 教龄 / 证书 / 可教科目 / 价格 / 可教时段）
    resumeIntro: '',      // 自我介绍
    copyText: ''          // 【复制简历】用的整段文字
  },

  onLoad(options) {
    this.setData({ teacherId: Number(options.id) });
    this.refresh = this.refresh.bind(this);
    this.seq = 0;
  },

  // 首次进入、从登录页返回都在 onShow 里刷一次，不做重复刷新
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
    // 详情页也要算距离：先把最新定位交给数据层，请求时一起发给后端
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

  // 复制整段简历：平台直接转给客户（只含教学信息，没有联系方式）
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

// 简历拼成一段纯文字：姓名 / 科目 / 价格 / 各栏 + 自我介绍
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
