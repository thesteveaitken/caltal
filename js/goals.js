// goals.js: goals, the Today summary (hero, tally, goal grid), the Goals sheet and its helper.

// ---------- Goals and the Today summary ----------
// A null goal means "off": it is hidden from the summary. Creatine defaults to off.
// Someone with no saved goals gets only a neutral calorie ceiling; everything else is off until they turn it on.
const DEFAULT_GOALS = { calories: 2000, protein: null, fluid_ml: null, creatine_g: null, weight_kg: null };
// Starting values offered when a goal is switched on in the Goals sheet.
const GOAL_STARTERS = { calories: 2000, protein: 100, fluid_ml: 2500, creatine_g: 5 };
let goals = { ...DEFAULT_GOALS };

// Called by showApp() when a different person signs in (or a guest starts).
function resetGoalsState() {
  goals = { ...DEFAULT_GOALS };
  profile = undefined;
}

async function loadGoals() {
  try {
    const row = await must(sb.from('goals').select('calories, protein, fluid_ml, creatine_g, weight_kg').maybeSingle());
    goals = row ? {
      calories: row.calories === null ? null : Number(row.calories),
      protein: row.protein === null ? null : Number(row.protein),
      fluid_ml: row.fluid_ml === null ? null : Number(row.fluid_ml),
      creatine_g: row.creatine_g === null ? null : Number(row.creatine_g),
      weight_kg: row.weight_kg == null ? null : Number(row.weight_kg),
    } : { ...DEFAULT_GOALS };
  } catch (err) {
    console.error(err);
    goals = { ...DEFAULT_GOALS };
  }
  renderTotals();
}

function renderTotals() {
  const t = entries.reduce((a, e) => {
    a.cal += e.calories; a.p += e.protein; a.c += e.carbs; a.f += e.fat;
    a.fluid += e.fluid_ml || 0; a.cr += e.creatine_g || 0;
    return a;
  }, { cal: 0, p: 0, c: 0, f: 0, fluid: 0, cr: 0 });

  // Hero: calories so far, large; left or over, secondary. With no calorie goal, just the number.
  const goal = goals.calories;
  $('totalCal').textContent = fmtNum(t.cal);
  $('calGoal').textContent = goal ? '/ ' + fmtNum(goal) : 'cal';
  const leftWrap = $('calLeftWrap');
  leftWrap.style.display = goal ? '' : 'none';
  if (goal) {
    const remaining = Math.round(goal - t.cal);
    $('calLeft').textContent = Math.abs(remaining).toLocaleString();
    $('calLeftLabel').textContent = remaining < 0 ? 'over' : 'left';
  }
  $('hero').classList.toggle('over', !!goal && t.cal > goal);
  tallyState = { cal: t.cal, goal };
  renderTally();

  // Goal grid: goals that are on (with a progress bar), then plain figures with no goal.
  const cell = (label, fig, val, target) => {
    if (!target) return `<div class="g-cell"><span class="g-l">${label}</span><span class="g-v">${fig}</span></div>`;
    const done = val >= target;
    return `<div class="g-cell${done ? ' done' : ''}"><span class="g-l">${label}</span><span class="g-v">${fig}</span>` +
      `<div class="g-bar"><i style="width:${Math.min(100, val / target * 100)}%"></i></div></div>`;
  };
  const litres = ml => +(ml / 1000).toFixed(2);
  const cells = [];
  if (goals.protein) cells.push(cell('Protein', `${Math.round(t.p)}<small>/${goals.protein}g</small>`, t.p, goals.protein));
  if (goals.fluid_ml) cells.push(cell('Fluids', `${litres(t.fluid)}<small>/${litres(goals.fluid_ml)}L</small>`, t.fluid, goals.fluid_ml));
  if (goals.creatine_g) {
    const fig = t.cr >= goals.creatine_g ? `Done<small> ${round1(t.cr)}g</small>` : `${round1(t.cr)}<small>/${goals.creatine_g}g</small>`;
    cells.push(cell('Creatine', fig, t.cr, goals.creatine_g));
  }
  if (!goals.protein) cells.push(cell('Protein', `${Math.round(t.p)}<small> g</small>`));
  cells.push(cell('Carbs', `${Math.round(t.c)}<small> g</small>`));
  cells.push(cell('Fat', `${Math.round(t.f)}<small> g</small>`));
  // Weight only for people who use it (a weigh-in or a goal weight), the same rule as its Trends card.
  if (latestWeight || goals.weight_kg) cells.push(weightCellHtml());
  $('goalGrid').innerHTML = cells.join('');
}
$('goalGrid').addEventListener('click', ev => {
  if (ev.target.closest('[data-weight-open]')) openWeight(currentDate);
});

// ---------- Tally ----------
// The day's calories as tally marks: 20 marks (four struck gates of five) reach the calorie goal.
// The 20 take two thirds of the width, so up to 150% fits on one line; beyond that it wraps.
// The mark in progress fills from the bottom. Past the goal, marks turn the "over" colour and a
// thin marker shows where the goal was. With no calorie goal, marks are counted against 2,000,
// stay amber and get no marker.
const TALLY_MARKS = 20;
let tallyState = { cal: 0, goal: null };
let tallyWidth = 0;
function renderTally() {
  const el = $('tally');
  const W = el.clientWidth || 350;
  tallyWidth = el.clientWidth;
  const { cal, goal } = tallyState;
  const big = W > 450;
  const N = TALLY_MARKS, perRow = N * 1.5 / 5;
  const gap = big ? 18 : 12, H = big ? 46 : 38, sw = big ? 4.5 : 3.5, rowGap = 12, pad = 6;
  const m = cal / ((goal || 2000) / N);
  const slot = (W - (perRow - 1) * gap) / perRow;
  const oh = Math.round(slot * 0.2), cw = slot - 2 * oh;
  const ang = 26, len = (cw + oh * 1.6) / Math.cos(ang * Math.PI / 180);
  const gates = Math.ceil(Math.max(N, Math.ceil(m - 1e-9)) / 5);
  const rows = Math.ceil(gates / perRow);
  const clamp = x => Math.max(0, Math.min(1, x));
  const r = (cls, x, y, w, h, extra = '') => `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(sw / 2).toFixed(1)}"${extra}/>`;
  const parts = [];
  for (let g = 0; g < gates; g++) {
    const gx = (g % perRow) * (slot + gap), gy = pad + Math.floor(g / perRow) * (H + rowGap);
    let anyFill = false;
    for (let p = 0; p < 4; p++) {
      const i = g * 5 + p, f = clamp(m - i), inGoal = i < N;
      if (!inGoal && f <= 0) continue;
      if (f > 0) anyFill = true;
      const x = gx + oh + p * (cw - sw) / 3;
      if (inGoal) parts.push(r('tl-ghost', x, gy, sw, H));
      if (f > 0) parts.push(r(!inGoal && goal ? 'tl-over' : 'tl-on', x, gy + H * (1 - f), sw, H * f));
    }
    const i5 = g * 5 + 4, f5 = clamp(m - i5), in5 = i5 < N;
    const cx = gx + slot / 2, cy = gy + H / 2, rot = ` transform="rotate(${-ang} ${cx.toFixed(1)} ${cy.toFixed(1)})"`;
    if (in5 && !anyFill) parts.push(r('tl-ghost', cx - len / 2, cy - sw / 2, len, sw, rot));
    if (f5 > 0) parts.push(r(!in5 && goal ? 'tl-over' : 'tl-strike', cx - len / 2, cy - sw / 2, len * f5, sw, rot));
  }
  if (goal && m > N) parts.push(r('tl-marker', 4 * slot + 3 * gap + gap / 2 - 1, pad - 5, 2, H + 10));
  const h = pad * 2 + rows * H + (rows - 1) * rowGap;
  el.innerHTML = `<svg width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" aria-hidden="true">${parts.join('')}</svg>`;
  el.setAttribute('aria-label', goal ? `${fmtNum(cal)} of ${fmtNum(goal)} calories` : `${fmtNum(cal)} calories`);
}
new ResizeObserver(() => {
  if ($('tally').clientWidth !== tallyWidth) renderTally();
}).observe($('tally'));

// Goals sheet
const GOAL_DEFS = [
  { key: 'calories',   label: 'Calories', note: 'Limit · stay under it', unit: 'cal', scale: 1,    step: 50,  max: 20000 },
  { key: 'protein',    label: 'Protein',  note: 'At least · often 1.2–2 g/kg', unit: 'g', scale: 1,    step: 5,   max: 2000 },
  { key: 'fluid_ml',   label: 'Fluids',   note: 'At least · most adults 2–3 L', unit: 'L',   scale: 1000, step: 0.1, max: 10 },
  { key: 'creatine_g', label: 'Creatine', note: 'At least · usually 3–5 g', unit: 'g', scale: 1,    step: 1,   max: 100 },
];
function openGoals() {
  $('goalRows').innerHTML = GOAL_DEFS.map(d => `
    <div class="goal-row${goals[d.key] ? '' : ' off'}" id="goalRow_${d.key}">
      <label class="switch"><input type="checkbox" role="switch" aria-label="${d.label} goal" id="goalOn_${d.key}" ${goals[d.key] ? 'checked' : ''}><span></span></label>
      <div class="goal-name">${d.label}<small>${d.note}</small></div>
      <input type="number" class="field-input goal-input" id="goalVal_${d.key}" aria-label="${d.label} amount in ${d.unit}" inputmode="decimal" step="${d.step}" min="0" max="${d.max}"
             value="${goals[d.key] ? goals[d.key] / d.scale : ''}" ${goals[d.key] ? '' : 'disabled'}>
      <span class="goal-unit">${d.unit}</span>
    </div>`).join('');
  for (const d of GOAL_DEFS) {
    $('goalOn_' + d.key).addEventListener('change', (ev) => {
      const input = $('goalVal_' + d.key);
      input.disabled = !ev.target.checked;
      $('goalRow_' + d.key).classList.toggle('off', !ev.target.checked);
      if (ev.target.checked && !input.value) input.value = GOAL_STARTERS[d.key] / d.scale;
    });
  }
  setHelperOpen(false);
  $('helperResult').textContent = '';
  $('helperNote').textContent = 'An estimate, not medical advice. If you have a medical condition, are pregnant, or are under 18, ask a doctor or dietitian. '
    + (guest ? 'Remembered on this device so it is filled in next time.' : 'Saved to your profile so it is filled in next time.');
  goalWeightTouched = false;
  fillGoalWeightRow();
  // Units come from the profile; refill once it's loaded unless the row has been changed meanwhile.
  loadProfile().then(p => { fillHelperFromProfile(p); if (!goalWeightTouched) fillGoalWeightRow(); });
  openSheet('goalsOverlay');
}
// Goal weight: a normal goal row here, and also in the Weight sheet (both edit goals.weight_kg).
// Stored in kg, shown in the profile's units; an unchanged value is saved as it was, not re-rounded.
let goalWeightTouched = false;
let goalWeightUnits = 'us';
function fillGoalWeightRow() {
  goalWeightUnits = unitsNow();
  const on = !!goals.weight_kg, input = $('goalVal_weight');
  $('goalOn_weight').checked = on;
  $('goalRow_weight').classList.toggle('off', !on);
  input.disabled = !on;
  input.value = on ? kgTo(goals.weight_kg, goalWeightUnits).toFixed(1) : '';
  input.removeAttribute('aria-invalid');
  input.setAttribute('aria-label', `Goal weight in ${wUnit(goalWeightUnits)}`);
  $('goalUnit_weight').textContent = wUnit(goalWeightUnits);
}
$('goalOn_weight').addEventListener('change', ev => {
  goalWeightTouched = true;
  const on = ev.target.checked, input = $('goalVal_weight');
  input.disabled = !on;
  $('goalRow_weight').classList.toggle('off', !on);
  if (on && !input.value && latestWeight) input.value = kgTo(latestWeight.weight_kg, goalWeightUnits).toFixed(1);
});
$('goalVal_weight').addEventListener('input', () => { goalWeightTouched = true; });
$('closeGoals').addEventListener('click', () => closeSheet('goalsOverlay'));
$('saveGoals').addEventListener('click', async () => {
  const next = {};
  for (const d of GOAL_DEFS) {
    const on = $('goalOn_' + d.key).checked;
    const input = $('goalVal_' + d.key);
    const v = Number(input.value);
    if (on) {
      const msg = input.value.trim() === '' || !Number.isFinite(v) ? `Enter a number for ${d.label.toLowerCase()}`
        : v <= 0 ? `${d.label} goal needs to be more than 0`
        : v > d.max ? `${d.label} goal looks too high. The most is ${d.max.toLocaleString()} ${d.unit}.` : '';
      if (msg) { input.setAttribute('aria-invalid', 'true'); input.focus(); showToast(msg); return; }
    }
    next[d.key] = on ? Math.round(v * d.scale * 100) / 100 : null;
  }
  {
    const on = $('goalOn_weight').checked, input = $('goalVal_weight'), u = goalWeightUnits;
    const v = Number(input.value), [minKg, maxKg] = WEIGHT_LIMITS_KG;
    if (on) {
      const msg = input.value.trim() === '' || !Number.isFinite(v) ? 'Enter a number for goal weight'
        : (toKg(v, u) < minKg || toKg(v, u) > maxKg) ? `Goal weight needs to be ${Math.ceil(kgTo(minKg, u))}–${Math.floor(kgTo(maxKg, u))} ${wUnit(u)}` : '';
      if (msg) { input.setAttribute('aria-invalid', 'true'); input.focus(); showToast(msg); return; }
      const unchanged = goals.weight_kg && input.value === kgTo(goals.weight_kg, u).toFixed(1);
      next.weight_kg = unchanged ? goals.weight_kg : Math.round(toKg(v, u) * 1000) / 1000;
    } else next.weight_kg = null;
  }
  const btn = $('saveGoals');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await must(sb.from('goals').upsert({ user_id: user.id, ...next, updated_at: new Date().toISOString() }));
    goals = { ...goals, ...next };
    renderTotals();
    if (trendsVisible()) renderTrends();
    closeSheet('goalsOverlay');
    showToast('Goals saved');
  } catch (err) {
    console.error(err);
    showToast('Could not save — try again');
  } finally {
    btn.disabled = false; btn.textContent = 'Save goals';
  }
});

// Goals helper ("Help me choose"): estimates calories, protein and fluids from the person's size,
// activity and aim, fills the goal boxes, and remembers the inputs in `profiles` (one row per user,
// stored metric). Nothing here saves goals; "Save goals" still does that.
const HELPER_ACTIVITY = [
  { key: 'sitting',  label: 'Mostly sitting',  note: 'Desk job, little exercise', factor: 1.2 },
  { key: 'light',    label: 'Lightly active',  note: '1–3 workouts a week',        factor: 1.375 },
  { key: 'moderate', label: 'Active',          note: '3–5 workouts a week',        factor: 1.55 },
  { key: 'very',     label: 'Very active',     note: 'Daily training or a physical job', factor: 1.725 },
];
const HELPER_AIMS = [
  { key: 'lose_slow', label: 'Lose slowly',  note: 'Easier to keep up',                 adjust: -0.10, proteinPerKg: 2.0 },
  { key: 'lose_fast', label: 'Lose faster',  note: 'Harder; keep protein high',         adjust: -0.20, proteinPerKg: 2.2 },
  { key: 'maintain',  label: 'Maintain',     note: 'Stay where you are',                adjust: 0,     proteinPerKg: 1.6 },
  { key: 'build',     label: 'Build muscle', note: 'Slow gain alongside strength training', adjust: 0.10, proteinPerKg: 2.0 },
];
const HELPER_SEX = { male: { s: 5, floor: 1500 }, female: { s: -161, floor: 1200 }, other: { s: -78, floor: 1350 } };
const KG_PER_LB = 0.45359237, CM_PER_IN = 2.54;
let profile;            // undefined = not loaded yet, null = none saved
let helperUnits = 'us';

const optRow = (name, o) => `
  <label class="opt"><input type="radio" name="${name}" value="${o.key}"><span class="opt-dot" aria-hidden="true"></span>
    <span class="opt-text">${o.label}<small id="${name}_${o.key}_note">${o.note}</small></span></label>`;
$('hActivity').innerHTML = HELPER_ACTIVITY.map(o => optRow('hActivity', o)).join('');
$('hAim').innerHTML = HELPER_AIMS.map(o => optRow('hAim', o)).join('');

const radioVal = name => document.querySelector(`input[name="${name}"]:checked`)?.value || null;
const setRadio = (name, v) => document.querySelectorAll(`input[name="${name}"]`).forEach(r => { r.checked = r.value === v; });
const trimNum = (v, dp) => (v == null ? '' : String(Math.round(v * 10 ** dp) / 10 ** dp));

// Show a height and weight (metric) in the current units.
function helperShowSize(cm, kg) {
  if (helperUnits === 'us') {
    if (cm) { const inches = cm / CM_PER_IN; let ft = Math.floor(inches / 12), inch = Math.round(inches - ft * 12); if (inch === 12) { ft += 1; inch = 0; } $('hFt').value = ft; $('hIn').value = inch; }
    else { $('hFt').value = ''; $('hIn').value = ''; }
    $('hWt').value = kg ? trimNum(kg / KG_PER_LB, 0) : '';
  } else {
    $('hCm').value = cm ? trimNum(cm, 0) : '';
    $('hWt').value = kg ? trimNum(kg, 1) : '';
  }
}
// Read height and weight (metric) from the boxes; null where blank or not a number.
function helperReadSize() {
  const n = id => { const v = $(id).value.trim(); return v === '' ? null : Number(v); };
  let cm, kg;
  if (helperUnits === 'us') {
    const ft = n('hFt'), inch = n('hIn');
    cm = ft == null && inch == null ? null : ((ft || 0) * 12 + (inch || 0)) * CM_PER_IN;
    kg = n('hWt') == null ? null : n('hWt') * KG_PER_LB;
  } else { cm = n('hCm'); kg = n('hWt'); }
  return { cm: Number.isFinite(cm) ? cm : null, kg: Number.isFinite(kg) ? kg : null };
}
function setHelperUnits(u) {
  const { cm, kg } = helperReadSize();
  helperUnits = u;
  $('helperSize').classList.toggle('metric', u === 'metric');
  $('hWtLabel').textContent = u === 'metric' ? 'Weight kg' : 'Weight lb';
  $('hWt').placeholder = u === 'metric' ? '77' : '170';
  setSeg('helperUnits', b => b.dataset.units === u);
  helperShowSize(cm, kg);
  updateHelperPace();
}
document.querySelectorAll('#helperUnits button').forEach(b => b.addEventListener('click', () => setHelperUnits(b.dataset.units)));

// Check the inputs and work out the numbers. Returns { error } or the result.
function helperCompute() {
  const year = Number($('hYear').value);
  const { cm, kg } = helperReadSize();
  const sex = radioVal('hSex'), activity = radioVal('hActivity'), aimKey = radioVal('hAim');
  const age = new Date().getFullYear() - year;
  if (!$('hYear').value.trim() || !Number.isInteger(year) || age > 110 || age < 0) return { error: 'Enter the year you were born', field: 'hYear' };
  if (age < 18) return { error: 'This helper is for adults. Under 18, please ask a doctor or dietitian about goals.', field: 'hYear', warn: true };
  if (!cm || cm < 120 || cm > 250) return { error: 'Enter your height', field: helperUnits === 'us' ? 'hFt' : 'hCm' };
  if (!kg || kg < 30 || kg > 300) return { error: 'Enter your weight', field: 'hWt' };
  if (!sex) return { error: 'Choose a sex option', field: null };
  if (!activity) return { error: 'Choose how active you are', field: null };
  if (!aimKey) return { error: 'Choose what you are aiming for', field: null };
  const factor = HELPER_ACTIVITY.find(a => a.key === activity).factor;
  const aim = HELPER_AIMS.find(a => a.key === aimKey);
  const maintenance = (10 * kg + 6.25 * cm - 5 * age + HELPER_SEX[sex].s) * factor;
  const floor = HELPER_SEX[sex].floor;
  const calories = Math.max(floor, Math.round(maintenance * (1 + aim.adjust) / 50) * 50);
  // Per-kg rules overshoot for people carrying a lot of fat, so cap the weight used at a BMI of 25.
  const capKg = Math.min(kg, 25 * (cm / 100) ** 2);
  const protein = Math.round(aim.proteinPerKg * capKg / 5) * 5;
  const fluidMl = Math.round(35 * capKg / 100) * 100;
  return { year, cm, kg, sex, activity, aim, maintenance, calories, protein, fluidMl };
}

// The lose options show the expected pace from the person's own numbers once everything needed is in.
function updateHelperPace() {
  const r = helperCompute();
  for (const a of HELPER_AIMS) {
    const el = $(`hAim_${a.key}_note`);
    let note = a.note;
    if (!r.error && a.adjust < 0) {
      const cal = Math.max(HELPER_SEX[r.sex].floor, Math.round(r.maintenance * (1 + a.adjust) / 50) * 50);
      const perWeekKg = Math.max(0, r.maintenance - cal) * 7 / 7700;
      const pace = helperUnits === 'us' ? `${trimNum(perWeekKg / KG_PER_LB, 1)} lb` : `${trimNum(perWeekKg, 1)} kg`;
      note = `About ${pace} a week · ${a.note.charAt(0).toLowerCase()}${a.note.slice(1)}`;
    }
    el.textContent = note;
  }
}
$('helperBody').addEventListener('input', updateHelperPace);
$('helperBody').addEventListener('change', updateHelperPace);

async function loadProfile() {
  if (profile !== undefined) return profile;
  try {
    profile = await must(sb.from('profiles').select('birth_year, sex, height_cm, weight_kg, units, activity, aim').maybeSingle());
  } catch (err) {
    console.error(err);
    return null; // try again next time the sheet opens
  }
  return profile;
}
function fillHelperFromProfile(p) {
  helperUnits = p?.units === 'metric' ? 'metric' : 'us';
  $('hYear').value = p?.birth_year || '';
  setRadio('hSex', p?.sex); setRadio('hActivity', p?.activity); setRadio('hAim', p?.aim);
  ['hFt', 'hIn', 'hCm', 'hWt'].forEach(id => { $(id).value = ''; $(id).removeAttribute('aria-invalid'); });
  $('hYear').removeAttribute('aria-invalid');
  setHelperUnits(helperUnits);
  helperShowSize(p?.height_cm ? Number(p.height_cm) : null, latestWeight ? latestWeight.weight_kg : (p?.weight_kg ? Number(p.weight_kg) : null));
  updateHelperPace();
  $('helperResult').textContent = '';
}
function setHelperOpen(open) {
  $('helperBody').style.display = open ? '' : 'none';
  $('helperToggle').classList.toggle('open', open);
  $('helperToggle').setAttribute('aria-expanded', open);
}
$('helperToggle').addEventListener('click', () => setHelperOpen($('helperBody').style.display === 'none'));

$('helperFill').addEventListener('click', async () => {
  const out = $('helperResult');
  ['hYear', 'hFt', 'hIn', 'hCm', 'hWt'].forEach(id => $(id).removeAttribute('aria-invalid'));
  const r = helperCompute();
  if (r.error) {
    out.textContent = r.error;
    out.classList.add('warn');
    if (r.field) { $(r.field).setAttribute('aria-invalid', 'true'); $(r.field).focus(); }
    return;
  }
  out.classList.remove('warn');
  const set = (key, v) => {
    const d = GOAL_DEFS.find(x => x.key === key);
    $('goalOn_' + key).checked = true;
    $('goalRow_' + key).classList.remove('off');
    const input = $('goalVal_' + key);
    input.disabled = false; input.removeAttribute('aria-invalid');
    input.value = v / d.scale;
  };
  set('calories', r.calories); set('protein', r.protein); set('fluid_ml', r.fluidMl);
  // Fold the helper away and bring the filled goals back into view; the boxes speak for themselves.
  out.textContent = '';
  setHelperOpen(false);
  $('helperToggle').focus({ preventScroll: true });
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('helperToggle').closest('.sheet').scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  showToast('Goals filled in. Check them, then Save goals.');

  const row = {
    birth_year: r.year, sex: r.sex, height_cm: Math.round(r.cm * 10) / 10, weight_kg: Math.round(r.kg * 10) / 10,
    units: helperUnits, activity: r.activity, aim: r.aim.key,
  };
  try {
    await must(sb.from('profiles').upsert({ user_id: user.id, ...row, updated_at: new Date().toISOString() }));
    profile = row;
  } catch (err) {
    console.error('Could not save profile', err);
  }
});
