#!/bin/bash
# Start the Vite dev server — loads .env automatically, no manual export needed.
# Usage: ./start-web.sh
set -e

REPO="$(cd "$(dirname "$0")" && pwd)"

set -a
source "$REPO/.env"
set +a

export PORT="${FRONTEND_PORT:-3000}"
export API_PORT="${API_PORT:-8080}"

echo "Starting web dev server on port $PORT (API proxy → $API_PORT)…"
cd "$REPO/artifacts/autonegotiating"
npx vite --config vite.config.ts --host 0.0.0.0
