/* Keeps every open device on the latest version: checks version.json about once a minute and, when a
   newer build is live, reloads at a safe moment (nothing unsaved, no editor open, not mid-typing).
   The host's CDN caches version.json and the pages separately (up to 5 min each), so right after a deploy they can
   disagree in either direction. Two rules keep that from turning into a reload loop: only a build NEWER than this
   page counts, and a reload is tried once per build — if the page that comes back is still the old one, the CDN
   hasn't caught up; wait a while before trying that build again. */
(function(){
  const ME='__BUILD__', KEY='au_tried', RETRY=10*60*1000; let ready=false, lastCheck=0;
  const typing=()=>{ const a=document.activeElement; return a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.value&&a.type!=='search'; };
  const safe=()=>!typing()&&(typeof window.__canReload!=='function'||window.__canReload());
  const tried=()=>{ try{ const [b,t]=(sessionStorage.getItem(KEY)||'').split('|'); return b?{build:b,at:+t||0}:null; }catch(_){ return null; } };
  async function check(){ lastCheck=Date.now(); if(location.protocol==='file:') return;
    try{ const r=await fetch('version.json?t='+Date.now(),{cache:'no-store'}); if(!r.ok) return; const v=await r.json(); if(!v||!v.build||!(v.build>ME)) return;
      const t=tried(); if(t&&t.build===v.build&&Date.now()-t.at<RETRY) return;   // already reloaded for this build and still got the old page
      ready=v.build; }catch(_){} }
  setInterval(()=>{ if(ready){ if(safe()){ try{ sessionStorage.setItem(KEY,ready+'|'+Date.now()); }catch(_){ } location.reload(); } } else if(Date.now()-lastCheck>60000) check(); },3000);
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') check(); });
  window.__build=ME;
})();
