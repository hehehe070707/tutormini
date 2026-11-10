/*
 * 聊天页：老师 ↔ 官方助手（Agent）。
 *
 * 真人聊天（老师 ↔ 平台的账号）已经整条下线，页面上只剩这一条官方通道：
 * 老师从需求单 / 我的课点进来看报价、合同、试课这些事，对面是平台的虚拟助手。
 * 这条会话不受条数限制；会话记录按 (teacher_id, agent_id) 存，关掉再打开还在。
 * 打开会话就把助手发来的消息标记已读（红点消失）。
 */

const store = require('../../utils/store.js');
const session = require('../../utils/session.js');

const NEUTRAL_TIP = '这里是平台官方助手：报名、合同、试课的事都能直接问。';

Page({
  data: {
    agentId: -1,
    peerName: '',
    messages: [],
    input: '',
    scrollInto: '',
    navTitle: '',
    tip: NEUTRAL_TIP,
    canSend: true,
    lastId: 0
  },

  onLoad(options) {
    this.setData({
      agentId: Number(options.peerId),
      peerName: decodeURIComponent(options.peerName || '平台助手')
    });
    this.refresh = this.refresh.bind(this);
  },

  onShow() {
    store.on('chatsChanged', this.refresh);
    this.refresh();
  },

  onHide() {
    store.off('chatsChanged', this.refresh);
  },

  onUnload() {
    this.onHide();
  },

  // 会话记录存在后端（换设备打开同一段聊天，消息还在）
  async refresh() {
    const agentId = this.data.agentId;
    if (!session.isLoggedIn() || !(agentId >= 0)) return;

    // 一次请求拿回消息 + 未读；有未读才去标已读，不做"标已读 → 又刷新"的来回
    const chat = await store.agentChatSession(agentId);
    // 带上未读条数：数据层会先把底部导航的红点减掉，不用等切到别的页面
    if (chat.unread > 0) store.markAgentChatRead(agentId, chat.unread);

    const messages = (chat.list || []).map((message) => ({
      id: message.id,
      mine: !message.fromAgent,
      body: message.body,
      createdAt: message.createdAt
    }));

    const name = (chat.agent && chat.agent.name) || this.data.peerName || '平台助手';
    const title = '和 ' + name + ' 聊天';
    if (this.data.navTitle !== title) {
      this.setData({ navTitle: title });
      wx.setNavigationBarTitle({ title });
    }

    // setData 前先比一遍：没变就不往渲染层传
    const patch = {};
    if (this.data.canSend !== true) patch.canSend = true;
    if (this.data.tip !== NEUTRAL_TIP) patch.tip = NEUTRAL_TIP;
    const lastId = messages.length > 0 ? messages[messages.length - 1].id : 0;
    if (lastId !== this.data.lastId || messages.length !== this.data.messages.length) {
      patch.messages = messages;
      patch.lastId = lastId;
      patch.scrollInto = lastId > 0 ? 'msg-' + lastId : '';
    }
    if (Object.keys(patch).length > 0) this.setData(patch);
  },

  onInput(event) {
    this.setData({ input: event.detail.value });
  },

  async onSend() {
    const text = String(this.data.input).trim();
    if (text === '') return;
    if (!(await store.sendAgentChatMessage(this.data.agentId, text))) {
      wx.showModal({ title: '发送失败', content: store.lastError, showCancel: false });
      this.refresh();
      return;
    }
    this.setData({ input: '' });
    this.refresh();
  }
});
