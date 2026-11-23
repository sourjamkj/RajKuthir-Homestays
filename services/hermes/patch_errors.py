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
path.write_text(src.replace(marker, marker + f"    return {reply!r}\n"))
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
