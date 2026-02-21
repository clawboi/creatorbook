
export async function initAuth(APP, supabase){
  APP.sb=supabase;
  const {data}=await supabase.auth.getSession();
  APP.session=data.session;
  APP.user=data.session?.user||null;
}

export function requireAuth(APP, openAuth){
  if(!APP.user){
    openAuth();
    return false;
  }
  return true;
}
