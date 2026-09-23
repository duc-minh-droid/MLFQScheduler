// JavaScript port of the C++ simulator (main.cpp + Scheduler.h + CPU.h).
// It exists only so the page can run workloads you type in the editor.
// tools/verify-js-port.mjs runs both versions on random workloads and checks
// that the traces are identical, field for field.
(function (root) {
  'use strict';
  const LEVELS = 3;

  function parseWorkload(text) {
    const w = { name: 'default', quanta: [1, 2, 4], boost: 0, procs: [] };
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lineno = i + 1;
      let line = lines[i];
      const hash = line.indexOf('#');
      if (hash >= 0) line = line.slice(0, hash);
      const toks = line.trim().split(/\s+/).filter(Boolean);
      if (!toks.length) continue;
      const first = toks[0];
      if (first === 'name') {
        w.name = line.trim().slice(4).trim();
      } else if (first === 'quanta') {
        const q = toks.slice(1).map(Number);
        if (!q.length || q.some((x) => !Number.isInteger(x) || x < 1))
          throw new Error(`line ${lineno}: quanta must be positive integers`);
        w.quanta = q;
      } else if (first === 'boost') {
        const b = Number(toks[1]);
        if (!Number.isInteger(b) || b < 0) throw new Error(`line ${lineno}: boost must be >= 0`);
        w.boost = b;
      } else {
        const nums = toks.map(Number);
        if (!Number.isInteger(nums[0])) throw new Error(`line ${lineno}: unknown directive '${first}'`);
        if (toks.length < 3 || !Number.isInteger(nums[1]) || !Number.isInteger(nums[2]))
          throw new Error(`line ${lineno}: expected 'pid arrival burst [io_every] [io_duration]'`);
        const p = {
          pid: nums[0], arrival: nums[1], burst: nums[2],
          io_every: toks.length > 3 && Number.isInteger(nums[3]) ? nums[3] : -1,
          io_duration: toks.length > 4 && Number.isInteger(nums[4]) ? nums[4] : 1,
        };
        if (p.io_every <= 0) p.io_every = -1;
        if (p.io_duration < 1) p.io_duration = 1;
        if (p.pid < 1 || p.arrival < 0 || p.burst < 1)
          throw new Error(`line ${lineno}: need pid >= 1, arrival >= 0, burst >= 1`);
        w.procs.push(p);
      }
    }
    const seen = new Set();
    for (const p of w.procs) {
      if (seen.has(p.pid)) throw new Error(`duplicate pid ${p.pid}`);
      seen.add(p.pid);
    }
    if (!w.procs.length) throw new Error('workload has no processes');
    w.procs.sort((a, b) => a.pid - b.pid);
    return w;
  }

  function simulate(w, maxTicks = 100000) {
    // process table, iterated in pid order like std::map
    const pids = w.procs.map((s) => s.pid).sort((a, b) => a - b);
    const P = new Map();
    for (const s of w.procs) {
      P.set(s.pid, {
        pid: s.pid, state: 'new', remaining: s.burst, level: 0,
        io_every: s.io_every <= 0 ? -1 : s.io_every, cpu_ticks_used: 0,
        arrival: s.arrival, burst: s.burst, io_duration: Math.max(1, s.io_duration),
        io_remaining: 0, first_run: -1, finish: -1, wait: 0,
      });
    }
    const queues = Array.from({ length: LEVELS }, () => []);
    const blocked = [];
    const quanta = w.quanta.length ? w.quanta : [1, 2, 4];
    const quantumFor = (l) => quanta[Math.min(l, quanta.length - 1)];
    const cpu = { running: false, pid: 0, quantum: 2, used: 0 };

    const enqueue = (pid) => {
      const p = P.get(pid);
      if (p.state === 'new' || p.state === 'ready') {
        queues[p.level].push(pid);
        p.state = 'ready';
      }
    };
    const empty = () => queues.every((q) => q.length === 0);
    const schedule = () => {
      for (const q of queues) if (q.length) return q.shift();
      return -1;
    };
    const ioTick = () => {
      if (!blocked.length) return -1;
      const pid = blocked[0];
      const p = P.get(pid);
      if (--p.io_remaining > 0) return -1;
      blocked.shift();
      p.state = 'ready';
      enqueue(pid);
      return pid;
    };
    const boost = () => {
      for (const pid of pids) {
        const p = P.get(pid);
        if (p.state !== 'terminated') p.level = 0;
      }
      for (let l = 1; l < LEVELS; l++) {
        queues[0].push(...queues[l]);
        queues[l].length = 0;
      }
    };
    const cpuTick = () => {
      if (!cpu.running) return 'none';
      const p = P.get(cpu.pid);
      p.remaining--;
      cpu.used++;
      if (p.remaining === 0) {
        p.state = 'terminated';
        cpu.running = false;
        return 'terminated';
      }
      if (p.io_every !== -1) {
        p.cpu_ticks_used++;
        if (p.cpu_ticks_used === p.io_every) {
          p.cpu_ticks_used = 0;
          p.state = 'blocked';
          cpu.running = false;
          return 'blocked';
        }
      }
      if (cpu.used === cpu.quantum) {
        p.state = 'ready';
        cpu.running = false;
        return 'preempted';
      }
      return 'none';
    };
    const handleEvent = (pid, result) => {
      const p = P.get(pid);
      if (result === 'preempted') {
        if (p.level < LEVELS - 1) p.level++;
        enqueue(pid);
      } else if (result === 'blocked') {
        if (p.level > 0) p.level--;
        p.io_remaining = p.io_duration;
        blocked.push(pid);
      }
    };
    const ev = (type, pid = -1, from = -1, to = -1, quantum = -1) => {
      const e = { type };
      if (pid !== -1) e.pid = pid;
      if (from !== -1) e.from = from;
      if (to !== -1) e.to = to;
      if (quantum !== -1) e.quantum = quantum;
      return e;
    };

    const ticks = [];
    for (let t = 0; t < maxTicks; t++) {
      const events = [];
      for (const s of w.procs) {
        if (s.arrival === t) {
          enqueue(s.pid);
          events.push(ev('arrive', s.pid, 0));
        }
      }
      const ioPid = ioTick();
      if (ioPid !== -1) events.push(ev('io_done', ioPid, P.get(ioPid).level));
      if (w.boost > 0 && t > 0 && t % w.boost === 0) {
        boost();
        events.push(ev('boost'));
      }
      if (!cpu.running && !empty()) {
        const pid = schedule();
        const p = P.get(pid);
        const q = quantumFor(p.level);
        cpu.pid = pid; cpu.quantum = q; cpu.running = true; cpu.used = 0;
        p.state = 'running';
        if (p.first_run < 0) p.first_run = t;
        events.push(ev('dispatch', pid, p.level, -1, q));
      }
      for (const q of queues) for (const pid of q) P.get(pid).wait++;

      const running = cpu.running ? cpu.pid : -1;
      const from = running !== -1 ? P.get(running).level : -1;
      const result = cpuTick();
      let slice = [0, 0];
      if (running !== -1) {
        slice = [cpu.used, cpu.quantum];
        handleEvent(running, result);
        const to = P.get(running).level;
        if (result === 'preempted') events.push(ev('preempt', running, from, to));
        else if (result === 'blocked') events.push(ev('block', running, from, to));
        else if (result === 'terminated') {
          P.get(running).finish = t + 1;
          events.push(ev('complete', running, from));
        }
      }
      let allDone = true;
      const procs = pids.map((pid) => {
        const p = P.get(pid);
        if (p.state !== 'terminated') allDone = false;
        return { pid, state: p.state, level: p.level, remaining: p.remaining };
      });
      ticks.push({
        t, running, run_level: from, slice,
        queues: queues.map((q) => q.slice()),
        blocked: blocked.slice(),
        io_left: blocked.length ? P.get(blocked[0]).io_remaining : 0,
        events, procs,
      });
      if (allDone) break;
    }

    const busy = ticks.filter((s) => s.running !== -1).length;
    return {
      name: w.name, levels: LEVELS, quanta: w.quanta.slice(), boost: w.boost,
      processes: w.procs.map((s) => ({
        pid: s.pid, arrival: s.arrival, burst: s.burst, io_every: s.io_every, io_duration: s.io_duration,
      })),
      ticks,
      summary: {
        total_ticks: ticks.length, busy_ticks: busy,
        per_process: pids.map((pid) => {
          const p = P.get(pid);
          return {
            pid, arrival: p.arrival, burst: p.burst, first_run: p.first_run, finish: p.finish,
            turnaround: p.finish - p.arrival, response: p.first_run - p.arrival, waiting: p.wait,
          };
        }),
      },
    };
  }

  const api = { LEVELS, parseWorkload, simulate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MLFQ = api;
})(typeof window !== 'undefined' ? window : globalThis);
