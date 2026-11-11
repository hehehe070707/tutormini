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

    onUnread() {
      const unread = store.unreadChatCountCached();
      const todo = store.todoPostCountCached();
      if (unread === this.data.unread && todo === this.data.todo) return;
      this.setData({
        unread, unreadText: unread > 99 ? '99+' : String(unread),
        todo, todoText: todo > 99 ? '99+' : String(todo)
      });
    },

    async refresh() {
      const teacher = session.isTeacher();
      let keys;
      if (!session.isLoggedIn()) {
        keys = ['browse', 'profile'];
      } else if (teacher) {
        keys = ['take', 'message', 'profile'];
      } else {
        keys = ['workbench', 'posts', 'profile'];
      }
      const items = keys.map((key) => ITEMS[key]);

      const pages = getCurrentPages();
      const route = pages.length > 0 && pages[pages.length - 1].route ? pages[pages.length - 1].route : '';
      const current = route ? '/' + route : '';
      let selected = -1;
      items.forEach((item, index) => {
        if (item.url === current) selected = index;
      });

      this.setData({ items, selected });

      const unread = session.isLoggedIn() ? await store.unreadChatCount() : 0;

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
      this.setData({ selected: index });
      wx.switchTab({ url });
    }
  }
});
