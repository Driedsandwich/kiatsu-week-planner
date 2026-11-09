# MCP サーバー（気圧と周期の週予定）

- 形: stdio・JSON-RPC 2.0（1 行 1 メッセージ）・依存なし（Node 18 以上。確かめは Node 22）。
- 起動: `node mcp/server.mjs`（標準入力から読み、標準出力へ返す）。ネットへは出ません。気圧は道具の引数で渡します。
- 計算は `app/engine.js`（画面と同じ部品）。

## クライアントの設定例（Claude Desktop や Claude Code の mcpServers）
```json
{ "mcpServers": { "kiatsu": { "command": "node", "args": ["/絶対パス/mcp/server.mjs"] } } }
```

## 道具
- `plan_week`: `week_start`（週のどれかの日）・`events`（`title`・`dow`・`time`・`weight`＝軽い／ふつう／重い）・`cycle`（`last_start`・`length`）・`pressure`（`[{date,hpa}]`・日平均・前日の値があると下げ幅が出る）・`today`（省略可）。
  返り値は `days`（日ごとの `score`・`points`・`phase`・`drop`）・`suggestions`（`from`・`to`・`reason`）・`tags`（札の数）・`summary`。
- `phase_of`: `date`・`cycle` → `phase`・`day`・`points`。

## 試し方
```
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node mcp/server.mjs
```
入力が閉じると終了します。入力の誤りは、`isError: true` の結果（日本語の説明つき）で返ります。
