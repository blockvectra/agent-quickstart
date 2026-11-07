# BlockVectra AI Agent 快速上手

本仓库提供面向 AI Agent 与自动化脚本的 TypeScript 和 Python 示例。先做公开 RPC 的无 Key 读取：默认使用 Robinhood 主网，也可通过 chain ID 选择 EVM 链。这一步不需要钱包、注册或 API Key；需要 Data API 或账户时，再继续下文完整的 SIWE 流程。

克隆仓库后，Agent 可先读 [AGENTS.md](AGENTS.md)，按任务选择文档查询、公开读取或账户示例。

## 用 Agent Skill 查询文档

只需要文档帮助时，可在兼容 Agent Skills 的客户端安装 [BlockVectra 文档技能](skills/blockvectra-docs/SKILL.md)，无需运行 TypeScript 示例。固定版本的安装器需要 Node.js >= 22.20.0。在项目目录（OpenClaw 请使用已配置的工作区）中按所用客户端选择一条命令；各命令均安装到当前目录，无需交互确认：

```bash
# Codex
npx --yes skills@1.7.4 add blockvectra/agent-quickstart --skill blockvectra-docs --agent codex --yes

# Claude Code
npx --yes skills@1.7.4 add blockvectra/agent-quickstart --skill blockvectra-docs --agent claude-code --yes

# GitHub Copilot
npx --yes skills@1.7.4 add blockvectra/agent-quickstart --skill blockvectra-docs --agent github-copilot --yes

# OpenClaw
npx --yes skills@1.7.4 add blockvectra/agent-quickstart --skill blockvectra-docs --agent openclaw --yes
```

可以这样提问：“使用 blockvectra-docs，解释 Robinhood 主网公开 RPC 的接入方式，并引用原文。”技能使用已配置的 MCP 文档工具或可用的 HTTP 阅读工具，不需要 BlockVectra 账户或 Key，也不会执行 RPC 或 SIWE 开户示例。技能只提供指引，不包含模型或 MCP 服务。

使用 Copilot CLI 时，先连接托管文档工具，再提出问题：

```bash
copilot mcp add --transport http blockvectra-docs https://docs.blockvectra.com/mcp/docs
```

该服务端入口只提供 `search_docs` 和 `read_doc`，拒绝其他工具；无需 BlockVectra Key，也无需客户端另行筛选工具。

安装器默认收集匿名安装统计；可设置 `DISABLE_TELEMETRY=1` 退出。详见[安装器说明](https://github.com/vercel-labs/skills#telemetry)。

## 先做无 Key 读取

有 Node.js 22（>= 22.18）或 Node.js >= 24.12，以及 git，即可直接运行无 Key 读取，无需安装依赖：

```bash
git clone https://github.com/blockvectra/agent-quickstart.git
cd agent-quickstart
node src/public-read-cli.ts
```

选择其他 EVM 链时，传入十进制 chain ID：

```bash
node src/public-read-cli.ts 56  # BSC 主网
node src/public-read-cli.ts 1   # Ethereum 主网
node src/public-read-cli.ts 57073  # Ink
node src/public-read-cli.ts 130    # Unichain
node src/public-read-cli.ts 252    # Fraxtal
node src/public-read-cli.ts 747474 # Katana
# npm 入口：npm run read:public -- 56
```

不传参数仍读取 Robinhood 主网（`4663`）。目标链必须在当前目录中唯一存在，并声明两个公开读取方法。读取器先核对 RPC 返回的链 ID 与传入值，再读取区块号；目标链或免 Key 策略不可用时立即停止。

该入口使用 Node 的[内置 TypeScript 支持](https://nodejs.org/docs/latest-v22.x/api/typescript.html)，无需构建或 npm 安装。使用其他 Node.js 版本时，检出后仍可走原 npm 路径：

```bash
npm ci --ignore-scripts
npm run read:public
```

该命令先读取公开链目录，确认所选链的精确公开端点及所需方法，再串行读取链 ID 和最新区块号。整个过程最多 3 次 HTTP 请求，即目录加 2 次 JSON-RPC。不需要钱包、注册或 API Key。若目录不再声明该公开端点或所需方法，会在任何 RPC 之前停止。Data API 和账户操作仍然需要 API Key，下文的完整开户流程保持不变。

请求返回 HTTP 错误状态或超时时，命令会指出出错的目录请求或 RPC 方法，并以退出码 `1` 结束。遇到 HTTP `429` 时，请等待后再手动重试。命令不会自动重试，也不会输出响应正文或原始异常；其他失败仍使用通用错误提示。成功时继续输出相同的 JSON 结果。

### Python 标准库入口

也可以使用 Python 3.10 或更高版本运行无 Key 链身份校验，无需 Node.js、npm、第三方包、钱包或 API Key：

```bash
git clone https://github.com/blockvectra/agent-quickstart.git
cd agent-quickstart
python3 examples/public_chain.py
python3 examples/public_chain.py 56  # 从实时目录选择链
```

已安装 [uv](https://docs.astral.sh/uv/) 时，可以不克隆仓库，直接运行固定源码版本的脚本。以下命令选择 Mode 主网：

```bash
uv run --no-project --script --python 3.11 https://raw.githubusercontent.com/blockvectra/agent-quickstart/0df68765d6706a4df88aee469dfb4fd07beeef89/examples/public_chain.py 34443
```

校验成功时输出 `{"chain":"mode_mainnet","chainId":34443}`。将末尾参数改为实时目录中的其他 chain ID 即可换链，省略则选择 Robinhood 主网。uv 会下载脚本，必要时准备 Python 3.11；脚本本身只使用 Python 标准库。

脚本最多串行发送两次 HTTP 请求：先从公开目录选择链，再核对 `eth_chainId` 是否与所选链一致。它验证的是链身份，不读取最新区块，也不验证方法覆盖情况。失败时不会自动重试。每次 socket 操作的超时为 15 秒；这不是 DNS 或整个请求流程的硬截止时间。

### 通过 evmchains 发现公开端点

如果 Python 项目已经使用 [ApeWorX evmchains](https://github.com/ApeWorX/evmchains)，其已发布的 [0.1.10 包](https://pypi.org/project/evmchains/0.1.10/)已经列出 BlockVectra 的 Robinhood 主网和测试网公开 RPC。可以直接从它导出的元数据选择，无需另加 provider 适配器。在项目现有环境中使用 `evmchains==0.1.10`，即可复现以下元数据检查：

```python
from evmchains import PUBLIC_CHAIN_META

for network, expected_id, endpoint in (
    ("mainnet", 4663, "https://api.blockvectra.com/v1/robinhood_mainnet/public"),
    ("testnet", 46630, "https://api.blockvectra.com/v1/robinhood_testnet/public"),
):
    chain = PUBLIC_CHAIN_META["robinhood"][network]
    if chain["chainId"] != expected_id or endpoint not in chain["rpc"]:
        raise RuntimeError("Expected endpoint is absent from packaged chain metadata")
    print(network, expected_id, endpoint)
```

此代码只读取已安装的元数据并打印两个端点，不发送 HTTP 或 RPC 请求，也不创建钱包或账户。包内有 URL 不代表端点当前可用。调用前，请检查[实时链目录](https://api.blockvectra.com/v1/chains)中所选端点当前的 `public` 策略，包括所需方法和历史窗口。上面的 `python3 examples/public_chain.py 4663` 或 `46630` 会从实时目录选择端点并检查链身份，不验证所有方法或完整历史覆盖。

除无 Key 读取外，完整示例还涵盖：
1. **钱包身份**：从环境变量 `AGENT_PRIVATE_KEY` 或本地 `.agent-wallet.json` 文件读取以太坊 EOA 私钥；若均未配置，则在本地生成新钱包并保存至 `.agent-wallet.json`（权限 `0600`），以便后续运行复用相同身份，避免重复开户。
2. **程序化开户与登录**：通过以太坊签名（SIWE / EIP-191）调用 `https://console-api.blockvectra.com/v1` 进行鉴权（程序化模式，不带 `Origin` 请求头）。新钱包首次登录自动完成开户。
3. **API Key 创建与复用**：同一钱包优先复用 `.agent-key.json`，不存在时才创建并以 `0600` 权限保存。`BLOCKVECTRA_API_KEY` 优先，设置后不读取或更改已存 key。
4. **JSON-RPC 调用**：从 `GET https://api.blockvectra.com/v1/chains` 获取当前链目录及策略，精确选择唯一且数字链 ID 为 `4663` 的 `robinhood_mainnet`，先验证该端点的 `eth_chainId`，再使用 API Key 调用 `eth_blockNumber`。
5. **Data API 查询**：根据 OpenAPI 规范调用只读的数据新鲜度接口（`GET /v1/data/{chain}/status/freshness`）。

## 核对已保存的 BSC 收据与日志

想核对一个具体事件，可以从[固定版本的 BSC 收据／日志样例](https://gist.github.com/gjwang/5a8f80f5e441a5701e2e01ae73f187bf/0f680ce849c78375537fce5ed1ce9e447fe2f341)开始。下载页面中的 ZIP、解压后，用 Node.js 22+ 运行：

```sh
node verify-sample.mjs observed-sample.json
```

无需安装 npm 依赖、注册或 key。下载完成后，核验过程不联网。预期输出：`PASS 1 receipt event matched among 4 returned logs`。

原观测时间是 **2026-10-25 13:26:17–13:26:21 UTC**，BSC 主网（`56`），区块 `129476271`。核验器按八个字段比较一个收据事件与固定区块日志，只证明这份存档内部一致，不证明当前可用性、独立 canonical 性或完整历史。

同一压缩包还包含 `bsc-compare-provider.mjs`，可选用自己的 BSC 端点进行对比。请按其说明私密配置环境变量；最多串行发送三次 RPC 请求，无重试或广播，可能消耗供应商额度。这些诊断请求带 `BlockVectraQA/1`，与客户流量分开统计。对比客户端使用合成传输测试，与原始保存的真实响应分列。

## 只接受 URL 的客户端：AgentOS

BlockVectra 已支持 [JSON-RPC URL 路径带 key 鉴权](https://docs.blockvectra.com/en/guides/robinhood-chain/#network-information-and-endpoints)。AgentOS 无需修改 header 鉴权代码或运行本地代理。请先通过私密方式为 AgentOS 进程环境提供 `BLOCKVECTRA_API_KEY`，再设置：

```sh
export RPC_ROBINHOOD_URL="https://api.blockvectra.com/v1/robinhood_mainnet/${BLOCKVECTRA_API_KEY:?Set BLOCKVECTRA_API_KEY privately first}"
```

从该环境沿用平时的命令启动 AgentOS。若 `[trading.rpc_urls]` 已有 `4663` 或 `robinhood` 项，它会优先于环境变量：移除该覆盖项，或私密地改为相同的路径带 key URL。AgentOS [现有选择逻辑](https://github.com/use-agent-os/agent-os/blob/4f6e71de2fc7e2361aefdbe97e6f6408ba8fbe0e/src/agentos/trading/chains.py#L153-L169)依次读取显式覆盖、`RPC_ROBINHOOD_URL`、公开默认值。上述变量由 shell 展开，TOML 不会执行此 shell 展开。

完整 URL 是机密，不要提交版本库、放进共享日志、截图或浏览器代码；设置时不要开启 shell 跟踪（`set -x`）。支持 header 的客户端仍可使用 `x-api-key`；已有 eRPC 的用户也可用下文配置，让本地客户端 URL 不含凭据。

本配置仅用合成 key 核对所链 AgentOS 选择函数与公开路径鉴权合同，未执行真实带 key RPC、AgentOS 交易或 LP 工作流。其 LP 路径还可能使用独立公开日志回退，不能据此称所有外部请求都经 BlockVectra。

## 服务端：限定私有 RPC 请求头的端点

服务端 `makeRpc` 客户端支持注入 `fetcher(stringUrl, requestInit)` 时，可使用 [createHeaderScopedRpcFetch](examples/header-scoped-rpc-fetch.mjs)。请从公开链目录（`GET https://api.blockvectra.com/v1/chains`）选择私有端点，沿用原有选链；`robinhood_mainnet` 与 `eth_mainnet` 都只是示例，不是默认值。在已导入 `makeRpc` 的服务端模块中，保留原有 `network`（本例对应 `'robinhood'`）和 `existingRpcEnv`（含已配置的 fallback）：

```js
import { createHeaderScopedRpcFetch } from './examples/header-scoped-rpc-fetch.mjs';

const endpoint = 'https://api.blockvectra.com/v1/robinhood_mainnet';
const fetcher = createHeaderScopedRpcFetch({
  endpoint, // Must equal your configured primary URL exactly.
  apiKey: process.env.BLOCKVECTRA_API_KEY,
});
const rpc = makeRpc(network, {
  fetcher,
  env: { ...existingRpcEnv, RADAR_ROBINHOOD_RPC_URL: endpoint },
});
```

请通过服务端机密管理器提供 `BLOCKVECTRA_API_KEY`；缺 key 时构造 fetcher 即失败，不输出它。不要放入 URL、日志、浏览器代码或 fallback 配置。只有精确端点才收到 `x-api-key`。其他 headers、method、body 和 AbortSignal 保持透传；调用者通过 `Headers`、tuples 或 object 提供 `x-api-key` 或 `Authorization` 都会被拒绝。即使调用者指定 `follow`，重定向仍会失败；不重试、不读取正文、不包装响应、不追加 URL 参数，429 也原样返回。

配置端点须为字面 `https://api.blockvectra.com/v1/<slug>`（小写字母、数字及分隔符 `_` 或 `-`），拒绝用户名密码、显式端口、query/fragment 和 public 后缀。key 须为非空可打印 ASCII，首尾无空白；请求前即校验，固定错误不回显 key。字符串按原文匹配，path/query/fragment 的标准化变形不会获得授权；`URL` 对象按原生标准化序列化结果取快照，无法恢复 `new URL(...)` 已消去的信息。不支持 `Request`。

该示例仅解决服务端安全 header 接线，不是通用凭据清洗器、浏览器辅助工具或完整 SDK；其他调用者凭据仍由调用者负责。自定义 `fetchImpl` 必须可信且遵守 `redirect: 'error'`。测试仅用合成 key 和本地 HTTP，fixture 的 URL 映射不验证 Prod DNS/TLS。链能力、chain ID、用量与实际扫描（含 24 小时扫描）均未验证。

## 在 eRPC 中接入 BlockVectra

已经使用 eRPC？这份[固定版本配置与离线复现](https://gist.github.com/gjwang/fb8d4cde5f159b6d1d54ee8ae1c10a51/e944e29fadd7b586f48f7f565c21eeeb8af4d778#file-erpc-blockvectra-yaml)为 Robinhood 主网（`4663`）和测试网（`46630`）分别配置上游 URL，通过 `x-api-key` 请求头认证。使用 eRPC 自带的上游配置即可，无需 BlockVectra 专用适配器。

启动前请在服务端环境提供非空的 `BLOCKVECTRA_API_KEY`；YAML 可能把缺失变量展开为空请求头。不要把展开后的配置或认证头放进共享日志。示例使用 eRPC 0.5.0 与本地夹具校验，未验证线上 RPC。`/public` 公开入口的方法和限额不同，不能直接替换这份带 Key 配置。

## 用 HEY 补充构建者信息

完成无 Key 链读取后，可另行获取 [HEY builder card](https://heyresearch.xyz/developers/partners)，查看项目最近报告的交付及来源。有 `curl` 时，可用下面的 Robinhood Chain Ekubo 代币示例：

```bash
hey_card_response="$(curl --silent --show-error --max-time 15 --max-filesize 131072 \
  --header 'x-hey-integration: blockvectra-partner-example/0.1.0' \
  --write-out '\n%{http_code}' \
  'https://heyresearch.xyz/api/v1/builder?chain=4663&token=0x570c5aa79c798e7a418412cc8399ae5bcce570c5')" || exit
hey_card_status="${hey_card_response##*$'\n'}"
hey_card_body="${hey_card_response%$'\n'*}"
case "$hey_card_status" in
  200) ;;
  404) printf '%s\n' 'HEY returned 404; the separate chain read is unchanged.' >&2 ;;
  *) printf 'HEY request returned HTTP %s\n' "$hey_card_status" >&2; exit 1 ;;
esac
printf '%s\n' "$hey_card_body"
```

HTTP `404` 且 `error: "not_found"` 表示 HEY 尚未为该合约发布项目。如需继续查看，可使用返回的 `scan_url`；这不影响独立的 RPC 读取结果。

HEY 的 `as_of`、活动时间和本次链读取时间分别保留。通过返回的 `project_link` 查看来源上下文。`activity_applies_to_token` 为 `false` 时，活动只属于项目层面；`activity_measured` 为 `false` 时表示未测量，不能当作零活动。区块号不能验证 builder card 的内容。

---

## 架构与程序化流程

```
+-------------------------------------------------------------+
|                     本地 Agent 运行环境                      |
|                                                             |
|  1. 生成或加载以太坊 EOA 钱包 (viem)                          |
|  2. 本地执行 EIP-191 personal_sign 对 challenge 消息进行签名    |
+------------------------------+------------------------------+
                               |
                               | (HTTP POST，严禁携带 Origin 头)
                               v
+-------------------------------------------------------------+
|              BlockVectra 控制面 (console-api)                |
|                                                             |
|  - POST /auth/siwe/challenge -> 签发 nonce 与 SIWE 消息      |
|  - POST /auth/siwe/login     -> 校验签名并返回会话令牌         |
|                                 (rgs_...，首次登录自动开户)    |
|  - POST /keys                -> 创建 API Key (rgw_...)      |
+------------------------------+------------------------------+
                               |
                               | (携带 x-api-key 请求头鉴权)
                               v
+-------------------------------------------------------------+
|                BlockVectra 数据面 (Gateway)                  |
|                                                             |
|  - GET  /v1/chains           -> 公开链目录与方法策略          |
|  - POST /v1/{chain}          -> 链作用域 JSON-RPC 接口       |
|  - GET  /v1/data/{chain}/... -> REST 架构 Data API 只读接口  |
+-------------------------------------------------------------+
```

### 密钥安全原则

- **私钥只留在本地**：钱包私钥严禁上传至服务端、写入日志或作为任何工具参数/提示词传入 AI 对话。
- **通过请求头传递 Key**：API Key 仅支持通过 HTTP 请求头（`x-api-key` 或 `Authorization: Bearer`）传递。
- **日志脱敏**：私钥、会话令牌、API Key 原文绝不打印（输出中最多展示前 8 位加省略号，如 `rgw_54dd...`）。
- **基于钱包的身份恢复**：Agent 账户与以太坊钱包地址绑定。若会话令牌或 API Key 遗失，使用同一钱包重新发起 SIWE 登录即可恢复对现有 Key 的管理与吊销能力。

---

## 环境准备

- Node.js >= 18.0.0
- npm
- git

---

## 安装与配置

1. 克隆仓库并进入目录：

   ```bash
   git clone https://github.com/blockvectra/agent-quickstart.git
   cd agent-quickstart
   ```

2. 按锁文件安装依赖：

   ```bash
   npm ci --ignore-scripts
   ```

3. （可选）通过运行环境的机密管理器，将已有钱包私钥注入进程环境变量 `AGENT_PRIVATE_KEY`。`.env.example` 仅说明格式；`npm start` **不会**自动加载 `.env` 文件。

   未设置该覆盖项时，脚本复用 `.agent-wallet.json`；只有文件不存在时才独占创建新钱包，在 POSIX 文件系统上使用 `0600` 权限。文件不可读、损坏或身份字段不一致时，会在登录前报错停止，保留原文件。请保留文件并从可信备份恢复后重试；删除文件会使下次运行创建不同身份。私钥绝不输出到控制台。

---

## 运行示例

通过 `tsx` 直接执行 TypeScript 源码：

```bash
npx tsx src/index.ts
```

或使用 npm 脚本：

```bash
npm start
```

区块号验证要求 HTTP 成功、匹配请求的 JSON-RPC 响应及合法的以太坊区块数量。异常响应会在 Data API 步骤前停止；有效且明确标记可重试的错误每个 RPC 方法最多尝试 5 次（链 ID 与区块号两步合计最多 10 次）。格式见 [JSON-RPC 响应规范](https://www.jsonrpc.org/specification#response_object)和[以太坊数量规范](https://eips.ethereum.org/EIPS/eip-1474#quantity)。

整请求拒绝返回的 `id: null` 错误可在明确标记可重试时重试；成功响应仍必须匹配请求 ID `1`。

此主网示例不通过相似显示名称选链，也不回退到测试网。主网目录条目缺失、重复或链 ID 不符时，在 RPC 前停止；`eth_chainId` 的有效结果必须等于 `4663`，才继续读区块号及 Data API 新鲜度。成功运行因此增加一次只读 RPC；链验证失败时，之前的钱包、账户或 API Key 创建可能已经完成。

完整开户流程中的每次 HTTP 请求均有 15 秒截止时间，包含读取响应正文。超时后停止，不自动重试该请求。超时不代表服务端未执行登录或创建 key；这两步超时时，请先用同一钱包在 Console 核实，再决定是否重跑。

Data API 新鲜度请求设置 15 秒超时且不重试。仅当 HTTP 成功、JSON 响应为非数组对象、`meta.chain` 等于所选 `robinhood_mainnet`、`data` 为数组，且每行的 `dataset` 为字符串、`max_block_number` 与 `seconds_behind` 均为整数或 `null` 时才继续。异常行会以本地稳定错误停止，错误保留 HTTP 状态但不回显上游正文。空列表、0、负整数、`null` 及额外字段均允许。该检查只证明请求流程和所消费字段的结构，不代表所有数据集新鲜、无过期或完整；`null` 会记为 unknown 而不是 0。

运行 `npm test` 和 `npm run typecheck` 可做离线回归检查；测试替换网络调用，不会创建账户。

PR 和 `main` 更新会通过 [Offline checks](.github/workflows/offline-checks.yml) 在 Node.js `24.21.0` 上自动执行这两项检查，依赖按锁文件使用 `npm ci --ignore-scripts` 安装。

---

### 复用创建的 API Key

完整开户流程将 API Key、key ID 和绑定的钱包地址保存到 `.agent-key.json`，使用 `0600` 权限。之后在同一目录运行时复用该文件，跳过登录和创建 key；即使后续 RPC 或 Data API 失败，重跑也不会因此再创建一把。该文件已被 Git 忽略，请通过服务端或 Agent 运行环境的机密管理器读取 `api_key`，不要粘贴到聊天或客户端代码。`BLOCKVECTRA_API_KEY` 优先，设置后不读取或更改已存 key。

文件损坏、权限过宽或钱包不匹配时，在登录前停止并保留原件。已过期或撤销的 key 不会自动替换；请用同一钱包管理，再明确替换本地文件或注入 `BLOCKVECTRA_API_KEY`。新 key 保存失败时，示例会尝试撤销这把新 key，仅报告 key ID 和撤销请求是否被接受。这是本地保存，不是远端 key 状态检查。

## 可选：读取钱包余额（库函数，`npm start` 不会运行）

`src/wallet-balances.ts` 是按需引入的只读辅助模块，对应 `GET /v1/data/{chain}/addresses/{address}/balances`。`collectBalancePages(readPage, expectedChain, maxPages = 20)` 会沿 `next_cursor` 翻页直到该字段缺省；遇到响应结构错误、链不匹配、HTTP/读取失败、游标重复、超过页数上限、跨页重复 token，或已知的 `meta.refreshed_at` 在页间变化时整体拒绝。余额保持精确的十进制整数字符串；未知的 `symbol`/`decimals` 保持 `null`（`decimals: 0` 是有效的真实值）。`readPage` 必须在返回 JSON 之前拒绝 HTTP 错误。只能在服务端运行，API Key 不得出现在浏览器或日志中。

```ts
import { collectBalancePages } from "./src/wallet-balances.js";

const chain = "robinhood_mainnet"; // 先确认该链的能力/覆盖范围
const address = "0x..."; // 要读取的钱包地址

const result = await collectBalancePages(async (cursor) => {
  const url = new URL(`https://api.blockvectra.com/v1/data/${chain}/addresses/${address}/balances`);
  if (cursor !== undefined) url.searchParams.set("cursor", cursor); // 不透明游标，原样传回
  const res = await fetch(url, { headers: { "x-api-key": process.env.BLOCKVECTRA_API_KEY! } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}, chain);
```

实际使用前须确认所选链在该端点上的能力与覆盖范围；本仓库不声明 Robinhood 余额当前可用，也未对线上 API 运行过此模块。余额来自每 6 小时刷新一次的快照（另有最多 30 分钟随机延迟及刷新耗时），数据可能过期。`meta.as_of_block` 是索引头部高度，不是快照高度；请读取 `meta.refreshed_at`（`null` 表示未知，按过期处理）。分页结果不是事务一致的资产组合；`pages` 保留每页原始 `meta`。聚合的 `refreshedAt` 仅在所有页都报告同一个已知时间时才是该时间；只要任一页的 `refreshed_at` 为 `null`，不论页序，聚合值即为 `null`（未知）；即使中间夹着 `null` 页，不同的已知时间仍会被拒绝。

---

## 运行结果示例

以下为输出示例（地址、Key、区块高度及数据集数量会变化；本次修订仅做离线验证）：

```text
=== BlockVectra AI Agent Quickstart ===

[1/5] Generated agent wallet and saved to .agent-wallet.json (0600).
      Tip: Set AGENT_PRIVATE_KEY in your environment to override.

      Wallet Address: 0x...

[2/5] Requesting SIWE challenge...
      Signing verbatim challenge message with EIP-191...
      Submitting SIWE login...
      Account Created: true

[3/5] Provisioning API key...
      Key ID: k_xxxxxxxxxxxx
      API Key saved to .agent-key.json (0600). Keep this file private.

[4/5] Reading chain directory from GET /v1/chains...
      Selected: Robinhood Chain (robinhood_mainnet, Chain ID 4663)
      Verifying eth_chainId via JSON-RPC...
      Verified Chain ID: 4663
      Calling eth_blockNumber via JSON-RPC...
      Latest Block: 77213136 (0x49a2dd0)

[5/5] Querying Data API GET /{chain}/status/freshness...
      Data Datasets Tracked: 15
      Dataset 'blocks': block 77213095 (0s lag)

=== Quickstart Completed Successfully ===
Key ID: k_xxxxxxxxxxxx (Revoke anytime via POST https://console-api.blockvectra.com/v1/keys/k_xxxxxxxxxxxx/revoke)
```

---

## 在编程助手中接入 MCP 服务

BlockVectra 提供两个基于 Streamable HTTP 的 MCP 入口：文档专用入口为 `https://docs.blockvectra.com/mcp/docs`；下列完整入口还包含 RPC、Data 和账户工具：

```
https://docs.blockvectra.com/mcp
```

### 从 Python Agent 读取文档

Python 3.11+ 可通过[官方 MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)直接连接。安装 [uv](https://docs.astral.sh/uv/) 后，在克隆的仓库中执行：

```bash
uv run examples/mcp_docs.py
uv run examples/mcp_docs.py --query "Robinhood 主网 RPC"
uv run examples/mcp_docs.py --query "Robinhood 主网 RPC" --lang zh
```

示例在脚本元数据中固定 `mcp==2.3.0`，先列出两个文档工具，默认再读取英文 `quickstart` 页。传入 `--query` 时，先按关键词检索，再读取所选 `--lang` 的首条匹配文档；无匹配时报错，不会悄悄改读 `quickstart`。不传 `--query` 时，`--lang` 可选择 `quickstart` 的语言。输出 JSON 包含工具名、页面路径、语言和完整 Markdown，Agent 可直接消费。它只连接文档专用入口，不需要 BlockVectra key、钱包或模型 API，也不调用链上 RPC。出错时非零退出；示例运行总时限为 40 秒，依赖安装不包含在该时限内。

前面的独立标准库 RPC 示例仍无需第三方 Python 包。

### 通过 LangChain 读取同一页面

需要 LangChain 工具时，使用 [examples/langchain_docs.py](examples/langchain_docs.py)。准备 Python 3.11+ 和 uv，在克隆的仓库中执行：

```bash
LANGSMITH_TRACING=false uv run examples/langchain_docs.py
```

不克隆仓库也可以试用同一示例，运行以下固定发布版本（需要 Python 3.11+ 和 uv）：

```bash
LANGSMITH_TRACING=false uv run --script --python 3.11 \
  https://raw.githubusercontent.com/blockvectra/agent-quickstart/f6199662a459abebccba5c3451d80bf5e9a199e4/examples/langchain_docs.py
```

[uv 会下载脚本并管理依赖](https://docs.astral.sh/uv/reference/cli/#uv-run)。URL 中的提交号固定示例源码版本，不代表所有传递依赖均已锁定。

脚本在内联元数据中声明 `langchain[mcp]==1.4.9`、`fastmcp==4.1.6`、`mcp==2.3.0`，uv 会管理独立于项目依赖的环境。示例采用当前仍为 **beta** 的 `langchain.mcp.MCPAdapter`，不安装已弃用的 adapters 包。迁移说明见 [LangChain 官方指南](https://docs.langchain.com/oss/python/migrate/langchain-mcp-adapters)。

它先确认仅暴露 `search_docs` 和 `read_doc`，检索英文 `quickstart`，再通过 LangChain 工具读取该页。JSON 输出包含协议版本、工具名和两次工具消息及文档正文。无需 LLM、模型 API key、BlockVectra key 或钱包，不调用链上 RPC；上述命令关闭 LangSmith tracing。操作超时为15秒，协作式总超时为60秒，安装依赖不计入这些时限。既有调用逻辑已用所固定版本核验，不代表模型驱动的完整 Agent 工作流已经验证。

### 1. Claude Code 配置

#### 免 Key 文档服务
无需 API Key；文档专用入口只提供 `search_docs` 和 `read_doc`：

```bash
claude mcp add --transport http blockvectra-docs https://docs.blockvectra.com/mcp/docs
```

#### 带 Key 调用工具
免 Key RPC 的可用方法和限额以所选链的公开策略为准。策略之外的调用、索引 Data API 和账户工具需要你自己的 API Key；带 Key 调用仍受方法和用量限制。

需要完整工具时，将以下独立的 `blockvectra` 条目合并到项目 `.mcp.json`，保留文档连接与其他已有服务：

```json
{
  "mcpServers": {
    "blockvectra": {
      "type": "http",
      "url": "https://docs.blockvectra.com/mcp",
      "headers": {
        "x-api-key": "${BLOCKVECTRA_API_KEY}"
      }
    }
  }
}
```

启动 Claude Code 前私密设置 `BLOCKVECTRA_API_KEY`。文件中只保留字面的变量引用，由 Claude Code [在请求头中展开](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcpjson)；不要将 Key 放入 CLI 参数或聊天。

### 2. Cursor 配置

在项目根目录 `.cursor/mcp.json` 或 Cursor 设置中添加配置：

#### 免 Key 文档服务
```json
{
  "mcpServers": {
    "blockvectra-docs": {
      "url": "https://docs.blockvectra.com/mcp/docs"
    }
  }
}
```

#### 带 Key 调用工具
在 `headers` 对象中注入 API Key 请求头：

```json
{
  "mcpServers": {
    "blockvectra": {
      "url": "https://docs.blockvectra.com/mcp",
      "headers": {
        "x-api-key": "${env:BLOCKVECTRA_API_KEY}"
      }
    }
  }
}
```

Cursor 使用 `${env:NAME}` 引用环境变量。请在启动 Cursor 前让其进程能读取 `BLOCKVECTRA_API_KEY`；这份 HTTP 配置不会读取项目的 `.env` 文件。详见 [Cursor MCP 配置](https://cursor.com/docs/mcp#config-interpolation)。

### MCP 密钥安全说明
- **仅限请求头传递**：API Key 仅能通过 MCP 客户端的 HTTP 请求头（`x-api-key` 或 `Authorization: Bearer`）配置。
- **严禁写入对话**：绝对不要将 API Key、钱包私钥作为工具参数传递，也不要输入到对话记录中。
- **完全绕开缓存**：所有带 Key 的请求均携带 `Cache-Control: no-store`，确保各租户数据隔离。

---

## 密钥管理与身份恢复

若 Agent 会话过期或 API Key 泄露，可通过绑定的以太坊钱包恢复控制权：

1. **重新鉴权**：使用原钱包地址重新请求 challenge 并提交签名完成登录（`account_created: false`），获取新会话令牌。
2. **查询现有 Key 列表**：
   ```bash
   curl -s "https://console-api.blockvectra.com/v1/keys" \
     -H "Authorization: Bearer <session_token>"
   ```
3. **吊销失效或泄漏的 Key**：
   ```bash
   curl -s -X POST "https://console-api.blockvectra.com/v1/keys/<key_id>/revoke" \
     -H "Authorization: Bearer <session_token>"
   ```
4. **重新签发新 Key**：
   ```bash
   curl -s -X POST "https://console-api.blockvectra.com/v1/keys" \
     -H "Authorization: Bearer <session_token>" \
     -H "Content-Type: application/json" \
     -d '{"label":"agent-replacement-key"}'
   ```

---

## 相关资源

- [程序化开户指南](https://docs.blockvectra.com/zh/guides/programmatic-signup/?ref=gh-agent-quickstart)
- [AI Agent 接入指南](https://docs.blockvectra.com/zh/guides/ai-agents/?ref=gh-agent-quickstart)
- [套餐与价格方案](https://blockvectra.com/zh/pricing/?ref=gh-agent-quickstart)
- [Data API OpenAPI 接口规范](https://docs.blockvectra.com/openapi/data.yaml?ref=gh-agent-quickstart)
- [JSON-RPC OpenAPI 接口规范](https://docs.blockvectra.com/openapi/json-rpc.yaml?ref=gh-agent-quickstart)

---

## 许可证

[MIT](LICENSE)
