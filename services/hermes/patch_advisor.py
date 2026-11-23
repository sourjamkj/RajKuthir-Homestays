"""Build-time patch (shared by services/ryan and services/hermes; keep both copies identical):
the main model can consult a stronger one through
Anthropic's advisor tool (beta advisor-tool-2026-03-01) before substantive
work. Only the main agent loop and its subagents get it (AnthropicTransport);
Hermes's side calls (titles, approval checks) don't. ADVISOR_MODEL empty
= off. Fails the build if the code it patches has moved."""
import importlib.util
import pathlib

path = pathlib.Path(importlib.util.find_spec("agent.transports.anthropic").origin)
src = path.read_text()
call = "        return build_anthropic_kwargs(\n"
end = '            drop_context_1m_beta=params.get("drop_context_1m_beta", False),\n        )\n'
assert src.count(call) == 1 and src.count(end) == 1, "hermes-agent changed: re-check AnthropicTransport.build_kwargs"
src = src.replace(call, "        kwargs = build_anthropic_kwargs(\n")
src = src.replace(end, end + '        return _with_advisor(kwargs, params.get("base_url"), params.get("is_oauth", False), params.get("drop_context_1m_beta", False))\n')
src += '''

def _with_advisor(kwargs, base_url, is_oauth, drop_context_1m_beta):
    """Adds the advisor tool + its beta header to a native-Anthropic request that has tools."""
    import os
    from agent.anthropic_adapter import _OAUTH_ONLY_BETAS, _common_betas_for_base_url, _is_third_party_anthropic_endpoint

    model = os.environ.get("ADVISOR_MODEL", "").strip()
    if not model or not kwargs.get("tools") or _is_third_party_anthropic_endpoint(base_url):
        return kwargs
    kwargs["tools"] = [*kwargs["tools"], {"type": "advisor_20260301", "name": "advisor", "model": model}]
    # Per-request extra_headers replace the client's anthropic-beta header, so carry the common betas.
    current = (kwargs.get("extra_headers") or {}).get("anthropic-beta")
    betas = current.split(",") if current else [
        *_common_betas_for_base_url(base_url, drop_context_1m_beta=drop_context_1m_beta),
        *(_OAUTH_ONLY_BETAS if is_oauth else []),
    ]
    if "advisor-tool-2026-03-01" not in betas:
        betas.append("advisor-tool-2026-03-01")
    kwargs.setdefault("extra_headers", {})["anthropic-beta"] = ",".join(betas)
    return kwargs
'''
path.write_text(src)
print("patched", path)
