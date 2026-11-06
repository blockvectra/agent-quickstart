import contextlib
import io
import json
import unittest
from unittest.mock import patch

from examples import public_chain


def chain(chain_id=4663, slug="robinhood_mainnet", **overrides):
    entry = {
        "chain_id": chain_id,
        "chain": slug,
        "jsonrpc": True,
        "public": {
            "url": f"https://api.blockvectra.com/v1/{slug}/public",
            "methods": ["eth_chainId"],
        },
    }
    entry.update(overrides)
    return entry


class FakeResponse:
    def __init__(self, payload, status=200, read_error=None):
        self.data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.status = status
        self.read_error = read_error
        self.closed = False
        self.timeouts = []

    def read(self, size=-1):
        if self.read_error:
            raise self.read_error
        part, self.data = self.data[:size], self.data[size:]
        return part

    def settimeout(self, value):
        self.timeouts.append(value)

    def close(self):
        self.closed = True


class PublicChainTests(unittest.TestCase):
    def setup_network(self, rpc_result="0x1237", directory=None, rpc_payload=None):
        response_list = [FakeResponse(directory if directory is not None else {"chains": [chain()]})]
        if rpc_payload is not None:
            response_list.append(FakeResponse(rpc_payload))
        elif isinstance(rpc_result, FakeResponse):
            response_list.append(rpc_result)
        else:
            response_list.append(FakeResponse({"jsonrpc": "2.0", "id": 1, "result": rpc_result}))
        calls = []

        def fake_urlopen(request, timeout):
            calls.append((request, timeout))
            if not response_list:
                raise AssertionError("unexpected extra request")
            return response_list.pop(0)

        return calls, response_list, patch.object(public_chain, "_open_request", side_effect=fake_urlopen)

    def invoke(self, args=None):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            rc = public_chain.main(args)
        return rc, stdout.getvalue(), stderr.getvalue()

    def test_default_success_exact_requests_and_output(self):
        calls, remaining, mocked = self.setup_network()
        with mocked:
            rc, out, err = self.invoke([])
        self.assertEqual((rc, out, err), (0, '{"chain":"robinhood_mainnet","chainId":4663}\n', ""))
        self.assertFalse(remaining)
        self.assertEqual(len(calls), 2)
        get, post = (call[0] for call in calls)
        self.assertEqual((get.method, get.full_url, get.data), ("GET", public_chain.DIRECTORY_URL, None))
        self.assertEqual((post.method, post.full_url), ("POST", "https://api.blockvectra.com/v1/robinhood_mainnet/public"))
        self.assertEqual(post.data, b'{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}')
        self.assertEqual(get.get_header("User-agent"), "BlockVectraAgentQuickstartPython/1")
        self.assertEqual(post.get_header("User-agent"), "BlockVectraAgentQuickstartPython/1")
        self.assertEqual([call[1] for call in calls], [15, 15])

    def test_other_dynamic_chain_success_and_qa_user_agent(self):
        calls, _, mocked = self.setup_network(
            rpc_result="0x38", directory={"chains": [chain(56, "bsc_mainnet")]}
        )
        with patch.dict("os.environ", {"BLOCKVECTRA_INTERNAL_QA": "1"}), mocked:
            rc, out, err = self.invoke(["56"])
        self.assertEqual((rc, out, err), (0, '{"chain":"bsc_mainnet","chainId":56}\n', ""))
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1][0].full_url, "https://api.blockvectra.com/v1/bsc_mainnet/public")
        self.assertEqual(calls[0][0].get_header("User-agent"), "BlockVectraAgentQuickstartPython/1 BlockVectraQA/1")

    def test_default_slug_must_be_exact(self):
        calls, _, mocked = self.setup_network(directory={"chains": [chain(slug="robinhood")]})
        with mocked:
            rc, out, _ = self.invoke([])
        self.assertEqual((rc, out), (1, ""))
        self.assertEqual(len(calls), 1)

    def test_duplicate_id_slug_bool_and_malicious_metadata_rejected(self):
        cases = [
            [chain(), chain(4663, "other_mainnet")],
            [chain(), chain(1, "robinhood_mainnet")],
            [{**chain(), "chain_id": True}],
            [chain(slug="evil.example/path")],
            [{**chain(), "public": {"url": "https://attacker.invalid/x", "methods": ["eth_chainId"]}}],
        ]
        for entries in cases:
            with self.subTest(entries=entries):
                calls, _, mocked = self.setup_network(directory={"chains": entries})
                with mocked:
                    rc, out, _ = self.invoke([])
                self.assertEqual((rc, out), (1, ""))
                self.assertEqual(len(calls), 1)

    def test_rpc_method_must_be_advertised(self):
        bad = chain()
        bad["public"]["methods"] = ["eth_blockNumber"]
        calls, _, mocked = self.setup_network(directory={"chains": [bad]})
        with mocked:
            rc, out, _ = self.invoke([])
        self.assertEqual((rc, out), (1, ""))
        self.assertEqual(len(calls), 1)

    def test_rpc_response_validation(self):
        payloads = [
            {"jsonrpc": "1.0", "id": 1, "result": "0x1237"},
            {"jsonrpc": "2.0", "id": True, "result": "0x1237"},
            {"jsonrpc": "2.0", "id": "1", "result": "0x1237"},
            {"jsonrpc": "2.0", "id": 1, "error": {"code": -1, "message": "secret"}},
            {"jsonrpc": "2.0", "id": 1, "result": "0X1237"},
            {"jsonrpc": "2.0", "id": 1, "result": "0x01237"},
            {"jsonrpc": "2.0", "id": 1, "result": "0x"},
            {"jsonrpc": "2.0", "id": 1, "result": "0x1238"},
        ]
        for payload in payloads:
            with self.subTest(payload=payload):
                calls, _, mocked = self.setup_network(rpc_payload=payload)
                with mocked:
                    rc, out, err = self.invoke([])
                self.assertEqual((rc, out), (1, ""))
                self.assertNotIn("secret", err)
                self.assertEqual(len(calls), 2)

    def test_http_429_redirect_and_errors_do_not_retry_and_close(self):
        for status in (429, 302):
            with self.subTest(status=status):
                fake = FakeResponse(b"sensitive response body", status=status)
                calls, _, mocked = self.setup_network(rpc_result=fake)
                with mocked:
                    rc, out, err = self.invoke([])
                self.assertEqual((rc, out), (1, ""))
                self.assertNotIn("sensitive", err)
                self.assertEqual(len(calls), 2)
                self.assertTrue(fake.closed)

    def test_oversized_body_and_timeout_close_response(self):
        for response in (FakeResponse(b"x" * (public_chain.MAX_BODY_BYTES + 1)), FakeResponse(b"", read_error=TimeoutError())):
            with self.subTest(response=response):
                calls, _, mocked = self.setup_network(rpc_result=response)
                with mocked:
                    rc, out, _ = self.invoke([])
                self.assertEqual((rc, out), (1, ""))
                self.assertTrue(response.closed)
                self.assertEqual(len(calls), 2)

    def test_invalid_cli_fails_before_any_request(self):
        for args in (["0"], ["-1"], ["+1"], ["01"], ["1.0"], ["9007199254740992"], ["56", "1"]):
            with self.subTest(args=args), patch.object(public_chain, "_open_request") as network:
                rc, out, _ = self.invoke(list(args))
            self.assertEqual((rc, out), (1, ""))
            network.assert_not_called()


if __name__ == "__main__":
    unittest.main()
