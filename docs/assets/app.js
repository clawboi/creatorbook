/* CreatorBook — app.js (stable)
   Works with current docs/index.html structure:
   Pages: pagePost, pageBook, pageProjects, pageProfile, pageArtist, pageCreator, pageCreatePackage, pageSettings
   Goals:
   - Public home works without login
   - Auth modal works (email/pass + Google + magic link)
   - No null-onclick crashes (everything null-safe)
   - Hash router maps to existing page ids
   - Authed UI shows credits + menu, hides Sign in
*/

const SUPABASE_URL = (window.SUPABASE_URL || window.__SUPABASE_URL || "");
const SUPABASE_ANON_KEY = (window.SUPABASE_ANON_KEY || window.__SUPABASE_ANON_KEY || "");

/* ----------------------------- helpers ----------------------------- */
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

/* ----------------------------- state ----------------------------- */
const APP = {
  sb: null,
  session: null,
  user: null,
  profile: null,
};

/* ----------------------------- routing ----------------------------- */
function getHashRoute(){
  const raw = (location.hash || '#home').replace('#','').trim().toLowerCase();
  return raw || 'home';
}

function showView(route){
  const map = {
    home: 'pagePost',
    post: 'pagePost',
    book: 'pageBook',
    create: 'pageBook',
    projects: 'pageProjects',
    profile: 'pageProfile',
    settings: 'pageSettings',
    artist: 'pageArtist',
    creator: 'pageCreator',
    package: 'pageCreatePackage',
  };

  const pageId = map[route] || 'pagePost';

  $$('.page').forEach(p => p.classList.toggle('show', p.id === pageId));

  // nav active (data-nav matches hash keys like home/book/create/projects)
  $$('[data-nav]').forEach(a=>{
    const r = (a.getAttribute('data-nav') || '').trim().toLowerCase();
    a.classList.toggle('active', r === route);
  });
}

/* ----------------------------- auth modal ----------------------------- */
function openModal(id){
  const m = byId(id);
  if(!m) return;
  m.style.display = 'grid';
  m.classList.add('open');
}
function closeModal(id){
  const m = byId(id);
  if(!m) return;
  m.style.display = 'none';
  m.classList.remove('open');
}

function setAuthMode(mode){
  // mode: 'login' | 'signup'
  const isSignup = mode === 'signup';
  const bLogin = byId('authModeLogin');
  const bSignup = byId('authModeSignup');
  if(bLogin) bLogin.classList.toggle('active', !isSignup);
  if(bSignup) bSignup.classList.toggle('active', isSignup);
  if(bLogin) bLogin.setAttribute('aria-selected', String(!isSignup));
  if(bSignup) bSignup.setAttribute('aria-selected', String(isSignup));

  const help = byId('authModeHelp');
  if(help) help.textContent = isSignup
    ? "Create an account, then confirm your email if required."
    : "Sign in to book projects or manage packages.";

  const pass2 = byId('authPass2Wrap');
  const phone = byId('authPhoneWrap');
  const role = byId('authRoleWrap');
  if(pass2) pass2.style.display = isSignup ? '' : 'none';
  if(phone) phone.style.display = isSignup ? '' : 'none';
  if(role) role.style.display = isSignup ? '' : 'none';

  const goSignup = byId('authGoSignup');
  const goLogin = byId('authGoLogin');
  if(goSignup) goSignup.style.display = isSignup ? 'none' : '';
  if(goLogin) goLogin.style.display = isSignup ? '' : 'none';

  const btnLogin = byId('authLogin');
  const btnSignup = byId('authSignup');
  if(btnLogin) btnLogin.style.display = isSignup ? 'none' : '';
  if(btnSignup) btnSignup.style.display = isSignup ? '' : 'none';

  // password autocomplete hints
  const pass = byId('authPass');
  if(pass) pass.setAttribute('autocomplete', isSignup ? 'new-password' : 'current-password');
}

/* ----------------------------- profile + UI ----------------------------- */
function setAuthedUI(isAuthed){
  $$('.authed').forEach(el => el.style.display = isAuthed ? '' : 'none');
  const btn = byId('btnSignIn');
  if(btn) btn.style.display = isAuthed ? 'none' : '';
}

function updateHeader(){
  setAuthedUI(!!APP.user);

  const who = byId('whoName');
  if(who){
    const name = APP.profile?.display_name || APP.user?.email?.split('@')[0] || 'Menu';
    who.textContent = name;
  }

  // credits top pill
  const bal = byId('creditsBalTop');
  if(bal) bal.textContent = String(APP.walletBalance ?? 0);
}

async function loadProfileAndWallet(){
  if(!APP.sb || !APP.user) { APP.profile=null; APP.walletBalance=0; updateHeader(); return; }

  // profile
  try{
    const { data: pr, error } = await APP.sb
      .from('profiles')
      .select('*')
      .eq('id', APP.user.id)
      .maybeSingle();
    if(!error) APP.profile = pr || null;
  }catch(e){}

  // wallet
  try{
    const { data: w, error } = await APP.sb
      .from('credits_wallet')
      .select('balance')
      .eq('user_id', APP.user.id)
      .maybeSingle();
    if(!error) APP.walletBalance = w?.balance ?? 0;
  }catch(e){ APP.walletBalance = 0; }

  updateHeader();

  // onboarding modal (only if exists)
  if(APP.profile && APP.profile.onboarded === false && byId('onboardModal')){
    openModal('onboardModal');
  }
}

async function refreshSession(){
  if(!APP.sb) return;
  const { data } = await APP.sb.auth.getSession();
  APP.session = data?.session || null;
  APP.user = APP.session?.user || null;
  await loadProfileAndWallet();
}

/* ----------------------------- clicks + menus ----------------------------- */
function wireClicks(){
  // Top nav
  $$('[data-nav]').forEach(a=>{
    if(a._wired) return;
    a._wired = true;
    a.addEventListener('click', (e)=>{
      const href = a.getAttribute('href') || '';
      if(href.startsWith('#')){
        e.preventDefault();
        location.hash = href;
        showView(getHashRoute());
      }
    });
  });

  // Credits pill + modal (optional)
  on('creditsPill', 'click', ()=> openModal('creditsModal'));
  on('creditsClose', 'click', ()=> closeModal('creditsModal'));
  on('btnBuyCredits', 'click', ()=> openModal('creditsModal')); // placeholder

  // Profile dropdown
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

  // menu links
  on('menuHome','click', ()=>{ location.hash='#home'; showView(getHashRoute()); });
  on('menuProjects','click', ()=>{ location.hash='#projects'; showView(getHashRoute()); });
  on('menuProfile','click', ()=>{ location.hash='#profile'; showView(getHashRoute()); });

  // sign out
  on('menuSignOut','click', async ()=>{
    if(!APP.sb) return;
    await APP.sb.auth.signOut();
    await refreshSession();
    toast('Signed out');
    location.hash = '#home';
    showView(getHashRoute());
  });

  // Auth modal open/close
  on('btnSignIn','click', ()=> openModal('authModal'));
  on('authClose','click', ()=> closeModal('authModal'));

  const authModal = byId('authModal');
  if(authModal && !authModal._wired){
    authModal._wired = true;
    authModal.addEventListener('click', (e)=>{ if(e.target === authModal) closeModal('authModal'); });
    window.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeModal('authModal'); });
  }

  // onboarding + credits close (optional ids)
  on('onboardClose','click', ()=> closeModal('onboardModal'));

  // auth mode toggles
  on('authModeLogin','click', ()=> setAuthMode('login'));
  on('authModeSignup','click', ()=> setAuthMode('signup'));
  on('authGoSignup','click', ()=> setAuthMode('signup'));
  on('authGoLogin','click', ()=> setAuthMode('login'));

  // auth actions
  on('authLogin','click', authLogin);
  on('authSignup','click', authSignup);
  on('authMagic','click', authMagicLink);
  on('authGoogle','click', authGoogle);
  on('authForgot','click', authForgot);

  // default auth mode
  setAuthMode('login');
}

async function authLogin(){
  if(!APP.sb) return toast('Supabase not ready');
  const email = (byId('authEmail')?.value || '').trim();
  const pass = (byId('authPass')?.value || '').trim();
  if(!email || !pass) return toast('Enter email + password');

  const { error } = await APP.sb.auth.signInWithPassword({ email, password: pass });
  if(error) return toast(error.message || 'Sign in failed');

  toast('Signed in');
  closeModal('authModal');
  await refreshSession();
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

  // profile row is created by trigger; update role/phone if selected
  try{
    if(data?.user?.id){
      await APP.sb.from('profiles').update({ role, phone }).eq('id', data.user.id);
    }
  }catch(e){}

  toast('Account created. If email confirmation is on, check your inbox.');
  // keep modal open so they can switch to login after confirming
  setAuthMode('login');
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

async function authGoogle(){
  if(!APP.sb) return toast('Supabase not ready');
  const { error } = await APP.sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href.split('#')[0] + '#home' }
  });
  if(error) return toast(error.message || 'Google sign-in failed');
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

/* ----------------------------- recovery ----------------------------- */
function recoverInteractivity(){
  wireClicks();
  showView(getHashRoute());

  // disable hidden overlays that might block clicks
  $$('.modal, [data-backdrop], .backdrop, .modalBackdrop').forEach(el=>{
    const st = getComputedStyle(el);
    const hidden = (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0');
    if(hidden) el.style.pointerEvents = 'none';
  });
}

function setupTabFreezeRecovery(){
  window.addEventListener('pageshow', () => setTimeout(recoverInteractivity, 0));
  window.addEventListener('focus', () => setTimeout(recoverInteractivity, 0));
  document.addEventListener('visibilitychange', () => { if(!document.hidden) setTimeout(recoverInteractivity, 0); });
  window.addEventListener('hashchange', () => recoverInteractivity());
}

/* ----------------------------- init ----------------------------- */
async function initSupabase(){
  const url = SUPABASE_URL || window.SUPABASE_URL;
  const anon = SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY;

  if(!url || !anon){
    console.warn('Missing SUPABASE_URL / SUPABASE_ANON_KEY in docs/config.js');
    toast('Missing Supabase config (check docs/config.js)');
    return;
  }
  if(!window.supabase?.createClient){
    console.warn('Supabase client not found. Ensure supabase-js is loaded before app.js');
    toast('Supabase library missing');
    return;
  }

  APP.sb = window.supabase.createClient(url, anon);

  APP.sb.auth.onAuthStateChange(async (_event, session)=>{
    APP.session = session;
    APP.user = session?.user || null;
    await loadProfileAndWallet();
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
