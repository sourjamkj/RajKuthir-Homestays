#!/bin/sh
set -e
# The repo's config and persona win on every start; sessions on the volume stay.
mkdir -p "$HERMES_HOME"
cp /opt/rk/config.yaml "$HERMES_HOME/config.yaml"
cat /opt/rk/SOUL.md /opt/rk/house-rules.txt > "$HERMES_HOME/SOUL.md"
exec hermes gateway run
