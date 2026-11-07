# /// script
# requires-python = ">=3.11"
# dependencies = ["google-adk[mcp]==2.14.0", "mcp==2.3.0"]
# ///
"""Search and read BlockVectra docs through Google ADK, without a model or key."""

import asyncio
import json
import os

import httpx2
from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.sessions import InMemorySessionService, Session
from google.adk.tools import ToolContext
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams

ENDPOINT = "https://docs.blockvectra.com/mcp/docs"
USER_AGENT = "BlockVectraADKDocs/1"
if os.environ.get("BLOCKVECTRA_INTERNAL_QA") == "1":
    USER_AGENT += " BlockVectraQA/1"


def http_client_factory(**kwargs):
    kwargs.update(timeout=httpx2.Timeout(15), follow_redirects=False, trust_env=False)
    return httpx2.AsyncClient(**kwargs)


def tool_text(result: dict, name: str) -> str:
    if not isinstance(result, dict) or result.get("isError") or "error" in result:
        raise RuntimeError(f"{name} did not succeed; stopping")
    texts = [item["text"] for item in result.get("content", []) if item.get("type") == "text"]
    if not texts or not any(text.strip() for text in texts):
        raise RuntimeError(f"{name} returned no documentation text; stopping")
    return "\n".join(texts)


async def read_docs(factory=http_client_factory) -> dict:
    toolset = McpToolset(
        connection_params=StreamableHTTPConnectionParams(
            url=ENDPOINT,
            headers={"User-Agent": USER_AGENT},
            timeout=15,
            sse_read_timeout=15,
            httpx_client_factory=factory,
        ),
    )
    context = ToolContext(
        InvocationContext(
            invocation_id="docs-first-read",
            agent=BaseAgent(name="docs_reader"),
            session=Session(id="docs-first-read", app_name="docs-reader", user_id="local"),
            session_service=InMemorySessionService(),
        )
    )
    try:
        tools = {tool.name: tool for tool in await toolset.get_tools()}
        if sorted(tools) != ["read_doc", "search_docs"]:
            raise RuntimeError("The endpoint did not expose exactly the two documentation tools")
        search = await tools["search_docs"].run_async(
            args={"query": "quickstart", "lang": "en", "limit": 1}, tool_context=context,
        )
        hits = json.loads(tool_text(search, "search_docs")).get("results", [])
        if not any(isinstance(hit, dict) and hit.get("path") == "quickstart" for hit in hits):
            raise RuntimeError("Search did not return quickstart; stopping")
        document = await tools["read_doc"].run_async(
            args={"path": "quickstart", "lang": "en"}, tool_context=context,
        )
        return {"tools": sorted(tools), "path": "quickstart", "lang": "en",
                "text": tool_text(document, "read_doc")}
    finally:
        await toolset.close()


async def main() -> None:
    async with asyncio.timeout(60):
        print(json.dumps(await read_docs(), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
