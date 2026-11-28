'use strict';

// Bracket structure follows the reviewed tie slots, including choices made after the draw.
function cupBracket(finalId) {
  const final=ties[finalId];
  const branches=final.slots.map(slot=>{
    const columns=new Map();
    const visit=id=>{
      const tie=ties[id];
      if (!columns.has(tie.round)) columns.set(tie.round,[]);
      columns.get(tie.round).push(id);
      for (const parent of tie.slots) if (parent.startsWith('@')) visit(parent.slice(1));
    };
    visit(slot.slice(1));
    return [1,2,3,4].map(round=>columns.get(round)||[]);
  });
  return {
    branches,finalId,
    columns:[...branches[0].slice(1),[finalId],...branches[1].slice(1).reverse()]
  };
}

function cupPairCard(id) {
  const tie=ties[id];
  const pair=tieMatches(id);
  const winner=tieWinner(id);
  const first=pair[0],last=pair.at(-1);
  const totals=first.score&&last.score&&tie.legs===2?
    [first.score[0]+last.score[1],first.score[1]+last.score[0]]:first.score;
  const decision=last.penalties?'<p class="cup-decision">Luân lưu '+last.penalties.join('–')+'</p>':'';
  return '<article class="cup-pair" aria-label="'+escapeHtml(phases[tie.round-1]+' · Cặp '+id)+'">'+
    '<div class="cup-pair-meta"><span>Cặp '+id+'</span>'+(tie.legs===2&&first.score&&last.score?'<span>Tổng tỷ số</span>':'')+'</div>'+
    [first.home,first.away].map((slot,i)=>{
      const won=winner&&winner===sideId(slot);
      return '<div class="cup-team'+(won?' advanced':'')+'">'+crest(slot)+'<strong>'+escapeHtml(sideName(slot))+'</strong>'+
        (totals?'<b>'+totals[i]+'</b>':'')+(won?'<span class="sr-only">Đi tiếp</span>':'')+'</div>';
    }).join('')+decision+
    '<div class="cup-pair-actions">'+pair.map(m=>{
      const text=tie.legs===2?(m.leg===1?'Lượt đi':'Lượt về'):m.score?'Chi tiết':m.date?'Xem lịch':'Chờ lịch';
      return '<button class="button ghost" type="button" data-match="'+m.id+'" aria-label="'+escapeHtml(text+' · Cặp '+id)+'">'+text+'</button>';
    }).join('')+'</div></article>';
}

function cupConnections(columns) {
  const locations=new Map();
  columns.forEach((column,x)=>column.forEach((id,y)=>{
    locations.set(id,[50+x*100,600*(y+.5)/column.length]);
  }));
  const edges=[...locations].flatMap(([id,[x,y]])=>ties[id].slots.flatMap(slot=>{
    const start=slot.startsWith('@')?locations.get(slot.slice(1)):null;
    if (!start) return [];
    const middle=(start[0]+x)/2;
    return '<path d="M'+start[0]+' '+start[1]+' H'+middle+' V'+y+' H'+x+'" />';
  }));
  return '<svg class="cup-connections" viewBox="0 0 700 600" preserveAspectRatio="none" aria-hidden="true" focusable="false">'+edges.join('')+'</svg>';
}
function cupSection(name,ids) {
  return '<section class="cup-stage-list"><h3>'+escapeHtml(name)+'</h3><div>'+ids.map(cupPairCard).join('')+'</div></section>';
}
function cupDiagram() {
  const finalId=Object.keys(ties).find(id=>ties[id].round===phases.length);
  const layout=cupBracket(finalId);
  const labels=['Vòng 1/8','Tứ kết','Bán kết','Chung kết','Bán kết','Tứ kết','Vòng 1/8'];
  const chosen=currentFilters().cupSide;
  const qualifiers=layout.branches.map(([ids],i)=>cupSection(i?'Nhánh phải':'Nhánh trái',ids)).join('');
  const mobileStages=chosen==='final'?cupSection('Chung kết',[finalId]):
    layout.branches[chosen==='right'?1:0].slice(1).map((ids,i)=>cupSection(phases[i+1],ids)).join('');
  return '<section class="cup-diagram" aria-label="Sơ đồ Cúp Quốc gia">'+
    '<div class="cup-overview"><div class="cup-sides"><span>Nhánh trái</span><img alt="" width="34" height="32" src="'+leagueLogo('nc')+'"><span>Nhánh phải</span></div>'+
    '<div class="cup-round-labels">'+labels.map(label=>'<span>'+label+'</span>').join('')+'</div>'+
    '<div class="cup-tree">'+cupConnections(layout.columns)+layout.columns.map((ids,i)=>
      '<section class="cup-column" aria-label="'+labels[i]+(i<3?' · Nhánh trái':i>3?' · Nhánh phải':'')+'">'+
      ids.map(id=>'<div class="cup-node">'+cupPairCard(id)+'</div>').join('')+'</section>').join('')+'</div></div>'+
    '<div class="cup-mobile"><div class="choices" role="group" aria-label="Chọn nhánh">'+
    [['left','Nhánh trái'],['right','Nhánh phải'],['final','Chung kết']].map(([id,name])=>choice('cup-side',id,name,chosen===id)).join('')+
    '</div>'+mobileStages+'</div>'+
    '<details class="cup-qualifiers"><summary>Vòng loại · '+(layout.branches[0][0].length+layout.branches[1][0].length)+' cặp</summary><div>'+
    qualifiers+'</div></details></section>';
}
function scorerView() {
  const league=state.league;
  const {rows,finished,covered,through,disputes=[]}=data.scorers[league];
  if (!appliedFeed && !webRelease && !rows.length) {
    return '<section class="panel scorer-panel" aria-labelledby="scorer-title"><header class="scorer-heading">'+
      '<h2 id="scorer-title">Vua phá lưới</h2></header>'+
      '<p class="section-message">'+(hosted?'Chưa tải được dữ liệu ghi bàn. Bấm Kiểm tra cập nhật để thử lại.':
        'Tệp cập nhật chưa sẵn có. Mở lại từ gói Source đầy đủ để xem bảng ghi bàn.')+'</p></section>';
  }
  const sourcesNote=disputes.length?'<p class="data-note">Có khác biệt giữa các nguồn ghi bàn. '+disputes.map(id=>
    '<a href="#'+league+'/fixtures?match='+encodeURIComponent(id)+'">'+escapeHtml(sideName(matches[id].home))+' – '+
    escapeHtml(sideName(matches[id].away))+'</a>').join(' · ')+'. Xem mục Nguồn và đối chiếu trong trang trận.</p>':'';
  const full=currentFilters().scoreMode==='full';
  const visible=full?rows:rows.slice(0,15);
  const player=row=>'<div class="scorer-player">'+crest(row.clubs.at(-1))+'<span><strong>'+escapeHtml(row.name)+
    '</strong><small>'+escapeHtml(row.clubs.map(sideName).join(' · '))+'</small></span></div>';
  const cards='<ol class="scorer-cards">'+visible.map(row=>'<li><span aria-label="Hạng '+row.rank+'" class="scorer-rank" data-rank="'+row.rank+'">'+row.rank+
    '</span>'+player(row)+'<strong class="scorer-goals">'+row.goals+'<span class="sr-only"> bàn</span></strong></li>').join('')+'</ol>';
  const table='<table class="scorer-table"><caption class="sr-only">Vua phá lưới · '+escapeHtml(current().name)+'</caption>'+
    '<thead><tr><th scope="col">Hạng</th><th scope="col">Cầu thủ</th><th scope="col">Bàn</th></tr></thead><tbody>'+
    visible.map(row=>'<tr><td>'+row.rank+'</td><td>'+player(row)+'</td><td>'+row.goals+'</td></tr>').join('')+'</tbody></table>';
  return '<section class="panel scorer-panel" aria-labelledby="scorer-title"><header class="scorer-heading"><div><h2 id="scorer-title">Vua phá lưới</h2>'+
    '<p class="small muted">'+(full?rows.length+' cầu thủ':visible.length+' cầu thủ dẫn đầu')+'</p></div>'+
    '<div class="choices" role="group" aria-label="Cách hiển thị Vua phá lưới">'+choice('score-mode','compact','Thu gọn',!full)+choice('score-mode','full','Đầy đủ',full)+'</div></header>'+
    (rows.length?(full?table:cards):'<p class="section-message">Chưa ghi nhận cầu thủ ghi bàn.</p>')+'</section>'+
    (through?'<p class="data-note">Tính từ diễn biến đã đối chiếu đến '+fullDate(through)+' · '+covered+'/'+finished+' trận đủ dữ liệu bàn thắng. '+
      (covered<finished?'Thứ hạng có thể đổi khi bổ sung diễn biến. ':'')+
      sourceLink(current().calendar,'Lịch và kết quả trên VPF')+'</p>':'')+sourcesNote;
}

const rankingZones = {
  vl1: [
    {ranks:[1], key:'regional', label:'Hạng 1 · Ưu tiên AFC Champions League Two và Shopee Cup'},
    {ranks:[2], key:'continental', label:'Hạng 2 · Ưu tiên AFC Champions League Two'},
    {ranks:[13,14], key:'relegation', label:'Hạng 13–14 · Xuống V.League 2'}
  ],
  vl2: [
    {ranks:[1,2], key:'promotion', label:'Hạng 1–2 · Nhóm thăng hạng V.League 1'},
    {ranks:[13,14], key:'relegation', label:'Hạng 13–14 · Xuống hạng Nhì Quốc gia'}
  ]
};
function seasonRankingZones() {
  return data.season==='2026/27'?(rankingZones[state.league]||[]):[];
}
function rankingLegend() {
  const zones=seasonRankingZones();
  if (!zones.length) return '';
  const international=state.league==='vl1';
  const rules=international
    ? 'Việt Nam có một suất vào thẳng và một suất vòng sơ loại AFC Champions League Two. Nếu cần thay đại diện AFC, xét các đội đủ điều kiện cấp phép trong nhóm bảy đội dẫn đầu. Suất Shopee Cup còn lại xét theo kết quả Cúp Quốc gia. Các trường hợp trùng suất hoặc thiếu giấy phép xử lý theo Điều 27.'
    : 'Hai đội có thứ hạng cao nhất trong số các đội được cấp phép lên V.League 1 sẽ thăng hạng trực tiếp.';
  return '<div class="ranking-legend"><ul aria-label="Chú thích vị trí bảng xếp hạng">'+zones.map(zone=>
    '<li class="zone-'+zone.key+'"><span class="zone-dot" aria-hidden="true"></span>'+escapeHtml(zone.label)+'</li>').join('')+'</ul>'+
    '<p class="small muted">Màu đánh dấu các vị trí theo điều lệ cuối mùa 2026/27. Quyền tham dự được xác định theo xếp hạng chung cuộc và điều kiện cấp phép.</p>'+
    '<details><summary>Điều kiện dự giải và lên, xuống hạng</summary><p>'+escapeHtml(rules)+'</p><p>'+
    sourceLink('rule-'+state.league,'Điều 27 của VPF')+(international?' · '+sourceLink('afc-slots','Phân bổ suất AFC 2027/28'):'')+
    '</p></details></div>';
}
function rankingTable(rows,short=false,mode='summary',showZones=false) {
  const headings=short?['Hạng','Đội','Số trận','Điểm']:
    ['Hạng','Đội','Số trận','Thắng','Hòa','Thua','Bàn thắng','Bàn thua','Hiệu số','Điểm'];
  const zones=showZones?seasonRankingZones():[];
  return '<div class="table-wrap table-'+mode+'"'+(mode==='full'?' tabindex="0" role="region" aria-label="Bảng đầy đủ, có thể cuộn ngang"':'')+
    '><table class="ranking"><caption class="sr-only">Bảng xếp hạng '+escapeHtml(current().name)+'</caption>'+
    '<thead><tr>'+headings.map((name,i)=>'<th scope="col"'+(i===1?' class="team-cell"':'')+'>'+name+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(([pos,id,p,w,d,l,gf,ga,gd,points])=>{
      const zone=zones.find(z=>z.ranks.includes(pos));
      const team='<button class="team-link" type="button" data-club="'+id+'">'+crest(id)+
        '<span>'+escapeHtml(clubs[id].name)+'</span></button>';
      return '<tr'+(zone?' class="zone-'+zone.key+'"':'')+'><td class="rank-cell">'+pos+
        (zone?'<span class="sr-only"> · '+escapeHtml(zone.label.split(' · ')[1])+'</span>':'')+
        '</td><td class="team-cell">'+team+'</td>'+
        (short?[p]:[p,w,d,l,gf,ga,(gd>0?'+':'')+gd]).map(value=>'<td>'+value+'</td>').join('')+
        '<td class="points">'+points+'</td></tr>';
    }).join('')+'</tbody></table></div>';
}
function competitionView() {
  if (state.league==='nc') return cupView();
  const f=currentFilters();
  const mode=f.table==='adaptive' ? (window.matchMedia('(max-width: 820px)').matches?'summary':'full') : f.table;
  const meta=appliedFeed?.tableMeta[state.league];
  const stale=appliedFeed?.staleTables.includes(state.league);
  return heading('Bảng xếp hạng',current().name+' · '+data.season)+
    '<div class="choices" role="group" aria-label="Số cột bảng xếp hạng">'+choice('table-view','summary','Tóm tắt',mode==='summary')+choice('table-view','full','Đầy đủ',mode==='full')+'</div>'+
    (mode==='full'?'<p class="small muted table-hint">Vuốt ngang để xem thêm cột.</p>':'')+
    '<section class="panel">'+rankingTable(data.standings[state.league],mode==='summary',mode,true)+'</section>'+
    rankingLegend()+
    '<p class="data-note">'+(stale?'Kết quả có thay đổi sau mốc của bảng. ':'')+'Mốc bảng '+(meta?vnDate.format(new Date(meta.at)):fullDate(data.asOf))+'. '+sourceLink(meta?.source||state.league+'table','Bảng chính thức trên VPF')+'</p>'+
    (meta?.adjustments?.length?'<ul class="links-list">'+meta.adjustments.map(a=>'<li>'+escapeHtml(sideName(a.club)+' · '+
      (a.points>0?'+':'')+a.points+' điểm · '+a.reason)+' · '+sourceLink(a.source,'Nguồn')+'</li>').join('')+'</ul>':'');
}

const clubMetrics = {
  goalsFor:'Bàn thắng', goalsAgainst:'Bàn thua', yellow:'Thẻ vàng', red:'Thẻ đỏ'
};
function clubStatsView() {
  const {clubMetric:metric,clubStatMode}=currentFilters();
  const label=clubMetrics[metric];
  const stats=data.clubStats[state.league];
  const full=clubStatMode==='full';
  const hasCards=metric==='yellow'||metric==='red';
  const known=row=>hasCards?row[metric+'Matches']>0:row.played>0;
  const rows=Object.entries(stats.rows).map(([id,row])=>({id,value:known(row)?row[metric]:null}))
    .sort((a,b)=>(b.value??-1)-(a.value??-1)||clubs[a.id].name.localeCompare(clubs[b.id].name,'vi'));
  let rank;
  rows.forEach((row,i)=>{
    if (i===0 || row.value!==rows[i-1].value) rank=i+1;
    row.rank=row.value===null?'—':rank;
  });
  const visible=full?rows:rows.slice(0,7);
  const name=row=>'<button class="scorer-player club-stat-name" type="button" data-club="'+row.id+'">'+crest(row.id)+
    '<span><strong>'+escapeHtml(clubs[row.id].name)+'</strong></span></button>';
  const number=row=>row.value===null?'—':numberText(row.value);
  const cards='<ol class="scorer-cards">'+visible.map(row=>'<li><span class="scorer-rank" data-rank="'+row.rank+'">'+row.rank+
    '</span>'+name(row)+'<strong class="scorer-goals">'+number(row)+'</strong></li>').join('')+'</ol>';
  const table='<table class="scorer-table club-stats-table"><caption class="sr-only">'+label+' · '+escapeHtml(current().name)+
    '</caption><thead><tr><th scope="col">Hạng</th><th scope="col">Câu lạc bộ</th><th scope="col">'+label+'</th></tr></thead><tbody>'+
    visible.map(row=>'<tr><td>'+row.rank+'</td><td>'+name(row)+'</td><td>'+number(row)+'</td></tr>').join('')+'</tbody></table>';
  const covered=hasCards?stats[metric+'Matches']:stats.played;
  const note=hasCards?'Có dữ liệu '+label.toLocaleLowerCase('vi')+' ở '+covered+'/'+stats.played+' trận.':
    'Tính từ tỷ số của '+stats.played+' trận đã kết thúc.';
  return '<section class="panel scorer-panel" aria-labelledby="club-stats-title"><header class="scorer-heading"><div>'+
    '<h2 id="club-stats-title">Thống kê câu lạc bộ</h2><p class="small muted">'+
    (full?rows.length+' đội':visible.length+' đội đứng đầu theo chỉ số')+'</p></div>'+
    '<div class="choices" role="group" aria-label="Cách hiển thị thống kê câu lạc bộ">'+
    choice('club-stat-mode','compact','Thu gọn',!full)+choice('club-stat-mode','full','Đầy đủ',full)+'</div></header>'+
    '<div class="filters club-stat-controls"><div><label for="club-stat-filter">Chỉ số</label><select id="club-stat-filter">'+
    Object.entries(clubMetrics).map(([value,text])=>'<option value="'+value+'"'+(value===metric?' selected':'')+'>'+text+'</option>').join('')+
    '</select></div></div>'+(full?table:cards)+'</section>'+
    '<p class="data-note">'+note+(covered<stats.played?' Tổng thẻ chỉ tính các trận có số liệu.':'')+
    (visible.some(row=>row.value===null)?' Dấu — là chưa có số liệu.':'')+'</p>';
}
