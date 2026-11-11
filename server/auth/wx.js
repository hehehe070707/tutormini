const util = require('../lib/util.js');
const { ApiError } = require('../lib/errors.js');

function configured(config) {
  return !!(config && config.wechat && config.wechat.appid && config.wechat.secret);
}

async function codeToOpenid(config, code) {
  const text = util.plain(code);
  if (text === '') return '';
  if (!configured(config)) return '';

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
