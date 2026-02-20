/* CreatorBook v4
   Goals:
   - Public home feed (no login required)
   - After login: big Artist vs Creator role gate
   - Artist flow: Create Project wizard -> choose service/tier -> pick creator/package -> request date -> message
   - Projects tracking with timeline
   - Creator flow: manage up to 4 packages (bronze/silver/gold/elite)
*/

const APP = { sb:null, session:null, me:null, chosen:null };
const ROLE_KEY = "CREATORBOOK_DESIRED_ROLE";

const $ = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));
const G = (s)=>document.querySelector(s);
const esc = (s)=> (s||"").replace(/[&<>"']/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

function toast(msg){ const t = $("#toast"); t.textContent=msg; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),1800); }

function route(){
  const h = (location.hash||"#home").replace(/^#/,'');
  const page = h.split('/')[0] || 'home';
  for(const el of $$('.page')) el.classList.remove('show');

  const show = (id)=>{ const el = $(id); if(el) el.classList.add('show'); };

  if(page==='home') show('#pageHome');
  else if(page==='artist') show('#pageArtist');
  else if(page==='creator') show('#pageCreator');
  else if(page==='create-project') show('#pageCreateProject');
  else if(page==='projects') show('#pageProjects');
  else if(page==='dashboard') {
    if(APP.session && APP.me?.role==='creator') show('#pageCreator');
    else if(APP.session) show('#pageArtist');
    else show('#pageHome');
  }
  else if(page==='settings') show('#pageSettings');
  else show('#pageHome');
}

async function init(){
  const cfg = window.CREATORBOOK_CONFIG || {};
  if(!cfg.supabaseUrl || !cfg.supabaseAnonKey){
    toast('Missing config.js');
    showModal(true);
    return;
  }
  APP.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

  // Auth state
  APP.sb.auth.onAuthStateChange(async (_event, session)=>{
    APP.session = session;
    if(session){
      document.body.classList.add('isAuthed');
      await ensureProfile();
      syncWho();
      // If role not set / first time: show role gate
      if(!APP.me?.role){
        showRoleGate();
      }
      route();
    } else {
      APP.me = null;
      document.body.classList.remove('isAuthed');
      syncWho();
      route();
    }
  });

  const { data } = await APP.sb.auth.getSession();
  APP.session = data.session;
  if(APP.session){
    document.body.classList.add('isAuthed');
    await ensureProfile();
  }
  syncWho();

  wireUI();
  await renderHomeFeed();
  route();
}

function syncWho(){
  const authed = !!APP.session;
  const whoPill = $('#whoPill');
  const creditsPill = $('#creditsPill');
  const profileWrap = $('#profileMenuWrap');
  const btnIn = $('#btnSignIn');

  $$('.authed').forEach(el=>el.style.display = authed ? '' : 'none');

  if(!authed){
    if(whoPill) whoPill.style.display='none';
    if(creditsPill) creditsPill.style.display='none';
    if(profileWrap) profileWrap.style.display='none';
    if(btnIn) btnIn.style.display='inline-flex';
    return;
  }

  if(btnIn) btnIn.style.display='none';
  if(whoPill) whoPill.style.display='inline-flex';
  if(profileWrap) profileWrap.style.display='inline-flex';

  $('#whoName').textContent = APP.me?.display_name || APP.session.user.email;
  $('#whoRole').textContent = APP.me?.role || 'client';

  if(creditsPill){
    creditsPill.style.display='inline-flex';
    getWallet().then(w=>{
      $('#creditsBalTop').textContent = Math.round(Number(w.balance||0));
    }).catch(()=>{ $('#creditsBalTop').textContent='0'; });
  }
}

async function ensureProfile(){
  const uid = APP.session.user.id;
  const email = APP.session.user.email || '';

  let { data: prof, error } = await APP.sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if(error) throw error;

  const desiredRole = localStorage.getItem(ROLE_KEY); // 'client' or 'creator'

  if(!prof){
    const display = (email.split('@')[0] || 'User').slice(0,24);
    const role = desiredRole || 'client';
    const ins = await APP.sb.from('profiles').insert({
      id: uid,
      role,
      approved: false,
      display_name: display,
      city: 'Los Angeles',
      bio: '',
      portfolio_url: '',
      resume_url: ''
    }).select('*').single();
    if(ins.error) throw ins.error;
    prof = ins.data;

    // wallet row
    await APP.sb.from('credits_wallet').insert({ user_id: uid, balance: 0 });
  } else if(desiredRole && prof.role !== desiredRole){
    // If user chose role before signing in, apply it on first login
    const up = await APP.sb.from('profiles').update({ role: desiredRole }).eq('id', uid).select('*').single();
    if(up.error) throw up.error;
    prof = up.data;
  }

  // clear one-time desired role
  if(desiredRole) localStorage.removeItem(ROLE_KEY);

  APP.me = prof;
  // settings defaults
  $('#setName').value = prof.display_name || '';
  $('#setCity').value = prof.city || '';
  $('#setRole').value = prof.role || 'client';
  $('#setBio').value = prof.bio || '';
  $('#setPortfolio').value = prof.portfolio_url || '';
  $('#setResume').value = prof.resume_url || '';

  // dashboards
  if(APP.me.role === 'client') await renderArtistDash();
  if(APP.me.role === 'creator') await renderCreatorDash();

  return prof;
}

function showModal(on){
  $('#authModal').style.display = on ? 'grid' : 'none';
}
function showAuthStep(step){
  $('#authStepRole').style.display = (step==='role') ? 'block' : 'none';
  $('#authStepEmail').style.display = (step==='email') ? 'block' : 'none';
  $('#authStepSent').style.display = (step==='sent') ? 'block' : 'none';
}

function showRoleGate(){
  // Show full page role gate
  for(const el of $$('.page')) el.classList.remove('show');
  $('#pageRoleGate').classList.add('show');
}

function wireUI(){
  window.addEventListener('hashchange', route);

  // Sign in
  $('#btnSignIn').onclick = ()=>{ showModal(true); showAuthStep('role'); };

  // Profile menu toggle
  const menu = $('#profileMenu');
  const wrap = $('#profileMenuWrap');
  const btnProfile = $('#btnProfile');
  const closeMenu = ()=>{ if(menu) menu.style.display='none'; };
  if(btnProfile){
    btnProfile.onclick = (e)=>{
      e.stopPropagation();
      if(!menu) return;
      menu.style.display = (menu.style.display==='block') ? 'none' : 'block';
    };
  }
  document.addEventListener('click', (e)=>{
    if(!wrap) return;
    if(wrap.contains(e.target)) return;
    closeMenu();
  });

  $('#menuDashboard').onclick = (e)=>{ e.preventDefault(); closeMenu(); location.hash='#dashboard'; };
  $('#menuSettings').onclick = (e)=>{ e.preventDefault(); closeMenu(); location.hash='#settings'; };
  $('#menuSignOut').onclick = async ()=>{ closeMenu(); await APP.sb.auth.signOut(); };

  // Top actions
  const goCreate = ()=>{
    if(!APP.session){ showModal(true); showAuthStep('role'); return; }
    if(APP.me?.role !== 'client'){ toast('Switch to Artist to create projects'); location.hash='#settings'; return; }
    location.hash = '#create-project';
  };
  $('#btnCreateProjectTop').onclick = goCreate;

  const openCredits = ()=>{
    if(!APP.session){ showModal(true); showAuthStep('role'); return; }
    $('#creditsModal').style.display='grid';
    // reuse walletBal from artist dash renderer
    getWallet().then(w=>{ if(G('#walletBalModal')) G('#walletBalModal').textContent=Math.round(Number(w.balance||0)); }).catch(()=>{});
    // also refresh top pill
    syncWho();
  };
  $('#btnCreditsTop').onclick = openCredits;
  $('#creditsPill').onclick = openCredits;
  $('#btnCloseCredits').onclick = ()=>{ $('#creditsModal').style.display='none'; };
  if(G('#btnAddDemoCredits')) G('#btnAddDemoCredits').onclick = addDemoCredits;
  if(G('#btnAddDemoCreditsModal')) G('#btnAddDemoCreditsModal').onclick = addDemoCreditsModal;

  // Home feed filters
  if(G('#homeService')) G('#homeService').onchange = renderHomeFeed;
  if(G('#homeTier')) G('#homeTier').onchange = renderHomeFeed;
  if(G('#homeRefresh')) G('#homeRefresh').onclick = renderHomeFeed;

  // Auth modal
  $('#authClose').onclick = ()=>showModal(false);
  $('#btnRoleArtist').onclick = ()=>{ localStorage.setItem(ROLE_KEY,'client'); showAuthStep('email'); };
  $('#btnRoleCreator').onclick = ()=>{ localStorage.setItem(ROLE_KEY,'creator'); showAuthStep('email'); };
  $('#btnBackRole').onclick = ()=>showAuthStep('role');
  $('#btnSendLink').onclick = signInMagicLink;

  // Settings save
  $('#btnSaveProfile').onclick = saveProfile;

  // Create project
  $('#btnStartProject').onclick = goCreate;
  if(G('#projSearch')) G('#projSearch').onclick = ()=>renderCreatorResults();
  if(G('#projService')) G('#projService').onchange = ()=>renderCreatorResults();
  if(G('#projTier')) G('#projTier').onchange = ()=>renderCreatorResults();

  // Creator tools
  $('#btnNewPkg').onclick = ()=>openPkgEditor();
  $('#btnSavePkg').onclick = savePackage;
  $('#btnCancelPkg').onclick = ()=>{ $('#pkgEditor').style.display='none'; };

  // Projects
  if(G('#btnRefreshProjects')) G('#btnRefreshProjects').onclick = ()=>{
    if(!APP.session) return;
    if(APP.me?.role==='creator') renderCreatorDash(); else renderArtistDash();
  };
}

async function setRole(role){
  if(!APP.session) return;
  const { data, error } = await APP.sb.from('profiles').update({ role }).eq('id', APP.session.user.id).select('*').single();
  if(error){ toast(error.message); return; }
  APP.me = data;
  $('#setRole').value = role;
  syncWho();
  toast('Role set');
  if(role==='client') await renderArtistDash();
  if(role==='creator') await renderCreatorDash();
}

async function saveSettings(){
  const patch = {
    display_name: $('#setName').value.trim() || 'User',
    city: $('#setCity').value.trim() || 'Los Angeles',
    role: $('#setRole').value,
    bio: $('#setBio').value.trim(),
    portfolio_url: $('#setPortfolio').value.trim(),
    resume_url: $('#setResume').value.trim(),
  };
  const { data, error } = await APP.sb.from('profiles').update(patch).eq('id', APP.session.user.id).select('*').single();
  if(error){ toast(error.message); return; }
  APP.me = data;
  syncWho();
  toast('Saved');
  if(APP.me.role==='client') location.hash = '#artist';
  if(APP.me.role==='creator') location.hash = '#creator';
}

// ---------- Public Home Feed ----------

const SERVICE_LABEL = {
  music_video:'Music Video', photography:'Photography', reels:'Reels / Shorts', editing:'Editing', fashion:'Fashion (Rent)', producer:'Producer'
};
const TIER_LABEL = { bronze:'Bronze', silver:'Silver', gold:'Gold', elite:'Elite' };

async function renderHomeFeed(){
  const service = $('#homeService').value;
  const tier = $('#homeTier').value;

  // Get approved creators list (public)
  let cq = APP.sb.from('creator_public').select('*').eq('approved', true);
  if(service!=='any') cq = cq.eq('service', service);
  if(tier!=='any') cq = cq.eq('tier', tier);

  const { data: creators, error: cErr } = await cq.order('rating_avg', { ascending:false }).limit(60);
  if(cErr){ toast(cErr.message); return; }

  // Pull packages matching filters for those creators
  let pq = APP.sb.from('packages').select('*');
  if(service!=='any') pq = pq.eq('service', service);
  if(tier!=='any') pq = pq.eq('tier', tier);
  const { data: packages, error: pErr } = await pq.order('created_at', { ascending:false }).limit(60);
  if(pErr){ toast(pErr.message); return; }

  const approvedCreatorIds = new Set((creators||[]).map(x=>x.creator_id));
  const filtered = (packages||[]).filter(p=>approvedCreatorIds.has(p.creator_id));

  const feed = $('#feed');
  feed.innerHTML = '';
  $('#feedEmpty').style.display = filtered.length ? 'none' : 'block';

  for(const p of filtered){
    const c = (creators||[]).find(x=>x.creator_id===p.creator_id && x.service===p.service && x.tier===p.tier) || (creators||[]).find(x=>x.creator_id===p.creator_id);
    const name = c?.display_name || 'Creator';
    const city = c?.city || 'Los Angeles';
    const rating = c ? `${Number(c.rating_avg||0).toFixed(1)}★ (${c.rating_count||0})` : '';

    const el = document.createElement('div');
    el.className = 'pack';
    el.innerHTML = `
      <div class="top">
        <div class="badge">${esc(SERVICE_LABEL[p.service]||p.service)} · ${esc(TIER_LABEL[p.tier]||p.tier)}</div>
        <div class="muted">${esc(city)}</div>
      </div>
      <h3>${esc(p.title)}</h3>
      <div class="meta">
        <span><b>${esc(name)}</b></span>
        ${rating ? `<span>${esc(rating)}</span>` : ''}
        <span>${Math.round(Number(p.price_credits||0))} credits</span>
        ${p.delivery_days ? `<span>${esc(String(p.delivery_days))} days</span>` : ''}
      </div>
      <div class="muted">${esc((p.includes||'').slice(0,160))}</div>
      <div class="row" style="margin-top:10px;">
        <button class="btn ghost" data-view="${p.id}">View</button>
        <button class="btn" data-book="${p.id}">Book</button>
      </div>
    `;
    feed.appendChild(el);

    el.querySelector('[data-view]').onclick = ()=>{
      toast('Portfolio links live in profiles. Add yours in Settings.');
      if(!APP.session) showModal(true);
    };
    el.querySelector('[data-book]').onclick = ()=>{
      if(!APP.session){ showModal(true); showAuthStep('role'); return; }
      if(APP.me?.role !== 'client'){ toast('Switch to Artist to create projects'); location.hash='#settings'; return; }
      location.hash = '#create-project';
      $('#projService').value = p.service;
      $('#projTier').value = p.tier;
      setTimeout(()=>renderCreatorResults(p.id), 0);
    };
  }
}

// ---------- Wallet ----------
async function getWallet(){
  const uid = APP.session.user.id;
  const { data, error } = await APP.sb.from('credits_wallet').select('*').eq('user_id', uid).single();
  if(error) throw error;
  return data;
}
async function addDemoCredits(){
  if(!APP.session){ toast('Sign in first'); return; }
  const amt = Number($('#demoCredits').value || 0);
  if(!amt || amt < 1){ toast('Enter credits'); return; }
  const w = await getWallet();
  const newBal = Number(w.balance||0) + amt;
  const { error } = await APP.sb.from('credits_wallet').update({ balance: newBal }).eq('user_id', APP.session.user.id);
  if(error){ toast(error.message); return; }
  await APP.sb.from('credits_tx').insert({ user_id: APP.session.user.id, kind:'credit', amount: amt, note:'Demo top-up' });
  toast('Credits added');
  await renderArtistDash();
}
async function addDemoCreditsModal(){
  if(!APP.session){ toast('Sign in first'); return; }
  const amt = Number((G('#demoCreditsModal')?.value) || 0);
  if(!amt || amt < 1){ toast('Enter credits'); return; }
  const w = await getWallet();
  const newBal = Number(w.balance||0) + amt;
  const { error } = await APP.sb.from('credits_wallet').update({ balance: newBal }).eq('user_id', APP.session.user.id);
  if(error){ toast(error.message); return; }
  await APP.sb.from('credits_tx').insert({ user_id: APP.session.user.id, kind:'credit', amount: amt, note:'Demo top-up (modal)' });
  toast('Credits added');
  // refresh UI bits
  const w2 = await getWallet();
  if(G('#walletBalModal')) G('#walletBalModal').textContent = Math.round(Number(w2.balance||0));
  if(G('#walletBal')) G('#walletBal').textContent = Math.round(Number(w2.balance||0));
  if(G('#creditsBalTop')) G('#creditsBalTop').textContent = Math.round(Number(w2.balance||0));
}


// ---------- Artist Flow ----------

function statusTimeline(status){
  // Map booking statuses into the user-friendly phases
  const steps = [
    { key:'requested', label:'Requested' },
    { key:'accepted', label:'Pre-production' },
    { key:'in_progress', label:'Shoot day' },
    { key:'delivered', label:'Post / Delivery' },
    { key:'approved', label:'Complete' },
  ];
  const rank = { requested:0, accepted:1, in_progress:2, delivered:3, approved:4, declined:0, cancelled:0 };
  const r = rank[status] ?? 0;
  return `<div class="timeline">${steps.map((s,i)=>{
    const done = i<=r && (status!=='declined' && status!=='cancelled');
    return `<div class="step ${done?'done':''}"><span class="dot"></span>${esc(s.label)}</div>`;
  }).join('')}</div>`;
}

async function fetchMyBookingsAsClient(){
  const { data, error } = await APP.sb.from('booking_card_client').select('*').order('created_at', { ascending:false }).limit(50);
  if(error) throw error;
  return data || [];
}

async function fetchMyBookingsAsCreator(){
  const { data, error } = await APP.sb.from('booking_card_creator').select('*').order('created_at', { ascending:false }).limit(50);
  if(error) throw error;
  return data || [];
}

async function renderArtistDash(){
  if(!APP.session) return;
  const w = await getWallet().catch(()=>({ balance:0 }));
  $('#walletBal').textContent = Math.round(Number(w.balance||0));

  const items = await fetchMyBookingsAsClient().catch(()=>[]);
  const box = $('#artistProjects');
  box.innerHTML = items.length ? '' : '<div class="muted">No projects yet. Click Create Project.</div>';
  for(const b of items){
    const card = document.createElement('div');
    card.className = 'pack';
    card.innerHTML = `
      <div class="top">
        <div class="badge">${esc(SERVICE_LABEL[b.service]||b.service)} · ${esc(TIER_LABEL[b.tier]||b.tier)}</div>
        <div class="muted">${esc(b.status)}</div>
      </div>
      <h3>${esc(b.title_line || 'Project')}</h3>
      <div class="meta">
        <span><b>${esc(b.counterparty_name || 'Creator')}</b></span>
        <span>${Math.round(Number(b.total_credits||0))} credits</span>
        ${b.requested_date ? `<span>${esc(new Date(b.requested_date).toLocaleString())}</span>` : ''}
      </div>
      ${statusTimeline(b.status)}
      <div class="row" style="margin-top:10px;">
        <button class="btn ghost" data-open="${b.id}">Open</button>
      </div>
    `;
    card.querySelector('[data-open]').onclick = ()=>openProject(b.id);
    box.appendChild(card);
  }

  // Also update all projects list page
  await renderProjectsAll();
}

async function renderProjectsAll(){
  if(!APP.session) return;
  const box = $('#projectsAll');
  box.innerHTML = '';
  const itemsClient = await fetchMyBookingsAsClient().catch(()=>[]);
  const itemsCreator = (APP.me?.role==='creator') ? await fetchMyBookingsAsCreator().catch(()=>[]) : [];
  const items = [...itemsClient, ...itemsCreator];
  if(!items.length){ box.innerHTML = '<div class="muted">No projects yet.</div>'; return; }
  for(const b of items){
    const el = document.createElement('div');
    el.className='pack';
    el.innerHTML = `
      <div class="top">
        <div class="badge">${esc(SERVICE_LABEL[b.service]||b.service)} · ${esc(TIER_LABEL[b.tier]||b.tier)}</div>
        <div class="muted">${esc(b.status)}</div>
      </div>
      <h3>${esc(b.title_line || 'Project')} <span class="muted">· ${esc(b.counterparty_name||'')}</span></h3>
      ${statusTimeline(b.status)}
      <div class="row" style="margin-top:10px;"><button class="btn ghost" data-open="${b.id}">Open</button></div>
    `;
    el.querySelector('[data-open]').onclick = ()=>openProject(b.id);
    box.appendChild(el);
  }
}

async function openProject(bookingId){
  // lightweight: jump to projects tab and toast
  location.hash = '#projects';
  toast('Project detail view comes next. For now: status + chat is in Supabase messages table.');
}

async function renderCreatorResults(preselectPackageId=null){
  const service = $('#projService').value;
  const tier = $('#projTier').value;

  // Creators visible: approved only
  let cq = APP.sb.from('creator_public').select('*').eq('approved', true).eq('service', service).eq('tier', tier);
  const { data: creators, error } = await cq.order('rating_avg', { ascending:false }).limit(50);
  if(error){ toast(error.message); return; }

  // Packages for that service+tier
  const { data: packages, error: pErr } = await APP.sb.from('packages').select('*').eq('service', service).eq('tier', tier).order('price_credits', { ascending:true });
  if(pErr){ toast(pErr.message); return; }

  const list = $('#creatorResults');
  list.innerHTML = '';

  const approvedIds = new Set((creators||[]).map(x=>x.creator_id));
  const filtered = (packages||[]).filter(p=>approvedIds.has(p.creator_id));

  $('#creatorResultsEmpty').style.display = filtered.length ? 'none' : 'block';

  for(const p of filtered){
    const c = (creators||[]).find(x=>x.creator_id===p.creator_id) || null;
    const el = document.createElement('div');
    el.className = 'pack';
    el.innerHTML = `
      <div class="top">
        <div class="badge">${esc(TIER_LABEL[p.tier])}</div>
        <div class="muted">${esc(c?.city || 'Los Angeles')}</div>
      </div>
      <h3>${esc(c?.display_name || 'Creator')}</h3>
      <div class="meta">
        <span>${esc(p.title)}</span>
        <span><b>${Math.round(Number(p.price_credits||0))} credits</b></span>
        ${p.delivery_days ? `<span>${esc(String(p.delivery_days))} days</span>` : ''}
      </div>
      <div class="muted">${esc((p.includes||'').slice(0,170))}</div>
      <div class="row" style="margin-top:10px;">
        <button class="btn" data-choose="${p.id}">Choose</button>
        <button class="btn ghost" data-portfolio="${p.creator_id}">Portfolio</button>
      </div>
    `;
    el.querySelector('[data-portfolio]').onclick = ()=>{
      toast('Add portfolio link in Settings (creator). Public profile page comes next.');
      location.hash = '#home';
    };
    el.querySelector('[data-choose]').onclick = ()=>choosePackage(p, c);
    list.appendChild(el);

    if(preselectPackageId && p.id === preselectPackageId){
      choosePackage(p, c);
    }
  }
}

function choosePackage(pkg, creatorCard){
  APP.chosen = { pkg, creatorCard };
  $('#requestBox').style.display = 'block';
  $('#chosenCreator').textContent = creatorCard?.display_name || 'Creator';
  $('#chosenPackage').textContent = pkg.title;
  $('#chosenPrice').textContent = `${Math.round(Number(pkg.price_credits||0))} credits`;
  $('#reqMsg').value = '';
  toast('Pick a date + send message');
}

async function sendBookingRequest(){
  if(!APP.chosen){ toast('Choose a creator first'); return; }
  const { pkg } = APP.chosen;
  const reqDate = $('#reqDate').value;
  const msg = $('#reqMsg').value.trim();
  if(!reqDate){ toast('Pick a date'); return; }

  // Create booking
  const bIns = await APP.sb.from('bookings').insert({
    client_id: APP.session.user.id,
    status: 'requested',
    requested_date: new Date(reqDate).toISOString(),
    notes: msg,
    total_credits: Number(pkg.price_credits||0),
    funded: false
  }).select('*').single();
  if(bIns.error){ toast(bIns.error.message); return; }

  const booking = bIns.data;

  // Attach creator line
  const line = await APP.sb.from('booking_creators').insert({
    booking_id: booking.id,
    creator_id: pkg.creator_id,
    package_id: pkg.id,
    price_credits: Number(pkg.price_credits||0)
  });
  if(line.error){ toast(line.error.message); return; }

  // Initial message
  await APP.sb.from('messages').insert({
    booking_id: booking.id,
    sender_id: APP.session.user.id,
    body: msg ? msg : 'Project request sent.'
  });

  toast('Request sent');
  APP.chosen = null;
  $('#requestBox').style.display='none';
  location.hash = '#artist';
  await renderArtistDash();
}

// ---------- Creator Flow ----------

async function myPackages(){
  const { data, error } = await APP.sb.from('packages').select('*').eq('creator_id', APP.session.user.id).order('created_at', { ascending:false });
  if(error) throw error;
  return data || [];
}

async function renderCreatorDash(){
  if(!APP.session) return;
  const note = $('#creatorApprovalNote');
  note.textContent = APP.me.approved ? 'Approved ✅ You are visible in the public feed.' : 'Pending approval ⏳ You can build packages now, but you won’t show publicly until approved.';

  const pkgs = await myPackages().catch(()=>[]);
  const box = $('#creatorPackages');
  box.innerHTML = '';

  const tiers = ['bronze','silver','gold','elite'];
  const byTier = Object.fromEntries(tiers.map(t=>[t, pkgs.filter(p=>p.tier===t)]));

  for(const t of tiers){
    const existing = byTier[t][0];
    const el = document.createElement('div');
    el.className='pack';
    if(existing){
      el.innerHTML = `
        <div class="top"><div class="badge">${esc(TIER_LABEL[t])}</div><div class="muted">${Math.round(Number(existing.price_credits||0))} credits</div></div>
        <h3>${esc(existing.title)}</h3>
        <div class="muted">${esc((existing.includes||'').slice(0,160))}</div>
        <div class="row" style="margin-top:10px;">
          <button class="btn ghost" data-edit="${existing.id}">Edit</button>
          <button class="btn ghost" data-del="${existing.id}">Delete</button>
        </div>
      `;
      el.querySelector('[data-edit]').onclick = ()=>loadPkgIntoForm(existing);
      el.querySelector('[data-del]').onclick = ()=>deletePkg(existing.id);
    } else {
      el.innerHTML = `
        <div class="top"><div class="badge">${esc(TIER_LABEL[t])}</div><div class="muted">Not created</div></div>
        <h3>Create your ${esc(TIER_LABEL[t])} package</h3>
        <div class="muted">Use the form on the right, select tier, and save.</div>
      `;
    }
    box.appendChild(el);
  }

  // Projects as creator
  const items = await fetchMyBookingsAsCreator().catch(()=>[]);
  const inbox = $('#creatorProjects');
  inbox.innerHTML = items.length ? '' : '<div class="muted">No incoming projects yet.</div>';
  for(const b of items){
    const el = document.createElement('div');
    el.className='pack';
    el.innerHTML = `
      <div class="top">
        <div class="badge">${esc(SERVICE_LABEL[b.service]||b.service)} · ${esc(TIER_LABEL[b.tier]||b.tier)}</div>
        <div class="muted">${esc(b.status)}</div>
      </div>
      <h3>${esc(b.title_line || 'Project')}</h3>
      <div class="meta">
        <span><b>${esc(b.counterparty_name || 'Artist')}</b></span>
        <span>${Math.round(Number(b.total_credits||0))} credits</span>
        ${b.requested_date ? `<span>${esc(new Date(b.requested_date).toLocaleString())}</span>` : ''}
      </div>
      ${statusTimeline(b.status)}
      <div class="row" style="margin-top:10px;">
        <button class="btn ghost" data-accept="${b.id}">Accept</button>
        <button class="btn ghost" data-deliver="${b.id}">Mark delivered</button>
      </div>
    `;
    el.querySelector('[data-accept]').onclick = ()=>updateBookingStatus(b.id, 'accepted');
    el.querySelector('[data-deliver]').onclick = ()=>updateBookingStatus(b.id, 'delivered');
    inbox.appendChild(el);
  }

  await renderProjectsAll();
}

function loadPkgIntoForm(p){
  $('#pkgService').value = p.service;
  $('#pkgTier').value = p.tier;
  $('#pkgTitle').value = p.title;
  $('#pkgPrice').value = Math.round(Number(p.price_credits||0));
  $('#pkgDelivery').value = p.delivery_days || '';
  $('#pkgHours').value = p.hours || '';
  $('#pkgLocations').value = p.locations || '';
  $('#pkgRevisions').value = p.revisions || '';
  $('#pkgIncludes').value = p.includes || '';
  $('#pkgAddons').value = p.addons || '';
  $('#btnSavePkg').dataset.editId = p.id;
  toast('Editing package');
}

async function deletePkg(id){
  const ok = confirm('Delete this package?');
  if(!ok) return;
  const { error } = await APP.sb.from('packages').delete().eq('id', id);
  if(error){ toast(error.message); return; }
  toast('Deleted');
  $('#btnSavePkg').dataset.editId = '';
  await renderCreatorDash();
  await renderHomeFeed();
}

async function savePackage(){
  if(!APP.session){ toast('Sign in'); return; }
  if(APP.me?.role !== 'creator'){ toast('Switch to Creator in Settings'); location.hash='#settings'; return; }

  const payload = {
    creator_id: APP.session.user.id,
    service: $('#pkgService').value,
    tier: $('#pkgTier').value,
    title: $('#pkgTitle').value.trim(),
    price_credits: Number($('#pkgPrice').value||0),
    hours: $('#pkgHours').value.trim(),
    locations: $('#pkgLocations').value.trim(),
    revisions: $('#pkgRevisions').value.trim(),
    delivery_days: Number($('#pkgDelivery').value||0) || null,
    includes: $('#pkgIncludes').value.trim(),
    addons: $('#pkgAddons').value.trim(),
  };
  if(!payload.title || !payload.price_credits){ toast('Title + price required'); return; }

  const editId = $('#btnSavePkg').dataset.editId;
  let res;
  if(editId){
    res = await APP.sb.from('packages').update(payload).eq('id', editId);
  } else {
    // enforce max 4 unique tiers for this creator
    const pkgs = await myPackages().catch(()=>[]);
    const tiers = new Set(pkgs.map(p=>p.tier));
    if(tiers.has(payload.tier) && pkgs.some(p=>p.tier===payload.tier)){
      toast('You already have that tier. Click Edit on it.');
      return;
    }
    if(tiers.size >= 4){ toast('Max 4 packages (one per tier)'); return; }
    res = await APP.sb.from('packages').insert(payload);
  }
  if(res.error){ toast(res.error.message); return; }

  toast(editId ? 'Updated' : 'Created');
  $('#btnSavePkg').dataset.editId = '';
  await renderCreatorDash();
  await renderHomeFeed();
}

async function updateBookingStatus(id, status){
  const { error } = await APP.sb.from('bookings').update({ status }).eq('id', id);
  if(error){ toast(error.message); return; }
  toast('Updated');
  if(APP.me.role==='creator') await renderCreatorDash();
  if(APP.me.role==='client') await renderArtistDash();
}

// Kick off
init().catch(err=>{
  console.error(err);
  toast(err?.message || 'Error');
});
