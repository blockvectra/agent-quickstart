#!/usr/bin/env python3
"""Read and verify the public JSON-RPC chain identity without third-party packages."""

from __future__ import annotations

import json
import re
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


DIRECTORY_URL = "https://api.blockvectra.com/v1/chains"
RPC_BASE_URL = "https://api.blockvectra.com/v1/"
DEFAULT_CHAIN_ID = 4663
MAX_SAFE_INTEGER = 2**53 - 1
MAX_BODY_BYTES = 128 * 1024
SOCKET_TIMEOUT_SECONDS = 15
JSONRPC_REQUEST = {"jsonrpc": "2.0", "method": "eth_chainId", "params": [], "id": 1}
DECIMAL_ID_RE = re.compile(r"^[1-9][0-9]*$", re.ASCII)
SLUG_RE = re.compile(r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$", re.ASCII)
QUANTITY_RE = re.compile(r"^0x(?:0|[1-9a-f][0-9a-f]*)$", re.ASCII)


class _NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


class PublicReadError(Exception):
    """A safe, user-facing failure without response or transport details."""


def parse_chain_id_args(args: list[str]) -> int:
    if not args:
        return DEFAULT_CHAIN_ID
    if len(args) != 1 or not DECIMAL_ID_RE.fullmatch(args[0]):
        raise PublicReadError("Usage: python3 examples/public_chain.py [positive-decimal-chain-id]")
    value = int(args[0])
    if value > MAX_SAFE_INTEGER:
        raise PublicReadError("Invalid chain ID")
    return value


def _is_object(value: Any) -> bool:
    return isinstance(value, dict)


def select_public_chain(directory: Any, expected_chain_id: int) -> dict[str, Any]:
    if isinstance(expected_chain_id, bool) or not isinstance(expected_chain_id, int) or not 1 <= expected_chain_id <= MAX_SAFE_INTEGER:
        raise PublicReadError("Invalid chain ID")
    if not _is_object(directory) or not isinstance(directory.get("chains"), list):
        raise PublicReadError("Invalid chain directory")

    entries = [entry for entry in directory["chains"] if _is_object(entry)]
    matches = [entry for entry in entries if type(entry.get("chain_id")) is int and entry["chain_id"] == expected_chain_id]
    if len(matches) != 1:
        raise PublicReadError("Chain ID is missing or ambiguous in the directory")
    entry = matches[0]
    slug = entry.get("chain")
    if not isinstance(slug, str) or not SLUG_RE.fullmatch(slug) or sum(candidate.get("chain") == slug for candidate in entries) != 1:
        raise PublicReadError("Chain slug is invalid or ambiguous in the directory")
    if expected_chain_id == DEFAULT_CHAIN_ID and slug != "robinhood_mainnet":
        raise PublicReadError("Robinhood mainnet directory entry is invalid")
    rpc_url = RPC_BASE_URL + slug + "/public"
    if entry.get("jsonrpc") is not True:
        raise PublicReadError("Selected chain does not advertise JSON-RPC")
    public = entry.get("public")
    if not _is_object(public) or public.get("url") != rpc_url:
        raise PublicReadError("Selected chain public endpoint is invalid")
    methods = public.get("methods")
    if not isinstance(methods, list) or any(not isinstance(method, str) for method in methods) or "eth_chainId" not in methods:
        raise PublicReadError("Selected chain does not advertise eth_chainId")
    return {"chain": slug, "chainId": expected_chain_id, "rpcUrl": rpc_url}


def _user_agent() -> str:
    import os

    suffix = " BlockVectraQA/1" if os.environ.get("BLOCKVECTRA_INTERNAL_QA") == "1" else ""
    return "BlockVectraAgentQuickstartPython/1" + suffix


def _read_limited(response: Any, deadline: float) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise PublicReadError("Request timed out")
        if hasattr(response, "settimeout"):
            response.settimeout(min(SOCKET_TIMEOUT_SECONDS, remaining))
        chunk = response.read(min(8192, MAX_BODY_BYTES + 1 - total))
        if not chunk:
            return b"".join(chunks)
        total += len(chunk)
        if total > MAX_BODY_BYTES:
            raise PublicReadError("Response body is too large")
        chunks.append(chunk)


def _request_json(url: str, method: str, body: bytes | None) -> Any:
    headers = {"Accept": "application/json", "User-Agent": _user_agent()}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = Request(url, data=body, headers=headers, method=method)
    started = time.monotonic()
    response = None
    try:
        response = _open_request(request, timeout=SOCKET_TIMEOUT_SECONDS)
        if getattr(response, "status", 200) < 200 or getattr(response, "status", 200) >= 300:
            raise PublicReadError("HTTP request failed")
        raw = _read_limited(response, started + SOCKET_TIMEOUT_SECONDS)
        return json.loads(raw)
    except PublicReadError:
        raise
    except HTTPError as exc:
        exc.close()
        raise PublicReadError("HTTP request failed") from None
    except (URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
        raise PublicReadError("Request failed") from None
    finally:
        if response is not None:
            response.close()


def _open_request(request: Request, timeout: float):
    return build_opener(_NoRedirectHandler).open(request, timeout=timeout)


def _validate_rpc_response(payload: Any, expected_chain_id: int) -> None:
    if not _is_object(payload) or payload.get("jsonrpc") != "2.0":
        raise PublicReadError("Invalid JSON-RPC response")
    response_id = payload.get("id")
    if type(response_id) is not int or response_id != 1 or "error" in payload or "result" not in payload:
        raise PublicReadError("Invalid JSON-RPC response")
    quantity = payload["result"]
    if not isinstance(quantity, str) or not QUANTITY_RE.fullmatch(quantity):
        raise PublicReadError("Invalid chain ID response")
    if int(quantity, 16) != expected_chain_id:
        raise PublicReadError("RPC chain ID does not match the selected chain")


def run(expected_chain_id: int) -> dict[str, Any]:
    directory = _request_json(DIRECTORY_URL, "GET", None)
    selected = select_public_chain(directory, expected_chain_id)
    rpc_body = json.dumps(JSONRPC_REQUEST, separators=(",", ":")).encode("utf-8")
    result = _request_json(selected["rpcUrl"], "POST", rpc_body)
    _validate_rpc_response(result, expected_chain_id)
    return {"chain": selected["chain"], "chainId": expected_chain_id}


def main(args: list[str] | None = None) -> int:
    try:
        chain_id = parse_chain_id_args(sys.argv[1:] if args is None else args)
        print(json.dumps(run(chain_id), separators=(",", ":")))
        return 0
    except PublicReadError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except Exception:
        print("Public chain read failed", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
