# /// script
# requires-python = ">=3.11"
# dependencies = ["pydantic-ai-slim[mcp]==2.66.0", "fastmcp==4.1.6", "mcp==2.3.0"]
# ///
"""Search and read BlockVectra docs through Pydantic AI, without a model or key."""

import asyncio
import json
import os

import httpx2
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport
from pydantic_ai.mcp import MCPToolset

ENDPOINT = "https://docs.blockvectra.com/mcp/docs"
USER_AGENT = "BlockVectraPydanticDocs/1"
if os.environ.get("BLOCKVECTRA_INTERNAL_QA") == "1":
    USER_AGENT += " BlockVectraQA/1"


def http_client_factory(**kwargs):
    kwargs.update(timeout=httpx2.Timeout(15), follow_redirects=False, trust_env=False)
    return httpx2.AsyncClient(**kwargs)


async def read_docs(toolset: MCPToolset) -> dict:
    async with toolset:
        names = sorted(tool.name for tool in await toolset.list_tools())
        if names != ["read_doc", "search_docs"]:
            raise RuntimeError("The endpoint did not expose exactly the two documentation tools")
        search = await toolset.direct_call_tool(
            "search_docs", {"query": "quickstart", "lang": "en", "limit": 1},
        )
        hits = search.get("results", []) if isinstance(search, dict) else []
        if not isinstance(hits, list) or not any(
            isinstance(hit, dict) and hit.get("path") == "quickstart" for hit in hits
        ):
            raise RuntimeError("Search did not return quickstart; stopping")
        document = await toolset.direct_call_tool("read_doc", {"path": "quickstart", "lang": "en"})
        if not isinstance(document, str) or not document.strip():
            raise RuntimeError("read_doc returned no documentation text; stopping")
        return {"tools": names, "path": "quickstart", "lang": "en", "text": document}


async def main() -> None:
    transport = StreamableHttpTransport(
        ENDPOINT, auth=None, headers={"User-Agent": USER_AGENT},
        httpx_client_factory=http_client_factory,
    )
    client = Client(transport, timeout=15, init_timeout=15)
    toolset = MCPToolset(client, tool_error_behavior="error", max_retries=0)
    async with asyncio.timeout(60):
        print(json.dumps(await read_docs(toolset), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
