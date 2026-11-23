"""Build-time patch: guests see a polite hand-off, never Hermes's technical
provider-error text ("check gateway logs"). Fails the build if the function it
patches has moved, so an upgrade can't silently drop the patch."""
import importlib.util
import pathlib

path = pathlib.Path(importlib.util.find_spec("gateway.run").origin)
src = path.read_text()
marker = '    """Map raw provider/API errors to a short user-safe Telegram reply."""\n'
assert src.count(marker) == 1, "hermes-agent changed: re-check _gateway_provider_error_reply"
reply = (
    "Sorry, I couldn't reply just now. Our host Sourja will get back to you shortly, "
    "or you can call him on +91 62903 99165."
)
src = src.replace(marker, marker + f"    return {reply!r}\n")
# The interim status note for a provider error is dropped, so a failed turn sends the
# hand-off once (from the final reply), not twice.
status = "        return _gateway_provider_error_reply(text)\n    return text\n"
assert src.count(status) == 1, "hermes-agent changed: re-check _prepare_gateway_status_message"
path.write_text(src.replace(status, "        return None\n    return text\n"))
print("patched", path)

# A reply redelivered after a restart goes out as-is: no "♻️ Recovered reply — the
# gateway restarted…" prefix, which means nothing to a guest.
ledger = pathlib.Path(importlib.util.find_spec("gateway.delivery_ledger").origin)
src = ledger.read_text()
start = src.index("RECOVERED_MARKER = (")
end = src.index(")\n", start) + 2
assert '"♻️ Recovered reply' in src[start:end], "hermes-agent changed: re-check RECOVERED_MARKER"
ledger.write_text(src[:start] + 'RECOVERED_MARKER = ""\n' + src[end:])
print("patched", ledger)

# Slash commands are owner-only: guests get no command at all (Hermes otherwise
# always leaves /help and /whoami open), and a blocked command gets a plain reply.
access = pathlib.Path(importlib.util.find_spec("gateway.slash_access").origin)
src = access.read_text()
floor = '_ALWAYS_ALLOWED_FOR_USERS: FrozenSet[str] = frozenset({\n    "help",\n    "whoami",\n})\n'
assert src.count(floor) == 1, "hermes-agent changed: re-check _ALWAYS_ALLOWED_FOR_USERS"
access.write_text(src.replace(floor, "_ALWAYS_ALLOWED_FOR_USERS: FrozenSet[str] = frozenset()\n"))
print("patched", access)

src = path.read_text()
denied = '        return f"⛔ /{canonical_cmd} is admin-only here. {suffix}"\n'
assert src.count(denied) == 1, "hermes-agent changed: re-check the slash-command denial reply"
guest = "Sorry, I can only help with questions about staying at Raj Kuthir Homestays – Sobuj Potro. Just type your question."
path.write_text(src.replace(denied, f"        return {guest!r}\n"))
print("patched denial", path)

# Never send guests "◐ Session automatically reset… Use /resume…" (Hermes sends it
# after a restart even when session_reset.notify is false).
src = path.read_text()
reset = 'should_notify = reset_reason in {"suspended", "resume_pending_expired"} or ('
assert src.count(reset) == 1, "hermes-agent changed: re-check the session-reset notice"
path.write_text(src.replace(reset, "should_notify = False and ("))
print("patched reset notice", path)

# Last line of defence, at the one place every WhatsApp text leaves Hermes: any
# error or system notice (provider failure, ⚠️/⛔/♻️/⏳ notices, tracebacks, config
# hints) is replaced by the polite hand-off above, at most once per chat per 2
# minutes, and the original is logged as one "RK_GUEST_ERROR {json}" line for the
# bug-fix agent (Railway logs, hermes service).
wa = pathlib.Path(importlib.util.find_spec("gateway.platforms.whatsapp_cloud").origin)
src = wa.read_text()
anchor = "        formatted = self.format_message(content)\n"
assert src.count(anchor) == 1, "hermes-agent changed: re-check WhatsAppCloudAdapter.send"
src = src.replace(anchor, (
    "        content = _rk_guest_safe(chat_id, content)\n"
    "        if not content:\n"
    "            return SendResult(success=True, message_id=None)\n" + anchor))
src += f'''

_RK_HANDOFF = {reply!r}
_RK_NOTICE_START = ("⚠", "⛔", "♻", "◐", "⏳", "⚡", "⏩", "📬", "❌", "✕", "🚫", "🔒", "🔄")
_RK_ERROR_TEXT = re.compile(
    r"check gateway logs|traceback \\(most recent|\\bexception\\b|error code:|\\bHTTP [45]\\d\\d\\b"
    r"|api[ _-]?key|config\\.yaml|allow_admin_from|/resume|/sethome|provider (failed|error|authentication)"
    r"|rate limit|context (length|window)|non-retryable|request_id|invalid_request_error",
    re.IGNORECASE,
)
_rk_last_handoff: dict = {{}}


def _rk_guest_safe(chat_id, content):
    """Return the text to send: unchanged, the polite hand-off, or "" (already sent)."""
    import json, time
    text = str(content).strip()
    if text != _RK_HANDOFF and not text.startswith(_RK_NOTICE_START) and not _RK_ERROR_TEXT.search(text):
        return content
    if text != _RK_HANDOFF:
        logger.error("RK_GUEST_ERROR %s", json.dumps({{"chat": str(chat_id), "text": text[:2000]}}, ensure_ascii=False))
    now = time.time()
    if now - _rk_last_handoff.get(chat_id, 0) < 120:
        return ""
    _rk_last_handoff[chat_id] = now
    return _RK_HANDOFF
'''
wa.write_text(src)
print("patched", wa)
