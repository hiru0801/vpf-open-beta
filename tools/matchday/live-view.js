'use strict';

const liveFeed = {summaries:{}, details:new Map(), loading:new Map(), reading:false};

function running(m) {
  return ['live','halfTime'].includes(m.status);
}

function sameLiveFixture(m, fixture) {
  return Array.isArray(fixture) && fixture.length===4 &&
    fixture[0]===sideId(m.home) && fixture[1]===sideId(m.away) &&
    fixture[2]===m.date && fixture[3]===m.time;
}

function liveSummary(m) {
  if (!m || m.status==='final' || m.status==='postponed' || m.liveObservedAt) return m;
  const value=liveFeed.summaries[m.id];
  if (!value || !sameLiveFixture(m,value.fixture) ||
      !['live','halfTime','final'].includes(value.status) ||
      !Array.isArray(value.score) || value.score.length!==2 ||
      value.score.some(n=>!Number.isInteger(n)||n<0) || !Number.isFinite(Date.parse(value.observedAt))) return m;
  return {...m,score:value.score,status:value.status,penalties:value.penalties,
    liveObservedAt:value.observedAt};
}

function liveDetail(m) {
  const display=liveSummary(m);
  const detail=liveFeed.details.get(m.id);
  if (!detail || !sameLiveFixture(m,detail.fixture)) return display;
  const timeline=detail.timeline;
  const sameScore=timeline && (display.status!=='final'||timeline.status==='final') &&
    timeline.score.join(':')===display.score?.join(':');
  const protectedEvents=m.evidence?.some(entry=>entry.fields.includes('events') &&
    entry.checks.some(check=>check.outcome==='differs' && check.fields.includes('events')));
  const events=sameScore && Array.isArray(timeline?.events) && !protectedEvents?timeline.events:display.events;
  const previous=display.matchSquads||[null,null];
  const lineup=detail.lineup;
  const squads=Array.isArray(lineup) && lineup.length===2 && lineup.some(Boolean)?
    lineup.map((team,side)=>{
      if (!team) return previous[side];
      const originals=previous[side];
      const changes=sameScore?timeline?.changes?.[side]||[]:[];
      const existing=[...(originals?.starters||[]),...(originals?.substitutes||[])];
      const key=name=>name.normalize('NFD').replace(/\p{M}/gu,'').replace(/đ/gi,'d')
        .toLowerCase().match(/[a-z0-9]+/g)?.sort().join('');
      const decorate=player=>{
        const applies=entry=>entry.number===player.number && key(entry.name)===key(player.name);
        const timing=changes.find(applies)||existing.find(applies)||player;
        return {...player,changeMinute:timing.changeMinute,exitMinute:timing.exitMinute};
      };
      return {starters:team.squad.starters.map(decorate),substitutes:team.squad.substitutes.map(decorate)};
    }):display.matchSquads;
  return {...display,events,matchSquads:squads,registrationSources:lineup,
    liveTimelineSource: sameScore&&timeline?timeline.source:null};
}

function liveStale(m) {
  return running(m) && Date.now()-Date.parse(m.liveObservedAt)>15*60000;
}

function liveSourceLink(url,label) {
  try {
    const link=new URL(url);
    if (link.protocol!=='https:' || link.hostname!=='vpf.vn') return '';
    return '<a href="'+escapeHtml(link.href)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(label)+' ↗</a>';
  } catch { return ''; }
}

function liveLineupSource(m,side) {
  const team=m.registrationSources?.[side];
  if (!team) return '';
  const official=team.kind==='registration';
  return '<p class="small muted">'+liveSourceLink(team.source,official?'VPF · Phiếu đăng ký':'VPF · Trang trận tạm thời')+
    (official&&Number.isFinite(Date.parse(team.publishedAt))?' · '+escapeHtml(vnTimestamp.format(new Date(team.publishedAt))):'')+'</p>';
}

function updateLiveDetail(id) {
  if (state.match!==id || !matches[id] || !byId('match-extra')) return;
  const base=matches[id], m=liveDetail(base);
  const score=content.querySelector('.score-value strong');
  if (score) score.textContent=m.score?m.score.join(' – '):m.status==='postponed'?'—':m.time||'—';
  const statusBox=content.querySelector('.score-status');
  if (statusBox) statusBox.innerHTML=matchStatus(m);
  const media=byId('match-media');
  if (media) media.innerHTML=matchMedia(m);
  if (base.hasDetail && !base.detailLoaded) return;
  const extra=byId('match-extra');
  const active=document.activeElement;
  const focused=controlKey(active,extra);
  const opened=new Set([...extra.querySelectorAll('details[open] > summary')].map(node=>node.textContent));
  extra.innerHTML=matchExtras(m);
  for (const node of extra.querySelectorAll('details > summary')) node.parentElement.open=opened.has(node.textContent);
  if (focused) [...extra.querySelectorAll('a,button,summary')].find(node=>controlKey(node,extra)===focused)?.focus({preventScroll:true});
}

async function loadLiveMatch(id) {
  const version=liveFeed.summaries[id]?.version;
  if (!/^[a-f0-9]{16}$/.test(version||'') || liveFeed.details.get(id)?.version===version || liveFeed.loading.has(id)) return;
  liveFeed.loading.set(id,version);
  try {
    const detail=await fetchWithDeadline('live/matches/'+encodeURIComponent(id)+'.json?v='+version);
    if (matches[id] && detail.version===version && liveFeed.summaries[id]?.version===version && sameLiveFixture(matches[id],detail.fixture)) {
      // Keep the current tab's memory bounded when browsing many archived matches.
      if (liveFeed.details.size>=20) liveFeed.details.delete(liveFeed.details.keys().next().value);
      liveFeed.details.set(id,detail);
      updateLiveDetail(id);
    }
  } catch { /* Keep showing the last confirmed snapshot. */ }
  finally { liveFeed.loading.delete(id); }
}

function liveListView() {
  return ['home','fixtures','following'].includes(state.tab) && !dialog.open;
}

async function refreshMatchDay() {
  if (!webRelease || liveFeed.reading || document.hidden) return;
  liveFeed.reading=true;
  try {
    // Share one CDN cache key per minute across all viewers.
    const index=await fetchWithDeadline('live/index.json?v='+Math.floor(Date.now()/60000));
    if (index.schema!==1 || index.season!==data.season || !index.matches || Array.isArray(index.matches)) return;
    const old=liveFeed.summaries;
    liveFeed.summaries=index.matches;
    for (const id of liveFeed.details.keys()) if (!Object.hasOwn(index.matches,id)) liveFeed.details.delete(id);
    if (state.match) {
      updateLiveDetail(state.match);
      await loadLiveMatch(state.match);
    } else if (liveListView() && JSON.stringify(old)!==JSON.stringify(index.matches)) {
      const active=document.activeElement;
      const focus=controlKey(active,content);
      const scroll=window.scrollY;
      render();
      if (focus) [...content.querySelectorAll('a,button,select,summary')].find(node=>controlKey(node,content)===focus)?.focus({preventScroll:true});
      window.scrollTo(0,scroll);
    }
  } catch { /* The base release and acknowledged match state remain usable. */ }
  finally { liveFeed.reading=false; }
}

function startMatchDay() {
  const poll=async()=>{
    if (state.match || liveListView()) await refreshMatchDay();
    const active=Object.values(liveFeed.summaries).some(m=>['live','halfTime'].includes(m.status) &&
      Date.now()-Date.parse(m.observedAt)<15*60000);
    setTimeout(poll,(active||state.match?60000:120000)+Math.floor(Math.random()*15000));
  };
  document.addEventListener('visibilitychange',()=>{ if (state.match || liveListView()) refreshMatchDay(); });
  poll();
}
