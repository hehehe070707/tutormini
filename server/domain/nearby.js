/*
 * 附近筛选（小程序特有，Qt 版没有）：把「只看多远以内」这套规则收在服务端，
 * 小程序端只把「我的定位 + 半径 + 要不要看全部」传上来，列表和距离都由后端算。
 *
 * 规则与原来 utils/store.js 完全一致：
 *   有定位 + 半径 > 0 + 没点"看全部" → 只返回半径内的；没有坐标的数据不藏（宁可多显示几条）。
 */

const util = require('../lib/util.js');

// 从查询参数里取浏览者的筛选条件
function parseViewer(query) {
  const q = query || {};
  return {
    lat: util.toNumber(q.lat, 0),
    lng: util.toNumber(q.lng, 0),
    km: util.toNumber(q.km, 0),
    all: q.all === '1' || q.all === 'true' || q.all === true
  };
}

// 这条离我多远（公里）；没有坐标返回 -1
function distanceOf(viewer, row) {
  if (!viewer || !util.hasCoords(viewer.lat, viewer.lng)) return -1;
  return util.distanceKm(viewer.lat, viewer.lng, row && row.lat, row && row.lng);
}

// 真正在筛的条件：有定位 + 定了半径 + 没点"看全部"
function active(viewer) {
  return !!viewer && !viewer.all && viewer.km > 0 && util.hasCoords(viewer.lat, viewer.lng);
}

// 近的排前面；没有距离的一律排最后（再按原来的 id 排）
function byNearest(a, b) {
  const ka = a.distanceKm >= 0 ? a.distanceKm : Infinity;
  const kb = b.distanceKm >= 0 ? b.distanceKm : Infinity;
  if (ka !== kb) return ka - kb;
  return a.id - b.id;
}

/*
 * 距离过滤：超出半径的藏起来并计数（页面拿 hidden 提示"另有 N 条超出范围"）。
 * rows 必须已经带 distanceKm。
 */
function split(viewer, rows) {
  if (!active(viewer)) return { list: rows, hidden: 0 };
  const list = [];
  let hidden = 0;
  rows.forEach((row) => {
    const km = typeof row.distanceKm === 'number' ? row.distanceKm : -1;
    if (km < 0 || km <= viewer.km) list.push(row);
    else hidden++;
  });
  return { list, hidden };
}

module.exports = { parseViewer, distanceOf, active, byNearest, split };
