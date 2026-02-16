#!/bin/bash
# Homunculus Restart Script with cleanup

set -e

cd /home/joexu/Repos/Homunculus

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Homunculus Restart with Cleanup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check for existing Homunculus processes
EXISTING_PIDS=$(ps aux | grep "python3 -m homunculus" | grep -v grep | awk '{print $2}')

if [ ! -z "$EXISTING_PIDS" ]; then
  echo "⚠️  Found existing Homunculus processes:"
  ps aux | grep "python3 -m homunculus" | grep -v grep
  echo ""
  echo "Killing existing processes..."
  for pid in $EXISTING_PIDS; do
    echo "  - Killing PID $pid"
    kill -9 $pid 2>/dev/null || true
  done
  sleep 2
  echo "✅ Cleanup complete"
  echo ""
fi

# Now start fresh
echo "Starting Homunculus..."
./START.sh
