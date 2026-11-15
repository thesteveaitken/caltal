// trends.js: the Trends view and its inline SVG charts.

// ---------- Trends ----------
// Bar charts drawn as inline SVG (no chart library). Window = last 7 or 28 days ending at
// trendEnd. A day counts only if calories were logged (fluids and creatine also count a day
// that only has water or creatine). Today is "in progress": drawn with a ghost up to the goal
// and left out of averages and counts. Alcohol is weekly (last 8 calendar weeks, Mon-Sun).
let trendDays = 7;
let trendEnd = null;
let trendSel = null;     // selected day (YYYY-MM-DD)
let trendSelWk = null;   // selected week start for the alcohol chart
let trendRows = new Map();
let trendReq = 0;
let trendCreatineStart = null; // date of the first creatine ever logged; earlier days are not counted as misses
let creatineStreak = 0;         // days in a row at the creatine goal, up to today (or yesterday while today is still to do)

// Called by showApp() when a different person signs in (or a guest starts).
function resetTrendsState() {
  trendRows = new Map();
  trendCreatineStart = null;
  creatineStreak = 0;
}

const TREND_CARDS = [
  { id: 'cal', title: 'Calories', key: 'calories', goalKey: 'calories', dir: 'ceil',  unit: 'cal', tile: 'days under', avg: true },
  { id: 'wt',  title: 'Weight', kind: 'weight' },
  { id: 'pro', title: 'Protein',  key: 'protein',  goalKey: 'protein',  dir: 'floor', unit: 'g',   tile: 'days at goal', avg: true },
  { id: 'flu', title: 'Fluids',   key: 'fluid_ml', goalKey: 'fluid_ml', dir: 'floor', unit: 'L', div: 1000, tile: 'days at goal', avg: true },
  { id: 'cf',  title: 'Carbs and fat', unit: 'g', stack: [['carbs', 'tb-carbs', 'Carbs'], ['fat', 'tb-fat', 'Fat']] },
  { id: 'cr',  title: 'Creatine', kind: 'dots', key: 'creatine_g', goalKey: 'creatine_g', unit: 'g' },
  { id: 'alc', title: 'Alcohol, weekly', kind: 'weekly', key: 'alcohol', unit: 'drinks' },
];

function fmtAxis(v) { return v >= 1000 ? (Math.round(v / 100) / 10) + 'k' : String(+v.toFixed(1)); }
function fmtV(cfg, v) { return (cfg.div ? String(+(v / cfg.div).toFixed(2)) : (cfg.unit === 'drinks' ? String(+v.toFixed(1)) : fmtNum(v))) + ' ' + cfg.unit; }
function weekStartOf(date) {
  const dow = (dayStart(date).getDay() + 6) % 7; // Monday = 0
  return addDays(date, -dow);
}
const fmtMD = d => { const [, mo, da] = d.split('-'); return `${Number(mo)}/${da}`; };

function trendWindow() {
  if (!trendEnd) trendEnd = todayStr();
  const days = [];
  for (let i = trendDays - 1; i >= 0; i--) days.push(addDays(trendEnd, -i));
  return days;
}
function trendWeeks() {
  const w0 = weekStartOf(trendEnd || todayStr());
  const weeks = [];
  for (let i = 7; i >= 0; i--) weeks.push(addDays(w0, -7 * i));
  return weeks;
}

function trendRangeLabel(days) {
  const a = dayStart(days[0]), b = dayStart(days[days.length - 1]);
  const yr = a.getFullYear() !== new Date().getFullYear() || b.getFullYear() !== new Date().getFullYear();
  const md = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  const end = sameMonth ? String(b.getDate()) : md(b);
  return `${md(a)} – ${end}${yr ? ', ' + b.getFullYear() : ''}`;
}

async function loadTrends() {
  const days = trendWindow();
  const weeks = trendWeeks();
  const req = ++trendReq;
  $('trendRange').textContent = trendRangeLabel(days);
  $('trendNext').disabled = trendEnd >= todayStr();
  const from = [addDays(days[0], -6), weeks[0]].sort()[0];
  const to = [addDays(weeks[7], 6), todayStr()].sort()[0];
  try {
    // 6 extra days before the window so the 7-day average is complete on the first bar.
    const rows = await must(sb.from('daily_totals')
      .select('date, calories, protein, carbs, fat, fluid_ml, creatine_g, alcohol')
      .gte('date', from).lte('date', to).order('date'));
    if (req !== trendReq) return;
    trendRows = new Map(rows.map(r => [r.date, numeric(r)]));
    // Weigh-ins, with 6 days before the window for the 7-day average, plus the nearest weigh-in on
    // each side of that range so gaps at the edges can be interpolated. A failure only empties the card.
    try {
      const { inRange, edges } = await fetchWeightsAround(addDays(days[0], -6), days[days.length - 1]);
      if (req !== trendReq) return;
      trendWeights = inRange;
      trendWeightEdges = edges;
    } catch (err) { console.error('Could not load weights', err); trendWeights = new Map(); trendWeightEdges = []; }
    if (!trendCreatineStart && goals.creatine_g) {
      const first = await must(sb.from('log_entries').select('date').gt('creatine_g', 0).order('date').limit(1));
      if (req !== trendReq) return;
      trendCreatineStart = first.length ? first[0].date : null;
    }
    creatineStreak = 0;
    if (goals.creatine_g) {
      // Days at goal, newest first; enough to count a streak of over a year.
      // A failure here only hides the streak.
      try {
        const hits = await must(sb.from('daily_totals').select('date').gte('creatine_g', goals.creatine_g)
          .lte('date', todayStr()).order('date', { ascending: false }).limit(400));
        if (req !== trendReq) return;
        const set = new Set(hits.map(h => h.date));
        let d = todayStr();
        if (!set.has(d)) d = addDays(d, -1);
        while (set.has(d)) { creatineStreak++; d = addDays(d, -1); }
      } catch (err) { console.error('Could not load creatine streak', err); }
    }
  } catch (err) {
    console.error(err);
    if (req !== trendReq) return;
    trendRows = new Map();
    showToast('Could not load trends');
  }
  renderTrends();
}

// Value for one day, or null when the day is not tracked for this chart.
function dayVal(cfg, date) {
  const r = trendRows.get(date);
  if (!r) return null;
  const logged = r.calories > 0;
  if (cfg.key === 'fluid_ml') return r.fluid_ml > 0 ? r.fluid_ml : null;
  if (cfg.key === 'creatine_g') return (logged || r.creatine_g > 0) ? r.creatine_g : null;
  if (!logged) return null;
  return cfg.stack ? r.carbs + r.fat : r[cfg.key];
}

function renderTrends() {
  const days = trendWindow();
  const today = todayStr();
  const cards = TREND_CARDS.filter(c => (c.kind !== 'dots' || goals.creatine_g) && (c.kind !== 'weight' || latestWeight || goals.weight_kg));
  const box = $('trendCards');
  box.innerHTML = cards.map(trendCardShell).join('');

  box.querySelectorAll('.trend-card').forEach(card => {
    const cfg = TREND_CARDS.find(c => c.id === card.dataset.card);
    TREND_RENDERERS[trendCardKind(cfg)]({
      card, cfg, days, today,
      goal: cfg.goalKey ? (goals[cfg.goalKey] || null) : null,
      chart: card.querySelector('.trend-chart'),
      ro: card.querySelector('.trend-readout'),
      stats: card.querySelector('.trend-stats'),
      foot: card.querySelector('.trend-foot'),
    });
  });
}

// One card's markup: title and legend, then empty rows its renderer fills.
function trendCardShell(cfg) {
  const goal = cfg.goalKey ? goals[cfg.goalKey] : null;
  let title = cfg.title, legend = '';
  if (cfg.stack) legend = cfg.stack.map(([k, , lab]) => `<span class="sw" style="background:var(--${k})"></span>${lab}`).join('');
  else if (cfg.kind === 'weight') legend = ['line: 7-day avg', goals.weight_kg ? `goal ${fmtWeight(goals.weight_kg)}` : ''].filter(Boolean).join(' · ');
  else if (cfg.kind === 'weekly') { title = trendDays === 7 ? 'Alcohol' : 'Alcohol, by week'; legend = 'standard drinks'; }
  else if (cfg.kind !== 'dots') {
    const g = !goal ? '' : cfg.dir === 'ceil' ? `limit ${fmtNum(goal)}` : `goal ${fmtV(cfg, goal)}`;
    legend = [g, cfg.avg ? 'line: 7-day avg' : ''].filter(Boolean).join(' · ');
  }
  return `
    <div class="trend-card" data-card="${cfg.id}">
      <div class="trend-head"><span class="trend-title">${title}</span><span class="trend-legend">${legend}</span></div>
      <div class="trend-stats"></div>
      <div class="trend-readout"></div>
      <div class="trend-chart"></div>
      <div class="trend-foot"></div>
    </div>`;
}

// Which renderer draws a card. Alcohol is by day on the 7-day view and by week on the 4-week view.
function trendCardKind(cfg) {
  if (cfg.kind === 'weekly') return trendDays === 7 ? 'alcDay' : 'alcWeek';
  return cfg.kind || (cfg.stack ? 'stack' : 'goal');
}

// Shared pieces of a card: a stat tile, the readout's "Open day" link, and a long day label.
const statTile = (n, l) => `<div><div class="stat-n">${n}</div><div class="stat-l">${l}</div></div>`;
const openDayLink = d => `<a data-open="${d}">Open day ›</a>`;
const longDayLabel = d => dayStart(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

// Each renderer gets the card's parts: { card, cfg, goal, days, today, chart, ro (readout), stats, foot }.
function renderAlcoholByDay({ cfg, days, today, chart, ro, stats, foot }) {
  const items = days.map(d => { const r = trendRows.get(d); return { id: d, val: r ? (r.alcohol || 0) : null, live: d === today }; });
  drawTrendChart(chart, { ...cfg, kind: 'alcDay' }, items, null);
  const si = days.indexOf(trendSel);
  ro.innerHTML = si >= 0 ? `<b>${longDayLabel(trendSel)}</b> · ${items[si].val === null ? 'no entries' : fmtV(cfg, items[si].val)}${openDayLink(trendSel)}` : '';
  const total = items.reduce((a, i) => a + (i.val || 0), 0);
  stats.innerHTML = statTile(String(+total.toFixed(1)), 'drinks, these 7 days') +
    statTile(`${items.filter(i => i.val > 0).length} of 7`, 'days with a drink');
  foot.textContent = 'By week on the 4 weeks view.';
}

function renderAlcoholByWeek({ cfg, today, chart, ro, stats }) {
  const items = trendWeeks().map(w => {
    let sum = 0, logged = false;
    for (let k = 0; k < 7; k++) {
      const r = trendRows.get(addDays(w, k));
      if (r && r.calories > 0) logged = true;
      if (r) sum += r.alcohol || 0;
    }
    return { id: w, val: logged || sum > 0 ? sum : null, live: addDays(w, 6) >= today, lab: fmtMD(w) };
  });
  drawTrendChart(chart, cfg, items, null);
  const sel = items.find(i => i.id === trendSelWk);
  ro.innerHTML = sel ? `<b>Week of ${longDayLabel(sel.id)}</b> · ${sel.val === null ? 'no entries' : fmtV(cfg, sel.val)}` : '';
  const done = items.filter(i => i.val !== null && !i.live).map(i => i.val);
  const last = items[items.length - 1];
  stats.innerHTML = statTile(done.length ? String(+mean(done).toFixed(1)) : '—', 'avg a week') +
    statTile(last.val === null ? '—' : String(+last.val.toFixed(1)), last.live ? 'this week so far' : 'latest week');
}

// Dots are weigh-ins. The line is the 7-day average (weightAvgOn: gaps filled by straight lines,
// stops at the latest weigh-in).
function renderWeightCard({ cfg, days, today, chart, ro, stats, foot }) {
  const u = unitsNow();
  const known = [...trendWeightEdges, ...trendWeights].sort((a, b) => a[0] < b[0] ? -1 : 1);
  const items = days.map(d => {
    const kg = trendWeights.get(d);
    const avg = weightAvgOn(known, d);
    return { id: d, val: kg == null ? null : kgTo(kg, u), avg: avg == null ? null : kgTo(avg, u), live: d === today };
  });
  const goalV = goals.weight_kg ? kgTo(goals.weight_kg, u) : null;
  drawWeightChart(chart, cfg, items, goalV, wUnit(u));
  const si = days.indexOf(trendSel);
  const editLink = d => `<a data-weight="${d}">${trendWeights.has(d) ? 'Edit' : 'Add weight'} ›</a>`;
  ro.innerHTML = si >= 0 ? `<b>${longDayLabel(trendSel)}</b> · ${items[si].val == null ? 'no weigh-in' : `${items[si].val.toFixed(1)} ${wUnit(u)}`}${items[si].avg != null ? ` · avg ${items[si].avg.toFixed(1)}` : ''}${editLink(trendSel)}` : '';
  const withAvg = items.filter(i => i.avg != null);
  const latest = latestWeight ? kgTo(latestWeight.weight_kg, u) : null;
  const sign = v => (v > 0.05 ? '+' : v < -0.05 ? '−' : '±') + Math.abs(v).toFixed(1);
  const tiles = [];
  if (latest != null) tiles.push(statTile(latest.toFixed(1), `latest, ${wUnit(u)}`));
  if (withAvg.length >= 2) tiles.push(statTile(sign(withAvg[withAvg.length - 1].avg - withAvg[0].avg), 'change in avg'));
  if (latest != null && goalV) tiles.push(statTile(Math.abs(latest - goalV) < 0.05 ? 'At goal' : Math.abs(latest - goalV).toFixed(1), Math.abs(latest - goalV) < 0.05 ? 'nice work' : `${wUnit(u)} to goal`));
  stats.innerHTML = tiles.join('');
  foot.textContent = items.some(i => i.val != null) ? '' : 'No weigh-ins in this window.';
}

// Compact habit strip: no readout/stat rows, the summary lives in the header.
function renderCreatineCard({ card, cfg, goal, days, today, chart, ro, stats }) {
  const eff = days.map(d => (trendCreatineStart && d >= trendCreatineStart) ? dayVal(cfg, d) : null);
  drawDotStrip(chart, cfg, days, eff, goal, today);
  const head = card.querySelector('.trend-legend');
  const si = days.indexOf(trendSel);
  const done = eff.filter((v, i) => v !== null && days[i] !== today);
  if (si >= 0) head.innerHTML = `${longDayLabel(trendSel)} · ${eff[si] === null ? 'not tracked' : (eff[si] > 0 ? fmtV(cfg, eff[si]) : 'none')} ${openDayLink(trendSel)}`;
  else head.innerHTML = !trendCreatineStart ? 'No creatine logged yet' : [
    done.length ? `<b>${done.filter(v => v >= goal).length} of ${done.length}</b> days at goal` : '',
    creatineStreak >= 2 ? `<b>${creatineStreak}</b> days in a row` : '',
  ].filter(Boolean).join(' · ');
  ro.innerHTML = ''; stats.innerHTML = '';
}

// Carbs and fat: stacked bars, no goal.
function renderStackCard({ cfg, days, today, chart, ro, stats }) {
  const parts = days.map(d => (dayVal(cfg, d) === null ? null : cfg.stack.map(([k]) => trendRows.get(d)[k])));
  const items = days.map((d, i) => ({ id: d, val: dayVal(cfg, d), parts: parts[i], live: d === today }));
  drawTrendChart(chart, cfg, items, null);
  const si = days.indexOf(trendSel);
  ro.innerHTML = si >= 0 ? `<b>${longDayLabel(trendSel)}</b> · ${parts[si] ? cfg.stack.map(([, , lab], j) => `${lab} ${fmtNum(parts[si][j])} g`).join(' · ') : 'no entries'}${openDayLink(trendSel)}` : '';
  const done = days.map((d, i) => (parts[i] && d !== today) ? parts[i] : null).filter(Boolean);
  stats.innerHTML = cfg.stack.map(([, , lab], j) => statTile(done.length ? fmtNum(mean(done.map(p => p[j]))) + ' g' : '—', `${lab.toLowerCase()}, avg a day`)).join('');
}

// Goal bar charts (calories, protein, fluids), with the 7-day average line.
function renderGoalCard({ cfg, goal, days, today, chart, ro, stats }) {
  const vals = days.map(d => dayVal(cfg, d));
  const div = cfg.div || 1;
  const avgs = days.map(d => {
    const w = [];
    for (let k = 0; k < 7; k++) {
      const dd = addDays(d, -k);
      if (dd === today) continue;
      const v = dayVal(cfg, dd);
      if (v !== null) w.push(v);
    }
    return mean(w);
  });
  const items = days.map((d, i) => ({ id: d, val: vals[i] === null ? null : vals[i] / div, live: d === today, avg: avgs[i] === null ? null : avgs[i] / div }));
  drawTrendChart(chart, cfg, items, goal ? goal / div : null);
  const si = days.indexOf(trendSel);
  ro.innerHTML = si >= 0 ? `<b>${longDayLabel(trendSel)}</b> · ${vals[si] === null ? 'no entries' : fmtV(cfg, vals[si])}${openDayLink(trendSel)}` : '';
  const done = vals.filter((v, i) => v !== null && days[i] !== today);
  const avg = mean(done);
  const ok = done.filter(v => cfg.dir === 'ceil' ? v <= goal : v >= goal).length;
  stats.innerHTML = statTile(avg === null ? '—' : fmtV(cfg, avg), 'avg a day') +
    (goal ? statTile(done.length ? ok + ' of ' + done.length : '—', cfg.tile) : '');
}

const TREND_RENDERERS = {
  alcDay: renderAlcoholByDay, alcWeek: renderAlcoholByWeek, weight: renderWeightCard,
  dots: renderCreatineCard, stack: renderStackCard, goal: renderGoalCard,
};

// "Mo".."Su", or "Today".
function dayAbbr(date, isToday) {
  return isToday ? 'Today' : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][dayStart(date).getDay()];
}

// Round an axis step up to 1, 2, 2.5, 5 or 10 times a power of ten.
function niceStep(raw) {
  const mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

// Labels under a by-day chart, so every chart on the page lines up by day: weekday names for a
// week; for longer windows a dot per day with the first and last dates. `dotY` is the dots' centre.
function chartDayAxis(items, cx, sel, H, dotY) {
  const n = items.length;
  let g = '';
  if (n <= 7) {
    items.forEach((it, i) => {
      const strong = it.live || it.id === sel;
      g += `<text class="t-ax${strong ? ' strong' : ''}" x="${cx(i)}" y="${H - 9}" text-anchor="middle">${dayAbbr(it.id, it.live)}</text>`;
    });
  } else {
    items.forEach((it, i) => {
      const s = it.id === sel;
      g += `<circle cx="${cx(i)}" cy="${dotY}" r="${s ? 3.5 : 2}" fill="${s ? 'var(--text)' : 'var(--text-dim)'}"/>`;
    });
    g += `<text class="t-ax" x="${cx(0)}" y="${H - 3}" text-anchor="middle">${fmtMD(items[0].id)}</text>`;
    g += `<text class="t-ax" x="${cx(n - 1)}" y="${H - 3}" text-anchor="middle">${fmtMD(items[n - 1].id)}</text>`;
  }
  return g;
}

// items: [{ id, val (display units or null), parts?, live?, avg?, lab? }]. goal in display units.
function drawTrendChart(el, cfg, items, goal) {
  const weekly = cfg.kind === 'weekly';
  const alc = cfg.key === 'alcohol';
  const W = Math.max(240, el.clientWidth || 320), H = 180;
  const m = { l: 34, r: 6, t: 10, b: 30 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const n = items.length, slot = pw / n, bw = Math.min(weekly ? 22 : 26, slot * 0.6);
  const sel = weekly ? trendSelWk : trendSel;

  const top = Math.max(goal || 0, ...items.map(i => i.val || 0), ...items.map(i => i.avg || 0), alc ? 3 : 1e-6);
  const step = niceStep(top / 4);
  const yMax = Math.ceil(top * 1.05 / step) * step;
  const y = v => m.t + ph * (1 - v / yMax);
  const cx = i => m.l + slot * i + slot / 2;

  let g = '';
  for (let v = 0; v <= yMax + step / 1000; v += step) {
    g += `<line class="t-grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    g += `<text class="t-ax" x="${m.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${fmtAxis(v)}</text>`;
  }

  items.forEach((it, i) => {
    if (it.val === null) return;
    const x = cx(i) - bw / 2, rx = Math.min(5, bw / 2), isSel = it.id === sel;
    if (weekly && it.val === 0) { g += `<text class="t-ax" x="${cx(i)}" y="${y(0) - 4}" text-anchor="middle">0</text>`; return; }
    if (alc && it.val === 0) return;
    const h = Math.max(2, ph * it.val / yMax);
    if (cfg.stack) {
      const tot = it.parts.reduce((a, b) => a + b, 0) || 1;
      let yy = y(0);
      it.parts.forEach((pv, j) => {
        const ph2 = h * pv / tot;
        yy -= ph2;
        g += `<rect class="${cfg.stack[j][1]}" opacity="${it.live ? 0.45 : 1}" x="${x}" y="${yy}" width="${bw}" height="${Math.max(0, ph2)}" rx="2"/>`;
      });
      if (isSel) g += `<rect class="tb-selring" x="${x}" y="${y(it.val)}" width="${bw}" height="${h}" rx="2"/>`;
      return;
    }
    if (alc) {
      g += `<rect class="${it.live ? 'tb-alc-live' : 'tb-alc'}${isSel ? ' tb-sel' : ''}" x="${x}" y="${y(it.val)}" width="${bw}" height="${h}" rx="${rx}"/>`;
      return;
    }
    // Amber = counts toward / met; crimson = over the limit; grey = short of a floor goal.
    // Today is unfinished: a dashed outline, unless it is already over (or already met).
    let cls;
    if (cfg.dir === 'ceil' && goal && it.val > goal) cls = 'tb-over';
    else if (it.live) cls = (goal && cfg.dir !== 'ceil' && it.val >= goal) ? 'tb-good' : 'tb-live';
    else if (cfg.dir === 'ceil' || (goal && it.val >= goal)) cls = 'tb-good';
    else cls = 'tb-miss';
    g += `<rect class="${cls}${isSel ? ' tb-sel' : ''}" x="${x}" y="${y(it.val)}" width="${bw}" height="${h}" rx="${rx}"/>`;
    // A dark cap marks the value on amber and "short" bars, so the mark passes contrast (amber is 2:1 on paper).
    if (cls === 'tb-miss' || cls === 'tb-good') g += `<rect class="tb-cap" x="${x}" y="${y(it.val)}" width="${bw}" height="${Math.min(3, h)}" rx="1.5"/>`;
  });

  if (goal) g += `<line class="tg-line" x1="${m.l}" x2="${W - m.r}" y1="${y(goal)}" y2="${y(goal)}"/>`;

  const pts = items.map((it, i) => it.avg == null ? null : `${cx(i)},${y(it.avg)}`).filter(Boolean);
  if (cfg.avg && pts.length > 1) g += `<polyline class="ta-line" points="${pts.join(' ')}"/>`;

  if (weekly) {
    items.forEach((it, i) => { g += `<text class="t-ax" x="${cx(i)}" y="${H - 6}" text-anchor="middle">${it.lab}</text>`; });
  } else g += chartDayAxis(items, cx, sel, H, m.t + ph + 12);

  items.forEach((it, i) => {
    g += `<rect class="tb-hit" ${weekly ? 'data-wk' : 'data-date'}="${it.id}" x="${m.l + slot * i}" y="0" width="${slot}" height="${H}"/>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${cfg.title}">${g}</svg>`;
}

// Weight: its own scale (not from zero) so small changes show. Dots are weigh-ins, the line is the
// 7-day average, and the goal is a dashed line when it is near enough to fit without flattening the data.
function drawWeightChart(el, cfg, items, goal, unit) {
  const W = Math.max(240, el.clientWidth || 320), H = 170;
  const m = { l: 34, r: 6, t: 10, b: 30 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const n = items.length, slot = pw / n;
  const vals = items.flatMap(i => [i.val, i.avg]).filter(v => v != null);
  if (!vals.length) { el.innerHTML = ''; return; }
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const spanData = Math.max(hi - lo, unit === 'kg' ? 1 : 2);
  const showGoal = goal != null && goal >= lo - spanData * 1.5 && goal <= hi + spanData * 1.5;
  if (showGoal) { lo = Math.min(lo, goal); hi = Math.max(hi, goal); }
  const span = Math.max(hi - lo, unit === 'kg' ? 1 : 2);
  const step = niceStep(span / 3);
  const yMin = Math.floor((lo - span * 0.1) / step) * step, yMax = Math.ceil((hi + span * 0.1) / step) * step;
  const y = v => m.t + ph * (1 - (v - yMin) / (yMax - yMin));
  const cx = i => m.l + slot * i + slot / 2;
  let g = '';
  for (let v = yMin; v <= yMax + step / 1000; v += step) {
    g += `<line class="t-grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    g += `<text class="t-ax" x="${m.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${+v.toFixed(1)}</text>`;
  }
  if (showGoal) g += `<line class="tg-line" x1="${m.l}" x2="${W - m.r}" y1="${y(goal)}" y2="${y(goal)}"/>`;
  // Average line, broken where there is no average.
  let seg = [];
  const flush = () => { if (seg.length > 1) g += `<polyline class="tw-line" points="${seg.join(' ')}"/>`; seg = []; };
  items.forEach((it, i) => { if (it.avg == null) flush(); else seg.push(`${cx(i)},${y(it.avg)}`); });
  flush();
  const r = n > 7 ? 3.5 : 5;
  items.forEach((it, i) => {
    if (it.val == null) return;
    g += `<circle class="tw-dot" cx="${cx(i)}" cy="${y(it.val)}" r="${r}"/>`;
    if (it.id === trendSel) g += `<circle class="tb-selring" cx="${cx(i)}" cy="${y(it.val)}" r="${r + 3.5}"/>`;
  });
  g += chartDayAxis(items, cx, trendSel, H, m.t + ph + 12);
  items.forEach((it, i) => { g += `<rect class="tb-hit" data-date="${it.id}" x="${m.l + slot * i}" y="0" width="${slot}" height="${H}"/>`; });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${cfg.title} in ${unit}">${g}</svg>`;
}

// Creatine dots, one per day: amber = taken, half amber = some, hollow ring = missed, dashed ring =
// today still to do, tiny dot = not tracked. 7 days: one row with weekday letters. 4 weeks: a grid of 4 rows of 7 consecutive
// days (each column is one weekday, each row labelled with its first date), so weekly patterns show.
function drawDotStrip(el, cfg, days, vals, goal, today) {
  const W = Math.max(240, el.clientWidth || 320), n = days.length, grid = n > 7;
  const labW = grid ? 40 : 6, r = 6, slot = (W - labW - r) / 7;
  const head = grid ? 18 : 0, rowH = grid ? 34 : 34, rows = Math.ceil(n / 7);
  const H = grid ? head + rows * rowH : 48;
  const rad = Math.min(11, slot * 0.36);
  let g = '';
  const dot = (i, x, y) => {
    const d = days[i], v = vals[i], live = d === today, sel = d === trendSel;
    let s = '';
    if (v === null) s = `<circle cx="${x}" cy="${y}" r="2" fill="var(--text-dim)"/>`;
    else if (v >= goal) s = `<circle cx="${x}" cy="${y}" r="${rad}" fill="var(--creatine)"/>`;
    else if (v > 0) s = `<circle cx="${x}" cy="${y}" r="${rad}" fill="var(--creatine)" opacity="0.5"/>`;
    else if (live) s = `<circle cx="${x}" cy="${y}" r="${rad - 1}" fill="none" stroke="var(--text-dim)" stroke-width="1.5" stroke-dasharray="3 3"/>`;
    else s = `<circle cx="${x}" cy="${y}" r="${rad - 1}" fill="none" stroke="var(--bar-light)" stroke-width="2"/>`;
    if (sel) s += `<circle cx="${x}" cy="${y}" r="${rad + 3}" fill="none" stroke="var(--text)" stroke-width="1.5"/>`;
    return s;
  };
  const cx = c => labW + slot * c + slot / 2;
  if (!grid) {
    days.forEach((d, i) => {
      g += dot(i, cx(i), 14);
      g += `<text class="t-ax${d === today || d === trendSel ? ' strong' : ''}" x="${cx(i)}" y="${H - 3}" text-anchor="middle">${dayAbbr(d, d === today)}</text>`;
      g += `<rect class="tb-hit" data-date="${d}" x="${labW + slot * i}" y="0" width="${slot}" height="${H}"/>`;
    });
  } else {
    for (let c = 0; c < 7; c++) g += `<text class="t-ax" x="${cx(c)}" y="11" text-anchor="middle">${dayAbbr(days[c], false)}</text>`;
    for (let row = 0; row < rows; row++) {
      const y = head + row * rowH + rowH / 2;
      g += `<text class="t-ax" x="0" y="${y + 4}">${fmtMD(days[row * 7])}</text>`;
      for (let c = 0; c < 7 && row * 7 + c < n; c++) {
        const i = row * 7 + c;
        g += dot(i, cx(c), y);
        g += `<rect class="tb-hit" data-date="${days[i]}" x="${labW + slot * c}" y="${head + row * rowH}" width="${slot}" height="${rowH}"/>`;
      }
    }
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${cfg.title}">${g}</svg>`;
}

$('trendCards').addEventListener('click', ev => {
  const wEdit = ev.target.closest('[data-weight]');
  if (wEdit) { openWeight(wEdit.dataset.weight); return; }
  const open = ev.target.closest('[data-open]');
  if (open) {
    currentDate = open.dataset.open;
    switchView('today');
    refreshDateUI();
    return;
  }
  const hit = ev.target.closest('.tb-hit');
  if (!hit) return;
  if (hit.dataset.wk) trendSelWk = trendSelWk === hit.dataset.wk ? null : hit.dataset.wk;
  else trendSel = trendSel === hit.dataset.date ? null : hit.dataset.date;
  renderTrends();
});
document.querySelectorAll('#trendSeg button').forEach(b => b.addEventListener('click', () => {
  trendDays = Number(b.dataset.days);
  setSeg('trendSeg', x => x === b);
  trendSel = null; trendSelWk = null;
  loadTrends();
}));
$('trendPrev').addEventListener('click', () => { trendEnd = addDays(trendWindow()[trendDays - 1], -trendDays); trendSel = null; trendSelWk = null; loadTrends(); });
$('trendNext').addEventListener('click', () => {
  const next = addDays(trendWindow()[trendDays - 1], trendDays);
  trendEnd = next > todayStr() ? todayStr() : next;
  trendSel = null; trendSelWk = null;
  loadTrends();
});
let trendResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(trendResizeTimer);
  trendResizeTimer = setTimeout(() => {
    if (trendsVisible()) renderTrends();
  }, 150);
});
