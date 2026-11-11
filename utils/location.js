const util = require('./util.js');

const FRESH_MS = 10 * 60 * 1000;

let lastError = '';
let mine = null;
const listeners = [];

function current() {
  return mine ? util.clone(mine) : null;
}

function notify() {
  listeners.slice().forEach((fn) => {
    try {
      fn(current());
    } catch (e) {

    }
  });
}

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

function watch(fn) {
  if (listeners.indexOf(fn) < 0) listeners.push(fn);
}

function unwatch(fn) {
  const index = listeners.indexOf(fn);
  if (index >= 0) listeners.splice(index, 1);
}

function openSetting() {
  wx.openSetting({
    success: () => {

      locate(() => {}, null, true);
    }
  });
}

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

function locate(onDone, onFailed, interactive) {
  lastError = '';
  if (typeof wx === 'undefined' || typeof wx.getLocation !== 'function') {
    lastError = '当前微信版本不支持自动定位。';
    if (onFailed) onFailed(lastError);
    return;
  }

  wx.getLocation({
    type: 'gcj02',
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

function autoLocate(onDone) {
  const cached = current();
  if (cached && Date.now() - cached.updatedAt < FRESH_MS) {
    if (onDone) onDone(cached);
    return;
  }
  locate(onDone, null, false);
}

function requestNow(onDone) {
  locate(onDone, null, true);
}

function supported() {
  return typeof wx !== 'undefined' && typeof wx.chooseLocation === 'function';
}

function joinAddress(name, address) {
  const place = util.plain(name);
  const detail = util.plain(address);
  if (place === '') return detail;
  if (detail === '' || detail === place) return place;
  return place + '（' + detail + '）';
}

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
