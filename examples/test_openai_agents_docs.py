"""Exercise the OpenAI Agents SDK example against a mocked MCP server, offline."""

import unittest
from types import SimpleNamespace
from unittest import mock

import openai_agents_docs as example
from openai_agents_docs import read_docs


def result(text, is_error=False):
    payload = {"content": [{"type": "text", "text": text}]}
    if is_error:
        payload["isError"] = True
    return SimpleNamespace(model_dump=lambda mode, by_alias: payload)


class FakeServer:
    def __init__(self, tools=("search_docs", "read_doc"), search='{"results": [{"path": "quickstart"}]}',
                 doc="# Quickstart\nFixture.", search_error=False):
        self.tools = [SimpleNamespace(name=n) for n in tools]
        self.search, self.doc, self.search_error = search, doc, search_error
        self.calls, self.entered, self.exited = [], 0, 0

    async def __aenter__(self):
        self.entered += 1
        return self

    async def __aexit__(self, *exc):
        self.exited += 1

    async def list_tools(self):
        return self.tools

    async def call_tool(self, name, arguments):
        self.calls.append((name, arguments))
        if name == "search_docs":
            return result(self.search, self.search_error)
        return result(self.doc)


class ReadDocsTests(unittest.IsolatedAsyncioTestCase):
    async def test_search_then_read_same_path_returns_raw_markdown(self):
        server = FakeServer()
        out = await read_docs(server)
        self.assertEqual(server.calls, [
            ("search_docs", {"query": "quickstart", "lang": "en", "limit": 1}),
            ("read_doc", {"path": "quickstart", "lang": "en"}),
        ])
        self.assertEqual(out, {"tools": ["read_doc", "search_docs"], "path": "quickstart",
                               "lang": "en", "text": "# Quickstart\nFixture."})
        self.assertEqual((server.entered, server.exited), (1, 1))

    async def test_read_uses_path_from_search(self):
        server = FakeServer(search='{"results": [{"path": "rpc/bsc"}]}')
        out = await read_docs(server)
        self.assertEqual(server.calls[1], ("read_doc", {"path": "rpc/bsc", "lang": "en"}))
        self.assertEqual(out["path"], "rpc/bsc")

    async def test_unexpected_tool_list_stops_before_calls(self):
        for tools in (("search_docs",), ("search_docs", "read_doc", "create_account")):
            server = FakeServer(tools=tools)
            with self.assertRaisesRegex(RuntimeError, "exactly the two"):
                await read_docs(server)
            self.assertEqual(server.calls, [])
            self.assertEqual(server.exited, 1)

    async def test_empty_search_stops_before_read(self):
        server = FakeServer(search='{"results": []}')
        with self.assertRaisesRegex(RuntimeError, "no matching"):
            await read_docs(server)
        self.assertEqual([c[0] for c in server.calls], ["search_docs"])
        self.assertEqual(server.exited, 1)

    async def test_tool_error_stops_before_read(self):
        server = FakeServer(search_error=True)
        with self.assertRaisesRegex(RuntimeError, "tool error"):
            await read_docs(server)
        self.assertEqual([c[0] for c in server.calls], ["search_docs"])
        self.assertEqual(server.exited, 1)

    async def test_empty_document_is_not_success(self):
        server = FakeServer(doc="  ")
        with self.assertRaisesRegex(RuntimeError, "no documentation text"):
            await read_docs(server)
        self.assertEqual(server.exited, 1)


class ServerConfigTests(unittest.TestCase):
    def test_server_arguments(self):
        with mock.patch.object(example, "MCPServerStreamableHttp") as cls:
            example.make_server()
        kwargs = cls.call_args.kwargs
        params = kwargs["params"]
        self.assertEqual(params["url"], "https://docs.blockvectra.com/mcp/docs")
        self.assertEqual(params["timeout"], 15)
        self.assertNotIn("Authorization", params["headers"])
        self.assertTrue(params["headers"]["User-Agent"].startswith("BlockVectraOpenAIAgents/1"))
        self.assertIs(params["httpx_client_factory"], example.http_client_factory)
        self.assertEqual(kwargs["client_session_timeout_seconds"], 15)
        self.assertEqual(kwargs["max_retry_attempts"], 0)
        self.assertEqual(kwargs["max_list_pages"], 1)

    def test_client_factory_does_not_follow_redirects(self):
        client = example.http_client_factory(headers={"User-Agent": "x"}, timeout=15, auth=None)
        self.assertFalse(client.follow_redirects)
        self.assertEqual(client.headers["User-Agent"], "x")


if __name__ == "__main__":
    unittest.main()
