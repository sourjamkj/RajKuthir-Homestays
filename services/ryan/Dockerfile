FROM python:3.12-slim

# git + gh to open PRs; Node 22 + pnpm to run the repo's typecheck and tests.
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates gnupg \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends gh nodejs \
 && corepack enable \
 && rm -rf /var/lib/apt/lists/*

# Pinned: upgrade deliberately, then re-check toolsets and approvals (README.md).
RUN pip install --no-cache-dir "hermes-agent[anthropic,messaging]==0.19.0"

ENV HERMES_HOME=/data/hermes \
    GH_CONFIG_DIR=/data/gh \
    TZ=Asia/Kolkata
COPY config.yaml SOUL.md start.sh /opt/ryan/
COPY scripts/ /opt/ryan/scripts/

CMD ["sh", "/opt/ryan/start.sh"]
