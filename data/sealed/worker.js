'use strict';

// Release paths are immutable. Keep the immediately previous shell available during updates.
const releaseId='3a82dcf6d56fce5042b4b40c';
const revision=Number('26');
const prefix='vpf-app-'+new URL('./',self.location.href).pathname+':';
const cacheName=prefix+releaseId;
const root='releases/'+releaseId+'/';
const shell=['index.html',...['index-data.js','app.js','theme.js','styles.css','data-update.js','calendar.js',
  'match-view.js','competition-view.js','web-data.js','live-view.js','news-view.js','news-snapshot.js',
  'assets/InterVariable.woff2','assets/vl1.webp','assets/vl2.webp','assets/nc.webp',
  'assets/app-32.png','assets/app-180.png','assets/app-192.png','assets/app-512.png'].map(file=>root+file)];
const scope=new URL('./',self.location.href);
const marker=new URL('__vpf_cache_revision__',scope);

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(cacheName);
    await cache.addAll(shell.map(file=>new Request(new URL(file,scope),{cache:'reload'})));
    await cache.put(marker,new Response(String(revision)));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=(await caches.keys()).filter(key=>key.startsWith(prefix) && key!==cacheName);
    const indexed=await Promise.all(keys.map(async key=>{
      const stamp=await (await caches.open(key)).match(marker);
      return [key,stamp?Number(await stamp.text()):0];
    }));
    const previous=indexed.filter(([,rev])=>rev>0 && rev<revision).sort((a,b)=>b[1]-a[1])[0]?.[0];
    const legacy=indexed.filter(([,rev])=>rev===0).at(-1)?.[0];
    await Promise.all(indexed.filter(([key,rev])=>rev<=revision && key!==(previous||legacy)).map(([key])=>caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const {request}=event;
  const url=new URL(request.url);
  if (request.method!=='GET' || url.origin!==scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const relative=url.pathname.slice(scope.pathname.length);
  if (request.mode==='navigate' && (relative==='' || relative==='index.html')) {
    event.respondWith((async()=>{
      try {
        const response=await fetch(request,{cache:'no-cache'});
        if (response.ok) return response;
      } catch { /* Use the shell that this worker installed. */ }
      return (await caches.open(cacheName)).match(new URL('index.html',scope));
    })());
    return;
  }
  const found=relative.match(/^releases\/([a-f\d]{24})\//);
  if (!found) return;
  event.respondWith((async()=>{
    const cache=await caches.open(prefix+found[1]);
    const cached=await cache.match(request);
    if (cached) return cached;
    const response=await fetch(request);
    if (response.ok) {
      try { await cache.put(request,response.clone()); } catch { /* Storage is optional. */ }
    }
    return response;
  })());
});
