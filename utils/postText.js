const util = require('./util.js');

function postText(item) {
  const lines = ['【单号 ' + (item.code || '') + '】' + item.subject];
  lines.push('时间：' + item.timeText);
  lines.push('价格：' + item.price);
  lines.push('位置：' + item.area);
  if (util.plain(item.note) !== '') lines.push('说明：' + item.note);
  return lines.join('\n');
}

function inviteBundle(post, invites) {
  const wait = (invites || []).filter((inv) => inv.pending);
  if (wait.length === 0) return '';
  const head = '【单号 ' + (post.code || '') + '】' + post.subject + '　' + post.timeText +
    '　候选老师 ' + wait.length + ' 位：';
  const parts = wait.map((inv, index) => {
    const resume = util.plain(inv.resume) === '' ? '（这位老师没有填写简历）' : inv.resume;
    return '—— 第 ' + (index + 1) + ' 位：' + inv.teacherName + ' 老师 ——\n' + resume;
  });
  return head + '\n\n' + parts.join('\n\n');
}

function copyText(text, tip) {
  if (util.plain(text) === '') {
    wx.showModal({ title: '提示', content: '这条暂时没有可复制的内容。', showCancel: false });
    return;
  }
  wx.setClipboardData({
    data: text,
    success: () => wx.showToast({ title: tip || '已复制', icon: 'none' })
  });
}

module.exports = { postText, inviteBundle, copyText };
