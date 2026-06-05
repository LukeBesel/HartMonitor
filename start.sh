#!/bin/bash
# Claude MES - Start script
# Builds frontend and starts backend serving both API + static files

set -e
echo "Building frontend..."
cd frontend && npm run build && cd ..

echo "Starting Claude MES on http://localhost:3001"
node backend/src/index.js
