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
