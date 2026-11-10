/*
 * 单子卡片详情（老师端）：点消息页里的「我的单子」那张卡片进来，看这条单子走到哪一步了。
 *
 * 数据就是这条单子（messages.post_id）下发给这位老师的全部通知，按时间正序排，
 * 像一段聊天记录；上面一块是单号 + 科目 + 上课时间 + 当前状态。
 * 进这一页就算看过了：把这条单子的未读全部标已读，底部导航红点当场减掉。
 * 对应 Qt 版没有这个页（小程序特有的「投简历之后生成一张单子卡片」）。
 */

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

    // 先渲染再标已读：不出现"标已读 → 又刷新"的来回
    if (unread > 0) store.readMessageThread(postId, unread);
  },

  // setData 前先比一遍：内容没变就不往渲染层传
  apply(patch) {
    const stamp = JSON.stringify(patch);
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    this.setData(patch);
  },

  // 通知里带合同链接的，点一下复制（和消息页那条通知一个用法）
  onTapMessage(event) {
    const url = util.plain(event.currentTarget.dataset.url);
    if (url === '') return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '合同链接已复制', icon: 'none' })
    });
  }
});
