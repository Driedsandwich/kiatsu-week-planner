#!/usr/bin/env node
// 気圧と周期の週予定: MCP サーバー（stdio・JSON-RPC 2.0・依存なし）
// 計算は ../app/engine.js（画面と同じ部品）。ネットへは出ない（気圧は道具の引数で受け取る）。
// stdout には JSON-RPC の返答だけを書く。ログは stderr。
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';

const E = createRequire(import.meta.url)('../app/engine.js');
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

const cycleSchema = {
  type: 'object',
  description: '周期の記録。last_start = 前回の始まりの日（YYYY-MM-DD）、length = いつもの周期の日数（21〜45・既定 28）',
  properties: { last_start: { type: 'string' }, length: { type: 'integer', minimum: 21, maximum: 45, default: 28 } },
  required: ['last_start']
};

const TOOLS = [
  {
    name: 'plan_week',
    description: '1 週間の予定・周期・日ごとの気圧から、日ごとのしんどさの見込み（点）と、重い予定をずらす案を返す。医療の判断ではなく、予定を組み替える目安。',
    inputSchema: {
      type: 'object',
      properties: {
        week_start: { type: 'string', description: '週のどれかの日（YYYY-MM-DD）。月曜始まりの週に直す' },
        events: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              dow: { type: 'string', description: '月〜日（mon〜sun も可）' },
              time: { type: 'string', description: 'HH:MM' },
              weight: { type: 'string', enum: ['light', 'normal', 'heavy', '軽い', 'ふつう', '重い'] }
            },
            required: ['title', 'dow', 'weight']
          }
        },
        cycle: cycleSchema,
        pressure: {
          type: 'array',
          description: '日ごとの気圧の平均（hPa）。前日の値があると前日からの下げ幅が出る',
          items: { type: 'object', properties: { date: { type: 'string' }, hpa: { type: 'number' } }, required: ['date', 'hpa'] }
        },
        today: { type: 'string', description: '省略可。指定すると、過ぎた日は行き先にしない' }
      },
      required: ['week_start', 'events', 'pressure']
    }
  },
  {
    name: 'phase_of',
    description: '日付と周期の記録から、周期の時期（月経・卵胞期・排卵のころ・黄体期）と周期の何日目かを返す。',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, cycle: cycleSchema },
      required: ['date', 'cycle']
    }
  }
];

function callTool(name, a) {
  a = a || {};
  const cycle = a.cycle ? { lastStart: a.cycle.last_start, length: a.cycle.length } : null;
  if (name === 'plan_week') {
    return E.planWeek({ weekStart: a.week_start, events: a.events, cycle, pressure: a.pressure, today: a.today });
  }
  if (name === 'phase_of') {
    if (!E.normalizeCycle(cycle)) throw new Error('cycle.last_start は YYYY-MM-DD の形で入れてください');
    if (isNaN(E.dayNum(a.date))) throw new Error('date は YYYY-MM-DD の形で入れてください');
    const p = E.phaseOf(a.date, cycle);
    return { date: a.date, phase: p.name, key: p.key, day: p.day, cycle_length: p.length, late_luteal: p.late, points: p.points };
  }
  const err = new Error('未知の道具: ' + name); err.code = 'unknown_tool'; throw err;
}

const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

function handle(msg) {
  const { id, method, params } = msg;
  const isNote = id === undefined || id === null;
  if (method === 'initialize') {
    const want = params && params.protocolVersion;
    return ok(id, {
      protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'kiatsu-shuyotei', version: '0.1.0' },
      instructions: '気圧と周期の週予定。plan_week で重い予定のずらす案、phase_of で周期の時期。医療の判断ではありません。'
    });
  }
  if (method === 'ping') return ok(id, {});
  if (method === 'tools/list') return ok(id, { tools: TOOLS });
  if (method === 'tools/call') {
    try {
      const r = callTool(params && params.name, params && params.arguments);
      return ok(id, { content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r, isError: false });
    } catch (e) {
      if (e.code === 'unknown_tool') return fail(id, -32602, e.message);
      return ok(id, { content: [{ type: 'text', text: String(e.message) }], isError: true });
    }
  }
  if (isNote) return; // notifications/initialized など。返事は要らない
  return fail(id, -32601, 'Method not found: ' + method);
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'Parse error'); }
  try { handle(msg); } catch (e) { console.error(e); if (msg && msg.id !== undefined) fail(msg.id, -32603, 'Internal error'); }
});
rl.on('close', () => process.exit(0));
