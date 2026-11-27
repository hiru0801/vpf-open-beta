"""Read match-day progress from the official VPF match page."""

from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
import re
import runpy
from urllib.parse import parse_qs, urlsplit

from lxml import html

from vpf_http import fetch

core = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'backfill-vpf.py'))
source = core['source']
cls, text, one = (source[key] for key in ('cls', 'text', 'one'))
CALENDARS = core['CALENDARS']
VN = source['VN']


def active_matches(data, now):
    for match in data['matches'].values():
        if match['status'] not in ('scheduled', 'final') or not match.get('homeClub') or not match.get('awayClub'):
            continue
        if not match.get('date') or not match.get('time'):
            continue
        start = datetime.fromisoformat(f'{match["date"]}T{match["time"]}:00').replace(tzinfo=VN)
        # Recheck after the final whistle for VPF event and substitution corrections.
        if -timedelta(hours=4) <= start-now <= timedelta(minutes=25):
            yield match


def match_links(league, matches, data, fetch_page=fetch):
    _, _, url = CALENDARS[league]
    raw, _ = fetch_page(url)
    rows = list(source['calendar_rows'](html.fromstring(raw.decode('utf-8'))))
    if not rows:
        raise ValueError('Không đọc được lịch trận của ' + league)
    for match in matches:
        aliases = [core['club_aliases'](data['clubs'][match[side]]) for side in ('homeClub', 'awayClub')]
        rows_for_match = [row for row in rows if row.date == match['date'] and row.kickoff == match['time']
                          and all(core['FOLD'](name) in known for name, known in zip(row.teams, aliases))
                          and row.url and not row.postponed]
        if len(rows_for_match) == 1:
            yield match, rows_for_match[0]


def status_of(view):
    nodes = view.xpath(f'.//*[{cls("jo-match-status")}]')
    label = ' '.join(text(n) for n in nodes).strip().lower()
    if re.search(r'\b(?:ht|half[ -]time)\b|nghỉ giữa hiệp|hết hiệp\s*1', label):
        return 'halfTime'
    if re.search(r'\blive\b|đang diễn ra|hiệp\s*[12]|\b\d{1,3}\s*[′\x27]', label):
        return 'live'
    if re.fullmatch(r'(?:ft|aet|full[ -]time|(?:đã )?kết thúc|hết trận)[.! ]*', label):
        return 'final'
    return None


def score_of(view):
    goals = []
    for side in (1, 2):
        nodes = view.xpath(f'.//*[{cls(f"BigMScore{side}")}]')
        if len(nodes) != 1 or not re.fullmatch(r'\d{1,2}', text(nodes[0])):
            return None
        goals.append(int(text(nodes[0])))
    return goals


def read_match(doc, match, row, now, previous=None):
    _, sid, _ = CALENDARS[match['league']]
    view = one(doc, '//*[@id="jsMatchViewID"]')
    links = view.xpath(f'.//*[{cls("jsMatchPartName")}]//a')
    if [text(link) for link in links] != row.teams or any(
        parse_qs(urlsplit(link.get('href', '')).query).get('sid') != [sid] for link in links
    ):
        raise ValueError('Trang trận sai hai đội hoặc mùa.')
    stamp = re.search(r'(\d{2}) tháng (\d+), (\d{4})\s*-\s*(\d{2}:\d{2})',
                      text(one(view, f'.//*[{cls("matchdtime")}]')), re.I)
    if not stamp or (f'{stamp[3]}-{int(stamp[2]):02d}-{stamp[1]}', stamp[4]) != (match['date'], match['time']):
        raise ValueError('Trang trận sai ngày hoặc giờ đấu.')
    form = None
    try:
        form = source['parse_squads'](view, row.teams, [])
    except ValueError:
        pass
    score = score_of(view)
    status = status_of(view)
    # Blank is normal after full time on this site. The reviewed release, or a
    # full-time label plus matching official calendar, must confirm the result.
    if status not in ('live', 'halfTime') and score is not None and row.score == score and (
        status == 'final' or match['status'] == 'final' and match.get('score') == score
    ):
        status = 'final'
    if status == 'final' and (score is None or row.score != score):
        return None, form
    if status in ('live', 'halfTime') and (score is None or match['status'] == 'final'
                                          or previous and previous['status'] == 'final'):
        return None, form
    if status is None:
        return None, form
    result = {'status': status, 'score': score, 'penalties': row.penalties if status == 'final' else None,
              'source': row.url, 'changes': {
                  str(side): [{'number': player['number'], 'name': player['name'],
                               **{key: player[key] for key in ('changeMinute', 'exitMinute') if player.get(key)}}
                              for player in squad['starters']+squad['substitutes']
                              if player.get('changeMinute') or player.get('exitMinute')]
                  for side, squad in enumerate(form or []) if squad
              }, 'observedAt': now}
    try:
        events = source['parse_events'](view)
        goals = Counter(e['side'] for e in events or [] if e['type'] in ('goal', 'penalty', 'ownGoal'))
        if events is not None and all(goals[side] <= score[side] for side in (0, 1)):
            result['events'] = events
    except (ValueError, KeyError):
        pass
    if 'events' not in result and previous and previous['score'] == score and 'events' in previous:
        result['events'] = previous['events']
    return result, form


def read_page(match, row, now, previous, fetch_page=fetch):
    raw, _ = fetch_page(row.url)
    return read_match(html.fromstring(raw.decode('utf-8')), match, row, now, previous)
