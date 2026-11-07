# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "langchain[mcp]==1.4.9",
#   "fastmcp==4.1.6",
#   "mcp==2.3.0",
# ]
# ///
"""Read remote docs through langchain.mcp, without an LLM or API key.
Python 3.11+; pip install 'langchain[mcp]==1.4.9' 'fastmcp==4.1.6' 'mcp==2.3.0'
langchain.mcp is currently beta; keep that warning visible.
"""
import asyncio
import json
import os

import httpx2
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport
from langchain.mcp import MCPAdapter
from langchain_core.messages import ToolMessage

ENDPOINT = "https://docs.blockvectra.com/mcp/docs"
USER_AGENT = "langchain-docs-example/1"
if os.environ.get("BLOCKVECTRA_INTERNAL_QA") == "1":
    USER_AGENT += " BlockVectraQA/1"


def http_client_factory(**kwargs):
    kwargs.update(timeout=httpx2.Timeout(15), follow_redirects=False, trust_env=False)
    return httpx2.AsyncClient(**kwargs)


async def invoke(tool, arguments, call_id):
    message = await tool.ainvoke({
        "type": "tool_call", "name": tool.name, "args": arguments, "id": call_id,
    })
    if not isinstance(message, ToolMessage) or message.status != "success":
        raise RuntimeError(f"{tool.name} did not succeed; stopping")
    return message


async def read_docs(factory=http_client_factory):
    transport = StreamableHttpTransport(
        ENDPOINT, auth=None, headers={"User-Agent": USER_AGENT},
        httpx_client_factory=factory,
    )
    client = Client(transport, timeout=15, init_timeout=15)
    async with MCPAdapter(client) as adapter:
        tools = {tool.name: tool for tool in await adapter.list_tools()}
        if sorted(tools) != ["read_doc", "search_docs"]:
            raise RuntimeError(f"Unexpected tool scope: {sorted(tools)}")
        search = await invoke(
            tools["search_docs"], {"query": "quickstart", "lang": "en", "limit": 1},
            "docs-search",
        )
        results = (search.artifact or {}).get("structured_content", {}).get("results", [])
        if not any(hit.get("path") == "quickstart" for hit in results):
            raise RuntimeError("Search did not return quickstart; stopping")
        document = await invoke(
            tools["read_doc"], {"path": "quickstart", "lang": "en"}, "docs-read",
        )
        if not document.content:
            raise RuntimeError("Empty document; stopping")
        return {
            "protocol_version": adapter.client.protocol_version,
            "tools": sorted(tools),
            "search": search.model_dump(mode="json"),
            "document": document.model_dump(mode="json"),
        }


async def main():
    async with asyncio.timeout(60):
        print(json.dumps(await read_docs(), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
