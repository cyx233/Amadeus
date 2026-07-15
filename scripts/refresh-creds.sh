#!/bin/bash
# Refresh AWS credentials for the Amadeus container.
# Run on the host. Writes ada credentials to a file the container mounts.
# Add to crontab for auto-refresh: */30 * * * * /path/to/refresh-creds.sh

set -e

OUT="${HOME}/.aws/amadeus-creds.json"

# ada outputs credential_process-compatible JSON
/Users/yuxchen/.toolbox/bin/ada credentials print --profile=dev-Admin > "${OUT}.tmp"
mv "${OUT}.tmp" "${OUT}"
chmod 600 "${OUT}"

echo "[$(date)] Credentials refreshed → ${OUT}"
