/*
 * 网络层：小程序端所有后端请求都从这里走（对应 Qt 版里那层数据库访问的替代品）。
 *
 * 约定：
 *   1) 前端 wx.storage 只存一枚登录令牌（session_token），别的一律不存；
 *   2) 每次请求都带上令牌，身份、权限、归属全部由后端说了算（本地缓存被改也没用）；
 *   3) 后端返回 { code, message, data }：code=0 成功，失败时 message 直接当 store.lastError 用；
 *   4) 401（令牌失效/过期）→ 立刻清掉本地令牌并通知上层回到访客状态。
 */

const config = require('./config.js');

const TOKEN_KEY = 'session_token';   // 前端唯一的业务外存储：登录令牌

let lastError = '';
const unauthorizedListeners = [];

/*
 * 后端连不上时的"冷静期"：首次连接失败后 5 秒内不再重复发请求。
 * 目的：冷启动时首页/科目等好几个请求会一起失败，控制台刷一串红字反而看不清原因
 * （真正的原因只需要看第一条）。探活接口（/health）用 force: true 绕过冷静期，
 * 所以"重试"按钮随时有效。
 */
let downUntil = 0;
let downMessage = '';
let lastBaseIndex = 0;   // 上一次连通的那个地址（模拟器 127.0.0.1 / 真机局域网，自动切换）

function token() {
  try {
    const value = wx.getStorageSync(TOKEN_KEY);
    return value === null || value === undefined ? '' : String(value);
  } catch (e) {
    return '';
  }
}

function setToken(value) {
  try {
    wx.setStorageSync(TOKEN_KEY, String(value || ''));
  } catch (e) {
    lastError = '登录令牌没能存下来，下次打开需要重新登录。';
  }
}

function clearToken() {
  try {
    wx.removeStorageSync(TOKEN_KEY);
  } catch (e) {
    // 清不掉也不影响这次会话
  }
}

// 令牌失效时通知上层（app.js 用它把身份切回访客）
function onUnauthorized(fn) {
  if (unauthorizedListeners.indexOf(fn) < 0) unauthorizedListeners.push(fn);
}

function notifyUnauthorized() {
  unauthorizedListeners.slice().forEach((fn) => {
    try { fn(); } catch (e) { /* 回调出错不影响请求层 */ }
  });
}

function makeError(message, status) {
  const error = new Error(message);
  error.status = status || 0;
  return error;
}

/*
 * request(method, path, { data, body })
 *   path 以 / 开头（例如 '/teachers'），会自动拼上 apiBase；
 *   GET 用 data（wx.request 会自己拼成 query），POST/PUT 用 body（JSON）。
 */
function request(method, path, options) {
  const opts = options || {};
  if (!opts.force && Date.now() < downUntil) {
    return Promise.reject(makeError(downMessage, 0));
  }
  const bases = config.apiBases();
  // 模拟器用 127.0.0.1、手机真机用局域网地址：都不用手动改，连不上就自动换下一个
  let baseIndex = opts.force ? 0 : lastBaseIndex;
  if (baseIndex >= bases.length) baseIndex = 0;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const base = bases[baseIndex];
      const header = { 'Content-Type': 'application/json' };
      const current = token();
      if (current !== '') header['X-Token'] = current;

      wx.request({
        url: base + path,
        method,
        header,
        data: opts.body || opts.data || undefined,
        timeout: 15000,
        success: (res) => {
          downUntil = 0;
          lastBaseIndex = baseIndex;
          const body = res && res.data && typeof res.data === 'object' ? res.data : {};
          if (res.statusCode === 200 && body.code === 0) {
            resolve(body.data === undefined ? {} : body.data);
            return;
          }
          if (res.statusCode === 401) {
            clearToken();
            notifyUnauthorized();
          }
          const message = body.message || ('请求失败（HTTP ' + res.statusCode + '）');
          lastError = message;
          reject(makeError(message, res.statusCode));
        },
        fail: (err) => {
          // 这个地址不通就换下一个（模拟器 ↔ 手机真机自动切换）
          if (baseIndex + 1 < bases.length) {
            baseIndex++;
            attempt();
            return;
          }
          const detail = err && err.errMsg ? '（' + err.errMsg + '）' : '';
          const message = '连不上后端服务 ' + bases.join(' 、 ') + detail +
            '。请先启动后端：双击项目根目录的「启动后端.cmd」，或在 server 目录执行 node server.js。';
          lastError = message;
          downUntil = Date.now() + 5000;
          downMessage = message;
          reject(makeError(message, 0));
        }
      });
    };
    attempt();
  });
}

const api = {
  TOKEN_KEY,
  token,
  setToken,
  clearToken,
  onUnauthorized,
  get lastError() { return lastError; },
  // force = true 的请求不受"冷静期"影响（探活用）
  get(url, data, force) { return request('GET', url, { data, force }); },
  post(url, body) { return request('POST', url, { body }); },
  put(url, body) { return request('PUT', url, { body }); }
};

module.exports = api;
