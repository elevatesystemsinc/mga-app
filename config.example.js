// Copy this file to config.js, fill in your values, commit it.
// The anon key is safe to commit — RLS blocks everything without the board password.
// index.html never contains credentials, so app updates can't wipe them.
window.MM_CONFIG = {
  url: "https://YOUR-PROJECT-REF.supabase.co",   // Supabase → Settings → API
  anonKey: "eyJ...",                              // anon public key
  boardEmail: "board@mgamm.app"                   // the shared Auth user's email
};
