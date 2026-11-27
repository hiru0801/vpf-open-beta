"""Discover and verify the official VPF registration sheets."""

from collections import defaultdict
from datetime import datetime, timezone
from difflib import SequenceMatcher
from hashlib import sha256
import json
import os
import re
import subprocess
import tempfile
import unicodedata
from pathlib import Path
from urllib.parse import urlencode, urlsplit

from lxml import html

from vpf_http import fetch

CATEGORIES = {'vl1': 683, 'vl2': 691, 'nc': 687}
POSITIONS = {'TM': 'Thủ môn', 'HV': 'Hậu vệ', 'TV': 'Tiền vệ', 'TD': 'Tiền đạo'}
ROW = re.compile(r'^\s*(\d{1,2})[.\s]+(TM|HV|TV|TD)[._\s]+(\d{1,3})[._\s]+(.+?)\s+(?:19|20)\d{2}\b')


def fold(value):
    return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFD', value.lower().replace('đ', 'd')))


def club_label(value):
    value = re.sub(r'\b(?:CLB|FC)\b', '', value, flags=re.I)
    return fold(value)


def title_match(title, league, season, aliases, fixtures):
    text = html.fragment_fromstring(title, create_parent=True).text_content()
    if season not in text:
        return None
    header, _, description = text.partition('(')
    teams = re.fullmatch(r'Danh sách (?:đăng ký(?: thi đấu)?|thi đấu)\s+(.+?)\s+(?:vs\.?|–)\s+(.+?)\s*', header, re.I)
    if not teams:
        return None
    clubs = [aliases.get(club_label(team), set()) for team in teams.groups()]
    phase = re.search(r'vòng\s+(\d+)', description, re.I)
    if league == 'nc':
        round_number = next((value for marker, value in [('vongloai', 1), ('vong18', 2),
                            ('tuket', 3), ('banket', 4), ('chungket', 5)] if marker in fold(description)), None)
    else:
        round_number = int(phase[1]) if phase else None
    hits = [m for m in fixtures if m['league'] == league and (round_number is None or m['round'] == round_number)
            and m['homeClub'] in clubs[0] and m['awayClub'] in clubs[1]]
    return hits


def documents(league, season, backfill=False):
    params = {'categories': CATEGORIES[league], 'orderby': 'modified', 'per_page': 100 if backfill else 20,
              'after': f'{season[:4]}-08-01T00:00:00', '_fields': 'id,date_gmt,modified_gmt,link,title,content'}
    body, _ = fetch('https://vpf.vn/wp-json/wp/v2/posts?' + urlencode(params))
    posts = json.loads(body)
    if not isinstance(posts, list):
        raise ValueError('WordPress không trả danh sách bài.')
    return posts


def image_urls(post):
    content = html.fragment_fromstring(post['content']['rendered'], create_parent=True)
    urls = []
    for image in content.xpath('.//img'):
        versions = [part.strip().split() for part in image.get('srcset', '').split(',')]
        large = [(int(width[:-1]), url) for url, width in (x for x in versions if len(x) == 2)
                 if re.fullmatch(r'\d+w', width)]
        url = max(large)[1] if large else image.get('src', '')
        location = urlsplit(url)
        if location.scheme == 'https' and location.netloc == 'vpf.vn' and location.path.startswith('/wp-content/uploads/'):
            urls.append(url)
    return list(dict.fromkeys(urls))[:4]


def read_image(payload):
    with tempfile.TemporaryDirectory(prefix='vpf-ocr-') as directory:
        image = Path(directory) / 'registration'
        image.write_bytes(payload)
        result = subprocess.run(['tesseract', str(image), 'stdout', '-l', 'eng', '--psm', '6'],
                                capture_output=True, text=True, check=True, timeout=25,
                                env={**os.environ, 'OMP_THREAD_LIMIT': '1'})
    return result.stdout


def similarity(ocr_name, name):
    def words(value):
        value = re.sub(r'\([^)]*\)', '', value)
        parts = [fold(word) for word in value.split()]
        return ''.join(sorted(parts))
    original = fold(re.sub(r'\([^)]*\)', '', ocr_name))
    return max(SequenceMatcher(None, original, fold(name)).ratio(),
               SequenceMatcher(None, words(ocr_name), words(name)).ratio())


def roster_rows(lines, players, minimum):
    by_number = defaultdict(list)
    for p in players:
        by_number[p.get('number')].append(p)
    rows, unverified = [], []
    if len(lines) < minimum or len(lines) > 20:
        return None
    if [int(row[1]) for row in lines] != list(range(1, len(lines) + 1)):
        return None
    if len({row[3] for row in lines}) != len(lines) or not any(row[2] == 'TM' for row in lines[:11]):
        return None
    for order, position, number, name in (row.groups() for row in lines):
        number = int(number)
        candidates = [p for p in by_number[number] if similarity(name, p['name']) >= .66]
        if len(candidates) != 1:
            unverified.append(number)
            continue
        player = candidates[0]
        rows.append({'number': number, 'name': player['name'], 'position': POSITIONS[position]})
    # Never publish a lineup whose OCR may have skipped a registered player.
    if unverified:
        return None
    return {'starters': rows[:11], 'substitutes': rows[11:]}


def find_header(text):
    for line in text.splitlines():
        header = re.search(r'\(\s*\d{1,3}\s*\)\s*(.+?)\s+-\s+(.+?)\s+-\s+[^\d]{1,15}(\d{1,2})/(\d{1,2})/(20\d{2})\s+-\s+[^\d]{1,15}(\d{1,2}):(\d{2})', line)
        if header:
            home, away, day, month, year, hour, minute = header.groups()
            return home, away, f'{year}-{int(month):02d}-{int(day):02d}', f'{int(hour):02d}:{minute}'
    return None


def squads_from_text(text, match, data, aliases):
    header = find_header(text)
    if not header or header[2:] != (match.get('date'), match.get('time')):
        return [None, None]
    def header_matches(label, club_id):
        return any(SequenceMatcher(None, club_label(label), name).ratio() >= .77
                   for name, ids in aliases.items() if club_id in ids)
    ids = [match['homeClub'], match['awayClub']]
    if not all(header_matches(label, club) for label, club in zip(header[:2], ids)):
        return [None, None]
    groups = []
    for line in text.splitlines():
        row = ROW.match(line)
        if not row:
            continue
        if row[1] == '1':
            groups.append([])
        if groups:
            groups[-1].append(row)
    # Without both row-1 anchors, the OCR does not establish which side a table belongs to.
    if len(groups) != 2:
        return [None, None]
    squads = []
    for group, club_id in zip(groups, ids):
        players = data['rosters'].get(club_id, {}).get('players', [])
        squads.append(roster_rows(group, players, 16 if match["league"] == "vl1" else 11))
    return squads


def candidates(post, league, data, aliases, fixtures):
    matches = title_match(post['title']['rendered'], league, data['season'], aliases, fixtures)
    if not matches:
        return []
    return [(match, url) for match in matches for url in image_urls(post)]


def read_sheet(post, url, match, data, aliases, previous, *, fetch_image=fetch, ocr=read_image):
    published = post['date_gmt'] + 'Z'
    modified = post['modified_gmt'] + 'Z'
    if previous and (previous['postId'], previous['modifiedAt'], previous['image']) == (post['id'], modified, url):
        return previous
    body, _ = fetch_image(url)
    if len(body) > 12_000_000 or not body.startswith((b'\xff\xd8\xff', b'\x89PNG\r\n\x1a\n')):
        raise ValueError('Ảnh phiếu không đúng định dạng hoặc vượt giới hạn.')
    first_seen = datetime.now(timezone.utc).isoformat(timespec='seconds')
    digest = sha256(body).hexdigest()
    if previous and previous['sha256'] == digest:
        return {**previous, 'modifiedAt': modified, 'image': url, 'postId': post['id'],
                'source': post['link'], 'publishedAt': published}
    teams = squads_from_text(ocr(body), match, data, aliases)
    return {'postId': post['id'], 'sha256': digest, 'source': post['link'], 'image': url,
            'publishedAt': published, 'modifiedAt': modified, 'firstSeenAt': first_seen, 'teams': teams}
