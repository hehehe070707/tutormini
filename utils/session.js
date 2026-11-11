const ROLE_NONE = 'none';
const ROLE_STUDENT = 'student';
const ROLE_TEACHER = 'teacher';

const state = {
  role: ROLE_NONE,
  studentId: -1,
  studentName: '',
  teacherId: -1,
  teacherName: ''
};

const session = {
  defaultStudentName() { return '张三'; },

  role() { return state.role; },
  isLoggedIn() { return state.role !== ROLE_NONE; },
  isStudent() { return state.role === ROLE_STUDENT; },
  isTeacher() { return state.role === ROLE_TEACHER; },
  hasTeacherProfile() { return state.teacherId >= 0; },

  roleName() {
    if (state.role === ROLE_STUDENT) return '学生';
    if (state.role === ROLE_TEACHER) return '老师';
    return '未登录';
  },

  studentId() { return state.studentId; },
  studentName() { return state.studentName || session.defaultStudentName(); },
  bindStudent(studentId, name) {
    state.studentId = studentId;
    state.studentName = name;
  },

  teacherId() { return state.teacherId; },
  teacherName() { return state.teacherName; },
  bindTeacher(teacherId, name) {
    state.teacherId = teacherId;
    state.teacherName = name;
  },

  startAsStudent() { session.logout(); state.role = ROLE_STUDENT; },
  startAsTeacher() { session.logout(); state.role = ROLE_TEACHER; },

  applyProfile(profile) {
    session.logout();
    if (!profile || !profile.role || profile.role === ROLE_NONE) return;
    if (profile.role === ROLE_TEACHER) {
      state.role = ROLE_TEACHER;
      state.teacherId = Number(profile.accountId);
      state.teacherName = profile.name || '';
      return;
    }
    state.role = ROLE_STUDENT;
    state.studentId = Number(profile.accountId);
    state.studentName = profile.name || '';
  },

  logout() {
    state.role = ROLE_NONE;
    state.studentId = -1;
    state.studentName = '';
    state.teacherId = -1;
    state.teacherName = '';
  }
};

module.exports = session;
