// Checks that web/mlfq.js produces exactly the same trace as the C++ binary.
// Runs every preset in workloads/ plus N random workloads through both.
//
//   node tools/verify-js-port.mjs [count=500] [seed=1]
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { parseWorkload, simulate } = require(join(root, 'web', 'mlfq.js'));

const bin = ['build/mlfq.exe', 'build/mlfq', 'build/Release/mlfq.exe']
  .map((p) => join(root, p)).find(existsSync);
if (!bin) {
  console.error('mlfq binary not found in build/. Build it first (see README).');
  process.exit(1);
}

const count = Number(process.argv[2] ?? 500);
let seed = Number(process.argv[3] ?? 1);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const ri = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

function randomWorkload(i) {
  const lines = [`name random ${i}`];
  lines.push(`quanta ${ri(1, 3)} ${ri(1, 5)} ${ri(1, 8)}`);
  lines.push(`boost ${rand() < 0.4 ? 0 : ri(1, 25)}`);
  const n = ri(1, 7);
  const pids = new Set();
  while (pids.size < n) pids.add(ri(1, 20));
  for (const pid of pids) {
    const io = rand() < 0.5 ? -1 : ri(1, 5);
    lines.push(`${pid} ${ri(0, 15)} ${ri(1, 20)} ${io} ${ri(1, 4)}`);
  }
  return lines.join('\n') + '\n';
}

function runCpp(text) {
  return JSON.parse(execFileSync(bin, ['--trace', '--workload', '-'], { input: text }).toString());
}

const cases = readdirSync(join(root, 'workloads'))
  .filter((f) => f.endsWith('.txt'))
  .map((f) => [f, readFileSync(join(root, 'workloads', f), 'utf8').replace(/\r/g, '')]);
for (let i = 0; i < count; i++) cases.push([`random #${i}`, randomWorkload(i)]);

let failed = 0;
let ticks = 0;
for (const [label, text] of cases) {
  const cpp = runCpp(text);
  const js = simulate(parseWorkload(text));
  ticks += cpp.ticks.length;
  if (!isDeepStrictEqual(cpp, js)) {
    failed++;
    const t = cpp.ticks.findIndex((s, k) => !isDeepStrictEqual(s, js.ticks[k]));
    console.log(`MISMATCH ${label} (first differing tick: ${t})\n${text}`);
    if (t >= 0) console.log('cpp:', JSON.stringify(cpp.ticks[t]), '\njs: ', JSON.stringify(js.ticks[t]));
    if (failed > 3) break;
  }
}
console.log(`${cases.length - failed}/${cases.length} workloads identical (${ticks} ticks compared)`);
process.exit(failed ? 1 : 0);
