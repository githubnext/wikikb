#!/usr/bin/env bash
set -euo pipefail

# LexCAT-only KB search. WIKIKB_TARGET must name a registered, synced,
# and indexed target. The wkb command fails if the runtime cannot run.
#
# Usage:
#   tools/kb-search.sh "query" [--top N]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
QUERY=""
TOP=15

while [[ $# -gt 0 ]]; do
  case "$1" in
    --top)
      if [[ $# -lt 2 || ! "${2:-}" =~ ^[1-9][0-9]*$ ]]; then
        echo "Error: --top requires a positive integer." >&2
        exit 2
      fi
      TOP="$2"
      shift 2
      ;;
    --*)
      echo "Error: unknown option '$1'." >&2
      exit 2
      ;;
    *)
      if [[ -n "$QUERY" ]]; then
        echo "Error: unexpected argument '$1'." >&2
        exit 2
      fi
      QUERY="$1"
      shift
      ;;
  esac
done

if [[ -z "$QUERY" ]]; then
  echo "Usage: tools/kb-search.sh \"query\" [--top N]" >&2
  exit 1
fi

if [[ -z "${WIKIKB_TARGET:-}" ]]; then
  echo "Error: WIKIKB_TARGET is required; no alternate search path exists." >&2
  exit 1
fi

exec "$REPO_ROOT/tools/wikikb-local/wkb" "$WIKIKB_TARGET" search "$QUERY" --top "$TOP"
