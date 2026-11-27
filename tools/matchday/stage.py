"""Stage the approved Pages release with the latest match-day files."""

import argparse
import json
from pathlib import Path
import shutil

from release_inputs import verify_bundle


def copy_live(state, output, season):
    if (state/'live'/'index.json').is_file():
        shutil.copytree(state/'live', output/'live', dirs_exist_ok=True, ignore=shutil.ignore_patterns('.*'))
    else:
        (output/'live').mkdir()
        (output/'live'/'index.json').write_text(json.dumps({'schema': 1, 'season': season, 'matches': {}})+'\n',
                                                encoding='utf-8')


def stage(state, output):
    sealed = state/'sealed'
    release = verify_bundle(sealed)
    shutil.copytree(sealed, output)
    for directory in (state/'previous-assets').glob('*'):
        dest = output/'releases'/directory.name
        if not dest.exists():
            shutil.copytree(directory, dest)
    for filename in ('news-feed.json', 'data-status.json'):
        shutil.copyfile(state/filename, output/filename)
    copy_live(state, output, release['season'])
    (output/'release-files.json').unlink()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    stage(args.state.resolve(), args.output.resolve())
