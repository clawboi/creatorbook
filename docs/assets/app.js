/* CreatorBook — app.js (UI synced to current index.html)
   Goal: no null-onclick crashes, simple UX:
   - Public Home feed without login
   - After login: Home / Create Project / Profile
   - Credits always visible (top right)
   - Create Project: pick package -> request date -> message -> project created
   - Profile: projects list + demo feed + settings
*/

/* ----------------------------- helpers ----------------------------- */
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const byId = (id) => document.getElementById(id);
const on = (id, evt, fn) => { const el = byId(id); if(el) el.addEventListener(evt, fn); return el; };
const esc = (s="") => String(s).replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));

function toast(msg){
  const t = byId("toast");
  if(!t) return;
  t.textContent = msg;
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


function authRedirectTo(){
  // Single source of truth for GitHub Pages nested path.
  // We ALWAYS want redirects to land at:
  //   https://clawboi.github.io/creatorbook/
  // This prevents the common "double folder" bug.
  const { origin, pathname } = location;
  const want = "/creatorbook/";
  // If we're already on the desired path (or deeper), return that base.
  if(pathname.includes(want)) return origin + want;
  return origin + want;
}

function pendingSignupKey(email){ return `cb_pending_signup_${String(email||'').toLowerCase()}`; }
function setPendingSignup(email, payload){
  if(!email) return;
  try{ localStorage.setItem(pendingSignupKey(email), JSON.stringify(payload||{})); }catch(_e){}
}
function getPendingSignup(email){
  if(!email) return null;
  try{ return JSON.parse(localStorage.getItem(pendingSignupKey(email))||'null'); }catch(_e){ return null; }
}
function clearPendingSignup(email){
  if(!email) return;
  try{ localStorage.removeItem(pendingSignupKey(email)); }catch(_e){}
}

// simple anti-spam cooldown for email actions (prevents “rate limit exceeded” spirals)
const COOLDOWNS = { authEmail: 0 };
function canEmailNow(){ return Date.now() >= (COOLDOWNS.authEmail||0); }
function setEmailCooldown(ms){ COOLDOWNS.authEmail = Date.now() + ms; }
function setBtnBusy(id, busy, label){
  const b = byId(id);
  if(!b) return;
  b.disabled = !!busy;
  if(label) b.textContent = label;
}

function hashParams(){
  const h = (location.hash || "").replace(/^#/, "");
  return new URLSearchParams(h);
}

function isRecoveryFlow(){
  return (hashParams().get("type") === "recovery");
}


function authArtifactsPresent(){
  const hp = hashParams();
  return hp.has("access_token") || hp.has("refresh_token") || hp.has("type") || hp.has("error") || hp.has("error_description");
}

function clearAuthArtifacts(toHash="home"){
  // Clear Supabase auth params from the URL hash so we don't get stuck in recovery/reset mode.
  // Keep routing hash (#home/#create/#profile).
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
  // We use hash-routing (#home/#create/#profile).
  // Supabase auth also returns tokens in the hash (#access_token=...).
  // If the hash looks like auth params, ignore it and treat as home.
  const hp = hashParams();
  if(hp.has("access_token") || hp.has("refresh_token") || hp.has("type") || hp.has("error")){
    return "home";
  }
  const raw = (location.hash || "#home").replace(/^#/, "").trim();
  // If someone lands on a weird hash with '=', it's not a route.
  if(raw.includes("=")) return "home";
  return raw || "home";
}


function showPage(pageId){
  $$(".page").forEach(p=>p.style.display = "none");
  const el = byId(pageId);
  if(el){ el.style.display = "block"; el.classList.add("show"); }
}

function setNavActive(hash){
  $$('nav.nav a[data-nav]').forEach(a=>{
    const on = (a.getAttribute('data-nav') === hash);
    a.classList.toggle('active', on);
  });
}

/* ----------------------------- state ----------------------------- */
const APP = {
  sb: null,
  session: null,
  user: null,
  me: null,          // profiles row
  wallet: null,      // credits_wallet row
  rolePicked: null,  // during auth modal
  chosen: { creator:null, package:null },
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


// Prevent infinite "Signing in…" / "Creating…" spinners if a request hangs.
function withTimeout(promise, ms = 15000, label = "Request"){
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms/1000}s. Open DevTools → Network to see what got stuck.`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

async function sbCall(promise, label, ms=15000){
  try{
    return await withTimeout(promise, ms, label);
  }catch(e){
    console.error(label + " failed:", e);
    toast(normalizeAuthError(e) + " (If this only works in Incognito, disable adblock/privacy extensions for this site.)");
    throw e;
  }
}

function pendingRoleKey(email){ return `cb_pending_role_${String(email||'').toLowerCase()}`; }
function setPendingRole(email, role){
  if(!email) return;
  try{ localStorage.setItem(pendingRoleKey(email), role); }catch(_e){}
}
function getPendingRole(email){
  if(!email) return null;
  try{ return localStorage.getItem(pendingRoleKey(email)) || null; }catch(_e){ return null; }
}
function clearPendingRole(email){
  if(!email) return;
  try{ localStorage.removeItem(pendingRoleKey(email)); }catch(_e){}
}

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

/* ----------------------------- auth storage reset ----------------------------- */
// If auth gets “stuck” (common during schema/auth changes), this nukes local auth tokens so you can sign in again.
function authStorageKeys(){
  const keys = [];
  try{
    const ref = (cfg().url || "").match(/https:\/\/([a-z0-9-]+)\.supabase\.co/i)?.[1] || "";
    // Supabase v2 default key: sb-<ref>-auth-token
    if(ref) keys.push(`sb-${ref}-auth-token`);
  }catch(_e){}
  // fallbacks seen in older builds
  keys.push("supabase.auth.token");
  return Array.from(new Set(keys));
}

function hardResetAuthStorage(){
  try{
    for(const k of authStorageKeys()){
      try{ localStorage.removeItem(k); }catch(_e){}
      try{ sessionStorage.removeItem(k); }catch(_e){}
    }
    // also clear any pending signup/role hints
    try{
      const rm = [];
      for(let i=0;i<localStorage.length;i++){
        const kk = localStorage.key(i);
        if(!kk) continue;
        if(kk.startsWith("cb_pending_signup_") || kk.startsWith("cb_pending_role_")) rm.push(kk);
      }
      rm.forEach(k=>{ try{ localStorage.removeItem(k);}catch(_e){} });
    }catch(_e){}
  }catch(_e){}
}

async function hardResetLogin(){
  try{
    if(APP.sb) await APP.sb.auth.signOut();
  }catch(_e){}
  hardResetAuthStorage();
  APP.session = null; APP.user = null; APP.me = null; APP.wallet = null;
  APP.rolePicked = null;
  clearAuthArtifacts("home");
  setAuthedUI();
  toast("Reset complete. Try signing in again.");
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

/* ----------------------------- auth + profile ----------------------------- */
async function ensureProfile(){
  if(!APP.sb || !APP.user) return;

  if(!APP.rolePicked){
    const pr = getPendingRole(APP.user.email);
    if(pr) APP.rolePicked = pr;
  }

  let prof = null;
  try{
    const r0 = await sbCall(
      APP.sb.from('profiles').select('*').eq('id', APP.user.id).maybeSingle(),
      "Profile load"
    );
    prof = r0?.data || null;
  }catch(_e){
    return;
  }

  if(!prof){
    const pending = getPendingSignup(APP.user.email) || {};
    const ins = {
      id: APP.user.id,
      role: (APP.rolePicked || 'client'),
      onboarded: false,
      approved: false,
      display_name: APP.user.email?.split("@")[0] || "User",
      city: "Los Angeles",
      bio: "",
      portfolio_url: "",
      resume_url: "",
      phone: (pending.phone || ""),
    };

    try{
      const r1 = await sbCall(
        APP.sb.from('profiles').insert(ins).select('*').single(),
        "Profile create"
      );
      prof = r1?.data || prof;
    }catch(_e){
      prof = prof || { id: APP.user.id, role: ins.role, display_name: ins.display_name, city: ins.city, onboarded:false, approved:false };
    }
  }else if(APP.rolePicked && prof.role !== APP.rolePicked){
    try{
      const r2 = await sbCall(
        APP.sb.from('profiles').update({ role: APP.rolePicked, onboarded: true }).eq('id', APP.user.id).select('*').single(),
        "Profile update"
      );
      prof = r2?.data || prof;
    }catch(_e){}
  }

  APP.me = prof;

  if(APP.user?.email) clearPendingRole(APP.user.email);
  if(APP.user?.email) clearPendingSignup(APP.user.email);

  let wal = null;
  try{
    const w0 = await sbCall(
      APP.sb.from('credits_wallet').select('*').eq('user_id', APP.user.id).maybeSingle(),
      "Wallet load"
    );
    wal = w0?.data || null;
  }catch(_e){
    APP.wallet = { user_id: APP.user.id, balance: 0 };
    return;
  }

  if(!wal){
    try{
      const w1 = await sbCall(
        APP.sb.from('credits_wallet').insert({ user_id: APP.user.id, balance: 0 }).select('*').single(),
        "Wallet create"
      );
      wal = w1?.data || wal;
    }catch(_e){
      wal = { user_id: APP.user.id, balance: 0 };
    }
  }

  APP.wallet = wal;
}


function setAuthedUI(){
  const authed = !!APP.user;
  document.body.classList.toggle('isAuthed', authed);

  $$(".authed").forEach(el=>{
    // Pages are controlled by showPage(); don't auto-show them here.
    if(el.classList.contains('page')){
      if(!authed) el.style.display = 'none';
      return;
    }
    if(!authed){
      el.style.display = 'none';
    }else{
      // let CSS control it
      el.style.display = '';
    }
  });

  const btnSignIn = byId("btnSignIn");
  if(btnSignIn) btnSignIn.style.display = authed ? "none" : "inline-flex";

  // menu wrapper should be visible when authed
  const pmw = byId("profileMenuWrap");
  if(pmw) pmw.style.display = authed ? "" : "none";
}

function openModal(id){ const m = byId(id); if(m) m.style.display = "grid"; }
function closeModal(id){ const m = byId(id); if(m) m.style.display = "none"; }

async function maybeOnboard(){
  // V1.4: no Artist vs Creator gate. Everyone can have a profile + packages.
  if(!APP.user || !APP.me) return;
  if(APP.me.onboarded) return;
  // silently mark onboarded so the UI never blocks
  try{
    const patch = { id: APP.user.id, onboarded:true };
    const { error } = await APP.sb.from('profiles').upsert(patch, { onConflict:'id' });
    if(!error) APP.me.onboarded = true;
  }catch(_e){}
}

async function completeOnboarding(_role){
  // legacy no-op (kept so old buttons don't crash if present somewhere)
  if(!APP.sb || !APP.user) return;
  try{
    const patch = { id: APP.user.id, onboarded:true };
    await APP.sb.from('profiles').upsert(patch, { onConflict:'id' });
  }catch(_e){}
}



function restoreAuthModalUI(){
  // Restore the normal auth UI if we previously entered recovery mode.
  const g = byId('authGoogle'); if(g) g.style.display = '';
  const loginBtn = byId('authLogin'); if(loginBtn) loginBtn.style.display = '';
  const signupBtn = byId('authSignup'); if(signupBtn) signupBtn.style.display = '';
  const magicBtn = byId('authMagic'); if(magicBtn) magicBtn.style.display = '';
  const forgotBtn = byId('authForgot'); if(forgotBtn) forgotBtn.style.display = '';
  const modeRow = document.querySelector('.authMode'); if(modeRow) modeRow.style.display = '';
  const setBtn = byId('authSetNewPass'); if(setBtn) setBtn.style.display = 'none';
  byId('authPass')?.setAttribute('autocomplete', APP.authMode==='signup' ? 'new-password' : 'current-password');
}
function authShow(){ /* deprecated */ }


/* ----------------------------- auth mode UX ----------------------------- */
APP.authMode = "login"; // login | signup

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

  // Make the intended action obvious by swapping button emphasis.
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


  // Role is chosen after login in the Get started modal.
  const rw = byId("authRoleWrap");
  if(rw) rw.style.display = "none";

  // Extra fields only for signup
  const pw2 = byId('authPass2Wrap');
  const ph = byId('authPhoneWrap');
  if(pw2) pw2.style.display = (APP.authMode==="signup") ? "" : "none";
  // Phone is optional later (Settings). Keep auth clean.
  if(ph) ph.style.display = "none";

  // Context hint
  const hint = byId("authHint");
  if(hint){
    hint.textContent = (APP.authMode==="signup")
      ? "Create your account with email + password. You’ll pick Artist/Creator right after you’re signed in."
      : "Sign in with your email + password (Google + magic link are optional).";
  }

  // bottom helper links
  const goS = byId('authGoSignup');
  const goL = byId('authGoLogin');
  if(goS) goS.style.display = (APP.authMode==='login') ? '' : 'none';
  if(goL) goL.style.display = (APP.authMode==='signup') ? '' : 'none';
}

function normalizeAuthError(err){
  const msg = err?.message || "Authentication error";
  const low = msg.toLowerCase();
  if(low.includes('rate limit')){
    return "Email rate limit exceeded. Wait ~2 minutes, then try again. Tip: password sign-in avoids email sends.";
  }
  if(low.includes('invalid login')) return "Wrong email or password.";
  return msg;
}
async function signInMagicLink(){
  if(!APP.sb) return toast("Supabase not configured");
  if(!canEmailNow()) return toast("Give it a minute before requesting another email.");
  const email = (byId("authEmail")?.value || "").trim();
  if(!email || !email.includes("@")) return toast("Enter a valid email");

  const redirectTo = authRedirectTo();

  setBtnBusy('authMagic', true, 'Sending…');
  const { error } = await APP.sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo }
  });

  setBtnBusy('authMagic', false, 'Magic link');
  setEmailCooldown(120_000);

  if(error) return toast(normalizeAuthError(error));
  toast("Magic link sent. Check your email.");
}


// ---------- GOOGLE SIGN IN ----------
async function signInWithGoogle(){
  if(!APP.sb) return toast("Supabase not configured");
  // Role is chosen after login via the onboarding modal.

  const redirectTo = authRedirectTo();

  const { error } = await APP.sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo }
  });

  if(error) toast(normalizeAuthError(error));
}

async function signInWithPassword(){
  if(!APP.sb) return toast("Supabase not configured");

  const ident = (byId("authEmail")?.value || "").trim();
  const password = (byId("authPass")?.value || "");

  // Supabase password auth is email-based. Username sign-in requires a server-side lookup.
  if(!ident) return toast("Enter your email");
  if(!ident.includes("@")) return toast("For now, sign in with your email (username sign-in comes next).");
  if(password.length < 6) return toast("Password must be at least 6 characters");

  setBtnBusy('authLogin', true, 'Signing in…');
  try{
    const res = await withTimeout(
      APP.sb.auth.signInWithPassword({ email: ident, password }),
      15000,
      'Sign in'
    );
    if(res?.error) return toast(normalizeAuthError(res.error));
    // onAuthStateChange will finish UI + close modal
  }catch(e){
    console.error(e);
    const msg = String(e?.message || e || '').toLowerCase();
    if(msg.includes('timed out')){
      try{ await hardResetLogin(); }catch(_e){}
      toast('Sign in got stuck. I reset your local session. Try again.');
    }else{
      toast(normalizeAuthError(e));
    }
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

  // Keep signup clean; role is chosen after login.
  setPendingSignup(email, {});

  const redirectTo = authRedirectTo();
  setBtnBusy('authSignup', true, 'Creating…');

  try{
    // 1) Create the auth user
    const { data, error } = await withTimeout(APP.sb.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo }
    }), 15000, 'Create account');
    if(error) return toast(normalizeAuthError(error));

    // If session is null, either email confirmation is required OR Supabase didn't hand us a session.
    // We'll attempt one auto sign-in; if that fails with "email not confirmed", we tell the user.
    if(!data?.session){
      const r2 = await withTimeout(
        APP.sb.auth.signInWithPassword({ email, password }),
        15000,
        'Auto sign-in'
      );
      if(r2?.error){
        const msg = String(r2.error.message || r2.error || '').toLowerCase();
        if(msg.includes('confirm') || msg.includes('verified') || msg.includes('not confirmed')){
          toast('Account created. Check your email to confirm, then sign in.');
          return;
        }
        return toast(normalizeAuthError(r2.error));
      }
    }

    // 3) Clear inputs; auth state listener will finish UI + open onboarding
    if(byId("authPass")) byId("authPass").value = "";
    if(byId("authPass2")) byId("authPass2").value = "";
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
  if(!canEmailNow()) return toast("Give it a minute before requesting another email.");

  const ident = (byId("authEmail")?.value || "").trim();
  if(!ident || !ident.includes("@")) return toast("Enter your email (password resets are sent to email).");

  const redirectTo = authRedirectTo();
  setBtnBusy('authForgot', true, 'Sending…');

  try{
    const { error } = await APP.sb.auth.resetPasswordForEmail(ident, { redirectTo });
    if(error) return toast(normalizeAuthError(error));
    toast("Password reset email sent. Open it to set a new password.");
    setEmailCooldown(120_000);
  }catch(e){
    console.error(e);
    toast(normalizeAuthError(e));
  }finally{
    setBtnBusy('authForgot', false, 'Forgot password');
  }
}

async function setNewPasswordFromRecovery(){
  if(!APP.sb) return toast("Supabase not configured");
  const password = (byId("authPass")?.value || "");
  if(password.length < 6) return toast("Password must be at least 6 characters");
  const { error } = await APP.sb.auth.updateUser({ password });
  if(error) return toast(error.message || "Could not set new password");
  toast("Password updated. You can sign in now.");
  restoreAuthModalUI();
  setAuthMode("login");
  clearAuthArtifacts("home");
  closeModal("authModal");
  await route();
}

async function signOut(){
  if(!APP.sb) return;

  // Prevent onAuthStateChange from racing us while we tear down auth.
  APP._booting = true;

  // Close UI instantly
  const pm = byId('profileMenu');
  if(pm) pm.style.display = 'none';
  try{ closeModal('authModal'); }catch(_e){}
  try{ closeModal('onboardModal'); }catch(_e){}
  try{ closeModal('creditsModal'); }catch(_e){}

  // Immediately flip UI to "signed out" (feel instant)
  APP.session = null;
  APP.user = null;
  APP.me = null;
  APP.wallet = null;
  APP.rolePicked = null;
  setAuthedUI();

  // 1) Ask Supabase to sign out
  try{
    await APP.sb.auth.signOut();
  }catch(e){
    console.warn("signOut error (continuing anyway):", e);
  }

  // 2) Nuke ANY Supabase auth token keys (more robust than guessing project ref)
  try{
    const kill = [];
    for(let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if(!k) continue;
      const lk = k.toLowerCase();
      // common Supabase auth token key patterns
      if(
        lk.includes('sb-') && lk.includes('-auth-token') ||
        lk.includes('supabase') && lk.includes('auth') && lk.includes('token') ||
        lk === 'supabase.auth.token'
      ){
        kill.push(k);
      }
    }
    kill.forEach(k => { try{ localStorage.removeItem(k); }catch(_e){} });

    // also clear sessionStorage versions just in case
    for(let i = 0; i < sessionStorage.length; i++){
      const k = sessionStorage.key(i);
      if(!k) continue;
      const lk = k.toLowerCase();
      if(
        lk.includes('sb-') && lk.includes('-auth-token') ||
        lk.includes('supabase') && lk.includes('auth') && lk.includes('token') ||
        lk === 'supabase.auth.token'
      ){
        try{ sessionStorage.removeItem(k); }catch(_e){}
      }
    }
  }catch(_e){}

  // 3) Re-check session from Supabase AFTER the wipe (should come back null)
  try{
    await sleep(50);
    await refreshSession();
  }catch(_e){}

  // 4) Final UI + route to public home
  APP.session = null;
  APP.user = null;
  APP.me = null;
  APP.wallet = null;
  APP.rolePicked = null;

  clearAuthArtifacts("home");
  location.hash = "#home";

  APP._booting = false;
  setAuthedUI();
  await route();

  toast("Signed out");
}
/* ----------------------------- data: home feed ----------------------------- */
async function fetchHomeFeed(){
  if(!APP.sb) return [];
  const service = byId("homeService")?.value || "any";
  const tier = byId("homeTier")?.value || "any";
  let q = APP.sb.from('creator_public').select('*').eq('approved', true);
  if(service !== "any") q = q.eq('service', service);
  if(tier !== "any") q = q.eq('tier', tier);
  const { data, error } = await q.order('rating_avg', { ascending:false }).limit(50);
  if(error){ toast(error.message); return []; }
  return data || [];
}

async function fetchCreatorPackages(creatorId){
  if(!APP.sb) return [];
  const { data, error } = await APP.sb.from('packages').select('*').eq('creator_id', creatorId).order('price_credits', { ascending:true });
  if(error){ toast(error.message); return []; }
  return data || [];
}

async function renderHome(){
  showPage("pageHome");
  setNavActive("home");

  const ha = byId('homeAuthedActions');
  if(ha) ha.style.display = APP.user ? '' : 'none';
  if(byId('homeCreditsBal')) byId('homeCreditsBal').textContent = moneyCredits(APP.wallet?.balance||0);

  const feedEl = byId("feed");
  const emptyEl = byId("feedEmpty");
  if(!feedEl) return;
  feedEl.innerHTML = '<div class="muted">Loading…</div>';
  const rows = await fetchHomeFeed();
  if(!rows.length){
    feedEl.innerHTML = "";
    if(emptyEl) emptyEl.style.display = "block";
    return;
  }
  if(emptyEl) emptyEl.style.display = "none";

  feedEl.innerHTML = rows.map(r=>{
    const stars = (Number(r.rating_avg||0)).toFixed(1);
    const cnt = Number(r.rating_count||0);
    return `
      <div class="card mini" data-creator="${esc(r.creator_id)}">
        <div class="cardTitle" style="margin-bottom:6px;">${esc(r.display_name)} <span class="muted">· ${esc(r.city||'Los Angeles')}</span></div>
        <div class="row" style="gap:8px; flex-wrap:wrap;">
          <div class="pill">${esc(r.service)} · ${esc(r.tier)}</div>
          <div class="pill">from <b>${moneyCredits(r.min_price_credits)}</b> credits</div>
          <div class="pill">⭐ ${stars} <span class="muted">(${cnt})</span></div>
        </div>
        <div class="row" style="margin-top:10px; justify-content:space-between;">
          <div class="muted">Tap to view profile</div>
          <button class="btn" data-view="${esc(r.creator_id)}" type="button">View</button>
        </div>
      </div>
    `;
  }).join("");

  // bind view buttons
  $$('button[data-view]', feedEl).forEach(btn=>{
    btn.add('click', async (e)=>{
      e.preventDefault();
      const id = btn.getAttribute('data-view');
      await openCreatorProfile(id);
    });
  });

  // public posts
  await renderPublicPosts();
}

async function fetchPublicPosts(sort='recent'){
  if(!APP.sb) return [];
  const q = APP.sb.from('posts_public').select('*');
  // Popular sorting can come later (likes). For now, both modes are recent.
  q.order('created_at', { ascending:false });
  const { data, error } = await q.limit(50);
  if(error){
    // If table/view not created yet, fail softly.
    console.warn('posts_public query failed', error);
    return [];
  }
  return data || [];
}

async function renderPublicPosts(){
  const out = byId('publicPosts');
  const empty = byId('publicPostsEmpty');
  if(!out) return;
  out.innerHTML = '<div class="muted">Loading…</div>';
  const sort = byId('postsSort')?.value || 'recent';
  const rows = await fetchPublicPosts(sort);
  if(!rows.length){
    out.innerHTML='';
    if(empty) empty.style.display='block';
    return;
  }
  if(empty) empty.style.display='none';
  out.innerHTML = rows.map(p=>`
    <div class="card mini">
      <div class="row" style="gap:10px; align-items:center; margin-bottom:8px;">
        <div class="miniAvatar" style="${p.avatar_url?`background-image:url('\${esc(p.avatar_url)}');`:''}">${esc((p.display_name||'U').slice(0,1).toUpperCase())}</div>
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

/* ----------------------------- creator profile (modal-ish) ----------------------------- */
function youtubeEmbed(url){
  if(!url) return "";
  const u = String(url).trim();
  // minimal parsing
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
          title="Creator highlight"
        ></iframe>
      </div>
    </div>
  `;
}

async function openCreatorProfile(creatorId){
  if(!APP.sb) return;

  // fetch creator profile (public read for approved creators)
  const { data: prof, error: e1 } = await APP.sb.from('profiles').select('*').eq('id', creatorId).maybeSingle();
  if(e1) return toast(e1.message);
  if(!prof) return toast("Creator not found");

  const pkgs = await fetchCreatorPackages(creatorId);
  // create a lightweight modal using creditsModal shell so we don't add new HTML
  const modal = byId("creditsModal");
  const sheet = modal?.querySelector('.sheet');
  if(!modal || !sheet) return;

  const isAuthedClient = !!APP.user && (APP.me?.role === 'client');

  sheet.innerHTML = `
    <div class="modalTitle">${esc(prof.display_name || 'Creator')}</div>
    <div class="muted">${esc(prof.city || 'Los Angeles')} · ${esc(prof.role || 'creator')}</div>
    ${prof.bio ? `<div class="card" style="margin-top:12px;"><div class="cardTitle">About</div><div class="muted">${esc(prof.bio)}</div></div>` : ''}
    ${youtubeEmbed(prof.portfolio_url)}
    <div class="card" style="margin-top:12px;">
      <div class="cardTitle">Packages</div>
      ${pkgs.length ? pkgs.map(p=>`
        <div class="row" style="justify-content:space-between; align-items:flex-start; gap:12px; margin:10px 0;">
          <div>
            <div style="font-weight:700">${esc(p.title)}</div>
            <div class="muted">${esc(p.service)} · ${esc(p.tier)} · ${p.delivery_days ? `${p.delivery_days} days` : ''}</div>
            <div class="muted">${esc(p.includes||'')}</div>
            ${p.addons ? `<div class="muted"><b>Add-ons:</b> ${esc(p.addons)}</div>` : ''}
          </div>
          <div style="text-align:right; min-width:120px;">
            <div class="pill big">${moneyCredits(p.price_credits)} credits</div>
            ${isAuthedClient ? `<button class="btn" data-book="${esc(p.id)}" style="margin-top:8px; width:100%">Book</button>` : `<div class="muted" style="margin-top:8px;">Sign in as Artist to book</div>`}
          </div>
        </div>
        <div style="height:1px; background:rgba(255,255,255,.08)"></div>
      `).join('') : `<div class="muted">No packages yet.</div>`}
    </div>

    <div class="row" style="margin-top:12px; justify-content:flex-end;">
      <button class="btn ghost" id="btnCloseCreator">Close</button>
    </div>
  `;
  openModal('creditsModal');
  on('btnCloseCreator','click',()=>closeModal('creditsModal'));
  // book buttons
  $$('button[data-book]', sheet).forEach(btn=>{
    btn.add('click', async ()=>{
      const pkgId = btn.getAttribute('data-book');
      const pkg = pkgs.find(x=>x.id === pkgId);
      if(!pkg) return;
      closeModal('creditsModal');
      location.hash = '#create';
      await route();
      // prefill create wizard
      if(byId('projService')) byId('projService').value = pkg.service;
      if(byId('projTier')) byId('projTier').value = pkg.tier;
      await findCreators();
      selectPackage(prof, pkg);
    });
  });
}

/* ----------------------------- creator dashboard ----------------------------- */
async function renderCreatorDashboard(){
  showPage('pageCreator');
  setNavActive('profile');
  // approval note
  const note = byId('creatorApprovalNote');
  if(note){
    note.textContent = APP.me?.approved ? 'You are approved and visible in the public feed.' : 'Pending approval: you can create packages, but you won\'t appear publicly until approved.';
  }
  // packages list
  const out = byId('creatorPackages');
  if(out){
    out.innerHTML = '<div class="muted">Loading…</div>';
    const pkgs = await myPackages();
    out.innerHTML = pkgs.length ? pkgs.map(p=>`
      <div class="card mini">
        <div class="cardTitle">${esc(p.title)}</div>
        <div class="muted">${esc(p.service)} · ${esc(p.tier)} · <b>${moneyCredits(p.price_credits)}</b> credits</div>
        <div class="muted">${esc(p.includes||'')}</div>
        <div class="row" style="margin-top:10px; justify-content:flex-end;">
          <button class="btn ghost" data-editpkg="${esc(p.id)}" type="button">Edit</button>
        </div>
      </div>
    `).join('') : `<div class="muted">No packages yet.</div>`;

    $$('button[data-editpkg]', out).forEach(btn=>{
      btn.add('click', ()=>{
        const id = btn.getAttribute('data-editpkg');
        const p = pkgs.find(x=>x.id === id);
        if(!p) return;
        byId('pkgService').value = p.service;
        byId('pkgTier').value = p.tier;
        byId('pkgTitle').value = p.title;
        byId('pkgPrice').value = p.price_credits;
        byId('pkgDelivery').value = p.delivery_days || '';
        byId('pkgHours').value = p.hours || '';
        byId('pkgLocations').value = p.locations || '';
        byId('pkgRevisions').value = p.revisions || '';
        byId('pkgIncludes').value = p.includes || '';
        byId('pkgAddons').value = p.addons || '';
        byId('btnSavePkg').dataset.editing = p.id;
        toast('Loaded package into editor');
      });
    });
  }

  // incoming projects
  const inEl = byId('creatorProjects');
  if(inEl){
    inEl.innerHTML = '<div class="muted">Loading…</div>';
    const cards = await listMyProjects();
    inEl.innerHTML = renderProjectCards(cards);
    bindProjectOpen(inEl);
  }
}

async function myPackages(){
  if(!APP.sb || !APP.user) return [];
  const { data, error } = await APP.sb.from('packages').select('*').eq('creator_id', APP.user.id).order('created_at',{ascending:false});
  if(error){ toast(error.message); return []; }
  return data || [];
}

async function savePackage(){
  if(!APP.sb || !APP.user) return toast('Sign in first');
  if(APP.me?.role !== 'creator') return toast('Switch role to Creator in Settings');

  const payload = {
    creator_id: APP.user.id,
    service: byId('pkgService')?.value || 'music_video',
    tier: byId('pkgTier')?.value || 'bronze',
    title: (byId('pkgTitle')?.value || '').trim() || 'Package',
    price_credits: Number(byId('pkgPrice')?.value || 0),
    delivery_days: byId('pkgDelivery')?.value ? Number(byId('pkgDelivery').value) : null,
    hours: (byId('pkgHours')?.value || '').trim(),
    locations: (byId('pkgLocations')?.value || '').trim(),
    revisions: (byId('pkgRevisions')?.value || '').trim(),
    includes: (byId('pkgIncludes')?.value || '').trim(),
    addons: (byId('pkgAddons')?.value || '').trim(),
  };
  if(!payload.price_credits || payload.price_credits < 0) return toast('Enter a price');

  const editing = byId('btnSavePkg')?.dataset.editing;
  let r;
  if(editing){
    r = await APP.sb.from('packages').update(payload).eq('id', editing).select('*').single();
  } else {
    r = await APP.sb.from('packages').insert(payload).select('*').single();
  }
  if(r.error) return toast(r.error.message);
  byId('btnSavePkg').dataset.editing = '';
  toast(editing ? 'Package updated' : 'Package created');
  await renderCreatorDashboard();
}

/* ----------------------------- create project ----------------------------- */
async function renderCreateProject(){
  showPage('pageCreateProject');
  setNavActive('create');
  // reset request box
  if(byId('requestBox')) byId('requestBox').style.display = 'none';
  if(byId('creatorResults')) byId('creatorResults').innerHTML = '';
  if(byId('creatorResultsEmpty')) byId('creatorResultsEmpty').style.display = 'none';
}

async function findCreators(){
  if(!APP.sb) return;
  const service = byId('projService')?.value || 'music_video';
  const tier = byId('projTier')?.value || 'bronze';

  const out = byId('creatorResults');
  const empty = byId('creatorResultsEmpty');
  if(out) out.innerHTML = '<div class="muted">Searching…</div>';

  // find packages that match, only approved creators
  const { data, error } = await APP.sb
    .from('packages')
    .select('*, profiles:creator_id (id, display_name, city, bio, portfolio_url, approved, role)')
    .eq('service', service)
    .eq('tier', tier)
    .order('price_credits', { ascending:true })
    .limit(60);
  if(error){ toast(error.message); return; }

  const rows = (data || []).filter(p => p.profiles?.approved === true && p.profiles?.role === 'creator');
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

  // bind
  $$('button[data-view]', out).forEach(btn=>btn.add('click', async ()=>{
    await openCreatorProfile(btn.getAttribute('data-view'));
  }));
  $$('button[data-select]', out).forEach(btn=>btn.add('click', ()=>{
    const pkgId = btn.getAttribute('data-select');
    const pkg = rows.find(x=>x.id === pkgId);
    if(!pkg) return;
    selectPackage(pkg.profiles, pkg);
  }));
}

function selectPackage(creatorProfile, pkg){
  APP.chosen.creator = creatorProfile;
  APP.chosen.package = pkg;
  if(byId('requestBox')) byId('requestBox').style.display = 'block';
  if(byId('chosenCreator')) byId('chosenCreator').textContent = creatorProfile.display_name;
  if(byId('chosenPackage')) byId('chosenPackage').textContent = pkg.title;
  if(byId('chosenPrice')) byId('chosenPrice').textContent = moneyCredits(pkg.price_credits) + ' credits';
}

async function sendRequest(){
  if(!APP.sb || !APP.user) return toast('Sign in first');
  if(APP.me?.role !== 'client') return toast('Switch role to Artist in Settings to book');
  const pkg = APP.chosen.package;
  const creator = APP.chosen.creator;
  if(!pkg || !creator) return toast('Select a package first');

  const reqDate = byId('reqDate')?.value || '';
  const notes = (byId('reqMsg')?.value || '').trim();
  const requested_date = reqDate ? new Date(reqDate).toISOString() : null;
  const total_credits = Number(pkg.price_credits || 0);

  // create booking
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

  // booking line
  const lRes = await APP.sb.from('booking_creators').insert({
    booking_id: booking.id,
    creator_id: creator.id,
    package_id: pkg.id,
    price_credits: total_credits,
  });
  if(lRes.error) return toast(lRes.error.message);

  toast('Request sent. It’s now in your Projects.');
  // reset
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
  const role = APP.me?.role || 'client';
  if(role === 'creator'){
    const { data, error } = await APP.sb
      .from('booking_card_creator')
      .select('*')
      .eq('creator_id', APP.user.id)
      .order('created_at', { ascending:false })
      .limit(100);
    if(error){ toast(error.message); return []; }
    return data || [];
  }
  const { data, error } = await APP.sb
    .from('booking_card_client')
    .select('*')
    .eq('client_id', APP.user.id)
    .order('created_at', { ascending:false })
    .limit(100);
  if(error){ toast(error.message); return []; }
  return data || [];
}

function renderProjectCards(rows){
  if(!rows.length) return `<div class="muted">No projects yet.</div>`;
  return rows.map(r=>`
    <div class="card mini" data-proj="${esc(r.id)}">
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
    btn.add('click', async ()=>{
      const id = btn.getAttribute('data-open');
      await openProject(id);
    });
  });
}

async function openProject(projectId){
  if(!APP.sb) return;
  // basic booking
  const { data: booking, error } = await APP.sb.from('bookings').select('*').eq('id', projectId).maybeSingle();
  if(error) return toast(error.message);
  if(!booking) return toast('Project not found');

  // line
  const { data: lines } = await APP.sb.from('booking_lines').select('*').eq('booking_id', projectId);
  const line = (lines||[])[0];

  // messages
  const { data: msgs } = await APP.sb.from('messages').select('*').eq('booking_id', projectId).order('created_at', { ascending:true }).limit(200);
  // deliveries
  const { data: dels } = await APP.sb.from('deliveries').select('*').eq('booking_id', projectId).order('created_at', { ascending:false }).limit(50);

  const modal = byId('creditsModal');
  const sheet = modal?.querySelector('.sheet');
  if(!modal || !sheet) return;

  const canCreatorUpdate = (APP.me?.role === 'creator');
  const canClientApprove = (APP.me?.role === 'client');

  sheet.innerHTML = `
    <div class="modalTitle">Project</div>
    <div class="muted">${esc(line?.creator_name || '')} · ${esc(line?.service || '')} · ${esc(line?.tier || '')} · <b>${moneyCredits(booking.total_credits||0)}</b> credits</div>

    <div class="card" style="margin-top:12px;">
      <div class="cardTitle">Checklist</div>
      <ol class="steps" style="margin:8px 0 0;">
        <li><b>Pre-production</b> (confirm date, location, shot list)</li>
        <li><b>Shoot day</b> (capture footage / photos)</li>
        <li><b>Post-production</b> (edit, revisions)</li>
        <li><b>Delivery</b> (links + files)</li>
      </ol>
      <div class="row" style="margin-top:10px; justify-content:space-between;">
        <div class="pill">Status: ${esc(statusLabel(booking.status))}</div>
        <div class="pill">Requested: ${fmtDateTime(booking.requested_date) || '—'}</div>
      </div>
      <div class="row" style="margin-top:10px; gap:8px; flex-wrap:wrap;">
        ${canCreatorUpdate ? `
          <button class="btn" id="btnMarkInProgress" type="button">Mark in progress</button>
          <button class="btn" id="btnMarkDelivered" type="button">Mark delivered</button>
        ` : ''}
        ${canClientApprove ? `
          <button class="btn" id="btnMarkApproved" type="button">Approve & release</button>
        ` : ''}
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
      ${canCreatorUpdate ? `
        <div class="row" style="margin-top:10px;">
          <input id="delLink" placeholder="Delivery link (Drive/Dropbox)" />
          <button class="btn" id="btnAddDel" type="button">Add</button>
        </div>
      ` : ''}
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
    await openProject(projectId); // re-render modal
  });

  if(canCreatorUpdate){
    on('btnMarkInProgress','click', async ()=>{
      const r = await APP.sb.from('bookings').update({ status:'in_progress' }).eq('id', projectId);
      if(r.error) return toast(r.error.message);
      toast('Updated');
      await openProject(projectId);
    });
    on('btnMarkDelivered','click', async ()=>{
      const r = await APP.sb.from('bookings').update({ status:'delivered', delivered_at: new Date().toISOString() }).eq('id', projectId);
      if(r.error) return toast(r.error.message);
      toast('Marked delivered');
      await openProject(projectId);
    });
    on('btnAddDel','click', async ()=>{
      const link = (byId('delLink')?.value || '').trim();
      if(!link) return;
      const r = await APP.sb.from('deliveries').insert({ booking_id: projectId, link, note:'' });
      if(r.error) return toast(r.error.message);
      byId('delLink').value = '';
      toast('Delivery added');
      await openProject(projectId);
    });
  }
  if(canClientApprove){
    on('btnMarkApproved','click', async ()=>{
      const r = await APP.sb.from('bookings').update({ status:'approved', approved_at: new Date().toISOString() }).eq('id', projectId);
      if(r.error) return toast(r.error.message);
      toast('Approved');
      await openProject(projectId);
    });
  }
}

/* ----------------------------- credits ----------------------------- */
async function refreshWallet(){
  if(!APP.sb || !APP.user) return;
  const { data } = await APP.sb.from('credits_wallet').select('*').eq('user_id', APP.user.id).maybeSingle();
  if(data) APP.wallet = data;
  setAuthedUI();
  // profile header balance
  if(byId('profileCredits')) byId('profileCredits').textContent = moneyCredits(APP.wallet?.balance||0);
}

async function addDemoCredits(amount){
  if(!APP.sb || !APP.user) return toast('Sign in first');
  const add = Number(amount||0);
  if(!add || add <= 0) return toast('Enter an amount');

  const cur = Number(APP.wallet?.balance || 0);
  const next = cur + add;
  const r = await APP.sb.from('credits_wallet').update({ balance: next, updated_at: new Date().toISOString() }).eq('user_id', APP.user.id);
  if(r.error) return toast(r.error.message);

  // log tx if table exists
  try{
    await APP.sb.from('credits_tx').insert({ user_id: APP.user.id, kind:'demo_topup', amount: add, note:'demo' });
  }catch(_e){}

  toast('Credits added');
  await refreshWallet();
}

function openCredits(){
  const modal = byId('creditsModal');
  const sheet = modal?.querySelector('.sheet');
  if(!modal || !sheet) return;
  // restore the original credits modal content
  sheet.innerHTML = `
    <div class="modalTitle">Credits</div>
    <div class="muted" style="margin-bottom:10px;">For now this is demo top-up. Later we wire Stripe to buy credits.</div>
    <div class="row">
      <input id="demoCreditsModal" type="number" min="0" step="1" placeholder="500" />
      <button class="btn" id="btnAddDemoCreditsModal">Add</button>
    </div>
    <div class="muted" style="margin-top:10px;">Balance: <b><span id="walletBalModal">${moneyCredits(APP.wallet?.balance||0)}</span></b> credits</div>
    <div class="row" style="margin-top:12px; justify-content:flex-end;">
      <button class="btn ghost" id="btnCloseCredits">Close</button>
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

/* ----------------------------- profile: tabs + settings + demo feed ----------------------------- */
function setTab(which){
  const map = {
    projects: ['tabProjects','panelProjects'],
    feed: ['tabFeed','panelFeed'],
    settings: ['tabSettings','panelSettings'],
  };
  Object.entries(map).forEach(([k,[bid,pid]])=>{
    byId(bid)?.classList.toggle('active', k===which);
    byId(pid).style.display = (k===which) ? 'block' : 'none';
  });
}

async function fetchMyPosts(){
  if(!APP.sb || !APP.user) return [];
  const { data, error } = await APP.sb
    .from('posts')
    .select('*')
    .eq('user_id', APP.user.id)
    .order('created_at', { ascending:false })
    .limit(50);
  if(error){
    console.warn('posts query failed', error);
    return [];
  }
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

async function renderProfile(){
  showPage('pageProfile');
  setNavActive('profile');

  const name = APP.me?.display_name || 'User';
  const role = APP.me?.role || 'client';
  const city = APP.me?.city || 'Los Angeles';
  const bal = moneyCredits(APP.wallet?.balance||0);
  if(byId('profileName')) byId('profileName').textContent = name;
  if(byId('profileRole')) byId('profileRole').textContent = role;
  if(byId('profileCity')) byId('profileCity').textContent = city;
  if(byId('profileAvatar')){
    const av = (APP.me?.avatar_url || '').trim();
    const el = byId('profileAvatar');
    el.textContent = (name||'U').slice(0,1).toUpperCase();
    if(av){ el.style.backgroundImage = `url('${av.replace(/'/g,"%27")}')`; el.classList.add('hasImg'); }
    else { el.style.backgroundImage=''; el.classList.remove('hasImg'); }
  }
  if(byId('profileCredits')) byId('profileCredits').textContent = bal;

  // mirror settings into inline form
  const m = APP.me || {};
  if(byId('setRole2')) byId('setRole2').value = m.role || 'client';
  if(byId('setName2')) byId('setName2').value = m.display_name || '';
  if(byId('setCity2')) byId('setCity2').value = m.city || 'Los Angeles';
  if(byId('setBio2')) byId('setBio2').value = m.bio || '';
  if(byId('setPortfolio2')) byId('setPortfolio2').value = m.portfolio_url || '';
  if(byId('setResume2')) byId('setResume2').value = m.resume_url || '';
  if(byId('setAvatar2')) byId('setAvatar2').value = m.avatar_url || '';

  // projects list
  const projOut = byId('profileProjects');
  if(projOut){
    projOut.innerHTML = '<div class="muted">Loading…</div>';
    const cards = await listMyProjects();
    projOut.innerHTML = renderProjectCards(cards);
    bindProjectOpen(projOut);
  }
  // feed
  await renderMyFeed();
  setTab('projects');
}

async function saveSettingsInline(){
  if(!APP.sb || !APP.user) return toast('Sign in first');
  const patch = {
    role: byId('setRole2')?.value || 'client',
    display_name: (byId('setName2')?.value || '').trim() || 'User',
    city: (byId('setCity2')?.value || '').trim() || 'Los Angeles',
    bio: (byId('setBio2')?.value || '').trim(),
    portfolio_url: (byId('setPortfolio2')?.value || '').trim(),
    resume_url: (byId('setResume2')?.value || '').trim(),
    avatar_url: (byId('setAvatar2')?.value || '').trim(),
  };
  const r = await APP.sb.from('profiles').update(patch).eq('id', APP.user.id).select('*').single();
  if(r.error) return toast(r.error.message);
  APP.me = r.data;
  setAuthedUI();
  toast('Saved');
  await route();
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
    // Soft clear: delete your posts (only your own by RLS)
    const r = await APP.sb.from('posts').delete().eq('user_id', APP.user.id);
    if(r.error) return toast(r.error.message);
    await renderMyFeed();
    await renderPublicPosts();
    toast('Cleared');
  });
}

/* ----------------------------- routing ----------------------------- */
async function route(){
  initSupabase();
  if(!APP.sb){
    console.warn('Supabase not ready. Check config.js and script order.');
    try{ toast('Config missing: check config.js (Supabase URL + anon key)'); }catch(_e){}
  }

  await refreshSession();

  if(!APP.user){
    // public mode
    setAuthedUI();

    const hash = getHash();
    if(hash === 'create' || hash === 'profile'){
      // user tried to access an authed page: open auth and remember intent
      setPostLoginHash('#' + hash);
      openModal('authModal');
      setAuthMode('login');
      location.hash = '#home';
    }

    await renderHome();
    return;
  }

  await ensureProfile();
  await maybeOnboard();
  setAuthedUI();
  await refreshWallet();

  const hash = getHash();
  if(hash === 'home') await renderHome();
  else if(hash === 'create') await renderCreateProject();
  else if(hash === 'profile'){
    // For creators, keep the creator dashboard available, but default to Profile page.
    await renderProfile();
  }
  else {
    location.hash = '#home';
  }
}

/* ----------------------------- init bindings ----------------------------- */
async function init(){
  // If something breaks, surface it (prevents “nothing is clickable” mystery states)
  window.add('error', (e)=>{
    console.error(e?.error || e);
    try{ toast('Error: ' + String(e?.message || 'something broke')); }catch(_e){}
  });
  window.add('unhandledrejection', (e)=>{
    console.error(e?.reason || e);
    try{ toast('Error: ' + String(e?.reason?.message || e?.reason || 'something broke')); }catch(_e){}
  });

  initSupabase();
  // If Supabase returned an error in the URL hash (e.g., otp_expired), show it and clear.
  handleAuthHashErrors();
  if(APP.sb){
    APP.sb.auth.onAuthStateChange(async (event, session)=>{
      // During initial boot restore we ignore auth events to prevent UI fights.
      if(APP._booting){ return; }

      await refreshSession();
      if(APP.user){
        await ensureProfile();
        setAuthedUI();
        await refreshWallet();
        await maybeOnboard();

        const intended = popPostLoginHash();
        if(intended){
          location.hash = intended;
          await route();
        } else {
          // if user just logged in, send them to home
          if(getHash() === 'home') await renderHome();
          else await route();
        }
        closeModal('authModal');
        if(authArtifactsPresent()) clearAuthArtifacts(getHash());
      } else {
        setAuthedUI();
        await route();
      }
    });
  }

  // topbar menu
  on('btnProfile','click',()=>{
    const m = byId('profileMenu');
    if(!m) return;
    m.style.display = (m.style.display === 'block') ? 'none' : 'block';
  });
  document.add('click',(e)=>{
    const mw = byId('profileMenuWrap');
    const m = byId('profileMenu');
    if(!mw || !m) return;
    if(!mw.contains(e.target)) m.style.display = 'none';
  });

  on('menuSignOut','click', signOut);
  on('btnCreditsTop','click', openCredits);
  on('btnBuyCredits','click', openCredits);
  on('creditsPill','click', openCredits);

  // Auth modal open/close
  on('btnSignIn','click',()=>{
    if(!initSupabase()) toast('Setup needed: add your Supabase URL + anon key in config.js');
    openModal('authModal');
    setAuthMode('login');
  });
  on('authClose','click',()=>{
    closeModal('authModal');
    // Escape recovery/reset mode if user closes the modal
    if(authArtifactsPresent()){
      // Restore auth buttons that may have been hidden
      restoreAuthModalUI();
      clearAuthArtifacts('home');
    }
  });

  // Auth mode toggle
  on('authModeLogin','click',()=>setAuthMode('login'));
  on('authModeSignup','click',()=>setAuthMode('signup'));
  on('authGoSignup','click',()=>setAuthMode('signup'));
  on('authGoLogin','click',()=>setAuthMode('login'));

  // Auth actions
  setAuthMode('login');
  on('authGoogle','click', signInWithGoogle);
  on('authLogin','click', signInWithPassword);
  on('authSignup','click', signUpWithPassword);
  on('authMagic','click', signInMagicLink);
  on('authForgot','click', forgotPassword);
  on('authSetNewPass','click', setNewPasswordFromRecovery);

  // Onboarding modal
  on('onboardClose','click',()=>closeModal('onboardModal'));
  on('btnPickArtist','click',()=>completeOnboarding('client'));
  on('btnPickCreator','click',()=>completeOnboarding('creator'));


  // If user opened a Supabase recovery link (type=recovery), show a focused reset UI.
  if(isRecoveryFlow()){
    openModal('authModal');
    // Hide normal auth actions, show reset button
    const g = byId('authGoogle'); if(g) g.style.display = 'none';
    const loginBtn = byId('authLogin'); if(loginBtn) loginBtn.style.display = 'none';
    const signupBtn = byId('authSignup'); if(signupBtn) signupBtn.style.display = 'none';
    const magicBtn = byId('authMagic'); if(magicBtn) magicBtn.style.display = 'none';
    const forgotBtn = byId('authForgot'); if(forgotBtn) forgotBtn.style.display = 'none';
    const modeRow = document.querySelector('.authMode'); if(modeRow) modeRow.style.display = 'none';
    const help = byId('authModeHelp'); if(help) help.textContent = 'Set a new password to finish resetting your account.';
    const hint = byId('authHint'); if(hint) hint.textContent = 'Choose a new password (6+ characters), then tap Set new password.';
    const setBtn = byId('authSetNewPass'); if(setBtn) setBtn.style.display = '';
    const pass = byId('authPass'); if(pass){ pass.value=''; pass.setAttribute('autocomplete','new-password'); pass.focus(); }
  }

// Home filters
  on('homeRefresh','click', route);
  on('homeService','change', route);
  on('homeTier','change', route);
  on('postsSort','change', ()=>renderPublicPosts());

  // Home tabs: default to Community
  function setHomeTab(which){
    const p = byId('homePostsWrap');
    const k = byId('homePackagesWrap');
    const bP = byId('homeTabPosts');
    const bK = byId('homeTabPackages');
    if(p) p.style.display = (which==='posts') ? '' : 'none';
    if(k) k.style.display = (which==='packages') ? '' : 'none';
    if(bP) bP.classList.toggle('active', which==='posts');
    if(bK) bK.classList.toggle('active', which==='packages');
    // Lazy-load packages when user switches over
    if(which==='packages') route();
    else renderPublicPosts();
  }
  on('homeTabPosts','click', ()=>setHomeTab('posts'));
  on('homeTabPackages','click', ()=>setHomeTab('packages'));
  setHomeTab('posts');

  // Create flow
  on('btnFindCreators','click', findCreators);
  on('btnSendRequest','click', sendRequest);
  on('btnCancelRequest','click', ()=>{
    if(byId('requestBox')) byId('requestBox').style.display = 'none';
    APP.chosen.creator = null; APP.chosen.package = null;
  });

  // Creator package save
  on('btnSavePkg','click', savePackage);

  // Profile tabs + settings + feed
  bindProfileTabs();
  bindFeedComposer();
  on('btnSaveSettings2','click', saveSettingsInline);

  // Demo credits buttons (legacy)
  on('btnDemoCredits','click', async ()=>{
    const amt = Number(byId('demoCredits')?.value || 0);
    await addDemoCredits(amt);
  });

  // Credits modal close (legacy element exists in HTML)
  on('btnCloseCredits','click',()=>closeModal('creditsModal'));

  // hash routing
  window.add('hashchange', route);

  // Home quick actions
  const goCreate = ()=>{
    if(APP.user){ location.hash = '#create'; return; }
    setPostLoginHash('#create');
    openModal('authModal');
    setAuthMode('login');
  };

  if(byId('homeCreateBtn')) byId('homeCreateBtn').addEventListener('click', goCreate);
  if(byId('homeCreditsBtn')) byId('homeCreditsBtn').addEventListener('click', ()=>{ openCreditsModal?.(); });

  // Public hero CTAs (visible even when logged out)
  const hcc = byId('homeCtaCreate');
  if(hcc) hcc.addEventListener('click', goCreate);
  const hsi = byId('homeCtaSignIn');
  if(hsi) hsi.addEventListener('click', ()=>{ openModal('authModal'); setAuthMode('login'); });

  if(hsi) hsi.addEventListener('click', ()=>{
    openModal('authModal');
    setAuthMode('login');
  });

  // --- BOOT SESSION RESTORE (fix refresh “kicks me out” / session out-of-sync) ---
  // Do ONE explicit getSession before routing, then let onAuthStateChange handle future changes.
  APP._booting = true;
  try{
    await refreshSession();
    if(APP.user){
      await ensureProfile();
      setAuthedUI();
      await refreshWallet();
      await maybeOnboard();
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
