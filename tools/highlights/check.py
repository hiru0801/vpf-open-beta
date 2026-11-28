"""Exercise trusted feeds, ambiguous fixtures and promotion from YouTube to VPF."""

from datetime import date
from vpf_highlights import CHANNELS, FPT, match_highlights, youtube_articles

day = date(2026, 11, 27)
channel = CHANNELS['vl1']
url = 'https://www.youtube.com/watch?v=QW0J-5Pq1Xw'
title = '[HIGHLIGHTS] Sông Lam Nghệ An vs Ninh Bình | LPBank V.League 1 2026/27'
feed = f'''<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
<yt:channelId>{channel[2:]}</yt:channelId>
<entry><yt:videoId>QW0J-5Pq1Xw</yt:videoId><yt:channelId>{channel}</yt:channelId>
<title>{title}</title><published>2026-11-27T13:22:27+00:00</published></entry>
<entry><yt:videoId>12345678901</yt:videoId><yt:channelId>{FPT}</yt:channelId>
<title>{title}</title><published>2026-11-27T13:22:27+00:00</published></entry></feed>'''
assert list(youtube_articles(feed.encode(), 'vl1')) == [(day,url,title,'vl1','channel')]

game = dict(id='match', league='vl1', homeClub='SLN', awayClub='NBI', date=day.isoformat(), score=[1,0], status='final')
data = dict(season='2026/27', leagues={'vl1':{'start':'2026-09-04'}},
            clubs={'SLN':{'name':'Sông Lam Nghệ An'},'NBI':{'name':'Ninh Bình'}}, matches={'match':game})
assert match_highlights(data,list(youtube_articles(feed.encode(),'vl1')))[0] == {'match':url}
game['status'] = 'live'
assert not match_highlights(data,[(day,url,title,'vl1','channel')])[0]
game['status'] = 'final'
official = 'https://vpf.vn/video-highlight/video-vleague/highlights-slna-ninh-binh/'
game['highlightUrl'] = url
assert match_highlights(data,[(day,official,title,'vl1')])[0] == {'match':official}
game['highlightUrl'] = official
assert not match_highlights(data,[(day,url,title,'vl1','channel')])[0]
del game['highlightUrl']

undated = (None,url,'HIGHLIGHTS: SÔNG LAM NGHỆ AN - NINH BÌNH','vl1','fpt')
assert match_highlights(data,[undated])[0] == {'match':url}
data['matches']['future'] = {**game,'id':'future','score':None,'status':'scheduled','date':'2027-01-01'}
assert not match_highlights(data,[undated])[0]
assert match_highlights(data,[(day,url,undated[2],None,'fpt-verified')])[0] == {'match':url}
assert not match_highlights(data,[(date(2026,11,28),url,undated[2],None,'fpt-verified')])[0]
print('PASS · nguồn video, ngày trận, trạng thái và thứ tự ưu tiên.')
