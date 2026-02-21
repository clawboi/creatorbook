/* CreatorBook — Minimal Stable Router + Tab-Freeze Recovery
   Purpose: stop "can't click" after tab-switch and remove any JS syntax crashes.
   This is a stability build: clean routing, safe event wiring, and Supabase auth bootstrap.
*/

// ----------------------------- helpers -----------------------------
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const byId = (id) => document.getElementById(id);
const on = (id, evt, fn) => { const el = byId(id); if (el) el.addEventListener(evt, fn); return el; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));

function toast(msg){
  const t = byId('toast');
  if(!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>t.classList.remove('show'), 2600);
}

// ----------------------------- app state -----------------------------
const APP = {
  sb: null,
  session: null,
  user: null,
};

function getHashRoute(){
  const h = (location.hash || '#home').replace('#','');
  return h || 'home';
}

function showView(route){
  // expects sections with [data-view] or ids like view-home, view-profile, view-create
  const views = $$('[data-view]');
  if(views.length){
    views.forEach(v => v.style.display = (v.getAttribute('data-view') === route ? '' : 'none'));
  } else {
    // fallback to common ids
    const ids = ['home','create','profile','projects','admin'];
    ids.forEach(r=>{ const el = byId('view-'+r) || byId(r); if(el) el.style.display = (r===route?'':'none'); });
  }

  // mark nav active if present
  $$('[data-nav]').forEach(a=>{
    const r = a.getAttribute('data-nav');
    a.classList.toggle('active', r === route);
  });
}

async function refreshSession(){
  if(!APP.sb) return;
  const { data } = await APP.sb.auth.getSession();
  APP.session = data?.session || null;
  APP.user = APP.session?.user || null;
  updateHeader();
}

function updateHeader(){
  // Optional UI elements
  const who = byId('userChip') || byId('navUser') || byId('username');
  const signInBtn = byId('btnSignIn') || byId('navSignIn');
  const signOutBtn = byId('btnSignOut') || byId('navSignOut');

  if(APP.user){
    if(who) who.textContent = APP.user.email || 'Signed in';
    if(signInBtn) signInBtn.style.display = 'none';
    if(signOutBtn) signOutBtn.style.display = '';
  } else {
    if(who) who.textContent = 'Guest';
    if(signInBtn) signInBtn.style.display = '';
    if(signOutBtn) signOutBtn.style.display = 'none';
  }
}

function wireClicks(){
  // Any element with data-route="#profile" etc
  $$('[data-route]').forEach(el=>{
    if(el._wired) return;
    el._wired = true;
    el.addEventListener('click', (e)=>{
      const r = el.getAttribute('data-route');
      if(!r) return;
      e.preventDefault();
      location.hash = r.startsWith('#') ? r : '#'+r;
    });
  });

  // Common buttons (null-safe)
  on('btnHome','click', ()=>location.hash='#home');
  on('btnProfile','click', ()=>location.hash='#profile');
  on('btnCreate','click', ()=>location.hash='#create');

  on('btnSignOut','click', async ()=>{
    if(!APP.sb) return;
    await APP.sb.auth.signOut();
    await refreshSession();
    toast('Signed out');
    location.hash = '#home';
  });
}

function recoverInteractivity(){
  // 1) Re-wire event listeners (some browsers drop them after bfcache)
  wireClicks();

  // 2) Re-render current route
  showView(getHashRoute());

  // 3) Kill accidental click-blocking overlays (common cause)
  //    If a modal/backdrop exists and is invisible but still intercepting pointer events,
  //    force pointer-events off.
  $$('[data-backdrop], .backdrop, .modalBackdrop').forEach(el=>{
    const st = getComputedStyle(el);
    if(st.opacity === '0' || st.display === 'none' || st.visibility === 'hidden'){
      el.style.pointerEvents = 'none';
    }
  });
}

function setupTabFreezeRecovery(){
  // BFCache / tab-switch recovery
  window.addEventListener('pageshow', () => setTimeout(recoverInteractivity, 0));
  window.addEventListener('focus', () => setTimeout(recoverInteractivity, 0));
  document.addEventListener('visibilitychange', () => {
    if(!document.hidden) setTimeout(recoverInteractivity, 0);
  });

  // Also refresh on hash change
  window.addEventListener('hashchange', () => recoverInteractivity());
}

async function initSupabase(){
  // config.js must define SUPABASE_URL and SUPABASE_ANON_KEY
  const url = window.SUPABASE_URL;
  const anon = window.SUPABASE_ANON_KEY;
  if(!url || !anon){
    console.warn('Missing SUPABASE_URL / SUPABASE_ANON_KEY in config.js');
    return;
  }

  // Supabase JS should be loaded as window.supabase
  if(!window.supabase?.createClient){
    console.warn('Supabase client not found. Ensure supabase-js is loaded before app.js');
    return;
  }

  APP.sb = window.supabase.createClient(url, anon);

  APP.sb.auth.onAuthStateChange((_event, session)=>{
    APP.session = session;
    APP.user = session?.user || null;
    updateHeader();
    recoverInteractivity();
  });

  await refreshSession();
}

async function init(){
  setupTabFreezeRecovery();
  wireClicks();
  showView(getHashRoute());
  await initSupabase();
  recoverInteractivity();
}

document.addEventListener('DOMContentLoaded', init);
