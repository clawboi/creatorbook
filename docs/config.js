/* CreatorBook config.js
   IMPORTANT:
   - Put ONLY your Supabase Project URL and ANON key here.
   - Do NOT put the service_role / secret key in any frontend file.
*/
window.SUPABASE_URL = window.SUPABASE_URL || "PASTE_YOUR_SUPABASE_URL_HERE";
window.SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || "PASTE_YOUR_SUPABASE_ANON_KEY_HERE";

// Optional: GitHub Pages base path helper (index.html also sets this)
window.CREATORBOOK_BASE = window.CREATORBOOK_BASE || (function(){
  const p = location.pathname || "/";
  const parts = p.split("/").filter(Boolean);
  return (parts.length ? ("/" + parts[0] + "/") : "/");
})();

// Build tag
window.CREATORBOOK_BUILD = window.CREATORBOOK_BUILD || "replacement-1";
