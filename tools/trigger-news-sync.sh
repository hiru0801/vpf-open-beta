#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_TOKEN:?Missing GITHUB_TOKEN}"
REPO="${GITHUB_REPO:-hiru0801/vpf-open-beta}"
WORKFLOW="${NEWS_WORKFLOW:-sync-news.yml}"

curl -fsS -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches" \
  -d '{"ref":"main"}'
