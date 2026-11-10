/*
 * 中介工作台（小程序特有，Qt 版没有）：中介端底部第一格。
 *
 * 定位：这一页只装"今天要动手的事"，别的一概不放（家长不在小程序里，投递的简历是中介
 * 拿去微信发给家长的）：
 *   ① 发单入口：只有【批量发单】（pages/postBatch）—— 单条发布已经被它覆盖，不再单独开一个入口；
 *   ② 待办：待交付（复制简历合集发家长 →【已发家长】）
 *           待定老师（家长点头 →【确认接单】/【换一位老师】）
 *           待发合同（发合同 + 收款码）  待收款（老师已付款 → 确认到账）
 *   待办排序：按「这条单还挂着几个没处理的投递」从多到少（投的越多越靠前），
 *             不再按发布时间；只要还有没处理的投递，这条单一定在待办里。
 * 另外两块在各自的格子里，这一页不重复：单子档案在【单子】tab（pages/myPosts →
 * pages/postManage），消息页只服务老师（中介端不再挂消息入口）。
 * 「已发家长」是本机记忆（utils/store.js 的 deliveredMap），投递人数变了会自动回到待交付。
 */

const store = require('../../utils/store.js');
const session = require('../../utils/session.js');
const util = require('../../utils/util.js');
const auth = require('../../utils/auth.js');
const postTexts = require('../../utils/postText.js');

Page({
  data: {
    guest: false,
    teacher: false,
    tip: '',
    todo: [],
    todoEmpty: '',
    todoPosts: 0       // 还有没处理投递的单子数（工作台那格的红点数字，按单子算不按投递算）
  },

  onLoad() {
    this.refresh = this.refresh.bind(this);
    this.seq = 0;
  },

  // tab 页会被系统缓存：每次显示才订阅 + 刷数据 + 更新底部导航
  onShow() {
    store.on('postsChanged', this.refresh);
    store.on('bookingsChanged', this.refresh);
    this.refresh();
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.refresh();
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
    wx.setNavigationBarTitle({ title: '🧰 工作台' });

    if (!session.isLoggedIn()) {
      this.setData({
        guest: true, teacher: false, tip: '登录中介账号后，这里显示待办和你的单子。',
        todo: [], todoEmpty: '', todoPosts: 0
      });
      store.setTodoPosts(0);
      return;
    }
    // 老师端没有工作台（底部导航也不给）：万一手滑进来，给一句指路
    if (session.isTeacher()) {
      this.setData({
        guest: false, teacher: true, tip: '老师端没有工作台：接单、投递、我的课都在【接单】页。',
        todo: [], todoEmpty: '', todoPosts: 0
      });
      store.setTodoPosts(0);
      return;
    }

    const posts = await store.myPosts();
    const bookings = await store.bookingsForStudent(session.studentId());
    const delivered = store.deliveredMap();
    let deliveredChanged = false;

    const active = posts.filter((post) => post.status !== util.POST_CLOSED);
    const todo = [];
    let todoPosts = 0;    // 还有没处理投递的单子数（同一单投 3 个老师也只算一条）
    active.forEach((post) => {
      const invites = (post.invites || []).map((invite) => ({
        bookingId: invite.bookingId,
        teacherId: invite.teacherId,
        teacherName: invite.teacherName,
        resume: invite.resume,
        status: invite.status,
        statusText: invite.statusText || util.bookingStatusText(invite.status),
        pending: invite.status === util.STATUS_PENDING
      }));
      const pending = invites.filter((invite) => invite.pending);
      if (pending.length > 0) todoPosts++;
      /*
       * 「已发家长」记在本机：发之前是【待交付】，发之后变成【待定老师】。
       * 投递人数和当时记的不一样了（又有新简历）就自动回到【待交付】，不会漏。
       */
      if ((Number(delivered[post.id]) || 0) > 0 && pending.length !== Number(delivered[post.id])) {
        delete delivered[post.id];
        deliveredChanged = true;
      }
      const sent = (Number(delivered[post.id]) || 0) > 0;
      const codeText = post.code || ('#' + post.id);

      // 只要还有没处理的投递，这条单一定在待办里（不看发布时间 / 单子状态）
      if (pending.length > 0 && !sent) {
        todo.push({
          kind: 'deliver',
          postId: post.id,
          bookingId: 0,
          count: pending.length,
          dot: true,
          title: codeText + ' ' + post.subject + '：' + pending.length + ' 位老师投了简历',
          sub: '把简历合集复制到微信发给家长，发完点【已发家长】',
          bundle: postTexts.inviteBundle(post, invites)
        });
      }
      if (pending.length > 0 && sent) {
        pending.forEach((invite) => {
          todo.push({
            kind: 'pick',
            postId: post.id,
            bookingId: invite.bookingId,
            teacherId: invite.teacherId,
            teacherName: invite.teacherName,
            resume: invite.resume,
            timeText: post.timeText,
            count: pending.length,
            dot: true,
            title: invite.teacherName + ' 老师（' + codeText + ' ' + post.subject + '）',
            sub: '已经发给家长了，家长点头后点【确认接单】；不要的【换一位老师】'
          });
        });
      }
    });

    /*
     * 定了老师之后的钱：还没发合同 / 收款码 → 【待发合同】；老师点了「我已付款」→ 【待收款】。
     * 课次确认那一套不在这里（家长不在小程序里，中介问完家长在单子管理页用【修正】改状态）。
     */
    bookings.forEach((booking) => {
      if (!util.isActiveBooking(booking.status)) return;
      if (booking.status === util.STATUS_PENDING) return;   // 还没定老师，在【待定老师】里
      const charge = (booking.payStats || {}).charge || null;
      const post = posts.find((item) => item.id === booking.postId) || {};
      const codeText = post.code || ('#' + booking.postId);
      if (!charge) {
        todo.push({
          kind: 'contract',
          postId: booking.postId,
          bookingId: booking.id,
          chargeId: 0,
          count: 0,
          teacherName: booking.teacherName,
          title: '给 ' + booking.teacherName + ' 老师发合同 / 收款码（' + codeText + '）',
          sub: '定下老师之后先收合同款，老师付了你在小程序里确认收款'
        });
      } else if (charge.status === util.PAY_CLAIMED) {
        todo.push({
          kind: 'pay',
          postId: booking.postId,
          bookingId: booking.id,
          chargeId: charge.id,
          amount: Number(charge.amount) || 0,
          count: 0,
          teacherName: booking.teacherName,
          title: booking.teacherName + ' 老师说已经付款' +
            (Number(charge.amount) > 0 ? '（' + charge.amount + ' 元）' : ''),
          sub: '核对到账后点【确认收款】'
        });
      }
    });
    /*
     * 待办顺序：先按「这条单还挂着几个没处理的投递」从多到少（投的越多越靠前），
     * 人数一样时再按 交付简历 → 定老师 → 发合同 → 收款，最后按单子 / 投递的先后稳定排。
     */
    const weight = { deliver: 1, pick: 2, contract: 3, pay: 4 };
    todo.sort((a, b) => {
      const byCount = (Number(b.count) || 0) - (Number(a.count) || 0);
      if (byCount !== 0) return byCount;
      const byKind = (weight[a.kind] || 9) - (weight[b.kind] || 9);
      if (byKind !== 0) return byKind;
      if (a.postId !== b.postId) return a.postId - b.postId;
      return (Number(a.bookingId) || 0) - (Number(b.bookingId) || 0);
    });
    if (deliveredChanged) store.saveDeliveredMap(delivered);
    if (seq !== this.seq) return;

    store.setTodoPosts(todoPosts);      // 底部导航【工作台】那格的红点当场对上
    this.setData({
      guest: false, teacher: false, tip: '',
      todo,
      todoEmpty: todo.length === 0
        ? '暂时没有待办。老师投了简历、家长定了人、该收合同款，都会出现在这里。'
        : '',
      todoPosts
    });
  },

  // ---------- 发单入口 ----------

  // ＋批量发单：唯一的发单入口（单条发布已经被批量发单覆盖）
  onBatch() {
    if (!auth.requireRole('student', 'student')) return;
    wx.navigateTo({ url: '/pages/postBatch/postBatch' });
  },

  onLogin() {
    auth.requireRole('', '');
  },

  // ---------- 待办上的动作 ----------

  // 待办①：把简历合集复制走（粘贴到微信发给家长）
  onCopyDeliver(event) {
    const item = this.data.todo[Number(event.currentTarget.dataset.index)];
    if (!item) return;
    postTexts.copyText(item.bundle, '简历合集已复制，去微信发给家长');
  },

  // 待办①：发完家长，记一笔 —— 这条单就从【待交付】挪到【待定老师】
  onMarkDelivered(event) {
    const { postId, count } = event.currentTarget.dataset;
    if (!(Number(postId) > 0)) return;
    const map = store.deliveredMap();
    map[Number(postId)] = Number(count) || 0;
    if (store.saveDeliveredMap(map)) wx.showToast({ title: '记好了：简历已发家长', icon: 'none' });
    this.refresh();
  },

  // 待办②：先看看老师投的简历
  onShowResume(event) {
    const { name, resume } = event.currentTarget.dataset;
    wx.showModal({
      title: name + ' 老师的简历',
      content: util.plain(resume) === '' ? '这位老师没有写简历。' : resume,
      showCancel: false
    });
  },

  // 待办②：家长点头 → 确认接单（单子转已成交，订单进试课中）
  onConfirmTake(event) {
    if (!auth.requireRole('student', 'student')) return;
    const { bookingId, name, timeText } = event.currentTarget.dataset;
    if (!bookingId) return;
    wx.showModal({
      title: '确认接单',
      content: '让 ' + name + ' 老师接这条单吗？\n' + timeText +
               '\n确认后这单就定下来了，别的老师就不会再被选上。',
      confirmText: '确认',
      success: async (res) => {
        if (!res.confirm) return;
        if (!(await store.acceptBooking(Number(bookingId)))) {
          wx.showModal({ title: '确认失败', content: store.lastError, showCancel: false });
          return;
        }
        wx.showToast({ title: '接单成功', icon: 'success' });
        this.refresh();
      }
    });
  },

  // 待办②：不选这位老师：撤掉这条投递，单子继续招募
  onRefuseTake(event) {
    if (!auth.requireRole('student', 'student')) return;
    const { bookingId, name } = event.currentTarget.dataset;
    if (!bookingId) return;
    wx.showModal({
      title: '换一位老师',
      content: '回绝 ' + name + ' 老师的这次投递吗？\n这条需求还开放着，别的老师还能投。',
      confirmText: '换一位',
      cancelText: '再想想',
      success: async (res) => {
        if (!res.confirm) return;
        if (!(await store.rejectBooking(Number(bookingId)))) {
          wx.showModal({ title: '操作失败', content: store.lastError, showCancel: false });
          return;
        }
        wx.showToast({ title: '已重新开放', icon: 'none' });
        this.refresh();
      }
    });
  },

  // 待办③：发合同 + 收款码（两步输入：先金额，再链接，都能留空）
  onSendContract(event) {
    if (!auth.requireRole('student', 'student')) return;
    const id = Number(event.currentTarget.dataset.bookingId);
    if (!id) return;
    wx.showModal({
      title: '合同金额',
      editable: true,
      placeholderText: '合同金额（整数元，可留空）',
      confirmText: '下一步',
      success: (first) => {
        if (!first.confirm) return;
        const amount = Number(String(first.content || '').replace(/[^0-9]/g, '')) || 0;
        wx.showModal({
          title: '合同 / 收款码链接',
          editable: true,
          placeholderText: '把合同或收款码的链接粘在这里（可留空）',
          confirmText: '发出去',
          success: async (second) => {
            if (!second.confirm) return;
            const data = await store.setContract(id, amount, second.content, '');
            if (!data) {
              wx.showModal({ title: '发送失败', content: store.lastError, showCancel: false });
              return;
            }
            wx.showToast({ title: '已发出', icon: 'success' });
            this.refresh();
          }
        });
      }
    });
  },

  // 待办④：核对到账 → 确认收款（确认后老师才能开始试课）
  onConfirmPay(event) {
    if (!auth.requireRole('student', 'student')) return;
    const { chargeId, amount, teacherName } = event.currentTarget.dataset;
    const id = Number(chargeId);
    if (!id) return;
    wx.showModal({
      title: '确认收款',
      content: '确认已经收到 ' + teacherName + ' 老师' +
        (Number(amount) > 0 ? '的 ' + amount + ' 元' : '的这笔付款') + '吗？\n确认后老师就可以开始试课了。',
      confirmText: '确认收款',
      success: async (res) => {
        if (!res.confirm) return;
        if (!(await store.confirmPayment(id))) {
          wx.showModal({ title: '操作失败', content: store.lastError, showCancel: false });
          return;
        }
        wx.showToast({ title: '已确认收款', icon: 'success' });
        this.refresh();
      }
    });
  }
});
