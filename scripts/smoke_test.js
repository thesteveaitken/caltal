// Smoke test driven by scripts/smoke_test.py. It is injected into a copy of the app, runs one
// guest-mode session (nothing is written to Supabase; only the standard foods are read) and
// leaves what it saw in <pre id="__out"> as JSON. Ids and clock times are masked so two runs compare.
(async () => {
  const out = { errors: [], steps: {} };
  window.addEventListener('error', e => out.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', e => out.errors.push('rej: ' + String(e.reason && e.reason.message || e.reason)));
  const origErr = console.error; console.error = (...a) => { out.errors.push('console: ' + a.map(x => x && x.message || String(x)).join(' ')); origErr(...a); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (f, label) => { for (let i = 0; i < 100; i++) { if (f()) return; await sleep(100); } out.errors.push('timeout: ' + label); };
  const q = s => document.querySelector(s);
  const clean = h => h.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'ID').replace(/\d+:\d\d[ap]/g, 'TIME');
  const snap = name => { out.steps[name] = clean(['entryList', 'goalGrid', 'totalCal', 'calLeft', 'quickGrid', 'tally'].map(id => document.getElementById(id).innerHTML).join('\n||')); };
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const nEntries = () => document.querySelectorAll('#entryList .entry').length;
  try {
    await until(() => document.querySelectorAll('#foodList .food-item').length > 5, 'foods');
    out.steps.foodCount = document.querySelectorAll('#foodList .food-item').length;
    out.steps.first5 = [...document.querySelectorAll('#foodList .food-item')].slice(0, 5).map(e => e.textContent.replace(/\s+/g, ' ').trim());
    await until(() => q('#quickGrid .quick-btn[data-food]'), 'quick');
    q('#quickGrid .quick-btn[data-food]').click();
    await until(() => nEntries() === 1, 'quick logged');
    q('#quickGrid .quick-btn[data-food]').click();
    await until(() => document.querySelector('#entryList .group-head'), 'grouped');
    snap('afterQuick');
    // log sheet: second food, 2.5 servings
    document.querySelectorAll('#foodList .food-item')[7].click();
    await sleep(50);
    for (let i = 0; i < 3; i++) q('#qtyPlus').click();
    q('#timeMinus').click();
    out.steps.logSheet = [q('#logSheetTitle').textContent, q('#logSheetSub').textContent, q('#qtyValue').textContent, q('#prevCal').textContent, q('#prevMacros').textContent, q('#logAfter').textContent, q('#logSheetOverlay').className];
    q('#confirmLog').click();
    await until(() => nEntries() === 2 && !q('#logSheetOverlay').classList.contains('open'), 'logged');
    // new food, save and log
    q('#addNewFoodLink').click();
    set('newFoodName', 'Test bar 50g'); set('newFoodCal', '210'); set('newFoodP', '12'); set('newFoodC', '20'); set('newFoodF', '9');
    q('#moreToggle').click(); set('newFoodFluid', '100'); set('newFoodCr', '5');
    q('#saveNewFood').click();
    await until(() => nEntries() === 3, 'food saved+logged');
    // phone search screen: New food / One-off sit between the search box and the list; One-off takes the search text
    q('#searchInput').focus();
    set('searchInput', 'birthday cake');
    await sleep(50);
    const top = sel => Math.round(q(sel).getBoundingClientRect().top);
    out.steps.addingRow = [document.body.classList.contains('adding') ? 'adding' : 'not adding',
      top('#searchInput') < top('#addNewFoodLink') && top('#addNewFoodLink') < top('#foodList') ? 'row under search' : 'row elsewhere',
      getComputedStyle(q('#addNewFoodLink')).borderTopStyle];
    q('#logOneOffLink').click();
    out.steps.addingRow.push(q('#oneOffName').value);
    q('#closeOneOff').click();
    q('#addCancel').click();
    await sleep(50);
    // one-off
    q('#logOneOffLink').click();
    set('oneOffName', 'Cake'); set('oneOffCal', '300'); set('oneOffF', '15');
    q('#saveOneOff').click();
    await until(() => nEntries() === 4, 'one-off');
    snap('afterLogs');
    // edit an entry
    [...document.querySelectorAll('#entryList .entry[data-id]')].pop().click();
    await sleep(50);
    out.steps.editSheet = [q('#logSheetTitle').textContent, q('#logSheetSub').textContent, q('#qtyValue').textContent, q('#prevMacros').textContent, q('#logTime').value ? 'has time' : 'no time', getComputedStyle(q('#removeEntry')).display === 'none' ? 'hidden' : 'shown'];
    q('#qtyPlus').click(); q('#confirmLog').click();
    await sleep(600);
    // log again on the Test bar
    const again = [...document.querySelectorAll('#entryList .entry-again')].find(b => b.getAttribute('aria-label').includes('Test bar'));
    again.click();
    await until(() => document.querySelectorAll('#entryList .group-head').length === 2, 'log again');
    // remove + undo
    [...document.querySelectorAll('#entryList .entry[data-id]')].pop().click(); await sleep(50);
    q('#removeEntry').click();
    await until(() => q('#toast button'), 'undo toast');
    out.steps.toast = q('#toast').textContent;
    q('#toast button').click();
    await sleep(600);
    snap('afterEdit');
    // goals: helper + save
    q('#menuGoals').click(); await sleep(300);
    q('#helperToggle').click();
    q('#helperUnits [data-units="metric"]').click();
    set('hYear', '1990'); set('hCm', '180'); set('hWt', '80');
    q('input[name="hSex"][value="male"]').click(); q('input[name="hActivity"][value="light"]').click(); q('input[name="hAim"][value="lose_slow"]').click();
    out.steps.helper = [q('#hAim_lose_slow_note').textContent, q('#helperUnits').innerHTML, q('#hWtLabel').textContent];
    q('#helperFill').click(); await sleep(300);
    q('#goalOn_creatine_g').click();
    out.steps.goalVals = ['calories', 'protein', 'fluid_ml', 'creatine_g', 'weight'].map(k => document.getElementById('goalVal_' + k).value);
    q('#saveGoals').click();
    await until(() => !q('#goalsOverlay').classList.contains('open'), 'goals saved');
    // weight
    q('#menuWeight').click(); await sleep(400);
    out.steps.weightSheet = [q('#weightSub').textContent, q('#weightUnits').innerHTML, q('#weightGoalUnit').textContent];
    set('weightVal', '81.5'); q('#weightGoalOn').click();
    set('weightGoalVal', '78'); q('#saveWeight').click();
    await until(() => !q('#weightOverlay').classList.contains('open'), 'weight saved');
    await sleep(600);
    snap('afterGoals');
    // previous day and back
    q('#prevDay').click(); await sleep(400);
    out.steps.yesterday = [q('#dateLabel').textContent, clean(q('#entryList').innerHTML), clean(q('#goalGrid').innerHTML)];
    q('#nextDay').click(); await sleep(400);
    // trends
    q('#tabTrends').click();
    await until(() => document.querySelectorAll('#trendCards svg').length >= 5, 'trends');
    await sleep(500);
    document.querySelector('#trendCards .tb-hit').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    out.steps.trends7 = [q('#trendRange').textContent, q('#trendSeg').innerHTML, clean(q('#trendCards').innerHTML)];
    q('#trendSeg [data-days="28"]').click(); await sleep(800);
    out.steps.trends28 = [q('#trendRange').textContent, q('#trendSeg').innerHTML, clean(q('#trendCards').innerHTML)];
    q('#trendPrev').click(); await sleep(800);
    out.steps.trendsPrev = [q('#trendRange').textContent, clean(q('#trendCards').innerHTML)];
    // goal weight row, shared by the Weight and Goals sheets: range and blank messages, kg rounding,
    // and an unchanged box keeping the stored value
    const goalKg = () => (JSON.parse(localStorage.getItem('caltal_guest_v1')).goals[0] || {}).weight_kg;
    const toastAfter = async () => { await sleep(100); return q('#toast').textContent; };
    q('#menuWeight').click(); await sleep(400);
    q('#weightUnits [data-units="us"]').click();
    set('weightVal', '999'); q('#saveWeight').click();
    const weightRange = await toastAfter();
    set('weightVal', ''); set('weightGoalVal', '5000'); q('#saveWeight').click();
    const goalRangeW = await toastAfter();
    set('weightGoalVal', '170.3'); q('#saveWeight').click();
    await until(() => !q('#weightOverlay').classList.contains('open'), 'weight goal saved');
    const kgW = goalKg();
    q('#menuGoals').click(); await sleep(400);
    const shownG = [q('#goalVal_weight').value, q('#goalUnit_weight').textContent, q('#goalVal_weight').getAttribute('aria-label')];
    set('goalVal_weight', '5000'); q('#saveGoals').click();
    const goalRangeG = await toastAfter();
    set('goalVal_weight', ''); q('#saveGoals').click();
    const goalBlankG = await toastAfter();
    set('goalVal_weight', '170.37'); q('#saveGoals').click();
    await until(() => !q('#goalsOverlay').classList.contains('open'), 'goals weight saved');
    const kgG = goalKg();
    q('#menuGoals').click(); await sleep(400); q('#saveGoals').click();
    await until(() => !q('#goalsOverlay').classList.contains('open'), 'goals saved unchanged');
    out.steps.goalWeight = [weightRange, goalRangeW, kgW, shownG, goalRangeG, goalBlankG, kgG, goalKg()];
    out.steps.store = clean(localStorage.getItem('caltal_guest_v1') || '').replace(/"\d{4}-\d\d-\d\dT[\d:.]+Z"/g, '"TS"');
    // alcohol on past days (after `store`, so it leaves earlier steps alone): the alcohol card in both views
    const past = [1, 2, 4, 5, 8, 12, 15, 19, 26, 33, 40, 47, 54, 61].map((k, i) => ({
      date: addDays(todayStr(), -k), food_name: 'Beer', quantity: 1, calories: 150, alcohol: 1 + (i % 3), fluid_ml: 0 }));
    await sb.from('log_entries').insert(past);
    const alcCard = () => clean(q('#trendCards [data-card="alc"]').innerHTML);
    q('#tabTrends').click();
    q('#trendSeg [data-days="7"]').click(); await sleep(800);
    const alc7 = alcCard();
    q('#trendSeg [data-days="28"]').click(); await sleep(800);
    out.steps.alcLine = [alc7, alcCard()];
    // a long Today list on a phone: log again from the bottom keeps the page scrolled, and the new row
    // ends up in view above the pinned band; a quick-add from the top scrolls down to its row
    await sb.from('log_entries').insert(['Toast', 'Apple', 'Soup', 'Rice', 'Salad', 'Tea', 'Cake', 'Nuts', 'Pear'].map((n, i) => ({
      date: todayStr(), food_name: n, quantity: 1, calories: 100 + i, eaten_at: new Date(Date.now() - (9 - i) * 6e5).toISOString() })));
    q('#tabToday').click(); q('#prevDay').click(); await sleep(400); q('#nextDay').click(); await sleep(600);
    const band = () => q('.add-panel').getBoundingClientRect().top;
    const inView = el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= band(); };
    window.scrollTo(0, document.body.scrollHeight); await sleep(300);
    const pear = [...document.querySelectorAll('#entryList .entry[data-id]')].find(el => el.textContent.includes('Pear'));
    const before = window.scrollY;
    pear.querySelector('.entry-again').click(); await sleep(1200);
    const flashed = q('#entryList .flash');
    const kept = [before > 0, window.scrollY > before / 2, !!flashed && flashed.textContent.includes('Pear'), !!flashed && inView(flashed)];
    window.scrollTo(0, 0); await sleep(300);
    q('#quickGrid button').click(); await sleep(1200);
    const flashed2 = q('#entryList .flash');
    out.steps.scrollKeep = [...kept, !!flashed2 && inView(flashed2), window.scrollY > 0];
  } catch (e) { out.errors.push('test threw: ' + e.message + ' ' + (e.stack || '').split('\n')[1]); }
  const pre = document.createElement('pre'); pre.id = '__out'; pre.textContent = JSON.stringify(out); document.body.appendChild(pre);
  document.title = 'DONE';
})();
