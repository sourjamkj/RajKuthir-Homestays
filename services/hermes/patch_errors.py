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
