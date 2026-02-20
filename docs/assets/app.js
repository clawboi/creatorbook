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
    clearAuthArtifacts("post");
    return true;
  }
  return false;
}
function getHash(){
  // If hash contains auth params, treat as home.
  const hp = hashParams();
  if(hp.has("access_token") || hp.has("refresh_token") || hp.has("type") || hp.has("error")) return "post";
  const raw = (location.hash || "#post").replace(/^#/, "").trim();
  if(raw.includes("=")) return "post";
  return raw || "post";
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
  const { data } = await APP.sb.auth.getSession();
  APP.session = data?.session || null;
  APP.user = APP.session?.user || null;
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

  clearAuthArtifacts("post");
  location.hash = "#post";

  APP._booting = false;
  await route();
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
  setNavActive("post");

  // tabs (community vs packages)
  if(!APP._bindPostTabs){
    APP._bindPostTabs = true;
    const btnPosts = byId('homeTabPosts');
    const btnPkgs  = byId('homeTabPackages');
    const wrapPosts = byId('homePostsWrap');
    const wrapPkgs  = byId('homePackagesWrap');
    const setTab = (which)=>{
      if(btnPosts) btnPosts.classList.toggle('active', which==='posts');
      if(btnPkgs)  btnPkgs.classList.toggle('active', which==='pkgs');
      if(wrapPosts) wrapPosts.style.display = (which==='posts') ? '' : 'none';
      if(wrapPkgs)  wrapPkgs.style.display  = (which==='pkgs')  ? '' : 'none';
    };
    if(btnPosts) btnPosts.addEventListener('click', ()=>setTab('posts'));
    if(btnPkgs)  btnPkgs.addEventListener('click', ()=>setTab('pkgs'));
    // default
    setTab('posts');
  }

  // public posts always
  await renderPublicPosts();

  // packages feed
  const feedEl = byId("feed");
  const emptyEl = byId("feedEmpty");
  if(feedEl){
    feedEl.innerHTML = '<div class="muted">Loading…</div>';
    const { groups, profiles } = await fetchPackagesFeed();
    if(!groups.length){
      feedEl.innerHTML = "";
      if(emptyEl) emptyEl.style.display = "block";
    }else{
      if(emptyEl) emptyEl.style.display = "none";
      feedEl.innerHTML = groups.map(g=>{
        const first = g.items[0];
        const prof = profiles[first.creator_id] || {};
        const name = prof.display_name || 'User';
        const city = prof.city || 'Los Angeles';
        const tiers = g.items.map(p=>{
          const t = String(p.tier||'').toLowerCase();
          return `
            <div class="card mini" style="margin-top:10px;">
              <div class="row" style="justify-content:space-between; align-items:flex-start;">
                <div>
                  <div class="pill">${esc(t.toUpperCase())}</div>
                  <div class="muted" style="margin-top:6px;">${esc(p.delivery_days != null ? (p.delivery_days + ' days') : '')}</div>
                  ${p.includes ? `<div style="margin-top:6px; white-space:pre-wrap">${esc(p.includes)}</div>` : ``}
                  ${p.addons ? `<div class="muted" style="margin-top:6px; white-space:pre-wrap">Add-ons: ${esc(p.addons)}</div>` : ``}
                </div>
                <div style="text-align:right;">
                  <div class="cardTitle" style="margin:0;">${moneyCredits(p.price_credits||0)}</div>
                  <div class="muted">credits</div>
                  ${APP.user ? `<button class="btn" data-bookpkg="${esc(p.id)}" style="margin-top:8px;" type="button">Book</button>` : `<div class="muted" style="margin-top:8px;">Sign in to book</div>`}
                </div>
              </div>
            </div>
          `;
        }).join('');
        return `
          <div class="card">
            <div class="row" style="justify-content:space-between; align-items:flex-start;">
              <div>
                <div class="cardTitle">${esc(first.title||'Package')}</div>
                <div class="muted">${esc(first.service||'')} · Sold by <b>${esc(name)}</b> · ${esc(city)}</div>
              </div>
            </div>
            ${tiers}
          </div>
        `;
      }).join('');

      // bind book buttons
      $$('button[data-bookpkg]', feedEl).forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          const pkgId = btn.getAttribute('data-bookpkg');
          const all = groups.flatMap(g=>g.items);
          const pkg = all.find(x=>String(x.id)===String(pkgId));
          if(!pkg) return;
          const prof = profiles[pkg.creator_id] || {};
          openBookModal(pkg, prof.display_name || 'User');
        });
      });
    }
  }
}

/* ----------------------------- posts (public + my posts) ----------------------------- */
async function fetchPublicPosts(){
  if(!APP.sb) return [];
  const { data, error } = await APP.sb.from('posts_public').select('*').order('created_at', { ascending:false }).limit(50);
  if(error){ console.warn('posts_public failed', error); return []; }
  return data || [];
}

function openBookModal(pkg, sellerName){
  if(!pkg) return;
  APP._bookPkg = pkg;

  if(byId('bookPkgTitle')) byId('bookPkgTitle').textContent = pkg.title || 'Package';
  if(byId('bookPkgMeta')) byId('bookPkgMeta').textContent = `${sellerName || 'User'} · ${pkg.service || ''} · ${(pkg.tier||'').toUpperCase()}`;
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
  await route();
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
  out.innerHTML = rows.map(p=>`
    <div class="card mini">
      <div class="row" style="gap:10px; align-items:center; margin-bottom:8px;">
        <div class="miniAvatar">${esc((p.display_name||'U').slice(0,1).toUpperCase())}</div>
        <div>
          <div style="font-weight:800; line-height:1.1">${esc(p.display_name||'User')}</div>
          <div class="muted tiny">${esc(p.city||'Los Angeles')} · ${fmtDateTime(p.created_at)}</div>
        </div>
      </div>
      ${p.title ? `<div style="font-weight:700">${esc(p.title)}</div>` : ''}
      <div style="margin-top:8px; white-space:pre-wrap">${esc(p.body||'')}</div>
    </div>
  `).join('');
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
        await route();
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
  await route();
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
  return rows.map(r=>`
    <div class="card mini">
      <div class="row" style="justify-content:space-between; align-items:flex-start;">
        <div>
          <div class="cardTitle">${esc(r.title_line || 'Project')} <span class="muted">· ${esc(r.counterparty_name || '')}</span></div>
          <div class="muted">${esc(r.service||'')} · ${esc(r.tier||'')} · <b>${moneyCredits(r.total_credits||0)}</b> credits</div>
          <div class="muted">Requested: ${fmtDateTime(r.requested_date) || '—'} · Created: ${fmtDateTime(r.created_at)}</div>
        </div>
        <div class="pill">${esc(statusLabel(r.status))}</div>
      </div>
      <div class="row" style="margin-top:10px; justify-content:flex-end;">
        <button class="btn ghost" data-open="${esc(r.id)}" type="button">Open</button>
      </div>
    </div>
  `).join('');
}
function bindProjectOpen(root){
  $$('button[data-open]', root).forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-open');
      if(id) await openProject(id);
    });
  });
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
  on('btnPost','click', async ()=>{
    if(!APP.user || !APP.sb) return toast('Sign in first');
    const title = (byId('postTitle')?.value || '').trim();
    const body = (byId('postBody')?.value || '').trim();
    if(!body) return toast('Write something');
    const r = await APP.sb.from('posts').insert({ user_id: APP.user.id, title, body }).select('id').single();
    if(r.error) return toast(r.error.message);
    if(byId('postTitle')) byId('postTitle').value='';
    if(byId('postBody')) byId('postBody').value='';
    await renderMyFeed();
    await renderPublicPosts();
    toast('Posted');
  });
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
  const patch = {
    display_name: (byId('setName2')?.value || '').trim() || 'User',
    city: (byId('setCity2')?.value || '').trim() || 'Los Angeles',
    bio: (byId('setBio2')?.value || '').trim(),
    portfolio_url: (byId('setPortfolio2')?.value || '').trim(),
    resume_url: (byId('setResume2')?.value || '').trim(),
    avatar_url: (byId('setAvatar2')?.value || '').trim(),
    role: (byId('setRole2')?.value || APP.me?.role || 'member'),
  };
  const r = await APP.sb.from('profiles').update(patch).eq('id', APP.user.id).select('*').single();
  if(r.error) return toast(r.error.message);
  APP.me = r.data;
  toast('Saved');
  await route();
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

  if(byId('setName2')) byId('setName2').value = APP.me?.display_name || '';
  if(byId('setCity2')) byId('setCity2').value = APP.me?.city || 'Los Angeles';
  if(byId('setBio2')) byId('setBio2').value = APP.me?.bio || '';
  if(byId('setPortfolio2')) byId('setPortfolio2').value = APP.me?.portfolio_url || '';
  if(byId('setResume2')) byId('setResume2').value = APP.me?.resume_url || '';
  if(byId('setAvatar2')) byId('setAvatar2').value = APP.me?.avatar_url || '';

  const projOut = byId('profileProjects');
  if(projOut){
    projOut.innerHTML = '<div class="muted">Loading…</div>';
    const cards = await listMyProjects();
    projOut.innerHTML = renderProjectCards(cards);
    bindProjectOpen(projOut);
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
      location.hash = '#post';
    }
    await renderPost();
    return;
  }

  await ensureProfile();
  setAuthedUI();
  await refreshWallet();

  const hash = getHash();
  if(hash === 'home' || hash === 'post') await renderPost();
  else if(hash === 'create') await renderCreatePackage();
  else if(hash === 'projects') await renderProjectsPage();
  else if(hash === 'profile') await renderProfile();
  else location.hash = '#post';
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
    toast('Error: ' + String(e?.reason?.message || e?.reason || 'something broke'));
  });

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
      await route();
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
  on('homeRefresh','click', ()=>route());
  on('homeService','change', ()=>route());
  on('homeTier','change', ()=>route());
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
  window.addEventListener('hashchange', ()=>route());

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

  await route();
}

document.addEventListener('DOMContentLoaded', init);
