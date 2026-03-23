#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./deploy-pi.sh <pi_host> [pi_user] [remote_dir]
# Example:
#   ./deploy-pi.sh 192.168.1.50 pi /opt/timemachine-screens
#
# Optional env var:
#   DRY_RUN=1 ./deploy-pi.sh 192.168.1.50

PI_HOST="${1:-}"
PI_USER="${2:-jverne}"
REMOTE_DIR="${3:-/opt/timemachine-screens}"

if [[ -z "${PI_HOST}" ]]; then
  echo "Usage: $0 <pi_host> [pi_user] [remote_dir]"
  exit 1
fi

LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE="${PI_USER}@${PI_HOST}"

RSYNC_FLAGS=(-avz --delete --itemize-changes)
if [[ "${DRY_RUN:-0}" == "1" ]]; then
  RSYNC_FLAGS+=(-n)
  echo "Mode simulation actif (DRY_RUN=1)."
fi

echo "1) Synchronisation des fichiers vers ${REMOTE}:${REMOTE_DIR}"
rsync "${RSYNC_FLAGS[@]}" \
  --exclude ".git/" \
  --exclude "node_modules/" \
  --exclude ".env" \
  --exclude ".DS_Store" \
  --exclude "npm-debug.log*" \
  --filter "P .env" \
  "${LOCAL_DIR}/" \
  "${REMOTE}:${REMOTE_DIR}/"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "Simulation terminee. Aucun changement applique."
  exit 0
fi

#echo "2) Build et redemarrage des conteneurs sur le Raspberry"
#ssh "${REMOTE}" "cd '${REMOTE_DIR}' && docker compose build && docker compose up -d && docker compose ps"

echo "Deploiement termine."
