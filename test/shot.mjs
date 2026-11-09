// 画面の撮影と横はみ出しの測定（headless Chrome を DevTools で操作・依存なし）
// 使い方: node test/shot.mjs <out_dir> <profile_dir> [?query]
// 理由: headless=new の --window-size は幅 500 未満を 500 に直すため、390px のスマホ幅は DevTools の端末指定で撮る。
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2], prof = process.argv[3], query = process.argv[4] || '?sample=1';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = 'file://' + path.join(root, 'app/index.html') + query;

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', '--user-data-dir=' + prof, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((res, rej) => {
  let buf = '';
  chrome.stderr.on('data', (d) => { buf += d; const m = buf.match(/ws:\/\/\S+/); if (m) res(m[0]); });
  setTimeout(() => rej(new Error('DevTools の URL が出ません')), 15000);
});
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (m) => { const j = JSON.parse(m.data); if (j.id && pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id); } });
const call = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(name, w, hgt, full) {
  const { result: { targetId } } = await call('Target.createTarget', { url: 'about:blank' });
  const { result: { sessionId } } = await call('Target.attachToTarget', { targetId, flatten: true });
  await call('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile: false }, sessionId);
  await call('Page.enable', {}, sessionId);
  await call('Page.navigate', { url }, sessionId);
  await sleep(2500);
  const ev = async (expr) => (await call('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId)).result.result.value;
  const m = await ev('JSON.stringify({iw:innerWidth,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight,over:[...document.querySelectorAll("body *")].filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1&&r.width>0}).slice(0,8).map(e=>e.tagName+"."+e.className+":"+Math.round(e.getBoundingClientRect().right))})');
  if (full) {
    const sh = JSON.parse(m).sh;
    await call('Emulation.setDeviceMetricsOverride', { width: w, height: sh, deviceScaleFactor: 1, mobile: false }, sessionId);
    await sleep(500);
  }
  const shot = await call('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(path.join(out, name + '.png'), Buffer.from(shot.result.data, 'base64'));
  console.log(name, m);
  await call('Target.closeTarget', { targetId });
}

try {
  await shoot('desktop_1440x900', 1440, 900, false);
  await shoot('mobile_390x844', 390, 844, false);
  await shoot('desktop_1440_full', 1440, 900, true);
  await shoot('mobile_390_full', 390, 844, true);
} finally {
  ws.close(); chrome.kill();
}
