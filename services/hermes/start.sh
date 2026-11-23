#!/bin/sh
set -e
# The repo's config and persona win on every start; sessions on the volume stay.
mkdir -p "$HERMES_HOME"
cp /opt/rk/config.yaml "$HERMES_HOME/config.yaml"
cat /opt/rk/SOUL.md /opt/rk/house-rules.txt > "$HERMES_HOME/SOUL.md"
# Cheaper guest model (e.g. claude-haiku-5-5) only when the owner sets GUEST_MODEL; default stays in config.yaml.
case "$GUEST_MODEL" in
  "") ;;
  *[!a-z0-9.-]*) echo "GUEST_MODEL ignored: unexpected characters" >&2 ;;
  *) sed -i "s/^  default: .*/  default: $GUEST_MODEL/" "$HERMES_HOME/config.yaml" ;;
esac
# The advisor guidance only when the advisor tool is on, so the prompt never names a missing tool.
[ -n "$ADVISOR_MODEL" ] && cat /opt/rk/advisor.txt >> "$HERMES_HOME/SOUL.md"
exec hermes gateway run
