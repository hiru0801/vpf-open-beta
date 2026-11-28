"""Unpack the verified VPF app and apply repository overlays."""

import argparse
from hashlib import sha256
from pathlib import Path
import shutil
import subprocess
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
PACKAGE_SHA = 'e6e7198cde9b4bef3c81112d044b008b73671ff5eaff6000315966c7ac85ca70'


def unpack():
    if (ROOT/'app').exists():
        raise FileExistsError('Hãy chuẩn bị ứng dụng từ một checkout chưa giải nén gói.')
    archive = ROOT/'vpf-bundle.zip'
    if sha256(archive.read_bytes()).hexdigest() != PACKAGE_SHA:
        raise ValueError('Sai mã băm của vpf-bundle.zip.')
    with ZipFile(archive) as package:
        package.extractall(ROOT)
    workflow = (ROOT/'.github/workflows/open-beta.yml').read_text(encoding='utf-8')
    marker = "          git apply <<'VPF_PATCH'\n"
    end = "          VPF_PATCH\n"
    patch = workflow.split(marker, 1)[1].split(end, 1)[0]
    patch = ''.join(line[10:] if line.startswith(' '*10) else line for line in patch.splitlines(keepends=True))
    subprocess.run(['git', 'apply', '-'], cwd=ROOT, text=True, input=patch, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--overlay-only', action='store_true')
    if not parser.parse_args().overlay_only:
        unpack()
    source = ROOT/'tools/matchday'
    subprocess.run(['git', 'apply', str(source/'integration.patch')], cwd=ROOT, check=True)
    (ROOT/'app/tools/live').mkdir(exist_ok=True)
    shutil.copyfile(source/'live-view.js', ROOT/'app/live-view.js')
    for module in sorted(source.glob('*.py')):
        shutil.copyfile(module, ROOT/'app/tools/live'/module.name)
    news = ROOT/'tools/news'
    subprocess.run(['git', 'apply', str(news/'integration.patch')], cwd=ROOT, check=True)
    for logo in sorted((news/'assets').glob('press-*.png')):
        shutil.copyfile(logo, ROOT/'app/assets'/logo.name)
    brand = ROOT/'tools/brand'
    subprocess.run(['git', 'apply', str(brand/'integration.patch')], cwd=ROOT, check=True)
    legal = ROOT/'tools/legal'
    subprocess.run(['git', 'apply', str(legal/'integration.patch')], cwd=ROOT, check=True)
    for name in ('legal.html', 'legal.css', 'news-view.js'):
        shutil.copyfile(legal/name, ROOT/'app'/name)
    highlights = ROOT/'tools/highlights'
    for patch in ('reader.patch', 'pages.patch'):
        subprocess.run(['git', 'apply', str(highlights/patch)], cwd=ROOT, check=True)
    shutil.copyfile(highlights/'vpf_highlights.py', ROOT/'app/tools/vpf_highlights.py')
    shutil.copyfile(highlights/'archive-evidence.json', ROOT/'app/tools/highlight-archive-evidence.json')


if __name__ == '__main__':
    main()
