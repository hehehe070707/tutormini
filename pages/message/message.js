const store = require('../../utils/store.js');
const session = require('../../utils/session.js');
const util = require('../../utils/util.js');
const auth = require('../../utils/auth.js');

function canHideBox(status) {
  const text = util.plain(status);
  if (text === util.POST_OPEN || text === util.POST_TAKEN) return false;
  return !util.isActiveBooking(text);
}

function messageView(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt,
    isRead: !!row.isRead,
    contractUrl: row.contractUrl || '',
    tagText: row.kind === 'contract' ? '合同' : (row.isAgent ? '官方' : '通知')
  };
}

function boxView(box, hidden) {
  const unread = Number(box.unread) || 0;
  const postId = Number(box.postId) || 0;
  const rows = (box.list || []).map(messageView);
  const requirements = box.requirements || {};

  const dash = (value) => (util.plain(value) === '' ? '—' : util.plain(value));
  return {
    id: postId,
    code: box.code || ('#' + postId),
    publisherName: box.publisherName || '平台',
    subject: box.subject || '',
    grade: box.grade || '',

    subjectText: (box.subject || '') + (box.grade ? '（' + box.grade + '）' : ''),
    timeText: dash(box.timeText),
    price: dash(box.price),
    area: dash(box.area),
    note: dash(box.note),

    requirementText: util.requirementsText(requirements) || '不限',
    rawText: dash(box.rawText),
    createdAt: box.createdAt || '',
    statusText: box.statusText || '',
    statusClass: util.bookingStatusClass(box.status),
    canHide: canHideBox(box.status),
    hidden: !!hidden,
    unread,
    unreadText: unread > 99 ? '99+' : String(unread),
    count: rows.length,

    inviteText: Number(box.inviteCount) > 0
      ? '收到 ' + box.inviteCount + ' 条投递' +
        (Number(box.pendingCount) > 0 ? '（待你确认 ' + box.pendingCount + ' 条）' : '')
      : '',
    lastAt: box.lastAt || '',
    lastId: Number(box.lastId) || 0,
    rows
  };
}

Page({
  data: {
    guest: false,
    teacher: false,
    agents: [],
    boxes: [],
    hiddenCount: 0,
    showHidden: false,
    notices: [],
    empty: ''
  },

  onLoad() {
    this.refresh = this.refresh.bind(this);
    this.stamp = '';
  },

  onShow() {
    store.on('chatsChanged', this.refresh);
    store.on('messagesChanged', this.refresh);
    this.refresh();
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.refresh();
  },

  onHide() {
    store.off('chatsChanged', this.refresh);
    store.off('messagesChanged', this.refresh);
  },

  onUnload() {
    this.onHide();
  },

  async refresh() {
    if (!session.isLoggedIn()) {
      this.apply({
        guest: true, teacher: false, agents: [], boxes: [], hiddenCount: 0, notices: [],
        empty: '登录后这里显示官方助手和系统通知。'
      });
      return;
    }

    const teacher = session.isTeacher();
    const agents = (await store.myAgents()).map((item) => ({
      id: item.id,
      name: item.name,
      official: item.official !== false,
      displayName: (item.unread > 0 ? '● ' : '') + item.name,
      unread: item.unread,
      lastBody: item.lastBody,
      lastAt: item.lastAt
    }));

    const rawBoxes = await store.messageBoxes();
    const hides = store.hiddenBoxes();
    let hidesChanged = false;
    const views = rawBoxes.map((box) => {
      const postId = Number(box.postId) || 0;
      const stamp = Number(hides[postId]) || 0;
      if (stamp > 0 && Number(box.lastId) > stamp) {
        delete hides[postId];
        hidesChanged = true;
        return boxView(box, false);
      }
      return boxView(box, stamp > 0);
    });
    if (hidesChanged) store.saveHiddenBoxes(hides);
    const hiddenCount = views.filter((view) => view.hidden).length;
    const boxes = this.data.showHidden ? views : views.filter((view) => !view.hidden);

    const box = await store.messages();
    const notices = (box.list || [])

      .filter((item) => !(Number(item.postId) > 0))
      .map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
        isRead: item.isRead,
        contractUrl: item.contractUrl || '',
        tagText: item.kind === 'contract' ? '合同' : (item.isAgent ? '官方' : '通知'),
        fromText: item.isAgent ? (item.senderName || '官方助手') : '',
        createdAt: item.createdAt
      }));

    this.apply({
      guest: false,
      teacher,
      agents,
      boxes,
      hiddenCount,
      notices,
      empty: agents.length === 0 && boxes.length === 0 && notices.length === 0
        ? (hiddenCount > 0
          ? '消息都收起来了。点标题右边的「已隐藏 ' + hiddenCount + ' 条」能翻出来。'
          : (teacher
            ? '还没有消息。老师这边收到投递、合同、试课通知都会出现在这里。'
            : '还没有消息。老师投简历、合同、收款的消息都会挂在单子卡片上。'))
        : ''
    });

    rawBoxes.forEach((item) => {
      const unread = Number(item.unread) || 0;
      if (unread > 0) store.readMessageThread(Number(item.postId), unread);
    });
  },

  apply(patch) {
    const stamp = JSON.stringify(patch);
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    this.setData(patch);
  },

  setNotices(notices) {
    this.apply({
      guest: this.data.guest,
      teacher: this.data.teacher,
      agents: this.data.agents,
      boxes: this.data.boxes,
      hiddenCount: this.data.hiddenCount,
      notices,
      empty: this.data.empty
    });
  },

  onTapMessage(event) {
    const url = util.plain(event.currentTarget.dataset.url);
    if (url === '') return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '合同链接已复制', icon: 'none' })
    });
  },

  onHideBox(event) {
    const postId = Number(event.currentTarget.dataset.postId);
    const lastId = Number(event.currentTarget.dataset.lastId) || 0;
    if (!(postId > 0)) return;
    const hides = store.hiddenBoxes();
    hides[postId] = lastId;
    if (store.saveHiddenBoxes(hides)) {
      wx.showToast({ title: '已隐藏，可在「已隐藏」里找回', icon: 'none' });
    } else {
      wx.showModal({ title: '没藏起来', content: store.lastError, showCancel: false });
    }
    this.refresh();
  },

  onToggleHidden() {
    this.setData({ showHidden: !this.data.showHidden });
    this.refresh();
  },

  onOpenAgent(event) {
    if (!auth.requireRole('', '')) return;
    const { id, name } = event.currentTarget.dataset;
    wx.navigateTo({
      url: '/pages/chat/chat?agent=1&peerId=' + id + '&peerName=' + encodeURIComponent(name)
    });
  },

  async onOpenNotice(event) {
    const index = Number(event.currentTarget.dataset.index);
    const notice = this.data.notices[index];
    if (!notice) return;
    if (!notice.isRead) {
      store.readMessage(notice.id);
      const notices = this.data.notices.slice();
      notices[index] = Object.assign({}, notice, { isRead: true });
      this.setNotices(notices);
    }
    wx.showModal({
      title: notice.title || '通知',
      content: util.plain(notice.body) === '' ? '（没有内容）' : notice.body,
      confirmText: notice.contractUrl ? '复制合同链接' : '知道了',
      showCancel: !!notice.contractUrl,
      cancelText: '关闭',
      success: (res) => {
        if (res.confirm && notice.contractUrl) {
          wx.setClipboardData({
            data: notice.contractUrl,
            success: () => wx.showToast({ title: '链接已复制', icon: 'none' })
          });
        }
      }
    });
  },

  onLogin() {
    auth.requireRole('', '');
  }
});
