#!/usr/bin/env bash
# Read VPF from an authorized environment, verify the result and write one delivery JSON.
set -euo pipefail
output=$(realpath -m "${1:?Supply an output path}")
python_exec=${VPF_PYTHON:-python3}
repo=hiru0801/vpf-open-beta
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
fetch() {
  curl -fsS --proto '=https' --retry 2 --retry-max-time 30 --max-time 20 "$@"
}
tip() {
  fetch "https://api.github.com/repos/$repo/git/ref/heads/$1?at=$(date +%s)" |
    jq -er '.object.sha | select(test("^[a-f0-9]{40}$"))'
}
main="$(tip main)"
state="$(tip open-beta-data)"
raw=https://raw.githubusercontent.com/$repo
fetch "$raw/$main/vpf-bundle.zip" -o "$scratch/vpf-bundle.zip"
fetch "$raw/$main/.github/workflows/open-beta.yml" -o "$scratch/open-beta.yml"
fetch "$raw/$main/tools/highlights/reader.patch" -o "$scratch/highlight-reader.patch"
fetch "$raw/$main/tools/highlights/vpf_highlights.py" -o "$scratch/vpf_highlights.py"
fetch "$raw/$main/tools/highlights/archive-evidence.json" -o "$scratch/highlight-archive-evidence.json"
fetch "$raw/$state/data/updates.json" -o "$scratch/updates.json"
if ! fetch "$raw/$main/vpf-sync-input.json" -o "$scratch/delivery.json"; then
  rm -f -- "$scratch/delivery.json"
fi
(
  cd "$scratch"
  printf '%s  %s\n' e6e7198cde9b4bef3c81112d044b008b73671ff5eaff6000315966c7ac85ca70 vpf-bundle.zip | sha256sum -c
  unzip -q vpf-bundle.zip
  awk '/^          git apply <</{body=1;next} /^          VPF_PATCH$/{exit} body{print substr($0,11)}' open-beta.yml > source.patch
  git apply source.patch
  git apply highlight-reader.patch
  install -m 644 vpf_highlights.py highlight-archive-evidence.json app/tools/
  "$python_exec" app/tools/vpf_delivery.py --base updates.json --output delivery.json
)
install -m 600 "$scratch/delivery.json" "$output"
