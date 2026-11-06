"""Offline behavior tests for the Python documentation example."""

import asyncio
from contextlib import ExitStack, redirect_stdout, redirect_stderr
import io
import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

# Block network access before importing the SDK or the example.
_network_guard = ExitStack()
for target in ("socket.create_connection", "socket.socket.connect", "socket.socket.connect_ex", "socket.getaddrinfo"):
    _network_guard.enter_context(patch(target, side_effect=AssertionError("Network disabled in tests")))

import mcp_docs
from mcp.types import CallToolResult, TextContent


def tearDownModule():
    _network_guard.close()


def result(text=None, error=False):
    return CallToolResult(
        content=[] if text is None else [TextContent(type="text", text=text)], isError=error
    )


class McpDocsTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.http = self.stack.enter_context(patch.object(mcp_docs.httpx2, "AsyncClient"))
        self.transport = self.stack.enter_context(patch.object(mcp_docs, "streamable_http_client"))
        self.transport.return_value.__aenter__ = AsyncMock(return_value=(object(), object()))
        self.transport.return_value.__aexit__ = AsyncMock(return_value=False)
        self.session_factory = self.stack.enter_context(patch.object(mcp_docs, "ClientSession"))
        self.session = MagicMock()
        self.session.initialize = AsyncMock()
        self.session.list_tools = AsyncMock(return_value=MagicMock(tools=[
            MagicMock(name="read"), MagicMock(name="search")
        ]))
        self.session.list_tools.return_value.tools[0].name = "read_doc"
        self.session.list_tools.return_value.tools[1].name = "search_docs"
        self.session.call_tool = AsyncMock(return_value=result("# Quickstart\n[source](https://docs.blockvectra.com)"))
        self.session_factory.return_value.__aenter__ = AsyncMock(return_value=self.session)
        self.session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    def run_cli(self, *args):
        output = io.StringIO()
        with patch("sys.argv", ["mcp_docs.py", *args]), redirect_stdout(output):
            asyncio.run(mcp_docs.main())
        return json.loads(output.getvalue())

    def test_default_reads_quickstart_without_search(self):
        output = self.run_cli()
        self.session.call_tool.assert_awaited_once_with("read_doc", {"path": "quickstart", "lang": "en"})
        self.assertEqual(output, {
            "tools": ["read_doc", "search_docs"], "path": "quickstart", "lang": "en",
            "text": "# Quickstart\n[source](https://docs.blockvectra.com)"
        })

    def test_language_without_query_is_forwarded(self):
        output = self.run_cli("--lang", "fr")
        self.session.call_tool.assert_awaited_once_with("read_doc", {"path": "quickstart", "lang": "fr"})
        self.assertEqual(output["lang"], "fr")
        self.assertNotIn("query", output)

    def test_query_reads_only_first_match_in_same_language(self):
        for path in ("guides/robinhood-chain", "reference/v1.2_slug+name", "指南/入门"):
            with self.subTest(path=path):
                self.session.call_tool.reset_mock()
                self.session.call_tool.side_effect = [
                    result(json.dumps({"results": [{"title": "First", "path": path, "summary": "RPC"}, {"path": "other"}]})),
                    result("# Document\n[source](https://docs.blockvectra.com/zh/guide)")
                ]
                output = self.run_cli("--query", "  Robinhood 主网 RPC  ", "--lang", "zh")
                self.assertEqual(self.session.call_tool.await_args_list, [
                    unittest.mock.call("search_docs", {"query": "Robinhood 主网 RPC", "lang": "zh", "limit": 1}),
                    unittest.mock.call("read_doc", {"path": path, "lang": "zh"})
                ])
                self.assertEqual(output["path"], path)
                self.assertEqual(output["lang"], "zh")
                self.assertEqual(output["query"], "Robinhood 主网 RPC")
                self.assertEqual(output["text"], "# Document\n[source](https://docs.blockvectra.com/zh/guide)")

    def test_bad_search_results_never_read(self):
        texts = [None, "", " \n", "not JSON", "[]", "null", "1", '"text"', "{}",
                 '{"results": null}', '{"results": {}}', '{"results": []}',
                 '{"results": [null]}', '{"results": ["path"]}', '{"results": [{}]}']
        paths = [None, 1, [], {}, "", " ", "/guides/doc", "//example.com/doc",
                 "https://example.com/doc", "https:doc", "../doc", "guides/../doc",
                 "guides/..", "guides\\doc", "doc?query", "doc#fragment", "doc\x00",
                 "doc\x7f", "doc\n", "doc name", "doc\u00a0name"]
        bad_results = [result(text) for text in texts]
        bad_results += [result(json.dumps({"results": [{"path": path}, {"path": "valid"}]})) for path in paths]
        bad_results += [result('{"results": [{"path": "valid"}]}', error=True)]
        for index, response in enumerate(bad_results):
            with self.subTest(case=index):
                self.session.call_tool.reset_mock()
                self.session.call_tool.return_value = response
                with self.assertRaises(RuntimeError):
                    self.run_cli("--query", "topic")
                self.session.call_tool.assert_awaited_once_with("search_docs", {"query": "topic", "lang": "en", "limit": 1})

    def test_read_errors_and_empty_text_fail(self):
        for query_args in ((), ("--query", "topic")):
            for response in (result("error", error=True), result(), result(""), result(" \n")):
                with self.subTest(args=query_args, response=response):
                    self.session.call_tool.reset_mock()
                    self.session.call_tool.side_effect = (
                        [result('{"results": [{"path": "guide"}]}'), response] if query_args else [response]
                    )
                    with self.assertRaises(RuntimeError):
                        self.run_cli(*query_args)
                    self.assertEqual(self.session.call_tool.await_count, 2 if query_args else 1)

    def test_empty_cli_arguments_fail_before_network(self):
        for option in ("--query", "--lang"):
            for value in ("", " \t\n"):
                with self.subTest(option=option, value=value), redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit) as raised:
                        self.run_cli(option, value)
                    self.assertEqual(raised.exception.code, 2)
                    self.http.assert_not_called()
                    self.transport.assert_not_called()
                    self.session_factory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
