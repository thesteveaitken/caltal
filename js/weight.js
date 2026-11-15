// weight.js: weigh-ins, the 7-day average, the Today weight cell and the Weight sheet.

// ---------- Weight ----------
// One weigh-in per day in `daily_metrics`, stored in kg and shown in the profile's units (lb by default).
// The Weight sheet logs for the day being viewed; the optional goal weight lives on `goals.weight_kg`.
let latestWeight = null;        // { date, weight_kg } of the newest weigh-in, or null
let trendWeights = new Map();   // date -> kg, for the Trends window
let trendWeightEdges = [];      // [date, kg] of the nearest weigh-in before and after that window
let weightDate = null;          // day the Weight sheet is editing
let weightSheetUnits = 'us';
let weightLoadedKg = null;      // the day's saved weight when the sheet opened, so an unchanged value isn't re-rounded
const WEIGHT_LIMITS_KG = [20, 400];

// Called by showApp() when a different person signs in (or a guest starts).
function resetWeightState() {
  latestWeight = null;
  trendWeights = new Map();
  trendWeightEdges = [];
  dayWeight = null;
}

const unitsNow = () => (profile?.units === 'metric' ? 'metric' : 'us');
const wUnit = (u = unitsNow()) => (u === 'metric' ? 'kg' : 'lb');
const kgTo = (kg, u = unitsNow()) => (u === 'metric' ? kg : kg / KG_PER_LB);
const toKg = (v, u = unitsNow()) => (u === 'metric' ? v : v * KG_PER_LB);
const fmtWeight = (kg, u = unitsNow()) => `${kgTo(kg, u).toFixed(1)} ${wUnit(u)}`;

// The 7-day average weight, shared by the Trends line and the Today summary. `known` is weigh-ins as
// [date, kg], sorted by date. Days without a weigh-in are filled by a straight line between the
// weigh-ins either side (any gap length); days before the first weigh-in are left out, and there is
// no average after the latest weigh-in.
const dayNum = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
function weightFilled(known, d) {
  const i = known.findIndex(([kd]) => kd >= d);
  if (i < 0) return null;                    // after the latest weigh-in
  if (known[i][0] === d) return known[i][1];
  if (i === 0) return null;                  // before the first weigh-in
  const [d0, v0] = known[i - 1], [d1, v1] = known[i];
  return v0 + (v1 - v0) * (dayNum(d) - dayNum(d0)) / (dayNum(d1) - dayNum(d0));
}
function weightAvgOn(known, d) {
  if (!known.length || d > known[known.length - 1][0]) return null;
  const near = [];
  for (let k = 0; k < 7; k++) { const v = weightFilled(known, addDays(d, -k)); if (v != null) near.push(v); }
  return mean(near);
}
// Weigh-ins from `from` to `to`, plus the nearest one on each side so gaps at the edges can be filled.
async function fetchWeightsAround(from, to) {
  const q = () => sb.from('daily_metrics').select('date, weight_kg').gt('weight_kg', 0);
  const [w, before, after] = await Promise.all([
    must(q().gte('date', from).lte('date', to)),
    must(q().lt('date', from).order('date', { ascending: false }).limit(1)),
    must(q().gt('date', to).order('date').limit(1)),
  ]);
  return {
    inRange: new Map(w.map(r => [r.date, Number(r.weight_kg)])),
    edges: [...before, ...after].map(r => [r.date, Number(r.weight_kg)]),
  };
}

// Today summary: the weigh-ins around the day being viewed (`known`, sorted), for its Weight cell.
let dayWeight = null;           // { date, known } or null
let dayWeightReq = 0;
async function loadDayWeight(date) {
  const req = ++dayWeightReq;
  try {
    const { inRange, edges } = await fetchWeightsAround(addDays(date, -6), date);
    if (req !== dayWeightReq) return;
    dayWeight = { date, known: [...edges, ...inRange].sort((a, b) => a[0] < b[0] ? -1 : 1) };
  } catch (err) {
    console.error('Could not load weights', err);
    if (req !== dayWeightReq) return;
    dayWeight = null;
  }
  renderTotals();
}
// What the Weight cell shows for a day:
//   weighed that day: the weight (and the 7-day average under it, when different);
//   between two weigh-ins, each no more than 30 days away: the 7-day average, dimmed;
//   after the latest weigh-in, if it's no more than 14 days old: that weight and its age, dimmed;
//   otherwise "Add".
function weightCellHtml() {
  const u = unitsNow(), unit = wUnit(u);
  const fig = kg => `${kgTo(kg, u).toFixed(1)}<small> ${unit}</small>`;
  // The icon says it's tappable: a pencil to change the day's weigh-in, a plus to add one.
  const PENCIL = '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>';
  const PLUS = '<path d="M12 5v14M5 12h14"/>';
  const cell = (cls, value, sub, label) =>
    `<button type="button" class="g-cell g-weight${cls}" data-weight-open aria-label="Weight: ${label}">` +
    `<span class="g-l">Weight<svg class="g-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${cls ? PLUS : PENCIL}</svg></span>` +
    `<span class="g-v">${value}</span>${sub ? `<span class="g-s">${sub}</span>` : ''}</button>`;
  const d = currentDate;
  if (!dayWeight || dayWeight.date !== d) return cell(' est', '…', '', 'loading');
  const known = dayWeight.known;
  const own = known.find(([kd]) => kd === d);
  if (own) {
    const avg = weightAvgOn(known, d);
    const showAvg = avg != null && Math.abs(kgTo(avg, u) - kgTo(own[1], u)) >= 0.05;
    return cell('', fig(own[1]), showAvg ? `avg ${kgTo(avg, u).toFixed(1)}` : '',
      `${fmtWeight(own[1], u)}${showAvg ? `, 7-day average ${kgTo(avg, u).toFixed(1)}` : ''}. Edit`);
  }
  const prev = [...known].reverse().find(([kd]) => kd < d);
  const next = known.find(([kd]) => kd > d);
  if (prev && next && dayNum(d) - dayNum(prev[0]) <= 30 && dayNum(next[0]) - dayNum(d) <= 30) {
    const avg = weightAvgOn(known, d);
    if (avg != null) return cell(' est', `~${fig(avg)}`, '7-day avg', `about ${fmtWeight(avg, u)}, 7-day average, no weigh-in this day. Add weight`);
  }
  if (prev && !next) {
    const ago = dayNum(d) - dayNum(prev[0]);
    if (ago <= 14) {
      const when = ago === 1 ? 'yesterday' : `${ago} days ago`;
      return cell(' est', fig(prev[1]), when, `${fmtWeight(prev[1], u)}, ${when}. Add weight`);
    }
  }
  return cell(' est', 'Add', '', 'none logged this day. Add weight');
}

async function loadLatestWeight() {
  try {
    const row = await must(sb.from('daily_metrics').select('date, weight_kg').order('date', { ascending: false }).limit(1));
    latestWeight = row.length && row[0].weight_kg != null ? { date: row[0].date, weight_kg: Number(row[0].weight_kg) } : null;
  } catch (err) {
    console.error(err);
  }
}
// Units come from the profile, so load it before anything shows a weight.
async function loadWeightState() {
  await loadProfile();
  await loadLatestWeight();
  renderTotals();
  if (trendsVisible()) renderTrends();
}

// A weight box in units `u`, as kg to 2 decimals; null when blank. Throws InvalidField when out of range.
function readWeight(el, u, what) {
  const raw = el.value.trim();
  if (raw === '') return null;
  const v = Number(raw), [minKg, maxKg] = WEIGHT_LIMITS_KG;
  if (!Number.isFinite(v) || toKg(v, u) < minKg || toKg(v, u) > maxKg) {
    el.setAttribute('aria-invalid', 'true'); el.focus();
    throw new InvalidField(`${what} needs to be between ${Math.ceil(kgTo(minKg, u))} and ${Math.floor(kgTo(maxKg, u))} ${wUnit(u)}`);
  }
  return Math.round(toKg(v, u) * 100) / 100;
}

// ---------- Goal weight row ----------
// The same row is in the Goals sheet and the Weight sheet; both edit goals.weight_kg. It shows 1 decimal
// in the person's units and stores kg to 2 decimals (not 1: 0.1 lb is about 0.045 kg, so pounds would
// not round-trip). A box that still shows the stored value saves it as it was, not re-rounded.
const GOAL_WEIGHT_ROWS = {
  goals:  { row: 'goalRow_weight', on: 'goalOn_weight', val: 'goalVal_weight', unit: 'goalUnit_weight', note: 'Optional · also in the Weight sheet' },
  weight: { row: 'weightGoalRow',  on: 'weightGoalOn',  val: 'weightGoalVal',  unit: 'weightGoalUnit',  note: 'Optional · a line on Trends' },
};
// Both rows' markup, written into their empty containers in index.html at load.
for (const r of Object.values(GOAL_WEIGHT_ROWS)) {
  $(r.row).innerHTML = `
      <label class="switch"><input type="checkbox" role="switch" aria-label="Goal weight" id="${r.on}"><span></span></label>
      <div class="goal-name">Goal weight<small>${r.note}</small></div>
      <input type="number" class="field-input goal-input" id="${r.val}" aria-label="Goal weight" inputmode="decimal" min="0" step="0.1">
      <span class="goal-unit" id="${r.unit}">lb</span>`;
}
function setGoalWeightOn(r, on) {
  $(r.on).checked = on;
  $(r.row).classList.toggle('off', !on);
  $(r.val).disabled = !on;
}
function setGoalWeightUnits(r, u) {
  $(r.unit).textContent = wUnit(u);
  $(r.val).setAttribute('aria-label', `Goal weight in ${wUnit(u)}`);
}
function fillGoalWeightRow(r, u) {
  setGoalWeightOn(r, !!goals.weight_kg);
  $(r.val).value = goals.weight_kg ? kgTo(goals.weight_kg, u).toFixed(1) : '';
  $(r.val).removeAttribute('aria-invalid');
  setGoalWeightUnits(r, u);
}
// The kg to save: null when switched off. Throws InvalidField when on without a valid weight.
function readGoalWeight(r, u) {
  if (!$(r.on).checked) return null;
  const el = $(r.val);
  if (goals.weight_kg && el.value.trim() === kgTo(goals.weight_kg, u).toFixed(1)) return goals.weight_kg;
  const kg = readWeight(el, u, 'Goal weight');
  if (kg === null) { el.setAttribute('aria-invalid', 'true'); el.focus(); throw new InvalidField('Enter a goal weight, or switch it off'); }
  return kg;
}
// Switching the goal on with an empty box suggests a value: `suggest()` returns text in the row's units.
function wireGoalWeightRow(r, suggest) {
  $(r.on).addEventListener('change', ev => {
    setGoalWeightOn(r, ev.target.checked);
    if (ev.target.checked && !$(r.val).value) $(r.val).value = suggest();
  });
}
wireGoalWeightRow(GOAL_WEIGHT_ROWS.goals, () => (latestWeight ? kgTo(latestWeight.weight_kg, goalWeightUnits).toFixed(1) : ''));
wireGoalWeightRow(GOAL_WEIGHT_ROWS.weight, () => $('weightVal').value);

function setWeightSheetUnits(u) {
  const input = $('weightVal'), goalInput = $('weightGoalVal');
  const conv = el => { if (el.value.trim() !== '' && Number.isFinite(Number(el.value))) el.value = kgTo(toKg(Number(el.value), weightSheetUnits), u).toFixed(1); };
  if (u !== weightSheetUnits) { conv(input); conv(goalInput); }
  weightSheetUnits = u;
  setSeg('weightUnits', b => b.dataset.units === u);
  setGoalWeightUnits(GOAL_WEIGHT_ROWS.weight, u);
  input.setAttribute('aria-label', `Weight in ${wUnit(u)}`);
}
document.querySelectorAll('#weightUnits button').forEach(b => b.addEventListener('click', () => setWeightSheetUnits(b.dataset.units)));

async function openWeight(date) {
  weightDate = date;
  const label = formatDateLabel(date);
  $('weightSub').textContent = date === todayStr() ? 'For today. One weigh-in a day.' : `For ${label}. One weigh-in a day.`;
  $('weightVal').removeAttribute('aria-invalid');
  await loadProfile();
  weightSheetUnits = unitsNow();
  setWeightSheetUnits(weightSheetUnits);
  fillGoalWeightRow(GOAL_WEIGHT_ROWS.weight, weightSheetUnits);
  $('weightVal').value = '';
  $('weightVal').placeholder = latestWeight ? kgTo(latestWeight.weight_kg, weightSheetUnits).toFixed(1) : '';
  weightLoadedKg = null;
  show($('removeWeight'), false);
  openSheet('weightOverlay');
  try {
    const day = await must(sb.from('daily_metrics').select('date, weight_kg').eq('date', date).maybeSingle());
    if (weightDate !== date) return;
    if (day && day.weight_kg != null) {
      weightLoadedKg = Number(day.weight_kg);
      $('weightVal').value = kgTo(weightLoadedKg, weightSheetUnits).toFixed(1);
      show($('removeWeight'));
    }
  } catch (err) {
    console.error(err);
    showToast('Could not load weights');
  }
}
$('closeWeight').addEventListener('click', () => closeSheet('weightOverlay'));

// After any weight change: refresh what shows it.
async function weightChanged() {
  await loadLatestWeight();
  loadDayWeight(currentDate);
  if (trendsVisible()) loadTrends();
}

$('saveWeight').addEventListener('click', async () => {
  const u = weightSheetUnits;
  let kg, goalKg;
  try {
    kg = readWeight($('weightVal'), u, 'Weight');
    goalKg = readGoalWeight(GOAL_WEIGHT_ROWS.weight, u);
  } catch (err) {
    if (err instanceof InvalidField) { showToast(err.message); return; }
    throw err;
  }
  // Showing a weight in other units rounds it; if the box still shows the saved value, keep it exactly.
  if (kg !== null && weightLoadedKg !== null && kgTo(weightLoadedKg, u).toFixed(1) === $('weightVal').value.trim()) kg = null;
  const goalChanged = (goalKg ?? null) !== (goals.weight_kg ?? null)
    && !(goalKg && goals.weight_kg && Math.abs(goalKg - goals.weight_kg) < 0.05);
  const unitsChanged = u !== unitsNow();
  const hadWeight = !$('removeWeight').hidden;
  if (kg === null && !goalChanged && !unitsChanged) {
    if (!hadWeight || weightLoadedKg === null) { $('weightVal').setAttribute('aria-invalid', 'true'); $('weightVal').focus(); showToast('Enter a weight'); return; }
    closeSheet('weightOverlay');
    return;
  }
  await withBusy($('saveWeight'), 'Saving…', async () => {
    try {
      const now = new Date().toISOString();
      if (kg !== null) {
        await must(sb.from('daily_metrics').upsert({ user_id: user.id, date: weightDate, weight_kg: kg, source: 'manual', updated_at: now }, { onConflict: 'user_id,date' }));
      }
      if (goalChanged) {
        // Send every goal, so a first goals row doesn't switch the others off.
        const { calories, protein, fluid_ml, creatine_g } = goals;
        await must(sb.from('goals').upsert({ user_id: user.id, calories, protein, fluid_ml, creatine_g, weight_kg: goalKg, updated_at: now }));
        goals = { ...goals, weight_kg: goalKg };
      }
      if (unitsChanged) {
        await must(sb.from('profiles').upsert({ user_id: user.id, units: u, updated_at: now }));
        profile = { ...(profile || {}), units: u };
      }
      closeSheet('weightOverlay');
      showToast(kg !== null ? `Weight saved: ${fmtWeight(kg, u)}` : 'Saved');
      weightChanged();
    } catch (err) {
      console.error(err);
      showToast('Could not save. Try again.');
    }
  });
});

$('removeWeight').addEventListener('click', async () => {
  const date = weightDate;
  try {
    await must(sb.from('daily_metrics').delete().eq('date', date));
    closeSheet('weightOverlay');
    showToast('Weigh-in removed');
    weightChanged();
  } catch (err) {
    console.error(err);
    showToast('Could not remove. Try again.');
  }
});
