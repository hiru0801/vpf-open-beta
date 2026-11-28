"""Match single-game highlights from VPF and the three competition channels."""

from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from html import unescape
import json
import re
import subprocess
import unicodedata
from urllib.parse import urlencode, urljoin, urlsplit, urlunsplit
from xml.etree import ElementTree
from zoneinfo import ZoneInfo

from vpf_http import fetch

ROOT = 'https://vpf.vn/category/video-highlight/'
API = 'https://vpf.vn/wp-json/wp/v2/posts'
HUB = 'https://vpf.vn/highlight/'
PANELS = {'vl1':'vleague-highlight', 'vl2':'hangnhat-highlight', 'nc':'cupqg-highlight'}
CHANNELS = {
    'vl1':'UC8YdpweymfuTSjIeFrIg3_A',
    'vl2':'UCPVoAG10SNM83JEaGqOdNHg',
    'nc':'UCcSvT5zBFgeZpCqo4UoDpcg',
}
FPT = 'UCljFFNaQoJWeP91Bz4m_3bw'
PLAYLISTS = {'vl1':'PLfL37aypsWvg', 'vl2':'PLJ900ysMTlXY', 'nc':'PLKT0P_fNanlw'}
YOUTUBE = 'https://www.youtube.com'
VN = ZoneInfo('Asia/Ho_Chi_Minh')
VIDEO_ID = re.compile(r'[A-Za-z0-9_-]{11}')
YT_NS = {'atom':'http://www.w3.org/2005/Atom', 'yt':'http://www.youtube.com/xml/schemas/2015'}
# VPF WordPress category IDs for the three video archives, their highlight subcategories and featured videos.
VIDEO_CATEGORIES = '75,87,88,89,91,123,754,755'
ARCHIVES = {
    'all': ROOT,
    'vl1': ROOT+'video-vleague/highlights-khoanh-khac/',
    'vl2': ROOT+'video-hang-nhat/highlights-khoanh-khac-video-hang-nhat/',
    'nc': ROOT+'video-cup-quoc-gia/highlights-khoanh-khac-video-cup-quoc-gia/',
}
NAMES = {
    'CAH': ('CA Hà Nội','CAHN'),
    'DNC': ('Trường Tươi Đồng Nai','Trường Tươi Bình Phước','TP Đồng Nai'),
    'DNA': ('Đà Nẵng',),
    'HAG': ('HAGL',),
    'HCM': ('CA TP. Hồ Chí Minh','CA TP.HCM','Công An Thành phố Hồ Chí Minh'),
    'HNO': ('Hà Nội',),
    'HPH': ('Hải Phòng',),
    'KKH': ('Khánh Hòa',),
    'NDI': ('Nam Định',),
    'SLN': ('SLNA',),
    'TCT': ('Cần Thơ',),
    'TCV': ('Thể Công',),
    'TPH': ('TPHCM','Thành phố Hồ Chí Minh'),
    'VHI': ('ĐH Văn Hiến','Văn Hiến'),
    'XPT': ('Phú Thọ',),
}
SEASON = re.compile(r'\b(20\d{2})\s*[/–-]\s*((?:20)?\d{2})\b')
HEAD = re.compile(r'^\s*\[?highlights?\]?\s*[:|–—-]*\s*', re.I)
VERSUS = re.compile(r'\s+(?:vs\.?|gặp)\s+', re.I)
DASH = re.compile(r'\s+[–—-]\s+')
LEAGUE = {
    'nc':re.compile(r'cúp\s*(?:quốc\s*gia|qg)',re.I),
    'vl2':re.compile(r'(?:v[.\s]*league\s*2(?!\d)|hạng\s*nhất|hnqg)',re.I),
    'vl1':re.compile(r'(?:v[.\s]*league\s*1(?!\d)|vđqg)',re.I),
}


def normalized(text):
    text = unicodedata.normalize('NFD', text.casefold().replace('đ','d'))
    return re.sub(r'[^a-z0-9]+', '', text)


def official_video(url):
    target=urlsplit(urljoin(ROOT,url))
    if target.scheme=='https' and target.netloc=='vpf.vn' and target.path.startswith('/video-highlight/'):
        return urlunsplit((target.scheme,target.netloc,target.path,'',''))
    return None


def api_articles(cache,cutoff):
    page,total=1,1
    while page<=total:
        path=cache/f'api-{cutoff.isoformat()}-{page}.json'
        if path.is_file():
            batch=json.loads(path.read_text(encoding='utf-8'))
        else:
            params=dict(categories=VIDEO_CATEGORIES,after=cutoff.isoformat()+'T00:00:00',per_page=100,page=page,
                        _fields='date,title,link')
            body,headers=fetch(API+'?'+urlencode(params))
            pages=re.search(rb'(?im)^x-wp-totalpages:\s*(\d+)',headers)
            if not pages:
                raise ValueError('Nguồn video VPF thiếu số trang.')
            batch=dict(total=int(pages[1]),posts=json.loads(body))
            path.write_text(json.dumps(batch,ensure_ascii=False),encoding='utf-8')
        total=batch['total']
        if not isinstance(total,int) or not 0<=total<=65:
            raise ValueError('Số trang video VPF không hợp lệ.')
        for post in batch['posts']:
            target=official_video(post['link'])
            if target:
                yield date.fromisoformat(post['date'][:10]),target,unescape(post['title']['rendered'])
        page+=1


def archive_articles(doc, league=None):
    for link in doc.xpath('.//h3[contains(@class,"entry-title")]/a'):
        target=official_video(link.get('href',''))
        if not target:
            continue
        times=link.xpath('../../*//time/@datetime')
        try:
            observed = datetime.fromisoformat(times[0])
            day = observed.astimezone(VN).date() if observed.tzinfo else observed.date()
        except (IndexError,ValueError):
            continue
        yield (day, target,
               ' '.join((link.get('title') or link.text_content()).split()))


def scan_archive(load, cache, label, url, cutoff):
    posts = {}
    for page in range(1,65):
        pointer = f'{url}page/{page}/' if page>1 else url
        doc = load(pointer,cache,f'{label}-{page}.html')
        containers = doc.xpath('//div[contains(concat(" ",normalize-space(@class)," ")," td-main-content ")]')
        articles = [post for container in containers for post in archive_articles(container, None if label=='all' else label)]
        if not articles:
            raise ValueError(f'Trang {page} của kho video VPF không có bài đọc được.')
        posts.update({item[1]:item for item in articles if item[0]>=cutoff})
        next_url = f'{url}page/{page+1}/'
        if min(item[0] for item in articles)<cutoff or not doc.xpath('//a[@href=$url]',url=next_url):
            return list(posts.values())
    raise ValueError('Kho video VPF vượt giới hạn phân trang, cần đối chiếu.')


def hub_articles(load, cache):
    doc=load(HUB,cache,'highlight-hub.html')
    articles=[]
    for league,panel in PANELS.items():
        sections=doc.xpath('//*[@id=$panel]',panel=panel)
        if len(sections)!=1:
            raise ValueError('Kho highlight VPF thiếu mục '+league)
        items=list(archive_articles(sections[0],league))
        if not items:
            raise ValueError('Kho highlight VPF không đọc được mục '+league)
        articles.extend(items)
    return articles


def youtube_articles(body, league, playlist=None):
    channel=FPT if playlist else CHANNELS[league]
    feed=ElementTree.fromstring(body)
    identity=feed.findtext('yt:channelId',namespaces=YT_NS)
    if identity not in (channel, channel.removeprefix('UC')):
        raise ValueError('RSS YouTube trả về kênh khác.')
    if playlist and feed.findtext('yt:playlistId',namespaces=YT_NS)!=playlist:
        raise ValueError('RSS YouTube trả về playlist khác.')
    for entry in feed.findall('atom:entry',YT_NS):
        video=entry.findtext('yt:videoId',namespaces=YT_NS) or ''
        title=entry.findtext('atom:title',namespaces=YT_NS)
        stamp=entry.findtext('atom:published',namespaces=YT_NS)
        if not title or not stamp or not VIDEO_ID.fullmatch(video):
            continue
        if entry.findtext('yt:channelId',namespaces=YT_NS)!=channel:
            continue
        try:
            published=datetime.fromisoformat(stamp)
        except ValueError:
            continue
        if published.tzinfo:
            yield (published.astimezone(VN).date(),watch_url(video),title,league,'fpt' if playlist else 'channel')


def youtube_fetch(path, limit):
    result=subprocess.run([
        'curl','-fsS','--proto','=https','--connect-timeout','7','--max-time','16','--max-filesize',str(limit),
        YOUTUBE+path
    ],capture_output=True,check=True)
    return result.stdout


def scan_youtube(league, playlist=None):
    query='playlist_id='+playlist if playlist else 'channel_id='+CHANNELS[league]
    return list(youtube_articles(youtube_fetch('/feeds/videos.xml?'+query,180_000),league,playlist))


def elements(node, name):
    if isinstance(node,dict):
        for key,value in node.items():
            if key==name and isinstance(value,dict):
                yield value
            yield from elements(value,name)
    elif isinstance(node,list):
        for value in node:
            yield from elements(value,name)


def playlist_articles(body, league, season):
    marker=re.search(rb'var ytInitialData\s*=\s*',body)
    if not marker:
        raise ValueError('Thiếu dữ liệu playlist YouTube.')
    doc,_=json.JSONDecoder().raw_decode(body[marker.end():].decode('utf-8','replace'))
    header=doc.get('metadata',{}).get('playlistMetadataRenderer',{}).get('title','')
    years={f'{a}/{b[-2:]}' for a,b in SEASON.findall(header)}
    if season not in years or not LEAGUE[league].search(header):
        raise ValueError('Playlist YouTube khác giải hoặc mùa.')
    items=[]
    for row in elements(doc.get('contents',{}),'lockupViewModel'):
        video=row.get('contentId','')
        metadata=row.get('metadata',{}).get('lockupMetadataViewModel',{})
        title=metadata.get('title',{}).get('content')
        owners={part.get('browseId') for part in elements(metadata,'browseEndpoint')}
        if isinstance(title,str) and owners=={FPT} and VIDEO_ID.fullmatch(video):
            items.append((None,watch_url(video),title,league,'fpt'))
    for row in elements(doc.get('contents',{}),'playlistVideoRenderer'):
        video=row.get('videoId','')
        title=''.join(run.get('text','') for run in row.get('title',{}).get('runs',[]))
        owners={part.get('browseId') for part in elements(row.get('shortBylineText',{}),'browseEndpoint')}
        if title and row.get('isPlayable',True) and owners=={FPT} and VIDEO_ID.fullmatch(video):
            items.append((None,watch_url(video),title,league,'fpt'))
    if not items:
        raise ValueError('Playlist không có video FPT đọc được.')
    return items


def watch_metadata(body, url):
    marker=re.search(rb'var ytInitialPlayerResponse\s*=\s*',body)
    if not marker:
        raise ValueError('Thiếu thông tin trang video YouTube.')
    doc,_=json.JSONDecoder().raw_decode(body[marker.end():].decode('utf-8','replace'))
    details=doc.get('videoDetails',{})
    metadata=doc.get('microformat',{}).get('playerMicroformatRenderer',{})
    if details.get('channelId')!=FPT or watch_url(details.get('videoId',''))!=url:
        raise ValueError('Video YouTube khác kênh hoặc mã video đã xác minh.')
    published=datetime.fromisoformat(metadata.get('publishDate',''))
    if not published.tzinfo or not isinstance(details.get('title'),str):
        raise ValueError('Video YouTube thiếu mốc công bố.')
    return published.astimezone(VN).date(), url, details['title'], None, 'fpt-verified'


def watch_url(video):
    return YOUTUBE+'/watch?v='+video


def is_youtube(url):
    return bool(url and re.fullmatch(r'https://www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}',url))


def match_highlights(data, articles):
    season = data['season']
    start = min(date.fromisoformat(league['start']) for league in data['leagues'].values() if league.get('start'))
    aliases = defaultdict(set)
    for id,club in data['clubs'].items():
        for name in (club['name'],id,*club.get('aliases',[]),*NAMES.get(id,())):
            aliases[normalized(name)].add(id)
    by_pair = defaultdict(list)
    for match in data['matches'].values():
        if match.get('homeClub') and match.get('awayClub'):
            by_pair[match['homeClub'],match['awayClub']].append(match)
    dated_urls={article[1] for article in articles if article[0] is not None}
    found = defaultdict(dict)
    unresolved = {}
    for day,url,title,*section in articles:
        if not HEAD.match(title) or day is not None and day<start:
            continue
        if day is None and url in dated_urls:
            continue
        if not official_video(url) and not is_youtube(url):
            continue
        years = SEASON.findall(title)
        if years and season not in {f'{a}/{b[-2:]}' for a,b in years}:
            continue
        content = HEAD.sub('', title, count=1)
        matchup = re.split(r'[|/:]',content,maxsplit=1)[0]
        separators=list(VERSUS.finditer(matchup)) or list(DASH.finditer(matchup))
        if not separators:
            unresolved[url]=title
            continue
        league = next((key for key,pattern in LEAGUE.items() if pattern.search(content)),None)
        if section and section[0]:
            if league and league!=section[0]:
                unresolved[url]=title
                continue
            league=section[0]
        if not league:
            path = urlsplit(url).path
            league = next((key for key,part in (('nc','video-cup-quoc-gia'),('vl2','video-hang-nhat'),
                                                ('vl1','video-vleague')) if f'/{part}/' in path),None)
        provider=section[1] if len(section)>1 else None
        max_lag = 0 if provider=='fpt-verified' else None if years and league and not is_youtube(url) else 14
        candidates = {}
        for separator in separators:
            names=(matchup[:separator.start()],matchup[separator.end():])
            home_names,away_names=(aliases[normalized(re.sub(r'^CLB\s+','',name.strip(),flags=re.I))] for name in names)
            for home in home_names:
                for away in away_names:
                    for match in by_pair[home,away]:
                        if league and match['league']!=league:
                            continue
                        if day is None:
                            # A playlist without upload dates must identify a single fixture
                            # in its league, including any future meeting of the teams.
                            candidates[match['id']]=(15,match)
                        elif match.get('date'):
                            lag=(day-date.fromisoformat(match['date'])).days
                            if lag>=0 and (max_lag is None or lag<=max_lag):
                                candidates[match['id']]=(lag,match)
        if len(candidates)!=1:
            unresolved[url]=title
            continue
        lag,match=next(iter(candidates.values()))
        if match.get('status')!='final' or match.get('score') is None:
            continue
        rank=0 if official_video(url) else 2 if provider in {'fpt','fpt-verified'} else 1
        key=(rank,lag,day or date.max,len(url),url)
        options=found[match['id']]
        options[url]=min(key,options.get(url,key))
    winners = {}
    for id, options in found.items():
        existing = data['matches'][id].get('highlightUrl')
        official=[url for url in options if official_video(url)]
        if official:
            winners[id]=existing if existing in official else min(official,key=options.get)
        elif not existing:
            winners[id]=min(options,key=options.get)
    return winners,unresolved


def discover(load,cache,data,at,recent_days=None):
    start=min(date.fromisoformat(v['start']) for v in data['leagues'].values() if v.get('start'))
    cutoff=max(start,datetime.fromisoformat(at).date()-timedelta(days=recent_days)) if recent_days else start
    tasks={
        'hub': lambda: hub_articles(load,cache),
        'api': lambda: list(api_articles(cache,cutoff)),
    }
    for league,playlist in PLAYLISTS.items():
        tasks[f'youtube-{league}']=lambda league=league: scan_youtube(league)
        tasks[f'fpt-{league}']=lambda league=league,playlist=playlist: scan_youtube(league,playlist)
        if recent_days is None:
            tasks[f'playlist-{league}']=lambda league=league,playlist=playlist: playlist_articles(
                youtube_fetch('/playlist?list='+playlist,3_000_000),league,data['season'])
    articles, failures, readable = [], {}, set()

    def collect(item):
        label,scan=item
        try:
            return label,scan(),None
        except (ValueError,OSError,subprocess.CalledProcessError,KeyError,TypeError,ElementTree.ParseError) as error:
            return label,[],str(error)

    def read_sources(sources):
        with ThreadPoolExecutor(max_workers=min(8,len(sources))) as pool:
            for label,posts,error in pool.map(collect,sources.items()):
                articles.extend(posts)
                if error:
                    failures[label]=error
                else:
                    readable.add(label)

    read_sources(tasks)
    if recent_days is None or 'api' in failures:
        read_sources({label:lambda label=label,url=url: scan_archive(load,cache,label,url,cutoff)
                      for label,url in ARCHIVES.items()})
    day=datetime.fromisoformat(at).date()
    winners,unresolved=match_highlights(data,[post for post in articles if post[0] is None or post[0]<=day])
    if recent_days is None:
        # Recover a misfiled FPT playlist item only when its actual upload date
        # identifies a single fixture on that day across the three competitions.
        unresolved_fpt=sorted({post[1] for post in articles if len(post)>=5 and post[4]=='fpt' and post[1] in unresolved})
        verified=[]
        with ThreadPoolExecutor(max_workers=4) as pool:
            probes={f'video-{url[-11:]}':lambda url=url: [
                watch_metadata(youtube_fetch(url.removeprefix(YOUTUBE),4_000_000),url)]
                for url in unresolved_fpt[:12]}
            for label,posts,error in pool.map(collect,probes.items()):
                if error:
                    failures[label]=error
                else:
                    verified.extend(posts)
        articles.extend(verified)
        if verified:
            winners,resolved=match_highlights(data,articles)
            matched_urls=set(winners.values())
            unresolved={url:title for url,title in resolved.items() if url not in matched_urls}
    vpf_checked=bool(readable.intersection({'hub','api',*ARCHIVES}))
    full_scan='api' in readable or set(PANELS).issubset(readable)
    fpt_links={post[1] for post in articles if len(post)>=5 and post[4] in {'fpt','fpt-verified'}}
    origins={key: 'VPF · Video tổng hợp' if official_video(url) else
             'FPT Bóng Đá Việt · YouTube' if url in fpt_links else 'VPF · YouTube'
             for key,url in winners.items()}
    coverage={}
    for league in PANELS:
        matches=[m for m in data['matches'].values() if m['league']==league and m['status']=='final' and m.get('score') is not None]
        had=sum(bool(m.get('highlightUrl')) for m in matches)
        missing=[m['id'] for m in matches if not (m.get('highlightUrl') or winners.get(m['id']))]
        coverage[league]=dict(finished=len(matches),previous=had,covered=len(matches)-len(missing),missing=missing)
    return winners,dict(matched=len(winners),review=unresolved,errors=failures,sources=origins,
                        coverage=coverage,vpfChecked=vpf_checked,fullArchiveChecked=full_scan,readable=sorted(readable))
