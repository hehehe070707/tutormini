const store = require('./utils/store.js');
const location = require('./utils/location.js');
const session = require('./utils/session.js');
const api = require('./utils/api.js');

App({
  async onLaunch() {

    api.onUnauthorized(() => session.logout());

    const error = await store.init();
    if (error) {
      this.askBackend(error);
      return;
    }

    await store.restoreLogin();
    if (this.landOnHome()) return;
    this.refreshCurrentPage();

    location.autoLocate();
  },

  askBackend(message) {
    wx.showModal({
      title: '连不上后端',
      content: message,
      confirmText: '重试',
      cancelText: '先浏览',
      success: async (res) => {
        if (!res.confirm) return;
        const error = await store.init();
        if (error) {
          this.askBackend(error);
          return;
        }
        await store.restoreLogin();
        if (this.landOnHome()) return;
        this.refreshCurrentPage();
        location.autoLocate();
        wx.showToast({ title: '后端已连上', icon: 'success' });
      }
    });
  },

  landOnHome() {
    if (!session.isLoggedIn() || session.isTeacher()) return false;
    wx.switchTab({ url: '/pages/workbench/workbench' });
    return true;
  },

  refreshCurrentPage() {
    const pages = getCurrentPages();
    const current = pages.length > 0 ? pages[pages.length - 1] : null;
    if (!current) return;
    if (typeof current.refresh === 'function') current.refresh();
    const tabBar = typeof current.getTabBar === 'function' ? current.getTabBar() : null;
    if (tabBar && typeof tabBar.refresh === 'function') tabBar.refresh();
  },

  globalData: {}
});
