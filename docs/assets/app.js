/* CreatorBook — app.js (V5 click-safe)
   Fixes for: "can’t click anything" + auth modal freezing.

   What V5 does:
   - Removes aggressive click-unblock hacks (they can accidentally disable interactions)
   - Uses a simple hash router that ONLY toggles existing page ids
   - Auth modal opens/closes cleanly and never traps the whole site
   - Adds a tiny on-screen debug pill (bottom-left) showing what is intercepting clicks
     (you can delete it later)

   Works with docs/index.html pages:
   pagePost, pageBook, pageProjects, pageProfile, pageArtist, pageCreator, pageCreatePackage, pageSettings
*/

const SUPABASE_URL = (window.SUPABASE_URL || window.__SUPABASE_URL || "");
const SUPABASE_ANON_KEY = (window.SUPABASE_ANON_KEY || window.__SUPABASE_ANON_KEY || "");

// ----------------------------- helpers -----------------------------
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const byId = (id) => document.getElementById(id);
const on = (id, evt, fn) => { const el = byId(id); if (el) el.addEventListener(evt, fn); return el; };

function toast(msg){
  const t = byId('toast');
  if(!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>t.classList.remove('show'), 2200);
}

// ----------------------------- state -----------------------------
const APP = {
  sb: null,
  session: null,
  user: null,
  profile: null,
  walletBalance: 0,
};

// ----------------------------- debug (temporary) -----------------------------
function ensureDebugPill(){
  if(byId('cbDebugPill')) return;
  const d = document.createElement('div');
  d.id = 'cbDebugPill';
  d.style.cssText = [
    'position:fixed',
    'left:10px',
    'bottom:10px',
    'z-index:99999',
    'max-width:360px',
    'padding:8px 10px',
    'border-radius:12px',
    'border:1px solid rgba(255,255,255,.18)',
    'background:rgba(0,0,0,.55)',
    'color:#fff',
    'font:12px/1.3 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial',
    'backdrop-filter: blur(10px)',
    'pointer-events:none'
  ].join(';');
  d.textContent = 'CB V5: ready';
  document.body.appendChild(d);
}
function setDebug(msg){
  ensureDebugPill();
  const d = byId('cbDebugPill');
  if(d) d.textContent = msg;
}

// Show what element is currently topmost under your pointer.
// If clicks “don’t work”, this tells us what is eating them.
function wireClickProbe(){
  if(document._cbProbeWired) return;
  document._cbProbeWired = true;

  const probe = (e)=>{
    try{
      const x = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
      const y = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
      const el = document.elementFromPoint(x, y);
      if(!el) return;
      const id = el.id ? '#' + el.id : '';
      const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.split(/\s+/).slice(0,2).join('.') : '';
      setDebug(`CB V5: hit ${el.tagName.toLowerCase()}${id}${cls}`);
    }catch(_){ }
  };

  document.addEventListener('pointerdown', probe, { capture:true });
  document.addEventListener('touchstart', probe, { capture:true, passive:true });
}

// ----------------------------- modal helpers -----------------------------
function openModal(id){
  const m = byId(id);
  if(!m) return;
  m.style.display = 'grid';
  m.classList.add('open');
}
function closeModal(id){
  const m = byId(id);
  if(!m) return;
  m.classList.remove('open');
  m.style.display = 'none';
}

// ----------------------------- UI -----------------------------
function setAuthedUI(isAuthed){
  $$('.authed').forEach(el => el.style.display = isAuthed ? '' : 'none');
  const btn = byId('btnSignIn');
  if(btn) btn.style.display = isAuthed ? 'none' : '';
}

function updateHeader(){
  setAuthedUI(!!APP.user);

  const who = byId('whoName');
  if(who){
    const name = APP.profile?.display_name || (APP.user?.email ? APP.user.email.split('@')[0] : 'Guest');
    who.textContent = name;
  }

  const bal = byId('creditsBalTop');
  if(bal) bal.textContent = String(APP.walletBalance ?? 0);
}

async function loadProfileAndWallet(){
  if(!APP.sb || !APP.user){
    APP.profile = null;
    APP.walletBalance = 0;
    updateHeader();
    return;
  }

  try{
    const { data: pr } = await APP.sb
      .from('profiles')
      .select('*')
      .eq('id', APP.user.id)
      .maybeSingle();
    APP.profile = pr || null;
  }catch(_){ APP.profile = null; }

  try{
    const { data: w } = await APP.sb
      .from('credits_wallet')
      .select('balance')
      .eq('user_id', APP.user.id)
      .maybeSingle();
    APP.walletBalance = w?.balance ?? 0;
  }catch(_){ APP.walletBalance = 0; }

  updateHeader();
}

async function refreshSession(){
  if(!APP.sb) return;
  const { data } = await APP.sb.auth.getSession();
  APP.session = data?.session || null;
  APP.user = APP.session?.user || null;
  await loadProfileAndWallet();
}

// ----------------------------- routing -----------------------------
function route(){
  const r = (location.hash || '#home').replace('#','').trim().toLowerCase() || 'home';

  // Route -> page id
  let pageId = 'pagePost';
  if(r === 'home' || r === 'post') pageId = 'pagePost';
  else if(r === 'book') pageId = 'pageBook';
  else if(r === 'projects') pageId = 'pageProjects';
  else if(r === 'profile') pageId = 'pageProfile';
  else if(r === 'settings') pageId = 'pageSettings';
  else if(r === 'artist') pageId = 'pageArtist';
  else if(r === 'creator') pageId = 'pageCreator';
  else if(r === 'package' || r === 'createpackage' || r === 'create-package') pageId = 'pageCreatePackage';
  else if(r === 'create'){
    const role = (APP.profile?.role || '').toLowerCase();
    pageId = (role === 'creator') ? 'pageCreatePackage' : 'pageArtist';
  }

  // Protect authed pages
  const needsAuth = new Set(['projects','profile','settings','artist','creator','package','createpackage','create-package','create']);
  if(!APP.user && needsAuth.has(r)){
    // bounce home and open auth modal
    pageId = 'pagePost';
    location.hash = '#home';
    openModal('authModal');
  } else {
    // navigating away should never leave the auth modal covering the page
    closeModal('authModal');
  }

  // show/hide pages and FORCE display override because HTML has inline display:none
  $$('.page').forEach(p => {
    const active = (p.id === pageId);
    p.style.display = active ? '' : 'none';
    p.classList.toggle('show', active);
  });

  // nav active
  $$('[data-nav]').forEach(a => {
    const dn = (a.getAttribute('data-nav') || '').trim().toLowerCase();
    a.classList.toggle('active', dn === r || (r === 'home' && dn === 'home'));
  });
}

// ----------------------------- auth actions -----------------------------
function setAuthMode(mode){
  const isSignup = (mode === 'signup');
  byId('authModeLogin')?.classList.toggle('active', !isSignup);
  byId('authModeSignup')?.classList.toggle('active', isSignup);
  byId('authPass2Wrap') && (byId('authPass2Wrap').style.display = isSignup ? '' : 'none');
  byId('authPhoneWrap') && (byId('authPhoneWrap').style.display = isSignup ? '' : 'none');
  byId('authRoleWrap') && (byId('authRoleWrap').style.display = isSignup ? '' : 'none');
  byId('authGoSignup') && (byId('authGoSignup').style.display = isSignup ? 'none' : '');
  byId('authGoLogin') && (byId('authGoLogin').style.display = isSignup ? '' : 'none');
  byId('authLogin') && (byId('authLogin').style.display = isSignup ? 'none' : '');
  byId('authSignup') && (byId('authSignup').style.display = isSignup ? '' : 'none');
}

async function authLogin(){
  if(!APP.sb) return toast('Supabase not ready');
  const email = (byId('authEmail')?.value || '').trim();
  const pass = (byId('authPass')?.value || '').trim();
  if(!email || !pass) return toast('Enter email + password');

  const { error } = await APP.sb.auth.signInWithPassword({ email, password: pass });
  if(error) return toast(error.message || 'Sign in failed');

  closeModal('authModal');
  await refreshSession();
  toast('Signed in');
  route();
}

async function authSignup(){
  if(!APP.sb) return toast('Supabase not ready');
  const email = (byId('authEmail')?.value || '').trim();
  const pass = (byId('authPass')?.value || '').trim();
  const pass2 = (byId('authPass2')?.value || '').trim();
  const phone = (byId('authPhone')?.value || '').trim();
  const role = (byId('authRole')?.value || 'client');

  if(!email || !pass) return toast('Enter email + password');
  if(pass.length < 6) return toast('Password must be 6+ characters');
  if(pass2 && pass !== pass2) return toast('Passwords do not match');

  const { data, error } = await APP.sb.auth.signUp({
    email,
    password: pass,
    options: { data: { phone } }
  });
  if(error) return toast(error.message || 'Signup failed');

  // Update profile fields if user exists (trigger creates row)
  try{
    if(data?.user?.id){
      await APP.sb.from('profiles').update({ role, phone }).eq('id', data.user.id);
    }
  }catch(_){ }

  toast('Account created. If confirmation is on, check email then sign in.');
  setAuthMode('login');
}

async function authGoogle(){
  if(!APP.sb) return toast('Supabase not ready');
  const { error } = await APP.sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href.split('#')[0] + '#home' }
  });
  if(error) return toast(error.message || 'Google sign-in failed');
}

async function authMagicLink(){
  if(!APP.sb) return toast('Supabase not ready');
  const email = (byId('authEmail')?.value || '').trim();
  if(!email) return toast('Enter your email');
  const { error } = await APP.sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href.split('#')[0] + '#home' }
  });
  if(error) return toast(error.message || 'Magic link failed');
  toast('Magic link sent. Check your email.');
}

async function authForgot(){
  if(!APP.sb) return toast('Supabase not ready');
  const email = (byId('authEmail')?.value || '').trim();
  if(!email) return toast('Enter your email');
  const { error } = await APP.sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href.split('#')[0] + '#home'
  });
  if(error) return toast(error.message || 'Reset failed');
  toast('Password reset email sent.');
}

// ----------------------------- wiring -----------------------------
function wire(){
  // hash router
  window.addEventListener('hashchange', route);

  // nav links (prevent default so we always route)
  $$('[data-nav]').forEach(a => {
    if(a._wired) return;
    a._wired = true;
    a.addEventListener('click', (e)=>{
      const href = a.getAttribute('href') || '';
      if(href.startsWith('#')){
        e.preventDefault();
        location.hash = href;
        route();
      }
    });
  });

  // sign in button
  on('btnSignIn','click', ()=> openModal('authModal'));
  on('authClose','click', ()=> closeModal('authModal'));

  // close modal on backdrop click
  const authModal = byId('authModal');
  if(authModal && !authModal._wired){
    authModal._wired = true;
    authModal.addEventListener('click', (e)=>{ if(e.target === authModal) closeModal('authModal'); });
    window.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeModal('authModal'); });
  }

  // mode toggles
  on('authModeLogin','click', ()=> setAuthMode('login'));
  on('authModeSignup','click', ()=> setAuthMode('signup'));
  on('authGoSignup','click', ()=> setAuthMode('signup'));
  on('authGoLogin','click', ()=> setAuthMode('login'));
  setAuthMode('login');

  // auth actions
  on('authLogin','click', authLogin);
  on('authSignup','click', authSignup);
  on('authGoogle','click', authGoogle);
  on('authMagic','click', authMagicLink);
  on('authForgot','click', authForgot);

  // profile menu
  const btnProfile = byId('btnProfile');
  const menu = byId('profileMenu');
  if(btnProfile && menu && !btnProfile._wired){
    btnProfile._wired = true;
    btnProfile.addEventListener('click', (e)=>{
      e.preventDefault();
      menu.style.display = (!menu.style.display || menu.style.display === 'none') ? 'block' : 'none';
    });
    document.addEventListener('click', (e)=>{
      if(!menu.contains(e.target) && e.target !== btnProfile){
        menu.style.display = 'none';
      }
    });
  }

  on('menuHome','click', ()=>{ location.hash='#home'; route(); });
  on('menuProjects','click', ()=>{ location.hash='#projects'; route(); });
  on('menuProfile','click', ()=>{ location.hash='#profile'; route(); });

  on('menuSignOut','click', async ()=>{
    if(!APP.sb) return;
    await APP.sb.auth.signOut();
    await refreshSession();
    toast('Signed out');
    location.hash = '#home';
    route();
  });

  // credits modal close buttons (if present)
  on('creditsPill','click', ()=> openModal('creditsModal'));
  on('btnCloseCredits','click', ()=> closeModal('creditsModal'));

  // click probe
  wireClickProbe();
}

// ----------------------------- init -----------------------------
async function initSupabase(){
  const url = SUPABASE_URL || window.SUPABASE_URL;
  const anon = SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY;

  if(!url || !anon){
    console.warn('Missing SUPABASE_URL / SUPABASE_ANON_KEY in docs/config.js');
    toast('Missing Supabase config (check docs/config.js)');
    setDebug('CB V5: missing config.js keys');
    return;
  }
  if(!window.supabase?.createClient){
    console.warn('Supabase client not found. Ensure supabase-js is loaded before app.js');
    toast('Supabase library missing');
    setDebug('CB V5: missing supabase-js');
    return;
  }

  APP.sb = window.supabase.createClient(url, anon);

  APP.sb.auth.onAuthStateChange(async (_event, session)=>{
    APP.session = session;
    APP.user = session?.user || null;
    if(APP.user) closeModal('authModal');
    await loadProfileAndWallet();
    route();
  });

  await refreshSession();
}

async function init(){
  ensureDebugPill();
  wire();
  route();
  await initSupabase();
  route();
}

document.addEventListener('DOMContentLoaded', init);
