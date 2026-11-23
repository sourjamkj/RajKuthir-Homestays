"""Build-time patch: Agent Ryan may merge a PR only with the owner's tap.
`gh pr merge` becomes a dangerous command whose smart check always escalates
to the human: on Telegram the owner gets Approve/Deny buttons; scheduled runs
are refused outright (approvals.cron_mode: deny runs before the smart check).
Fails the build if the code it patches has moved."""
import importlib.util
import pathlib

path = pathlib.Path(importlib.util.find_spec("tools.approval").origin)
src = path.read_text()
head = "DANGEROUS_PATTERNS = [\n"
assert src.count(head) == 1, "hermes-agent changed: re-check DANGEROUS_PATTERNS"
src = src.replace(head, head + "    (r'\\bgh\\s+pr\\s+merge\\b', \"merge a pull request (deploys the live site)\"),\n")
smart = "def _smart_approve(command: str, description: str) -> str:\n"
assert src.count(smart) == 1, "hermes-agent changed: re-check _smart_approve"
src = src.replace(smart, smart + "    if re.search(r'\\bgh\\s+pr\\s+merge\\b', command, re.IGNORECASE):\n        return \"escalate\"  # a merge deploys: only the owner decides\n", 1)
path.write_text(src)
print("patched", path)
