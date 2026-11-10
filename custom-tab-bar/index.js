/*
 * 底部导航（小程序自定义 tabBar）。
 * 用系统的 tab 页 + wx.switchTab 切页：tab 页会被缓存常驻，切页只是显示/隐藏，
 * 不再像之前那样 reLaunch 重建整个页面（这就是之前"切页卡顿"的主因）。
 *
 * 中介端（登录身份是「学生」）：工作台 / 单子 / 我的 —— 三格，一个功能只占一格：
 *   工作台（pages/workbench）= 只装"今天要动手的事"（待办）+ 发单入口；
 *   单子（pages/myPosts）= 全部单子的档案，点一条进三级页 pages/postManage 看详情 / 修正；
 *   中介端没有消息页（单子状态在【单子】里就能看全，不再有第二份通知）。
 *   工作台那格的红点＝还有几条单子挂着没处理的投递（按单子数算，不按投递条数）；
 *   消息那格的红点＝未读消息条数（只有老师 / 访客端有这一格）。
 * 老师端：接单（同一个发单页，按身份渲染成接单） / 消息 / 我的
 * 访客：  单子（只看得到单，动手时选身份） / 我的
 */

const session = require('../utils/session.js');
const store = require('../utils/store.js');

const ITEMS = {
  post: { key: 'post', label: '📢\n发单', url: '/pages/post/post' },
  take: { key: 'post', label: '📋\n接单', url: '/pages/post/post' },
  browse: { key: 'post', label: '📢\n单子', url: '/pages/post/post' },
  workbench: { key: 'workbench', label: '🧰\n工作台', url: '/pages/workbench/workbench' },
  posts: { key: 'posts', label: '📋\n单子', url: '/pages/myPosts/myPosts' },
  message: { key: 'message', label: '💬\n消息', url: '/pages/message/message' },
  profile: { key: 'profile', label: '👤\n我的', url: '/pages/profile/profile' }
};

Component({
  data: {
    items: [],
    selected: -1,
    unread: 0,
    unreadText: '',
    todo: 0,
    todoText: ''
  },

  lifetimes: {
    attached() {
      /*
       * 红点要"读完当场就少"：组件自己订阅数据层事件，用户点开一条未读（通知 / 单子卡片 /
       * 官方助手会话）时立刻重画，不用等切到别的页面再刷新。
       * tab 页是被缓存常驻的，所以 detach 时要退订，免得实例销毁后还被回调。
       */
      this.refresh = this.refresh.bind(this);
      this.onUnread = this.onUnread.bind(this);
      store.on('unreadChanged', this.onUnread);
      store.on('messagesChanged', this.refresh);
      store.on('chatsChanged', this.refresh);
      this.refresh();
    },
    detached() {
      store.off('unreadChanged', this.onUnread);
      store.off('messagesChanged', this.refresh);
      store.off('chatsChanged', this.refresh);
    }
  },

  methods: {
    // 数据层已经把本地未读数改好了：先不发请求，把红点直接改过来
    onUnread() {
      const unread = store.unreadChatCountCached();
      const todo = store.todoPostCountCached();
      if (unread === this.data.unread && todo === this.data.todo) return;
      this.setData({
        unread, unreadText: unread > 99 ? '99+' : String(unread),
        todo, todoText: todo > 99 ? '99+' : String(todo)
      });
    },

    // 页面 onShow 里调，保证身份、红点、当前高亮都是最新的
    async refresh() {
      const teacher = session.isTeacher();
      let keys;
      if (!session.isLoggedIn()) {
        keys = ['browse', 'profile'];              // 访客：能看单，不能动手
      } else if (teacher) {
        keys = ['take', 'message', 'profile'];     // 老师只能接单，没有课程页
      } else {
        keys = ['workbench', 'posts', 'profile'];  // 中介：工作台（做）/ 单子（查）/ 我的
      }
      const items = keys.map((key) => ITEMS[key]);

      // 当前页高亮：拿页面栈里最后一个页面的路径来匹配
      const pages = getCurrentPages();
      const route = pages.length > 0 && pages[pages.length - 1].route ? pages[pages.length - 1].route : '';
      const current = route ? '/' + route : '';
      let selected = -1;
      items.forEach((item, index) => {
        if (item.url === current) selected = index;
      });

      this.setData({ items, selected });

      // 未读数是后端算的（跨设备一致）；没有未读就不碰红点，省一次 setData
      const unread = session.isLoggedIn() ? await store.unreadChatCount() : 0;
      // 中介端【工作台】那格的待办红点跟着这次请求一起回来（老师 / 访客端是 0）
      const todo = session.isLoggedIn() && !teacher ? store.todoPostCountCached() : 0;
      if (unread !== this.data.unread || todo !== this.data.todo) {
        this.setData({
          unread,
          unreadText: unread > 99 ? '99+' : String(unread),
          todo,
          todoText: todo > 99 ? '99+' : String(todo)
        });
      }
    },

    onTapTab(event) {
      const url = event.currentTarget.dataset.url;
      const index = Number(event.currentTarget.dataset.index);
      if (!url || index === this.data.selected) return;
      this.setData({ selected: index });   // 先反馈，再切页
      wx.switchTab({ url });
    }
  }
});
