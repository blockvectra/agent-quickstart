# /// script
# requires-python = ">=3.12"
# dependencies = ["openai-agents==0.24.0", "mcp==2.3.0"]
# ///
"""Search and read BlockVectra docs through the OpenAI Agents SDK MCP client, without a model or key."""

import asyncio
import json
import os

import httpx2
from agents import set_tracing_disabled
from agents.mcp import MCPServerStreamableHttp

from mcp_docs import first_path, tool_text

ENDPOINT = "https://docs.blockvectra.com/mcp/docs"
USER_AGENT = "BlockVectraOpenAIAgents/1"
if os.environ.get("BLOCKVECTRA_INTERNAL_QA") == "1":
    USER_AGENT += " BlockVectraQA/1"


def http_client_factory(headers=None, timeout=None, auth=None):
    return httpx2.AsyncClient(
        headers=headers, timeout=timeout, auth=auth, follow_redirects=False
    )


def make_server() -> MCPServerStreamableHttp:
    return MCPServerStreamableHttp(
        params={
            "url": ENDPOINT,
            "headers": {"User-Agent": USER_AGENT},
            "timeout": 15,
            "sse_read_timeout": 15,
            "httpx_client_factory": http_client_factory,
        },
        client_session_timeout_seconds=15,
        max_retry_attempts=0,
        max_list_pages=1,
    )


async def read_docs(server) -> dict:
    async with server:
        names = sorted(tool.name for tool in await server.list_tools())
        if names != ["read_doc", "search_docs"]:
            raise RuntimeError("The endpoint did not expose exactly the two documentation tools")
        search = await server.call_tool("search_docs", {"query": "quickstart", "lang": "en", "limit": 1})
        path = first_path(tool_text(search, "search_docs"))
        document = await server.call_tool("read_doc", {"path": path, "lang": "en"})
        return {"tools": names, "path": path, "lang": "en", "text": tool_text(document, "read_doc")}


async def main() -> None:
    set_tracing_disabled(True)
    async with asyncio.timeout(60):
        print(json.dumps(await read_docs(make_server()), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
