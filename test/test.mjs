// node test/test.mjs  ・依存なし。engine の計算・MCP・HTML への埋め込みの一致を照らす。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const E = createRequire(import.meta.url)(path.join(root, 'app/engine.js'));
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok ' + n + ' ' + name); };

const MON = '2026-11-09'; // 月曜（作り物の見本の週）
const cyc = E.sampleCycle(MON); // 月曜が 19 日目 → 木曜から黄体期の後半（作り物）
const press8 = E.samplePressure(MON); // 水 1017 → 木 1009（8 hPa 下がる・作り物）

t('日付: 週の月曜に直る・曜日', () => {
  assert.equal(E.mondayOf('2026-11-12'), MON);
  assert.equal(E.mondayOf('2026-11-15'), MON);
  assert.equal(E.mondayOf(MON), MON);
  assert.equal(E.dowIndex('2026-11-12'), 3);
});

t('phaseOf: 28 日周期の区切り（1・5・6・13・14・16・17・22・28 日目）', () => {
  const c = { lastStart: '2026-10-01', length: 28 };
  const at = (k) => E.phaseOf(E.addDays('2026-10-01', k - 1), c);
  assert.deepEqual([at(1).name, at(5).name, at(6).name, at(13).name], ['月経', '月経', '卵胞期', '卵胞期']);
  assert.deepEqual([at(14).name, at(16).name, at(17).name, at(28).name], ['排卵のころ', '排卵のころ', '黄体期', '黄体期']);
  assert.equal(at(21).late, false); assert.equal(at(22).late, true);
  assert.equal(at(29).day, 1); // 次の周期へ
  assert.deepEqual([at(1).points, at(2).points, at(3).points, at(10).points, at(25).points], [2, 2, 1, 0, 2]);
});

t('phaseOf: 30 日周期でも排卵の位置が (L-14)〜(L-12) 日目に動く', () => {
  const c = { lastStart: '2026-10-01', length: 30 };
  const at = (k) => E.phaseOf(E.addDays('2026-10-01', k - 1), c);
  assert.equal(at(15).name, '卵胞期'); assert.equal(at(16).name, '排卵のころ'); assert.equal(at(18).name, '排卵のころ'); assert.equal(at(19).name, '黄体期');
  assert.equal(at(23).late, false); assert.equal(at(24).late, true);
  assert.equal(E.normalizeCycle({ lastStart: '2026-10-01', length: 5 }).length, 21); // 範囲に収める
  assert.equal(E.normalizeCycle({ lastStart: '2026-10-01' }).length, 28);
  assert.equal(E.phaseOf('2026-10-01', null), null);
});

t('気圧の点: 2 未満 0・2 以上 1・4 以上 2・6 以上 3', () => {
  assert.deepEqual([1.9, 2, 3.9, 4, 5.9, 6, 8, -3, null].map(E.pressurePoints), [0, 1, 1, 2, 2, 3, 3, 0, 0]);
});

t('dailyFromHourly: 日平均・18 時間未満の日は捨てる', () => {
  const times = [], vals = [];
  for (let h = 0; h < 24; h++) { times.push('2026-11-09T' + String(h).padStart(2, '0') + ':00'); vals.push(1000 + h); }
  for (let h = 0; h < 10; h++) { times.push('2026-11-10T' + String(h).padStart(2, '0') + ':00'); vals.push(900); }
  const d = E.dailyFromHourly(times, vals);
  assert.deepEqual(d, [{ date: '2026-11-09', hpa: 1011.5 }]);
});

t('下げ幅: 前日が無い日は null（0 にしない）', () => {
  const dm = E.dropMap([{ date: '2026-11-09', hpa: 1010 }, { date: '2026-11-10', hpa: 1004 }]);
  assert.equal(dm.drop('2026-11-09'), null); assert.equal(dm.drop('2026-11-10'), 6); assert.equal(dm.drop('2026-11-12'), null);
});

const EVENTS = E.SAMPLE_EVENTS;
const plan8 = E.planWeek({ weekStart: MON, events: EVENTS, cycle: cyc, pressure: press8 });

t('中心: 8 hPa 下がる木曜の重い予定 2 件に札が付く・ほかの重い予定（金曜）には付かない', () => {
  const thu = plan8.days[3];
  assert.equal(thu.drop, 8); assert.equal(thu.points.pressure, 3); assert.equal(thu.phase.late, true); assert.equal(thu.points.phase, 2);
  assert.equal(thu.score, 5); assert.equal(thu.strongDrop, true);
  assert.equal(plan8.tags, 2);
  assert.deepEqual(plan8.suggestions.map((s) => s.title).sort(), ['企画の発表準備', '社内レビュー']);
  assert.equal(plan8.days[4].score, 2); // 金曜は黄体期の後半の 2 点だけ
  assert.ok(!plan8.suggestions.some((s) => s.from.dow === '金'));
});

t('中心: 行き先は点の低い日（木曜より低く 3 未満）・理由の文が付く', () => {
  for (const s of plan8.suggestions) {
    assert.ok(s.to, '行き先がある');
    assert.ok(s.to.score < s.from.score && s.to.score < 3);
    assert.ok(['月', '火', '水'].includes(s.to.dow)); // 点 0 の日
    assert.equal(s.to.score, 0);
  }
  const first = plan8.suggestions.find((s) => s.title === '社内レビュー');
  assert.ok(first.reason.startsWith('木曜は前日から 8 hPa 下がる予報で、黄体期の後半です。'));
  // 2 件目は 1 件目と別の日へ散る（重い予定の少ない日を先に）
  const tos = plan8.suggestions.map((s) => s.to.dow);
  assert.notEqual(tos[0], tos[1]);
});

t('中心: 気圧が下がらない週では札が 0（周期がどの位置でも）', () => {
  const flat = E.samplePressure(MON).map((p) => ({ date: p.date, hpa: 1015 }));
  const allHeavy = ['月', '火', '水', '木', '金', '土', '日'].map((d, i) => ({ id: 'h' + i, title: '重い' + d, dow: d, time: '10:00', weight: 'heavy' }));
  for (let off = 0; off < 28; off++) {
    const c = { lastStart: E.addDays(MON, -off), length: 28 };
    const p = E.planWeek({ weekStart: MON, events: allHeavy, cycle: c, pressure: flat });
    assert.equal(p.tags, 0, '周期位置 ' + off + ' で札が出た');
  }
  assert.equal(E.planWeek({ weekStart: MON, events: allHeavy, cycle: null, pressure: flat }).summary[0], '今週は、しんどさの見込みが高い日にある重い予定はありません。');
});

t('軽い・ふつうの予定には札が付かない', () => {
  const ev = [{ title: 'a', dow: '木', weight: '軽い' }, { title: 'b', dow: '木', weight: 'ふつう' }];
  assert.equal(E.planWeek({ weekStart: MON, events: ev, cycle: cyc, pressure: press8 }).tags, 0);
});

t('周期なしでも気圧だけで札が付く・気圧なしでも周期だけでは 3 点に届かず札は 0', () => {
  const ev = [{ title: '重い', dow: '木', weight: 'heavy' }];
  assert.equal(E.planWeek({ weekStart: MON, events: ev, cycle: null, pressure: press8 }).tags, 1);
  assert.equal(E.planWeek({ weekStart: MON, events: ev, cycle: cyc, pressure: [] }).tags, 0);
});

t('行き先: 下げ幅が分からない日・過ぎた日は選ばない／候補が無ければ to=null', () => {
  const ev = [{ id: 'x', title: '重い', dow: '木', time: '09:00', weight: 'heavy' }];
  // 木曜が今日 → 月〜水は過ぎた日。行き先は金〜日（点 2・3 未満）
  const p = E.planWeek({ weekStart: MON, events: ev, cycle: cyc, pressure: press8, today: '2026-11-12' });
  assert.equal(p.tags, 1); assert.equal(p.suggestions[0].to.dow, '金'); assert.equal(p.suggestions[0].to.score, 2);
  // 水・木の気圧しか無い（水曜の下げ幅は前日が無く不明）→ 候補なし
  const p3 = E.planWeek({ weekStart: MON, events: ev, cycle: cyc, pressure: press8.slice(3, 5) });
  assert.equal(p3.tags, 1); assert.equal(p3.suggestions[0].to, null);
  assert.ok(p3.suggestions[0].reason.includes('見つかりませんでした'));
  // 月曜の前日の気圧が無い → 月曜は行き先にならない（水曜が残る）
  const p2 = E.planWeek({ weekStart: MON, events: ev, cycle: cyc, pressure: press8.slice(1) });
  assert.notEqual(p2.suggestions[0].to.dow, '月');
  // 木曜が過ぎた日なら札を付けない
  assert.equal(E.planWeek({ weekStart: MON, events: ev, cycle: cyc, pressure: press8, today: '2026-11-13' }).tags, 0);
});

t('同じ時刻の予定がある日は後回し', () => {
  const ev = [{ id: 'x', title: '重い', dow: '木', time: '09:00', weight: 'heavy' }, { title: '水の予定', dow: '水', time: '09:00', weight: 'normal' }];
  const p = E.planWeek({ weekStart: MON, events: ev, cycle: cyc, pressure: press8 });
  assert.notEqual(p.suggestions[0].to.dow, '水');
});

t('入力のまちがいは分かる日本語で例外', () => {
  assert.throws(() => E.planWeek({ weekStart: '2026-13-40', events: [], pressure: [] }), /YYYY-MM-DD/);
  assert.throws(() => E.planWeek({ weekStart: MON, events: [{ title: 'a', dow: '木', weight: '最重' }], pressure: [] }), /重さ/);
  assert.throws(() => E.planWeek({ weekStart: MON, events: [{ title: 'a', dow: 'x', weight: '重い' }], pressure: [] }), /曜日/);
});

t('文の記法: 読点と鍵括弧を続けない（生成文）', () => {
  const all = JSON.stringify(plan8.summary) + plan8.suggestions.map((s) => s.reason).join('');
  assert.ok(!/、「|」、/.test(all));
});

// ---- MCP（node で起こして標準入力から流す）----
function mcp(lines) {
  const r = spawnSync('node', [path.join(root, 'mcp/server.mjs')], { input: lines.map((l) => JSON.stringify(l)).join('\n') + '\n', encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 0, 'MCP が終了コード 0 で止まる');
  return r.stdout.trim().split('\n').map((l) => JSON.parse(l));
}
t('MCP: initialize → tools/list → tools/call（plan_week・phase_of・未知の道具・知らないメソッド）', () => {
  const out = mcp([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'plan_week', arguments: {
      week_start: MON, cycle: { last_start: cyc.lastStart, length: 28 }, pressure: press8,
      events: EVENTS.map((e) => ({ ...e })) } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'phase_of', arguments: { date: '2026-11-12', cycle: { last_start: cyc.lastStart } } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope', arguments: {} } },
    { jsonrpc: '2.0', id: 6, method: 'foo/bar' },
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'plan_week', arguments: { week_start: 'x', events: [], pressure: [] } } }
  ]);
  assert.equal(out.length, 7); // 通知には返事なし
  assert.equal(out[0].result.protocolVersion, '2025-06-18');
  assert.deepEqual(out[1].result.tools.map((x) => x.name), ['plan_week', 'phase_of']);
  const plan = JSON.parse(out[2].result.content[0].text);
  assert.equal(plan.tags, 2); assert.equal(plan.tags, plan8.tags); // 画面と同じ計算
  assert.deepEqual(JSON.parse(out[3].result.content[0].text).phase, '黄体期');
  assert.equal(out[4].error.code, -32602); assert.equal(out[5].error.code, -32601);
  assert.equal(out[6].result.isError, true);
});

// ---- HTML に埋め込んだ engine が engine.js と同じ ----
t('HTML 埋め込みの engine が app/engine.js と一致・外の読み込みが無い', () => {
  const html = readFileSync(path.join(root, 'app/index.html'), 'utf8');
  const eng = readFileSync(path.join(root, 'app/engine.js'), 'utf8').trim();
  const m = html.match(/\/\* ENGINE:BEGIN \*\/\n([\s\S]*?)\n\/\* ENGINE:END \*\//);
  assert.ok(m, '埋め込みの印がある');
  assert.equal(m[1].trim(), eng);
  assert.ok(!/<script[^>]*\ssrc=|<link[^>]*href=|@import|url\(\s*['"]?https?:/i.test(html), '外の読み込みが無い');
  assert.ok(!/、「|」、/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), '画面の文に 、「 と 」、 が無い');
});

console.log('\n全 ' + n + ' 件 通過');
