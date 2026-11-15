// core.js: Supabase client, shared helpers, shared state, toast and data access.
// Loaded first; every other file uses it.

/* =========================================================
   CalTal — Calorie Tracker
   Talks directly to Supabase (Postgres + Google sign-in).
   Row-level security in supabase/schema.sql decides what each
   user can see, so the publishable key below is safe to publish.
   No build step: index.html loads styles.css and the js/ files
   as plain scripts that share globals. Load order is core, guest,
   goals, weight, today, trends, app.
   ========================================================= */

// Supabase dashboard → Project Settings → API
const SUPABASE_URL = 'https://virurqttoukgzrpdsizs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_2oFe8xFGmgV7wRaBVDX47w_yLOgi7ms'; // sb_publishable_...

const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
let sb = supa;            // the real client, or the local guest stand-in (see Guest backend)
let guest = false;

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; // local date, YYYY-MM-DD
const hhmm = d => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;                   // local time, HH:MM
const dayStart = dateStr => new Date(dateStr + 'T00:00:00');                          // local midnight
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

function todayStr() { return ymd(new Date()); }

function addDays(dateStr, n) {
  const d = dayStart(dateStr);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

function formatDateLabel(dateStr) {
  if (dateStr === todayStr()) return 'Today';
  if (dateStr === addDays(todayStr(), -1)) return 'Yesterday';
  return dayStart(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function round1(n) { return Math.round(n * 10) / 10; }
function fmtNum(n) { return Math.round(n).toLocaleString(); }

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const trendsVisible = () => $('view-trends').style.display !== 'none';

// Thrown by form readers when a field's value is not acceptable; the message goes in a toast.
class InvalidField extends Error {}

// Every sheet is a .sheet-overlay that is shown by the "open" class.
function openSheet(id) { $(id).classList.add('open'); }
function closeSheet(id) { $(id).classList.remove('open'); }

// A .seg control: mark the button that `isOn` picks as the active one.
function setSeg(id, isOn) {
  document.querySelectorAll(`#${id} button`).forEach(b => {
    const on = isOn(b);
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on);
  });
}

// ---------- State ----------
let user = null;          // signed-in Supabase user
let foods = [];           // standard + own foods, favourites first
let recentFoodIds = [];   // food ids, most recently logged first (no repeats)
const RECENT_MAX = 8;
let currentDate = todayStr();
let entries = [];         // today's (or viewed day's) log entries
let activeFood = null;    // per-unit values for the food currently in the log/edit sheet
let pendingQty = 1;
let editingId = null;     // null = adding a new entry; set = id of the log entry being edited
let entriesRequest = 0;   // guards against out-of-order responses when flicking between days

// ---------- Toast ----------
let toastTimer = null;
function showToast(msg, action) {
  const t = $('toast');
  // Never cover an Undo that is still on screen: a plain message waits its turn.
  if (!action && t.classList.contains('actionable') && t.classList.contains('show')) {
    setTimeout(() => showToast(msg), 5200);
    return;
  }
  t.textContent = msg;
  t.classList.toggle('actionable', !!action);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => { t.classList.remove('show', 'actionable'); action.run(); });
    t.appendChild(b);
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show', 'actionable'), action ? 5000 : 1800);
}

// Run `work` with `btn` disabled (and its text swapped to `busyText`, if given), then put it back.
// Handlers keep their own try/catch inside `work`, since several map error codes to messages.
async function withBusy(btn, busyText, work) {
  const label = btn.textContent;
  btn.disabled = true;
  if (busyText) btn.textContent = busyText;
  try {
    return await work();
  } finally {
    if (busyText) btn.textContent = label;
    btn.disabled = false;
  }
}

// ---------- Data access ----------
// Supabase calls resolve to { data, error } rather than throwing; this turns
// errors into exceptions so the existing try/catch + toast pattern works.
async function must(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// The amounts every food (per serving) and log entry (totals) carries.
// alcohol is standard drinks, fluid_ml millilitres, creatine_g grams.
const NUTRIENTS = ['calories', 'protein', 'carbs', 'fat', 'alcohol', 'fluid_ml', 'creatine_g'];
const FOOD_COLS = `id, owner_id, name, ${NUTRIENTS.join(', ')}`;
const ENTRY_COLS = `id, date, food_id, food_name, quantity, ${NUTRIENTS.join(', ')}, eaten_at, created_at`;

function numeric(row) {
  // Postgres numeric can arrive as strings; normalise to numbers.
  for (const k of [...NUTRIENTS, 'quantity']) if (k in row) row[k] = Number(row[k]) || 0;
  return row;
}

// Food list order: favourites first, then A-Z.
const byFavThenName = (a, b) => (b.favourite - a.favourite) || a.name.localeCompare(b.name);

// A log entry's food fields for one serving of `food`.
function servingOf(food) {
  const row = { food_id: food.id, food_name: food.name, quantity: 1 };
  for (const k of NUTRIENTS) row[k] = food[k] || 0;
  return row;
}
