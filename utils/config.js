const IS_DEV = true;

const DEV_BASES = [
  'http://127.0.0.1:3000/api',
  ''
];

const TUNNEL_BASE = '';

const PROD_BASE = 'https://example.com/api';

function apiBases() {
  if (!IS_DEV) return [PROD_BASE];
  const bases = [DEV_BASES[0]];
  if (TUNNEL_BASE) bases.push(TUNNEL_BASE);
  if (DEV_BASES[1]) bases.push(DEV_BASES[1]);
  return bases;
}

function apiBase() {
  return apiBases()[0];
}

module.exports = { IS_DEV, DEV_BASES, TUNNEL_BASE, PROD_BASE, apiBases, apiBase };
