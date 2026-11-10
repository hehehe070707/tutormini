/*
 * 接口地址配置：小程序端只认后端地址，业务数据一律从后端拿。
 *
 * 开发：后端跑在电脑上（启动后端.cmd），下面这一串地址会**按顺序自动试**，
 *       哪个连通就用哪个 —— 所以模拟器和手机真机不用改代码：
 *         1) 127.0.0.1     → 开发者工具模拟器（后端就在本机）
 *         2) 电脑的局域网 IPv4 → 手机真机（手机连同一个 WiFi，访问电脑的局域网地址）
 *       换电脑 / 换 WiFi / 重连校园网后电脑 IP 会变，第 2 条由「启动后端.cmd」自动跟着改
 *       （tools\sync-lan-ip.ps1 把当前局域网 IP 写进来），一般不用手改；
 *       想核对当前 IP：双击根目录「查看本机IP.cmd」，它会打印 IP、探活后端。
 *       （校园网的地址一般是 10.x 开头，不是家里的 192.168.x。）
 *
 * 上线：后端部署到云服务器，把 IS_DEV 改成 false，PROD_BASE 换成自己的 https 域名，
 *       并在小程序后台把域名加进 request 合法域名。
 */

// 一处开关：发布前把这里改成 false
const IS_DEV = true;

// 开发时按顺序尝试的地址（前一个是本机，后一个是局域网）
// 第二个 = 这台电脑当前的局域网 IPv4，由「启动后端.cmd」自动同步（tools\sync-lan-ip.ps1），
// 别动变量名和 DEV_BASES 这个写法 —— 脚本靠它定位这一项。要手动改先跑「查看本机IP.cmd」确认。
const DEV_BASES = [
  'http://127.0.0.1:3000/api',
  'http://10.195.51.2:3000/api'
];

// 下面这一行由「穿透后端.cmd」自动维护：cloudflared 快速隧道的公网地址。
// 别改格式 —— 脚本靠 TUNNEL_BASE 这个变量名定位这一行；空字符串 = 没用穿透。
// 真正尝试的顺序在 apiBases()：本机 → 穿透地址 → 局域网 IP。
const TUNNEL_BASE = 'https://romantic-rebate-passenger-toddler.trycloudflare.com/api';

const PROD_BASE = 'https://example.com/api';   // 上线时改成自己的域名

// 依次尝试的候选地址；api.js 会从第一个开始试，失败就换下一个。
// 顺序：本机（模拟器）→ 穿透地址（手机，校园网隔离也能连）→ 局域网 IP（手机，同一个 WiFi 且没隔离）
function apiBases() {
  if (!IS_DEV) return [PROD_BASE];
  const bases = [DEV_BASES[0]];
  if (TUNNEL_BASE) bases.push(TUNNEL_BASE);
  if (DEV_BASES[1]) bases.push(DEV_BASES[1]);
  return bases;
}

// 默认（第一个）地址，报错提示和探活用
function apiBase() {
  return apiBases()[0];
}

module.exports = { IS_DEV, DEV_BASES, TUNNEL_BASE, PROD_BASE, apiBases, apiBase };
