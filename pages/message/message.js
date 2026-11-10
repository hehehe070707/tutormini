/*
 * 消息页 = 统一消息中心，三块：
 *   1) 官方助手：老师 ↔ Agent 的会话（置顶，标「官方」；合同 / 通知也在这里发）
 *   2) 我的单子：老师端专属 —— 投一次简历就多一张单子卡片（标题＝单号 20261008-1）。
 *      卡片右上角是这条单子当前的状态，卡片里直接把这条单子的全部消息按时间正序铺开：
 *      状态变了只改状态那一栏，不会再多一张卡片；消息多了也只是这张卡片变长。
 *      已经结束的单子可以「隐藏」收起来，需要回看时点标题右边的「已隐藏 N 条」调出来。
 *   3) 通知：没挂单子的那些（合同 / 公告）统一收件箱，点开能看内容 / 复制合同链接
 * 卡片不用点进去：消息已经写在卡片上了（原来的「单子状态」页 pages/postThread 保留，
 * 但消息页不再挂入口）。
 * 真人聊天已整条下线，聊天入口只剩这里的「官方助手」那一行。
 * 对应 Qt 版的 MessagePage，小程序这边就是上面这三块。
 */

const store = require('../../utils/store.js');
const session = require('../../utils/session.js');
const util = require('../../utils/util.js');
const auth = require('../../utils/auth.js');

/*
 * 进行中的单子不给「隐藏」按钮：
 *   招募中 / 已成交（还没结束的单）、待平台确认 / 试课中 / 主订单进行中（订单那几种状态）
 * 其余的（已结束 / 已取消 / 未选上 / 已关闭）都是收尾的，可以藏起来。
 */
function canHideBox(status) {
  const text = util.plain(status);
  if (text === util.POST_OPEN || text === util.POST_TAKEN) return false;
  return !util.isActiveBooking(text);
}

// 卡片里的一条消息（和「通知」那一行是同一份内容，只是嵌在单子卡片里）
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

/*
 * 一张单子卡片：标题是单号（后端按「当日日期 + 当天第几个单」生成，比如 20261008-1），
 * 卡片上把这条单子的全部属性都写出来 —— 谁发的 / 科目年级 / 上课时间 / 价格 / 位置 / 说明 /
 * 对老师的要求 / 家长原话 / 发布时间，然后才是这条单子的消息。
 * 老师不用点进任何页面就能看全，和接单页那张卡片（+ 详情弹层）是同一套信息。
 */
function boxView(box, hidden) {
  const unread = Number(box.unread) || 0;
  const postId = Number(box.postId) || 0;
  const rows = (box.list || []).map(messageView);
  const requirements = box.requirements || {};
  // 老数据里这几项本来就空着：空的时候写个「—」，让老师知道是这条单没写，不是页面没显示
  const dash = (value) => (util.plain(value) === '' ? '—' : util.plain(value));
  return {
    id: postId,
    code: box.code || ('#' + postId),
    publisherName: box.publisherName || '平台',
    subject: box.subject || '',
    grade: box.grade || '',
    // 科目后面带年级，和接单列表写法一致：物理（初三）
    subjectText: (box.subject || '') + (box.grade ? '（' + box.grade + '）' : ''),
    timeText: dash(box.timeText),
    price: dash(box.price),
    area: dash(box.area),
    note: dash(box.note),
    // 「不限」也是一种要求（家长没提），不能空着不显示
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
    // 中介端才有：这条单收到几条投递、待确认几条
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
    agents: [],         // 官方助手会话
    boxes: [],          // 我的单子（老师端：投过简历的单，一条一张卡片）
    hiddenCount: 0,     // 收起来的已结束单子有几张（标题右边那个入口用）
    showHidden: false,  // 是否把隐藏的也铺出来
    notices: [],        // 没挂单子的系统通知 / 合同
    empty: ''
  },

  onLoad() {
    this.refresh = this.refresh.bind(this);
    this.stamp = '';
  },

  // tab 页会被系统缓存：每次显示才订阅 + 刷数据 + 更新底部导航
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

  // 会话 / 通知全在后端，按当前登录身份算未读
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

    /*
     * 老师端：投过简历的单子归成卡片（一条单子一张），卡片上就是这条单子的全部消息。
     * 隐藏的记忆只是本机偏好：隐藏时记下当时最后一条消息的 id，这条单子再来新消息就自动放出来，
     * 不让用户觉得"新消息被藏没了"。
     */
    // 老师端 + 中介端都是「一条单子一张卡片」，服务端按身份取自己那一列
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
      // 挂了单子的通知都在那张单子卡片里，这里不再平铺一遍
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

    /*
     * 消息已经铺在卡片上了 —— 进这一页就等于看过：把有未读的那几张卡片标已读，
     * 底部导航红点当场减。先渲染再标已读，卡片上的未读高亮留到下次刷新才变，不做来回刷。
     */
    rawBoxes.forEach((item) => {
      const unread = Number(item.unread) || 0;
      if (unread > 0) store.readMessageThread(Number(item.postId), unread);
    });
  },

  // setData 前先比一遍：内容没变就不往渲染层传
  apply(patch) {
    const stamp = JSON.stringify(patch);
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    this.setData(patch);
  },

  // 标已读后只换通知那一块（另一半是页面自己改的，不走整个 refresh）
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

  // 卡片里带合同链接的那条：点一下复制（卡片本身不用点进去，这是唯一的例外）
  onTapMessage(event) {
    const url = util.plain(event.currentTarget.dataset.url);
    if (url === '') return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '合同链接已复制', icon: 'none' })
    });
  },

  // 把一张结束的单子收起来（只是本机记一笔，后端的数据一条不动）
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

  // 标题右边那个「已隐藏 N 条」：点一下把收起来的单子铺出来 / 再收回去
  onToggleHidden() {
    this.setData({ showHidden: !this.data.showHidden });
    this.refresh();
  },

  // 打开官方助手会话
  onOpenAgent(event) {
    if (!auth.requireRole('', '')) return;
    const { id, name } = event.currentTarget.dataset;
    wx.navigateTo({
      url: '/pages/chat/chat?agent=1&peerId=' + id + '&peerName=' + encodeURIComponent(name)
    });
  },

  // 点通知：弹出内容；有合同链接就顺手给一个复制入口
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

  // 访客从这一页去登录 / 注册
  onLogin() {
    auth.requireRole('', '');
  }
});
