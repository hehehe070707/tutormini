const store = require('../../utils/store.js');
const session = require('../../utils/session.js');
const util = require('../../utils/util.js');
const auth = require('../../utils/auth.js');

function groupTitle(status) {
  if (status === util.POST_OPEN) return '招募中';
  if (status === util.POST_TAKEN) return '已成交';
  if (status === util.POST_CLOSED) return '已关闭';
  return util.plain(status) || '其它';
}

Page({
  data: {
    guest: false,
    teacher: false,
    tip: '',
    sections: [],
    total: 0
  },

  onLoad() {
    this.refresh = this.refresh.bind(this);
    this.seq = 0;
  },

  onShow() {
    store.on('postsChanged', this.refresh);
    this.refresh();
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.refresh();
  },

  onHide() {
    store.off('postsChanged', this.refresh);
  },

  onUnload() {
    this.onHide();
  },

  async refresh() {
    const seq = ++this.seq;
    wx.setNavigationBarTitle({ title: '📋 我的单子' });

    if (!session.isLoggedIn()) {
      this.setData({ guest: true, teacher: false, tip: '登录中介账号后，这里是你发过的单。', sections: [], total: 0 });
      return;
    }
    if (session.isTeacher()) {
      this.setData({
        guest: false, teacher: true,
        tip: '老师端没有这一页：你投递过的单在【消息】页的单子卡片里。',
        sections: [], total: 0
      });
      return;
    }

    const posts = await store.myPosts();
    const groups = {};
    posts.forEach((post) => {
      const status = util.plain(post.status);
      if (!groups[status]) {
        groups[status] = { status, title: groupTitle(status), items: [] };
      }
      const invites = (post.invites || []).filter((invite) => invite.status !== util.STATUS_CANCELLED);
      const pending = invites.filter((invite) => invite.status === util.STATUS_PENDING);
      groups[status].items.push({
        id: post.id,
        code: post.code || ('#' + post.id),
        subjectText: post.subject + (util.plain(post.grade) === '' ? '' : '（' + post.grade + '）'),
        timeText: post.timeText,
        price: util.plain(post.price) === '' ? '价格未填写' : post.price,
        dot: pending.length > 0,
        inviteText: invites.length === 0
          ? '还没有老师投递'
          : '收到 ' + invites.length + ' 条投递' +
            (pending.length > 0 ? '（待你确认 ' + pending.length + ' 条）' : '')
      });
    });

    const order = [util.POST_OPEN, util.POST_TAKEN, util.POST_CLOSED];
    const sections = Object.keys(groups).map((key) => groups[key]).sort((a, b) => {
      const left = order.indexOf(a.status);
      const right = order.indexOf(b.status);
      return (left < 0 ? 2 : left) - (right < 0 ? 2 : right);
    });
    if (seq !== this.seq) return;

    this.setData({
      guest: false, teacher: false, tip: '',
      sections,
      total: posts.length
    });
  },

  onOpenManage(event) {
    const postId = Number(event.currentTarget.dataset.postId);
    if (!(postId > 0)) return;
    wx.navigateTo({ url: '/pages/postManage/postManage?postId=' + postId });
  },

  onLogin() {
    auth.requireRole('', '');
  }
});
