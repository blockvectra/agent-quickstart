"""Exercise the real Pydantic AI toolset against an in-process MCP server, offline."""

import unittest

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic_ai.mcp import MCPToolset

from pydantic_docs import read_docs


class DocumentationReadTests(unittest.IsolatedAsyncioTestCase):
    async def run_server(self, *, extra=False, search_error=False, empty=False):
        server = FastMCP("docs-fixture")
        reads = []

        @server.tool
        def search_docs(query: str, lang: str, limit: int) -> dict:
            if search_error:
                raise ValueError("search is unavailable")
            return {"results": [{"path": "quickstart"}]}

        @server.tool
        def read_doc(path: str, lang: str) -> str:
            reads.append((path, lang))
            return "" if empty else "# Quickstart\nFixture documentation."

        if extra:
            @server.tool
            def create_account() -> str:
                raise AssertionError("Must not call an account tool")

        toolset = MCPToolset(server, tool_error_behavior="error", max_retries=0)
        return toolset, reads

    async def test_reads_document_through_actual_toolset(self):
        toolset, reads = await self.run_server()
        result = await read_docs(toolset)
        self.assertEqual(result["text"], "# Quickstart\nFixture documentation.")
        self.assertEqual(reads, [("quickstart", "en")])
        self.assertFalse(toolset.client.is_connected())

    async def test_extra_tool_stops_before_read(self):
        toolset, reads = await self.run_server(extra=True)
        with self.assertRaisesRegex(RuntimeError, "exactly the two documentation tools"):
            await read_docs(toolset)
        self.assertEqual(reads, [])
        self.assertFalse(toolset.client.is_connected())

    async def test_search_error_stops_before_read(self):
        toolset, reads = await self.run_server(search_error=True)
        with self.assertRaises(ToolError):
            await read_docs(toolset)
        self.assertEqual(reads, [])
        self.assertFalse(toolset.client.is_connected())

    async def test_empty_document_is_not_success(self):
        toolset, reads = await self.run_server(empty=True)
        with self.assertRaisesRegex(RuntimeError, "no documentation text"):
            await read_docs(toolset)
        self.assertEqual(reads, [("quickstart", "en")])
        self.assertFalse(toolset.client.is_connected())


if __name__ == "__main__":
    unittest.main()
