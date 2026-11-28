'use strict';

async function fetchWithDeadline(url, {timeout=8000, cache, read='json'}={}) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try {
    const response=await fetch(url,{cache,signal:controller.signal});
    if (!response.ok) throw Error('Chưa nhận được dữ liệu.');
    return await response[read]();
  } finally {
    clearTimeout(timer);
  }
}

// A single deployed release supplies both the index and all lazy resources.
async function webResource(type, id) {
  const value=await fetchWithDeadline(webRelease.root+type+'/'+encodeURIComponent(id)+'.json',{timeout:10000});
  if (value.releaseId!==webRelease.releaseId || value.id!==id || !value.data || !value.sources) {
    throw Error('Dữ liệu chi tiết khác phiên bản.');
  }
  Object.assign(sources,value.sources);
  return value.data;
}
const pendingResources=new Map();
async function loadSection({id,type,find,fill,error,label}) {
  const container=find();
  if (!container || pendingResources.get(container)) return;
  pendingResources.set(container,true);
  container.setAttribute('aria-busy','true');
  container.innerHTML='<p class="section-message" role="status">'+label+'</p>';
  try {
    const value=await webResource(type,id);
    fill(value,container);
  } catch {
    if (container.isConnected) container.innerHTML=error;
  } finally {
    pendingResources.delete(container);
    container.removeAttribute('aria-busy');
  }
}
async function checkUpstreamStatus() {
  try {
    const status=await fetchWithDeadline('data-status.json');
    if (status.schema!==1 || !['sync','snapshot'].includes(status.mode)) throw Error('Trạng thái nguồn không hợp lệ.');
    upstreamStatus=status;
  } catch {
    upstreamStatus=undefined;
  }
  renderUpstreamStatus();
}
function loadMatchDetail(id) {
  const match=matches[id];
  if (!webRelease || !match.hasDetail || match.detailLoaded) return;
  return loadSection({id,type:'matches',find:()=>byId('match-extra'),
    label:'Đang tải chi tiết trận…',
    fill(value,container){
      Object.assign(match,value,{detailLoaded:true});
      if (container.isConnected) {
        const current=liveDetail(match);
        container.innerHTML=matchExtras(current);
        byId('match-media').innerHTML=matchMedia(current);
      }
    },
    error:'<div class="detail-section"><p role="status">Chưa tải được chi tiết trận.</p><button class="button ghost" type="button" data-retry-match="'+id+'">Thử lại</button></div>'});
}
function loadClubRoster(id) {
  if (!webRelease) return;
  return loadSection({id,type:'clubs',find:()=>dialog.querySelector('[data-lazy-club="'+id+'"]'),
    label:'Đang tải danh sách đăng ký cầu thủ…',
    fill(value,container){
      if (value.legacy) clubs[id].roster=value.legacy;
      else (data.rosters??={})[id]=value;
      if (container.isConnected) {
        const previous=byId('club-roster').querySelector('details');
        const opened=previous.open;
        const focused=previous.contains(document.activeElement);
        byId('club-roster').innerHTML=clubRoster(id);
        const current=byId('club-roster').querySelector('details');
        current.open=opened;
        if (focused) current.querySelector('summary').focus({preventScroll:true});
      }
    },
    error:'<p role="status">Chưa tải được danh sách cầu thủ.</p><button class="button ghost" type="button" data-retry-club="'+id+'">Thử lại</button>'});
}
async function checkWebRelease(manual) {
  refreshing=true;
  renderFeedStatus();
  try {
    const latest=await fetchWithDeadline('release-info.json',{cache:'no-cache'});
    if (latest.season!==webRelease.season || !Number.isSafeInteger(latest.revision) ||
        latest.revision<1 || !/^[a-f0-9]{24}$/.test(latest.releaseId)) throw Error('Phiên bản sai.');
    if (latest.revision<webRelease.revision && !manual) {
      feedStatus='Máy chủ đang dùng bản dữ liệu trước';
      return;
    }
    const changed=latest.releaseId!==webRelease.releaseId;
    if (changed && latest.revision===webRelease.revision) throw Error('Phiên bản trùng.');
    lastVerified=new Date();
    feedStatus=changed?'Có bản mới · Bấm Kiểm tra cập nhật để mở':'';
    const watching=matches[state.match];
    const watchingFollowed=state.tab==='following' && !state.match && !state.missingMatch;
    const canRefresh=!dialog.open && (watchingFollowed || Boolean(watching && (!watching.score || !watching.highlightUrl)));
    if (changed && (manual || canRefresh)) {
      const key='vpf-auto-release:'+latest.releaseId;
      let autoReload=manual;
      if (!manual) {
        try { autoReload=!sessionStorage.getItem(key); } catch { /* Keep the current release when storage is unavailable. */ }
      }
      if (autoReload) {
        const next=await fetchWithDeadline('index.html',{cache:'reload',read:'text'});
        if (next.includes('releases/'+latest.releaseId+'/index-data.js')) {
          if (watchingFollowed) {
            const view={panel:followingPanel,scroll:window.scrollY,savedScroll:byId('saved-matches')?.scrollTop||0,
              focus:controlKey(document.activeElement,content)};
            history.replaceState({...history.state,followedViewReload:view},'');
          }
          try { sessionStorage.setItem(key,'1'); } catch { /* Manual reload still works. */ }
          location.reload();
        }
      }
    } else if (manual) announce('Đang dùng bản dữ liệu mới nhất đã nhận.');
  } catch {
    feedStatus='Đang dùng dữ liệu đã lưu';
    if (manual) announce('Chưa nhận được dữ liệu mới. Thử lại sau.');
  } finally {
    refreshing=false;
    renderFeedStatus();
  }
}
