#!/bin/sh
set -e
# The repo's config, persona and scripts win on every start; sessions and state on the volume stay.
mkdir -p "$HERMES_HOME/scripts" /data/ryan /data/repo /data/gh
cp /opt/ryan/config.yaml "$HERMES_HOME/config.yaml"
cp /opt/ryan/SOUL.md "$HERMES_HOME/SOUL.md"
cp /opt/ryan/scripts/*.py "$HERMES_HOME/scripts/"

# GitHub: Hermes strips GH_TOKEN from the agent's terminal, so gh stores the login in
# /data/gh (GH_CONFIG_DIR, which does reach the terminal) and git uses gh as its helper.
if [ -n "$GH_TOKEN" ]; then
  printf %s "$GH_TOKEN" | env -u GH_TOKEN gh auth login --hostname github.com --with-token
  [ -d /data/repo/.git ] || git clone "https://github.com/${RYAN_REPO:-sourjamkj/RajKuthir-Homestays}.git" /data/repo
  git -C /data/repo config credential.helper '!gh auth git-credential'
  git -C /data/repo config user.name "Agent Ryan (Raj Kuthir)"
  git -C /data/repo config user.email "ryan@rajkuthirhomestays.casa"
else
  echo "GH_TOKEN not set: Ryan watches and reports, but cannot open PRs." >&2
fi

# The watchdog job is recreated on every boot, so the repo's definition beats any edit on the volume.
for id in $(hermes cron list 2>/dev/null | awk '/^  [0-9a-f]+ \[/ {id=$1} /Name: +rk-watchdog$/ {print id}'); do
  hermes cron remove "$id" >/dev/null
done
hermes cron create "every 5m" "The watchdog found new problems (above). Follow your Incident procedure." \
  --name rk-watchdog --script watchdog.py --deliver telegram --workdir /data/repo

exec hermes gateway run
