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
  // Force the deployed GitHub Pages path you’re using right now.
  // This prevents Supabase from redirecting to /creatorbook/ (404) instead of /creatorbook/creatorbook/.
  const forced = location.origin + "/creatorbook/creatorbook/";
  return forced;
}

function hashParams(){
  const h = (location.hash || "").replace(/^#/, "");
  return new URLSearchParams(h);
}

function isRecoveryFlow(){
  return (hashParams().get("type") === "recovery");
}

function getHash(){
  const h = (location.hash || "#home").replace(/^#/, "").trim();
  return h || "home";
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

/* ----------------------------- auth + profile ----------------------------- */
async function ensureProfile(){
  if(!APP.sb || !APP.user) return;

  // profiles upsert
  const base = {
    id: APP.user.id,
    role: APP.rolePicked || undefined,
    display_name: APP.user.email?.split("@")[0] || "User",
    city: "Los Angeles",
    bio: "",
    portfolio_url: "",
    resume_url: "",
  };

  // try select first
  let { data: prof } = await APP.sb.from('profiles').select('*').eq('id', APP.user.id).maybeSingle();
  if(!prof){
    // insert
    const ins = {
      id: base.id,
      role: (APP.rolePicked || 'client'),
      display_name: base.display_name,
      city: base.city,
      bio: base.bio,
      portfolio_url: base.portfolio_url,
      resume_url: base.resume_url,
    };
    const r = await APP.sb.from('profiles').insert(ins).select('*').single();
    prof = r.data || null;
  } else if(APP.rolePicked && prof.role !== APP.rolePicked){
    // update role if user picked during onboarding
    const r = await APP.sb.from('profiles').update({ role: APP.rolePicked }).eq('id', APP.user.id).select('*').single();
    prof = r.data || prof;
  }
  APP.me = prof;

  // wallet upsert
  let { data: wal } = await APP.sb.from('credits_wallet').select('*').eq('user_id', APP.user.id).maybeSingle();
  if(!wal){
    const r = await APP.sb.from('credits_wallet').insert({ user_id: APP.user.id, balance: 0 }).select('*').single();
    wal = r.data || null;
  }
  APP.wallet = wal;
}

function setAuthedUI(){
  const authed = !!APP.user;
  $$(".authed").forEach(el=>{
    // IMPORTANT: pages are controlled by showPage(); don't auto-show them here.
    if(el.classList.contains('page')){
      if(!authed) el.style.display = 'none';
      return;
    }
    el.style.display = authed ? "" : "none";
  });
  const btnSignIn = byId("btnSignIn");
  if(btnSignIn) btnSignIn.style.display = authed ? "none" : "";

  const menuWrap = byId("profileMenuWrap");
  if(menuWrap) menuWrap.style.display = authed ? "" : "none";

  const who = byId("whoPill");
  const creditsPill = byId("creditsPill");
  if(who) who.style.display = authed ? "" : "none";
  if(creditsPill) creditsPill.style.display = authed ? "" : "none";

  if(authed){
    const name = APP.me?.display_name || "User";
    const role = APP.me?.role || "client";
    if(byId("whoName")) byId("whoName").textContent = name;
    if(byId("whoRole")) byId("whoRole").textContent = role;
    const bal = moneyCredits(APP.wallet?.balance || 0);
    if(byId("creditsBalTop")) byId("creditsBalTop").textContent = bal;
  }
}

function openModal(id){ const m = byId(id); if(m) m.style.display = "grid"; }
function closeModal(id){ const m = byId(id); if(m) m.style.display = "none"; }

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

  // Context hint
  const hint = byId("authHint");
  if(hint){
    hint.textContent = (APP.authMode==="signup")
      ? "Create your account. If email confirmation is enabled, you’ll need to confirm via email before signing in."
      : "Sign in with your email + password, Google, or a magic link.";
  }
}
async function signInMagicLink(){
  if(!APP.sb) return toast("Supabase not configured");
  const email = (byId("authEmail")?.value || "").trim();
  if(!email || !email.includes("@")) return toast("Enter a valid email");

  const redirectTo = authRedirectTo();

  const { error } = await APP.sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo }
  });

  if(error) return toast(error.message || "Could not send link");
  toast("Magic link sent. Check your email.");
}


// ---------- GOOGLE SIGN IN ----------
async function signInWithGoogle(){
  if(!APP.sb) return toast("Supabase not configured");

  const redirectTo = authRedirectTo();

  const { error } = await APP.sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo }
  });

  if(error) toast(error.message || "Google sign-in failed");
}

async function signInWithPassword(){
  if(!APP.sb) return toast("Supabase not configured");
  const email = (byId("authEmail")?.value || "").trim();
  const password = (byId("authPass")?.value || "");
  if(!email || !email.includes("@")) return toast("Enter a valid email");
  if(password.length < 6) return toast("Password must be at least 6 characters");

  const { error } = await APP.sb.auth.signInWithPassword({ email, password });
  if(error) return toast(error.message || "Login failed");
  // auth state listener will handle UI
}

async function signUpWithPassword(){
  if(!APP.sb) return toast("Supabase not configured");
  const email = (byId("authEmail")?.value || "").trim();
  const password = (byId("authPass")?.value || "");
  if(!email || !email.includes("@")) return toast("Enter a valid email");
  if(password.length < 6) return toast("Password must be at least 6 characters");

  const redirectTo = authRedirectTo();
  const { data, error } = await APP.sb.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: redirectTo }
  });
  if(error) return toast(error.message || "Could not create account");
  if(!data?.session){
    toast("Account created. Now confirm your email, then sign in.");
    setAuthMode("login");
    if(byId("authPass")) byId("authPass").value = "";
  } else {
    toast("Account created. You\'re signed in.");
  }
}


async function forgotPassword(){
  if(!APP.sb) return toast("Supabase not configured");
  const email = (byId("authEmail")?.value || "").trim();
  if(!email || !email.includes("@")) return toast("Enter your email first");
  const redirectTo = authRedirectTo();
  const { error } = await APP.sb.auth.resetPasswordForEmail(email, { redirectTo });
  if(error) return toast(error.message || "Could not send reset email");
  toast("Password reset email sent. Open it to set a new password.");
}

async function setNewPasswordFromRecovery(){
  if(!APP.sb) return toast("Supabase not configured");
  const password = (byId("authPass")?.value || "");
  if(password.length < 6) return toast("Password must be at least 6 characters");
  const { error } = await APP.sb.auth.updateUser({ password });
  if(error) return toast(error.message || "Could not set new password");
  toast("Password updated. You can sign in now.");
  // Clean the recovery hash so we don’t keep showing the reset UI.
  location.hash = "#home";
  closeModal("authModal");
  await route();
}

async function signOut(){
  if(!APP.sb) return;
  await APP.sb.auth.signOut();
  APP.session = null; APP.user = null; APP.me = null; APP.wallet = null;
  APP.rolePicked = null;
  setAuthedUI();
  location.hash = "#home";
  await route();
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
    btn.addEventListener('click', async (e)=>{
      e.preventDefault();
      const id = btn.getAttribute('data-view');
      await openCreatorProfile(id);
    });
  });
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
    btn.addEventListener('click', async ()=>{
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
      btn.addEventListener('click', ()=>{
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
  $$('button[data-view]', out).forEach(btn=>btn.addEventListener('click', async ()=>{
    await openCreatorProfile(btn.getAttribute('data-view'));
  }));
  $$('button[data-select]', out).forEach(btn=>btn.addEventListener('click', ()=>{
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
    btn.addEventListener('click', async ()=>{
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

function postsKey(){ return `cb_posts_${APP.user?.id||'anon'}`; }
function loadPosts(){
  try{ return JSON.parse(localStorage.getItem(postsKey()) || '[]'); }catch(e){ return []; }
}
function savePosts(list){ localStorage.setItem(postsKey(), JSON.stringify(list.slice(0,200))); }
function renderMyFeed(){
  const out = byId('myFeed');
  const empty = byId('myFeedEmpty');
  if(!out) return;
  const posts = loadPosts();
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
  if(byId('profileAvatar')) byId('profileAvatar').textContent = (name||'U').slice(0,1).toUpperCase();
  if(byId('profileCredits')) byId('profileCredits').textContent = bal;

  // mirror settings into inline form
  const m = APP.me || {};
  if(byId('setRole2')) byId('setRole2').value = m.role || 'client';
  if(byId('setName2')) byId('setName2').value = m.display_name || '';
  if(byId('setCity2')) byId('setCity2').value = m.city || 'Los Angeles';
  if(byId('setBio2')) byId('setBio2').value = m.bio || '';
  if(byId('setPortfolio2')) byId('setPortfolio2').value = m.portfolio_url || '';
  if(byId('setResume2')) byId('setResume2').value = m.resume_url || '';

  // projects list
  const projOut = byId('profileProjects');
  if(projOut){
    projOut.innerHTML = '<div class="muted">Loading…</div>';
    const cards = await listMyProjects();
    projOut.innerHTML = renderProjectCards(cards);
    bindProjectOpen(projOut);
  }
  // feed
  renderMyFeed();
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
  on('tabFeed','click',()=>{ setTab('feed'); renderMyFeed(); });
  on('tabSettings','click',()=>setTab('settings'));
}

function bindFeedComposer(){
  on('btnPost','click',()=>{
    if(!APP.user) return toast('Sign in first');
    const title = (byId('postTitle')?.value || '').trim();
    const body = (byId('postBody')?.value || '').trim();
    if(!body) return toast('Write something');
    const posts = loadPosts();
    posts.unshift({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), title, body, created_at: new Date().toISOString() });
    savePosts(posts);
    if(byId('postTitle')) byId('postTitle').value='';
    if(byId('postBody')) byId('postBody').value='';
    renderMyFeed();
    toast('Posted');
  });
  on('btnClearPosts','click',()=>{
    if(!APP.user) return;
    savePosts([]);
    renderMyFeed();
    toast('Cleared');
  });
}

/* ----------------------------- routing ----------------------------- */
async function route(){
  initSupabase();
  await refreshSession();

  if(!APP.user){
    // public mode
    setAuthedUI();
    await renderHome();
    return;
  }

  await ensureProfile();
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
  initSupabase();
  if(APP.sb){
    APP.sb.auth.onAuthStateChange(async ()=>{
      await refreshSession();
      if(APP.user){
        await ensureProfile();
        setAuthedUI();
        await refreshWallet();
        // if user just logged in, send them to home
        if(getHash() === 'home') await renderHome();
        else await route();
        closeModal('authModal');
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
  document.addEventListener('click',(e)=>{
    const mw = byId('profileMenuWrap');
    const m = byId('profileMenu');
    if(!mw || !m) return;
    if(!mw.contains(e.target)) m.style.display = 'none';
  });

  on('menuSignOut','click', signOut);
  on('btnCreditsTop','click', openCredits);
  on('creditsPill','click', openCredits);

  // Auth modal open/close
  on('btnSignIn','click',()=>{
    if(!initSupabase()) toast('Setup needed: add your Supabase URL + anon key in config.js');
    openModal('authModal');
    setAuthMode('login');
  });
  on('authClose','click',()=>closeModal('authModal'));

  // Auth mode toggle
  on('authModeLogin','click',()=>setAuthMode('login'));
  on('authModeSignup','click',()=>setAuthMode('signup'));

  // Auth actions
  setAuthMode('login');
  on('authGoogle','click', signInWithGoogle);
  on('authLogin','click', signInWithPassword);
  on('authSignup','click', signUpWithPassword);
  on('authMagic','click', signInMagicLink);
  on('authForgot','click', forgotPassword);
  on('authSetNewPass','click', setNewPasswordFromRecovery);


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
  window.addEventListener('hashchange', route);
  await route();
}

document.addEventListener('DOMContentLoaded', init);
