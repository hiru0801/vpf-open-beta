'use strict';

const baseData = window.VPF_DATA;
const webRelease = window.VPF_WEB_RELEASE;
const leagueLogo = id => (webRelease?.assets||'assets/')+id+(webRelease?'.webp':'.png');
const data = structuredClone(baseData);
const {leagues, clubs, matches, ties, sources} = data;
const byId = id => document.getElementById(id);
const content = byId('content');
const dialog = byId('dialog');
const vnDate = new Intl.DateTimeFormat('vi-VN', {timeZone:'Asia/Ho_Chi_Minh', day:'2-digit', month:'2-digit', year:'numeric'});
const vnTimestamp = new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
const vnDay = new Intl.DateTimeFormat('vi-VN', {timeZone:'Asia/Ho_Chi_Minh', weekday:'long'});
const vnNumber = new Intl.NumberFormat('vi-VN');
const calendarDay = new Intl.DateTimeFormat('en', {timeZone:'Asia/Ho_Chi_Minh', year:'numeric', month:'2-digit', day:'2-digit'});
function todayVN() {
  const parts=Object.fromEntries(calendarDay.formatToParts(new Date()).map(x=>[x.type,x.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
}
const phases = ['Vòng loại','Vòng 1/8','Tứ kết','Bán kết','Chung kết'];
const mainPages = ['home','fixtures','competition','stats','news','following'];
const pages = [...mainPages,'clubs'];
const titleFor = {home:'Trang chủ',fixtures:'Lịch đấu',stats:'Thống kê',news:'Tin tức',following:'Theo dõi',clubs:'Câu lạc bộ'};
const key = 'vpf-app-v2/preferences';
const feedKey = 'vpf-app-v2.4.1/'+baseData.season+'/data'+location.pathname?.replace(/index\.html$/,'');
const hosted = ['https:','http:'].includes(location.protocol);
const quickDays = {yesterday:'Hôm qua',today:'Hôm nay',tomorrow:'Ngày mai'};
const ranges = {week:'7 ngày tới',round:'Theo vòng',all:'Tất cả các trận',results:'Kết quả'};
const periods = {...quickDays,...ranges};
let appliedFeed;
let feedStatus = '';
let refreshing = false;
let lastVerified;
let lastFeedAttempt=0;
let upstreamStatus;

function readStore(name) {
  try { return localStorage.getItem(name); } catch { return null; }
}
function readJSON(name) {
  try { return JSON.parse(readStore(name)) || {}; } catch { return {}; }
}
const saved = readJSON(key);
const prior = ['vl2','vleague2app','nationalcupapp'].flatMap(name => {
  const old = readJSON(name);
  return Array.isArray(old.f) ? old.f : [];
});
const favorites = new Set((Array.isArray(saved.favorites) ? saved.favorites : prior).filter(id => Object.hasOwn(clubs,id)));
const matchFavorites = new Set((Array.isArray(saved.matches)?saved.matches:[]).filter(id=>Object.hasOwn(matches,id)));
const cachedLeague = saved.league || readStore('vlapp');
const initialLeague = Object.hasOwn(leagues,cachedLeague) ? cachedLeague : 'vl1';
let state = {league:initialLeague, tab:'home'};
let dialogItems = [];
let returnFocus;
let noticeTimer;
let filtersOpen = false;
const fixtureBatchSize=48;
let fixtureLimit=fixtureBatchSize;
const filters = Object.fromEntries(Object.keys(leagues).map(id => {
  const previous = saved.filters?.[id] || {};
  return [id, {
    period: Object.hasOwn(periods,previous.period) ? previous.period : ['all','results'].includes(previous.round) ? previous.round
      : /^[1-9]\d?$/.test(previous.round) ? 'round':'week',
    round: validRound(id,previous.round) ? String(previous.round) : '',
    scope: previous.scope==='all' && previous.period!=='round' ? 'all':'league',
    club: Object.hasOwn(clubs,previous.club) ? previous.club : '',
    view: previous.view==='detail'?'detail':'compact',
    table: 'adaptive',
    cupRound: '2', cupView:'round', cupSide:'left', stats:previous.stats==='teams'?'teams':'players',
    clubMetric:['goalsFor','goalsAgainst','yellow','red'].includes(previous.clubMetric)?previous.clubMetric:'goalsFor',
    clubStatMode:previous.clubStatMode==='full'?'full':'compact',
    followedClub:clubs[previous.followedClub]?previous.followedClub:'',
    scoreMode:previous.scoreMode==='full'?'full':'compact'
  }];
}));
let clubQuery = '';
const followedViewReload=history.state?.followedViewReload;
let followingPanel = followedViewReload?.panel==='saved'?'saved':'teams';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = value => typeof value === 'string' && value.startsWith('https://') ? escapeHtml(value) : '';
const numberText = value => Number.isFinite(value) ? vnNumber.format(value) : '—';
const current = () => leagues[state.league];
const displayedLeague = () => matches[state.match]?.league||state.league;
const currentFilters = () => filters[state.league];
const dayLabel = date => date ? vnDay.format(new Date(date + 'T12:00:00+07:00')) : '';
const fullDate = date => date ? vnDate.format(new Date(date + 'T12:00:00+07:00')) : '';
const matchStart = m => m.date && m.time ? Date.parse(m.date + 'T' + m.time + ':00+07:00') : null;
const sortDay = m => m.date || m.window?.[0] || m.month || '9999';
const ordered = (a,b) => sortDay(a).localeCompare(sortDay(b)) || (a.time || '').localeCompare(b.time || '') || a.round-b.round;
const leagueMatches = league => Object.values(matches).filter(m => m.league===league).map(liveSummary);
const batch = ids => ids.map(id => matches[id]);
const roundName = m => m.league==='nc' ? phases[m.round-1] + (ties[m.tie].legs===2 ? ' · Lượt ' + (m.leg===1 ? 'đi' : 'về') : '') : 'Vòng ' + m.round + (m.makeup ? ' · Đá bù' : '');
const dataDate = () => appliedFeed ? vnDate.format(new Date(appliedFeed.publishedAt)) : fullDate(data.asOf);
const shiftedDay = (day,offset) => new Date(Date.parse(day)+offset*86400000).toISOString().slice(0,10);
const isFollowed = m => matchFavorites.has(m.id)||favorites.has(sideId(m.home))||favorites.has(sideId(m.away));

function validRound(id,round) {
  return /^[1-9]\d?$/.test(round) && Number(round)<=leagues[id].rounds;
}
function defaultRound(league) {
  const rows=leagueMatches(league);
  const next=rows.filter(m=>!m.score && m.date && m.date>=todayVN() && m.status!=='postponed').sort(ordered)[0];
  return String(next?.round || rows.filter(m=>m.score).sort((a,b)=>ordered(b,a))[0]?.round || 1);
}
function scopeTeams(f) {
  return f.scope==='all'?Object.keys(clubs):current().clubs;
}
function fixtureParams() {
  const f=currentFilters();
  return new URLSearchParams({period:f.period,scope:f.scope,view:f.view,...(f.club?{club:f.club}:{}),
    ...(f.period==='round'?{round:f.round||defaultRound(state.league)}:{})});
}
function routeHash(matchId) {
  const params=state.tab==='fixtures'?fixtureParams():new URLSearchParams();
  if (matchId) params.set('match',matchId);
  const query=params.toString();
  return '#'+state.league+'/'+state.tab+(query?'?'+query:'');
}
function save() {
  const settings = Object.fromEntries(Object.entries(filters).map(([id,{period,round,club,scope,view,scoreMode,followedClub,stats,clubMetric,clubStatMode}])=>[id,{period,round,club,scope,view,scoreMode,followedClub,stats,clubMetric,clubStatMode}]));
  try { localStorage.setItem(key, JSON.stringify({league:state.league,favorites:[...favorites],matches:[...matchFavorites],filters:settings})); }
  catch { /* The app remains usable with temporary preferences. */ }
}
function applyRoute() {
  const [path,query] = location.hash.slice(1).split('?');
  const [league,tab] = path.split('/');
  const params=new URLSearchParams(query);
  const id=params.get('match');
  state = {league:Object.hasOwn(leagues,league)?league:initialLeague, tab:pages.includes(tab)?tab:'home',
    match:Object.hasOwn(matches,id)?id:null, missingMatch:Boolean(id && !Object.hasOwn(matches,id))};
  fixtureLimit=history.state?.fixtureLimit||fixtureBatchSize;
  if (state.tab==='fixtures' && params.has('period')) {
    const f=currentFilters();
    const period=params.get('period');
    f.period=Object.hasOwn(periods,period)?period:'week';
    f.scope=f.period!=='round' && params.get('scope')==='all'?'all':'league';
    f.view=params.get('view')==='detail'?'detail':'compact';
    f.club=scopeTeams(f).includes(params.get('club'))?params.get('club'):'';
    f.round=validRound(state.league,params.get('round'))?params.get('round'):'';
  }
  render();
}
function navigate(tab, league=state.league, focus=true) {
  if (!pages.includes(tab) || !Object.hasOwn(leagues,league)) return;
  if (dialog.open) closeDetail();
  if (league===state.league && tab===state.tab && !state.match && !state.missingMatch) return;
  clubQuery = '';
  filtersOpen=false;
  fixtureLimit=fixtureBatchSize;
  state = {tab,league};
  history.pushState(null,'',routeHash());
  save();
  render();
  if (tab==='stats' && webRelease) refreshFeed();
  if (focus) {
    content.focus({preventScroll:true});
    window.scrollTo(0,0);
  }
}
function openMatch(id,trigger) {
  if (dialog.open) closeDetail();
  if (state.match===id) return;
  const previous=history.state;
  if (!state.match) {
    const savedList=trigger?.closest('#saved-matches');
    history.replaceState({...previous,listScroll:window.scrollY,listMatch:id,
      savedScroll:savedList?.scrollTop,savedMatch:Boolean(savedList)},'');
  }
  const nextHash=routeHash(id);
  if (state.match) history.replaceState(previous,'',nextHash);
  else history.pushState({fromList:true},'',nextHash);
  state.match=id;
  state.missingMatch=false;
  render();
  byId('match-title').focus({preventScroll:true});
  window.scrollTo(0,0);
}
function returnFromMatch() {
  if (history.state?.fromList) return history.back();
  const league=matches[state.match]?.league||state.league;
  state={league,tab:'fixtures'};
  history.replaceState(null,'',routeHash());
  render();
  content.focus({preventScroll:true});
  window.scrollTo(0,0);
}

function tieMatches(id) {
  return batch(ties[id].legs===1 ? ['nc-'+id] : ['nc-'+id+'-1','nc-'+id+'-2']);
}
function sideId(slot) {
  return window.VPF_UPDATES.sideId(ties,matches,slot);
}
function tieWinner(id) {
  return window.VPF_UPDATES.tieWinner(ties,matches,id);
}
function sideName(slot) {
  const id = sideId(slot);
  return id ? clubs[id].name : 'Thắng cặp ' + slot.slice(1);
}
function crest(slot, extra='') {
  const id = sideId(slot);
  const team = clubs[id];
  return team?.logo ? '<img class="crest '+extra+'" width="36" height="36" src="'+team.logo+'" alt="" decoding="async">'
    : '<span class="crest crest-missing '+extra+'" aria-hidden="true">'+escapeHtml(id || '?')+'</span>';
}
function sourceLink(id, label) {
  const entry = sources[id];
  if (!entry) return '';
  const url = safeUrl(entry[1]);
  return url ? '<a href="'+url+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(label || entry[0])+' ↗</a>'
    : '<span>'+escapeHtml(label || entry[0])+'</span>';
}
function tabButton(tab,label,cls='button ghost') {
  return '<button type="button" class="'+cls+'" data-tab="'+tab+'">'+escapeHtml(label)+'</button>';
}
function heading(title,sub='') {
  return '<header class="page-title"><h1>'+escapeHtml(title)+'</h1>'+(sub?'<p>'+escapeHtml(sub)+'</p>':'')+'</header>';
}
function panelHeading(title, action='') {
  return '<div class="panel-heading"><h2>'+escapeHtml(title)+'</h2>'+action+'</div>';
}
function empty(message, action='') {
  return '<div class="empty"><p>'+escapeHtml(message)+'</p>'+action+'</div>';
}
function saveButton(id) {
  const selected = favorites.has(id);
  return '<button type="button" class="button favorite'+(selected?' selected':'')+'" data-favorite="'+id+'" aria-pressed="'+selected+'"><span aria-hidden="true">'+(selected?'★':'☆')+'</span> '+(selected?'Đang theo dõi':'Theo dõi')+'</button>';
}
function matchStar(m,expanded=false) {
  const selected=matchFavorites.has(m.id);
  const label='Theo dõi trận '+sideName(m.home)+' – '+sideName(m.away);
  return '<button type="button" class="button match-star'+(selected?' selected':'')+'" data-match-star="'+m.id+'" aria-pressed="'+selected+'" aria-label="'+escapeHtml(label)+'"><span aria-hidden="true">'+(selected?'★':'☆')+'</span>'+(expanded?' <span>'+ (selected?'Đang theo dõi':'Theo dõi trận')+'</span>':'')+'</button>';
}

function status(m) {
  if (liveStale(m)) return ['Chờ VPF cập nhật','tbd'];
  if (m.status==='live') return ['Đang diễn ra','live'];
  if (m.status==='halfTime') return ['Nghỉ giữa hiệp','live'];
  if (m.status==='final' && m.score) return ['Đã kết thúc','final'];
  if (m.status==='postponed') return ['Hoãn','changed'];
  if (m.status==='provisional') return ['Lịch dự kiến','provisional'];
  if (!m.date || !m.time) return [m.date?'Chờ giờ thi đấu':'Chờ lịch thi đấu','tbd'];
  if (matchStart(m)<=Date.now()) return ['Chờ VPF công bố kết quả','tbd'];
  return m.changed ? ['Đã đổi lịch','changed'] : ['Đã xác nhận','scheduled'];
}
function timeText(m) {
  if (m.date && m.time) return fullDate(m.date)+' · '+m.time;
  if (m.date) return fullDate(m.date)+' · Chờ giờ thi đấu';
  if (m.window) return windowText(m.window);
  if (m.month) return 'Khung thi đấu tháng '+m.month.slice(5)+'/'+m.month.slice(0,4);
  return 'Chờ công bố ngày, giờ';
}
function windowText([from,to]) {
  return 'Dự kiến '+fullDate(from)+(from===to?'':' – '+fullDate(to));
}
function matchRow(m, options={}) {
  m=liveSummary(m);
  const [label, css] = status(m);
  const side = id => '<span class="match-team">'+crest(id)+'<span>'+escapeHtml(sideName(id))+'</span></span>';
  const result = m.score ? m.score.join(' – ') : m.status==='postponed'?'—':m.time || '—';
  const summary = m.score ? (m.penalties?'Luân lưu '+m.penalties.join('–'):label) : label;
  const context = (options.showLeague?leagues[m.league].name+' · ':'')+roundName(m)+(options.compact&&!options.groupedDate&&m.date?' · '+fullDate(m.date):'');
  const when = !m.score && m.date && m.time ? fullDate(m.date) : timeText(m);
  return '<div class="match-item'+(options.compact?' match-compact':'')+'"><button type="button" class="match-row" data-match="'+m.id+'" aria-label="'+escapeHtml(sideName(m.home)+' gặp '+sideName(m.away)+', '+result+', '+summary+', '+context+', '+timeText(m))+'">'+
    (options.hideContext?'':'<span class="match-context">'+escapeHtml(context)+'</span>')+'<span class="match-layout">'+side(m.home)+
    '<span class="match-center"><strong>'+escapeHtml(result)+'</strong><small class="'+css+'">'+escapeHtml(summary)+'</small></span>'+
    side(m.away)+'</span>'+
    '<span class="match-meta">'+escapeHtml((m.venue?'SVĐ '+m.venue+' · ':'')+when)+(options.chevron===false?'':'<span aria-hidden="true">›</span>')+'</span></button>'+matchStar(m)+'</div>';
}
function matchList(items, options={}) {
  if (!items.length) return empty(options.message || 'Không có trận phù hợp với bộ lọc.');
  if (!options.group) return '<div class="match-list">'+items.map(m=>matchRow(m,options)).join('')+'</div>';
  const groupKey=m=>m.date || m.window?.join('~') || m.month || '?';
  const groups = Map.groupBy ? Map.groupBy(items,groupKey) : items.reduce((map,m) => {
    const key = groupKey(m);
    if (!map.has(key)) map.set(key,[]);
    map.get(key).push(m);
    return map;
  },new Map());
  return [...groups].map(([group,rows])=>{
    const label=group.includes('~')?windowText(group.split('~')):
      group==='?'?'Chờ lịch thi đấu':group.length===7?'Khung thi đấu tháng '+group.slice(5)+'/'+group.slice(0,4):dayLabel(group);
    const date=group.length===10?' <time datetime="'+group+'">'+escapeHtml(fullDate(group))+'</time>':'';
    const lists=options.byLeague?Object.keys(leagues).map(id=>{
      const games=rows.filter(m=>m.league===id);
      if (!games.length) return '';
      const names=[...new Set(games.map(roundName))];
      return '<section class="league-group" data-group-league="'+id+'"><h3><span>'+escapeHtml(leagues[id].name)+'</span>'+
        (names.length===1?'<small>'+escapeHtml(names[0])+'</small>':'')+'</h3>'+
        matchList(games,{...options,group:false,groupedDate:true,showLeague:false,hideContext:options.compact&&names.length===1})+'</section>';
    }).join(''):matchList(rows,{...options,group:false,groupedDate:true});
    return '<section class="match-group"><h2>'+escapeHtml(label)+date+'</h2>'+lists+'</section>';
  }).join('');
}

function homeView() {
  const league=current();
  const rows=leagueMatches(state.league);
  const next=rows.filter(m=>!m.score && m.status==='scheduled' && matchStart(m)>Date.now()).sort(ordered);
  const recent=rows.filter(m=>m.status==='final' && m.score).sort((a,b)=>ordered(b,a));
  const followed=rows.filter(m=>isFollowed(m) && !m.score && m.date && m.date>=todayVN() && m.status!=='postponed').sort(ordered).slice(0,3);
  const live=rows.filter(running).sort(ordered);
  const main=(live.length?live:next.length?next:recent).filter(m=>!followed.includes(m)).slice(0,4);
  const showTitle=live.length?'Đang diễn ra':next.length?'Trận sắp tới':'Kết quả gần đây';
  const top=data.standings[state.league]?.slice(0,5);
  return '<section class="home-intro"><div><p class="caps">MÙA '+data.season+'</p><h1>'+escapeHtml(league.name)+'</h1><p class="hero-meta">'+escapeHtml(league.sponsor)+' <span aria-hidden="true">·</span> '+league.clubs.length+' câu lạc bộ</p></div><img width="118" height="98" src="'+leagueLogo(state.league)+'" alt=""></section>'+
    '<div class="home-grid"><div>'+
      '<div class="choices home-shortcuts"><button type="button" class="button ghost" data-fixture-filter="today">Hôm nay</button><button type="button" class="button ghost" data-fixture-filter="tomorrow">Ngày mai</button><button type="button" class="button ghost" data-fixture-filter="week">7 ngày tới</button></div>'+
      (followed.length?'<section class="panel">'+panelHeading('Trận bạn theo dõi',tabButton('following','Xem thêm','text-button'))+matchList(followed,{compact:true,showLeague:true})+'</section>':'')+
      (main.length?'<section class="panel">'+panelHeading(showTitle,tabButton('fixtures','Xem lịch','text-button'))+matchList(main,{compact:true})+'</section>':'')+
      (next.length?'<section class="panel">'+panelHeading('Kết quả gần đây', '<button type="button" class="text-button" data-fixture-filter="results">Xem kết quả</button>')+matchList(recent.slice(0,3))+'</section>':'')+
    '</div><aside class="home-aside">'+
      (top?'<section class="panel">'+panelHeading('Bảng xếp hạng',tabButton('competition','Xem tất cả','text-button'))+rankingTable(top,true)+
        (appliedFeed?.staleTables.includes(state.league)?'<p class="home-table-note small muted">Bảng đang chờ cập nhật kết quả mới.</p>':'')+'</section>'
      : '<section class="panel">'+panelHeading('Nhánh đấu',tabButton('competition','Xem nhánh','text-button'))+
        '<ul class="phase-summary">'+phases.map((p,i)=>'<li><span>'+p+'</span><strong>'+rows.filter(m=>m.round===i+1).length+' trận</strong></li>').join('')+'</ul></section>')+
      '<section class="panel padded">'+panelHeading('Câu lạc bộ',tabButton('clubs','Xem '+league.clubs.length+' đội','text-button'))+
        '<div class="team-palette">'+league.clubs.slice(0,7).map(id=>'<button class="club-mark" type="button" data-club="'+id+'" aria-label="'+escapeHtml(clubs[id].name)+'">'+crest(id)+'</button>').join('')+'</div></section>'+
      '<section class="panel padded">'+panelHeading('Thông tin từ VPF')+'<p class="small muted">Bản dữ liệu '+dataDate()+'</p><ul class="links-list">'+data.news[state.league].map(id=>'<li>'+sourceLink(id)+'</li>').join('')+'</ul></section>'+
    '</aside></div>';
}

function option(value,text,selected) {
  return '<option value="'+escapeHtml(value)+'"'+(String(value)===String(selected)?' selected':'')+'>'+escapeHtml(text)+'</option>';
}
function leagueNote() {
  const label = 'Lịch dự kiến và khung thi đấu được ghi riêng. Giờ hiển thị theo giờ Việt Nam.';
  return '<p class="data-note">'+escapeHtml(label)+' '+sourceLink(current().calendar,'Xem lịch VPF')+'</p>';
}
function fixturesView() {
  const f=currentFilters();
  const roundChoices=Array.from({length:current().rounds},(_,i)=>[i+1,state.league==='nc'?phases[i]:'Vòng '+(i+1)]);
  const teams=scopeTeams(f).slice().sort((a,b)=>clubs[a].name.localeCompare(clubs[b].name,'vi'));
  const rows=fixtureRows();
  const active=Number(Boolean(ranges[f.period]))+Number(f.scope==='all')+Number(Boolean(f.club));
  return heading('Lịch đấu',(f.scope==='all'?'Cả ba giải':current().name)+' · '+data.season)+
    '<div class="fixture-toolbar"><div class="day-controls"><div class="choices" role="group" aria-label="Chọn ngày">'+
    Object.entries(quickDays).map(([id,label])=>choice('fixture-period',id,label,id===f.period)).join('')+'</div>'+
    '<button class="button filter-button'+(active?' selected':'')+'" type="button" data-action="filters" aria-controls="fixture-filters" aria-expanded="'+filtersOpen+'">Lọc'+(active?' <span class="filter-count" aria-label="'+active+' bộ lọc đang bật">'+active+'</span>':'')+'</button></div>'+
    '<div id="fixture-filters" class="panel padded filter-panel"'+(filtersOpen?'':' hidden')+'><div class="filters">'+
    '<label>Khoảng thời gian<select id="period-filter">'+Object.entries(periods).map(([id,label])=>option(id,label,f.period)).join('')+'</select></label>'+
    (f.period==='round'?'<label>Vòng đấu<select id="round-filter">'+roundChoices.map(([v,n])=>option(v,n,f.round||defaultRound(state.league))).join('')+'</select></label>':
      '<label>Giải đấu<select id="scope-filter">'+option('league',current().name,f.scope)+option('all','Cả ba giải',f.scope)+'</select></label>')+
    '<label>Câu lạc bộ<select id="club-filter">'+option('','Tất cả câu lạc bộ',f.club)+teams.map(id=>option(id,clubs[id].name,f.club)).join('')+'</select></label></div>'+
    '<div class="filter-actions"><button class="text-button" type="button" data-action="clear-fixture-filters">Bỏ lọc CLB và giải</button>'+
    '<button class="button primary" type="button" data-action="filters-done">Xong</button></div></div></div>'+
    '<div class="fixture-meta"><p class="results-count" id="fixture-count" role="status">'+escapeHtml(periods[f.period])+' · '+rows.length+' trận</p>'+
    '<div class="choices" role="group" aria-label="Cách hiển thị lịch">'+choice('fixture-view','compact','Gọn',f.view==='compact')+choice('fixture-view','detail','Chi tiết',f.view==='detail')+'</div></div>'+
    '<div id="fixture-results">'+fixtureResults(rows)+'</div>'+(f.scope==='league'?leagueNote():'');
}
function fixtureRows() {
  const f=currentFilters();
  const today=todayVN();
  const end=shiftedDay(today,6);
  let rows=f.scope==='all'?Object.values(matches).map(liveSummary):leagueMatches(state.league);
  if (f.club) rows=rows.filter(m=>[sideId(m.home),sideId(m.away)].includes(f.club));
  if (Object.hasOwn(quickDays,f.period)) rows=rows.filter(m=>m.date===shiftedDay(today,{yesterday:-1,today:0,tomorrow:1}[f.period]));
  if (f.period==='week') rows=rows.filter(m=>m.date && m.date>=today && m.date<=end);
  if (f.period==='results') rows=rows.filter(m=>m.status==='final' && m.score);
  if (f.period==='round') {
    const round=Number(f.round||defaultRound(state.league));
    rows=rows.filter(m=>m.round===round);
  }
  return rows.sort(f.period==='results'?((a,b)=>ordered(b,a)):ordered);
}
function fixtureResults(rows=fixtureRows()) {
  const f=currentFilters();
  if (!rows.length) return empty('Không có trận theo bộ lọc này.', (f.period==='week'?'':'<button type="button" class="button ghost" data-fixture-period="week">Xem 7 ngày tới</button> ')+
    '<button type="button" class="button primary" data-fixture-reset="true">Xem tất cả các trận</button>');
  const opts={group:true,compact:f.view==='compact',byLeague:f.scope==='all'};
  const savedRows=rows.filter(isFollowed);
  const otherRows=rows.filter(m=>!isFollowed(m));
  const selectedIds=new Set([...savedRows,...otherRows].slice(0,fixtureLimit).map(m=>m.id));
  const visibleSaved=savedRows.filter(m=>selectedIds.has(m.id));
  const visibleOther=otherRows.filter(m=>selectedIds.has(m.id));
  const more=rows.length>selectedIds.size?
    '<div class="fixture-more"><button class="button ghost" type="button" data-action="more-fixtures">Hiện thêm trận</button><p class="small muted">Đang hiện '+selectedIds.size+' / '+rows.length+' trận</p></div>':'';
  return (visibleSaved.length?'<section class="match-group watched-group"><h2>Trận bạn theo dõi</h2>'+matchList(visibleSaved,{...opts,group:false,showLeague:f.scope==='all'})+'</section>':'')+
    (visibleOther.length?matchList(visibleOther,opts):'')+more;
}

function choice(action,value,text,selected) {
  return '<button type="button" class="button option'+(selected?' selected':'')+'" data-'+action+'="'+value+'" aria-pressed="'+selected+'">'+escapeHtml(text)+'</button>';
}
function cupView() {
  const f=currentFilters();
  return heading('Nhánh đấu',current().name+' · '+data.season)+
    '<div class="choices" aria-label="Dạng nhánh đấu">'+choice('cup-view','round','Theo vòng',f.cupView==='round')+choice('cup-view','tree','Sơ đồ',f.cupView==='tree')+'</div>'+
    '<div id="cup-results">'+cupResults()+'</div><p class="data-note">Bán kết và chung kết có lượt đi, lượt về. '+sourceLink('rule','Xem thể thức VPF')+'</p>';
}
function cupResults() {
  const f=currentFilters();
  const selected=Number(f.cupRound);
  if (f.cupView==='round') return '<div class="choices phase-choice" aria-label="Vòng đấu">'+phases.map((p,i)=>choice('cup-round',i+1,p,selected===i+1)).join('')+'</div>'+
    matchList(leagueMatches('nc').filter(m=>m.round===selected).sort(ordered),{group:true});
  return cupDiagram();
}

function statsView() {
  const f=currentFilters();
  return heading('Thống kê',current().name+' · '+data.season)+
    '<div class="choices" aria-label="Loại thống kê">'+choice('stats','players','Cầu thủ',f.stats==='players')+choice('stats','teams','Câu lạc bộ',f.stats==='teams')+'</div>'+
    '<div id="stats-results">'+statsResults()+'</div>';
}
function statsResults() {
  return currentFilters().stats==='players'?scorerView():clubStatsView();
}

function fold(s) {
  return s.toLocaleLowerCase('vi').normalize('NFD').replace(/\p{M}/gu,'').replace(/đ/g,'d');
}
function clubRows(ids) {
  return '<div class="clubs-grid">'+ids.map(id=>'<article class="panel club-card"><button class="club-card-link" type="button" data-club="'+id+'">'+crest(id)+
    '<span><strong>'+escapeHtml(clubs[id].name)+'</strong><small>'+escapeHtml(leagues[clubs[id].league].name)+'</small></span></button>'+saveButton(id)+'</article>').join('')+'</div>';
}
function clubResults() {
  const query=fold(clubQuery.trim());
  const ids=current().clubs.filter(id=>[clubs[id].name,id,...(clubs[id].aliases || [])].some(x=>fold(x).includes(query)))
    .sort((a,b)=>clubs[a].name.localeCompare(clubs[b].name,'vi'));
  return ids.length?clubRows(ids):empty('Không tìm thấy CLB phù hợp.');
}
function clubsView() {
  return heading('Câu lạc bộ',current().name+' · '+current().clubs.length+' đội')+
    '<div class="filters panel padded"><label>Tìm CLB<input id="club-search" type="search" placeholder="Tên hoặc tên viết tắt" value="'+escapeHtml(clubQuery)+'"></label></div>'+
    '<div id="club-results" aria-live="polite">'+clubResults()+'</div>';
}
const followingMatchLimit=5;

function followedClubs() {
  return current().clubs.filter(id=>favorites.has(id)).sort((a,b)=>clubs[a].name.localeCompare(clubs[b].name,'vi'));
}
function activeFollowedClub(ids) {
  const selected=currentFilters().followedClub;
  return ids.includes(selected)?selected:ids[0];
}
function followedClubMatches(id) {
  const rows=Object.values(matches).filter(m=>sideId(m.home)===id || sideId(m.away)===id).map(liveSummary);
  const today=todayVN();
  const now=Date.now();
  const next=rows.filter(m=>m.status!=='final' && m.status!=='postponed' && sortDay(m)!=='9999' &&
    ((m.date || m.window?.[1] || m.month+'-31')>=today ||
     (m.time && matchStart(m)>=now-24*60*60000))).sort(ordered);
  const recent=rows.filter(m=>m.status==='final' && m.score).sort((a,b)=>ordered(b,a));
  return {next:next.slice(0,followingMatchLimit),recent:recent.slice(0,followingMatchLimit)};
}
function followedClubPicker(ids,selected) {
  const arrow=(direction,label,symbol)=>'<button class="button club-arrow" type="button" data-follow-step="'+
    direction+'" aria-label="'+label+'"><span aria-hidden="true">'+symbol+'</span></button>';
  return '<div class="follow-picker">'+(ids.length>1?arrow('prev','Đội trước','‹'):'')+
    '<div class="follow-strip" id="follow-strip" role="group" aria-label="Đội đang theo dõi">'+ids.map(id=>
      '<button class="button option'+(id===selected?' selected':'')+'" type="button" data-follow-club="'+id+
      '" aria-pressed="'+(id===selected)+'" aria-controls="follow-club-games">'+crest(id)+
      '<span>'+escapeHtml(clubs[id].name)+'</span></button>').join('')+'</div>'+
    (ids.length>1?arrow('next','Đội tiếp theo','›'):'')+'</div>';
}
function followedClubGames(id) {
  const {next,recent}=followedClubMatches(id);
  return '<h3 class="sr-only">'+escapeHtml(clubs[id].name)+'</h3>'+
    '<p class="follow-scope small muted">Tất cả giải có trong ứng dụng</p>'+
    '<section class="follow-games"><h4>Trận sắp tới</h4>'+
      matchList(next,{showLeague:true,compact:true,message:'Chưa có lịch trận sắp tới.'})+'</section>'+
    '<section class="follow-games"><h4>Kết quả gần đây</h4>'+
      matchList(recent,{showLeague:true,compact:true,message:'Chưa có kết quả.'})+'</section>';
}
function savedMatchesView() {
  const rows=batch([...matchFavorites]).filter(m=>m.league===state.league)
    .sort((a,b)=>Number(Boolean(a.score))-Number(Boolean(b.score)) || (a.score?ordered(b,a):ordered(a,b)));
  const count=rows.length?'<span class="small muted">'+rows.length+' trận</span>':'';
  return panelHeading('Trận đã lưu',count)+
    '<div id="saved-matches" class="saved-matches"'+(rows.length?' tabindex="0" role="region" aria-label="Cuộn danh sách trận đã lưu"':'')+'>'+
    (rows.length?matchList(rows,{compact:true}):empty('Chưa có trận đã lưu ở '+current().name+'.',tabButton('fixtures','Xem lịch đấu','button ghost')))+'</div>';
}
function followingView() {
  const ids=followedClubs();
  const selected=activeFollowedClub(ids);
  return heading('Theo dõi',current().name+' · '+data.season)+
    '<div class="choices follow-mobile-switch" role="group" aria-label="Mục theo dõi">'+
      choice('follow-panel','teams','Đội của tôi',followingPanel==='teams')+
      choice('follow-panel','saved','Trận đã lưu',followingPanel==='saved')+'</div>'+
    '<div class="follow-grid" data-follow-visible="'+followingPanel+'">'+
      '<section class="panel follow-teams">'+panelHeading('Đội của tôi',tabButton('clubs','Chọn câu lạc bộ','text-button'))+
        (selected?followedClubPicker(ids,selected)+'<div id="follow-club-games">'+followedClubGames(selected)+'</div>':
          empty('Chưa theo dõi đội nào ở '+current().name+'.'))+'</section>'+
      '<section class="panel follow-saved" id="follow-saved">'+savedMatchesView()+'</section></div>';
}
function revealFollowedClub(button) {
  const strip=byId('follow-strip');
  if (!strip || !button) return;
  const view=strip.getBoundingClientRect();
  const target=button.getBoundingClientRect();
  if (target.left<view.left || target.right>view.right) strip.scrollLeft+=target.left-view.left;
}
function selectFollowedClub(id) {
  const ids=followedClubs();
  if (!ids.includes(id)) return;
  currentFilters().followedClub=id;
  for (const button of content.querySelectorAll('[data-follow-club]')) {
    setSelected(button,button.dataset.followClub===id);
    if (button.dataset.followClub===id) revealFollowedClub(button);
  }
  updateList('follow-club-games',followedClubGames(id));
  save();
}

function render() {
  const m=matches[state.match];
  const leagueId=displayedLeague();
  const league=leagues[leagueId];
  const activeTab=m?'fixtures':state.tab;
  const title=activeTab==='competition'?(leagueId==='nc'?'Nhánh đấu':'Bảng xếp hạng'):titleFor[activeTab];
  document.documentElement.dataset.league=leagueId;
  document.documentElement.classList.toggle('view-match',Boolean(m));
  document.title=(m?sideName(m.home)+' – '+sideName(m.away):title+' · '+league.name)+' | Bóng đá Việt Nam Open Beta';
  byId('league-logo').src=leagueLogo(leagueId);
  byId('league-name').textContent=league.name;
  byId('league-sponsor').textContent=league.sponsor+' · ';
  byId('league-season').textContent=data.season;
  renderFeedStatus();
  byId('nav').innerHTML=mainPages.map(tab=>{
    const selected=tab===activeTab;
    const label=tab==='competition'?(leagueId==='nc'?'Nhánh đấu':'Bảng xếp hạng'):titleFor[tab];
    return '<button type="button" data-tab="'+tab+'"'+(selected?' aria-current="page"':'')+'>'+escapeHtml(label)+'</button>';
  }).join('');
  const views={home:homeView,fixtures:fixturesView,competition:competitionView,stats:statsView,news:newsView,following:followingView,clubs:clubsView};
  content.innerHTML=m?matchDetail(liveDetail(m)):state.missingMatch?
    heading('Không tìm thấy trận',league.name)+'<section class="panel padded"><p>Liên kết có thể đã cũ. Bạn có thể tìm lại trận trong lịch đấu.</p><button class="button primary" type="button" data-action="match-back">Về lịch đấu</button></section>':
    views[state.tab]();
  if (m) {
    loadMatchDetail(m.id);
    loadLiveMatch(m.id);
  }
  else if (state.tab==='following') revealFollowedClub(content.querySelector('[data-follow-club].selected'));
  else if (newsIsOpen()) loadNews();
}
function updateList(id,html) {
  byId(id).innerHTML=html;
}
function announce(message) {
  const note=byId('notice');
  clearTimeout(noticeTimer);
  note.textContent=message;
  note.classList.add('visible');
  noticeTimer=setTimeout(()=>note.classList.remove('visible'),2400);
}

function renderFeedStatus() {
  const publication=appliedFeed?vnTimestamp.format(new Date(appliedFeed.publishedAt)):dataDate();
  byId('snapshot-label').textContent='Dữ liệu công bố '+publication+
    (lastVerified?' · Kiểm tra bản phát hành '+vnTimestamp.format(lastVerified):'')+
    (feedStatus?' · '+feedStatus:hosted?'':' · Ngoại tuyến');
  const refresh=byId('refresh-data');
  refresh.hidden=!hosted;
  refresh.setAttribute('aria-busy',String(refreshing));
  renderUpstreamStatus();
}
function renderUpstreamStatus() {
  const box=byId('data-health');
  if (!webRelease || !box) return;
  if (newsIsOpen()) {
    box.hidden=true;
    return;
  }
  const sourceTime=Date.parse(upstreamStatus?.lastSuccessfulCheckAt);
  const elapsed=Date.now()-sourceTime;
  const recent=Number.isFinite(elapsed) && elapsed>=-300000 && elapsed<=3*60*60000;
  const confirmed=recent && upstreamStatus?.state==='ok';
  const isSnapshot=upstreamStatus?.mode==='snapshot';
  const stamp=Number.isFinite(sourceTime)?' Lần đọc nguồn thành công gần nhất: '+vnTimestamp.format(new Date(sourceTime))+'.':'';
  const message=navigator.onLine===false?'Đang ngoại tuyến. Lịch và kết quả hiển thị từ bản đã lưu.':confirmed?'':isSnapshot?'Đang xem bản chụp ngày '+dataDate()+'. Chưa có đồng bộ lịch và kết quả tự động.'
    :'Đang dùng lịch và kết quả đã lưu. Chưa xác nhận được dữ liệu mới từ nguồn.'+stamp;
  const label=box.querySelector('p');
  if (label.textContent!==message) label.textContent=message;
  box.hidden=!message;
}
function applyFeed(feed) {
  if (feed?.revision===appliedFeed?.revision && appliedFeed) {
    if (feed.publishedAt!==appliedFeed.publishedAt) throw Error('Mốc công bố không khớp phiên bản.');
    return false;
  }
  const next=window.VPF_UPDATES.compile(baseData,feed);
  if (next.revision<(appliedFeed?.revision||0)) throw Error('Máy chủ đang trả về bản cũ hơn.');
  if (appliedFeed && Date.parse(next.publishedAt)<Date.parse(appliedFeed.publishedAt)) throw Error('Mốc phát hành cũ hơn bản đang dùng.');
  for (const id of Object.keys(appliedFeed?.matches||{})) matches[id]=structuredClone(baseData.matches[id]);
  for (const id of Object.keys(appliedFeed?.sources||{})) delete sources[id];
  Object.assign(matches,next.matches);
  Object.assign(sources,next.sources);
  data.standings={...structuredClone(baseData.standings),...next.tables};
  data.rosters=next.rosters;
  data.scorers=window.VPF_UPDATES.scorerTables(ties,matches,data.rosters);
  data.clubStats=window.VPF_UPDATES.clubStatTables(leagues,ties,matches);
  appliedFeed=next;
  return true;
}
function controlKey(control,region) {
  if (!control || !region.contains?.(control)) return null;
  if (control.id) return 'id:'+control.id;
  if (Object.keys(control.dataset||{}).length) return JSON.stringify(control.dataset);
  if (control.tagName==='SUMMARY') return 'summary:'+control.textContent.trim();
  if (control.tagName==='A') return 'link:'+control.href;
  return null;
}
async function refreshFeed(manual=false) {
  if (!hosted || refreshing || (!manual && Date.now()-lastFeedAttempt<60000)) return;
  lastFeedAttempt=Date.now();
  if (webRelease) return Promise.all([checkWebRelease(manual),checkUpstreamStatus()]);
  refreshing=true;
  feedStatus='Đang kiểm tra';
  renderFeedStatus();
  try {
    const {revision,season,publishedAt}=await fetchWithDeadline('release-info.json',{cache:'no-cache'});
    if(season!==baseData.season||!Number.isSafeInteger(revision)||revision<1||
      !Number.isFinite(Date.parse(publishedAt))) throw Error('Thông tin phiên bản chưa hợp lệ.');
    const hasNew=revision!==appliedFeed?.revision;
    let updated=false;
    if (hasNew) {
      const feed=await fetchWithDeadline('updates.json',{cache:'no-cache'});
      if (feed.revision!==revision||feed.publishedAt!==publishedAt||feed.season!==season) throw Error('Các tệp đang khác phiên bản.');
      updated=applyFeed(feed);
      if(updated) try { localStorage.setItem(feedKey,JSON.stringify(feed)); } catch { /* Retain data for this visit. */ }
    } else if (publishedAt!==appliedFeed.publishedAt) throw Error('Mốc công bố không khớp phiên bản.');
    lastVerified=new Date();
    if (updated) {
      const previous=document.activeElement;
      const controls='button, a, input, select, summary, [tabindex]';
      const region=dialog.open?dialog:content;
      const focusKey=controlKey(previous,region);
      const expanded=[...region.querySelectorAll('details[open]')].map(section=>section.querySelector('summary')?.textContent);
      const scroll=dialog.scrollTop;
      render();
      if (dialog.open) {
        renderDetail();
        dialog.scrollTop=scroll;
      }
      for (const section of region.querySelectorAll('details')) {
        if (expanded.includes(section.querySelector('summary')?.textContent)) section.open=true;
      }
      if (focusKey && !previous.isConnected) ([...region.querySelectorAll(controls)].find(node=>controlKey(node,region)===focusKey)||region).focus({preventScroll:true});
      if (manual) announce('Đã cập nhật dữ liệu.');
    } else if (manual) {
      announce('Đang dùng bản dữ liệu mới nhất đã nhận.');
    }
    feedStatus='';
  } catch {
    feedStatus='Đang dùng dữ liệu đã lưu';
    if (manual) announce('Chưa nhận được dữ liệu mới. Thử lại sau.');
  } finally {
    refreshing=false;
    renderFeedStatus();
  }
}

function showDetail(kind,id,trigger) {
  if (!dialog.open) {
    dialogItems = [];
    returnFocus = trigger;
  }
  dialogItems.push({kind,id});
  renderDetail();
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('[data-action="close"]').focus();
  dialog.scrollTop=0;
}
function closeDetail() {
  if (dialog.open) dialog.close();
  dialogItems=[];
}
function backDetail() {
  if (dialogItems.length<2) return;
  dialogItems.pop();
  renderDetail();
  dialog.querySelector('[data-action="close"]').focus();
  dialog.scrollTop=0;
}
function renderDetail() {
  const last=dialogItems.at(-1);
  byId('dialog-content').innerHTML={
    club:()=>clubDetail(last.id),picker:pickerView
  }[last.kind]();
  dialog.querySelector('[data-action="detail-back"]').hidden=dialogItems.length<2;
  if (last.kind==='club') loadClubRoster(last.id);
}
function detailHeading(title,meta='') {
  return '<header class="detail-heading"><h2 id="dialog-title">'+escapeHtml(title)+'</h2>'+(meta?'<p>'+escapeHtml(meta)+'</p>':'')+'</header>';
}
function pickerView() {
  const selected=displayedLeague();
  return detailHeading('Đổi giải')+'<div class="league-options">'+Object.entries(leagues).map(([id,league])=>
    '<button class="league-option'+(selected===id?' chosen':'')+'" type="button" data-league-choice="'+id+'"'+(selected===id?' aria-current="true"':'')+'>'+
    '<img alt="" width="48" height="48" src="'+leagueLogo(id)+'"><span><strong>'+escapeHtml(league.name)+'</strong><small>'+escapeHtml(league.sponsor)+' · '+data.season+'</small></span>'+
    (selected===id?'<span class="selected-mark">Đang xem</span>':'<span aria-hidden="true">›</span>')+'</button>').join('')+'</div>';
}
function matchUrl(m) {
  const url=new URL(location.href);
  url.hash=m.league+'/fixtures?match='+encodeURIComponent(m.id);
  return url.href;
}
async function copyText(value,input,message) {
  try {
    await navigator.clipboard.writeText(value);
    announce(message);
    byId('detail-message').textContent=message;
  } catch {
    input.hidden=false;
    input.focus();
    input.select();
    byId('detail-message').textContent='Sao chép đường dẫn từ ô bên trên.';
  }
}
function clubDetail(id) {
  const team=clubs[id];
  const rows=Object.values(matches).filter(m=>sideId(m.home)===id || sideId(m.away)===id).map(liveSummary);
  const upcoming=rows.filter(m=>!m.score && m.date && m.date>=todayVN() && m.status!=='postponed').sort(ordered).slice(0,6);
  const played=rows.filter(m=>m.status==='final' && m.score).sort((a,b)=>ordered(b,a)).slice(0,4);
  return '<header class="club-detail">'+crest(id)+'<div>'+detailHeading(team.name,leagues[team.league].name+' · '+data.season)+'</div></header>'+
    '<div class="choices">'+saveButton(id)+(hosted?'<button class="button ghost" type="button" data-copy-calendar="'+id+'">Sao chép link lịch CLB</button>':'')+'</div>'+
    (hosted?'<input class="share-input" id="share-url" aria-label="Đường dẫn lịch CLB" value="'+escapeHtml(clubCalendarUrl(id))+'" readonly hidden><p class="small muted" id="detail-message" role="status">Dán link vào mục đăng ký lịch qua URL trong ứng dụng lịch.</p>':'')+
    clubFacts(id)+'<div id="club-roster">'+clubRoster(id)+'</div>'+
    '<section class="detail-section"><h3>Trận sắp tới</h3>'+matchList(upcoming,{showLeague:true,message:'Chưa có lịch đủ ngày cho CLB.'})+'</section>'+
    '<section class="detail-section"><h3>Kết quả gần đây</h3>'+matchList(played,{showLeague:true})+'</section>'+
    '<p class="data-note">'+sourceLink(leagues[team.league].calendar,'Xem thông tin giải trên VPF')+'</p>';
}
function clubFacts(id) {
  const team=clubs[id];
  const profile=data.rosters?.[id]||team;
  const fields=[profile.year&&['Năm thành lập',profile.year],
    ['Sân nhà',profile.stadium],['HLV trưởng',profile.coach]].filter(Boolean);
  const source=profile.source?'<p class="small muted club-profile-source">'+sourceLink(profile.source,'Hồ sơ CLB trên VPF')+
    (profile.yearSource?' · '+sourceLink(profile.yearSource,'Nguồn năm thành lập'):'')+'</p>':'';
  return '<dl class="detail-facts club-facts">'+fields.map(([label,value])=>
    '<div><dt>'+label+'</dt><dd>'+escapeHtml(value||'Chưa xác nhận')+'</dd></div>').join('')+'</dl>'+source;
}
function clubRoster(id) {
  const team=clubs[id];
  const roster=data.rosters?.[id];
  const players=roster?roster.players:team.roster.map(([number,name,,position])=>({name,number,position}));
  const pending=webRelease&&team.hasRoster&&!roster&&!players.length;
  const count=players.length||team.rosterCount;
  const list=players.length?'<ul class="roster-list">'+players.map(({number,name,position})=>
    '<li><span class="shirt-number">'+escapeHtml(number??'—')+'</span><strong>'+escapeHtml(name)+
    '</strong><small>'+escapeHtml(position||'Chưa công bố')+'</small></li>').join('')+'</ul>':
    '<p class="section-message">Chưa có danh sách cầu thủ đã đối chiếu.</p>';
  return '<details class="detail-section roster"><summary>Danh sách đăng ký cầu thủ'+(count?' · '+count+' cầu thủ':'')+'</summary>'+
    (pending?'<div data-lazy-club="'+id+'"></div>':list)+'</details>';
}
function calendarText(m,now=new Date()) {
  return window.VPF_CALENDAR.render([window.VPF_CALENDAR.event(data,m,sideName(m.home)+' – '+sideName(m.away),now,roundName(m))]);
}
function clubCalendarUrl(id) {
  return new URL('calendars/'+encodeURIComponent(id)+'.ics',location.href).href;
}
function downloadCalendar(id) {
  const m=matches[id];
  if (!m || m.status!=='scheduled' || matchStart(m)<=Date.now()) return;
  const url=URL.createObjectURL(new Blob([calendarText(m)],{type:'text/calendar;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;
  link.download='vpf-'+m.id+'.ics';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function toggleFavorite(id) {
  if (!Object.hasOwn(clubs,id)) return;
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  save();
  const dialogIsOpen=dialog.open;
  const previousScroll=dialog.scrollTop;
  if (state.tab==='following' || state.tab==='clubs') render();
  if (dialogIsOpen) {
    renderDetail();
    dialog.scrollTop=previousScroll;
    dialog.querySelector('[data-favorite="'+id+'"]')?.focus({preventScroll:true});
  } else {
    (content.querySelector('[data-favorite="'+id+'"]') || content).focus({preventScroll:true});
  }
  announce((favorites.has(id)?'Đã theo dõi ':'Đã bỏ theo dõi ')+clubs[id].name);
}
function toggleMatchFavorite(id) {
  if (!Object.hasOwn(matches,id)) return;
  if (matchFavorites.has(id)) matchFavorites.delete(id);
  else matchFavorites.add(id);
  save();
  const focus=document.activeElement;
  if (!state.match && state.tab==='following') {
    const savedList=byId('saved-matches');
    const savedScroll=savedList.scrollTop;
    const previous=[...savedList.querySelectorAll('[data-match-star]')].indexOf(focus);
    updateList('follow-saved',savedMatchesView());
    const updated=byId('saved-matches');
    updated.scrollTop=savedScroll;
    if (!focus?.isConnected) {
      const buttons=updated.querySelectorAll('[data-match-star]');
      (buttons[Math.min(previous,buttons.length-1)]||updated.querySelector('button')||content).focus({preventScroll:true});
    }
  } else if (!state.match && ['fixtures','home'].includes(state.tab)) {
    render();
    if (!dialog.open && !focus?.isConnected) (content.querySelector('[data-match-star="'+id+'"]')||content).focus({preventScroll:true});
  }
  const selected=matchFavorites.has(id);
  document.querySelectorAll('[data-match-star="'+id+'"]').forEach(button=>{
    setSelected(button,selected);
    button.firstElementChild.textContent=selected?'★':'☆';
    if (button.children.length===2) button.lastElementChild.textContent=selected?'Đang theo dõi':'Theo dõi trận';
  });
  const message=selected?'Đã theo dõi trận.':'Đã bỏ theo dõi trận.';
  if (state.match && !dialog.open && byId('detail-message')) byId('detail-message').textContent=message;
  else announce(message);
}
function updateFixtures(focusSelector,resetLimit=false) {
  if (resetLimit) fixtureLimit=fixtureBatchSize;
  const f=currentFilters();
  if (f.period==='round') f.scope='league';
  if (!scopeTeams(f).includes(f.club)) f.club='';
  save();
  if (state.tab!=='fixtures') return navigate('fixtures');
  history.replaceState({fixtureLimit},'',routeHash());
  content.innerHTML=fixturesView();
  content.querySelector(focusSelector)?.focus({preventScroll:true});
}
function handleClick(event) {
  const el=event.target.closest('button, .skip-link');
  if (!el || el.disabled) return;
  if (el.classList.contains('skip-link')) {
    event.preventDefault();
    content.focus();
    return;
  }
  const d=el.dataset;
  if (d.tab) return navigate(d.tab,d.competitionLeague||matches[state.match]?.league||state.league);
  if (d.leagueChoice) {
    if (d.leagueChoice===displayedLeague()) return closeDetail();
    return navigate(state.tab,d.leagueChoice);
  }
  if (d.favorite) return toggleFavorite(d.favorite);
  if (d.matchStar) return toggleMatchFavorite(d.matchStar);
  if (d.match && Object.hasOwn(matches,d.match)) return openMatch(d.match,el);
  if (d.club && clubs[d.club]) return showDetail('club',d.club,el);
  if (d.calendar) return downloadCalendar(d.calendar);
  if (d.copyMatch && Object.hasOwn(matches,d.copyMatch)) return copyText(matchUrl(matches[d.copyMatch]),byId('share-url'),'Đã sao chép liên kết trận.');
  if (d.copyCalendar && Object.hasOwn(clubs,d.copyCalendar)) return copyText(clubCalendarUrl(d.copyCalendar),byId('share-url'),'Đã sao chép liên kết lịch CLB.');
  if (d.action==='refresh') return Promise.all([refreshFeed(true),refreshMatchDay()]);
  if (el.hasAttribute('data-news-retry')) return loadNews(true);
  if (el.hasAttribute('data-news-reset')) {
    Object.assign(newsState,{source:'',league:'',club:'',limit:articlesStep});
    content.querySelectorAll('.news-filters select').forEach(select=>{ select.value=''; });
    refreshNewsView({filter:true});
    byId('news-source').focus({preventScroll:true});
    return;
  }
  if (el.hasAttribute('data-news-more')) {
    const firstNew=newsState.limit;
    newsState.limit+=articlesStep;
    refreshNewsView({filter:true});
    content.querySelectorAll('.news-link')[firstNew]?.focus();
    return;
  }
  if (d.action==='picker') return showDetail('picker',null,el);
  if (d.action==='close') return closeDetail();
  if (d.action==='detail-back') return backDetail();
  if (d.action==='match-back') return returnFromMatch();
  if (d.retryMatch && d.retryMatch===state.match) return loadMatchDetail(d.retryMatch);
  if (d.retryClub===dialogItems.at(-1)?.id && d.retryClub) return loadClubRoster(d.retryClub);
  if (d.action==='filters' || d.action==='filters-done') {
    filtersOpen=d.action==='filters' && !filtersOpen;
    return updateFixtures(filtersOpen?'#period-filter':'[data-action="filters"]');
  }
  if (d.action==='more-fixtures') {
    const seen=new Set([...content.querySelectorAll('[data-match]')].map(button=>button.dataset.match));
    fixtureLimit+=fixtureBatchSize;
    history.replaceState({...history.state,fixtureLimit},'',routeHash());
    updateList('fixture-results',fixtureResults());
    [...content.querySelectorAll('[data-match]')].find(button=>!seen.has(button.dataset.match))?.focus();
    return;
  }
  if (d.action==='clear-fixture-filters') {
    Object.assign(currentFilters(),{scope:'league',club:''});
    filtersOpen=false;
    return updateFixtures('[data-action="filters"]',true);
  }
  if (d.fixtureFilter || d.fixturePeriod || d.fixtureReset) {
    const f=currentFilters();
    if (d.fixtureReset) Object.assign(f,{period:'all',scope:'league',club:''});
    else f.period=d.fixtureFilter||d.fixturePeriod;
    return updateFixtures(Object.hasOwn(quickDays,f.period)?'[data-fixture-period="'+f.period+'"]':'[data-action="filters"]',true);
  }
  if (d.fixtureView) {
    currentFilters().view=d.fixtureView;
    return updateFixtures('[data-fixture-view="'+d.fixtureView+'"]');
  }
  if (d.followPanel) {
    followingPanel=d.followPanel;
    content.querySelector('.follow-grid').dataset.followVisible=followingPanel;
    for (const button of content.querySelectorAll('[data-follow-panel]')) {
      setSelected(button,button.dataset.followPanel===followingPanel);
    }
    return;
  }
  if (d.followClub) return selectFollowedClub(d.followClub);
  if (d.followStep) {
    const ids=followedClubs();
    const offset=d.followStep==='prev'?-1:1;
    return selectFollowedClub(ids[(ids.indexOf(activeFollowedClub(ids))+offset+ids.length)%ids.length]);
  }
  if (d.tableView) {
    currentFilters().table=d.tableView;
    content.innerHTML=competitionView();
    content.querySelector('[data-table-view="'+d.tableView+'"]').focus({preventScroll:true});
    return;
  }
  if (d.cupSide) {
    currentFilters().cupSide=d.cupSide;
    updateList('cup-results',cupResults());
    content.querySelector('[data-cup-side="'+d.cupSide+'"]')?.focus({preventScroll:true});
    return;
  }
  if (d.scoreMode) {
    currentFilters().scoreMode=d.scoreMode;
    save();
    updateList('stats-results',statsResults());
    content.querySelector('[data-score-mode="'+d.scoreMode+'"]')?.focus({preventScroll:true});
    return;
  }
  if (d.cupView || d.cupRound) {
    const f=currentFilters();
    if (d.cupView) {
      f.cupView=d.cupView;
      document.querySelectorAll('[data-cup-view]').forEach(b=>setSelected(b,b.dataset.cupView===f.cupView));
    } else {
      f.cupRound=d.cupRound;
    }
    updateList('cup-results',cupResults());
    if (d.cupRound) content.querySelector('[data-cup-round="'+d.cupRound+'"]')?.focus({preventScroll:true});
    return;
  }
  if (d.clubStatMode) {
    currentFilters().clubStatMode=d.clubStatMode;
    save();
    updateList('stats-results',statsResults());
    content.querySelector('[data-club-stat-mode="'+d.clubStatMode+'"]')?.focus({preventScroll:true});
    return;
  }
  if (d.stats) {
    currentFilters().stats=d.stats;
    save();
    document.querySelectorAll('[data-stats]').forEach(b=>setSelected(b,b.dataset.stats===d.stats));
    updateList('stats-results',statsResults());
  }
}
function setSelected(button,on) {
  button.classList.toggle('selected',on);
  button.setAttribute('aria-pressed',String(on));
}

document.addEventListener('click',handleClick);
dialog.addEventListener('click',event=>{ if (event.target===dialog) closeDetail(); });
dialog.addEventListener('cancel',event=>{ event.preventDefault(); closeDetail(); });
dialog.addEventListener('close',()=>{
  if (dialog.open) return;
  dialogItems=[];
  if (document.activeElement===document.body || dialog.contains(document.activeElement)) {
    (returnFocus?.isConnected ? returnFocus : content).focus({preventScroll:true});
  }
});
document.addEventListener('change',event=>{
  const {id,value}=event.target;
  const newsField={'news-source':'source','news-league':'league','news-club':'club'}[id];
  if (newsField) {
    newsState[newsField]=value;
    newsState.limit=articlesStep;
    return refreshNewsView({filter:true});
  }
  if (id==='club-stat-filter') {
    currentFilters().clubMetric=value;
    save();
    updateList('stats-results',statsResults());
    byId(id)?.focus({preventScroll:true});
    return;
  }
  const field={'period-filter':'period','round-filter':'round','scope-filter':'scope','club-filter':'club'}[id];
  if (!field) return;
  currentFilters()[field]=value;
  updateFixtures('#'+id,true);
});
document.addEventListener('input',event=>{
  if (event.target.id!=='club-search') return;
  clubQuery=event.target.value;
  updateList('club-results',clubResults());
});
window.addEventListener('hashchange',()=>{
  const leftMatch=state.match;
  if (dialog.open) closeDetail();
  applyRoute();
  if (leftMatch && !state.match) {
    const {listMatch,listScroll,savedScroll,savedMatch}=history.state||{};
    const savedList=byId('saved-matches');
    if (savedList && Number.isFinite(savedScroll)) savedList.scrollTop=savedScroll;
    const target=listMatch?(savedMatch && savedList?savedList:content).querySelector('[data-match="'+CSS.escape(listMatch)+'"]'):null;
    if (target || Number.isFinite(listScroll)) {
      (target||content).focus({preventScroll:true});
      window.scrollTo(0,listScroll||0);
    }
  } else if (state.match) window.scrollTo(0,0);
});
try {
  if (webRelease) appliedFeed=webRelease;
  else if (window.VPF_RELEASE) applyFeed(window.VPF_RELEASE);
  else feedStatus='Đang dùng dữ liệu gốc';
} catch { feedStatus='Đang dùng dữ liệu gốc'; }
if (hosted) {
  try {
    const stored=readJSON(feedKey);
    if (!webRelease && stored.schema) applyFeed(stored);
  } catch { /* Invalid cache is ignored. */ }
}
if (!data.clubStats) data.clubStats=window.VPF_UPDATES.clubStatTables(leagues,ties,matches);
if (!data.scorers) data.scorers=window.VPF_UPDATES.scorerTables(ties,matches,data.rosters);
applyRoute();
if (followedViewReload) {
  const {followedViewReload: view, ...rest}=history.state;
  history.replaceState(rest,'');
  if (state.tab==='following' && !state.match) {
    const savedList=byId('saved-matches');
    if (savedList) savedList.scrollTop=view.savedScroll;
    if (view.focus) {
      const controls=content.querySelectorAll('button, a');
      const focused=[...controls].find(control=>view.focus===controlKey(control,content));
      (focused||content).focus({preventScroll:true});
    }
    window.scrollTo(0,view.scroll);
  }
}
if (hosted) {
  if (webRelease && window.isSecureContext && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('worker.js',{updateViaCache:'none'}).catch(()=>{ /* Online mode remains available. */ });
  }
  refreshFeed();
  if (webRelease) startMatchDay();
  const checkVisible=()=>{
    if (document.hidden) return;
    refreshFeed();
    loadNews();
  };
  setTimeout(()=>{
    checkVisible();
    setInterval(checkVisible,300000);
  },300000+Math.floor(Math.random()*15000));
  document.addEventListener('visibilitychange',checkVisible);
}
