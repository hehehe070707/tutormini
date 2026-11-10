/*
 * 权限辅助（小程序特有）：浏览不需要登录，只有发布 / 接单（投递简历）/ 确认接单 /
 * 官方助手会话这些真需要身份的动作才让用户选账号。
 *
 * 用法： if (!auth.requireRole('student', 'student')) return;
 * 没登录 → 跳登录页选身份，登录完自动回到当前页继续做；
 * 登错身份（比如老师账号去预约）→ 问一句要不要切身份。
 */

const session = require('./session.js');

function toLogin(intent, force) {
  wx.navigateTo({
    url: '/pages/login/login?intent=' + (intent || '') + (force ? '&force=1' : '')
  });
}

function switchRole(role) {
  const current = session.roleName();
  const need = role === 'teacher' ? '老师' : '学生';
  wx.showModal({
    title: '身份不符',
    content: '当前登录的是' + current + '账号，这个操作需要' + need + '账号。要切换身份吗？',
    confirmText: '切换',
    success: (res) => {
      if (res.confirm) toLogin(role, true);
    }
  });
}

// role 传 '' 表示任意身份都行；intent 只是给登录页一句提示
function requireRole(role, intent) {
  if (session.isLoggedIn()) {
    if (role === 'student' && !session.isStudent()) {
      switchRole('student');
      return false;
    }
    if (role === 'teacher' && !session.isTeacher()) {
      switchRole('teacher');
      return false;
    }
    return true;
  }
  toLogin(intent || role, false);
  return false;
}

module.exports = { requireRole };
