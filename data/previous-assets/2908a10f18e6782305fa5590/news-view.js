'use strict';

const newsPublishers={
  bongdaplus:['Bóng Đá Plus','BĐ+','https://bongdaplus.vn/bong-da-viet-nam'],
  thanhnien:['Thanh Niên','TN','https://thanhnien.vn/the-thao/bong-da-viet-nam.htm'],
  znews:['Znews','Z','https://znews.vn/bong-da-viet-nam.html'],
  vtc:['VTC News','VTC','https://vtcnews.vn/bong-da-viet-nam-115.html'],
  vnexpress:['VnExpress','VNE','https://vnexpress.net/the-thao/v-league'],
  vff:['VFF','VFF','https://www.vff.org.vn/chuyen-muc/giai-quoc-gia/bong-da-nam-cac-giai-quoc-gia/']
};
const newsHosts={bongdaplus:['bongdaplus.vn','s27.bongdaplus.vn'],thanhnien:['thanhnien.vn'],znews:['znews.vn'],
  vtc:['vtcnews.vn','www.vtcnews.vn'],vnexpress:['vnexpress.net'],vff:['vff.org.vn','www.vff.org.vn']};
const vffSections={
  vl1:['V.League 1','giai-vo-dich-quoc-gia-v-league-1/'],
  vl2:['V.League 2','giai-hang-nhat-quoc-gia-v-league-2/'],
  nc:['Cúp Quốc gia','giai-cup-quoc-gia-national-cup/']
};
const articlesStep=12;
const newsKey='vpf-app-v2/news/'+location.pathname.replace(/index\.html$/,'');
const newsRefreshMs=5*60*1000;
const newsState={source:'',league:'',club:'',limit:articlesStep,requestedAt:0};
let newsSnapshot;
let pendingNews;
let syncedNews;
let newsFailed=false;

function parseNews(feed) {
  if (feed?.schema!==1 || !Number.isFinite(Date.parse(feed.checkedAt)) || !Array.isArray(feed.articles) || feed.articles.length>140) return null;
  const seen=new Set();
  const articles=feed.articles.filter(a=>{
    if (!Object.hasOwn(newsPublishers,a?.source) || typeof a.title!=='string' || a.title.length>270 ||
        !Number.isFinite(Date.parse(a.publishedAt)) || !Array.isArray(a.leagues) || !a.leagues.length ||
        !a.leagues.every(id=>Object.hasOwn(leagues,id)) || !Array.isArray(a.clubs) || !a.clubs.every(id=>Object.hasOwn(clubs,id))) return false;
    try {
      const url=new URL(a.url);
      if (url.protocol!=='https:' || url.username || url.password || url.port ||
          !newsHosts[a.source].includes(url.hostname) || seen.has(url.href)) return false;
      seen.add(url.href);
      return true;
    } catch { return false; }
  }).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt) || a.url.localeCompare(b.url));
  if (!articles.length && feed.articles.some(a=>Object.hasOwn(newsPublishers,a?.source))) return null;
  const sources=Object.fromEntries(Object.entries(feed.sources||{}).filter(([id])=>Object.hasOwn(newsPublishers,id)));
  return {...feed,sources,articles:articles.slice(0,120)};
}
function newsMark(id) {
  if (!id) return '';
  const base=webRelease?.assets||'assets/';
  return '<span class="news-mark" data-paper="'+id+'" aria-hidden="true"><img src="'+base+'press-'+id+
    (webRelease?'.webp':'.png')+'" width="26" height="26" alt="" loading="lazy"></span>';
}
function newsVffSections() {
  const entries=newsState.league?[vffSections[newsState.league]]:Object.values(vffSections);
  return '<p class="small muted news-stamp">Chuyên mục VFF · '+entries.map(([name,slug])=>
    '<a href="'+newsPublishers.vff[2]+slug+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(name)+'</a>'
  ).join(' · ')+'</p>';
}
function newsPaperRail() {
  const option=(id,name)=>'<button type="button" class="button option'+(id===newsState.source?' selected':'')+
    '" data-news-source="'+id+'" aria-pressed="'+(id===newsState.source)+'">'+newsMark(id)+escapeHtml(name)+'</button>';
  const arrow=(delta,label,symbol)=>'<button type="button" class="button news-arrow" data-news-scroll="'+delta+
    '" aria-label="'+label+'"><span aria-hidden="true">'+symbol+'</span></button>';
  return '<div class="news-picker">'+arrow(-1,'Cuộn về các nguồn trước','‹')+
    '<div class="news-rail" id="news-rail" role="group" aria-label="Nguồn tin">'+option('','Tất cả nguồn')+
    Object.entries(newsPublishers).map(([id,[name]])=>option(id,name)).join('')+'</div>'+
    arrow(1,'Cuộn đến các nguồn tiếp theo','›')+'</div>';
}
function newsFilters() {
  const option=(id,name,selected)=>'<option value="'+id+'"'+(id===selected?' selected':'')+'>'+escapeHtml(name)+'</option>';
  const clubNames=Object.entries(clubs).sort((a,b)=>a[1].name.localeCompare(b[1].name,'vi'));
  return '<div class="news-filters filters"><div><label for="news-league">Giải đấu</label><select id="news-league">'+
    option('','Tất cả giải',newsState.league)+Object.entries(leagues).map(([id,{name}])=>option(id,name,newsState.league)).join('')+
    '</select></div><div><label for="news-club">Câu lạc bộ</label><select id="news-club">'+
    option('','Tất cả CLB',newsState.club)+clubNames.map(([id,{name}])=>option(id,name,newsState.club)).join('')+'</select></div></div>';
}
function newsArticle(row, featured) {
  const [name]=newsPublishers[row.source];
  const tag=row.leagues.length===1?leagues[row.leagues[0]].name:row.leagues.map(id=>leagues[id].name).join(' · ');
  const lead=featured?'<div class="news-cover" data-competition="'+row.leagues[0]+'">'+
    row.clubs.slice(0,2).map(id=>crest(id)).join('')+
    (!row.clubs.length?'<img src="'+leagueLogo(row.leagues[0])+'" alt="" decoding="async" loading="lazy">':'')+'</div>':'';
  const url=safeUrl(row.url);
  return '<li class="news-entry"><article><a class="news-link" href="'+url+'" target="_blank" rel="noopener noreferrer">'+lead+
    '<div class="news-copy"><p class="news-competition">'+escapeHtml(tag)+'</p><h3>'+escapeHtml(row.title)+'</h3>'+
    '<div class="news-meta">'+newsMark(row.source)+'<span>'+escapeHtml(name)+'</span><time datetime="'+escapeHtml(row.publishedAt)+
    '">'+vnTimestamp.format(new Date(row.publishedAt))+'</time></div></div></a></article></li>';
}
function newsResults() {
  const feed=newsSnapshot;
  if (!feed) return '<p class="panel padded" role="status">'+(newsFailed?'Chưa tải được tin. <button type="button" class="text-button" data-news-retry>Thử lại</button>':'Đang tải tin…')+'</p>';
  const rows=feed.articles.filter(a=>(!newsState.source || a.source===newsState.source) &&
    (!newsState.league || a.leagues.includes(newsState.league)) && (!newsState.club || a.clubs.includes(newsState.club)));
  const selected=newsPublishers[newsState.source];
  const sourceStatus=feed.sources?.[newsState.source]?.status;
  const sourceDates=Object.values(feed.sources||{}).map(source=>Date.parse(source?.checkedAt)).filter(Number.isFinite);
  const lastSource=selected?Date.parse(feed.sources?.[newsState.source]?.checkedAt):
    Math.max(Date.parse(feed.lastSuccessfulCheckAt)||0,...sourceDates);
  const late=!Number.isFinite(lastSource) || lastSource<=0 || Date.now()-lastSource>20*60*1000;
  const unavailableCount=Object.values(feed.sources||{}).filter(source=>['unavailable','partial'].includes(source?.status)).length;
  const stamp='<p class="small muted news-stamp" role="status">'+
    (feed.mode==='sync'?'':'Bản chụp tin tức · ')+
    (lastSource>0?'Lần đọc nguồn thành công '+vnTimestamp.format(new Date(lastSource)):'Chưa có lần đọc nguồn thành công')+
    (navigator.onLine===false || newsFailed || late && rows.length?' · Đang dùng tin đã lưu':'')+
    (!selected && unavailableCount?' · '+unavailableCount+' nguồn gián đoạn':'')+'</p>';
  const unavailable=['unavailable','partial'].includes(sourceStatus)?'<p class="small muted news-stamp">'+
    (sourceStatus==='partial'?'Mới cập nhật được một phần từ ':'Chưa cập nhật được từ ')+escapeHtml(selected[0])+'. '+
    (newsState.source==='vff'?'':'<a href="'+safeUrl(selected[2])+'" target="_blank" rel="noopener noreferrer">Mở trang nguồn</a>')+'</p>':'';
  const sourceLinks=newsState.source==='vff'?newsVffSections():'';
  if (!rows.length) {
    const filtered=newsState.source || newsState.league || newsState.club;
    const reset=filtered?'<button type="button" class="button ghost" data-news-reset>Bỏ bộ lọc</button>':'';
    return stamp+unavailable+sourceLinks+'<div class="panel">'+empty(filtered?'Chưa có bài phù hợp với bộ lọc hiện tại.':'Chưa có tin để hiển thị.',reset)+'</div>';
  }
  const visible=rows.slice(0,newsState.limit);
  return stamp+unavailable+sourceLinks+'<section aria-labelledby="news-top-title"><h2 id="news-top-title" class="news-section-title">Mới nhất</h2>'+
    '<ul class="news-grid">'+visible.slice(0,6).map(row=>newsArticle(row,true)).join('')+'</ul></section>'+
    (visible.length>6?'<section aria-labelledby="news-more-title"><h2 class="news-section-title" id="news-more-title">Đọc tiếp</h2>'+
      '<ul class="news-list">'+visible.slice(6).map(row=>newsArticle(row,false)).join('')+'</ul></section>':'')+
    (visible.length<rows.length?'<div class="news-more"><button class="button ghost" type="button" data-news-more>Xem thêm tin</button></div>':'');
}
function newsView() {
  if (hosted && !newsSnapshot) newsSnapshot=parseNews(readJSON(newsKey));
  return heading('Tin tức','V.League 1, V.League 2 và Cúp Quốc gia')+
    '<section class="panel news-controls" aria-label="Bộ lọc tin tức">'+newsPaperRail()+newsFilters()+'</section>'+
    '<div id="news-results">'+newsResults()+'</div>';
}
function newsIsOpen() {
  return state.tab==='news' && !state.match && !state.missingMatch;
}
function refreshNewsView({filter=false}={}) {
  if (!newsIsOpen()) return;
  const active=document.activeElement;
  const result=byId('news-results');
  if (!result || (!filter && result.contains(active) && !active.hasAttribute('data-news-retry'))) return;
  const retryFocused=result.contains(active) && active.hasAttribute('data-news-retry');
  updateList('news-results',newsResults());
  if (retryFocused) {
    const next=result.querySelector('[data-news-retry],.news-link');
    (next||byId('news-league')).focus({preventScroll:true});
  }
}
function newsFallback() {
  if (window.VPF_NEWS) return Promise.resolve(parseNews(window.VPF_NEWS));
  return new Promise(resolve=>{
    const script=document.createElement('script');
    script.src=(webRelease?.root||'')+'news-snapshot.js';
    script.onload=()=>resolve(parseNews(window.VPF_NEWS));
    script.onerror=()=>{ script.remove(); resolve(null); };
    document.head.append(script);
  });
}
function loadNews(force=false) {
  if (!newsIsOpen() || pendingNews || (!force && syncedNews && Date.now()-newsState.requestedAt<newsRefreshMs)) return;
  newsState.requestedAt=Date.now();
  pendingNews=(async()=>{
    let next;
    newsFailed=false;
    if (hosted) {
      try {
        next=parseNews(await fetchWithDeadline('news-feed.json',{cache:'no-cache'}));
        if (!next) throw Error('Bản tin không hợp lệ');
      } catch { newsFailed=true; }
    }
    if (!next && !newsSnapshot) next=await newsFallback();
    if (!next && !newsSnapshot) newsFailed=true;
    if (next && (!newsSnapshot || Date.parse(next.checkedAt)>=Date.parse(newsSnapshot.checkedAt))) {
      newsSnapshot=next;
      if (hosted) try { localStorage.setItem(newsKey,JSON.stringify(next)); } catch { /* Lưu trong phiên. */ }
    }
    syncedNews=true;
    pendingNews=null;
    refreshNewsView();
  })();
}
function scrollNewsRail(direction) {
  const rail=byId('news-rail');
  const step=Math.round(rail.clientWidth*.74);
  rail.scrollBy({left:direction*step,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
}
function chooseNewsSource(id) {
  if (id && !Object.hasOwn(newsPublishers,id)) return;
  newsState.source=id;
  newsState.limit=articlesStep;
  for (const button of byId('news-rail').querySelectorAll('[data-news-source]')) setSelected(button,button.dataset.newsSource===id);
  refreshNewsView({filter:true});
}
