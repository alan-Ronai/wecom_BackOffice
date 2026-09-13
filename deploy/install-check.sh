#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
for h in "## Clean install" "## Upgrade" "## Backup" "## Restore" "## TLS certificate" "## Microsoft Entra ID" "## Palo Alto User-ID fallback" "## Troubleshooting"; do
  grep -q "^$h" INSTALL.md || { echo "missing section: $h"; exit 1; }
done
for f in docker-compose.yml .env.example backup.sh restore.sh smoke.sh; do grep -q "$f" INSTALL.md || { echo "INSTALL.md does not mention $f"; exit 1; }; done
echo "INSTALL.md ok"
