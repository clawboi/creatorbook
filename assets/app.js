/* CreatorBook MVP v2 (GitHub Pages + Supabase)
   Adds:
   - Project Cart (multi-creator booking lines)
   - Reviews display + submit (after approval)
   - Stripe buy credits via Supabase Edge Function (optional)
*/
const APP = { supabaseUrl:"", supabaseAnonKey:"", sb:null, session:null, me:null };
const CART_KEY = "CREATORBOOK_CART_V1";
const $ = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));
const esc = (s)=> (s||"").replace(/[&<>"']/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const credits = (n)=> `${Math.round(Number(n||0))} credits`;
const fmtDate = (d)=> { try{ const x = (typeof d==="string") ? new Date(d) : d; return x.toLocaleString(); } catch(e){ return String(d); } };

function toast(msg){
  const t = $("#toast"); if(!t) return;
  t.textContent = msg; t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"), 1800);
}

function qs(){
  const h = location.hash.replace(/^#/,"");
  const [route,id] = h.split("/");
  return { route: route || "home", id };
}

function getCart(){ try{ return JSON.parse(localStorage.getItem(CART_KEY)||"[]"); }catch(e){ return []; } }
function setCart(items){ localStorage.setItem(CART_KEY, JSON.stringify(items||[])); updateCartCount(); }
function clearCart(){ setCart([]); }
function updateCartCount(){
  const el = $("#cartCount"); if(!el) return;
  const n = getCart().length;
  el.textContent = n ? `(${n})` : "";
}
function addToCart(item){
  const cart = getCart();
  if(cart.some(x=>x.package_id===item.package_id)){ toast("Already in cart"); return; }
  cart.push(item); setCart(cart); toast("Added to cart");
}
function removeFromCart(package_id){
  setCart(getCart().filter(x=>x.package_id!==package_id));
  toast("Removed");
}

async function loadConfig(){
  if(window.CREATORBOOK_CONFIG){
    APP.supabaseUrl = window.CREATORBOOK_CONFIG.supabaseUrl;
    APP.supabaseAnonKey = window.CREATORBOOK_CONFIG.supabaseAnonKey;
  }
  if(!APP.supabaseUrl || !APP.supabaseAnonKey){
    $("#needsConfig").style.display = "block";
    return false;
  }
  APP.sb = window.supabase.createClient(APP.supabaseUrl, APP.supabaseAnonKey);
  return true;
}
async function refreshSession(){
  const { data } = await APP.sb.auth.getSession();
  APP.session = data.session;
  return APP.session;
}
async function ensureProfile(){
  const uid = APP.session.user.id;
  let { data: prof, error } = await APP.sb.from("profiles").select("*").eq("id", uid).maybeSingle();
  if(error) throw error;
  if(!prof){
    const email = APP.session.user.email || "";
    const display = email.split("@")[0] || "User";
    const ins = await APP.sb.from("profiles").insert({
      id: uid, role:"client", approved:false,
      display_name: display, city:"Los Angeles",
      bio:"", portfolio_url:"", resume_url:""
    }).select("*").single();
    if(ins.error) throw ins.error;
    prof = ins.data;
    await APP.sb.from("credits_wallet").insert({ user_id: uid, balance: 0 });
  }
  // wallet guarantee
  const w = await APP.sb.from("credits_wallet").select("*").eq("user_id", uid).maybeSingle();
  if(!w.error && !w.data) await APP.sb.from("credits_wallet").insert({ user_id: uid, balance: 0 });
  APP.me = prof;
  return prof;
}
async function getWallet(){
  const uid = APP.session.user.id;
  const { data, error } = await APP.sb.from("credits_wallet").select("*").eq("user_id", uid).single();
  if(error) throw error;
  return data;
}

function setAuthedUI(){
  const authed = !!APP.session;
  $("#authBox").style.display = authed ? "none" : "block";
  $("#appShell").style.display = authed ? "block" : "none";
  $("#whoami").textContent = authed ? (APP.me?.display_name || APP.session.user.email) : "Not signed in";
  $("#rolePill").textContent = authed ? (APP.me?.role || "client") : "";
  updateCartCount();
}

async function signInMagicLink(){
  const email = $("#email").value.trim();
  if(!email){ toast("Enter your email"); return; }
  const { error } = await APP.sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname }
  });
  if(error) toast(error.message); else toast("Check your email for the login link");
}
async function signOut(){
  await APP.sb.auth.signOut();
  APP.session = null; APP.me = null;
  route();
}

function guardCreatorOnly(){
  if(APP.me?.role !== "creator"){
    toast("Switch role to Creator first");
    location.hash = "#settings";
    return false;
  }
  return true;
}

async function saveSettings(){
  const role = $("#setRole").value;
  const display_name = $("#setName").value.trim();
  const city = $("#setCity").value.trim();
  const bio = $("#setBio").value.trim();
  const portfolio_url = $("#setPortfolio").value.trim();
  const resume_url = $("#setResume").value.trim();

  const { error } = await APP.sb.from("profiles")
    .update({ role, display_name, city, bio, portfolio_url, resume_url })
    .eq("id", APP.session.user.id);

  if(error) toast(error.message); else { await ensureProfile(); toast("Saved"); route(); }
}

async function addDemoCredits(){
  const amt = Number($("#demoCredits").value || 0);
  if(!amt || amt < 1){ toast("Enter credits"); return; }
  const uid = APP.session.user.id;
  const w = await getWallet();
  const newBal = Number(w.balance||0) + amt;
  const { error } = await APP.sb.from("credits_wallet").update({ balance: newBal }).eq("user_id", uid);
  if(error){ toast(error.message); return; }
  await APP.sb.from("credits_tx").insert({ user_id: uid, kind:"credit", amount: amt, note:"Demo top-up" });
  toast("Credits added");
  route();
}

async function createPackage(){
  if(!guardCreatorOnly()) return;
  const service = $("#pkgService").value;
  const tier = $("#pkgTier").value;
  const title = $("#pkgTitle").value.trim();
  const price = Number($("#pkgPrice").value || 0);
  const hours = $("#pkgHours").value.trim();
  const locations = $("#pkgLocations").value.trim();
  const revisions = $("#pkgRevisions").value.trim();
  const delivery_days = Number($("#pkgDelivery").value || 0);
  const includes = $("#pkgIncludes").value.trim();
  const addons = $("#pkgAddons").value.trim();

  if(!title || !price){ toast("Title + price required"); return; }

  const { error } = await APP.sb.from("packages").insert({
    creator_id: APP.session.user.id,
    service, tier, title,
    price_credits: price,
    hours, locations, revisions,
    delivery_days,
    includes, addons
  });
  if(error) toast(error.message); else { toast("Package created"); $("#pkgTitle").value=""; route(); }
}

async function myPackages(){
  const { data, error } = await APP.sb.from("packages").select("*")
    .eq("creator_id", APP.session.user.id)
    .order("created_at", { ascending:false });
  if(error) throw error;
  return data || [];
}

async function browseCreators(service, tier){
  const q = APP.sb.from("creator_public").select("*").eq("approved", true);
  if(service && service !== "any") q.eq("service", service);
  if(tier && tier !== "any") q.eq("tier", tier);
  const { data, error } = await q.order("rating_avg", { ascending:false });
  if(error) throw error;
  return data || [];
}

async function getCreatorReviews(creatorId){
  const { data, error } = await APP.sb.from("reviews_public").select("*")
    .eq("creator_id", creatorId)
    .order("created_at", { ascending:false })
    .limit(20);
  if(error) throw error;
  return data || [];
}

async function createBookingMulti({ requested_date, notes, lines }){
  const uid = APP.session.user.id;
  const total = lines.reduce((s,l)=> s + Number(l.price_credits||0), 0);

  const w = await getWallet();
  if(Number(w.balance||0) < total){ toast("Not enough credits (use Demo Credits for now)"); return; }

  const { data: booking, error } = await APP.sb.from("bookings").insert({
    client_id: uid,
    status: "requested",
    requested_date,
    notes,
    total_credits: total
  }).select("*").single();
  if(error) throw error;

  const rows = lines.map(l => ({
    booking_id: booking.id,
    creator_id: l.creator_id,
    package_id: l.package_id,
    price_credits: l.price_credits
  }));
  const ins = await APP.sb.from("booking_creators").insert(rows);
  if(ins.error) throw ins.error;

  toast("Request sent");
  clearCart();
  location.hash = "#booking/" + booking.id;
}

async function createBookingSingle({ creator_id, package_id, requested_date, notes }){
  const pkgRes = await APP.sb.from("packages").select("*").eq("id", package_id).single();
  if(pkgRes.error) throw pkgRes.error;
  const pkg = pkgRes.data;

  await createBookingMulti({
    requested_date,
    notes,
    lines: [{ creator_id, package_id, price_credits: pkg.price_credits }]
  });
}

async function listMyBookings(){
  const uid = APP.session.user.id;
  const role = APP.me?.role || "client";
  if(role === "creator"){
    const { data, error } = await APP.sb.from("booking_card_creator").select("*").eq("creator_id", uid)
      .order("created_at", { ascending:false });
    if(error) throw error;
    return data || [];
  }else{
    const { data, error } = await APP.sb.from("booking_card_client").select("*").eq("client_id", uid)
      .order("created_at", { ascending:false });
    if(error) throw error;
    return data || [];
  }
}

async function readBooking(bookingId){
  const { data: booking, error } = await APP.sb.from("bookings").select("*").eq("id", bookingId).single();
  if(error) throw error;

  const lines = await APP.sb.from("booking_lines").select("*").eq("booking_id", bookingId);
  if(lines.error) throw lines.error;

  const msgs = await APP.sb.from("messages").select("*").eq("booking_id", bookingId).order("created_at", { ascending:true });
  if(msgs.error) throw msgs.error;

  const del = await APP.sb.from("deliveries").select("*").eq("booking_id", bookingId).order("created_at", { ascending:false }).limit(1);
  if(del.error) throw del.error;

  const revs = await APP.sb.from("reviews").select("*").eq("booking_id", bookingId).eq("client_id", APP.session.user.id);
  // revs.error can be ignored if RLS blocks; still ok.

  return { booking, lines: lines.data||[], messages: msgs.data||[], delivery: (del.data||[])[0]||null, myReviews: (revs.data||[]) };
}

function isCreatorOnBooking(lines){
  const uid = APP.session.user.id;
  return lines.some(l => l.creator_id === uid);
}

async function updateBookingStatus(id, status){
  const { error } = await APP.sb.from("bookings").update({ status }).eq("id", id);
  if(error) toast(error.message); else { toast("Updated"); route(); }
}

async function holdCreditsForBooking(id){
  const b = await APP.sb.from("bookings").select("*").eq("id", id).single();
  if(b.error) throw b.error;
  const booking = b.data;
  if(booking.status !== "accepted"){ toast("Must be accepted first"); return; }
  if(booking.funded){ toast("Already funded"); return; }

  const w = await getWallet();
  const amt = Number(booking.total_credits||0);
  if(Number(w.balance||0) < amt){ toast("Wallet too low"); return; }

  const newBal = Number(w.balance||0) - amt;
  const u1 = await APP.sb.from("credits_wallet").update({ balance:newBal }).eq("user_id", booking.client_id);
  if(u1.error) throw u1.error;

  await APP.sb.from("credits_tx").insert({ user_id: booking.client_id, kind:"hold", amount:-amt, booking_id:id, note:"Escrow hold" });
  await APP.sb.from("bookings").update({ funded:true }).eq("id", id);

  toast("Credits held");
  route();
}

async function submitDelivery(id){
  const link = $("#deliveryLink").value.trim();
  const note = $("#deliveryNote").value.trim();
  if(!link){ toast("Paste delivery link"); return; }

  const ins = await APP.sb.from("deliveries").insert({ booking_id:id, link, note });
  if(ins.error){ toast(ins.error.message); return; }

  await APP.sb.from("bookings").update({ status:"delivered", delivered_at: new Date().toISOString() }).eq("id", id);
  toast("Delivered");
  route();
}

async function approveDelivery(id){
  const b = await APP.sb.from("bookings").select("*").eq("id", id).single();
  if(b.error) throw b.error;
  const booking = b.data;
  if(booking.status !== "delivered"){ toast("Not delivered yet"); return; }

  await APP.sb.from("bookings").update({ status:"approved", approved_at: new Date().toISOString() }).eq("id", id);

  const lines = await APP.sb.from("booking_creators").select("*").eq("booking_id", id);
  if(lines.error) throw lines.error;

  // MVP payout as credits to each creator. Replace later with Stripe Connect payouts.
  for(const ln of (lines.data||[])){
    const w = await APP.sb.from("credits_wallet").select("*").eq("user_id", ln.creator_id).maybeSingle();
    const cur = Number(w.data?.balance || 0);
    const add = Number(ln.price_credits||0);
    await APP.sb.from("credits_wallet").upsert({ user_id: ln.creator_id, balance: cur + add }, { onConflict:"user_id" });
    await APP.sb.from("credits_tx").insert({ user_id: ln.creator_id, kind:"payout_credit", amount:add, booking_id:id, note:"Payout credits (MVP)" });
  }

  toast("Approved + released");
  route();
}

async function sendMessage(bookingId){
  const body = $("#msgBody").value.trim();
  if(!body) return;
  const ins = await APP.sb.from("messages").insert({ booking_id:bookingId, sender_id: APP.session.user.id, body });
  if(ins.error) toast(ins.error.message);
  $("#msgBody").value = "";
  route();
}

async function submitReview(bookingId, creatorId){
  const rating = Number($("#revRating").value || 0);
  const text = $("#revText").value.trim();
  if(rating < 1 || rating > 5){ toast("Rating 1–5"); return; }
  const ins = await APP.sb.from("reviews").insert({ booking_id:bookingId, creator_id:creatorId, client_id: APP.session.user.id, rating, text });
  if(ins.error) toast(ins.error.message); else { toast("Review posted"); $("#revText").value=""; route(); }
}

async function buyCreditsStripe(){
  $("#buyStatus").textContent = "Creating checkout…";
  try{
    const creditsAmt = Number($("#buyAmount").value || 0);
    const promo = $("#buyPromo").value.trim();
    const { data, error } = await APP.sb.functions.invoke("create-checkout-session", {
      body: {
        credits: creditsAmt,
        promo,
        success_url: location.href.split("#")[0] + "#home",
        cancel_url: location.href.split("#")[0] + "#buy"
      }
    });
    if(error) throw error;
    if(!data?.url) throw new Error("No checkout URL returned");
    location.href = data.url;
  }catch(e){
    $("#buyStatus").textContent = "Stripe not deployed yet. Use Demo Credits for now.";
    toast("Stripe not deployed");
  }
}

function showView(id){
  $$(".view").forEach(v=>v.style.display="none");
  $("#" + id).style.display = "block";
}

async function renderHome(){
  showView("viewHome");
  const w = await getWallet();
  $("#walletBalance").textContent = credits(w.balance);

  const service = $("#browseService").value;
  const tier = $("#browseTier").value;

  const creators = await browseCreators(service, tier);
  $("#creatorList").innerHTML = creators.length ? creators.map(c=>`
    <div class="item">
      <div class="row" style="justify-content:space-between">
        <div>
          <div class="title">${esc(c.display_name)} <span class="small">(${esc(c.city||"LA")})</span></div>
          <div class="meta">
            <span class="badge"><span class="b"></span>${esc(c.service)} • ${esc(c.tier)} • from ${credits(c.min_price_credits)}</span>
            <span class="badge"><span class="b" style="background:rgba(255,255,255,.35)"></span>${Number(c.rating_avg||0).toFixed(1)}★ (${c.rating_count||0})</span>
          </div>
        </div>
        <div class="row"><a class="pill" href="#creator/${c.creator_id}">View</a></div>
      </div>
    </div>
  `).join("") : `<div class="small">No creators found (try "any").</div>`;
}

async function renderCreator(id){
  showView("viewCreator");
  $("#creatorProfile").innerHTML = "Loading…";
  $("#creatorPackages").innerHTML = "";
  $("#creatorReviews").innerHTML = "";

  const prof = await APP.sb.from("profiles").select("*").eq("id", id).single();
  if(prof.error){ $("#creatorProfile").innerHTML = `<div class="small">${esc(prof.error.message)}</div>`; return; }
  const p = prof.data;

  const pkgs = await APP.sb.from("packages").select("*").eq("creator_id", id).order("price_credits", { ascending:true });
  if(pkgs.error){ $("#creatorPackages").innerHTML = `<div class="small">${esc(pkgs.error.message)}</div>`; return; }

  $("#creatorProfile").innerHTML = `
    <div class="kv">
      <h2>${esc(p.display_name)} <span class="small">• ${esc(p.city||"Los Angeles")}</span></h2>
      <span class="tag">${esc(p.role)} • ${p.approved ? "Approved" : "Pending"}</span>
    </div>
    <div class="small" style="margin-top:8px">${esc(p.bio||"")}</div>
    <div class="row" style="margin-top:10px">
      ${p.portfolio_url ? `<a class="pill" href="${esc(p.portfolio_url)}" target="_blank" rel="noreferrer">Portfolio</a>` : ``}
      ${p.resume_url ? `<a class="pill" href="${esc(p.resume_url)}" target="_blank" rel="noreferrer">Resume/Reel</a>` : ``}
    </div>
  `;

  $("#creatorPackages").innerHTML = (pkgs.data||[]).length ? (pkgs.data||[]).map(pkg=>`
    <div class="item">
      <div class="row" style="justify-content:space-between; align-items:flex-start">
        <div style="min-width:240px">
          <div class="title">${esc(pkg.title)}</div>
          <div class="meta">${esc(pkg.service)} • ${esc(pkg.tier)} • <b>${credits(pkg.price_credits)}</b></div>
          <div class="small" style="margin-top:8px">
            <b>Hours:</b> ${esc(pkg.hours||"-")} •
            <b>Locations:</b> ${esc(pkg.locations||"-")} •
            <b>Revisions:</b> ${esc(pkg.revisions||"-")} •
            <b>Delivery:</b> ${pkg.delivery_days ? esc(String(pkg.delivery_days)) + " days" : "Creator set"}
          </div>
          ${pkg.includes ? `<div class="small" style="margin-top:8px"><b>Includes:</b> ${esc(pkg.includes)}</div>` : ``}
          ${pkg.addons ? `<div class="small" style="margin-top:8px"><b>Add-ons:</b> ${esc(pkg.addons)}</div>` : ``}
        </div>
        <div style="width:min(360px, 100%)">
          <div class="small"><b>Request a date</b></div>
          <input class="in" id="reqDate" type="datetime-local" />
          <textarea class="in" id="reqNotes" rows="2" style="margin-top:8px" placeholder="Notes (location idea, vibe, refs)…"></textarea>
          <div class="row" style="margin-top:8px">
            <button class="btn" data-book="${pkg.id}">Request Booking</button>
            <button class="btn ghost" data-cart="${pkg.id}">Add to Cart</button>
            <a class="pill" href="#cart">Cart</a>
          </div>
        </div>
      </div>
    </div>
  `).join("") : `<div class="small">No packages yet.</div>`;

  $$("#creatorPackages [data-book]").forEach(btn=>{
    btn.onclick = async ()=>{
      const package_id = btn.getAttribute("data-book");
      const requested_date = $("#reqDate").value;
      const notes = $("#reqNotes").value.trim();
      if(!requested_date){ toast("Pick a date/time"); return; }
      await createBookingSingle({ creator_id:id, package_id, requested_date, notes });
    };
  });
  $$("#creatorPackages [data-cart]").forEach(btn=>{
    btn.onclick = async ()=>{
      const package_id = btn.getAttribute("data-cart");
      const pkg = (pkgs.data||[]).find(x=>x.id===package_id);
      if(!pkg) return;
      addToCart({
        creator_id: id,
        creator_name: p.display_name,
        package_id: pkg.id,
        package_title: pkg.title,
        service: pkg.service,
        tier: pkg.tier,
        price_credits: pkg.price_credits
      });
    };
  });

  const revs = await getCreatorReviews(id);
  $("#creatorReviews").innerHTML = revs.length ? revs.map(r=>`
    <div class="item">
      <div class="row" style="justify-content:space-between">
        <div class="title">${"★".repeat(r.rating)}<span class="small"> (${r.rating}/5)</span></div>
        <div class="small">${esc(r.client_name||"Client")} • ${fmtDate(r.created_at)}</div>
      </div>
      ${r.text ? `<div class="small" style="margin-top:8px; white-space:pre-wrap">${esc(r.text)}</div>` : `<div class="small" style="margin-top:8px;color:rgba(255,255,255,.55)">No comment</div>`}
    </div>
  `).join("") : `<div class="small">No reviews yet.</div>`;
}

async function renderCart(){
  showView("viewCart");
  const cart = getCart();
  const total = cart.reduce((s,x)=> s + Number(x.price_credits||0), 0);

  $("#cartTotal").textContent = cart.length ? `Total: ${credits(total)}` : "Cart is empty.";
  $("#cartList").innerHTML = cart.length ? cart.map(x=>`
    <div class="item">
      <div class="row" style="justify-content:space-between">
        <div>
          <div class="title">${esc(x.package_title)}</div>
          <div class="meta">${esc(x.creator_name)} • ${esc(x.service)} • ${esc(x.tier)} • <b>${credits(x.price_credits)}</b></div>
        </div>
        <div class="row"><button class="pill" data-rm="${esc(x.package_id)}" type="button">Remove</button></div>
      </div>
    </div>
  `).join("") : `<div class="small">Add packages from creator pages.</div>`;

  $$("#cartList [data-rm]").forEach(btn=>{
    btn.onclick = ()=> removeFromCart(btn.getAttribute("data-rm"));
  });

  $("#btnCartClear").onclick = ()=>{ clearCart(); route(); };

  $("#btnCartRequest").onclick = async ()=>{
    const requested_date = $("#cartReqDate").value;
    const notes = $("#cartNotes").value.trim();
    if(!requested_date){ toast("Pick a date/time"); return; }
    if(!cart.length){ toast("Cart is empty"); return; }
    await createBookingMulti({
      requested_date,
      notes,
      lines: cart.map(x=>({ creator_id:x.creator_id, package_id:x.package_id, price_credits:x.price_credits }))
    });
  };
}

async function renderBuy(){
  showView("viewBuy");
  $("#btnBuyCredits").onclick = buyCreditsStripe;
}

async function renderBookings(){
  showView("viewBookings");
  const list = await listMyBookings();
  $("#bookingList").innerHTML = list.length ? list.map(b=>`
    <div class="item">
      <div class="row" style="justify-content:space-between">
        <div>
          <div class="title">${esc(b.title_line || "Booking")} <span class="small">• ${esc(b.status)}</span></div>
          <div class="meta">${esc(b.counterparty_name||"")} • ${esc(b.service||"")} • ${esc(b.tier||"")} • ${credits(b.total_credits)} • ${b.requested_date ? fmtDate(b.requested_date) : ""}</div>
        </div>
        <div class="row"><a class="pill" href="#booking/${b.id}">Open</a></div>
      </div>
    </div>
  `).join("") : `<div class="small">No bookings yet.</div>`;
}

async function renderBooking(id){
  showView("viewBooking");
  const data = await readBooking(id);
  const b = data.booking;
  const lines = data.lines;

  $("#bookingHeader").innerHTML = `
    <div class="kv">
      <h2>Booking <span class="small">#${esc(String(b.id).slice(0,8))}</span></h2>
      <span class="tag">${esc(b.status)}${b.funded ? " • funded" : ""}</span>
    </div>
    <div class="small" style="margin-top:8px"><b>Requested:</b> ${b.requested_date ? fmtDate(b.requested_date) : "-"} • <b>Total:</b> ${credits(b.total_credits)}</div>
    ${b.notes ? `<div class="small" style="margin-top:8px"><b>Notes:</b> ${esc(b.notes)}</div>` : ``}
  `;

  const isClient = (b.client_id === APP.session.user.id);
  const isCreator = isCreatorOnBooking(lines);

  let actions = "";
  if(isCreator && b.status === "requested") actions += `<button class="btn good" id="actAccept">Accept</button><button class="btn bad" id="actDecline">Decline</button>`;
  if(isClient && b.status === "accepted" && !b.funded) actions += `<button class="btn" id="actHold">Hold Credits (Escrow)</button>`;
  if(isCreator && b.status === "accepted") actions += `<button class="btn" id="actStart">Mark In Progress</button>`;
  if(isCreator && (b.status === "in_progress" || b.status === "accepted")) actions += `<button class="btn" id="actDeliver">Deliver</button>`;
  if(isClient && b.status === "delivered") actions += `<button class="btn good" id="actApprove">Approve + Release</button>`;
  $("#bookingActions").innerHTML = actions || `<span class="small">No actions available.</span>`;

  if($("#actAccept")) $("#actAccept").onclick = ()=>updateBookingStatus(id, "accepted");
  if($("#actDecline")) $("#actDecline").onclick = ()=>updateBookingStatus(id, "declined");
  if($("#actHold")) $("#actHold").onclick = ()=>holdCreditsForBooking(id);
  if($("#actStart")) $("#actStart").onclick = ()=>updateBookingStatus(id, "in_progress");
  if($("#actDeliver")) $("#actDeliver").onclick = ()=>{ $("#deliveryBox").style.display = "block"; };
  if($("#actApprove")) $("#actApprove").onclick = ()=>approveDelivery(id);

  $("#bookingLines").innerHTML = lines.length ? lines.map(l=>`
    <div class="item">
      <div class="title">${esc(l.creator_name)} <span class="small">• ${esc(l.service)} • ${esc(l.tier)}</span></div>
      <div class="meta">${esc(l.package_title)} • ${credits(l.price_credits)}</div>
    </div>
  `).join("") : `<div class="small">No lines.</div>`;

  const del = data.delivery;
  $("#deliveryBox").style.display = "none";
  $("#deliveryInfo").innerHTML = del ? `
    <div class="item">
      <div class="title">Latest delivery</div>
      <div class="meta">${fmtDate(del.created_at)} • <a href="${esc(del.link)}" target="_blank" rel="noreferrer">Open link</a></div>
      ${del.note ? `<div class="small" style="margin-top:8px">${esc(del.note)}</div>` : ``}
    </div>
  ` : `<div class="small">No delivery yet.</div>`;

  $("#msgThread").innerHTML = (data.messages||[]).length ? (data.messages||[]).map(m=>`
    <div class="item" style="background:${m.sender_id===APP.session.user.id ? "rgba(138,46,255,.10)" : "rgba(255,255,255,.03)"}">
      <div class="meta"><b>${m.sender_id===APP.session.user.id ? "You" : "Them"}</b> • ${fmtDate(m.created_at)}</div>
      <div style="margin-top:6px; white-space:pre-wrap">${esc(m.body)}</div>
    </div>
  `).join("") : `<div class="small">No messages yet.</div>`;

  $("#sendMsg").onclick = ()=>sendMessage(id);
  $("#submitDelivery").onclick = ()=>submitDelivery(id);

  // Review UI: client can review first creator line after approval (MVP)
  let reviewSpot = $("#reviewSpot");
  if(!reviewSpot){
    reviewSpot = document.createElement("div");
    reviewSpot.id = "reviewSpot";
    $("#viewBooking .grid .card").appendChild(reviewSpot);
  }
  reviewSpot.innerHTML = "";

  if(isClient && b.status === "approved" && lines.length){
    const firstCreator = lines[0].creator_id;
    const already = (data.myReviews||[]).some(r => r.creator_id === firstCreator);
    if(!already){
      reviewSpot.innerHTML = `
        <hr class="sep" />
        <div class="kv"><h2>Leave a review</h2><span class="tag">build trust</span></div>
        <div class="two" style="margin-top:10px">
          <div>
            <label class="small"><b>Rating</b></label>
            <select class="in" id="revRating">
              <option value="5">5 - perfect</option>
              <option value="4">4 - great</option>
              <option value="3">3 - ok</option>
              <option value="2">2 - rough</option>
              <option value="1">1 - bad</option>
            </select>
          </div>
          <div>
            <label class="small"><b>Comment</b> <span class="small">(optional)</span></label>
            <input class="in" id="revText" placeholder="Fast delivery, great communication…" />
          </div>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn" id="btnReview" type="button">Post review</button>
        </div>
      `;
      $("#btnReview").onclick = ()=>submitReview(id, firstCreator);
    }
  }
}

async function renderCreatorTools(){
  showView("viewCreatorTools");
  if(!guardCreatorOnly()) return;
  const pkgs = await myPackages();
  $("#myPkgList").innerHTML = pkgs.length ? pkgs.map(p=>`
    <div class="item">
      <div class="title">${esc(p.title)}</div>
      <div class="meta">${esc(p.service)} • ${esc(p.tier)} • ${credits(p.price_credits)} • ${p.created_at ? fmtDate(p.created_at) : ""}</div>
    </div>
  `).join("") : `<div class="small">No packages yet.</div>`;
}

async function renderSettings(){
  showView("viewSettings");
  $("#setRole").value = APP.me?.role || "client";
  $("#setName").value = APP.me?.display_name || "";
  $("#setCity").value = APP.me?.city || "Los Angeles";
  $("#setBio").value = APP.me?.bio || "";
  $("#setPortfolio").value = APP.me?.portfolio_url || "";
  $("#setResume").value = APP.me?.resume_url || "";
  $("#approvedFlag").textContent = APP.me?.approved ? "Approved creator" : "Not approved / client";
}

async function route(){
  if(!APP.sb){
    const ok = await loadConfig();
    if(!ok) return;
  }
  await refreshSession();
  if(!APP.session){
    $("#needsConfig").style.display = "none";
    $("#authBox").style.display = "block";
    $("#appShell").style.display = "none";
    return;
  }
  await ensureProfile();
  setAuthedUI();

  const { route, id } = qs();
  if(route === "home") await renderHome();
  else if(route === "creator" && id) await renderCreator(id);
  else if(route === "bookings") await renderBookings();
  else if(route === "booking" && id) await renderBooking(id);
  else if(route === "creator-tools") await renderCreatorTools();
  else if(route === "settings") await renderSettings();
  else if(route === "cart") await renderCart();
  else if(route === "buy") await renderBuy();
  else location.hash = "#home";
}

async function init(){
  $("#btnMagic").onclick = signInMagicLink;
  $("#btnSignOut").onclick = signOut;
  $("#btnSaveSettings").onclick = saveSettings;
  $("#btnDemoCredits").onclick = addDemoCredits;
  $("#btnCreatePkg").onclick = createPackage;
  $("#browseService").onchange = route;
  $("#browseTier").onchange = route;
  window.addEventListener("hashchange", route);
  updateCartCount();
  await route();
}
document.addEventListener("DOMContentLoaded", init);
