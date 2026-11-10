/*
 * 业务错误：数据层校验失败时抛出，HTTP 层统一转成 { code: 1, message } ——
 * message 就是小程序端原来的 store.lastError 文案，前端弹窗文案完全不用改。
 */

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status || 400;
  }
}

function badRequest(message) {
  return new ApiError(message, 400);
}

function unauthorized(message) {
  return new ApiError(message || '登录状态已失效，请重新登录。', 401);
}

function forbidden(message) {
  return new ApiError(message || '没有权限做这个操作。', 403);
}

module.exports = { ApiError, badRequest, unauthorized, forbidden };
