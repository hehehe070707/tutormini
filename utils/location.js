/*
 * 定位（小程序特有，Qt 版没有：那边只能手打位置、也没有"只看附近"的限制）。
 *
 * 两件事：
 * 1) 选点地图 wx.chooseLocation：填位置时打开就先定位到当前位置，直接点「完成」＝用当前位置，
 *    拖地图或搜索＝改成别的地点；选完把「名称（详细地址）」交给输入框，同时把经纬度一起带回去。
 * 2) 自动定位 wx.getLocation：登录成功 / 冷启动时静默取一次当前位置，只放在内存里，
 *    随请求发给后端，由后端按半径过滤并算出每条的直线距离。
 *
 * 注意（改造后）：定位**不写 wx.storage** —— 小程序端只留一枚登录令牌，
 * 定位、半径这些纯本机偏好都放内存，冷启动重新取一次（授权过就不会再弹窗）。
 *
 * 用法和 store 一致：没有返回值，失败原因读 location.lastError。
 * 基础库要在 app.json 里声明 permission.scope.userLocation 和
 * requiredPrivateInfos: ["getLocation", "chooseLocation"]，否则接口直接报错。
 */

const util = require('./util.js');

const FRESH_MS = 10 * 60 * 1000;     // 10 分钟内定位过就不再打扰系统定位

let lastError = '';
let mine = null;                     // 内存里也留一份：页面刷新很勤，不必每次读缓存
const listeners = [];

// ---------- 我自己的定位（只在内存里）----------

// 现在手上的定位（没有返回 null）；列表页请求列表前先拿它
function current() {
  return mine ? util.clone(mine) : null;
}

function notify() {
  listeners.slice().forEach((fn) => {
    try {
      fn(current());
    } catch (e) {
      // 页面回调出错不影响定位模块，跟 store 的信号一个处理方式
    }
  });
}

// 记一份新定位；坐标没变就不发通知（免得列表白刷）
function save(next, text) {
  if (!next || !util.hasCoords(next.latitude, next.longitude)) return false;
  const previous = current();
  const record = {
    latitude: Number(next.latitude),
    longitude: Number(next.longitude),
    updatedAt: Date.now(),
    text: util.plain(text === undefined ? (previous && previous.text) : text)
  };
  const same = previous &&
               previous.latitude === record.latitude &&
               previous.longitude === record.longitude;
  mine = record;
  if (!same) notify();
  return true;
}

// 页面订阅"定位变了"：onShow 订阅、onHide 退订，跟 store.on/off 一个套路
function watch(fn) {
  if (listeners.indexOf(fn) < 0) listeners.push(fn);
}

function unwatch(fn) {
  const index = listeners.indexOf(fn);
  if (index >= 0) listeners.splice(index, 1);
}

// 去设置页开权限：必须由用户点按钮触发，微信才允许
function openSetting() {
  wx.openSetting({
    success: () => {
      // 开完权限再试一次
      locate(() => {}, null, true);
    }
  });
}

// 没权限时引导去设置页打开（用户主动点「去设置」才跳）
function askPermission() {
  wx.showModal({
    title: '没有位置权限',
    content: '去「设置」里允许使用位置，就能按距离只显示附近的人和单。',
    confirmText: '去设置',
    cancelText: '看全部',
    success: (res) => {
      if (res.confirm) openSetting();
    }
  });
}

/*
 * locate(onDone, onFailed, interactive)
 *   interactive = false（默认）→ 静默定位，没权限只把原因交给 onFailed，不弹窗；
 *   interactive = true → 用户主动点了按钮，没权限就弹「去设置」。
 * 成功返回当前定位给 onDone。
 */
function locate(onDone, onFailed, interactive) {
  lastError = '';
  if (typeof wx === 'undefined' || typeof wx.getLocation !== 'function') {
    lastError = '当前微信版本不支持自动定位。';
    if (onFailed) onFailed(lastError);
    return;
  }

  wx.getLocation({
    type: 'gcj02',            // 和 wx.chooseLocation 同一套坐标系，距离才算得准
    success: (res) => {
      save({ latitude: res.latitude, longitude: res.longitude });
      if (onDone) onDone(current());
    },
    fail: (err) => {
      const message = String((err && err.errMsg) || '');
      if (message.indexOf('auth deny') >= 0 || message.indexOf('authorize') >= 0) {
        lastError = '没有拿到位置权限。';
        if (interactive) {
          askPermission();
          return;
        }
      } else {
        lastError = '定位失败，暂时按全部显示。';
      }
      if (onFailed) onFailed(lastError);
    }
  });
}

/*
 * 自动定位：登录成功 / 冷启动各调一次。
 * 10 分钟内刚定位过就直接用缓存，省一次系统定位；
 * 没权限就当没有定位，页面提示"按全部显示"，不硬卡住列表。
 */
function autoLocate(onDone) {
  const cached = current();
  if (cached && Date.now() - cached.updatedAt < FRESH_MS) {
    if (onDone) onDone(cached);
    return;
  }
  locate(onDone, null, false);
}

// 用户主动点「开启定位」
function requestNow(onDone) {
  locate(onDone, null, true);
}

// ---------- 选点地图 ----------

// 老版本微信 / 部分环境没有这个接口，给个准话而不是静默失败
function supported() {
  return typeof wx !== 'undefined' && typeof wx.chooseLocation === 'function';
}

// 把选点结果拼成一句给人看的位置文字：名称（详细地址）
function joinAddress(name, address) {
  const place = util.plain(name);
  const detail = util.plain(address);
  if (place === '') return detail;
  if (detail === '' || detail === place) return place;
  return place + '（' + detail + '）';
}

// 点一次「📍定位」：选到位置就把文字和经纬度交给 onPicked(text, coords)，出错交给 onFailed(原因)
function pick(onPicked, onFailed) {
  lastError = '';
  if (!supported()) {
    lastError = '当前微信版本没有选点地图，手动输入位置吧。';
    if (onFailed) onFailed(lastError);
    return;
  }

  wx.chooseLocation({
    success: (res) => {
      const text = joinAddress(res && res.name, res && res.address);
      // 选点地图自带经纬度：以后这条资料/这条单就能算出离别人多远
      const coords = { latitude: res && res.latitude, longitude: res && res.longitude };
      const picked = util.hasCoords(coords.latitude, coords.longitude);
      if (picked) save({ latitude: coords.latitude, longitude: coords.longitude }, text);

      if (text === '') {
        lastError = '没取到地址文字，手动输入位置吧。';
        if (onFailed) onFailed(lastError);
        return;
      }
      if (onPicked) onPicked(text, picked ? coords : null);
    },
    fail: (err) => {
      const message = String((err && err.errMsg) || '');
      // 用户自己取消选点也走 fail，这种不算错，不提示
      if (message.indexOf('cancel') >= 0) return;

      if (message.indexOf('auth deny') >= 0 || message.indexOf('authorize') >= 0) {
        lastError = '没有拿到位置权限。';
        askPermission();
        return;
      }
      lastError = '定位失败，手动输入位置吧。';
      if (onFailed) onFailed(lastError);
    }
  });
}

module.exports = {
  NEARBY_KM: util.NEARBY_KM,
  NEARBY_CHOICES: util.NEARBY_CHOICES,
  supported,
  pick,
  current,
  save,
  locate,
  autoLocate,
  requestNow,
  openSetting,
  askPermission,
  watch,
  unwatch,
  get lastError() { return lastError; }
};
