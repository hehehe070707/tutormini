const config = require('./config.js');

const TOKEN_KEY = 'session_token';

let lastError = '';
const unauthorizedListeners = [];

let downUntil = 0;
let downMessage = '';
let lastBaseIndex = 0;

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

  }
}

function onUnauthorized(fn) {
  if (unauthorizedListeners.indexOf(fn) < 0) unauthorizedListeners.push(fn);
}

function notifyUnauthorized() {
  unauthorizedListeners.slice().forEach((fn) => {
    try { fn(); } catch (e) {  }
  });
}

function makeError(message, status) {
  const error = new Error(message);
  error.status = status || 0;
  return error;
}

function request(method, path, options) {
  const opts = options || {};
  if (!opts.force && Date.now() < downUntil) {
    return Promise.reject(makeError(downMessage, 0));
  }
  const bases = config.apiBases();

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

  get(url, data, force) { return request('GET', url, { data, force }); },
  post(url, body) { return request('POST', url, { body }); },
  put(url, body) { return request('PUT', url, { body }); }
};

module.exports = api;
