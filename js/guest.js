// guest.js: guest mode. The localStorage stand-in for the Supabase client, and the
// merge of a guest's data into their account on sign-in.

// ---------- Guest backend ----------
// A signed-out visitor can use the whole app. `sb` is swapped for this stand-in, which answers
// the same calls the app already makes (from().select/insert/update/upsert/delete, eq, in, gt, lt,
// gte, lte, order, limit, maybeSingle) from localStorage. Standard foods are the only thing
// read from Supabase (anon read, see schema.sql); everything else stays on this device.
const GUEST_ID = 'guest';
const GUEST_STORE_KEY = 'caltal_guest_v1';
const STD_FOODS_KEY = 'caltal_std_foods_v1';
const GUEST_TABLES = ['foods', 'favourites', 'log_entries', 'goals', 'quick_adds', 'profiles', 'daily_metrics'];

function makeLocalClient() {
  let store = {};
  try { store = JSON.parse(localStorage.getItem(GUEST_STORE_KEY)) || {}; } catch (e) { store = {}; }
  for (const t of GUEST_TABLES) if (!Array.isArray(store[t])) store[t] = [];
  let standard = null;

  const nowIso = () => new Date().toISOString();
  const uuid = newId;
  const save = () => {
    try { localStorage.setItem(GUEST_STORE_KEY, JSON.stringify(store)); return null; }
    catch (e) { return { message: 'Could not save on this device' }; }
  };
  const fail = (code, message) => ({ data: null, error: { code, message } });

  const KEYS = { favourites: ['user_id', 'food_id'], goals: ['user_id'], profiles: ['user_id'], daily_metrics: ['user_id', 'date'], quick_adds: ['user_id', 'slot'] };
  const NUM0 = Object.fromEntries(NUTRIENTS.map(k => [k, 0]));
  const DEFAULTS = {
    foods: () => ({ id: uuid(), ...NUM0, created_at: nowIso() }),
    log_entries: () => ({ id: uuid(), quantity: 1, ...NUM0, food_id: null, eaten_at: null, created_at: nowIso() }),
    favourites: () => ({ created_at: nowIso() }),
    goals: () => ({}),
    profiles: () => ({}),
    daily_metrics: () => ({ source: 'manual', updated_at: nowIso() }),
    quick_adds: () => ({}),
  };

  async function standardFoods() {
    if (standard) return standard;
    try {
      const { data, error } = await supa.from('foods').select(FOOD_COLS).is('owner_id', null);
      if (error) throw error;
      if (data.length) {
        standard = data;
        try { localStorage.setItem(STD_FOODS_KEY, JSON.stringify(data)); } catch (e) { /* cache is optional */ }
        return standard;
      }
    } catch (e) { console.warn('Could not load standard foods', e); }
    try { standard = JSON.parse(localStorage.getItem(STD_FOODS_KEY)) || []; } catch (e) { standard = []; }
    return standard;
  }

  // Same rows the daily_totals view returns: per-day sums of the entries.
  function dailyTotals() {
    const by = new Map();
    for (const e of store.log_entries) {
      const d = by.get(e.date) || { date: e.date, ...NUM0, entries: 0 };
      for (const k of NUTRIENTS) d[k] += Number(e[k]) || 0;
      d.entries += 1;
      by.set(e.date, d);
    }
    return [...by.values()];
  }

  // Once per browser session, after a guest's first log, say where the data lives.
  function nudgeSignIn() {
    try { if (sessionStorage.getItem('caltal_nudged')) return; sessionStorage.setItem('caltal_nudged', '1'); } catch (e) { return; }
    setTimeout(() => showToast('Saved on this device. Sign in to keep it.'), 2000);
  }

  const dupName = (name, exceptId) => store.foods.some(f => f.id !== exceptId && f.name.toLowerCase() === String(name).toLowerCase());

  function cmp(a, b, { ascending = true, nullsFirst } = {}) {
    const an = a == null, bn = b == null;
    const nf = nullsFirst !== undefined ? nullsFirst : !ascending; // Postgres default
    if (an || bn) return an && bn ? 0 : an ? (nf ? -1 : 1) : (nf ? 1 : -1);
    return (a < b ? -1 : a > b ? 1 : 0) * (ascending ? 1 : -1);
  }

  class Query {
    constructor(table) {
      this.table = table; this.op = 'select'; this.cols = null; this.returning = false;
      this.filters = []; this.orders = []; this.max = null; this.one = false; this.payload = null; this.opts = {};
    }
    select(cols) { this.cols = cols || null; if (this.op !== 'select') this.returning = true; return this; }
    insert(p) { this.op = 'insert'; this.payload = p; return this; }
    update(p) { this.op = 'update'; this.payload = p; return this; }
    upsert(p, o) { this.op = 'upsert'; this.payload = p; this.opts = o || {}; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.filters.push(r => r[c] === v); return this; }
    in(c, a) { this.filters.push(r => a.includes(r[c])); return this; }
    gt(c, v) { this.filters.push(r => r[c] > v); return this; }
    lt(c, v) { this.filters.push(r => r[c] < v); return this; }
    gte(c, v) { this.filters.push(r => r[c] >= v); return this; }
    lte(c, v) { this.filters.push(r => r[c] <= v); return this; }
    order(c, o) { this.orders.push([c, o || {}]); return this; }
    limit(n) { this.max = n; return this; }
    maybeSingle() { this.one = true; return this; }
    then(res, rej) { return this.run().then(res, rej); }

    project(rows) {
      const cols = this.cols && this.cols !== '*' ? this.cols.split(',').map(c => c.trim()) : null;
      return rows.map(r => { if (!cols) return { ...r }; const o = {}; cols.forEach(c => { o[c] = r[c]; }); return o; });
    }
    matches() { return store[this.table].filter(r => this.filters.every(f => f(r))); }

    async run() {
      const t = this.table;
      if (this.op === 'select') {
        let rows = t === 'daily_totals' ? dailyTotals()
          : t === 'foods' ? [...await standardFoods(), ...store.foods]
          : store[t];
        if (!rows) return fail('42P01', 'unknown table ' + t);
        rows = rows.filter(r => this.filters.every(f => f(r)));
        if (this.orders.length) {
          rows = [...rows].sort((x, y) => { for (const [c, o] of this.orders) { const r = cmp(x[c], y[c], o); if (r) return r; } return 0; });
        }
        if (this.max !== null) rows = rows.slice(0, this.max);
        const out = this.project(rows);
        return { data: this.one ? (out[0] || null) : out, error: null };
      }
      if (!store[t]) return fail('42P01', 'unknown table ' + t);

      const insertRow = p => {
        const row = { ...DEFAULTS[t](), ...p };
        if (t === 'foods') row.owner_id = GUEST_ID; else row.user_id = GUEST_ID;
        if (t === 'foods' && dupName(row.name)) return '23505';
        if (KEYS[t] && store[t].some(r => KEYS[t].every(k => r[k] === row[k]))) return '23505';
        store[t].push(row);
        return row;
      };
      let affected = [];
      if (this.op === 'insert') {
        for (const p of [].concat(this.payload)) {
          const r = insertRow(p);
          if (r === '23505') return fail('23505', 'duplicate key value');
          affected.push(r);
        }
      } else if (this.op === 'upsert') {
        for (const p of [].concat(this.payload)) {
          const ex = KEYS[t] && store[t].find(r => KEYS[t].every(k => r[k] === p[k] || (k === 'user_id' && r[k] === GUEST_ID)));
          if (ex) { if (!this.opts.ignoreDuplicates) { Object.assign(ex, p, { user_id: GUEST_ID }); affected.push(ex); } }
          else affected.push(insertRow(p));
        }
      } else if (this.op === 'update') {
        affected = this.matches();
        if (t === 'foods' && 'name' in this.payload && affected.some(r => dupName(this.payload.name, r.id))) return fail('23505', 'duplicate key value');
        affected.forEach(r => Object.assign(r, this.payload, { id: r.id }));
      } else if (this.op === 'delete') {
        const gone = this.matches();
        store[t] = store[t].filter(r => !gone.includes(r));
        if (t === 'foods') {
          const ids = gone.map(f => f.id);
          store.favourites = store.favourites.filter(r => !ids.includes(r.food_id));
          store.quick_adds = store.quick_adds.filter(r => !ids.includes(r.food_id));
          store.log_entries.forEach(e => { if (ids.includes(e.food_id)) e.food_id = null; });
        }
      }
      const e = save();
      if (e) return { data: null, error: e };
      if (t === 'log_entries' && this.op === 'insert') nudgeSignIn();
      return { data: this.returning ? this.project(affected) : null, error: null };
    }
  }
  return { from: t => new Query(t) };
}


// Copy the guest's local data into the account that just signed in. Ids are kept so a repeat
// after a partial failure changes nothing. Guest foods whose name matches one the account
// already has attach to that food. Goals, profile and quick-adds are copied only if the account has none.
// The local copy is deleted only after everything uploaded; on any error it stays for next time.
let merging = false;
async function mergeGuestData(authUser) {
  if (merging) return;
  let store = null;
  try { store = JSON.parse(localStorage.getItem(GUEST_STORE_KEY)); } catch (e) { return; }
  if (!store) return;
  const g = t => (Array.isArray(store[t]) ? store[t] : []);
  if (!GUEST_TABLES.some(t => g(t).length)) return;
  merging = true;
  try {
    const uid = authUser.id;
    // Foods: map guest ids to account ids
    const mine = await must(supa.from('foods').select('id, name').eq('owner_id', uid));
    const standardIds = (await must(supa.from('foods').select('id').is('owner_id', null))).map(f => f.id);
    const byName = new Map(mine.map(f => [f.name.toLowerCase(), f.id]));
    const idMap = new Map();
    const newFoods = [];
    for (const f of g('foods')) {
      const existing = byName.get(f.name.toLowerCase());
      if (existing) { idMap.set(f.id, existing); continue; }
      idMap.set(f.id, f.id);
      newFoods.push({ id: f.id, owner_id: uid, name: f.name, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat,
        alcohol: f.alcohol, fluid_ml: f.fluid_ml, creatine_g: f.creatine_g, created_at: f.created_at });
    }
    if (newFoods.length) await must(supa.from('foods').upsert(newFoods, { onConflict: 'id', ignoreDuplicates: true }));
    const valid = new Set([...standardIds, ...mine.map(f => f.id), ...newFoods.map(f => f.id)]);
    const mapFood = id => { const m = idMap.get(id) || id; return valid.has(m) ? m : null; };

    const favs = g('favourites').map(f => ({ user_id: uid, food_id: mapFood(f.food_id) })).filter(f => f.food_id);
    if (favs.length) await must(supa.from('favourites').upsert(favs, { onConflict: 'user_id,food_id', ignoreDuplicates: true }));

    const rows = g('log_entries').map(e => ({
      id: e.id, user_id: uid, date: e.date, food_id: mapFood(e.food_id), food_name: e.food_name, quantity: e.quantity,
      calories: e.calories, protein: e.protein, carbs: e.carbs, fat: e.fat, alcohol: e.alcohol, fluid_ml: e.fluid_ml,
      creatine_g: e.creatine_g, eaten_at: e.eaten_at, created_at: e.created_at,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      await must(supa.from('log_entries').upsert(rows.slice(i, i + 200), { onConflict: 'id', ignoreDuplicates: true }));
    }

    const goalRow = g('goals')[0];
    if (goalRow && !(await must(supa.from('goals').select('user_id').maybeSingle()))) {
      const { user_id, ...rest } = goalRow;
      await must(supa.from('goals').upsert({ user_id: uid, ...rest }));
    }
    const profileRow = g('profiles')[0];
    if (profileRow && !(await must(supa.from('profiles').select('user_id').maybeSingle()))) {
      const { user_id, ...rest } = profileRow;
      await must(supa.from('profiles').upsert({ user_id: uid, ...rest }));
    }
    const metrics = g('daily_metrics').map(m => ({ user_id: uid, date: m.date, weight_kg: m.weight_kg, source: m.source || 'manual', updated_at: m.updated_at }));
    if (metrics.length) await must(supa.from('daily_metrics').upsert(metrics, { onConflict: 'user_id,date', ignoreDuplicates: true }));
    const quick = g('quick_adds').map(q => ({ user_id: uid, slot: q.slot, food_id: mapFood(q.food_id), label: q.label })).filter(q => q.food_id);
    if (quick.length && !(await must(supa.from('quick_adds').select('slot'))).length) {
      await must(supa.from('quick_adds').upsert(quick));
    }

    localStorage.removeItem(GUEST_STORE_KEY);
    showToast(rows.length ? `Added ${rows.length} guest ${rows.length === 1 ? 'entry' : 'entries'} to your account` : 'Guest data added to your account');
  } catch (err) {
    console.error('Guest merge failed', err);
    showToast('Could not copy guest data. It is still on this device.');
  } finally {
    merging = false;
  }
}
