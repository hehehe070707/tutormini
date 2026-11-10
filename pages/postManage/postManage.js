/*
 * 单子管理（三级页）：中介从【单子】那格（pages/myPosts）点一条单进来，这一页管这一条单的档案。
 *
 * 一页四块（这一页只"看档案 + 兜底改"，动手的事在【工作台】待办里）：
 *   ① 这条单的全部属性（单号 / 科目年级 / 状态 / 时间 / 价格 / 位置 / 说明 / 要求 / 家长原话）
 *      + 复制单号 / 需求 / 简历合集 + 撤销（招募中才给）
 *   ② 收到的投递：每位老师一份（看简历 / 点名字看老师资料），不回绝也不定人
 *   ③ 合同收款：这条订单收到多少钱、合同链接（可复制）
 *   ④ 修正：改单子状态 / 改订单状态 / 补录线下成交的订单 / 作废（软删）/ 修正记录
 *
 * 确认接单 / 换一位老师 / 发合同 / 确认收款这些日常动作只放在工作台待办里，避免两处重复。
 * 对应 Qt 版里"我发布的 + 订单处理"那一堆按钮，小程序这边收成一条单子一页。
 */

const store = require('../../utils/store.js');
const session = require('../../utils/session.js');
const util = require('../../utils/util.js');
const auth = require('../../utils/auth.js');
const postTexts = require('../../utils/postText.js');

function postStatusClass(status) {
  if (status === util.POST_OPEN) return 'st-open';
  if (status === util.POST_TAKEN) return 'st-taken';
  return 'st-closed';
}

Page({
  data: {
    postId: 0,
    loaded: false,
    missing: '',
    post: null,
    invites: [],
    pendingCount: 0,   // 还挂着没处理的投递条数（这一页的红点看它）
    bookings: [],
    canClose: false,
    // 修正：能改成哪几个状态（受控，和后端 correct.js 一致）
    fixPostOptions: ['招募中', '已成交', '已关闭'],
    fixPostIndex: 0,
    fixBookingOptions: ['待确认', '试课中', '主订单进行中', '已结束', '已取消'],
    fixTeachers: [],
    fixTeacherIndex: 0,
    fixRecordPrice: '',
    fixRecordStatusOptions: ['试课中', '主订单进行中', '已结束'],
    fixRecordStatusIndex: 1,
    notify: true,
    logs: []
  },

  onLoad(options) {
    this.setData({ postId: Number(options && options.postId) || 0 });
    this.refresh = this.refresh.bind(this);
    this.seq = 0;
  },

  onShow() {
    store.on('postsChanged', this.refresh);
    store.on('bookingsChanged', this.refresh);
    this.refresh();
  },

  onHide() {
    store.off('postsChanged', this.refresh);
    store.off('bookingsChanged', this.refresh);
  },

  onUnload() {
    this.onHide();
  },

  async refresh() {
    const seq = ++this.seq;
    const postId = this.data.postId;
    wx.setNavigationBarTitle({ title: '单子管理' });
    if (!session.isLoggedIn() || !(postId > 0)) {
      this.setData({ loaded: true, missing: '这条单子找不到了。', post: null });
      return;
    }

    const posts = await store.myPosts();
    const post = posts.find((item) => Number(item.id) === postId);
    if (!post) {
      if (seq !== this.seq) return;
      this.setData({ loaded: true, missing: '这条单子找不到了（可能不是你发的）。', post: null });
      return;
    }

    const invites = (post.invites || []).map((invite) => ({
      bookingId: invite.bookingId,
      teacherId: invite.teacherId,
      teacherName: invite.teacherName,
      resume: invite.resume,
      statusText: invite.statusText || util.bookingStatusText(invite.status),
      statusClass: util.bookingStatusClass(invite.status),
      cancelled: invite.status === util.STATUS_CANCELLED,
      pending: invite.status === util.STATUS_PENDING
    }));
    const pendingInvites = invites.filter((invite) => invite.pending);

    const bookings = (await store.bookingsForStudent(session.studentId()))
      .filter((booking) => Number(booking.postId) === postId)
      .map((booking) => {
        const pay = booking.payStats || {};
        const charge = pay.charge || null;
        return {
          id: booking.id,
          teacherName: booking.teacherName,
          status: booking.status,
          statusText: util.bookingStatusText(booking.status),
          statusIndex: Math.max(0, this.data.fixBookingOptions.indexOf(booking.status)),
          priceText: util.plain(booking.price) === '' ? '价格未填写' : booking.price,
          payText: charge
            ? '收款 ' + (Number(charge.amount) > 0 ? charge.amount + ' 元' : '金额待定') + ' · ' + charge.status
            : '',
          payClass: charge ? util.payStatusClass(charge.status) : '',
          contractUrl: charge ? charge.contractUrl : ''
        };
      });

    const logs = await store.corrections('post', postId);
    const teachers = this.fixTeacherOptions(invites);
    if (seq !== this.seq) return;

    this.setData({
      loaded: true,
      missing: '',
      post: {
        id: post.id,
        code: post.code || ('#' + post.id),
        subject: post.subject,
        subjectText: post.subject + (util.plain(post.grade) === '' ? '' : '（' + post.grade + '）'),
        status: post.status,
        statusClass: postStatusClass(post.status),
        timeText: util.plain(post.timeText) === '' ? '—' : post.timeText,
        price: util.plain(post.price) === '' ? '—' : post.price,
        area: util.plain(post.area) === '' ? '—' : post.area,
        note: util.plain(post.note) === '' ? '—' : post.note,
        requirementText: util.requirementsText(post.requirements) || '不限',
        rawText: util.plain(post.rawText) === '' ? '—' : post.rawText,
        createdAt: post.createdAt || '',
        inviteText: invites.length === 0
          ? '还没有老师投递'
          : '收到 ' + invites.length + ' 条投递（待你确认 ' + pendingInvites.length + ' 条）',
        bundle: postTexts.inviteBundle(post, invites)
      },
      invites,
      pendingCount: pendingInvites.length,
      bookings,
      canClose: post.status === util.POST_OPEN,
      fixPostIndex: Math.max(0, this.data.fixPostOptions.indexOf(post.status)),
      fixTeachers: teachers,
      fixTeacherIndex: 0,
      fixRecordPrice: util.plain(post.price) === '' ? '' : post.price,
      logs: logs.map((log) => this.fixLogText(log))
    });
  },

  // 补录订单能挑的老师：投过这条单的都算（按 id 去重）
  fixTeacherOptions(invites) {
    const seen = {};
    const list = [];
    (invites || []).forEach((invite) => {
      const id = Number(invite.teacherId) || 0;
      if (!(id > 0) || seen[id]) return;
      seen[id] = true;
      list.push({ id, name: invite.teacherName });
    });
    return list;
  },

  fixLogText(log) {
    const note = util.plain(log.note) === '' ? '' : '（' + log.note + '）';
    return log.createdAt + '　' + log.fromStatus + ' → ' + log.toStatus + note;
  },

  // ---------- ① 复制 / 撤销 ----------

  onCopyCode() {
    const post = this.data.post;
    if (post) postTexts.copyText(post.code, '单号已复制');
  },

  onCopyPost() {
    const post = this.data.post;
    if (post) postTexts.copyText(postTexts.postText(post), '需求文本已复制');
  },

  onCopyInvites() {
    const post = this.data.post;
    if (post) postTexts.copyText(post.bundle, '简历合集已复制');
  },

  onClosePost() {
    if (!auth.requireRole('student', 'student')) return;
    const post = this.data.post;
    if (!post) return;
    wx.showModal({
      title: '撤销这条需求',
      content: '撤销后这条单不再招募，还在等确认的投递会一起作废。',
      confirmText: '撤销',
      cancelText: '再想想',
      success: async (res) => {
        if (!res.confirm) return;
        if (!(await store.closePost(post.id))) {
          wx.showModal({ title: '撤销失败', content: store.lastError, showCancel: false });
          return;
        }
        wx.showToast({ title: '已撤销', icon: 'none' });
        this.refresh();
      }
    });
  },

  // ---------- ② 投递：看简历 / 看老师（定人、回绝都在工作台待办里做）----------

  onShowResume(event) {
    const { name, resume } = event.currentTarget.dataset;
    wx.showModal({
      title: name + ' 老师的简历',
      content: util.plain(resume) === '' ? '这位老师没有写简历。' : resume,
      showCancel: false
    });
  },

  // 点老师名字 → 老师资料页（二级页里再看一层）
  onOpenTeacher(event) {
    const teacherId = Number(event.currentTarget.dataset.teacherId);
    if (!(teacherId > 0)) return;
    wx.navigateTo({ url: '/pages/teacherDetail/teacherDetail?id=' + teacherId });
  },

  // ---------- ③ 合同收款（这里只看，发合同 / 确认收款在工作台待办里）----------

  onCopyContract(event) {
    const url = event.currentTarget.dataset.url;
    if (util.plain(url) === '') return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '合同链接已复制', icon: 'none' })
    });
  },

  // ---------- ④ 修正 ----------

  onFixPostPick(event) {
    this.setData({ fixPostIndex: Number(event.detail.value) || 0 });
  },

  onFixBookingPick(event) {
    const index = Number(event.currentTarget.dataset.index);
    const bookings = this.data.bookings.slice();
    if (!bookings[index]) return;
    bookings[index].statusIndex = Number(event.detail.value) || 0;
    this.setData({ bookings });
  },

  onFixTeacherPick(event) {
    this.setData({ fixTeacherIndex: Number(event.detail.value) || 0 });
  },

  onFixRecordStatusPick(event) {
    this.setData({ fixRecordStatusIndex: Number(event.detail.value) || 0 });
  },

  onFixRecordPriceInput(event) {
    this.setData({ fixRecordPrice: event.detail.value });
  },

  onToggleNotify(event) {
    this.setData({ notify: !!event.detail.value });
  },

  async onFixSavePost() {
    const status = this.data.fixPostOptions[this.data.fixPostIndex];
    const data = await store.correctPost(this.data.postId, {
      action: 'status', status, notify: this.data.notify
    });
    if (!data) {
      wx.showModal({ title: '改不了', content: store.lastError, showCancel: false });
      return;
    }
    wx.showToast({ title: '状态已改成 ' + status, icon: 'none' });
    this.refresh();
  },

  async onFixSaveBooking(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.bookings[index];
    if (!item) return;
    const status = this.data.fixBookingOptions[item.statusIndex];
    const data = await store.correctBooking(item.id, { status, notify: this.data.notify });
    if (!data) {
      wx.showModal({ title: '改不了', content: store.lastError, showCancel: false });
      return;
    }
    wx.showToast({ title: '订单已改成 ' + status, icon: 'none' });
    this.refresh();
  },

  async onFixRecord() {
    const teacher = this.data.fixTeachers[this.data.fixTeacherIndex];
    if (!teacher) {
      wx.showModal({
        title: '先选一位老师',
        content: '补录要把这条单记在某位老师名下，这条单还没有老师投过简历。',
        showCancel: false
      });
      return;
    }
    const status = this.data.fixRecordStatusOptions[this.data.fixRecordStatusIndex];
    const data = await store.correctPost(this.data.postId, {
      action: 'record',
      teacherId: teacher.id,
      price: this.data.fixRecordPrice,
      status,
      notify: this.data.notify
    });
    if (!data) {
      wx.showModal({ title: '补录失败', content: store.lastError, showCancel: false });
      return;
    }
    wx.showToast({ title: '已补录给 ' + teacher.name, icon: 'none' });
    this.refresh();
  },

  onFixVoid() {
    wx.showModal({
      title: '作废这条单',
      content: '作废后这条单不再招募，还在等确认的投递会一起作废。数据不会删，历史里还能看到。',
      confirmText: '作废',
      cancelText: '再想想',
      success: async (res) => {
        if (!res.confirm) return;
        const data = await store.correctPost(this.data.postId, {
          action: 'void', notify: this.data.notify
        });
        if (!data) {
          wx.showModal({ title: '作废失败', content: store.lastError, showCancel: false });
          return;
        }
        wx.showToast({ title: '这条单已作废', icon: 'none' });
        this.refresh();
      }
    });
  }
});
