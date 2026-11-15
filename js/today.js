// today.js: the Today view. Foods and entries, the food list and search, quick-adds, the log,
// food and one-off sheets, and the day switcher.

// ---------- Loading data ----------
async function loadFoods() {
  try {
    const [foodRows, favRows, recentRows] = await Promise.all([
      must(sb.from('foods').select(FOOD_COLS)),
      must(sb.from('favourites').select('food_id')),
      // Recent logs by insert time; enough rows to find a handful of distinct foods.
      must(sb.from('log_entries').select('food_id, created_at').order('created_at', { ascending: false }).limit(200)),
    ]);
    recentFoodIds = [...new Set(recentRows.map(r => r.food_id).filter(Boolean))];
    const favIds = new Set(favRows.map(f => f.food_id));
    foods = foodRows.map(f => ({
      ...numeric(f),
      favourite: favIds.has(f.id),
      mine: f.owner_id !== null,
    }));
    foods.sort(byFavThenName);
    renderFoodList();
    renderQuickAdds();
  } catch (err) {
    console.error(err);
    $('foodList').innerHTML = '<div class="loading-row">Could not load foods. Check your connection.</div>';
  }
}

async function loadEntriesForDate(date) {
  const req = ++entriesRequest;
  $('entryList').innerHTML = '<div class="loading-row">Loading…</div>';
  try {
    const rows = await must(sb.from('log_entries')
      .select(ENTRY_COLS)
      .eq('date', date)
      .order('eaten_at', { nullsFirst: true })  // untimed (older) entries first
      .order('created_at'));
    if (req !== entriesRequest) return; // a newer day was requested meanwhile
    entries = rows.map(numeric);
    exitAdding();
    renderEntries();
    renderTotals();
  } catch (err) {
    console.error(err);
    if (req !== entriesRequest) return;
    $('entryList').innerHTML = '<div class="loading-row">Could not load entries.</div>';
  }
}


// ---------- Rendering: today's entries ----------
// Repeats of the same food on a day (2 or more) are grouped into one collapsible row,
// placed where the most recent of them sits. Singletons render exactly as before.
const expandedGroups = new Set();
let expandedGroupsDate = null;

const AGAIN_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>';

// "7:30a": compact time for the ledger's time column.
function shortTime(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  return `${h % 12 || 12}:${pad2(d.getMinutes())}${h < 12 ? 'a' : 'p'}`;
}

// Second line of a row: quantity when not 1, then macros (or fluid / alcohol / creatine for drinks and supplements).
function entrySub(e, qty) {
  const bits = [];
  if (qty !== 1) bits.push(`× ${round1(qty)}`);
  if (e.protein || e.carbs || e.fat) bits.push(`P ${Math.round(e.protein)} · C ${Math.round(e.carbs)} · F ${Math.round(e.fat)}`);
  else {
    if (e.fluid_ml) bits.push(`${Math.round(e.fluid_ml)} ml`);
    if (e.alcohol) bits.push(`${round1(e.alcohol)} drinks`);
    if (e.creatine_g) bits.push(`${round1(e.creatine_g)} g creatine`);
  }
  return bits.join(' · ');
}

function entryRowHtml(e, child = false) {
  return `
    <div class="entry${child ? ' child' : ''}" data-id="${e.id}">
      <span class="e-time">${e.eaten_at ? shortTime(e.eaten_at) : ''}</span>
      <div class="entry-main" role="button" tabindex="0" aria-label="Edit ${escapeHtml(e.food_name)}, ${fmtNum(e.calories)} calories">
        <div class="e-line"><span class="entry-name">${escapeHtml(e.food_name)}</span><span class="e-dots"></span><span class="entry-cal">${fmtNum(e.calories)}</span></div>
        <span class="entry-sub">${entrySub(e, e.quantity)}</span>
      </div>
      <button class="entry-again" data-id="${e.id}" aria-label="Log ${escapeHtml(e.food_name)} again" title="Log again">${AGAIN_ICON}</button>
    </div>`;
}

function groupRowHtml(key, items) {
  const sum = k => items.reduce((a, e) => a + (e[k] || 0), 0);
  const times = items.map(e => e.eaten_at).filter(Boolean).sort();
  const range = !times.length ? '' : shortTime(times[0]) === shortTime(times[times.length - 1])
    ? shortTime(times[0]) : `${shortTime(times[0])} – ${shortTime(times[times.length - 1])}`;
  const open = expandedGroups.has(key);
  const last = items[items.length - 1];
  const qty = round1(sum('quantity'));
  const agg = { protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat'), fluid_ml: sum('fluid_ml'), alcohol: sum('alcohol'), creatine_g: sum('creatine_g') };
  const sub = [qty === items.length ? '' : `${items.length} entries`, range, entrySub(agg, 1)].filter(Boolean).join(' · ');
  const head = `
    <div class="entry group-head${open ? ' open' : ''}" data-group="${escapeHtml(key)}">
      <span class="e-time">${last.eaten_at ? shortTime(last.eaten_at) : ''}</span>
      <div class="entry-main" role="button" tabindex="0" aria-expanded="${open}" aria-label="${escapeHtml(last.food_name)} × ${qty}, ${fmtNum(sum('calories'))} calories, ${open ? 'collapse' : 'expand'}">
        <div class="e-line"><span class="entry-name">${escapeHtml(last.food_name)} × ${qty}</span><span class="group-chev" aria-hidden="true">›</span><span class="e-dots"></span><span class="entry-cal">${fmtNum(sum('calories'))}</span></div>
        <span class="entry-sub">${sub}</span>
      </div>
      <button class="entry-again" data-id="${last.id}" aria-label="Log ${escapeHtml(last.food_name)} again" title="Log again">${AGAIN_ICON}</button>
    </div>`;
  return `<div class="entry-group">${head}${open ? `<div class="group-children">${items.map(e => entryRowHtml(e, true)).join('')}</div>` : ''}</div>`;
}

function renderEntries() {
  const list = $('entryList');
  if (!entries.length) {
    list.innerHTML = currentDate === todayStr()
      ? '<div class="empty-state"><b>Nothing logged yet</b>Search for a food, or tap a quick-add.</div>'
      : '<div class="empty-state"><b>Nothing logged this day</b>Search for a food to add it to this day.</div>';
    return;
  }
  if (expandedGroupsDate !== currentDate) { expandedGroups.clear(); expandedGroupsDate = currentDate; }

  const keyOf = e => e.food_id ? 'f:' + e.food_id : 'n:' + e.food_name;
  const byKey = new Map();
  entries.forEach(e => {
    const k = keyOf(e);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(e);
  });
  // Blocks in list order, a group anchored at its last entry.
  const blocks = [];
  entries.forEach(e => {
    const items = byKey.get(keyOf(e));
    if (items.length === 1) blocks.push(entryRowHtml(e));
    else if (items[items.length - 1] === e) blocks.push(groupRowHtml(keyOf(e), items));
  });
  list.innerHTML = blocks.join('');

  list.querySelectorAll('.group-head').forEach(el => {
    el.addEventListener('click', () => {
      const k = el.dataset.group;
      if (expandedGroups.has(k)) expandedGroups.delete(k); else expandedGroups.add(k);
      renderEntries();
    });
  });

  list.querySelectorAll('.entry[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      const entry = entries.find(e => e.id === el.dataset.id);
      if (entry) openEditSheet(entry);
    });
  });

  // "Log again": copy the entry as a new row stamped with the current time (original time on past days).
  list.querySelectorAll('.entry-again').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const e = entries.find(x => x.id === btn.dataset.id);
      if (!e) return;
      btn.disabled = true;
      try {
        await must(sb.from('log_entries').insert({
          date: e.date, food_id: e.food_id, food_name: e.food_name, quantity: e.quantity,
          calories: e.calories, protein: e.protein, carbs: e.carbs, fat: e.fat,
          alcohol: e.alcohol, fluid_ml: e.fluid_ml, creatine_g: e.creatine_g,
          eaten_at: e.date === todayStr() ? eatenAtFor(e.date, nowHHMM()) : e.eaten_at,
        }));
        noteRecent(e.food_id);
        await loadEntriesForDate(currentDate);
        showToast(`Logged ${e.food_name} again`);
      } catch (err) {
        console.error(err);
        btn.disabled = false;
        showToast('Could not log. Try again.');
      }
    });
  });

  // Rows are buttons: Enter or Space opens them like a tap.
  list.querySelectorAll('.entry-main[role="button"]').forEach(el => {
    el.addEventListener('keydown', ev => {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === el) { ev.preventDefault(); el.click(); }
    });
  });
}

// ---------- Rendering: food list (search) ----------
// Order: up to RECENT_MAX recently logged foods, then favourites, then the rest A-Z.
// Each food appears once, as one list with no headings (searching keeps the same order).
function noteRecent(foodId) {
  if (!foodId) return;
  recentFoodIds = [foodId, ...recentFoodIds.filter(id => id !== foodId)];
  renderFoodList();
}

function renderFoodList() {
  const q = $('searchInput').value.trim().toLowerCase();
  const list = $('foodList');
  updateQuickVisibility();

  const byId = new Map(foods.map(f => [f.id, f]));
  const recent = recentFoodIds.map(id => byId.get(id)).filter(Boolean).slice(0, RECENT_MAX);
  const taken = new Set(recent.map(f => f.id));
  const rest = foods.filter(f => !taken.has(f.id)); // foods is already favourites first, then A-Z
  const ordered = [...recent, ...rest];
  const shown = q ? ordered.filter(f => f.name.toLowerCase().includes(q)) : ordered;

  if (!shown.length) {
    list.innerHTML = '<div class="empty-state">No match. Add it as a new food or a one-off.</div>';
    return;
  }

  list.innerHTML = shown.map(f => `
    <div class="food-item" data-id="${f.id}">
      <div class="food-main">
        ${f.favourite ? '<span class="star">★</span>' : ''}
        <span class="food-name">${escapeHtml(f.name)}</span>
      </div>
      <span class="food-cal">${Math.round(f.calories)} cal</span>
    </div>`).join('');
  list.scrollTop = 0; // new order or new matches: start at the top (the desktop list stays on screen)

  list.querySelectorAll('.food-item').forEach(el => {
    el.addEventListener('click', () => openLogSheet(el.dataset.id));
  });
}

// ---------- Quick-add buttons ----------
// Up to 6 per user, stored in quick_adds (slot, food_id, label). With nothing saved,
// slot 0 defaults to the standard "Water (250 ml)" food.
const QUICK_SLOTS = 6;
const QUICK_LABEL_MAX = 10;
let quickAdds = [];

// Called by showApp() when a different person signs in (or a guest starts).
function resetTodayState() {
  foods = []; entries = [];
  recentFoodIds = [];
  quickAdds = [];
  currentDate = todayStr();
}

function effectiveQuickAdds() {
  if (quickAdds.length) return quickAdds;
  const water = foods.find(f => f.owner_id === null && f.name === 'Water (250 ml)');
  return water ? [{ slot: 0, food_id: water.id, label: 'Water' }] : [];
}

async function loadQuickAdds() {
  try {
    quickAdds = await must(sb.from('quick_adds').select('slot, food_id, label').order('slot'));
  } catch (err) {
    console.error(err);
    quickAdds = [];
  }
  renderQuickAdds();
}

function renderQuickAdds() {
  const grid = $('quickGrid');
  const items = effectiveQuickAdds().filter(q => foods.some(f => f.id === q.food_id));
  grid.innerHTML = items.map(q =>
    `<button class="quick-btn" data-food="${q.food_id}" title="${escapeHtml(foods.find(f => f.id === q.food_id).name)}">${escapeHtml(q.label)}</button>`
  ).join('');
  // "+ Add" while there is room for another button, so editing is discoverable.
  if (items.length < QUICK_SLOTS) grid.insertAdjacentHTML('beforeend', '<button class="quick-btn quick-add-slot" data-add="1" aria-label="Add a quick-add button">+ Add</button>');
  grid.querySelectorAll('.quick-btn[data-food]').forEach(btn => btn.addEventListener('click', () => quickLog(btn)));
  grid.querySelectorAll('.quick-add-slot').forEach(btn => btn.addEventListener('click', () => openQuickEdit(true)));
  updateQuickVisibility();
}

// The buttons step aside while the user is searching.
function updateQuickVisibility() {
  const searching = $('searchInput').value.trim() !== '';
  show($('quickWrap'), !searching);
}

// One tap logs one serving at the current time (no time on past days).
async function quickLog(btn) {
  const food = foods.find(f => f.id === btn.dataset.food);
  if (!food) return;
  await withBusy(btn, null, async () => {
    try {
      await must(sb.from('log_entries').insert({ date: currentDate, ...servingOf(food), eaten_at: eatenNow(currentDate) }));
      noteRecent(food.id);
      await loadEntriesForDate(currentDate);
      showToast(`Logged ${food.name}`);
    } catch (err) {
      console.error(err);
      showToast('Could not log. Try again.');
    }
  });
}

function openQuickEdit(focusEmpty = false) {
  const current = effectiveQuickAdds();
  const options = foods.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');
  let html = '';
  for (let i = 0; i < QUICK_SLOTS; i++) {
    const q = current.find(x => x.slot === i);
    html += `<div class="quick-row">
      <span class="quick-n">${i + 1}</span>
      <select class="field-input" id="quickFood_${i}" aria-label="Button ${i + 1} food"><option value="">Choose a food</option>${options}</select>
      <input type="text" class="field-input" id="quickLabel_${i}" aria-label="Button ${i + 1} label" maxlength="${QUICK_LABEL_MAX}" placeholder="Label" value="${q ? escapeHtml(q.label) : ''}">
    </div>`;
  }
  $('quickRows').innerHTML = html;
  for (let i = 0; i < QUICK_SLOTS; i++) {
    const sel = $('quickFood_' + i);
    const q = current.find(x => x.slot === i);
    if (q) sel.value = q.food_id;
    // Suggest a label from the food name when the label is still blank.
    sel.addEventListener('change', () => {
      const label = $('quickLabel_' + i);
      const food = foods.find(f => f.id === sel.value);
      if (food && !label.value.trim()) label.value = food.name.slice(0, QUICK_LABEL_MAX).trim();
    });
  }
  openSheet('quickOverlay');
  if (focusEmpty === true) {
    const firstEmpty = [...document.querySelectorAll('#quickRows select')].find(sel => !sel.value);
    if (firstEmpty) firstEmpty.focus();
  }
}
$('closeQuick').addEventListener('click', () => closeSheet('quickOverlay'));
$('saveQuick').addEventListener('click', async () => {
  const rows = [], emptySlots = [];
  for (let i = 0; i < QUICK_SLOTS; i++) {
    const food = foods.find(f => f.id === $('quickFood_' + i).value);
    if (!food) { emptySlots.push(i); continue; }
    const label = ($('quickLabel_' + i).value.trim() || food.name).slice(0, QUICK_LABEL_MAX).trim();
    rows.push({ user_id: user.id, slot: i, food_id: food.id, label });
  }
  await withBusy($('saveQuick'), 'Saving…', async () => {
    try {
      if (rows.length) await must(sb.from('quick_adds').upsert(rows));
      if (emptySlots.length) await must(sb.from('quick_adds').delete().in('slot', emptySlots));
      quickAdds = rows.map(({ slot, food_id, label }) => ({ slot, food_id, label }));
      renderQuickAdds();
      closeSheet('quickOverlay');
      showToast('Buttons saved');
    } catch (err) {
      console.error(err);
      showToast(err.code === 'PGRST205' ? 'Quick-add table missing. Run schema.sql.' : 'Could not save. Try again.');
    }
  });
});

// ---------- Eaten-at time ----------
function nowHHMM() { return hhmm(new Date()); }
function hhmmFromIso(iso) { return hhmm(new Date(iso)); }
// Combine the viewed date with an HH:MM (local time) into an ISO timestamp; blank = null.
function eatenAtFor(date, time) {
  return time ? new Date(`${date}T${time}`).toISOString() : null;
}
// eaten_at for something logged with one tap: the current time on today, no time on past days.
function eatenNow(date) {
  return date === todayStr() ? eatenAtFor(date, nowHHMM()) : null;
}

// Time stepper in the log sheet: type a time, or nudge it by 30 minutes.
function setLogTime(hhmm) { $('logTime').value = hhmm; }
function stepLogTime(deltaMin) {
  const input = $('logTime');
  // From blank, start at the current time (today) or noon (past days).
  const base = input.value || (currentDate === todayStr() ? nowHHMM() : '12:00');
  const [h, m] = base.split(':').map(Number);
  const total = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + deltaMin)); // stay within the day
  setLogTime(`${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`);
}
$('timeMinus').addEventListener('click', () => stepLogTime(-30));
$('timePlus').addEventListener('click', () => stepLogTime(30));

// ---------- Log quantity sheet (shared between adding and editing) ----------
function openLogSheet(foodId) {
  activeFood = foods.find(f => f.id === foodId);
  if (!activeFood) return;
  editingId = null;
  pendingQty = 1;
  updateFavButton();
  $('logSheetTitle').textContent = activeFood.name;
  $('logSheetSub').textContent = `${fmtNum(activeFood.calories)} cal a serving`;
  $('confirmLog').textContent = 'Log it';
  show($('removeEntry'), false);
  show($('editFoodLink'), !!activeFood.mine);
  // Default to now when logging today; for past days leave it blank (stored as no time).
  setLogTime(currentDate === todayStr() ? nowHHMM() : '');
  updateQtyDisplay();
  openSheet('logSheetOverlay');
}

function openEditSheet(entry) {
  // Derive per-unit values from the stored totals, so the same +/- quantity
  // control can scale this entry just like a fresh log action would.
  const qty = entry.quantity || 1;
  activeFood = { id: entry.food_id, name: entry.food_name };
  for (const k of NUTRIENTS) activeFood[k] = entry[k] / qty;
  editingId = entry.id;
  pendingQty = qty;
  updateFavButton();
  $('logSheetTitle').textContent = entry.food_name;
  $('logSheetSub').textContent = `${fmtNum(activeFood.calories)} cal a serving`;
  $('confirmLog').textContent = 'Save changes';
  show($('removeEntry'));
  show($('editFoodLink'), false);
  setLogTime(entry.eaten_at ? hhmmFromIso(entry.eaten_at) : '');
  updateQtyDisplay();
  openSheet('logSheetOverlay');
}

function updateQtyDisplay() {
  const q = pendingQty, f = activeFood;
  $('qtyValue').textContent = q;
  $('prevCal').textContent = fmtNum(f.calories * q);
  $('prevMacros').textContent = (f.protein || f.carbs || f.fat)
    ? `P ${Math.round(f.protein * q)} · C ${Math.round(f.carbs * q)} · F ${Math.round(f.fat * q)}`
    : entrySub({ fluid_ml: (f.fluid_ml || 0) * q, alcohol: (f.alcohol || 0) * q, creatine_g: (f.creatine_g || 0) * q }, 1);
  // Where the day would stand after this entry (an edited entry's old calories are swapped out).
  const dayCal = entries.reduce((a, e) => a + e.calories, 0) - (editingId ? (entries.find(e => e.id === editingId)?.calories || 0) : 0);
  const after = dayCal + f.calories * q;
  const el = $('logAfter');
  if (goals.calories) {
    const left = Math.round(goals.calories - after);
    el.innerHTML = `After this: <b>${Math.abs(left).toLocaleString()} cal ${left < 0 ? 'over' : 'left'}</b>`;
    el.classList.toggle('over', left < 0);
  } else {
    el.innerHTML = `After this: <b>${fmtNum(after)} cal</b> for the day`;
    el.classList.remove('over');
  }
}

$('qtyMinus').addEventListener('click', () => {
  pendingQty = Math.max(0.5, round1(pendingQty - 0.5));
  updateQtyDisplay();
});
$('qtyPlus').addEventListener('click', () => {
  pendingQty = round1(pendingQty + 0.5);
  updateQtyDisplay();
});
$('closeLogSheet').addEventListener('click', () => {
  closeSheet('logSheetOverlay');
  editingId = null;
});

// ---------- Favourite star in the log sheet (works for standard and own foods) ----------
function updateFavButton() {
  const btn = $('logSheetFav');
  const food = activeFood && activeFood.id ? foods.find(f => f.id === activeFood.id) : null;
  show(btn, !!food); // hidden for one-offs / deleted foods
  const on = !!(food && food.favourite);
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', on);
  btn.setAttribute('aria-label', on ? 'Remove from favourites' : 'Add to favourites');
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/></svg>`;
}

$('logSheetFav').addEventListener('click', async () => {
  const food = foods.find(f => f.id === activeFood?.id);
  if (!food) return;
  const makeFav = !food.favourite;
  food.favourite = makeFav;
  updateFavButton();
  try {
    if (makeFav) {
      await must(sb.from('favourites').upsert({ user_id: user.id, food_id: food.id }, { ignoreDuplicates: true }));
    } else {
      await must(sb.from('favourites').delete().eq('food_id', food.id));
    }
    foods.sort(byFavThenName);
    renderFoodList();
    showToast(makeFav ? 'Added to favourites' : 'Removed from favourites');
  } catch (err) {
    console.error(err);
    food.favourite = !makeFav;
    updateFavButton();
    showToast('Could not update favourite');
  }
});

function scaledMacros() {
  return {
    quantity: pendingQty,
    calories: round1(activeFood.calories * pendingQty),
    protein: round1(activeFood.protein * pendingQty),
    carbs: round1(activeFood.carbs * pendingQty),
    fat: round1(activeFood.fat * pendingQty),
    alcohol: round1((activeFood.alcohol || 0) * pendingQty),
    fluid_ml: Math.round((activeFood.fluid_ml || 0) * pendingQty),
    creatine_g: round1((activeFood.creatine_g || 0) * pendingQty),
    eaten_at: eatenAtFor(editingId ? entries.find(e => e.id === editingId).date : currentDate,
                         $('logTime').value),
  };
}

$('confirmLog').addEventListener('click', async () => {
  const isEdit = editingId !== null;
  await withBusy($('confirmLog'), isEdit ? 'Saving…' : 'Logging…', async () => {
    try {
      if (isEdit) {
        await must(sb.from('log_entries').update(scaledMacros()).eq('id', editingId));
      } else {
        await must(sb.from('log_entries').insert({
          date: currentDate,
          food_id: activeFood.id,
          food_name: activeFood.name,
          ...scaledMacros(),
        }));
        recentFoodIds = [activeFood.id, ...recentFoodIds.filter(id => id !== activeFood.id)];
      }
      closeSheet('logSheetOverlay');
      $('searchInput').value = '';
      renderFoodList();
      await loadEntriesForDate(currentDate);
      showToast(isEdit ? 'Changes saved' : `Logged ${activeFood.name}`);
      editingId = null;
    } catch (err) {
      console.error(err);
      showToast(isEdit ? 'Could not save. Try again.' : 'Could not log. Try again.');
    }
  });
});

// Remove lives in the edit sheet (not on the row), and the toast offers Undo.
$('removeEntry').addEventListener('click', async () => {
  const entry = entries.find(e => e.id === editingId);
  if (!entry) return;
  await withBusy($('removeEntry'), null, async () => {
    try {
      await must(sb.from('log_entries').delete().eq('id', entry.id));
      closeSheet('logSheetOverlay');
      editingId = null;
      await loadEntriesForDate(currentDate);
      showToast(`Removed ${entry.food_name}`, { label: 'Undo', run: () => restoreEntry(entry) });
    } catch (err) {
      console.error(err);
      showToast('Could not remove. Try again.');
    }
  });
});

// Put a removed entry back exactly as it was (same id, time and values).
async function restoreEntry(entry) {
  try {
    await must(sb.from('log_entries').insert({ ...entry }));
    await loadEntriesForDate(currentDate);
    showToast('Entry restored');
  } catch (err) {
    console.error(err);
    showToast('Could not restore the entry');
  }
}

// ---------- Add new food sheet ----------
let newFoodFavourite = false;
let editingFoodId = null; // set while the food sheet is editing an existing food

function setFoodSheetMode(editing) {
  $('foodSheetTitle').textContent = editing ? 'Edit food' : 'New food';
  $('foodSheetSub').textContent = editing
    ? 'Changes apply to future logs. Entries you already logged keep their values.'
    : 'One serving, the way you usually log it. Only you see it.';
  show($('favToggle'), !editing);
  show($('saveFoodOnly'), !editing);
  $('saveNewFood').textContent = editing ? 'Save changes' : 'Save and log 1 serving';
}

function setMoreOpen(open) {
  show($('moreFields'), open);
  const t = $('moreToggle');
  t.classList.toggle('open', open);
  t.setAttribute('aria-expanded', open);
}
$('moreToggle').addEventListener('click', () => {
  setMoreOpen($('moreFields').hidden);
});

$('addNewFoodLink').addEventListener('click', () => {
  editingFoodId = null;
  setFoodSheetMode(false);
  $('newFoodName').value = $('searchInput').value.trim();
  $('newFoodCal').value = '';
  $('newFoodP').value = '';
  $('newFoodC').value = '';
  $('newFoodF').value = '';
  ['newFoodFluid', 'newFoodAlc', 'newFoodCr'].forEach(id => { $(id).value = ''; });
  setMoreOpen(false);
  setNewFoodFavourite(false);
  openSheet('addFoodOverlay');
});
$('editFoodLink').addEventListener('click', () => {
  if (!activeFood || !activeFood.mine) return;
  const f = activeFood;
  editingFoodId = f.id;
  setFoodSheetMode(true);
  const set = (id, v) => { $(id).value = v ? v : ''; };
  $('newFoodName').value = f.name;
  set('newFoodCal', f.calories); set('newFoodP', f.protein); set('newFoodC', f.carbs); set('newFoodF', f.fat);
  set('newFoodFluid', f.fluid_ml); set('newFoodAlc', f.alcohol); set('newFoodCr', f.creatine_g);
  setMoreOpen(!!(f.fluid_ml || f.alcohol || f.creatine_g));
  closeSheet('logSheetOverlay');
  openSheet('addFoodOverlay');
});
$('closeAddFood').addEventListener('click', () => {
  closeSheet('addFoodOverlay');
});
function setNewFoodFavourite(on) {
  newFoodFavourite = on;
  const t = $('favToggle');
  t.classList.toggle('on', on);
  t.setAttribute('aria-checked', on);
}
$('favToggle').addEventListener('click', () => setNewFoodFavourite(!newFoodFavourite));
$('favToggle').addEventListener('keydown', (ev) => {
  if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); setNewFoodFavourite(!newFoodFavourite); }
});

// ---------- Amount fields: never negative ----------
// Typing a minus sign or an exponent is blocked; anything else odd is caught on save with a clear message.
document.addEventListener('keydown', (ev) => {
  if (ev.target.matches?.('input[type="number"][min="0"]') && ['-', '+', 'e', 'E'].includes(ev.key)) ev.preventDefault();
});
document.addEventListener('input', (ev) => {
  if (ev.target.matches?.('.field-input')) ev.target.removeAttribute('aria-invalid');
});
// Reads an amount field: blank = 0. Rejects text, negatives and values above a sanity limit.
function readAmount(id, label, max, unit = '') {
  const el = $(id);
  const raw = el.value.trim();
  const fail = (msg) => {
    // A field in the collapsed "Drinks and supplements" section can't take focus until it's shown.
    if (el.closest('#moreFields')?.hidden) setMoreOpen(true);
    el.setAttribute('aria-invalid', 'true');
    el.focus();
    throw new InvalidField(msg);
  };
  if (raw === '') {
    if (el.validity && el.validity.badInput) fail(`${label} needs to be a number`);
    return 0;
  }
  const v = Number(raw);
  if (!Number.isFinite(v)) fail(`${label} needs to be a number`);
  if (v < 0) fail(`${label} can't be negative`);
  if (v > max) fail(`${label} looks too high. The most is ${max.toLocaleString()}${unit}.`);
  return Math.round(v * 100) / 100;
}
const AMOUNT_LIMITS = { calories: 20000, grams: 2000, fluid_ml: 10000, alcohol: 50, creatine_g: 100 };

// Save the food; for a new food the primary button also logs one serving to the viewed day.
async function saveFood(logIt) {
  const nameEl = $('newFoodName');
  const name = nameEl.value.trim();
  if (!name) { nameEl.setAttribute('aria-invalid', 'true'); nameEl.focus(); showToast('Give it a name first'); return; }
  let values;
  try {
    const L = AMOUNT_LIMITS;
    values = {
      name,
      calories: readAmount('newFoodCal', 'Calories', L.calories),
      protein: readAmount('newFoodP', 'Protein', L.grams, ' g'),
      carbs: readAmount('newFoodC', 'Carbs', L.grams, ' g'),
      fat: readAmount('newFoodF', 'Fat', L.grams, ' g'),
      fluid_ml: readAmount('newFoodFluid', 'Fluid', L.fluid_ml, ' ml'),
      alcohol: readAmount('newFoodAlc', 'Alcohol', L.alcohol, ' drinks'),
      creatine_g: readAmount('newFoodCr', 'Creatine', L.creatine_g, ' g'),
    };
  } catch (err) {
    if (!(err instanceof InvalidField)) throw err;
    showToast(err.message);
    return;
  }

  const editing = !!editingFoodId;
  await withBusy($(logIt ? 'saveNewFood' : 'saveFoodOnly'), 'Saving…', async () => {
    try {
      if (editing) {
        await must(sb.from('foods').update(values).eq('id', editingFoodId).select('id'));
      } else {
        // New foods are always private to the signed-in user.
        const [food] = await must(sb.from('foods').insert({ owner_id: user.id, ...values }).select('id'));
        if (newFoodFavourite) await must(sb.from('favourites').insert({ user_id: user.id, food_id: food.id }));
        if (logIt) {
          await must(sb.from('log_entries').insert({ date: currentDate, ...servingOf({ id: food.id, ...values }), eaten_at: eatenNow(currentDate) }));
        }
      }
      closeSheet('addFoodOverlay');
      await loadFoods();
      if (logIt && !editing) await loadEntriesForDate(currentDate);
      showToast(editing ? 'Food updated' : logIt ? `Saved and logged ${name}` : 'Food saved');
    } catch (err) {
      console.error(err);
      showToast(err.code === '23505' ? 'You already have a food with that name'
        : err.code === '23514' ? 'Values can’t be negative' : 'Could not save. Try again.');
    }
  });
}
// In edit mode the primary button just saves.
$('saveNewFood').addEventListener('click', () => saveFood(!editingFoodId));
$('saveFoodOnly').addEventListener('click', () => saveFood(false));

// ---------- Log a one-off (skips Foods entirely, logs straight to today's entries) ----------
$('logOneOffLink').addEventListener('click', () => {
  $('oneOffName').value = '';
  $('oneOffCal').value = '';
  $('oneOffP').value = '';
  $('oneOffC').value = '';
  $('oneOffF').value = '';
  openSheet('oneOffOverlay');
});
$('closeOneOff').addEventListener('click', () => {
  closeSheet('oneOffOverlay');
});

$('saveOneOff').addEventListener('click', async () => {
  const nameEl = $('oneOffName');
  const name = nameEl.value.trim();
  if (!name) { nameEl.setAttribute('aria-invalid', 'true'); nameEl.focus(); showToast('Give it a name first'); return; }
  let calories, protein, carbs, fat;
  try {
    calories = readAmount('oneOffCal', 'Calories', AMOUNT_LIMITS.calories);
    protein = readAmount('oneOffP', 'Protein', AMOUNT_LIMITS.grams, ' g');
    carbs = readAmount('oneOffC', 'Carbs', AMOUNT_LIMITS.grams, ' g');
    fat = readAmount('oneOffF', 'Fat', AMOUNT_LIMITS.grams, ' g');
  } catch (err) {
    if (!(err instanceof InvalidField)) throw err;
    showToast(err.message);
    return;
  }

  await withBusy($('saveOneOff'), 'Logging…', async () => {
    try {
      await must(sb.from('log_entries').insert({
        date: currentDate,
        food_id: null,
        food_name: name,
        quantity: 1,
        calories, protein, carbs, fat,
        eaten_at: eatenNow(currentDate),
      }));
      closeSheet('oneOffOverlay');
      await loadEntriesForDate(currentDate);
      showToast(`Logged ${name}`);
    } catch (err) {
      console.error(err);
      showToast('Could not log. Try again.');
    }
  });
});


// ---------- Search ----------
$('searchInput').addEventListener('input', renderFoodList);

// On a phone the search band opens full screen while you pick a food (body.adding).
function enterAdding() { if (!desktopMQ.matches) document.body.classList.add('adding'); }
function exitAdding() {
  if (!document.body.classList.contains('adding')) return;
  document.body.classList.remove('adding');
  const input = $('searchInput');
  if (input.value) { input.value = ''; renderFoodList(); }
  input.blur();
}
$('searchInput').addEventListener('focus', enterAdding);
$('addCancel').addEventListener('click', exitAdding);
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && document.body.classList.contains('adding') && !document.querySelector('.sheet-overlay.open')) exitAdding();
});

// ---------- Date navigation ----------
function refreshDateUI() {
  const label = formatDateLabel(currentDate);
  $('dateLabel').textContent = label;
  loadEntriesForDate(currentDate);
  loadDayWeight(currentDate);
}
$('prevDay').addEventListener('click', () => {
  currentDate = addDays(currentDate, -1);
  refreshDateUI();
});
$('nextDay').addEventListener('click', () => {
  if (currentDate === todayStr()) return; // no future logging
  currentDate = addDays(currentDate, 1);
  refreshDateUI();
});

// ---------- Date nav placement ----------
// Header on mobile; top of the left column on desktop (it only affects that column).
const desktopMQ = window.matchMedia('(min-width: 900px)');
function placeDateNav() {
  const slot = $(desktopMQ.matches ? 'dateSlotLeft' : 'dateSlotHeader');
  slot.appendChild($('dateNav'));
}
desktopMQ.addEventListener('change', placeDateNav);
placeDateNav();
