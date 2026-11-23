FROM python:3.12-slim

# Pinned: upgrade deliberately, then re-check the locked toolsets (README.md).
RUN pip install --no-cache-dir hermes-agent==0.19.0

ENV HERMES_HOME=/data/hermes
COPY config.yaml SOUL.md house-rules.txt start.sh /opt/rk/

CMD ["sh", "/opt/rk/start.sh"]
