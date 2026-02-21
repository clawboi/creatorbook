

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



export function wireUI(APP){
  document.querySelectorAll("[data-nav]").forEach(a=>{
    a.addEventListener("click",e=>{
      const h=a.getAttribute("href");
      if(h&&h.startsWith("#")){e.preventDefault();location.hash=h;}
    });
  });
}

export function setupAuthModal(){
  const modal=document.getElementById("authModal");
  if(!modal)return;
  document.getElementById("btnSignIn")?.addEventListener("click",()=>modal.style.display="grid");
  document.getElementById("authClose")?.addEventListener("click",()=>modal.style.display="none");
}
