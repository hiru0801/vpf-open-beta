'use strict';

(function(root) {
  const stamp = date => date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const clean = value => String(value).replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/[;,]/g,c=>'\\'+c);
  const encoder = new TextEncoder();
  function fold(line) {
    let result='';
    let count=0;
    for (const char of line) {
      const length=encoder.encode(char).length;
      if (count+length>75) {
        result+='\r\n ';
        count=1;
      }
      result+=char;
      count+=length;
    }
    return result;
  }

  function event(data,m,title,updated,round='',cancelled=false) {
    const start=new Date(m.date+'T'+m.time+':00+07:00');
    const end=new Date(start.getTime()+2*60*60*1000);
    const description=[data.leagues[m.league].name,round,data.sources[m.timingSource||m.source]?.[1]].filter(Boolean).join('\n');
    return ['BEGIN:VEVENT','UID:'+m.id+'-'+data.season.replace('/','-')+'@vpf-app.local',
      'DTSTAMP:'+stamp(new Date(m.scheduleModified||updated)),'SEQUENCE:'+(m.sequence??(m.changed?1:0)),
      'DTSTART:'+stamp(start),'DTEND:'+stamp(end),'SUMMARY:'+clean(title),'LOCATION:'+clean(m.venue||''),
      'DESCRIPTION:'+clean(description),'STATUS:'+(cancelled?'CANCELLED':'CONFIRMED'),
      ...(!cancelled?['BEGIN:VALARM','ACTION:DISPLAY','TRIGGER:-PT30M','DESCRIPTION:Trận đấu sắp bắt đầu','END:VALARM']:[]),
      'END:VEVENT'];
  }
  function render(events,name) {
    return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//VPF App//Lich thi dau//VI','CALSCALE:GREGORIAN',
      ...(name?['X-WR-CALNAME:'+clean(name)]:[]),...events.flat(),'END:VCALENDAR',''].map(fold).join('\r\n');
  }
  const api={event,render};
  if (typeof module==='object' && module.exports) module.exports=api;
  else root.VPF_CALENDAR=api;
})(typeof window==='object'?window:globalThis);
