// 小程序入口：等价于 Qt 版的 main.cpp
// 1) 探一下后端通不通（业务数据全在后端，前端只存登录令牌）
// 2) 有令牌就用它向后端换身份（后端说了算）；没有就试 wx.login 走 openid 自动登录
// 3) 自动定位一次（小程序特有）：列表页据此只看半径内的人和单，
//    定位参数会随请求发给后端，由后端筛（没授权就静默失败，页面会给提示）
const store = require('./utils/store.js');
const location = require('./utils/location.js');
const session = require('./utils/session.js');
const api = require('./utils/api.js');

App({
  async onLaunch() {
    // 令牌失效（过期 / 被后端清掉）时把身份切回访客，页面会自己回到"未登录"的样子
    api.onUnauthorized(() => session.logout());

    const error = await store.init();
    if (error) {
      this.askBackend(error);
      return;
    }

    // 登录状态以后端为准：令牌有效 / 微信绑定过，就自动进主界面
    await store.restoreLogin();
    if (this.landOnHome()) return;
    this.refreshCurrentPage();
    // 定位是异步的：跳页面不等人，定位回来时列表页自己会刷（location.watch）
    location.autoLocate();
  },

  /*
   * 后端连不上：告诉用户怎么办，并给一个「重试」按钮 ——
   * 把后端启动起来之后点一下就好，不用重新编译。
   */
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

  /*
   * 登录之后落在哪一页：小程序的第一页是 pages/post/post（访客看单用的入口），
   * 但中介的主界面是【工作台】，所以身份一确定就把他切过去；老师留在接单页。
   * 返回 true 表示已经切走了（调用方不用再刷当前页）。
   */
  landOnHome() {
    if (!session.isLoggedIn() || session.isTeacher()) return false;
    wx.switchTab({ url: '/pages/workbench/workbench' });
    return true;
  },

  /*
   * 校验令牌要等一次网络往返，可能比页面 onShow 还晚 —— 那时页面已经按"访客"渲染过了。
   * 所以身份确定之后再让当前页刷一次（页面上的 refresh 都是幂等的），
   * 底部导航也跟着重算一次（访客和学生/老师的 Tab 不一样）。
   */
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
