const store = require('../../utils/store.js');
const session = require('../../utils/session.js');
const util = require('../../utils/util.js');

Page({
  data: {
    postId: 0,
    post: null,
    list: [],
    empty: ''
  },

  onLoad(options) {
    const postId = Number(options && options.postId);
    this.setData({ postId: postId > 0 ? postId : 0 });
    this.refresh = this.refresh.bind(this);
    this.stamp = '';
  },

  onShow() {
    store.on('messagesChanged', this.refresh);
    this.refresh();
  },

  onHide() {
    store.off('messagesChanged', this.refresh);
  },

  onUnload() {
    this.onHide();
  },

  async refresh() {
    const postId = this.data.postId;
    if (!session.isLoggedIn() || !(postId > 0)) return;

    const thread = await store.messageThread(postId);
    if (!thread.post) {
      this.apply({ post: null, list: [], empty: '这条单子找不到了。' });
      return;
    }

    const rows = thread.list || [];
    const unread = rows.filter((row) => !row.isRead).length;
    const list = rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      createdAt: row.createdAt,
      contractUrl: row.contractUrl || '',
      tagText: row.kind === 'contract' ? '合同' : (row.isAgent ? '官方' : '通知')
    }));
    const post = thread.post;
    this.apply({
      post: {
        code: post.code,
        subject: post.subject,
        timeText: post.timeText,
        price: util.plain(post.price),
        statusText: post.statusText,
        statusClass: util.bookingStatusClass(post.status)
      },
      list,
      empty: list.length > 0 ? '' : '这条单子还没有新的动静。'
    });

    const title = '单子 ' + post.code;
    if (this.data.navTitle !== title) {
      this.setData({ navTitle: title });
      wx.setNavigationBarTitle({ title });
    }

    if (unread > 0) store.readMessageThread(postId, unread);
  },

  apply(patch) {
    const stamp = JSON.stringify(patch);
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    this.setData(patch);
  },

  onTapMessage(event) {
    const url = util.plain(event.currentTarget.dataset.url);
    if (url === '') return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '合同链接已复制', icon: 'none' })
    });
  }
});
