/* CreatorBook — app.js (DROP-IN, hardened)
   Goals:
   - No "nothing is clickable" crashes (no undefined helpers, no window.add, no btn.add)
   - Public Home works without login
   - After login: Home / Create / Profile
   - Credits always visible (top right) when signed in
   - Create Project: find package -> request date -> message -> project created
   - Profile: projects list + feed + settings
*/

'use strict';

let cbPointerRecover = ()=>{};


/* ----------------------------- helpers ----------------------------- */
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const byId = (id) => document.getElementById(id);
const on = (id, evt, fn, opts) => {
  const el = byId(id);
  if(el) el.addEventListener(evt, fn, opts);
  return el;
};
const esc = (s="") => String(s).replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));


function embedMedia(url){
  const u = String(url||'').trim();
  if(!u) return '';
  const lower = u.toLowerCase();
  const isImg = lower.match(/\.(png|jpg|jpeg|gif|webp)(\?.*)?$/);
  const isVid = lower.match(/\.(mp4|webm|mov)(\?.*)?$/);

  const yt = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if(yt){
    const id = yt[1];
    return `<div class="embed"><iframe src="https://www.youtube.com/embed/${esc(id)}" title="YouTube" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  const vm = u.match(/vimeo\.com\/(\d{6,})/);
  if(vm){
    const id = vm[1];
    return `<div class="embed"><iframe src="https://player.vimeo.com/video/${esc(id)}" title="Vimeo" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  }

  if(isImg){
    return `<div class="embed"><img src="${esc(u)}" alt="post media" style="width:100%; border-radius:12px; display:block;" loading="lazy" /></div>`;
  }
  if(isVid){
    return `<div class="embed"><video src="${esc(u)}" controls style="width:100%; border-radius:12px; display:block;"></video></div>`;
  }
  return `<div class="embed"><a class="pill" href="${esc(u)}" target="_blank" rel="noreferrer">Open media</a></div>`;
}

function toast(msg){
  const t = byId("toast");
  if(!t) return;
  t.textContent = String(msg || "");
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>t.classList.remove("show"), 2400);
}
function moneyCredits(n){
  const v = Number(n||0);
  if(Number.isNaN(v)) return "0";
  return v.toLocaleString();
}
function fmtDateTime(ts){
  if(!ts) return "";
  const d = new Date(ts);
  if(Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { year:"numeric", month:"short", day:"2-digit", hour:"numeric", minute:"2-digit" });
}

/* ----------------------------- URL / auth hash helpers ----------------------------- */
function authRedirectTo(){
  // GitHub Pages base
  const { origin, pathname } = location;
  const want = "/creatorbook/";
  if(pathname.includes(want)) return origin + want;
  return origin + want;
}
function hashParams(){
  const h = (location.hash || "").replace(/^#/, "");
  return new URLSearchParams(h);
}
function authArtifactsPresent(){
  const hp = hashParams();
  return hp.has("access_token") || hp.has("refresh_token") || hp.has("type") || hp.has("error") || hp.has("error_description");
}
function clearAuthArtifacts(toHash="home"){
  try{
    history.replaceState(null, "", location.pathname + location.search + "#" + (toHash || "home"));
  }catch(_e){
    location.hash = "#" + (toHash || "home");
  }
}
function handleAuthHashErrors(){
  const hp = hashParams();
  const err = hp.get("error") || hp.get("error_code");
  const desc = hp.get("error_description");
  if(err || desc){
    const msg = decodeURIComponent((desc || err || "Authentication error").replace(/\+/g," "));
    toast(msg);
    clearAuthArtifacts("home");
    return true;
  }
  return false;
}
function getHash(){
  // If hash contains auth params, treat as home.
  const hp = hashParams();
  if(hp.has("access_token") || hp.has("refresh_token") || hp.has("type") || hp.has("error")) return "home";
  const raw = (location.hash || "#home").replace(/^#/, "").trim();
  if(raw.includes("=")) return "home";
  return raw || "home";
}

/* ----------------------------- state ----------------------------- */
const APP = {
  sb: null,
  session: null,
  user: null,
  me: null,
  wallet: null,
  chosen: { creator:null, package:null },
  authMode: "login",
  _booting: false,
};

const POST_LOGIN_HASH_KEY = "CREATORBOOK_POST_LOGIN_HASH";
function setPostLoginHash(hash){
  try{ localStorage.setItem(POST_LOGIN_HASH_KEY, String(hash||"")); }catch(_e){}
}
function popPostLoginHash(){
  try{
    const v = localStorage.getItem(POST_LOGIN_HASH_KEY);
    if(v) localStorage.removeItem(POST_LOGIN_HASH_KEY);
    return v || "";
  }catch(_e){ return ""; }
}


// Debounced router (prevents tab-focus + click races that can make the UI look "stuck" until refresh)

let _routeTimer = null;
let _routeInFlight = false;
let _routeQueued = false;

async function safeRoute(){
  if(_routeInFlight){ _routeQueued = true; return; }
  _routeInFlight = true;

  const startedAt = Date.now();
  try{
    // If a tab switch suspends async work, route() can effectively "hang".
    // We allow a retry by timing out and releasing the lock.
    await Promise.race([
      route(),
      sleep(4000).then(()=>{ throw new Error('route_timeout'); })
    ]);
  }catch(e){
    console.error('route failed', e);
    try{
      const msg = (String(e?.message||'').includes('route_timeout'))
        ? 'Waking the UI…'
        : 'Recovering view…';
      toast(msg);
    }catch(_e){}
  }finally{
    _routeInFlight = false;

    // If we timed out, we still want to attempt a fresh route once.
    const elapsed = Date.now() - startedAt;
    if(elapsed >= 3900){
      // tiny delay gives the browser a breath after tab restore
      setTimeout(()=>{ if(!_routeInFlight) scheduleRoute(0); }, 120);
    }

    if(_routeQueued){
      _routeQueued = false;
      Promise.resolve().then(()=>safeRoute());
    }
  }
}

function scheduleRoute(delay=0){
  try{ if(_routeTimer) clearTimeout(_routeTimer); }catch(_e){}
  _routeTimer = setTimeout(()=>{ safeRoute(); }, delay);
}
/* ----------------------------- config / supabase ----------------------------- */
function cfg(){
  const c = window.CREATORBOOK_CONFIG || {};
  return {
    url: c.supabaseUrl || "",
    anon: c.supabaseAnonKey || "",
  };
}
function sbReady(){
  const c = cfg();
  return !!(c.url && c.anon && window.supabase);
}
function initSupabase(){
  if(APP.sb) return true;
  if(!sbReady()) return false;
  const c = cfg();
  APP.sb = window.supabase.createClient(c.url, c.anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    }
  });
  return true;
}
async function refreshSession(){
  if(!APP.sb) return;
  try{
    const { data } = await APP.sb.auth.getSession();
    APP.session = data?.session || null;
    APP.user = APP.session?.user || null;
  }catch(e){
    console.warn('refreshSession failed', e);
    // Keep existing session/user; we'll recover on next successful auth refresh.
  }
}

/* ----------------------------- UI helpers ----------------------------- */
function showPage(pageId){
  $$(".page").forEach(p=>p.style.display = "none");
  const el = byId(pageId);
  if(el){ el.style.display = "block"; el.classList.add("show"); }
}
function setNavActive(hash){
  $$('nav.nav a[data-nav]').forEach(a=>{
    const active = (a.getAttribute('data-nav') === hash);
    a.classList.toggle('active', active);
  });
}
function openModal(id){ const m = byId(id); if(m) m.style.display = "grid"; }
function closeModal(id){ const m = byId(id); if(m) m.style.display = "none"; }

function _displayFor(el){
  if(!el) return "";
  const tag = (el.tagName || "").toLowerCase();
  if(tag === "a" || tag === "button" || tag === "span") return "inline-flex";
  return "block";
}

function setAuthedUI(){
  const authed = !!APP.user;
  document.body.classList.toggle('isAuthed', authed);

  // authed-only bits
  $$(".authed").forEach(el=>{
    if(el.classList.contains("page")){
      if(!authed) el.style.display = "none";
      return;
    }
    el.style.display = authed ? _displayFor(el) : "none";
  });

  // top sign-in button
  const btnSignIn = byId("btnSignIn");
  if(btnSignIn) btnSignIn.style.display = authed ? "none" : _displayFor(btnSignIn);

  

// nav links: always schedule a route after clicking (Chrome tab switching can suppress hashchange)
try{
  $$('nav.nav a[data-nav]').forEach(a=>{
    if(a._bound) return;
    a._bound = true;
    a.addEventListener('click', (e)=>{
      e.preventDefault();
      const href = a.getAttribute('href') || '#home';
      const want = href.startsWith('#') ? href : ('#' + href);
      if(location.hash !== want) location.hash = want;
      // Always render, even if hashchange doesn't fire.
      Promise.resolve().then(()=>safeRoute());
    });
  });
}catch(_e){}

// profile menu wrap
  const pmw = byId("profileMenuWrap");
  if(pmw) pmw.style.display = authed ? _displayFor(pmw) : "none";

  // credits pill / top
  const ctop = byId("btnCreditsTop");
  if(ctop) ctop.style.display = authed ? _displayFor(ctop) : "none";

  // update credits text if present
  const bal = moneyCredits(APP.wallet?.balance || 0);
  const topBal = byId("creditsBalTop");
  if(topBal && authed) topBal.textContent = bal;
}

/* ----------------------------- profile + wallet ----------------------------- */
async function ensureProfile(){
  if(!APP.sb || !APP.user) return;

  // profile
  let prof = null;
  try{
    const r0 = await APP.sb.from('profiles').select('*').eq('id', APP.user.id).maybeSingle();
    prof = r0?.data || null;
  }catch(_e){}

  if(!prof){
    const ins = {
      id: APP.user.id,
      // keep role for backwards compatibility, but we do not gate UX on it
      role: 'member',
      onboarded: true,
      approved: false,
      display_name: APP.user.email?.split("@")[0] || "User",
      city: "Los Angeles",
      bio: "",
      portfolio_url: "",
      resume_url: "",
      phone: "",
    };
    try{
      const r1 = await APP.sb.from('profiles').insert(ins).select('*').single();
      prof = r1?.data || ins;
    }catch(_e){
      prof = ins;
    }
  }else{
    // silently mark onboarded so UI never blocks
    if(!prof.onboarded){
      try{
        const r2 = await APP.sb.from('profiles').update({ onboarded:true }).eq('id', APP.user.id).select('*').single();
        prof = r2?.data || prof;
      }catch(_e){}
    }
  }
  APP.me = prof;

  // wallet
  let wal = null;
  try{
    const w0 = await APP.sb.from('credits_wallet').select('*').eq('user_id', APP.user.id).maybeSingle();
    wal = w0?.data || null;
  }catch(_e){}

  if(!wal){
    try{
      const w1 = await APP.sb.from('credits_wallet').insert({ user_id: APP.user.id, balance: 0 }).select('*').single();
      wal = w1?.data || { user_id: APP.user.id, balance: 0 };
    }catch(_e){
      wal = { user_id: APP.user.id, balance: 0 };
    }
  }
  APP.wallet = wal;
}

async function refreshWallet(){
  if(!APP.sb || !APP.user) return;
  const { data } = await APP.sb.from('credits_wallet').select('*').eq('user_id', APP.user.id).maybeSingle();
  if(data) APP.wallet = data;
  setAuthedUI();
  const bal = moneyCredits(APP.wallet?.balance || 0);
  if(byId('profileCredits')) byId('profileCredits').textContent = bal;
}

/* ----------------------------- auth ----------------------------- */
function setBtnBusy(id, busy, label){
  const b = byId(id);
  if(!b) return;
  b.disabled = !!busy;
  if(label) b.textContent = label;
}
function normalizeAuthError(err){
  const msg = err?.message || "Authentication error";
  const low = msg.toLowerCase();
  if(low.includes('rate limit')) return "Email rate limit exceeded. Wait ~2 minutes, then try again.";
  if(low.includes('invalid login')) return "Wrong email or password.";
  return msg;
}
function setAuthMode(mode){
  APP.authMode = (mode === "signup") ? "signup" : "login";
  const bL = byId("authModeLogin");
  const bS = byId("authModeSignup");
  if(bL){
    bL.classList.toggle("active", APP.authMode==="login");
    bL.setAttribute("aria-selected", APP.authMode==="login" ? "true" : "false");
  }
  if(bS){
    bS.classList.toggle("active", APP.authMode==="signup");
    bS.setAttribute("aria-selected", APP.authMode==="signup" ? "true" : "false");
  }

  const loginBtn = byId("authLogin");
  const signupBtn = byId("authSignup");
  if(loginBtn && signupBtn){
    if(APP.authMode==="login"){
      loginBtn.className = "btn";
      signupBtn.className = "btn ghost";
      byId("authPass")?.setAttribute("autocomplete","current-password");
    }else{
      signupBtn.className = "btn";
      loginBtn.className = "btn ghost";
      byId("authPass")?.setAttribute("autocomplete","new-password");
    }
  }

  const pw2 = byId('authPass2Wrap');
  if(pw2) pw2.style.display = (APP.authMode==="signup") ? "" : "none";

  const hint = byId("authHint");
  if(hint){
    hint.textContent = (APP.authMode==="signup")
      ? "Create your account with email + password."
      : "Sign in with your email + password (Google optional).";
  }

  const goS = byId('authGoSignup');
  const goL = byId('authGoLogin');
  if(goS) goS.style.display = (APP.authMode==='login') ? '' : 'none';
  if(goL) goL.style.display = (APP.authMode==='signup') ? '' : 'none';
}

async function signInWithGoogle(){
  if(!APP.sb) return toast("Supabase not configured");
  const redirectTo = authRedirectTo();
  const { error } = await APP.sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo }
  });
  if(error) toast(normalizeAuthError(error));
}

async function signInWithPassword(){
  if(!APP.sb) return toast("Supabase not configured");
  const email = (byId("authEmail")?.value || "").trim();
  const password = (byId("authPass")?.value || "");
  if(!email || !email.includes("@")) return toast("Enter your email");
  if(password.length < 6) return toast("Password must be at least 6 characters");

  setBtnBusy('authLogin', true, 'Signing in…');
  try{
    const res = await APP.sb.auth.signInWithPassword({ email, password });
    if(res?.error) return toast(normalizeAuthError(res.error));
  }catch(e){
    console.error(e);
    toast(normalizeAuthError(e));
  }finally{
    setBtnBusy('authLogin', false, 'Sign in');
  }
}

async function signUpWithPassword(){
  if(!APP.sb) return toast("Supabase not configured");
  const email = (byId("authEmail")?.value || "").trim();
  const password = (byId("authPass")?.value || "");
  const password2 = (byId("authPass2")?.value || "");
  if(!email || !email.includes("@")) return toast("Enter a valid email");
  if(password.length < 6) return toast("Password must be at least 6 characters");
  if(password !== password2) return toast("Passwords do not match");

  const redirectTo = authRedirectTo();
  setBtnBusy('authSignup', true, 'Creating…');
  try{
    const { data, error } = await APP.sb.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo }
    });
    if(error) return toast(normalizeAuthError(error));

    // If no session returned, likely email confirm required.
    if(!data?.session){
      toast("Account created. Check your email to confirm, then sign in.");
      return;
    }
    toast("Account created. You’re signed in.");
  }catch(e){
    console.error(e);
    toast(normalizeAuthError(e));
  }finally{
    setBtnBusy('authSignup', false, 'Create account');
  }
}

async function forgotPassword(){
  if(!APP.sb) return toast("Supabase not configured");
  const email = (byId("authEmail")?.value || "").trim();
  if(!email || !email.includes("@")) return toast("Enter your email.");
  const redirectTo = authRedirectTo();
  setBtnBusy('authForgot', true, 'Sending…');
  try{
    const { error } = await APP.sb.auth.resetPasswordForEmail(email, { redirectTo });
    if(error) return toast(normalizeAuthError(error));
    toast("Password reset email sent.");
  }catch(e){
    console.error(e);
    toast(normalizeAuthError(e));
  }finally{
    setBtnBusy('authForgot', false, 'Forgot password');
  }
}

async function signOut(){
  if(!APP.sb) return;
  APP._booting = true;

  // close menus/modals quickly
  const pm = byId('profileMenu'); if(pm) pm.style.display = 'none';
  try{ closeModal('authModal'); }catch(_e){}
  try{ closeModal('creditsModal'); }catch(_e){}

  // optimistic UI
  APP.session = null; APP.user = null; APP.me = null; APP.wallet = null;
  setAuthedUI();

  try{ await APP.sb.auth.signOut(); }catch(e){ console.warn(e); }

  clearAuthArtifacts("home");
  location.hash = "#home";

  APP._booting = false;
  await safeRoute();
  toast("Signed out");
}

/* ----------------------------- credits modal ----------------------------- */
async function addDemoCredits(amount){
  if(!APP.sb || !APP.user) return toast('Sign in first');
  const add = Number(amount||0);
  if(!add || add <= 0) return toast('Enter an amount');
  const cur = Number(APP.wallet?.balance || 0);
  const next = cur + add;
  const r = await APP.sb.from('credits_wallet').update({ balance: next, updated_at: new Date().toISOString() }).eq('user_id', APP.user.id);
  if(r.error) return toast(r.error.message);
  try{ await APP.sb.from('credits_tx').insert({ user_id: APP.user.id, kind:'demo_topup', amount: add, note:'demo' }); }catch(_e){}
  await refreshWallet();
  toast('Credits added');
}
function openCredits(){
  const modal = byId('creditsModal');
  const sheet = modal?.querySelector('.sheet');
  if(!modal || !sheet) return;
  sheet.innerHTML = `
    <div class="modalTitle">Credits</div>
    <div class="muted" style="margin-bottom:10px;">Demo top-up for now. Later: Stripe.</div>
    <div class="row">
      <input id="demoCreditsModal" type="number" min="0" step="1" placeholder="500" />
      <button class="btn" id="btnAddDemoCreditsModal" type="button">Add</button>
    </div>
    <div class="muted" style="margin-top:10px;">Balance: <b><span id="walletBalModal">${moneyCredits(APP.wallet?.balance||0)}</span></b> credits</div>
    <div class="row" style="margin-top:12px; justify-content:flex-end;">
      <button class="btn ghost" id="btnCloseCredits" type="button">Close</button>
    </div>
  `;
  openModal('creditsModal');
  on('btnCloseCredits','click',()=>closeModal('creditsModal'));
  on('btnAddDemoCreditsModal','click', async ()=>{
    const amt = Number(byId('demoCreditsModal')?.value || 0);
    await addDemoCredits(amt);
    if(byId('walletBalModal')) byId('walletBalModal').textContent = moneyCredits(APP.wallet?.balance||0);
  });
}

/* ----------------------------- data: home feed ----------------------------- */
async function fetchPackagesFeed(){
  if(!APP.sb) return { groups:[], profiles:{} };

  const service = byId("homeService")?.value || "any";
  const tier = byId("homeTier")?.value || "any";

  let q = APP.sb.from('packages').select('*').eq('active', true);
  if(service !== "any") q = q.eq('service', service);
  if(tier !== "any") q = q.eq('tier', tier);

  const { data, error } = await q.order('created_at', { ascending:false }).limit(200);
  if(error){ console.warn(error); return { groups:[], profiles:{} }; }

  const rows = data || [];
  const creatorIds = Array.from(new Set(rows.map(r=>r.creator_id).filter(Boolean)));

  const profiles = {};
  if(creatorIds.length){
    const { data: profs, error: pe } = await APP.sb.from('profiles').select('id,display_name,city,avatar_url').in('id', creatorIds).limit(500);
    if(!pe) (profs||[]).forEach(p=>profiles[p.id]=p);
  }

  const map = new Map();
  for(const r of rows){
    const k = String(r.creator_id||'') + '||' + String(r.service||'') + '||' + String(r.title||'');
    if(!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }

  const tierOrder = ['bronze','silver','gold','elite'];
  const groups = Array.from(map.values()).map(items=>{
    items.sort((a,b)=> tierOrder.indexOf(String(a.tier||'').toLowerCase()) - tierOrder.indexOf(String(b.tier||'').toLowerCase()));
    return { items };
  });

  return { groups, profiles };
}

async function renderPost(){
  showPage("pagePost");
  setNavActive("home");

  // Home = Community only (keep it clean, keep it alive)
  await renderPublicPosts();

  // Home CTAs
  if(!APP._bindHomeCtas){
    APP._bindHomeCtas = true;
    const cCreate = byId('homeCtaCreatePkg');
    const cBook = byId('homeCtaBook');
    if(cCreate) cCreate.addEventListener('click', ()=>{
      if(APP.user) location.hash = '#create';
      else { setPostLoginHash('#create'); openModal('authModal'); setAuthMode('login'); }
    });
    if(cBook) cBook.addEventListener('click', ()=>{ location.hash = '#book'; });
    const bn = byId('homeBookNow');
    if(bn) bn.addEventListener('click', ()=>{ location.hash = '#book'; });

    // Home feed mode
    APP.feedMode = APP.feedMode || 'all';
    const allBtn = byId('feedModeAll');
    const frBtn = byId('feedModeFollowing');
    const setMode = async (m)=>{
      APP.feedMode = m;
      if(allBtn) allBtn.classList.toggle('active', m==='all');
      if(frBtn) frBtn.classList.toggle('active', m==='following');
      await renderPublicPosts();
    };
    if(allBtn) allBtn.addEventListener('click', ()=>setMode('all'));
    if(frBtn) frBtn.addEventListener('click', ()=>setMode('following'));
    if(allBtn && frBtn) setMode(APP.feedMode);
    
  }
}




const BOOK_MENU = {"Music & Audio": ["Custom Beat", "Feature Verse", "Vocal Recording", "Songwriting", "Lyrics", "Instrument Recording", "Mixing", "Mastering", "Podcast Editing", "Sound Design", "Jingle Creation", "Voiceover", "Vocal Tuning", "Remix"], "Video & Photo": ["Music Video Shoot", "Video Shoot", "Photography", "Headshots", "Product Shoot", "Event Coverage", "Drone Footage", "Reels/TikTok Shoot", "BTS Content"], "Design & Visual Art": ["Album Cover", "Logo Design", "Graphic Design", "Custom Illustration", "Portrait Artwork", "Tattoo Design", "Merch Design", "Website Design", "UI Design"], "Writing & Creative": ["Script Writing", "Personalized Letter", "Poem", "Speech Writing", "Story Writing", "Character Writing", "Caption Writing", "Ad Copy", "Ghostwriting"], "Performance & Talent": ["Actor", "Model", "Dancer", "Musician", "Voice Actor", "Host", "Performer Appearance"], "Events & Experiences": ["Private Chef", "Catering", "DJ", "Live Band", "Photographer for Event", "Videographer for Event", "Party Host", "Workshop Teacher"], "Editing & Post": ["Video Editing", "Color Grading", "VFX", "Motion Graphics", "Audio Editing", "Photo Retouching", "Subtitle Creation"], "Custom Request": ["Custom Request"]};

async function renderBook(){
  showPage("pageBook");
  setNavActive("book");

  APP.book = APP.book || { cat:"", svc:"", custom:"" };

  const s1 = byId('bookScreen1');
  const s2 = byId('bookScreen2');

  const setScreen = (n)=>{
    if(s1) s1.style.display = (n===1) ? '' : 'none';
    if(s2) s2.style.display = (n===2) ? '' : 'none';
  };

  const setBudgetUI = ()=>{
    const r = byId('bookBudget');
    const n = byId('bookBudgetInput');
    const lab = byId('bookBudgetLabel');
    const v = Number((n && n.value) || (r && r.value) || 0);
    if(r && String(r.value)!==String(v)) r.value = String(v);
    if(n && String(n.value)!==String(v)) n.value = String(v);
    if(lab) lab.textContent = String(v) + ' credits';
  };

  const breadcrumb = ()=>{
    const b = byId('bookBreadcrumb');
    if(b) b.textContent = APP.book.cat ? APP.book.cat : 'Category';
    const hint = byId('bookHint');
    if(hint) hint.textContent = APP.book.cat ? 'Choose a service below.' : 'Pick a category.';
  };

  const renderServices = ()=>{
    const grid = byId('bookSvcGrid');
    const customWrap = byId('bookCustomWrap');
    if(!grid) return;
    grid.innerHTML = '';
    const cat = APP.book.cat;

    if(cat === 'Custom Request'){
      if(customWrap) customWrap.style.display = '';
      return;
    }
    if(customWrap) customWrap.style.display = 'none';

    let list = (BOOK_MENU[cat] || []).filter(x=>x!=='Custom Request');
    if(!list.includes('Other')) list = list.concat(['Other']);
    grid.innerHTML = list.map(s=>`<button class="svcBtn ${APP.book.svc===s?'active':''}" data-svc="${esc(s)}" type="button">${esc(s)}</button>`).join('');

    $$('button[data-svc]', grid).forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        APP.book.svc = btn.getAttribute('data-svc') || '';
        $$('button[data-svc]', grid).forEach(b=>b.classList.toggle('active', b===btn));
        await renderBookFeed();
      });
    });
  };

  if(!APP._bindBookFlow){
    APP._bindBookFlow = true;

    const catGrid = byId('bookCatGrid');
    if(catGrid){
      $$('button[data-cat]', catGrid).forEach(btn=>{
        btn.addEventListener('click', ()=>{
          APP.book.cat = btn.getAttribute('data-cat') || '';
          APP.book.svc = '';
          APP.book.custom = '';
          breadcrumb();
          renderServices();
          setScreen(2);

          const meta = byId('bookResultMeta');
          if(meta) meta.textContent = 'Pick a service to see matches';
          const feed = byId('bookFeed'); if(feed) feed.innerHTML='';
          const empty = byId('bookFeedEmpty'); if(empty) empty.style.display='none';
        });
      });
    }

    const back = byId('bookBack');
    if(back) back.addEventListener('click', ()=>setScreen(1));

    const r = byId('bookBudget');
    const n = byId('bookBudgetInput');
    if(r) r.addEventListener('input', ()=>{ if(n) n.value = r.value; setBudgetUI(); });
    if(n) n.addEventListener('input', ()=>{ if(r) r.value = n.value; setBudgetUI(); });
    if(n) n.addEventListener('change', ()=>setBudgetUI());

    const rec = byId('btnRecommend');
    if(rec) rec.addEventListener('click', async ()=>{ await renderBookFeed({ recommend:true }); });

    const go = byId('bookCustomGo');
    if(go) go.addEventListener('click', async ()=>{
      const t = byId('bookCustomText');
      APP.book.custom = (t?.value||'').trim();
      APP.book.svc = 'Custom Request';
      await renderBookFeed({ recommend:true });
    });

    const sort = byId('bookSort');
    if(sort) sort.addEventListener('change', async ()=>{ await renderBookFeed(); });
  }

  breadcrumb();
  setBudgetUI();

  if(APP.book.cat){
    setScreen(2);
    renderServices();
  }else{
    setScreen(1);
  }
}

async function renderBookFeed(opts={}){
  const feedEl = byId("bookFeed");
  const emptyEl = byId("bookFeedEmpty");
  const metaEl = byId("bookResultMeta");
  if(!feedEl) return;

  const budget = Number(byId('bookBudgetInput')?.value || byId('bookBudget')?.value || 0);
  const sort = (byId('bookSort')?.value || 'best');
  const serviceNeed = (APP.book.svc || '').trim();

  if(!serviceNeed){
    feedEl.innerHTML = '';
    if(emptyEl) emptyEl.style.display = 'none';
    if(metaEl) metaEl.textContent = 'Pick a service to see matches';
    return;
  }

  feedEl.innerHTML = '<div class="muted">Loading…</div>';

  const { groups, profiles } = await fetchPackagesFeed();
  const all = groups.flatMap(g=>g.items);

  const needLower = serviceNeed.toLowerCase();
  let filtered = all.filter(p=>{
    const s = String(p.service||'').toLowerCase();
    const t = String(p.title||'').toLowerCase();
    return s.includes(needLower) || t.includes(needLower);
  });
  if(serviceNeed === 'Custom Request'){
    filtered = all.slice();
  }

  const byGroup = new Map();
  for(const p of filtered){
    const k = String(p.creator_id) + '|' + String(p.title||'') + '|' + String(p.service||'');
    if(!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(p);
  }

  const picks = [];
  for(const [k, items] of byGroup.entries()){
    const within = items.filter(x=>Number(x.price_credits||0) <= budget);
    let candidates = within.length ? within : items.filter(x=>Number(x.price_credits||0) <= Math.ceil(budget*1.15));
    if(!candidates.length) continue;

    candidates.sort((a,b)=>Number(b.price_credits||0)-Number(a.price_credits||0));
    const chosen = candidates[0];

    const prof = profiles[chosen.creator_id] || {};
    const name = prof.display_name || 'User';
    const city = prof.city || 'Los Angeles';

    const price = Number(chosen.price_credits||0);
    const closeness = budget ? (1 - Math.min(1, Math.abs(budget - price)/Math.max(1,budget))) : 0;
    const score = closeness;

    picks.push({ chosen, name, city, score });
  }

  if(sort === 'low') picks.sort((a,b)=>Number(a.chosen.price_credits||0)-Number(b.chosen.price_credits||0));
  else if(sort === 'high') picks.sort((a,b)=>Number(b.chosen.price_credits||0)-Number(a.chosen.price_credits||0));
  else if(sort === 'new') picks.sort((a,b)=>String(b.chosen.created_at||'').localeCompare(String(a.chosen.created_at||'')));
  else picks.sort((a,b)=>(b.score-a.score) || (Number(b.chosen.price_credits||0)-Number(a.chosen.price_credits||0)));

  if(metaEl){
    metaEl.textContent = `Showing ${picks.length} matches · ${serviceNeed} · budget ${budget} credits`;
  }

  if(!picks.length){
    feedEl.innerHTML = '';
    if(emptyEl) emptyEl.style.display='block';
    return;
  }
  if(emptyEl) emptyEl.style.display='none';

  feedEl.innerHTML = picks.map(p=>{
    const x = p.chosen;
    return `
      <div class="card">
        <div class="row" style="justify-content:space-between; align-items:flex-start;">
          <div>
            <div class="cardTitle">${esc(x.title||'Package')}</div>
            <div class="muted">${esc(x.service||serviceNeed)} · Sold by <b>${esc(p.name)}</b> · ${esc(p.city)}</div>
          </div>
          <div style="text-align:right;">
            <div class="cardTitle" style="margin:0;">${moneyCredits(x.price_credits||0)}</div>
            <div class="muted">credits</div>
            ${
              APP.user
              ? `<button class="btn" data-bookpkg="${esc(x.id)}" style="margin-top:8px;" type="button">Book</button>`
              : `<div class="muted" style="margin-top:8px;">Sign in to book</div>`
            }
          </div>
        </div>
        ${x.includes ? `<div style="margin-top:10px; white-space:pre-wrap">${esc(x.includes)}</div>` : ``}
        ${x.addons ? `<div class="muted" style="margin-top:8px; white-space:pre-wrap">Add-ons: ${esc(x.addons)}</div>` : ``}
      </div>
    `;
  }).join('');

  $$('button[data-bookpkg]', feedEl).forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const pkgId = btn.getAttribute('data-bookpkg');
      const pick = picks.map(p=>p.chosen).find(x=>String(x.id)===String(pkgId));
      if(!pick) return;
      const { profiles } = await fetchPackagesFeed(); // cheap cache hit in supabase? ok for now
      const prof = profiles[pick.creator_id] || {};
      openBookModal(pick, prof.display_name || 'User');
    });
  });
}

/* ----------------------------- posts (public + my posts) ----------------------------- */
async function fetchPublicPosts(){
  if(!APP.sb) return [];
  try{
    let q = APP.sb.from('posts_public').select('*');
    // Following feed = people you follow
    if(APP.feedMode === 'following' && APP.user){
      const ids = await getFollowingIds();
      if(ids.length) q = q.in('user_id', ids);
      else return [];
    }
    const { data, error } = await q.order('created_at', { ascending:false }).limit(50);
    if(error){ console.warn('posts_public failed', error); return []; }
    return data || [];
  }catch(e){
    console.warn(e);
    return [];
  }
}

function openBookModal(pkg, sellerName){
  if(!pkg) return;
  APP._bookPkg = pkg;

  if(byId('bookPkgTitle')) byId('bookPkgTitle').textContent = pkg.title || 'Package';
  if(byId('bookPkgMeta')) byId('bookPkgMeta').textContent = `${sellerName || 'User'} · ${pkg.service || ''} · ${pkg.price_credits || 0} credits`;
  if(byId('bookCredits')) byId('bookCredits').value = String(pkg.price_credits || 0);
  if(byId('bookNotes')) byId('bookNotes').value = '';
  if(byId('bookReqDate')) byId('bookReqDate').value = '';

  openModal('bookModal');

  if(!APP._bindBookModal){
    APP._bindBookModal = true;
    on('btnCloseBook','click', ()=>closeModal('bookModal'));
    on('btnSendBook','click', ()=>sendBookingFromModal());
  }
}

async function sendBookingFromModal(){
  if(!APP.sb || !APP.user) return toast('Sign in first');
  const pkg = APP._bookPkg;
  if(!pkg) return toast('Pick a package');

  const reqDate = byId('bookReqDate')?.value || '';
  const notes = (byId('bookNotes')?.value || '').trim();
  const requested_date = reqDate ? new Date(reqDate).toISOString() : null;

  const total_credits = Number(byId('bookCredits')?.value || pkg.price_credits || 0);

  const bRes = await APP.sb.from('bookings').insert({
    client_id: APP.user.id,
    status: 'requested',
    requested_date,
    notes,
    total_credits,
    funded: false,
  }).select('*').single();
  if(bRes.error) return toast(bRes.error.message);
  const booking = bRes.data;

  const lRes = await APP.sb.from('booking_creators').insert({
    booking_id: booking.id,
    creator_id: pkg.creator_id,
    package_id: pkg.id,
    price_credits: total_credits,
  });
  if(lRes.error) return toast(lRes.error.message);

  closeModal('bookModal');
  toast('Request sent. Check My Projects.');
  location.hash = '#projects';
  await safeRoute();
}



async function openUserProfile(userId){
  if(!APP.sb || !userId) return;
  openModal('userProfileModal');
  APP._viewUserId = userId;

  on('btnCloseUserProfile','click', ()=>closeModal('userProfileModal'));
  on('btnViewFollowers','click', async ()=>{ await openFollowModal('followers'); });
  on('btnViewFollowing','click', async ()=>{ await openFollowModal('following'); });

  const header = byId('userProfileHeader');
  const pkgOut = byId('userProfilePackage');
  if(header) header.innerHTML = '<div class="muted">Loading…</div>';
  if(pkgOut) pkgOut.textContent = 'Loading…';

  const pr = await APP.sb.from('profiles').select('id,display_name,city,avatar_url,bio,role_primary,role_secondary,portfolio_url').eq('id', userId).maybeSingle();
  if(pr.error){ console.warn(pr.error); if(header) header.innerHTML='<div class="muted">Could not load profile (likely RLS). See SQL patch.</div>'; return; }
  if(!pr.data){ if(header) header.innerHTML='<div class="muted">Profile not visible (RLS). See SQL patch.</div>'; return; }
  const p = pr.data;

  const roleText = [p.role_primary, p.role_secondary].filter(Boolean).join(' / ');
  const av = (p.avatar_url||'').trim();
  if(header){
    header.innerHTML = `
      <div class="row" style="gap:12px; align-items:center;">
        <div class="miniAvatar" style="width:56px; height:56px; overflow:hidden;">
          ${av ? `<img src="${esc(av)}" style="width:100%; height:100%; object-fit:cover;" />` : esc((p.display_name||'U').slice(0,1).toUpperCase())}
        </div>
        <div style="flex:1;">
          <div style="font-weight:900; font-size:18px;">${esc(p.display_name||'User')}</div>
          <div class="muted tiny">${esc(roleText || 'Creator')} · ${esc(p.city||'Los Angeles')}</div>
        </div>
      </div>
      ${p.bio ? `<div style="margin-top:10px; white-space:pre-wrap">${esc(p.bio)}</div>` : ''}
      ${p.portfolio_url ? `<div class="muted tiny" style="margin-top:8px;">Portfolio: ${esc(p.portfolio_url)}</div>` : ''}
    `;
  }

  // Package
  try{
    const pk = await APP.sb.from('packages').select('*').eq('creator_id', userId).eq('tier','single').eq('active', true).limit(1);
    const row = pk.data && pk.data[0] ? pk.data[0] : null;
    if(!row){
      if(pkgOut) pkgOut.innerHTML = '<div class="muted">No package uploaded yet.</div>';
    }else{
      const media = embedMedia(extractFirstMedia(row.addons || ''));
      const title = row.title || '';
      const price = moneyCredits(row.price_credits||0);
      const days = (row.delivery_days!=null) ? `${row.delivery_days} days` : '—';
      const includes = row.includes || '';
      const addons = row.addons || '';
      if(pkgOut){
        pkgOut.innerHTML = `
          <div style="font-weight:900;">${esc(title)}</div>
          <div class="muted tiny" style="margin-top:6px;">${esc(price)} credits · Delivery: ${esc(days)}</div>
          ${includes ? `<div class="muted tiny" style="margin-top:8px; white-space:pre-wrap">${esc(includes)}</div>` : ''}
          ${addons ? `<div style="margin-top:10px; white-space:pre-wrap">${esc(addons)}</div>` : ''}
          ${media ? `<div style="margin-top:10px;">${media}</div>` : ''}
        `;
      }
    }
  }catch(e){
    console.warn(e);
    if(pkgOut) pkgOut.textContent = 'Could not load package.';
  }

  // Follow button
  const btn = byId('btnFollowToggle');
  if(btn && !btn._bound){
    btn._bound = true;
    btn.addEventListener('click', async ()=>{
      await toggleFollow(userId);
      await refreshFollowButton(userId);
  try{ const c2 = await renderFollowCounts(userId); if(byId('userFollowersCount')) byId('userFollowersCount').textContent=c2.followers; if(byId('userFollowingCount')) byId('userFollowingCount').textContent=c2.following; }catch(e){}
    });
  }
  await refreshFollowButton(userId);
  try{ const c2 = await renderFollowCounts(userId); if(byId('userFollowersCount')) byId('userFollowersCount').textContent=c2.followers; if(byId('userFollowingCount')) byId('userFollowingCount').textContent=c2.following; }catch(e){}
}

function extractFirstMedia(text){
  // best-effort: find first http link that is image/video
  const m = String(text||'').match(/https?:\/\/[^\s]+/g);
  if(!m) return '';
  return m.find(u=>/\.(png|jpg|jpeg|webp|gif|mp4|mov|webm)(\?|$)/i.test(u)) || '';
}

async function refreshFollowButton(userId){
  const btn = byId('btnFollowToggle');
  if(!btn) return;
  if(!APP.user){ btn.textContent='Follow'; btn.disabled=true; return; }
  btn.disabled = (APP.user.id === userId);
  if(APP.user.id === userId){ btn.textContent='You'; return; }
  try{
    const r = await APP.sb.from('follows').select('following_id').eq('follower_id', APP.user.id).eq('following_id', userId).maybeSingle();
    const isFollowing = !!r.data;
    btn.textContent = isFollowing ? 'Following' : 'Follow';
    btn.classList.toggle('ghost', isFollowing);
  }catch(e){
    btn.textContent='Follow';
  }
}

async function toggleFollow(userId){
  if(!APP.sb || !APP.user) return toast('Sign in first');
  if(APP.user.id === userId) return;
  try{
    const r = await APP.sb.from('follows').select('following_id').eq('follower_id', APP.user.id).eq('following_id', userId).maybeSingle();
    if(r.data){
      const d = await APP.sb.from('follows').delete().eq('follower_id', APP.user.id).eq('following_id', userId);
      if(d.error) throw d.error;
      toast('Unfollowed');
      await updateMyFollowCounts();
    }else{
      const i = await APP.sb.from('follows').insert({ follower_id: APP.user.id, following_id: userId });
      if(i.error) throw i.error;
      toast('Followed');
      await updateMyFollowCounts();
    }
  }catch(e){
    console.warn(e);
    toast('Follow needs follows table + RLS policy.');
  }
}

async function renderPublicPosts(){
  const out = byId('publicPosts');
  const empty = byId('publicPostsEmpty');
  if(!out) return;
  out.innerHTML = '<div class="muted">Loading…</div>';
  const rows = await fetchPublicPosts();
  if(!rows.length){
    out.innerHTML='';
    if(empty) empty.style.display='block';
    return;
  }
  if(empty) empty.style.display='none';
  out.innerHTML = rows.map(p=>{
    const media = embedMedia(p.media_url || p.media || '');
    const likes = Number(p.like_count||0);
    const comments = Number(p.comment_count||0);
    return `
    <div class="card mini">
      <div class="row" style="gap:10px; align-items:center; margin-bottom:8px;">
        <button class="miniAvatar" data-profile="${esc(p.user_id)}" type="button" title="View profile">${esc((p.display_name||'U').slice(0,1).toUpperCase())}</button>
        <div style="flex:1;">
          <button class="linkish" data-profile="${esc(p.user_id)}" type="button" style="font-weight:800; line-height:1.1; background:transparent; border:0; padding:0; color:#fff; text-align:left; cursor:pointer;">${esc(p.display_name||'User')}</button>
          <div class="muted tiny">${esc(p.city||'Los Angeles')} · ${fmtDateTime(p.created_at)}</div>
        </div>
        <button class="btn ghost" data-like="${esc(p.id)}" type="button" title="Like">♥</button>
      </div>
      ${p.title ? `<div style="font-weight:800">${esc(p.title)}</div>` : ''}
      ${p.body ? `<div style="margin-top:8px; white-space:pre-wrap">${esc(p.body||'')}</div>` : ''}
      ${media ? `<div style="margin-top:10px;">${media}</div>` : ''}
      <div class="row" style="justify-content:space-between; margin-top:10px; align-items:center;">
        <div class="muted tiny">${likes} likes · ${comments} comments</div>
        <button class="btn ghost" data-cmt="${esc(p.id)}" type="button">Comment</button>
      </div>
      <div class="commentBox" id="cbox_${esc(p.id)}" style="display:none; margin-top:10px;">
        <textarea data-cmttext="${esc(p.id)}" placeholder="Write a comment…" style="min-height:70px;"></textarea>
        <div class="row" style="justify-content:flex-end; margin-top:8px;">
          <button class="btn" data-cmtsend="${esc(p.id)}" type="button">Send</button>
        </div>
      </div>
    </div>
    `;
  }).join('');
  
  $$('[data-profile]', out).forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const uid = btn.getAttribute('data-profile');
      await openUserProfile(uid);
    });
  });

// bind like/comment (graceful if tables not present)
  $$('button[data-like]', out).forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-like');
      await tryLikePost(id);
      await renderPublicPosts();
    });
  });
  $$('button[data-cmt]', out).forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-cmt');
      const box = byId('cbox_' + id);
      if(box) box.style.display = (box.style.display==='none' || !box.style.display) ? '' : 'none';
    });
  });
  $$('button[data-cmtsend]', out).forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-cmtsend');
      const ta = out.querySelector(`textarea[data-cmttext="${id}"]`);
      const txt = (ta?.value||'').trim();
      if(!txt) return;
      await tryCommentPost(id, txt);
      if(ta) ta.value='';
      await renderPublicPosts();
    });
  });
}


async function tryLikePost(postId){
  if(!APP.sb) return toast('Database not ready');
  if(!APP.user){
    setPostLoginHash('#home');
    openModal('authModal');
    setAuthMode('login');
    return;
  }
  const { error } = await APP.sb.from('post_likes').insert({ post_id: postId, user_id: APP.user.id });
  if(error){
    console.warn('like failed', error);
    toast('Likes need SQL (post_likes table).');
  }
}

async function tryCommentPost(postId, body){
  if(!APP.sb) return toast('Database not ready');
  if(!APP.user){
    setPostLoginHash('#home');
    openModal('authModal');
    setAuthMode('login');
    return;
  }
  const { error } = await APP.sb.from('post_comments').insert({ post_id: postId, user_id: APP.user.id, body });
  if(error){
    console.warn('comment failed', error);
    toast('Comments need SQL (post_comments table).');
  }
}

async function hasPostForBooking(bookingId){
  if(!APP.sb || !APP.user) return false;
  const { data, error } = await APP.sb.from('posts').select('id').eq('user_id', APP.user.id).eq('booking_id', bookingId).limit(1);
  if(error) return false;
  return !!(data && data.length);
}
async function fetchMyPosts(){
  if(!APP.sb || !APP.user) return [];
  const { data, error } = await APP.sb.from('posts').select('*').eq('user_id', APP.user.id).order('created_at', { ascending:false }).limit(50);
  if(error){ console.warn('posts failed', error); return []; }
  return data || [];
}
async function renderMyFeed(){
  const out = byId('myFeed');
  const empty = byId('myFeedEmpty');
  if(!out) return;
  out.innerHTML = '<div class="muted">Loading…</div>';
  const posts = await fetchMyPosts();
  if(!posts.length){ out.innerHTML=''; if(empty) empty.style.display='block'; return; }
  if(empty) empty.style.display='none';
  out.innerHTML = posts.map(p=>`
    <div class="card mini">
      ${p.title ? `<div class="cardTitle">${esc(p.title)}</div>` : ''}
      <div class="muted">${fmtDateTime(p.created_at)}</div>
      <div style="margin-top:8px; white-space:pre-wrap">${esc(p.body)}</div>
    </div>
  `).join('');
}

/* ----------------------------- creator profile (modal) ----------------------------- */
async function fetchCreatorPackages(creatorId){
  if(!APP.sb) return [];
  const { data, error } = await APP.sb.from('packages').select('*').eq('creator_id', creatorId).order('price_credits', { ascending:true });
  if(error){ console.warn(error); return []; }
  return data || [];
}
function youtubeEmbed(url){
  if(!url) return "";
  const u = String(url).trim();
  const m = u.match(/(?:youtu\.be\/|v=)([A-Za-z0-9_-]{6,})/);
  if(!m) return '';
  const vid = m[1];
  return `
    <div class="card" style="margin-top:12px;">
      <div class="cardTitle">Highlight</div>
      <div style="position:relative; padding-top:56.25%; border-radius:14px; overflow:hidden; border:1px solid rgba(255,255,255,.10);">
        <iframe
          src="https://www.youtube.com/embed/${esc(vid)}"
          style="position:absolute; inset:0; width:100%; height:100%; border:0;"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
          title="Highlight"
        ></iframe>
      </div>
    </div>
  `;
}

async function openCreatorProfile(creatorId){
  if(!APP.sb) return;
  const { data: prof, error } = await APP.sb.from('profiles').select('*').eq('id', creatorId).maybeSingle();
  if(error) return toast(error.message);
  if(!prof) return toast("Profile not found");

  const pkgs = await fetchCreatorPackages(creatorId);
  const modal = byId("creditsModal");
  const sheet = modal?.querySelector('.sheet');
  if(!modal || !sheet) return;

  sheet.innerHTML = `
    <div class="modalTitle">${esc(prof.display_name || 'Profile')}</div>
    <div class="muted">${esc(prof.city || 'Los Angeles')}</div>
    ${prof.bio ? `<div class="card" style="margin-top:12px;"><div class="cardTitle">About</div><div class="muted">${esc(prof.bio)}</div></div>` : ''}
    ${youtubeEmbed(prof.portfolio_url)}
    <div class="card" style="margin-top:12px;">
      <div class="cardTitle">Packages</div>
      ${pkgs.length ? pkgs.map(p=>`
        <div class="row" style="justify-content:space-between; align-items:flex-start; gap:12px; margin:10px 0;">
          <div>
            <div style="font-weight:700">${esc(p.title)}</div>
            <div class="muted">${esc(p.service)} · ${esc(p.tier)} ${p.delivery_days ? `· ${p.delivery_days} days` : ''}</div>
            ${p.includes ? `<div class="muted">${esc(p.includes)}</div>` : ''}
            ${p.addons ? `<div class="muted"><b>Add-ons:</b> ${esc(p.addons)}</div>` : ''}
          </div>
          <div style="text-align:right; min-width:120px;">
            <div class="pill big">${moneyCredits(p.price_credits)} credits</div>
            ${APP.user ? `<button class="btn" data-book="${esc(p.id)}" style="margin-top:8px; width:100%" type="button">Select</button>` : `<div class="muted" style="margin-top:8px;">Sign in to book</div>`}
          </div>
        </div>
        <div style="height:1px; background:rgba(255,255,255,.08)"></div>
      `).join('') : `<div class="muted">No packages yet.</div>`}
    </div>

    <div class="row" style="margin-top:12px; justify-content:flex-end;">
      <button class="btn ghost" id="btnCloseCreator" type="button">Close</button>
    </div>
  `;
  openModal('creditsModal');
  on('btnCloseCreator','click',()=>closeModal('creditsModal'));

  if(APP.user){
    $$('button[data-book]', sheet).forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const pkgId = btn.getAttribute('data-book');
        const pkg = pkgs.find(x=>String(x.id)===String(pkgId));
        if(!pkg) return;
        closeModal('creditsModal');
        location.hash = '#create';
        await safeRoute();
        // prefill create flow if fields exist
        if(byId('projService')) byId('projService').value = pkg.service;
        if(byId('projTier')) byId('projTier').value = pkg.tier;
        await findCreators();
        selectPackage(prof, pkg);
      });
    });
  }
}

/* ----------------------------- create project ----------------------------- */
async function renderCreatePackage(){
  showPage('pageCreatePackage');
  setNavActive('create');

  // Bind once
  if(!APP._bindCreatePkg){
    APP._bindCreatePkg = true;

    on('btnLoadMyPkgs','click', ()=>loadMyPackages());
    on('btnRefreshMyPkgs','click', ()=>loadMyPackages());
    on('btnClearPkgForm','click', ()=>clearPkgForm());
    on('btnSavePkg','click', ()=>savePkgTiers());
    // Click row to load
    const list = byId('myPackagesList');
    if(list){
      list.addEventListener('click', (e)=>{
        const row = e.target.closest('[data-load]');
        if(!row) return;
        const key = row.getAttribute('data-load');
        if(!key) return;
        const [service, title] = key.split('||');
        loadPkgIntoForm(service, title);
      });
    }
  }

  // default title
  if(byId('pkgTitle') && !byId('pkgTitle').value){
    byId('pkgTitle').value = '';
  }

  await loadMyPackages();
}

async function loadMyPackages(){
  if(!APP.sb || !APP.user) return;
  const listEl = byId('myPackagesList');
  const emptyEl = byId('myPackagesEmpty');
  if(listEl) listEl.innerHTML = `<div class="muted">Loading…</div>`;
  if(emptyEl) emptyEl.style.display = 'none';

  const { data, error } = await APP.sb
    .from('packages')
    .select('*')
    .eq('creator_id', APP.user.id)
    .order('service', { ascending:true })
    .order('tier', { ascending:true });

  if(error){
    console.warn(error);
    if(listEl) listEl.innerHTML = `<div class="muted">Could not load packages yet (table missing or RLS). We'll fix SQL when you're ready.</div>`;
    return;
  }

  APP._myPackagesRows = data || [];

  // Group by service + title
  const groups = new Map();
  for(const r of (APP._myPackagesRows||[])){
    const service = String(r.service||'other');
    const title = String(r.title||'Untitled');
    const k = service + '||' + title;
    if(!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  if(!groups.size){
    if(listEl) listEl.innerHTML = '';
    if(emptyEl) emptyEl.style.display = 'block';
    return;
  }

  const rowsHtml = Array.from(groups.entries()).map(([k, rows])=>{
    const service = rows[0]?.service || 'other';
    const title = rows[0]?.title || 'Untitled';
    const activeTiers = rows.filter(x=>x.active !== false).map(x=>String(x.tier||'').toUpperCase()).join(' · ') || '—';
    const minPrice = Math.min(...rows.filter(x=>x.active !== false).map(x=>Number(x.price_credits||0)).concat([0]));
    return `
      <div class="card mini" data-load="${esc(k)}" style="cursor:pointer;">
        <div class="row" style="justify-content:space-between; align-items:flex-start;">
          <div>
            <div class="cardTitle">${esc(title)}</div>
            <div class="muted">${esc(service)} · ${esc(activeTiers)}</div>
          </div>
          <div class="pill">${moneyCredits(minPrice)}+</div>
        </div>
      </div>
    `;
  }).join('');

  if(listEl) listEl.innerHTML = rowsHtml;
  if(emptyEl) emptyEl.style.display = 'none';
}

function clearPkgForm(){
  const serviceEl = byId('pkgService');
  const titleEl = byId('pkgTitle');
  if(serviceEl) serviceEl.value = 'music_video';
  if(titleEl) titleEl.value = '';
  for(const t of ['bronze','silver','gold','elite']){
    const onEl = byId('tierOn_'+t);
    const pEl  = byId('tierPrice_'+t);
    const dEl  = byId('tierDays_'+t);
    const iEl  = byId('tierIncludes_'+t);
    const aEl  = byId('tierAddons_'+t);
    if(onEl) onEl.checked = (t!=='elite');
    if(pEl) pEl.value = '';
    if(dEl) dEl.value = '';
    if(iEl) iEl.value = '';
    if(aEl) aEl.value = '';
  }
  APP._editingPkgKey = null;
}

function loadPkgIntoForm(service, title){
  const rows = (APP._myPackagesRows||[]).filter(r=>String(r.service||'')===String(service||'') && String(r.title||'')===String(title||''));
  if(byId('pkgService')) byId('pkgService').value = service || 'other';
  if(byId('pkgTitle')) byId('pkgTitle').value = title || '';
  const byTier = {};
  for(const r of rows){ byTier[String(r.tier||'').toLowerCase()] = r; }
  for(const t of ['bronze','silver','gold','elite']){
    const r = byTier[t];
    const onEl = byId('tierOn_'+t);
    const pEl  = byId('tierPrice_'+t);
    const dEl  = byId('tierDays_'+t);
    const iEl  = byId('tierIncludes_'+t);
    const aEl  = byId('tierAddons_'+t);
    if(onEl) onEl.checked = r ? (r.active !== false) : (t!=='elite');
    if(pEl) pEl.value = r ? String(r.price_credits||'') : '';
    if(dEl) dEl.value = r && r.delivery_days != null ? String(r.delivery_days) : '';
    if(iEl) iEl.value = r ? String(r.includes||'') : '';
    if(aEl) aEl.value = r ? String(r.addons||'') : '';
  }
  APP._editingPkgKey = (service||'') + '||' + (title||'');
  toast('Loaded package. Edit and hit “Save tiers”.');
}

async function savePkgTiers(){
  if(!APP.sb || !APP.user) return toast('Sign in first');
  const service = (byId('pkgService')?.value || 'other').trim();
  const title = (byId('pkgTitle')?.value || '').trim();
  if(!title) return toast('Add a package title');

  const payload = [];
  for(const t of ['bronze','silver','gold','elite']){
    const active = !!byId('tierOn_'+t)?.checked;
    const price = Number(byId('tierPrice_'+t)?.value || 0);
    const daysRaw = byId('tierDays_'+t)?.value;
    const delivery_days = (daysRaw === '' || daysRaw == null) ? null : Number(daysRaw);
    const includes = (byId('tierIncludes_'+t)?.value || '').trim();
    const addons = (byId('tierAddons_'+t)?.value || '').trim();

    // If tier is off and no existing row, skip inserting.
    const existing = (APP._myPackagesRows||[]).find(r=>String(r.creator_id)===String(APP.user.id) && String(r.service)===service && String(r.tier).toLowerCase()===t && String(r.title||'')===title);
    if(!active && !existing) continue;

    payload.push({
      creator_id: APP.user.id,
      service,
      tier: t,
      title,
      price_credits: Math.max(0, Math.floor(price||0)),
      delivery_days,
      includes,
      addons,
      active,
    });
  }

  if(!payload.length) return toast('Turn on at least one tier');

  const { error } = await APP.sb
    .from('packages')
    .upsert(payload, { onConflict: 'creator_id,service,tier' });

  if(error){
    console.warn(error);
    return toast(error.message || 'Could not save packages');
  }

  toast('Saved. Your packages are live on Post.');
  await loadMyPackages();
}

async function findCreators(){
  if(!APP.sb) return;
  const service = byId('projService')?.value || 'music_video';
  const tier = byId('projTier')?.value || 'bronze';

  const out = byId('creatorResults');
  const empty = byId('creatorResultsEmpty');
  if(out) out.innerHTML = '<div class="muted">Searching…</div>';

  const { data, error } = await APP.sb
    .from('packages')
    .select('*, profiles:creator_id (id, display_name, city, bio, portfolio_url, approved)')
    .eq('service', service)
    .eq('tier', tier)
    .order('price_credits', { ascending:true })
    .limit(60);

  if(error){ toast(error.message); return; }

  const rows = (data || []).filter(p => p.profiles?.approved === true);
  if(!rows.length){
    if(out) out.innerHTML = '';
    if(empty) empty.style.display = 'block';
    return;
  }
  if(empty) empty.style.display = 'none';

  out.innerHTML = rows.map(p=>{
    const pr = p.profiles;
    return `
      <div class="card mini">
        <div class="cardTitle">${esc(pr.display_name)} <span class="muted">· ${esc(pr.city||'LA')}</span></div>
        <div class="row" style="gap:8px; flex-wrap:wrap;">
          <div class="pill">${esc(p.service)} · ${esc(p.tier)}</div>
          <div class="pill"><b>${moneyCredits(p.price_credits)}</b> credits</div>
          ${p.delivery_days ? `<div class="pill">${p.delivery_days} days</div>` : ''}
        </div>
        <div class="muted" style="margin-top:8px;">${esc(p.title)}</div>
        ${p.includes ? `<div class="muted" style="margin-top:6px;">${esc(p.includes)}</div>` : ''}
        <div class="row" style="margin-top:10px; justify-content:space-between;">
          <button class="btn ghost" data-view="${esc(pr.id)}" type="button">View</button>
          <button class="btn" data-select="${esc(p.id)}" type="button">Select</button>
        </div>
      </div>
    `;
  }).join('');

  $$('button[data-view]', out).forEach(btn=>{
    btn.addEventListener('click', async ()=>{ await openCreatorProfile(btn.getAttribute('data-view')); });
  });
  $$('button[data-select]', out).forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const pkgId = btn.getAttribute('data-select');
      const pkg = rows.find(x=>String(x.id)===String(pkgId));
      if(!pkg) return;
      selectPackage(pkg.profiles, pkg);
    });
  });
}

function selectPackage(creatorProfile, pkg){
  APP.chosen.creator = creatorProfile;
  APP.chosen.package = pkg;
  if(byId('requestBox')) byId('requestBox').style.display = 'block';
  if(byId('chosenCreator')) byId('chosenCreator').textContent = creatorProfile.display_name || 'Creator';
  if(byId('chosenPackage')) byId('chosenPackage').textContent = pkg.title || 'Package';
  if(byId('chosenPrice')) byId('chosenPrice').textContent = moneyCredits(pkg.price_credits) + ' credits';
}

async function sendRequest(){
  if(!APP.sb || !APP.user) return toast('Sign in first');
  const pkg = APP.chosen.package;
  const creator = APP.chosen.creator;
  if(!pkg || !creator) return toast('Select a package first');

  const reqDate = byId('reqDate')?.value || '';
  const notes = (byId('reqMsg')?.value || '').trim();
  const requested_date = reqDate ? new Date(reqDate).toISOString() : null;
  const total_credits = Number(pkg.price_credits || 0);

  const bRes = await APP.sb.from('bookings').insert({
    client_id: APP.user.id,
    status: 'requested',
    requested_date,
    notes,
    total_credits,
    funded: false,
  }).select('*').single();
  if(bRes.error) return toast(bRes.error.message);
  const booking = bRes.data;

  const lRes = await APP.sb.from('booking_creators').insert({
    booking_id: booking.id,
    creator_id: creator.id,
    package_id: pkg.id,
    price_credits: total_credits,
  });
  if(lRes.error) return toast(lRes.error.message);

  toast('Request sent. Check Profile → Projects.');
  if(byId('requestBox')) byId('requestBox').style.display = 'none';
  if(byId('reqMsg')) byId('reqMsg').value = '';
  APP.chosen.creator = null; APP.chosen.package = null;
  location.hash = '#profile';
  await safeRoute();
}

/* ----------------------------- projects ----------------------------- */
function statusLabel(s){
  const t = String(s||'requested');
  const nice = {
    requested:'Requested', accepted:'Accepted', declined:'Declined',
    in_progress:'In progress', delivered:'Delivered', approved:'Approved', cancelled:'Cancelled'
  };
  return nice[t] || t;
}
async function listMyProjects(){
  if(!APP.sb || !APP.user) return [];
  // Try creator view first; if it fails, fall back to client view
  const tryViews = [
    ['booking_card_creator', 'creator_id'],
    ['booking_card_client',  'client_id'],
  ];
  for(const [view, col] of tryViews){
    const { data, error } = await APP.sb.from(view).select('*').eq(col, APP.user.id).order('created_at', { ascending:false }).limit(100);
    if(!error) return data || [];
  }
  return [];
}
function renderProjectCards(rows){
  if(!rows.length) return `<div class="muted">No projects yet.</div>`;
  return rows.map(r=>{
    const done = ['delivered','approved'].includes(String(r.status||''));
    return `
    <div class="card mini">
      <div class="row" style="justify-content:space-between; align-items:flex-start;">
        <div>
          <div class="cardTitle">${esc(r.title_line || 'Project')} <span class="muted">· ${esc(r.counterparty_name || '')}</span></div>
          <div class="muted">${esc(r.service||'')} · <b>${moneyCredits(r.total_credits||0)}</b> credits</div>
          <div class="muted">Requested: ${fmtDateTime(r.requested_date) || '—'} · Created: ${fmtDateTime(r.created_at)}</div>
        </div>
        <div class="pill">${esc(statusLabel(r.status))}</div>
      </div>

      <div class="row" style="margin-top:10px; justify-content:flex-end; gap:8px; flex-wrap:wrap;">
        ${done ? `<button class="btn" data-post="${esc(r.id)}" type="button">Post Result</button>` : ``}
        <button class="btn ghost" data-open="${esc(r.id)}" type="button">Open</button>
      </div>
    </div>
  `;
  }).join('');
}
function bindProjectOpen(root){
  $$('button[data-open]', root).forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-open');
      if(id) await openProject(id);
    });
  });

  $$('button[data-post]', root).forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-post');
      if(!id) return;
      const exists = await hasPostForBooking(id);
      if(exists) return toast('You already posted this project.');
      openProjectPostModal(id);
    });
  });
}

function openProjectPostModal(bookingId){
  APP._postBookingId = bookingId;
  if(byId('postProjTitle')) byId('postProjTitle').value = '';
  if(byId('postProjDesc')) byId('postProjDesc').value = '';
  if(byId('postProjMedia')) byId('postProjMedia').value = '';
  if(byId('postProjPreview')) byId('postProjPreview').innerHTML = '';
  openModal('postProjectModal');

  if(!APP._bindPostProjectModal){
    APP._bindPostProjectModal = true;

    on('btnClosePostProject','click', ()=>closeModal('postProjectModal'));

    const media = byId('postProjMedia');
    if(media){
      media.addEventListener('input', ()=>{
        const url = media.value || '';
        const prev = byId('postProjPreview');
        if(prev) prev.innerHTML = embedMedia(url);
      });
    }

    on('btnSubmitPostProject','click', async ()=>{ await submitProjectPost(); });
  }
}

async function submitProjectPost(){
  if(!APP.sb || !APP.user) return toast('Sign in first');
  const bookingId = APP._postBookingId;
  if(!bookingId) return toast('Missing project');
  const title = (byId('postProjTitle')?.value||'').trim();
  const body = (byId('postProjDesc')?.value||'').trim();
  const media_url = (byId('postProjMedia')?.value||'').trim();

  const exists = await hasPostForBooking(bookingId);
  if(exists) return toast('You already posted this project.');

  const payload = { user_id: APP.user.id, booking_id: bookingId, title, body, media_url };
  const { error } = await APP.sb.from('posts').insert(payload);
  if(error){
    console.warn('post insert failed', error);
    toast('Posting needs SQL update (posts.booking_id + posts.media_url).');
    return;
  }

  closeModal('postProjectModal');
  toast('Posted');
  await renderPublicPosts();
}
async function openProject(projectId){
  if(!APP.sb) return;

  const { data: booking, error } = await APP.sb.from('bookings').select('*').eq('id', projectId).maybeSingle();
  if(error) return toast(error.message);
  if(!booking) return toast('Project not found');

  const { data: lines } = await APP.sb.from('booking_lines').select('*').eq('booking_id', projectId);
  const line = (lines||[])[0];

  const { data: msgs } = await APP.sb.from('messages').select('*').eq('booking_id', projectId).order('created_at', { ascending:true }).limit(200);
  const { data: dels } = await APP.sb.from('deliveries').select('*').eq('booking_id', projectId).order('created_at', { ascending:false }).limit(50);

  const modal = byId('creditsModal');
  const sheet = modal?.querySelector('.sheet');
  if(!modal || !sheet) return;

  sheet.innerHTML = `
    <div class="modalTitle">Project</div>
    <div class="muted">${esc(line?.creator_name || '')} · ${esc(line?.service || '')} · ${esc(line?.tier || '')} · <b>${moneyCredits(booking.total_credits||0)}</b> credits</div>

    <div class="card" style="margin-top:12px;">
      <div class="cardTitle">Status</div>
      <div class="row" style="margin-top:10px; justify-content:space-between;">
        <div class="pill">Status: ${esc(statusLabel(booking.status))}</div>
        <div class="pill">Requested: ${fmtDateTime(booking.requested_date) || '—'}</div>
      </div>
    </div>

    <div class="card" style="margin-top:12px;">
      <div class="cardTitle">Chat</div>
      <div id="projChat" style="max-height:220px; overflow:auto; padding-right:6px;">
        ${(msgs||[]).length ? (msgs||[]).map(m=>`
          <div style="margin:10px 0;">
            <div class="muted" style="font-size:12px;">${esc(m.sender_id === APP.user?.id ? 'You' : 'Them')} · ${fmtDateTime(m.created_at)}</div>
            <div>${esc(m.body)}</div>
          </div>
        `).join('') : `<div class="muted">No messages yet.</div>`}
      </div>
      <div class="row" style="margin-top:10px;">
        <input id="msgBody" placeholder="Message…" />
        <button class="btn" id="btnSendMsg" type="button">Send</button>
      </div>
    </div>

    <div class="card" style="margin-top:12px;">
      <div class="cardTitle">Deliveries</div>
      ${(dels||[]).length ? (dels||[]).map(d=>`
        <div style="margin:10px 0;">
          <div class="muted" style="font-size:12px;">${fmtDateTime(d.created_at)}</div>
          <div><a href="${esc(d.link)}" target="_blank" rel="noreferrer" style="color:#fff">${esc(d.link)}</a></div>
          ${d.note ? `<div class="muted">${esc(d.note)}</div>` : ''}
        </div>
      `).join('') : `<div class="muted">No deliveries yet.</div>`}
    </div>

    <div class="row" style="margin-top:12px; justify-content:flex-end;">
      <button class="btn ghost" id="btnCloseProj" type="button">Close</button>
    </div>
  `;
  openModal('creditsModal');
  on('btnCloseProj','click',()=>closeModal('creditsModal'));

  on('btnSendMsg','click', async ()=>{
    const body = (byId('msgBody')?.value || '').trim();
    if(!body) return;
    const r = await APP.sb.from('messages').insert({ booking_id: projectId, sender_id: APP.user.id, body });
    if(r.error) return toast(r.error.message);
    byId('msgBody').value = '';
    await openProject(projectId);
  });
}

/* ----------------------------- profile ----------------------------- */
function setTab(which){
  const map = {
    projects: ['tabProjects','panelProjects'],
    feed: ['tabFeed','panelFeed'],
    settings: ['tabSettings','panelSettings'],
  };
  Object.entries(map).forEach(([k,[bid,pid]])=>{
    byId(bid)?.classList.toggle('active', k===which);
    const p = byId(pid);
    if(p) p.style.display = (k===which) ? 'block' : 'none';
  });
}
function bindProfileTabs(){
  on('tabProjects','click',()=>setTab('projects'));
  on('tabFeed','click',async ()=>{ setTab('feed'); await renderMyFeed(); });
  on('tabSettings','click',()=>setTab('settings'));
}
function bindFeedComposer(){
  on('btnPost','click',()=>toast('Posts unlock after a project is completed.'));
  on('btnClearPosts','click', async ()=>{
    if(!APP.user || !APP.sb) return;
    const r = await APP.sb.from('posts').delete().eq('user_id', APP.user.id);
    if(r.error) return toast(r.error.message);
    await renderMyFeed();
    await renderPublicPosts();
    toast('Cleared');
  });
}
async function saveSettingsInline(){
  if(!APP.sb || !APP.user) return toast('Sign in first');
  const role1 = (byId('setRole1')?.value || '').trim();
  const role2 = (byId('setRole2')?.value || '').trim();
  const avatarUrl = (byId('setAvatar2')?.value || '').trim();

  const patch = {
    display_name: (byId('setName2')?.value || '').trim() || 'User',
    city: (byId('setCity2')?.value || '').trim() || 'Los Angeles',
    bio: (byId('setBio2')?.value || '').trim(),
    portfolio_url: (byId('setPortfolio2')?.value || '').trim(),
    resume_url: (byId('setResume2')?.value || '').trim(),
    avatar_url: avatarUrl,
    role_primary: role1 || null,
    role_secondary: role2 || null,
  };

  let r = await APP.sb.from('profiles').update(patch).eq('id', APP.user.id).select('*').single();
  if(r.error){
    // fallback if columns don't exist
    console.warn(r.error);
    const fallback = {
      display_name: patch.display_name,
      city: patch.city,
      bio: patch.bio,
      portfolio_url: patch.portfolio_url,
      resume_url: patch.resume_url,
      avatar_url: patch.avatar_url,
      role: role1 || role2 || (APP.me?.role || 'member'),
    };
    const r2 = await APP.sb.from('profiles').update(fallback).eq('id', APP.user.id).select('*').single();
    if(r2.error) return toast(r2.error.message);
    APP.me = r2.data;
    localStorage.setItem('CB_ROLE1', role1);
    localStorage.setItem('CB_ROLE2', role2);
    toast('Saved (roles stored locally until SQL adds columns).');
    await safeRoute();
    return;
  }
  APP.me = r.data;
  localStorage.setItem('CB_ROLE1', role1);
  localStorage.setItem('CB_ROLE2', role2);
  toast('Saved');
  await safeRoute();
}



async function renderFollowCounts(userId){
  if(!APP.sb || !userId) return { followers:0, following:0 };
  try{
    // count following
    const a = await APP.sb.from('follows')
      .select('*', { count:'exact', head:true })
      .eq('follower_id', userId);
    // count followers
    const b = await APP.sb.from('follows')
      .select('*', { count:'exact', head:true })
      .eq('following_id', userId);

    const following = Number(a.count||0);
    const followers = Number(b.count||0);
    return { followers, following };
  }catch(e){
    console.warn(e);
    return { followers:0, following:0 };
  }
}

async function openFollowModal(mode){
  if(!APP.sb || !APP.user) return toast('Sign in first');
  openModal('followModal');
  if(byId('followModalTitle')) byId('followModalTitle').textContent = mode === 'following' ? 'Following' : 'Followers';
  const out = byId('followList');
  const empty = byId('followEmpty');
  if(out) out.innerHTML = '<div class="muted">Loading…</div>';
  if(empty) empty.style.display='none';

  try{
    // requires SQL table: follows (follower_id, following_id, created_at)
    let ids = [];
    if(mode === 'following'){
      const r = await APP.sb.from('follows').select('following_id').eq('follower_id', APP.user.id);
      if(r.error) throw r.error;
      ids = (r.data||[]).map(x=>x.following_id);
    }else{
      const r = await APP.sb.from('follows').select('follower_id').eq('following_id', APP.user.id);
      if(r.error) throw r.error;
      ids = (r.data||[]).map(x=>x.follower_id);
    }
    if(!ids.length){
      if(out) out.innerHTML='';
      if(empty) empty.style.display='block';
      return;
    }
    const pr = await APP.sb.from('profiles').select('id,display_name,city,avatar_url').in('id', ids);
    if(pr.error) throw pr.error;

    const rows = pr.data || [];
    if(out){
      out.innerHTML = rows.map(p=>{
        const av = p.avatar_url || '';
        return `<div class="row" style="gap:10px; padding:10px 0; border-bottom:1px solid rgba(255,255,255,.10);">
          <div class="miniAvatar" style="overflow:hidden;">${av ? `<img src="${esc(av)}" style="width:100%; height:100%; object-fit:cover;" />` : esc((p.display_name||'U').slice(0,1).toUpperCase())}</div>
          <div style="flex:1;">
            <div style="font-weight:800">${esc(p.display_name||'User')}</div>
            <div class="muted tiny">${esc(p.city||'Los Angeles')}</div>
          </div>
        </div>`;
      }).join('');
    }
  }catch(e){
    console.warn(e);
    if(out) out.innerHTML='';
    if(empty){ empty.style.display='block'; empty.textContent='Followers/Following needs SQL (follows table).'; }
  }
}

async function getFriendIds(){
  if(!APP.sb || !APP.user) return [];
  try{
    const r1 = await APP.sb.from('follows').select('following_id').eq('follower_id', APP.user.id);
    if(r1.error) throw r1.error;
    const following = new Set((r1.data||[]).map(x=>x.following_id));
    const r2 = await APP.sb.from('follows').select('follower_id').eq('following_id', APP.user.id);
    if(r2.error) throw r2.error;
    const followers = new Set((r2.data||[]).map(x=>x.follower_id));
    const mutual = [];
    following.forEach(id=>{ if(followers.has(id)) mutual.push(id); });
    return mutual;
  }catch(e){
    console.warn(e);
    return [];
  }
}


async function getFollowingIds(){
  if(!APP.sb || !APP.user) return [];
  try{
    const r = await APP.sb.from('follows').select('following_id').eq('follower_id', APP.user.id);
    if(r.error) throw r.error;
    return (r.data||[]).map(x=>x.following_id).filter(Boolean);
  }catch(e){
    console.warn(e);
    return [];
  }
}

async function renderProjectsPage(){
  showPage('pageProjects');
  setNavActive('projects');

  const wrap = byId('projectsAll');
  if(wrap) wrap.innerHTML = `<div class="muted">Loading…</div>`;

  const all = await listAllMyProjects();
  if(wrap) wrap.innerHTML = renderProjectCards(all);

  if(wrap) bindProjectOpen(wrap);
}

async function listAllMyProjects(){
  if(!APP.sb || !APP.user) return [];
  // Pull BOTH sides (buyer/client and seller/creator) if views exist.
  const out = [];

  // buyer side
  const a = await APP.sb.from('booking_card_client').select('*').eq('client_id', APP.user.id).order('created_at', { ascending:false }).limit(100);
  if(!a.error) (a.data||[]).forEach(r=>out.push({ ...r, _side:'buy' }));

  // seller side
  const b = await APP.sb.from('booking_card_creator').select('*').eq('creator_id', APP.user.id).order('created_at', { ascending:false }).limit(100);
  if(!b.error) (b.data||[]).forEach(r=>out.push({ ...r, _side:'sell' }));

  // Dedupe by id (same booking could appear in both if you book yourself)
  const seen = new Set();
  const uniq = [];
  for(const r of out){
    if(seen.has(r.id)) continue;
    seen.add(r.id);
    uniq.push(r);
  }
  // sort newest
  uniq.sort((x,y)=> new Date(y.created_at||0)-new Date(x.created_at||0));
  return uniq;
}

async function renderProfile(){
  showPage('pageProfile');
  setNavActive('profile');

  const name = APP.me?.display_name || 'User';
  const city = APP.me?.city || 'Los Angeles';
  const bal = moneyCredits(APP.wallet?.balance||0);

  if(byId('profileName')) byId('profileName').textContent = name;
  if(byId('profileCity')) byId('profileCity').textContent = city;
  if(byId('profileCredits')) byId('profileCredits').textContent = bal;

  
  // Profile avatar + click-to-upload
  const avUrl = (APP.me?.avatar_url || localStorage.getItem('CB_AVATAR_URL') || '').trim();
  const avEl = byId('profileAvatar');
  if(avEl){
    if(avUrl){
      avEl.innerHTML = `<img src="${esc(avUrl)}" style="width:100%; height:100%; object-fit:cover; border-radius:999px;" />`;
    }else{
      avEl.textContent = (name||'U').slice(0,1).toUpperCase();
    }
    if(!avEl._bound){
      avEl._bound = true;
      avEl.style.cursor = 'pointer';
      avEl.addEventListener('click', ()=>{
        const fileInput = byId('avatarFile');
        if(fileInput) fileInput.click();
        else toast('Open Settings to upload a photo (avatarFile missing).');
      });
    }
  }

  // Show 2 labels if present
  const r1 = (APP.me?.role_primary || localStorage.getItem('CB_ROLE1') || '').trim();
  const r2 = (APP.me?.role_secondary || localStorage.getItem('CB_ROLE2') || '').trim();
  const roleText = (r1 && r2) ? `${r1} / ${r2}` : (r1 || r2 || (APP.me?.role || 'member'));
  if(byId('profileRole')) byId('profileRole').textContent = roleText;

  // Follow counts (if follows table exists)
  try{
    const c = await renderFollowCounts(APP.user?.id);
    if(byId('profileFollowersCount')) byId('profileFollowersCount').textContent = c.followers;
    if(byId('profileFollowingCount')) byId('profileFollowingCount').textContent = c.following;
  }catch(e){}
  on('profileFollowersBtn','click', async ()=>{ await openFollowModal('followers'); });
  on('profileFollowingBtn','click', async ()=>{ await openFollowModal('following'); });

if(byId('setName2')) byId('setName2').value = APP.me?.display_name || '';
  if(byId('setCity2')) byId('setCity2').value = APP.me?.city || 'Los Angeles';
  if(byId('setBio2')) byId('setBio2').value = APP.me?.bio || '';
  if(byId('setPortfolio2')) byId('setPortfolio2').value = APP.me?.portfolio_url || '';
  if(byId('setResume2')) byId('setResume2').value = APP.me?.resume_url || '';
  if(byId('setAvatar2')) byId('setAvatar2').value = APP.me?.avatar_url || '';

  const role1 = APP.me?.role_primary || localStorage.getItem('CB_ROLE1') || '';
  const role2 = APP.me?.role_secondary || localStorage.getItem('CB_ROLE2') || '';
  if(byId('setRole1')) byId('setRole1').value = role1;
  if(byId('setRole2')) byId('setRole2').value = role2;

  // avatar preview
  const av = (byId('setAvatar2')?.value || APP.me?.avatar_url || localStorage.getItem('CB_AVATAR_URL') || '').trim();
  if(byId('avatarPreview')) byId('avatarPreview').innerHTML = av ? `<img src="${esc(av)}" style="width:88px; height:88px; object-fit:cover; border-radius:14px; border:1px solid rgba(255,255,255,.14);" />` : '<span class="muted tiny">No photo yet.</span>';


  const projOut = byId('profileProjects');
  if(projOut){
    projOut.innerHTML = '<div class="muted">Loading…</div>';
    const cards = await listMyProjects();
    projOut.innerHTML = renderProjectCards(cards);
    bindProjectOpen(projOut);
  }

  
  if(!APP._bindFollowUI){
    APP._bindFollowUI = true;
    const avIn = byId('avatarFile');
    if(avIn) avIn.addEventListener('change', async ()=>{ if(APP.user) await uploadAvatarFromInput(); });

    on('btnCloseFollowModal','click', ()=>closeModal('followModal'));
    on('btnFollowers','click', async ()=>{ await openFollowModal('followers'); });
    on('btnFollowing','click', async ()=>{ await openFollowModal('following'); });
  }
await renderMyFeed();
  setTab('projects');
}

/* ----------------------------- routing ----------------------------- */
async function route(){
  initSupabase();
  if(!APP.sb){
    setAuthedUI();
    showPage("pagePost");
    toast('Setup needed: check config.js (Supabase URL + anon key)');
    return;
  }

  await refreshSession();

  if(!APP.user){
    setAuthedUI();
    const hash = getHash();
    if(hash === 'create' || hash === 'projects' || hash === 'profile'){
      setPostLoginHash('#' + hash);
      openModal('authModal');
      setAuthMode('login');
      location.hash = '#home';
    }
    if(hash === 'book') await renderBook();
    else await renderPost();
    return;
  }

  await ensureProfile();
  setAuthedUI();
  await refreshWallet();

  const hash = getHash();
  if(hash === 'home' || hash === 'post') await renderPost();
  else if(hash === 'book') await renderBook();
  else if(hash === 'create') await renderCreatePackage();
  else if(hash === 'projects') await renderProjectsPage();
  else if(hash === 'profile') await renderProfile();
  else location.hash = '#home';
}

// CB_NAV_DELEGATE: capture listener for nav links so tab switching/bfcache never
// results in "can't navigate until refresh".
function bindNavDelegate(){
  if(window.CB_NAV_DELEGATE) return;
  window.CB_NAV_DELEGATE = true;
  document.addEventListener('click', (e)=>{
    const a = e.target && e.target.closest ? e.target.closest('nav.nav a[data-nav]') : null;
    if(!a) return;
    if(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const href = a.getAttribute('href') || '#home';
    const want = href.startsWith('#') ? href : ('#' + href);
    if(location.hash !== want) location.hash = want;
    scheduleRoute(0);
  }, { capture:true });
}

/* ----------------------------- init ----------------------------- */
async function init(){
  // make errors visible instead of "dead buttons"
  window.addEventListener('error', (e)=>{
    console.error(e?.error || e);
    toast('Error: ' + String(e?.message || 'something broke'));
  });
  window.addEventListener('unhandledrejection', (e)=>{
    console.error(e?.reason || e);
  bindNavDelegate();
    toast('Error: ' + String(e?.reason?.message || e?.reason || 'something broke'));
  });
  // --- Recovery: Chrome tab-switch can leave an invisible click-shield on top (stuck until refresh).
  // We aggressively close/hide any full-screen fixed overlays when the page becomes visible again.
  const killClickShields = ()=>{
    try{
      // 1) close known UI layers
      ["authModal","onboardModal","creditsModal","bookModal","postProjectModal","followModal","userProfileModal"].forEach(id=>closeModal(id));
      const pm = byId("profileMenu");
      if(pm) pm.style.display = "none";

      // 2) clear scroll/pointer locks
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";

      // 3) detect any fixed element covering the viewport with pointer-events enabled and high z-index
      const vw = window.innerWidth, vh = window.innerHeight;
      const all = Array.from(document.querySelectorAll("body *"));
      for(const el of all){
        const cs = getComputedStyle(el);
        if(cs.position !== "fixed") continue;
        if(cs.pointerEvents === "none") continue;
        const z = parseInt(cs.zIndex || "0", 10) || 0;
        if(z < 40) continue;

        const r = el.getBoundingClientRect();
        const covers = (r.left <= 0 && r.top <= 0 && r.right >= vw-1 && r.bottom >= vh-1);
        if(!covers) continue;

        // Prefer hiding known modal-ish things; otherwise neuter the shield.
        if(el.classList.contains("modal") || /Modal$/i.test(el.id||"")){
          el.style.display = "none";
        }else{
          el.dataset.cbShieldKilled = "1";
          el.style.pointerEvents = "none";
          el.style.userSelect = "none";
        }
      }
    }catch(err){
      console.warn("killClickShields failed", err);
    }
  };

  const recoverUI = ()=>{
    try{ _routeInFlight = false; _routeQueued = false; }catch(_e){}
    killClickShields();
    // Re-render current route so hash clicks still apply without a refresh.
    Promise.resolve().then(()=>safeRoute());
  };

  window.addEventListener("visibilitychange", ()=>{ if(!document.hidden) recoverUI(); });
  window.addEventListener("focus", recoverUI);
  window.addEventListener("pageshow", (e)=>{ recoverUI(); try{ if(e && e.persisted){ setTimeout(recoverUI, 120); setTimeout(()=>scheduleRoute(0), 160); } }catch(_e){} });


  initSupabase();
  handleAuthHashErrors();

  if(APP.sb){
    APP.sb.auth.onAuthStateChange(async (_event, _session)=>{
      if(APP._booting) return;
      await refreshSession();
      if(APP.user){
        await ensureProfile();
        setAuthedUI();
        await refreshWallet();
        const intended = popPostLoginHash();
        closeModal('authModal');
        if(intended){ location.hash = intended; }
      }else{
        setAuthedUI();
      }
      if(authArtifactsPresent()) clearAuthArtifacts(getHash());
      await safeRoute();
    });
  }

  // profile menu
  on('btnProfile','click',()=>{
    const m = byId('profileMenu');
    if(!m) return;
    m.style.display = (m.style.display === 'block') ? 'none' : 'block';
  });
  document.addEventListener('click',(e)=>{
    const mw = byId('profileMenuWrap');
    const m = byId('profileMenu');
    if(!mw || !m) return;
    if(!mw.contains(e.target)) m.style.display = 'none';
  });

  on('menuSignOut','click', signOut);
  on('btnCreditsTop','click', openCredits);
  on('btnBuyCredits','click', openCredits);
  on('creditsPill','click', openCredits);

  // auth modal open/close
  on('btnSignIn','click',()=>{
    if(!initSupabase()) return toast('Setup needed: add your Supabase URL + anon key in config.js');
    openModal('authModal');
    setAuthMode('login');
  });
  on('authClose','click',()=>closeModal('authModal'));

  // auth mode toggle
  on('authModeLogin','click',()=>setAuthMode('login'));
  on('authModeSignup','click',()=>setAuthMode('signup'));
  on('authGoSignup','click',()=>setAuthMode('signup'));
  on('authGoLogin','click',()=>setAuthMode('login'));

  setAuthMode('login');
  on('authGoogle','click', signInWithGoogle);
  on('authLogin','click', signInWithPassword);
  on('authSignup','click', signUpWithPassword);
  on('authForgot','click', forgotPassword);

  // home filters
  on('homeRefresh','click', ()=>scheduleRoute(0));
  on('homeService','change', ()=>scheduleRoute(0));
  on('homeTier','change', ()=>scheduleRoute(0));
  on('postsSort','change', ()=>renderPublicPosts());

  // create flow
  on('btnFindCreators','click', findCreators);
  on('btnSendRequest','click', sendRequest);
  on('btnCancelRequest','click', ()=>{
    if(byId('requestBox')) byId('requestBox').style.display = 'none';
    APP.chosen.creator = null; APP.chosen.package = null;
  });

  // profile tabs + settings + feed
  bindProfileTabs();
  bindFeedComposer();
  on('btnSaveSettings2','click', saveSettingsInline);

  // hash routing
  window.addEventListener('hashchange', ()=>scheduleRoute(0));

  // hero CTA
  const goCreate = ()=>{
    if(APP.user){ location.hash = '#create'; return; }
    setPostLoginHash('#create');
    openModal('authModal');
    setAuthMode('login');
  };
  const hcc = byId('homeCtaCreate');
  if(hcc) hcc.addEventListener('click', goCreate);

  // boot restore (prevents refresh/sign-out feel)
  APP._booting = true;
  try{
    await refreshSession();
    if(APP.user){
      await ensureProfile();
      setAuthedUI();
      await refreshWallet();
    }else{
      setAuthedUI();
    }
  }catch(e){
    console.error(e);
  }finally{
    APP._booting = false;
  }

  await safeRoute();
}

document.addEventListener('DOMContentLoaded', init)
async function updateMyFollowCounts(){
  try{
    if(!APP.user) return;
    const c = await renderFollowCounts(APP.user.id);
    if(byId('profileFollowersCount')) byId('profileFollowersCount').textContent = c.followers;
    if(byId('profileFollowingCount')) byId('profileFollowingCount').textContent = c.following;
    // if you show counts in a menu later, we can wire them here too
  }catch(e){}
}

;
