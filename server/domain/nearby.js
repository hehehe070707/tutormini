const util = require('../lib/util.js');

function parseViewer(query) {
  const q = query || {};
  return {
    lat: util.toNumber(q.lat, 0),
    lng: util.toNumber(q.lng, 0),
    km: util.toNumber(q.km, 0),
    all: q.all === '1' || q.all === 'true' || q.all === true
  };
}

function distanceOf(viewer, row) {
  if (!viewer || !util.hasCoords(viewer.lat, viewer.lng)) return -1;
  return util.distanceKm(viewer.lat, viewer.lng, row && row.lat, row && row.lng);
}

function active(viewer) {
  return !!viewer && !viewer.all && viewer.km > 0 && util.hasCoords(viewer.lat, viewer.lng);
}

function byNearest(a, b) {
  const ka = a.distanceKm >= 0 ? a.distanceKm : Infinity;
  const kb = b.distanceKm >= 0 ? b.distanceKm : Infinity;
  if (ka !== kb) return ka - kb;
  return a.id - b.id;
}

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
