// MLFQ visualizer: plays back a trace produced by `mlfq --trace`.
// Presets come from web/data/presets.js (real C++ output). Edited workloads are
// run through web/mlfq.js, a port checked against the C++ binary.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const PALETTE = ['#7aa7ff', '#c792ea', '#5ad1e6', '#f78fb3', '#b5e655', '#ffcf6b', '#9fb0c8', '#ff9f7a', '#6fe3b5', '#d0a4ff'];
  const LEVEL_COLORS = ['var(--l0)', 'var(--l1)', 'var(--l2)'];
  const SPEEDS = [0.5, 1, 2, 3, 5, 8];
  const TOKEN = 44;

  const presets = window.MLFQ_PRESETS || [];
  let preset = null;     // current preset object
  let trace = null;      // trace being played
  let cur = -1;          // index of the last tick applied (-1 = before t=0)
  let timer = null;
  let tokens = new Map();
  let colorOf = new Map();

  const stage = $('#stage');
  const tokenLayer = $('#tokens');

  // ---------- loading ----------
  function init() {
    const sel = $('#preset');
    presets.forEach((p, i) => {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = p.trace.name;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => loadPreset(presets[+sel.value]));
    const want = new URLSearchParams(location.search).get('preset');
    const start = Math.max(0, presets.findIndex((p) => p.id === want));
    sel.value = start;
    loadPreset(presets[start]);

    $('#btn-play').onclick = togglePlay;
    $('#btn-step').onclick = () => { pause(); step(1); };
    $('#btn-back').onclick = () => { pause(); step(-1); };
    $('#btn-reset').onclick = () => { pause(); show(-1); };
    $('#scrub').oninput = (e) => { pause(); show(+e.target.value); };
    $('#speed').oninput = updateSpeed;
    $('#btn-run').onclick = runEditor;
    $('#btn-revert').onclick = () => loadPreset(preset);
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowRight') { pause(); step(1); }
      else if (e.key === 'ArrowLeft') { pause(); step(-1); }
      else if (e.key === 'Home') { pause(); show(-1); }
    });
    window.addEventListener('resize', () => { layoutTokens(false); drawGantt(); });
    updateSpeed();
  }

  function loadPreset(p) {
    preset = p;
    $('#workload').value = p.text;
    setMsg('');
    loadTrace(p.trace, 'cpp');
  }

  function runEditor() {
    const text = $('#workload').value;
    if (preset && text.replace(/\r/g, '') === preset.text) {
      loadTrace(preset.trace, 'cpp');
      setMsg('Unchanged preset: using the trace precomputed by the C++ binary.', 'ok');
      return;
    }
    try {
      const w = MLFQ.parseWorkload(text);
      if (w.procs.length > 10) throw new Error('the visualizer shows at most 10 processes');
      const t = MLFQ.simulate(w, 2000);
      loadTrace(t, 'js');
      setMsg(`Simulated ${t.ticks.length} ticks in the browser.`, 'ok');
    } catch (err) {
      setMsg(err.message, 'err');
    }
  }

  function setMsg(text, kind) {
    const m = $('#editor-msg');
    m.textContent = text;
    m.className = 'msg' + (kind ? ' ' + kind : '');
  }

  function loadTrace(t, source) {
    pause();
    trace = t;
    const src = $('#source');
    src.className = 'source ' + source;
    src.textContent = source === 'cpp'
      ? 'trace: C++ binary (precomputed)'
      : 'trace: JS port (verified identical to C++)';
    document.querySelectorAll('.lane[data-lane]').forEach((lane) => {
      const l = lane.dataset.lane;
      if (l === 'io') return;
      const q = t.quanta[Math.min(+l, t.quanta.length - 1)];
      lane.querySelector('.q').textContent = `quantum ${q} tick${q > 1 ? 's' : ''}`;
    });
    $('#scrub').max = t.ticks.length - 1;
    $('#tick-total').textContent = `/ ${t.ticks.length - 1}` + (t.boost ? ` · boost every ${t.boost}` : ' · no boost');

    tokenLayer.innerHTML = '';
    tokens = new Map();
    colorOf = new Map();
    t.processes.forEach((p, i) => {
      colorOf.set(p.pid, PALETTE[i % PALETTE.length]);
      const el = document.createElement('div');
      el.className = 'token new';
      el.style.setProperty('--c', colorOf.get(p.pid));
      el.innerHTML = `P${p.pid}<span class="rem"></span><span class="tag"></span>`;
      tokenLayer.appendChild(el);
      tokens.set(p.pid, el);
    });
    show(-1, false);
  }

  // ---------- playback ----------
  function interval() { return 1000 / SPEEDS[+$('#speed').value]; }
  function updateSpeed() {
    const s = SPEEDS[+$('#speed').value];
    $('#speed-text').textContent = `${s} t/s`;
    document.documentElement.style.setProperty('--dur', Math.round(Math.min(450, interval() * 0.8)) + 'ms');
  }
  function togglePlay() { timer ? pause() : play(); }
  function play() {
    if (cur >= trace.ticks.length - 1) show(-1);
    $('#btn-play').textContent = 'Pause';
    $('#btn-play').classList.add('playing');
    const tickOnce = () => {
      if (cur >= trace.ticks.length - 1) { pause(); return; }
      step(1);
      timer = setTimeout(tickOnce, interval());
    };
    timer = setTimeout(tickOnce, 150);
  }
  function pause() {
    clearTimeout(timer);
    timer = null;
    $('#btn-play').textContent = 'Play';
    $('#btn-play').classList.remove('playing');
  }
  function step(d) { show(Math.max(-1, Math.min(trace.ticks.length - 1, cur + d))); }

  // ---------- rendering ----------
  function stateAt(k) {
    if (k >= 0) return trace.ticks[k];
    return {
      t: -1, running: -1, run_level: -1, slice: [0, 0], queues: [[], [], []], blocked: [], io_left: 0, events: [],
      procs: trace.processes.map((p) => ({ pid: p.pid, state: 'new', level: 0, remaining: p.burst })),
    };
  }

  function show(k, animate = true) {
    cur = k;
    const s = stateAt(k);
    $('#tick').textContent = k < 0 ? '-' : s.t;
    $('#scrub').value = k;

    // CPU box
    const cpu = $('#cpu');
    if (s.running !== -1) {
      const color = LEVEL_COLORS[s.run_level];
      cpu.classList.add('busy');
      cpu.style.setProperty('--run-color', color);
      const left = s.events.find((e) => e.pid === s.running && ['preempt', 'block', 'complete'].includes(e.type));
      const why = { preempt: 'quantum used up', block: 'left for I/O', complete: 'finished' };
      $('#cpu-state').innerHTML = left
        ? `P${s.running} ran at <span style="color:${color}">L${s.run_level}</span>, ${why[left.type]}`
        : `P${s.running} running at <span style="color:${color}">L${s.run_level}</span>`;
      $('#slice-fill').style.width = (100 * s.slice[0] / s.slice[1]) + '%';
      $('#slice-text').textContent = `used ${s.slice[0]} of ${s.slice[1]}-tick quantum`;
    } else {
      cpu.classList.remove('busy');
      $('#cpu-state').textContent = k < 0 ? 'idle (press Play)' : 'idle';
      $('#slice-fill').style.width = '0%';
      $('#slice-text').innerHTML = '&nbsp;';
    }

    // lanes flash when something enters them this tick
    document.querySelectorAll('.lane').forEach((l) => l.classList.remove('flash'));
    const boosted = s.events.some((e) => e.type === 'boost');
    $('#boost-banner').classList.toggle('show', boosted);
    if (boosted) document.querySelector('.lane[data-lane="0"]').classList.add('flash');

    layoutTokens(animate, s);
    renderEvents(s, k);
    drawGantt();
    renderStats(s);
  }

  function rel(el) {
    const r = el.getBoundingClientRect(), b = stage.getBoundingClientRect();
    return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height };
  }

  function rowPositions(box, n, top, pad = 10) {
    const avail = box.w - 2 * pad - TOKEN;
    const stepX = n > 1 ? Math.min(TOKEN + 12, avail / (n - 1)) : 0;
    return Array.from({ length: n }, (_, i) => ({ x: box.x + pad + i * stepX, y: top }));
  }

  function layoutTokens(animate, s = stateAt(cur)) {
    const pos = new Map();
    const place = (pids, box, top) => rowPositions(box, pids.length, top).forEach((p, i) => pos.set(pids[i], p));
    const laneBox = (id) => rel(document.querySelector(`.lane[data-lane="${id}"] .lane-slots`));

    s.queues.forEach((q, l) => { const b = laneBox(l); place(q, b, b.y + (b.h - TOKEN) / 2); });
    const io = laneBox('io');
    place(s.blocked, io, io.y + (io.h - TOKEN) / 2);
    const trayNew = rel($('#tray-new')), trayDone = rel($('#tray-done'));
    place(s.procs.filter((p) => p.state === 'new').map((p) => p.pid), trayNew, trayNew.y + 24);
    place(s.procs.filter((p) => p.state === 'terminated').map((p) => p.pid), trayDone, trayDone.y + 24);
    if (s.running !== -1 && !pos.has(s.running)) {
      // still on the CPU after this tick
      const c = rel($('#cpu-slot'));
      pos.set(s.running, { x: c.x + (c.w - TOKEN) / 2, y: c.y + (c.h - TOKEN) / 2 });
    }

    const tagFor = new Map();
    for (const e of s.events) {
      if (e.type === 'preempt') tagFor.set(e.pid, [e.to > e.from ? `↓ L${e.to}` : `L${e.to}`, 'var(--l2)']);
      else if (e.type === 'block') tagFor.set(e.pid, [e.to < e.from ? `I/O ↑L${e.to}` : 'I/O', 'var(--io)']);
      else if (e.type === 'io_done' && !tagFor.has(e.pid)) tagFor.set(e.pid, ['back', 'var(--io)']);
      else if (e.type === 'complete') tagFor.set(e.pid, ['done', 'var(--l0)']);
      else if (e.type === 'arrive' && !tagFor.has(e.pid)) tagFor.set(e.pid, ['new', 'var(--accent)']);
    }
    const spec = new Map(trace.processes.map((p) => [p.pid, p]));
    const finishOf = new Map(trace.summary.per_process.map((p) => [p.pid, p.finish]));

    for (const p of s.procs) {
      const el = tokens.get(p.pid);
      const at = pos.get(p.pid) || { x: 0, y: 0 };
      if (!animate) el.style.transition = 'none';
      el.style.transform = `translate(${at.x}px, ${at.y}px)`;
      if (!animate) { void el.offsetWidth; el.style.transition = ''; }
      const running = s.running === p.pid && p.state === 'running';
      el.className = 'token ' + (running ? 'running' : p.state === 'terminated' ? 'done' : p.state);
      el.style.setProperty('--run-color', LEVEL_COLORS[s.run_level] || '#fff');
      const rem = el.querySelector('.rem');
      rem.textContent = p.state === 'new' ? `arrives t=${spec.get(p.pid).arrival}`
        : p.state === 'terminated' ? `done t=${finishOf.get(p.pid)}` : `${p.remaining} left`;
      const tag = el.querySelector('.tag');
      const tg = tagFor.get(p.pid);
      tag.classList.toggle('show', !!tg);
      if (tg) { tag.textContent = tg[0]; tag.style.background = tg[1]; }
    }
  }

  function renderEvents(s, k) {
    const box = $('#events');
    box.innerHTML = '';
    const add = (cls, html) => {
      const d = document.createElement('div');
      d.className = 'ev ' + cls;
      d.innerHTML = html;
      box.appendChild(d);
    };
    if (k < 0) { add('idle', 'Before t=0. Press Play or step forward.'); return; }
    add('idle', `t=${s.t}`);
    for (const e of s.events) {
      const P = `<b>P${e.pid}</b>`;
      switch (e.type) {
        case 'arrive': add('arrive', `${P} arrives in L0`); break;
        case 'io_done': add('io_done', `${P} finished I/O, back to L${e.from}`); break;
        case 'boost': add('boost', 'Priority boost: all processes to L0'); break;
        case 'dispatch': add('dispatch', `${P} dispatched from L${e.from}, quantum ${e.quantum}`); break;
        case 'preempt': add('preempt', e.to > e.from
          ? `${P} used its whole quantum, demoted L${e.from} → L${e.to}`
          : `${P} used its whole quantum, stays at L${e.to} (bottom)`); break;
        case 'block': add('block', e.to < e.from
          ? `${P} blocked for I/O, promoted L${e.from} → L${e.to}`
          : `${P} blocked for I/O (stays L${e.to})`); break;
        case 'complete': add('complete', `${P} finished`); break;
      }
    }
    if (s.running === -1) add('idle', 'CPU idle');
  }

  // ---------- gantt ----------
  function drawGantt() {
    const svg = $('#gantt');
    const n = trace.ticks.length;
    const rows = trace.processes;
    const labelW = 44, rowH = 20, gap = 4, axisH = 18;
    const avail = svg.parentElement.clientWidth - labelW - 8;
    const cw = Math.max(12, Math.min(34, avail / n));
    const width = labelW + cw * n + 8;
    const height = axisH + rows.length * (rowH + gap) + 2;
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const parts = [];
    parts.push(`<defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="5" height="5" fill="#1d2433"/><rect width="2" height="5" fill="#6f86d6"/></pattern></defs>`);
    const every = cw < 16 ? 10 : 5;
    for (let t = 0; t < n; t += every)
      parts.push(`<text x="${labelW + t * cw + cw / 2}" y="12" text-anchor="middle">${t}</text>`);
    rows.forEach((p, r) => {
      const y = axisH + r * (rowH + gap);
      parts.push(`<circle cx="9" cy="${y + rowH / 2}" r="5" fill="${colorOf.get(p.pid)}"/>`);
      parts.push(`<text class="rowlabel" x="18" y="${y + rowH / 2 + 4}">P${p.pid}</text>`);
      parts.push(`<rect x="${labelW}" y="${y}" width="${cw * n}" height="${rowH}" fill="#151920" rx="3"/>`);
    });
    for (let t = 0; t <= cur; t++) {
      const s = trace.ticks[t];
      const x = labelW + t * cw;
      rows.forEach((p, r) => {
        const y = axisH + r * (rowH + gap);
        const st = s.procs[r];
        let fill = null, h = rowH, yy = y;
        if (s.running === p.pid) fill = LEVEL_COLORS[s.run_level];
        else if (st.state === 'ready') { fill = '#3a4150'; h = rowH * 0.5; yy = y + rowH * 0.25; }
        else if (st.state === 'blocked') fill = 'url(#hatch)';
        if (fill) parts.push(`<rect class="cell" x="${x + 0.5}" y="${yy}" width="${cw - 1}" height="${h}" rx="2" fill="${fill}"/>`);
      });
      if (s.events.some((e) => e.type === 'boost'))
        parts.push(`<line class="boostline" x1="${x}" x2="${x}" y1="${axisH - 4}" y2="${height}"/>`);
    }
    if (cur >= 0) parts.push(`<rect class="cursor" x="${labelW + cur * cw}" y="${axisH - 4}" width="${cw}" height="${height - axisH + 4}"/>`);
    svg.innerHTML = parts.join('');
    if (cur >= 0) {
      const sc = svg.parentElement, x = labelW + cur * cw;
      if (x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = x - sc.clientWidth + 80;
      if (x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - 40);
    }
  }

  // ---------- stats ----------
  function renderStats(s) {
    const final = new Map(trace.summary.per_process.map((p) => [p.pid, p]));
    const t = s.t;
    let html = '<tr><th>pid</th><th>arr</th><th>burst</th><th>left</th><th>lvl</th><th>resp</th><th>wait</th><th>turn</th></tr>';
    let done = 0;
    for (const p of s.procs) {
      const f = final.get(p.pid);
      const finished = p.state === 'terminated';
      if (finished) done++;
      const started = f.first_run >= 0 && f.first_run <= t;
      html += `<tr><td><span class="dot" style="background:${colorOf.get(p.pid)}"></span>P${p.pid}</td>
        <td>${f.arrival}</td><td>${f.burst}</td><td>${p.state === 'new' ? f.burst : p.remaining}</td>
        <td>${p.state === 'new' || finished ? '-' : 'L' + p.level}</td>
        <td>${started ? f.response : ''}</td><td>${finished ? f.waiting : ''}</td><td>${finished ? f.turnaround : ''}</td></tr>`;
    }
    $('#stats-table').innerHTML = html;
    $('#stats-note').textContent = `${done}/${s.procs.length} finished`;
    const avg = $('#stats-avg');
    if (done === s.procs.length) {
      const pp = trace.summary.per_process;
      const mean = (k) => (pp.reduce((a, p) => a + p[k], 0) / pp.length).toFixed(2);
      avg.innerHTML = `avg turnaround <b>${mean('turnaround')}</b> · avg response <b>${mean('response')}</b> · avg wait <b>${mean('waiting')}</b> · CPU busy <b>${trace.summary.busy_ticks}/${trace.summary.total_ticks}</b>`;
    } else {
      avg.textContent = 'Averages appear when every process has finished.';
    }
  }

  init();
})();
