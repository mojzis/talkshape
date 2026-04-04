#!/bin/bash
set -e

# Check for Claude credentials
CRED_FILE="$HOME/.claude/.credentials.json"
if [ ! -f "$CRED_FILE" ]; then
  echo "Error: Claude credentials not found at $CRED_FILE"
  echo "Run 'claude login' first to authenticate."
  exit 1
fi

# Check for Docker
if ! command -v docker &> /dev/null; then
  echo "Error: Docker is not installed or not in PATH."
  exit 1
fi

echo "Starting TalkShape..."
docker compose up --build
