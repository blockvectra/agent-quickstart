# Agent entry points

Choose the entry that matches the requested task before installing dependencies or running a script.

| Task | Start here |
| --- | --- |
| Answer a BlockVectra documentation question | [Documentation skill](skills/blockvectra-docs/SKILL.md): use configured documentation tools or an available HTTP reader. |
| Read documentation from Python through MCP | [Python MCP example](examples/mcp_docs.py) and the README section “Read documentation from a Python agent”; `--query` searches before reading in the selected language. |
| Check a chain's identity with Python | [Standard-library public reader](examples/public_chain.py) and the README section “Python standard-library entry”. |
| Check chain identity and read the latest block number | [Public TypeScript reader](src/public-read-cli.ts) and the README section “Start with a keyless read”. |
| Inspect a saved BSC receipt and fixed-block logs offline | [Pinned BSC event sample](https://gist.github.com/gjwang/5a8f80f5e441a5701e2e01ae73f187bf/0f680ce849c78375537fce5ed1ce9e447fe2f341) and the README section “Check a saved BSC receipt and its logs”; Node.js 22+, no account or key. |
| Create or reuse an account/key, then call Data API | [Full onboarding example](src/index.ts); read the wallet, SIWE and key-provisioning steps in the README first. |

Use [README.md](README.md) or [README.zh.md](README.zh.md) for prerequisites, commands and each example's request limits. The documentation skill owns the documentation-reading instructions; follow its source and citation rules rather than treating this routing table as API documentation.

`npm start` runs the full onboarding example. It can create a local wallet, a BlockVectra account and an API key; do not use it for a documentation question or a keyless identity check. Those smaller tasks have separate entries above.

For public reads, let the example select from the live chain directory and verify the chain ID. A successful identity check does not establish history coverage or support for other RPC methods. Keep mainnet and testnet separate.

Keep credentials in the user's private environment or the existing private local files. Never copy them into issues, output, example arguments or committed files. Do not invent a key, register an account or send a transaction merely to answer a documentation question.

When changing an example, use the existing scripts in [package.json](package.json) and the relevant files in [tests/](tests/); keep the English and Chinese README instructions aligned. State whether a result came from saved source, an offline check or an actual network request.
