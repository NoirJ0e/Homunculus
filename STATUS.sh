#!/bin/bash
# Homunculus Status Check

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Homunculus Status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check for running processes
PIDS=$(ps aux | grep "python3 -m homunculus" | grep -v grep | awk '{print $2}')

if [ -z "$PIDS" ]; then
  echo "❌ Homunculus is NOT running"
  echo ""
  echo "To start: ./START.sh"
  exit 1
else
  echo "✅ Homunculus is running"
  echo ""
  ps aux | grep "python3 -m homunculus" | grep -v grep
  echo ""
  
  # Show recent log tail
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Recent logs (last 10 lines):"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  # Try to get logs from the most recent process
  LATEST_PID=$(echo "$PIDS" | head -1)
  
  # Show QMD index status
  echo ""
  echo "QMD Memory Status:"
  cd ~/.homunculus/agents/kovach
  XDG_CACHE_HOME=qmd/xdg-cache /home/joexu/.cache/.bun/bin/qmd status 2>&1 | head -15
  
  exit 0
fi
