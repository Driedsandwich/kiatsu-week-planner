// app/engine.js の中身を app/index.html の印（ENGINE:BEGIN / END）の間へ埋め込む。node build.mjs
// （file:// で開く 1 枚の HTML は ES モジュールを読めないので、同じ中身を埋め込む）
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const engine = readFileSync(path.join(root, 'app/engine.js'), 'utf8').trim();
const file = path.join(root, 'app/index.html');
const html = readFileSync(file, 'utf8');
const re = /\/\* ENGINE:BEGIN \*\/\n[\s\S]*?\/\* ENGINE:END \*\//;
if (!re.test(html)) throw new Error('埋め込みの印が見つかりません');
if (engine.includes('</script')) throw new Error('engine.js に </script が含まれています');
writeFileSync(file, html.replace(re, () => '/* ENGINE:BEGIN */\n' + engine + '\n/* ENGINE:END */'));
console.log('embedded engine.js (' + engine.length + ' chars) into app/index.html');
