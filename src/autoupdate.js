/* Keeps every open device on the latest version: checks version.json about once a minute and, when a
   newer build is live, reloads at a safe moment (nothing unsaved, no editor open, not mid-typing). */
(function(){
  const ME='__BUILD__'; let ready=false, lastCheck=0;
  const typing=()=>{ const a=document.activeElement; return a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.value&&a.type!=='search'; };
  const safe=()=>!typing()&&(typeof window.__canReload!=='function'||window.__canReload());
  async function check(){ lastCheck=Date.now(); if(location.protocol==='file:') return;
    try{ const r=await fetch('version.json?t='+Date.now(),{cache:'no-store'}); if(!r.ok) return; const v=await r.json(); if(v&&v.build&&v.build!==ME) ready=true; }catch(_){} }
  setInterval(()=>{ if(ready){ if(safe()) location.reload(); } else if(Date.now()-lastCheck>60000) check(); },3000);
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') check(); });
  window.__build=ME;
})();

