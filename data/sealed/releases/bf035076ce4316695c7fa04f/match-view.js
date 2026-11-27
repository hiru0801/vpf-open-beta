'use strict';

function changeText(values) {
  const fields=[values.home&&values.away?sideName(values.home)+' – '+sideName(values.away):null,
    values.date||values.window?timeText(values):null,values.scheduleNote,values.venue?'Sân '+values.venue:null,values.broadcast,
    values.status==='postponed'?'Hoãn thi đấu':null].filter(Boolean);
  return fields.join(' · ')||'Chờ xác nhận lịch';
}
function isScheduleUpdate(entry) {
  const fields=['date','time','venue','window','status','home','away'];
  return Boolean(entry.beforeLabel || fields.some(field=>
    JSON.stringify(entry.before?.[field]??null)!==JSON.stringify(entry.after?.[field]??null)));
}
function scheduleComparison(entry) {
  return '<dl class="schedule-comparison"><div><dt>Trước</dt><dd>'+
    escapeHtml(entry.beforeLabel||changeText(entry.before||{}))+'</dd></div><div><dt>Sau</dt><dd>'+
    escapeHtml(changeText(entry.after||{}))+'</dd></div></dl>';
}
function matchHistory(m) {
  const entries=m.history?.filter(isScheduleUpdate);
  if (!entries?.length) return '';
  return '<details class="detail-section match-disclosure"><summary>Lịch sử thay đổi lịch</summary><ol class="history-list">'+
    entries.slice().reverse().map(entry=>'<li><strong>'+escapeHtml(vnTimestamp.format(new Date(entry.at)))+'</strong>'+
      scheduleComparison(entry)+'<p class="small">'+
      (entry.beforeSource&&entry.beforeSource!==entry.source?sourceLink(entry.beforeSource,'Lịch trước điều chỉnh')+' · ':'')+
      sourceLink(entry.source,'Nguồn công bố')+'</p></li>').join('')+'</ol></details>';
}
function parseGoal(raw) {
  const trimmed=raw.trim();
  const suffix=trimmed.match(/\s*\((P|OG|phạt đền|phản lưới nhà)\)$/i);
  const description=suffix?trimmed.slice(0,suffix.index).trim():trimmed;
  const minute=description.match(/\s+(\d+(?:\+\d+)?)['′]?$/);
  const name=minute?description.slice(0,minute.index).trim():description;
  const kind=suffix?(/^(P|phạt đền)$/i.test(suffix[1])?'Phạt đền':'Phản lưới nhà'):'';
  return {name,minute:minute?.[1],kind};
}
const eventLabels={goal:'Bàn thắng',penalty:'Bàn thắng từ phạt đền',ownGoal:'Phản lưới nhà',
  yellow:'Thẻ vàng',secondYellow:'Thẻ vàng thứ hai',red:'Thẻ đỏ',missedPenalty:'Hỏng phạt đền'};
function orderMinute(value) {
  if (!value) return Infinity;
  const [base,added='0']=value.split('+');
  return Number(base)*100+Number(added);
}
function matchTimeline(m) {
  const events=m.events??m.goals?.flatMap((team,side)=>team.map(raw=>{
    const {name,minute,kind}=parseGoal(raw);
    return {name,minute,side,type:kind==='Phản lưới nhà'?'ownGoal':kind?'penalty':'goal'};
  }))??[];
  return events.slice().sort((a,b)=>orderMinute(a.minute)-orderMinute(b.minute));
}
function matchEvents(m) {
  if (!m.score) return '';
  const timeline=matchTimeline(m);
  const goals=window.VPF_UPDATES.goalCounts(timeline);
  const shownCards=window.VPF_UPDATES.timelineCards(m.events);
  const cardDifferences=shownCards?['yellow','red'].filter(key=>
    m[key]?.some((value,side)=>value!==shownCards[key][side])):[];
  const events=timeline.map(e=>{
    const credited=e.side?m.away:m.home;
    const team=e.type==='ownGoal'?(e.side?m.home:m.away):credited;
    const context=e.type==='ownGoal'?'Bàn tính cho '+sideName(credited):sideName(team);
    const key=e.type==='yellow'?'yellow':['red','secondYellow'].includes(e.type)?'red':'goal';
    return '<li><span class="event-minute">'+escapeHtml(e.minute?e.minute+'′':'—')+'</span>'+
      '<span class="event-indicator '+key+'" aria-hidden="true">'+(key==='goal'?'●':'■')+'</span>'+crest(team)+
      '<div><strong>'+escapeHtml(e.name)+'</strong><small>'+escapeHtml(eventLabels[e.type]+' · '+context)+'</small></div></li>';
  });
  const inconsistent=m.matchSquads&&timeline.some(e=>m.matchSquads[e.type==='ownGoal'?1-e.side:e.side]?.substitutes.some(p=>
    p.number!==null&&p.number===e.number&&p.name===e.name&&p.changeMinute&&orderMinute(e.minute)<orderMinute(p.changeMinute)));
  return '<section class="detail-section" aria-labelledby="timeline-title"><h2 id="timeline-title">Diễn biến trận đấu</h2>'+
    (events.length?'<ol class="update-list goal-list">'+events.join('')+'</ol>':
      '<p class="section-message">Chưa có diễn biến chi tiết cho trận này.</p>')+
    (events.length&&m.score.some((total,side)=>total!==goals[side])?'<p class="data-note">Danh sách bàn thắng chưa đủ so với tỷ số.</p>':'')+
    (cardDifferences.length?'<div class="data-note"><p>Số thẻ trong diễn biến khác số liệu tổng hợp VPF. Mỗi cặp số theo thứ tự chủ nhà – đội khách.</p><ul>'+
      cardDifferences.map(key=>'<li>'+eventLabels[key]+': diễn biến '+shownCards[key].join('–')+
        ', tổng hợp '+m[key].join('–')+'.</li>').join('')+'</ul></div>':'')+
    (inconsistent?'<p class="data-note">Trang VPF ghi sự kiện của cầu thủ dự bị trước mốc vào sân. Xem mục Nguồn và đối chiếu.</p>':'')+'</section>';
}
function squadList(players,changeLabel) {
  if (!players.length) return '<p class="section-message">Chưa có danh sách cầu thủ dự bị.</p>';
  return '<ul class="roster-list">'+players.map(p=>
    '<li><span class="shirt-number"'+(p.number===null?' aria-label="Chưa rõ số áo"':'')+'>'+escapeHtml(p.number??'—')+
    '</span><strong>'+escapeHtml(p.name)+'</strong><small>'+
    escapeHtml([p.position,p.changeMinute?changeLabel+' '+p.changeMinute+'′':null,p.exitMinute?'Rời sân '+p.exitMinute+'′':null].filter(Boolean).join(' · '))+
    '</small></li>').join('')+'</ul>';
}
function matchLineup(m) {
  const squads=m.matchSquads??m.lineups?.map(side=>({starters:side.map(name=>({name,number:null})),substitutes:[]}));
  if (!squads) return m.score?'<details class="detail-section match-disclosure"><summary>Đội hình và thay người</summary><p class="section-message">Chưa có danh sách thi đấu đã đối chiếu.</p></details>':'';
  const renderGroup=(type,heading,changeLabel)=>'<section class="squad-group"><h2>'+heading+'</h2><div class="match-squad">'+
    squads.map((squad,side)=>'<section class="squad-team"><h3>'+escapeHtml(sideName(side?m.away:m.home))+'</h3>'+
      (type==='starters'&&squad&&squad.starters.length<11?'<p class="data-note">Nguồn liệt kê '+squad.starters.length+'/11 cầu thủ xuất phát.</p>':'')+
      (squad?squadList(squad[type],changeLabel):'<p class="section-message">Chưa có danh sách đội này.</p>')+'</section>').join('')+'</div></section>';
  return '<details class="detail-section match-disclosure"><summary>Đội hình và thay người</summary>'+
    renderGroup('starters','Xuất phát','Rời sân')+
    (m.matchSquads?renderGroup('substitutes','Dự bị','Vào sân'):'<p class="section-message">Chưa có số áo, danh sách dự bị và phút thay người.</p>')+'</details>';
}
function mediaLink(url,label) {
  return safeUrl(url)?'<a class="button primary" href="'+safeUrl(url)+'" target="_blank" rel="noopener noreferrer">'+label+'</a>':'';
}
function matchDetail(m) {
  const [label,cls]=status(m);
  const showSide=slot=>{
    const id=sideId(slot);
    const team=crest(slot)+'<strong>'+escapeHtml(sideName(slot))+'</strong>';
    return id?'<button class="score-team" type="button" data-club="'+id+'">'+team+'</button>':'<div class="score-team">'+team+'</div>';
  };
  const middle=m.score?m.score.join(' – '):m.status==='postponed'?'—':m.time || '—';
  const hasScoreTotal=m.league==='nc' && ties[m.tie].legs===2;
  const pair=hasScoreTotal?tieMatches(m.tie):[];
  const bothPlayed=pair.length===2 && pair.every(game=>game.score);
  const total=bothPlayed?[pair[0].score[0]+pair[1].score[1],pair[0].score[1]+pair[1].score[0]]:null;
  return '<article class="match-page"><header class="match-page-header"><button class="text-button" type="button" data-action="match-back">'+(history.state?.fromList?'Quay lại':'Về lịch đấu')+'</button>'+
    '<h1 id="match-title" tabindex="-1">Chi tiết trận</h1><p>'+escapeHtml(leagues[m.league].name+' · '+roundName(m))+'</p></header>'+
    '<section class="scoreboard"><div class="score-grid">'+showSide(m.home)+'<div class="score-value"><strong>'+escapeHtml(middle)+'</strong></div>'+showSide(m.away)+'</div>'+
    '<div class="score-status"><span class="status-tag '+cls+'">'+label+'</span>'+
    (m.penalties?'<small>Luân lưu '+m.penalties.join('–')+'</small>':'')+'</div>'+
    (total?'<p class="small centered">Tổng tỷ số '+total.join(' – ')+'</p>':'')+'</section>'+
    '<div id="match-sections" class="match-sections">'+matchSections(m)+'</div></article>';
}
function matchSections(m) {
  const loading=m.hasDetail && !m.detailLoaded;
  return '<div class="match-overview"><dl class="detail-facts match-facts"><div><dt>Ngày và giờ thi đấu</dt><dd>'+
    escapeHtml((m.status==='postponed'&&m.date?'Lịch cũ · ':'')+timeText(m))+'</dd></div>'+
    '<div><dt>Sân vận động</dt><dd>'+escapeHtml(m.venue||'Chờ công bố')+'</dd></div>'+
    '<div><dt>Kênh phát sóng</dt><dd>'+escapeHtml(m.broadcast||'Chưa có thông tin')+'</dd></div></dl>'+
    (m.scheduleNote?'<p class="schedule-note">'+escapeHtml(m.scheduleNote)+'</p>':'')+
    '<div class="choices match-actions">'+matchStar(m,true)+'<span class="match-media" id="match-media">'+(loading?'':matchMedia(m))+'</span>'+
    (hosted?'<button type="button" class="button ghost" data-copy-match="'+m.id+'">Sao chép liên kết</button>':'')+
    '</div><input class="share-input" id="share-url" aria-label="Đường dẫn đến trận" value="'+
    (hosted?escapeHtml(matchUrl(m)):'')+'" readonly hidden><p class="small muted" id="detail-message" role="status"></p></div>'+
    '<div class="match-sections" id="match-extra">'+(loading?'<p class="detail-section" role="status">Đang tải chi tiết trận…</p>':matchExtras(m))+'</div>';
}
function matchMedia(m) {
  return (m.score?mediaLink(m.highlightUrl,'Xem video tổng hợp'):
    m.status==='scheduled'?mediaLink(m.watchUrl,'Mở trang phát sóng'):'')+
    (m.status==='scheduled' && matchStart(m)>Date.now()?'<button type="button" class="button ghost" data-calendar="'+m.id+'">Thêm vào lịch</button>':'');
}
function matchExtras(m) {
  const hasScoreTotal=m.league==='nc' && ties[m.tie].legs===2;
  const pair=hasScoreTotal?tieMatches(m.tie):[];
  const matchSources=[...new Set([m.source,m.timingSource,m.goalsSource,m.pairSource,m.lineupsSource,m.eventsSource,m.squadsSource,m.watchSource,m.highlightSource].filter(Boolean))];
  const {yellow,red,derived}=window.VPF_UPDATES.matchCards(m);
  return matchEvents(m)+matchLineup(m)+
    (Number.isFinite(m.attendance)||yellow||red?'<details class="detail-section match-disclosure"><summary>Thống kê trận đấu</summary><dl class="detail-facts">'+
    (Number.isFinite(m.attendance)?'<div><dt>Khán giả</dt><dd>'+numberText(m.attendance)+'</dd></div>':'')+
    (yellow?'<div><dt>Thẻ vàng</dt><dd>'+yellow.join(' – ')+'</dd></div>':'')+
    (red?'<div><dt>Thẻ đỏ</dt><dd>'+red.join(' – ')+'</dd></div>':'')+'</dl>'+
    (yellow||red?'<p class="small muted">Số thẻ theo thứ tự đội nhà – đội khách.'+
      (derived?' Tính từ diễn biến do VPF công bố.':'')+'</p>':'')+'</details>':'')+
    '<div class="match-related"><button type="button" class="text-button" data-tab="competition" data-competition-league="'+m.league+'">'+
    (m.league==='nc'?'Xem nhánh đấu':'Xem bảng xếp hạng')+'</button></div>'+matchHistory(m)+
    (hasScoreTotal?'<section class="detail-section"><h3>Hai lượt của cặp đấu</h3><div class="choices">'+pair.map(game=>'<button type="button" class="button ghost" data-match="'+game.id+'"'+(game.id===m.id?' disabled':'')+'>Lượt '+(game.leg===1?'đi':'về')+'</button>').join('')+'</div></section>':'')+
    '<details class="detail-section match-disclosure"><summary>Nguồn và đối chiếu</summary><ul class="links-list">'+
    matchSources.map(source=>'<li>'+sourceLink(source)+'</li>').join('')+'</ul>'+matchEvidence(m)+'</details>';
}
function matchEvidence(m) {
  const labels={date:'Ngày thi đấu',time:'Giờ thi đấu',venue:'Sân vận động',window:'Khung thi đấu',scheduleNote:'Điều kiện xếp lịch',broadcast:'Kênh phát sóng',
    home:'Đội nhà',away:'Đội khách',status:'Trạng thái',score:'Tỷ số',penalties:'Luân lưu',goals:'Diễn biến ghi bàn',lineups:'Đội hình xuất phát',
    events:'Diễn biến trận đấu',matchSquads:'Đội hình và thay người',
    attendance:'Khán giả',yellow:'Thẻ vàng',red:'Thẻ đỏ',watchUrl:'Trang phát sóng',highlightUrl:'Video tổng hợp'};
  return (m.evidence||[]).slice().reverse().map(entry=>
    '<div class="evidence-box"><strong>'+escapeHtml(entry.fields.map(field=>labels[field]||field).join(' · '))+'</strong>'+
    '<p class="small">Nguồn công bố '+sourceLink(entry.source)+'</p>'+
    (entry.checks.length?'<ul class="links-list">'+entry.checks.map(check=>'<li>'+sourceLink(check.source)+' <span class="muted">'+
    (check.outcome==='agrees'?'Trùng khớp':'Khác nguồn công bố')+' · '+escapeHtml(check.fields.map(field=>labels[field]||field).join(', '))+'</span></li>').join('')+'</ul>':'')+
    (entry.note?'<p class="small muted">'+escapeHtml(entry.note)+'</p>':'')+'</div>').join('');
}
