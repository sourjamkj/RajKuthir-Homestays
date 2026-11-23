FROM python:3.12-slim

# Pinned: upgrade deliberately, then re-check the locked toolsets (README.md).
RUN pip install --no-cache-dir "hermes-agent[anthropic,messaging,mcp]==0.19.0"
COPY patch_errors.py /opt/rk/patch_errors.py
RUN python /opt/rk/patch_errors.py
# Advisor tool for the guest agent; stays off until ADVISOR_MODEL is set (README.md).
COPY patch_advisor.py /opt/rk/patch_advisor.py
RUN python /opt/rk/patch_advisor.py

ENV HERMES_HOME=/data/hermes
# Owner's chat as home channel, so guests never see the "No home channel" setup prompt.
ENV WHATSAPP_CLOUD_HOME_CHANNEL=916290399165
# No "⚡ Interrupting current task" reply when a guest sends two messages quickly.
ENV HERMES_GATEWAY_BUSY_ACK_ENABLED=false
COPY config.yaml SOUL.md house-rules.txt advisor.txt start.sh /opt/rk/

CMD ["sh", "/opt/rk/start.sh"]
