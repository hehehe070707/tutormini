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
    todoPosts: 0
  },

  onLoad() {
    this.refresh = this.refresh.bind(this);
    this.seq = 0;
  },

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
    let todoPosts = 0;
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

      if ((Number(delivered[post.id]) || 0) > 0 && pending.length !== Number(delivered[post.id])) {
        delete delivered[post.id];
        deliveredChanged = true;
      }
      const sent = (Number(delivered[post.id]) || 0) > 0;
      const codeText = post.code || ('#' + post.id);

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

    bookings.forEach((booking) => {
      if (!util.isActiveBooking(booking.status)) return;
      if (booking.status === util.STATUS_PENDING) return;
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

    store.setTodoPosts(todoPosts);
    this.setData({
      guest: false, teacher: false, tip: '',
      todo,
      todoEmpty: todo.length === 0
        ? '暂时没有待办。老师投了简历、家长定了人、该收合同款，都会出现在这里。'
        : '',
      todoPosts
    });
  },

  onBatch() {
    if (!auth.requireRole('student', 'student')) return;
    wx.navigateTo({ url: '/pages/postBatch/postBatch' });
  },

  onLogin() {
    auth.requireRole('', '');
  },

  onCopyDeliver(event) {
    const item = this.data.todo[Number(event.currentTarget.dataset.index)];
    if (!item) return;
    postTexts.copyText(item.bundle, '简历合集已复制，去微信发给家长');
  },

  onMarkDelivered(event) {
    const { postId, count } = event.currentTarget.dataset;
    if (!(Number(postId) > 0)) return;
    const map = store.deliveredMap();
    map[Number(postId)] = Number(count) || 0;
    if (store.saveDeliveredMap(map)) wx.showToast({ title: '记好了：简历已发家长', icon: 'none' });
    this.refresh();
  },

  onShowResume(event) {
    const { name, resume } = event.currentTarget.dataset;
    wx.showModal({
      title: name + ' 老师的简历',
      content: util.plain(resume) === '' ? '这位老师没有写简历。' : resume,
      showCancel: false
    });
  },

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
