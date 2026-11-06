# /// script
# requires-python = ">=3.11"
# dependencies = ["mcp==2.3.0"]
# ///
"""Read BlockVectra documentation with the official Python MCP SDK."""

import asyncio
import json
import os

import httpx2
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

ENDPOINT = "https://docs.blockvectra.com/mcp/docs"


async def read_quickstart(http_client: httpx2.AsyncClient) -> dict:
    async with streamable_http_client(ENDPOINT, http_client=http_client) as (read, write):
        async with ClientSession(read, write, read_timeout_seconds=15) as session:
            await session.initialize()
            available = await session.list_tools()
            names = sorted(tool.name for tool in available.tools)
            if names != ["read_doc", "search_docs"]:
                raise RuntimeError("The endpoint did not expose the two documentation tools.")
            result = await session.call_tool("read_doc", {"path": "quickstart", "lang": "en"})
            payload = result.model_dump(mode="json", by_alias=True)
            if payload.get("isError", False):
                raise RuntimeError("read_doc returned a tool error.")
            texts = [item["text"] for item in payload.get("content", []) if item.get("type") == "text"]
            if not texts or not any(text.strip() for text in texts):
                raise RuntimeError("read_doc returned no documentation text.")
            return {"tools": names, "path": "quickstart", "lang": "en", "text": "\n".join(texts)}


async def main() -> None:
    user_agent = "BlockVectraDocsPython/1"
    if os.environ.get("BLOCKVECTRA_INTERNAL_QA") == "1":
        user_agent += " BlockVectraQA/1"
    async with httpx2.AsyncClient(
        timeout=15, follow_redirects=False, headers={"User-Agent": user_agent}
    ) as http_client:
        result = await read_quickstart(http_client)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(asyncio.wait_for(main(), timeout=40))
