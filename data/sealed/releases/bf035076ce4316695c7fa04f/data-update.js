'use strict';

(function(root) {
  const keys = ['date','time','venue','window','scheduleNote','home','away','broadcast','watchUrl','highlightUrl','status','score','penalties','goals','lineups','events','matchSquads','attendance','yellow','red'];
  const scoringEvents = ['goal','penalty','ownGoal'];
  const eventTypes = [...scoringEvents,'yellow','secondYellow','red','missedPenalty'];
  const statusValues = ['scheduled','provisional','tbd','postponed','final'];
  const track = ['date','time','venue','window','scheduleNote','home','away','broadcast','status'];
  const pair = x => Array.isArray(x) && x.length===2 && x.every(n=>Number.isInteger(n) && n>=0 && n<=99);
  const label = (x,max=200) => typeof x==='string' && x.trim().length>0 && x.length<=max && !/[\x00-\x1f]/.test(x);
  const validDay = x => typeof x==='string' && /^20\d\d-\d\d-\d\d$/.test(x) && Number.isFinite(Date.parse(x)) &&
    new Date(x).toISOString().slice(0,10)===x;
  const validTime = x => typeof x==='string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x);
  const instant = x => typeof x==='string' && /(?:[+-]\d\d:\d\d|Z)$/.test(x) && Number.isFinite(Date.parse(x));
  function url(x) {
    if (typeof x!=='string'||x.length>800||!x.startsWith('https://')||/\s|\\/.test(x)) return false;
    try {
      const parsed=new URL(x);
      return Boolean(parsed.hostname && !parsed.username && !parsed.password && !parsed.searchParams.has('api_key'));
    } catch { return false; }
  }
  const source = x => Array.isArray(x) && x.length===2 && label(x[0]) && url(x[1]);
  const record = x => x!==null && typeof x==='object' && !Array.isArray(x);
  const same = (a,b) => JSON.stringify(a??null)===JSON.stringify(b??null);
  function assert(ok,message) { if(!ok) throw new Error(message); }
  const shirt = value => Number.isInteger(value) && value>=0 && value<=999;
  const minute = value => typeof value==='string' && /^(?:[1-9]?\d|1[01]\d|120)(?:\+[1-9]\d?)?$/.test(value);
  const playerId=value=>value===undefined||typeof value==='string'&&/^[a-z0-9-]{1,140}$/.test(value);
  const player = value => record(value) && label(value.name,160) && playerId(value.playerId) && (value.number===null || shirt(value.number));
  const squadPlayer = value => player(value) && (value.position===null || label(value.position,30)) &&
    (value.changeMinute===null || minute(value.changeMinute)) && (value.exitMinute===undefined || minute(value.exitMinute));
  const squad = value => record(value) && Array.isArray(value.starters) && value.starters.length>=1 && value.starters.length<=11 &&
    Array.isArray(value.substitutes) && value.substitutes.length<=20 &&
    [...value.starters,...value.substitutes].every(squadPlayer) &&
    new Set([...value.starters,...value.substitutes].map(p=>p.name+'|'+p.number)).size===value.starters.length+value.substitutes.length;
  function goalCounts(events) {
    const counts=[0,0];
    for (const event of events) {
      if (scoringEvents.includes(event.type)) counts[event.side]++;
    }
    return counts;
  }
  function timelineCards(events) {
    if (!Array.isArray(events)) return null;
    const yellow=[0,0], red=[0,0];
    for (const event of events) {
      if (event.type==='yellow') yellow[event.side]++;
      if (event.type==='red' || event.type==='secondYellow') red[event.side]++;
    }
    return {yellow,red};
  }

  function matchCards(match) {
    // Like the VPF match totals, a dismissal for a second yellow counts under red.
    const fromTimeline=match.league==='nc' && match.score ? timelineCards(match.events) : null;
    return {
      yellow:match.yellow??fromTimeline?.yellow,
      red:match.red??fromTimeline?.red,
      derived:Boolean(fromTimeline && (!match.yellow || !match.red))
    };
  }

  function clubStatTables(leagues,ties,matches) {
    const tables=Object.fromEntries(Object.entries(leagues).map(([league,{clubs}])=>[league,{
      played:0,yellowMatches:0,redMatches:0,rows:Object.fromEntries(clubs.map(id=>[id,{
        played:0,goalsFor:0,goalsAgainst:0,yellow:0,red:0,yellowMatches:0,redMatches:0
      }]))
    }]));
    for (const match of Object.values(matches)) {
      if (!match.score || match.status!=='final') continue;
      const table=tables[match.league];
      const sides=[match.home,match.away].map(slot=>table.rows[sideId(ties,matches,slot)]);
      if (sides.some(side=>!side)) continue;
      const cards=matchCards(match);
      table.played++;
      for (const metric of ['yellow','red']) if (cards[metric]) table[metric+'Matches']++;
      sides.forEach((club,side)=>{
        club.played++;
        club.goalsFor+=match.score[side];
        club.goalsAgainst+=match.score[1-side];
        for (const metric of ['yellow','red']) {
          if (!cards[metric]) continue;
          club[metric]+=cards[metric][side];
          club[metric+'Matches']++;
        }
      });
    }
    return tables;
  }

  function computedTable(matches, league, day) {
    const totals = new Map();
    for (const match of Object.values(matches)) {
      if (match.league!==league || !match.score || !match.date || match.date>day) continue;
      const [home,away]=match.score;
      for (const [club,gf,ga] of [[match.home,home,away],[match.away,away,home]]) {
        const row=totals.get(club)||[0,0,0,0,0,0,0];
        row[0]++;
        row[gf>ga?1:gf===ga?2:3]++;
        row[4]+=gf;
        row[5]+=ga;
        if(club===match.away) row[6]+=gf;
        totals.set(club,row);
      }
    }
    return totals;
  }

  function interimRanking(base,matches,id,day) {
    const stats=computedTable(matches,id,day);
    const played=[...stats.values()].reduce((total,row)=>total+row[0],0)/2;
    const league=base.leagues[id];
    return {stats,interim:played<league.clubs.length*league.rounds/2};
  }
  function verifyOrder(rows,id,ranking) {
    for (let i=1;i<rows.length;i++) {
      const previous=rows[i-1], row=rows[i];
      assert(previous[9]>=row[9],'BXH sai thứ tự điểm ở '+id+' · '+row[1]+'.');
      if (previous[9]!==row[9] || !ranking?.interim) continue;
      const rule=previous[8]-row[8] || previous[6]-row[6] ||
        (ranking.stats.get(previous[1])?.[6]||0)-(ranking.stats.get(row[1])?.[6]||0);
      assert(rule>=0,'BXH sai thứ tự khi bằng điểm ở '+id+' · '+row[1]+'.');
      if (rule>0) assert(previous[0]!==row[0],'Chỉ số phụ khác nhau ở hai đội cùng hạng '+id+'.');
    }
  }
  function validValue(field,value) {
    if(value===null) return !['status','home','away'].includes(field);
    if(field==='status') return statusValues.includes(value);
    if(field==='date') return validDay(value);
    if(field==='time') return validTime(value);
    if(field==='window') return Array.isArray(value)&&value.length===2&&value.every(validDay)&&value[0]<=value[1];
    if(field==='attendance') return Number.isSafeInteger(value)&&value>=0&&value<=300000;
    if(field==='watchUrl'||field==='highlightUrl') return url(value);
    if(['score','penalties','yellow','red'].includes(field)) return pair(value);
    if(field==='events') return Array.isArray(value) && value.length<=100 &&
      value.every(e=>player(e) && (e.side===0||e.side===1) && eventTypes.includes(e.type) && minute(e.minute));
    if(field==='matchSquads') return Array.isArray(value) && value.length===2 && value.some(squad) && value.every(team=>team===null||squad(team));
    if(field==='goals'||field==='lineups') return Array.isArray(value) && value.length===2 &&
      value.every(side=>Array.isArray(side) && (field==='lineups'?side.length===11&&new Set(side).size===11:side.length<45) &&
        side.every(s=>label(s,160)));
    return label(value);
  }
  function sideId(ties,matches,slot) {
    return slot.startsWith('@') ? tieWinner(ties,matches,slot.slice(1)) : slot;
  }
  function tieWinner(ties,matches,id) {
    if (!ties[id]) return null;
    const ids=ties[id].legs===1?['nc-'+id]:['nc-'+id+'-1','nc-'+id+'-2'];
    const pair=ids.map(match=>matches[match]);
    if (pair.some(m=>!m?.score)) return null;
    const first=pair[0],last=pair.at(-1);
    const home=first.score[0]+(pair.length===2?last.score[1]:0);
    const away=first.score[1]+(pair.length===2?last.score[0]:0);
    if (home!==away) return sideId(ties,matches,home>away?first.home:first.away);
    if (last.penalties && last.penalties[0]!==last.penalties[1]) {
      return sideId(ties,matches,last.penalties[0]>last.penalties[1]?last.home:last.away);
    }
    return null;
  }

  function samePlayer(event,player) {
    if (event.playerId && player.playerId) return event.playerId===player.playerId;
    return playerNameKey(event.name)===playerNameKey(player.name) &&
      (event.number===null || player.number===null || event.number===player.number);
  }

  // Reviewed records whose published match squad was incomplete.
  const reviewedGoals={
    'vl1-1-SLN-BNI':[['penalty','71',83,'Bruno Pereira De Albuquerque','bruno-pereira-de-albuquerque']],
    'vl2-6-TCT-LDO':[
      ['goal','80',77,'Nguyễn Văn Vinh','nguyen-van-vinh'],
      ['goal','90',99,'De Santana Santos Thaileon','de-santana-santos-thaileon']
    ]
  };

  function verifyScorers(match,previous) {
    for (const event of match.events||[]) {
      if (!scoringEvents.includes(event.type)) continue;
      const side=event.type==='ownGoal'?1-event.side:event.side;
      const team=match.matchSquads?.[side]??previous.matchSquads?.[side];
      const players=team?[...team.starters,...team.substitutes]:[];
      const reviewed=event.side===0 && (!team || team.starters.length<11) &&
        reviewedGoals[match.id]?.some(([type,minute,number,name,playerId])=>
          event.type===type && event.minute===minute && event.number===number && event.name===name &&
          (!event.playerId || event.playerId===playerId));
      assert(reviewed || players.some(player=>samePlayer(event,player)),
        'Người ghi bàn chưa khớp danh sách thi đấu ở '+match.id+' · '+event.name+'. Cần xác minh.');
    }
  }

  // Use VPF player identity across clubs when available. Names alone are scoped to a club.
  function playerNameKey(value) {
    return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu,'').replaceAll('đ','d')
      .match(/[a-z0-9]+/g)?.sort().join(' ')||'';
  }
  function scorerTables(ties,matches,rosters) {
    const tableIds=['vl1','vl2','nc'];
    const rankings=Object.fromEntries(tableIds.map(id=>[id,{entries:new Map(),finished:0,covered:0,through:null,disputes:[]}]));
    const registered=new Map();
    const names=new Map();
    for (const [club,{players}] of Object.entries(rosters||{})) {
      for (const player of players) {
        if (!player.playerId) continue;
        if (!names.has(player.playerId)) names.set(player.playerId,player.name);
        const key=club+'|'+playerNameKey(player.name);
        if (!registered.has(key)) registered.set(key,new Set());
        registered.get(key).add(player.playerId);
      }
    }
    const ordered=Object.values(matches).filter(match=>match.status==='final' && match.score)
      .sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.time||'').localeCompare(b.time||'')||a.id.localeCompare(b.id));
    for (const match of ordered) {
      const result=rankings[match.league];
      if (!result) continue;
      result.finished++;
      const evidence=match.evidence?.slice().reverse().find(item=>item.fields.includes('events'));
      if (evidence?.checks.some(check=>check.outcome==='differs' && check.fields.includes('events'))) {
        result.disputes.push(match.id);
      }
      const events=match.events||[];
      if (goalCounts(events).every((count,side)=>count===match.score[side])) result.covered++;
      if (match.date) result.through=match.date;
      for (const event of events) {
        if (!['goal','penalty'].includes(event.type)) continue;
        const club=sideId(ties,matches,event.side?match.away:match.home);
        if (!club) continue;
        const local=club+'|'+playerNameKey(event.name);
        const candidates=registered.get(local);
        const player=event.playerId||(candidates?.size===1?[...candidates][0]:null);
        const id=player?'vpf:'+player:'local:'+local;
        if (!result.entries.has(id)) result.entries.set(id,{id,name:names.get(player)||event.name,clubs:new Set(),goals:0});
        const row=result.entries.get(id);
        row.goals++;
        row.clubs.add(club);
      }
    }
    return Object.fromEntries(tableIds.map(id=>{
      const {entries,...coverage}=rankings[id];
      const ordered=[...entries.values()].sort((a,b)=>b.goals-a.goals||a.name.localeCompare(b.name,'vi')||a.id.localeCompare(b.id));
      let rank=0;
      const rows=ordered.map((row,i)=>{
        if (i===0 || row.goals!==ordered[i-1].goals) rank=i+1;
        return {name:row.name,clubs:[...row.clubs],goals:row.goals,rank};
      });
      return [id,{...coverage,rows}];
    }));
  }

  function compile(base,feed) {
    assert(record(feed) && [1,2].includes(feed.schema) && Number.isSafeInteger(feed.revision) && feed.revision>0 &&
      instant(feed.publishedAt) && Array.isArray(feed.matches) && feed.matches.length<=2000 &&
      (feed.standings===undefined || record(feed.standings)), 'Phiên bản dữ liệu hoặc cấu trúc tệp chưa hợp lệ.');
    assert((feed.schema===1 && feed.season===undefined) || feed.season===base.season,'Bản cập nhật thuộc mùa giải khác.');
    const additions=Object.create(null);
    const matches={};
    const tables={};
    const tableMeta={};
    const staleTables=new Set();
    const rosters={};
    assert(feed.rosters===undefined||record(feed.rosters),'Danh sách đăng ký theo CLB chưa hợp lệ.');
    for (const [id,entry] of Object.entries(feed.rosters||{})) {
      assert(['vl1','vl2'].includes(base.clubs[id]?.league) && record(entry) && instant(entry.at) &&
        Date.parse(entry.at)<=Date.parse(feed.publishedAt) && source(entry.source) &&
        Array.isArray(entry.players) && entry.players.length>=1 && entry.players.length<=60 &&
        entry.players.every(p=>player(p) && [null,'Thủ môn','Hậu vệ','Tiền vệ','Tiền đạo'].includes(p.position)) &&
        new Set(entry.players.map(p=>p.playerId||p.name+'|'+p.number)).size===entry.players.length &&
        (entry.coach===undefined||label(entry.coach,160)) && (entry.stadium===undefined||label(entry.stadium,160)) &&
        (entry.year===undefined||Number.isInteger(entry.year)&&entry.year>=1800&&entry.year<=new Date(entry.at).getFullYear()) &&
        (entry.yearSource===undefined||entry.year&&source(entry.yearSource)),
        'Hồ sơ và danh sách đăng ký chưa hợp lệ ở '+id+'.');
      const sourceId='roster-'+id;
      additions[sourceId]=entry.source;
      const yearSource=entry.yearSource?'year-'+id:null;
      if (yearSource) additions[yearSource]=entry.yearSource;
      rosters[id]={players:entry.players,at:entry.at,source:sourceId,
        year:entry.year??(Number(base.clubs[id].year)||null),yearSource,stadium:entry.stadium??base.clubs[id].stadium,coach:entry.coach??null};
    }
    for(const [i,item] of feed.matches.entries()) {
      const at=Date.parse(item?.at);
      assert(record(item) && Object.hasOwn(base.matches,item.id) && instant(item.at) && at<=Date.parse(feed.publishedAt) &&
        source(item.source) && record(item.patch) && Object.keys(item.patch).length>0,
        'Mục trận '+(i+1)+' thiếu mã trận, nguồn hoặc thời điểm hợp lệ.');
      for(const [field,value] of Object.entries(item.patch)) {
        assert(keys.includes(field) && validValue(field,value), 'Trường '+field+' chưa hợp lệ ở '+item.id+'.');
      }
      const old=matches[item.id] || base.matches[item.id];
      assert(!old.lastModified || at>Date.parse(old.lastModified),'Các lần cập nhật của '+item.id+' phải theo thứ tự thời gian.');
      const next={...old,...item.patch};
      assert((next.status==='final')===Boolean(next.score), 'Kết quả cần đi cùng trạng thái final ở '+item.id+'.');
      assert(next.status!=='scheduled'||(next.date&&next.time),'Trận đã xác nhận cần đủ ngày và giờ.');
      assert(!next.time||next.date,'Giờ thi đấu cần đi cùng ngày thi đấu.');
      assert(!next.window||!next.date,'Khung thi đấu dự kiến cần lưu riêng với ngày thi đấu.');
      if(feed.schema===2 && (Object.hasOwn(item.patch,'status') || Object.hasOwn(item.patch,'window'))) {
        assert(next.status!=='provisional'||(!next.date && (next.window||next.scheduleNote)),
          'Lịch dự kiến cần khung ngày hoặc phương án xếp lịch ở '+item.id+'.');
      }
      if (next.home!==old.home||next.away!==old.away) {
        assert(old.league==='nc' && !old.score && next.home===old.away && next.away===old.home,
          'Chỉ có thể đảo thứ tự hai đội của trận Cúp chưa có kết quả.');
      }
      assert(!next.penalties||(next.league==='nc'&&next.score),'Luân lưu cần đi cùng kết quả trận Cúp.');
      if (next.goals) assert(next.score && next.goals.every((g,side)=>g.length<=next.score[side]),
        'Diễn biến ghi bàn vượt tỷ số ở '+item.id+'.');
      if (next.events) {
        assert(next.score && goalCounts(next.events).every((count,side)=>count<=next.score[side]),
          'Sự kiện ghi bàn vượt tỷ số ở '+item.id+'.');
        if (!same(next.score,old.score) && old.events && !Object.hasOwn(item.patch,'events')) {
          assert(false,'Cần kiểm tra hoặc gỡ diễn biến khi sửa tỷ số ở '+item.id+'.');
        }
      }
      if (Object.hasOwn(item.patch,'events') || Object.hasOwn(item.patch,'matchSquads')) verifyScorers(next,old);
      const sourceId='update-'+(i+1);
      additions[sourceId]=item.source;
      const patchFields=Object.keys(item.patch);
      assert(item.note===undefined||label(item.note,550),'Ghi chú đối chiếu chưa hợp lệ ở '+item.id+'.');
      assert(item.checks===undefined||(Array.isArray(item.checks)&&item.checks.length<=8),'Danh sách đối chiếu chưa hợp lệ.');
      const checks=(item.checks||[]).map((check,j)=>{
        assert(record(check)&&source(check.source)&&Array.isArray(check.fields)&&check.fields.length>0&&
          new Set(check.fields).size===check.fields.length&&check.fields.every(field=>patchFields.includes(field))&&
          ['agrees','differs'].includes(check.outcome)&&check.source[1]!==item.source[1],
          'Nguồn đối chiếu '+(j+1)+' chưa hợp lệ ở '+item.id+'.');
        const evidenceId=sourceId+'-check-'+(j+1);
        additions[evidenceId]=check.source;
        return {source:evidenceId,fields:check.fields,outcome:check.outcome};
      });
      const withoutIdentity=events=>events?.map(({playerId,...event})=>event);
      const identityOnly=patchFields.length===1 && patchFields[0]==='events' &&
        old.events && next.events && same(withoutIdentity(old.events),withoutIdentity(next.events));
      if (!identityOnly) {
        next.evidence=[...(old.evidence||[]),{at:item.at,source:sourceId,fields:patchFields,checks,note:item.note||''}];
      }
      const changed=track.filter(k=>!same(old[k],next[k]) && (k!=='status' || ['postponed','tbd'].includes(next.status)));
      if(changed.length) {
        const fields=[...new Set([...changed,'date','time','venue','status'])];
        next.history=[...(old.history||[]),{
          at:item.at,
          before:Object.fromEntries(fields.map(k=>[k,old[k]??null])),
          after:Object.fromEntries(fields.map(k=>[k,next[k]??null])),
          beforeSource:old.timingSource||old.source,
          source:sourceId
        }];
        if (['scheduled','postponed'].includes(old.status) && changed.some(k=>['date','time','venue','window','home','away'].includes(k))) next.changed=true;
        next.timingSource=sourceId;
      }
      if (Object.hasOwn(item.patch,'goals')) next.goalsSource=sourceId;
      if (Object.hasOwn(item.patch,'lineups')) next.lineupsSource=sourceId;
      if (Object.hasOwn(item.patch,'events') && !identityOnly) next.eventsSource=next.events?sourceId:null;
      if (Object.hasOwn(item.patch,'matchSquads')) next.squadsSource=next.matchSquads?sourceId:null;
      if (Object.hasOwn(item.patch,'watchUrl')) next.watchSource=next.watchUrl?sourceId:null;
      if (Object.hasOwn(item.patch,'highlightUrl')) {
        next.highlightSource=next.highlightUrl?sourceId:null;
        next.highlightAt=next.highlightUrl?item.at:null;
      }
      if (!same(next.score,old.score)) {
        if (next.league!=='nc') staleTables.add(next.league);
        next.resultModified=item.at;
        next.resultSource=sourceId;
      }
      const chronologyChanged=changed.length||!same(next.score,old.score);
      matches[item.id]={...next,source:chronologyChanged?sourceId:old.source,lastModified:item.at,
        scheduleModified:chronologyChanged?item.at:old.scheduleModified,
        sequence:(old.sequence??(old.changed?1:0))+(chronologyChanged?1:0)};
    }
    const seasonMatches={...base.matches,...matches};
    for(const m of Object.values(seasonMatches)) {
      if (m.score) assert(sideId(base.ties,seasonMatches,m.home) && sideId(base.ties,seasonMatches,m.away),
        'Cần xác định hai đội trước khi ghi kết quả '+m.id+'.');
    }
    for(const [id,tie] of Object.entries(base.ties)) {
      const first=seasonMatches['nc-'+id+(tie.legs===2?'-1':'')];
      const last=tie.legs===2?seasonMatches['nc-'+id+'-2']:first;
      assert(first && last,'Thiếu trận của cặp Cúp '+id+'.');
      if (tie.legs===2) {
        assert(first.home===last.away && first.away===last.home,'Sai thứ tự sân nhà, sân khách ở cặp '+id+'.');
        assert(!first.penalties,'Lượt đi không có luân lưu ở cặp '+id+'.');
        assert(!last.score || first.score,'Cần kết quả lượt đi trước khi chốt lượt về ở cặp '+id+'.');
      }
      if (!last.score) continue;
      const level=first.score[0]+(tie.legs===2?last.score[1]:0)===first.score[1]+(tie.legs===2?last.score[0]:0);
      assert(level===Boolean(last.penalties) && (!last.penalties || last.penalties[0]!==last.penalties[1]),
        'Luân lưu không phân thắng bại hoặc không phù hợp với tỷ số của cặp '+id+'.');
      assert(tieWinner(base.ties,seasonMatches,id),'Chưa xác định đội đi tiếp ở cặp '+id+'.');
    }
    for (const [id,rows] of Object.entries(base.standings)) {
      if (!Object.hasOwn(feed.standings||{},id)) {
        verifyOrder(rows,id,interimRanking(base,seasonMatches,id,base.asOf));
      }
    }
    for(const [id,table] of Object.entries(feed.standings||{})) {
      const clubs=base.leagues[id]?.clubs;
      assert((id==='vl1'||id==='vl2') && record(table) && instant(table.at) && Date.parse(table.at)<=Date.parse(feed.publishedAt) &&
        source(table.source) && Array.isArray(table.rows) && table.rows.length===clubs.length, 'Bảng xếp hạng '+id+' chưa hợp lệ.');
      const included=new Set();
      for(const [i,row] of table.rows.entries()) {
        assert(Array.isArray(row)&&row.length===10,'Thiếu cột BXH '+id+'.');
        const [position,club,p,w,d,l,gf,ga,gd,pts]=row;
        assert((position===i+1 || (i>0 && position===table.rows[i-1][0] && pts===table.rows[i-1][9])) && clubs.includes(club) && !included.has(club) && [p,w,d,l,gf,ga,gd,pts].every(Number.isInteger) &&
          [p,w,d,l,gf,ga].every(n=>n>=0) && p===w+d+l && gd===gf-ga,'Có dòng BXH không khớp ở '+id+'.');
        included.add(club);
      }
      verifyOrder(table.rows,id);
      const sourceId='update-table-'+id;
      additions[sourceId]=table.source;
      const tied=table.rows.some((row,i)=>i>0 && row[9]===table.rows[i-1][9]);
      const official=base.sources[id+'table']?.[1];
      assert(!tied || (official && table.source[1]===official),
        'BXH bằng điểm cần bảng thứ hạng chính thức của VPF ở '+id+'.');
      tables[id]=table.rows;
      tableMeta[id]={at:table.at,source:sourceId};
      const late=Object.values(matches).some(m=>m.league===id && Date.parse(m.resultModified)>Date.parse(table.at));
      if (feed.schema===2) {
        const adjustments=table.adjustments??[];
        assert(Array.isArray(adjustments) && adjustments.every(a=>record(a)&&clubs.includes(a.club)&&
          Number.isSafeInteger(a.points)&&label(a.reason,200)&&source(a.source)), 'Điều chỉnh điểm thiếu thông tin ở '+id+'.');
        const points=new Map();
        for (const a of adjustments) points.set(a.club,(points.get(a.club)||0)+a.points);
        for (const [position,club,,w,d,,,,,actual] of table.rows) {
          assert(actual===3*w+d+(points.get(club)||0),'Điểm BXH không khớp ở '+id+' · '+club+'.');
        }
        if (!late) {
          const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date(table.at));
          const ranking=interimRanking(base,seasonMatches,id,day);
          const reconstructed=ranking.stats;
          for (const [,club,...values] of table.rows) {
            assert(same(values.slice(0,6),reconstructed.get(club)?.slice(0,6)||[0,0,0,0,0,0]),
              'BXH chưa khớp kết quả đã có ở '+id+' · '+club+'.');
          }
          verifyOrder(table.rows,id,ranking);
        }
        tableMeta[id].adjustments=adjustments.map((a,i)=>{
          const adjustmentSource=sourceId+'-adjustment-'+i;
          additions[adjustmentSource]=a.source;
          return {...a,source:adjustmentSource};
        });
      }
      if (!late) staleTables.delete(id);
    }
    return {revision:feed.revision,publishedAt:feed.publishedAt,matches,sources:additions,tables,tableMeta,rosters,staleTables:[...staleTables]};
  }

  const api={compile,sideId,tieWinner,goalCounts,scorerTables,timelineCards,matchCards,clubStatTables};
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.VPF_UPDATES=api;
})(typeof window==='object'?window:globalThis);
