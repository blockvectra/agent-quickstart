# /// script
# requires-python = ">=3.11"
# dependencies = ["mcp==2.3.0"]
# ///
"""Read BlockVectra documentation with the official Python MCP SDK."""

import argparse
import asyncio
import json
import os
import unicodedata
from urllib.parse import urlsplit

import httpx2
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

ENDPOINT = "https://docs.blockvectra.com/mcp/docs"


def tool_text(result, tool: str) -> str:
    payload = result.model_dump(mode="json", by_alias=True)
    if payload.get("isError", False):
        raise RuntimeError(f"{tool} returned a tool error.")
    texts = [item["text"] for item in payload.get("content", []) if item.get("type") == "text"]
    if not texts or not any(text.strip() for text in texts):
        raise RuntimeError(f"{tool} returned no documentation text.")
    return "\n".join(texts)


def first_path(text: str) -> str:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError("search_docs returned invalid JSON.") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
        raise RuntimeError("search_docs returned invalid results.")
    results = payload["results"]
    if not results:
        raise RuntimeError("search_docs returned no matching documents.")
    path = results[0].get("path") if isinstance(results[0], dict) else None
    if (
        not isinstance(path, str)
        or not path
        or path.startswith("/")
        or "\\" in path
        or "?" in path
        or "#" in path
        or ".." in path.split("/")
        or any(char.isspace() or unicodedata.category(char) == "Cc" for char in path)
    ):
        raise RuntimeError("search_docs returned an invalid document path.")
    parsed = urlsplit(path)
    if parsed.scheme or parsed.netloc:
        raise RuntimeError("search_docs returned an invalid document path.")
    return path


async def read_document(http_client: httpx2.AsyncClient, query: str | None, lang: str) -> dict:
    async with streamable_http_client(ENDPOINT, http_client=http_client) as (read, write):
        async with ClientSession(read, write, read_timeout_seconds=15) as session:
            await session.initialize()
            available = await session.list_tools()
            names = sorted(tool.name for tool in available.tools)
            if names != ["read_doc", "search_docs"]:
                raise RuntimeError("The endpoint did not expose the two documentation tools.")
            path = "quickstart"
            if query is not None:
                search = await session.call_tool(
                    "search_docs", {"query": query, "lang": lang, "limit": 1}
                )
                path = first_path(tool_text(search, "search_docs"))
            result = await session.call_tool("read_doc", {"path": path, "lang": lang})
            output = {"tools": names, "path": path, "lang": lang, "text": tool_text(result, "read_doc")}
            if query is not None:
                output["query"] = query
            return output


def nonempty(value: str) -> str:
    value = value.strip()
    if not value:
        raise argparse.ArgumentTypeError("must not be empty or whitespace")
    return value


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--query", type=nonempty, metavar="TOPIC", help="search and read the first match")
    parser.add_argument("--lang", type=nonempty, default="en", metavar="LANG", help="document language (default: en)")
    args = parser.parse_args()
    user_agent = "BlockVectraDocsPython/1"
    if os.environ.get("BLOCKVECTRA_INTERNAL_QA") == "1":
        user_agent += " BlockVectraQA/1"
    async with httpx2.AsyncClient(
        timeout=15, follow_redirects=False, headers={"User-Agent": user_agent}
    ) as http_client:
        result = await read_document(http_client, args.query, args.lang)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(asyncio.wait_for(main(), timeout=40))
