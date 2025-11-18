#!/usr/bin/env bash
# Delete duplicate artifacts with the same name in the current run,
# keeping only the newest finalized artifact.
#
# Usage (from a GH Actions step):
#   env:
#     GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
#     REPO: ${{ github.repository }}
#     RUN_ID: ${{ github.run_id }}
#     ARTIFACT_NAME: probe-metrics
#   run: scripts/cleanup-duplicate-artifacts.sh
set -euo pipefail

: "${GITHUB_TOKEN:?required}"
: "${REPO:?required (owner/repo)}"
: "${RUN_ID:?required (github.run_id)}"
: "${ARTIFACT_NAME:?required (e.g. probe-metrics)}"

echo "Listing artifacts for run $RUN_ID in $REPO (matching name: $ARTIFACT_NAME)..."

artifacts_api="https://api.github.com/repos/$REPO/actions/runs/$RUN_ID/artifacts"
artifacts_json=$(curl -s -H "Authorization: token $GITHUB_TOKEN" "$artifacts_api")

# select artifacts that match the name, sort by created_at desc (newest first)
mapfile -t candidates < <(echo "$artifacts_json" \
  | jq -r --arg name "$ARTIFACT_NAME" '.artifacts[] | select(.name == $name) | "\(.id) \(.created_at) \(.size_in_bytes)"' \
  | sort -r -k2)

if [ "${#candidates[@]}" -le 1 ]; then
  echo "No duplicates found (count=${#candidates[@]}). Nothing to delete."
  exit 0
fi

echo "Found ${#candidates[@]} artifact(s) with that name; keeping the newest and deleting the rest."
# keep the first (newest), delete the rest
first=1
for entry in "${candidates[@]}"; do
  art_id=$(echo "$entry" | awk '{print $1}')
  art_created=$(echo "$entry" | awk '{print $2}')
  art_size=$(echo "$entry" | awk '{print $3}')
  if [ $first -eq 1 ]; then
    echo "Keeping artifact id=$art_id created_at=$art_created size=$art_size"
    first=0
    continue
  fi

  echo "Deleting duplicate artifact id=$art_id created_at=$art_created size=$art_size"
  del_url="https://api.github.com/repos/$REPO/actions/artifacts/$art_id"
  http_status=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE -H "Authorization: token $GITHUB_TOKEN" "$del_url" || echo "000")
  if [ "$http_status" -ge 200 ] && [ "$http_status" -lt 300 ]; then
    echo "Deleted artifact $art_id (HTTP $http_status)"
  else
    echo "Warning: failed to delete artifact $art_id (HTTP $http_status). Will continue."
  fi
done

echo "Duplicate cleanup finished."