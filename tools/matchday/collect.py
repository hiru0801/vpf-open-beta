"""Build a small static match-day feed. Browser traffic never reaches VPF."""

import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

from . import registration, timeline

READ_ERRORS = (OSError, ValueError, KeyError, TypeError, IndexError, subprocess.SubprocessError)
ID = re.compile(r'(?:vl[12]|nc)-[A-Za-z0-9-]{1,45}')


def read(path, default):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else default


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True)+'\n').encode()


def save(path, value):
    payload = json_bytes(value)
    if path.exists() and path.read_bytes() == payload:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as scratch:
        scratch.write(payload)
    Path(scratch.name).replace(path)
    return True


def names_for(data):
    aliases = defaultdict(set)
    aliases['dhvanhien'].add('VHI')
    for club_id, club in data['clubs'].items():
        for name in [club['name'], *club.get('aliases', [])]:
            aliases[registration.club_label(name)].add(club_id)
    return aliases


def jobs_for(data, now, operators):
    match_jobs = defaultdict(list)
    for match in timeline.active_matches(data, now):
        match_jobs[match['league']].append(match)
    for group in match_jobs.values():
        group.sort(key=lambda match: (match['date'], match['time'], match['id']))
    for league, group in match_jobs.items():
        operators('calendar:'+league, lambda league=league, group=group: list(timeline.match_links(league, group, data)))


def retrieve(pool, work, errors):
    pending = {pool.submit(call): name for name, call in work}
    for task in as_completed(pending):
        name = pending[task]
        try:
            yield name, task.result()
        except READ_ERRORS as error:
            errors.append(f'{name} · {error}')


def identity(m):
    return [m['homeClub'], m['awayClub'], m.get('date'), m.get('time')]


def latest_sheet(history, url):
    return next((value for value in reversed(history) if value['image'] == url), None)


def record_sheet(record, sheet, errors):
    if not any(sheet['teams']):
        errors.append('OCR cần đối chiếu · ' + sheet['source'])
    current = record['sheets']
    key = (sheet['sha256'], sheet['postId'])
    match = next((index for index, item in enumerate(current)
                  if (item['sha256'], item['postId']) == key), None)
    if match is not None:
        current[match] = sheet
    else:
        current.append(sheet)
    current.sort(key=lambda item: (item['modifiedAt'], sum(map(bool,item['teams'])), item['image']))
    del current[:-8]


def fallback_lineup(squad, source, now):
    if not squad or len(squad['starters']) != 11:
        return None
    numbers = [p['number'] for p in squad['starters']+squad['substitutes']]
    if None in numbers or len(set(numbers)) != len(numbers):
        return None
    return {'squad': squad, 'source': source, 'firstSeenAt': now, 'kind': 'match-page'}


def reconcile(record):
    result = []
    for side in (0, 1):
        version = next((v for v in reversed(record['sheets']) if v['teams'][side]), None)
        if version:
            squad = version['teams'][side]
            result.append({**{k: version[k] for k in ('source','image','publishedAt','firstSeenAt')},
                           'squad': squad, 'kind': 'registration'})
        else:
            result.append(record['fallback'][side])
    return result


def collection(data, store, now, backfill=False):
    errors = []
    prior = read(store, {'season': data['season'], 'matches': {}})
    records = prior['matches'] if prior['season'] == data['season'] else {}
    aliases = names_for(data)
    fixtures = [m for m in data['matches'].values() if m.get('homeClub') and m.get('awayClub') and m.get('date')]
    stamp = now.isoformat(timespec='seconds')

    def record(match):
        mid = match['id']
        current = records.get(mid)
        if current and current['fixture'] == identity(match):
            return current
        records[mid] = {'fixture': identity(match), 'sheets': [], 'fallback': [None, None], 'timeline': None}
        return records[mid]

    work = [('posts:'+league, lambda league=league: registration.documents(league, data['season'], backfill))
            for league in registration.CATEGORIES]
    jobs_for(data, now, lambda name, job: work.append((name, job)))
    with ThreadPoolExecutor(max_workers=4) as pool:
        sheets, pages = [], []
        for group, found in retrieve(pool, work, errors):
            kind, league = group.split(':')
            if kind == 'posts':
                for post in found:
                    for match, url in registration.candidates(post, league, data, aliases, fixtures):
                        current = record(match)
                        previous = latest_sheet(current['sheets'], url)
                        if previous and previous['modifiedAt'] == post['modified_gmt']+'Z' and previous['postId'] == post['id']:
                            continue
                        def read_sheet(post=post, url=url, match=match, previous=previous):
                            return registration.read_sheet(post, url, match, data, aliases, previous)
                        sheets.append((post['modified_gmt'], match['id'], read_sheet))
            else:
                for match, row in found:
                    current = record(match)
                    def read_match(match=match, row=row, previous=current['timeline']):
                        return row, timeline.read_page(match, row, stamp, previous)
                    pages.append((match['id'],read_match))
        for mid, (row, (result, form)) in retrieve(pool, pages, errors):
            current = records[mid]
            if result:
                prior_result = current['timeline']
                if not prior_result or {k:v for k,v in prior_result.items() if k!='observedAt'} != {
                    k:v for k,v in result.items() if k!='observedAt'
                } or result['status'] in ('live', 'halfTime') and now-datetime.fromisoformat(
                    prior_result['observedAt']) >= timedelta(minutes=10):
                    current['timeline'] = result
            for side,squad in enumerate(form or []):
                # Keep this lower priority source only for teams without a verified sheet.
                if any(sheet['teams'][side] for sheet in current['sheets']):
                    continue
                fallback = fallback_lineup(squad, row.url, stamp)
                if fallback and (not current['fallback'][side] or squad != current['fallback'][side]['squad']):
                    current['fallback'][side] = fallback
        # Work through older sheets over successive polls. A new post always
        # gets ahead of the backlog, including replacements issued after kickoff.
        sheets.sort(key=lambda job: job[0],reverse=True)
        batch = sheets if backfill else sheets[:12]
        for mid, sheet in retrieve(pool, [(mid,reader) for _,mid,reader in batch], errors):
            record_sheet(records[mid], sheet, errors)
    records = {mid: current for mid, current in records.items()
               if mid in data['matches'] and identity(data['matches'][mid]) == current['fixture']
               and (current['timeline'] or current['sheets'] or any(current['fallback']))}
    save(store, {'season': data['season'], 'matches': records})
    return records, errors


def export(records, directory, data, now):
    index = {}
    for mid, record in sorted(records.items()):
        if not ID.fullmatch(mid):
            raise ValueError('Mã trận không hợp lệ: '+mid)
        lineup = reconcile(record)
        match, result = data['matches'][mid], record['timeline']
        start = datetime.fromisoformat(record['fixture'][2]).date()
        age = (now.date() - start).days
        if not any(lineup) and (not result or age > 3 and match['status'] == 'final'):
            continue
        if result and match['status'] == 'final' and (
            result['status'] != 'final' or match.get('score') != result['score']
        ):
            result = None
        entry = {'fixture': record['fixture'], 'lineup': lineup, 'timeline': result}
        version = sha256(json_bytes(entry)).hexdigest()[:16]
        save(directory/'matches'/(mid+'.json'), {**entry, 'version': version})
        summary = {'version': version}
        if result and match['status'] != 'final':
            summary.update({key: result[key] for key in ('status','score','penalties','observedAt')})
            summary['fixture'] = record['fixture']
        index[mid] = summary
    for file in (directory/'matches').glob('*.json'):
        if file.stem not in index:
            file.unlink()
    return save(directory/'index.json', {'schema': 1, 'season': data['season'], 'matches': index})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--backfill', action='store_true', help='Check all season registration posts in each category.')
    options = parser.parse_args()
    state = options.state.resolve()
    update = read(state/'updates.json', None)
    data = timeline.core['snapshot'](update)
    data['rosters'] = update.get('rosters',{}) if update else {}
    now = datetime.now(timeline.VN)
    records, errors = collection(data, state/'live-history.json', now, options.backfill)
    changed = export(records, state/'live', data, now)
    for error in errors:
        print(error, file=sys.stderr)
    print(json.dumps({'changed': changed, 'matches': len(records), 'warnings': len(errors)}))


if __name__ == '__main__':
    main()
