
import {APP} from "./modules/state.js";
import {getHashRoute,showView,startRouter} from "./modules/router.js";
import {initAuth} from "./modules/auth.js";
import {wireUI,setupAuthModal} from "./modules/ui.js";

async function boot(){
  const supabase=window.supabase?.createClient(window.SUPABASE_URL,window.SUPABASE_ANON_KEY);
  if(supabase) await initAuth(APP,supabase);

  wireUI(APP);
  setupAuthModal();
  startRouter();
  showView(getHashRoute());
}

document.addEventListener("DOMContentLoaded",boot);
