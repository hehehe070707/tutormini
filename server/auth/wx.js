/*
 * 微信登录：小程序端 wx.login 拿到的 code → 后端换 openid（对应微信官方 jscode2session）。
 *
 * 行业标准流程：
 *   小程序 wx.login → code → 后端用 appid+secret 换 openid → 查 wx_bindings 找到账号 → 发 token
 * 本地开发没配 WX_APPID / WX_SECRET 时，不去调微信接口，直接告诉前端"这次没法自动登录"，
 * 前端就退回「姓名 + 密码」登录（登录成功照样会把 openid 绑上，上线后同一台微信就能自动登录）。
 */

const util = require('../lib/util.js');
const { ApiError } = require('../lib/errors.js');

function configured(config) {
  return !!(config && config.wechat && config.wechat.appid && config.wechat.secret);
}

// 返回 openid；拿不到返回 ''
async function codeToOpenid(config, code) {
  const text = util.plain(code);
  if (text === '') return '';
  if (!configured(config)) return '';      // 本地开发：不接微信，走账号密码

  const api = 'https://api.weixin.qq.com/sns/jscode2session' +
    '?appid=' + encodeURIComponent(config.wechat.appid) +
    '&secret=' + encodeURIComponent(config.wechat.secret) +
    '&js_code=' + encodeURIComponent(text) +
    '&grant_type=authorization_code';

  let payload;
  try {
    const response = await fetch(api);
    payload = await response.json();
  } catch (e) {
    throw new ApiError('连接微信服务器失败，请稍后再试。', 502);
  }

  if (!payload || payload.errcode) {
    const code2 = payload && payload.errcode ? payload.errcode : '';
    const message = payload && payload.errmsg ? payload.errmsg : '未知错误';
    throw new ApiError('微信登录失败（' + code2 + ' ' + message + '）。', 400);
  }
  return util.plain(payload.openid);
}

module.exports = { configured, codeToOpenid };
