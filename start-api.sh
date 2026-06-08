#!/bin/bash
# Start the API server — loads .env automatically, no manual export needed.
# Usage: ./start-api.sh
set -e

REPO="$(cd "$(dirname "$0")" && pwd)"

# Load .env — set -a auto-exports every variable that gets set
set -a
source "$REPO/.env"
set +a

# .env uses API_PORT; the server binary expects PORT
export PORT="${PORT:-${API_PORT:-8080}}"

echo "Starting API server on port $PORT…"
cd "$REPO/artifacts/api-server"
node ./build.mjs
node --enable-source-maps ./dist/index.mjs
