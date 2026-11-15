// app.js: the shell. Profile menu, sheet focus and closing, tabs, auth and start-up.
// Loaded last.

// ---------- Profile menu ----------
const profileMenu = $('profileMenu');
// Open or close the menu; the button's aria-expanded follows.
function setMenuOpen(open) {
  show(profileMenu, open);
  $('profileBtn').setAttribute('aria-expanded', open);
}
$('profileBtn').addEventListener('click', (ev) => {
  ev.stopPropagation();
  const opening = profileMenu.hidden;
  if (opening) {
    $('menuGoalsVal').textContent = goals.calories ? `${fmtNum(goals.calories)} cal` : '';
    const n = effectiveQuickAdds().filter(q => foods.some(f => f.id === q.food_id)).length;
    $('menuQuickVal').textContent = `${n} of ${QUICK_SLOTS}`;
    $('menuWeightVal').textContent = latestWeight ? fmtWeight(latestWeight.weight_kg) : '';
  }
  setMenuOpen(opening);
});
document.addEventListener('click', (ev) => {
  if (!ev.target.closest('#profile')) setMenuOpen(false);
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !profileMenu.hidden) {
    setMenuOpen(false);
    $('profileBtn').focus();
  }
});
$('menuGoals').addEventListener('click', () => { setMenuOpen(false); openGoals(); });
$('menuQuick').addEventListener('click', () => { setMenuOpen(false); openQuickEdit(); });
$('menuWeight').addEventListener('click', () => { setMenuOpen(false); openWeight(currentDate); });
$('menuSignOut').addEventListener('click', async () => {
  setMenuOpen(false);
  if (guest) startGoogleSignIn(); else await supa.auth.signOut();
});


// ---------- Keyboard and focus ----------
// Link-styled buttons ("New food", "One-off") work with Enter and Space like real buttons.
document.addEventListener('keydown', (ev) => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches?.('a[role="button"]')) { ev.preventDefault(); ev.target.click(); }
});
// When a sheet opens, focus moves into it; when it closes, focus goes back where it was.
document.querySelectorAll('.sheet-overlay').forEach(ov => {
  const sheet = ov.querySelector('.sheet');
  sheet.setAttribute('tabindex', '-1');
  let returnTo = null;
  new MutationObserver(() => {
    const open = ov.classList.contains('open');
    if (open && !returnTo) { returnTo = document.activeElement; sheet.focus({ preventScroll: true }); }
    else if (!open && returnTo) {
      // Not back into a text field: on a phone that would pop the keyboard up again.
      if (document.contains(returnTo) && !returnTo.matches('input, textarea, select')) returnTo.focus({ preventScroll: true });
      returnTo = null;
    }
  }).observe(ov, { attributes: true, attributeFilter: ['class'] });
});

// ---------- Closing sheets ----------
document.querySelectorAll('.sheet-overlay').forEach(ov => {
  ov.addEventListener('click', (ev) => { if (ev.target === ov) ov.querySelector('.sheet-head .icon-btn[aria-label="Close"]').click(); });
});
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  const open = [...document.querySelectorAll('.sheet-overlay.open')].pop();
  if (!open) return;
  ev.stopImmediatePropagation(); // one Escape closes one layer
  open.querySelector('.sheet-head .icon-btn[aria-label="Close"]').click();
});


// ---------- Tabs ----------
function switchView(view) {
  show($('view-today'), view === 'today');
  show($('view-trends'), view === 'trends');
  show($('dateNav'), view === 'today');
  $('tabToday').classList.toggle('active', view === 'today');
  $('tabTrends').classList.toggle('active', view === 'trends');
  $('hdrToday').classList.toggle('active', view === 'today');
  $('hdrTrends').classList.toggle('active', view === 'trends');
  if (view === 'trends') loadTrends();
}
$('tabToday').addEventListener('click', () => switchView('today'));
$('tabTrends').addEventListener('click', () => switchView('trends'));
$('hdrToday').addEventListener('click', () => switchView('today'));
$('hdrTrends').addEventListener('click', () => switchView('trends'));

// ---------- Auth ----------
// Nobody sees a sign-in wall: with no session the app runs in guest mode (local data, see
// Guest backend). Signing in with Google swaps to the real Supabase client.
function showApp(sessionUser, isGuest) {
  guest = isGuest;
  const firstLoad = !user || user.id !== sessionUser.id;
  user = sessionUser;
  show($('app'));
  show($('guestBanner'), guest);
  $('profileName').textContent = guest ? 'Guest' : (user.user_metadata?.full_name || 'Signed in');
  $('profileEmail').textContent = guest ? 'Saved on this device only' : (user.email || '');
  $('menuSignOutText').textContent = guest ? 'Sign in with Google' : 'Sign out';
  const avatar = user.user_metadata?.avatar_url || user.user_metadata?.picture;
  const initial = (user.user_metadata?.full_name || user.email || '?').trim().charAt(0).toUpperCase();
  const btn = $('profileBtn');
  const burger = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  btn.innerHTML = guest ? burger : avatar
    ? `<img src="${escapeHtml(avatar)}" alt="" referrerpolicy="no-referrer">`
    : `<span>${escapeHtml(initial)}</span>`;
  if (firstLoad) {
    // Token refreshes also fire auth events; only reload data for a new user.
    // Each file clears its own state. New per-user state goes in that file's reset function.
    resetTodayState();
    resetGoalsState();
    resetWeightState();
    resetTrendsState();
    setMenuOpen(false);
    (async () => {
      if (!guest) await mergeGuestData(user); // no-op unless a guest left local data behind
      switchView('today');
      refreshDateUI();
      loadFoods();
      loadGoals();
      loadWeightState();
      loadQuickAdds();
    })();
  }
}

function showSignedIn(sessionUser) {
  sb = supa;
  showApp(sessionUser, false);
}

function enterGuest() {
  if (!guest) sb = makeLocalClient();
  showApp({ id: GUEST_ID, email: '', user_metadata: {} }, true);
}

async function startGoogleSignIn() {
  if (SUPABASE_URL.includes('YOUR-PROJECT')) {
    showToast('Supabase isn’t configured yet. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in js/core.js.');
    return;
  }
  const { error } = await supa.auth.signInWithOAuth({
    provider: 'google',
    // Return to wherever the app is served (GitHub Pages or localhost).
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) showToast('Sign-in failed. Try again.');
}
$('guestSignIn').addEventListener('click', startGoogleSignIn);

// Fires on load (INITIAL_SESSION), after the Google redirect, on sign-out, and on token refresh.
// Deferred with setTimeout: supabase-js can deadlock if other Supabase calls
// are made synchronously inside this callback.
supa.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => {
    if (session?.user) showSignedIn(session.user);
    else {
      guest = false; // a real user just signed out: start a fresh guest session
      enterGuest();
    }
  }, 0);
});

// ---------- Init ----------
$('dateLabel').textContent = formatDateLabel(currentDate);
