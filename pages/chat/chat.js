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

  async refresh() {
    const agentId = this.data.agentId;
    if (!session.isLoggedIn() || !(agentId >= 0)) return;

    const chat = await store.agentChatSession(agentId);

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
