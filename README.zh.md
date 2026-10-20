# BlockVectra AI Agent 快速上手（TypeScript）

本仓库提供一个端到端的 TypeScript 开源示例，展示自主 AI Agent 或自动化脚本如何在脱离浏览器和人工干预的情况下，程序化接入并使用 BlockVectra。

示例涵盖完整流程：
1. **钱包身份**：从环境变量 `AGENT_PRIVATE_KEY` 或本地 `.agent-wallet.json` 文件读取以太坊 EOA 私钥；若均未配置，则在本地生成新钱包并保存至 `.agent-wallet.json`（权限 `0600`），以便后续运行复用相同身份，避免重复开户。
2. **程序化开户与登录**：通过以太坊签名（SIWE / EIP-191）调用 `https://console-api.blockvectra.com/v1` 进行鉴权（程序化模式，不带 `Origin` 请求头）。新钱包首次登录自动完成开户。
3. **API Key 创建**：使用登录获得的会话令牌（`rgs_...`）调用控制台接口生成 API Key（`rgw_...`）。
4. **JSON-RPC 调用**：从 `GET https://api.blockvectra.com/v1/chains` 获取当前链目录及策略，精确选择唯一且数字链 ID 为 `4663` 的 `robinhood_mainnet`，先验证该端点的 `eth_chainId`，再使用 API Key 调用 `eth_blockNumber`。
5. **Data API 查询**：根据 OpenAPI 规范调用只读的数据新鲜度接口（`GET /v1/data/{chain}/status/freshness`）。

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
- npm 或兼容的 Node.js 包管理器

---

## 安装与配置

1. 进入项目目录：

   ```bash
   cd agent-quickstart
   ```

2. 安装依赖（仅依赖 `viem` 与 `tsx`）：

   ```bash
   npm install
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

运行 `npm test` 和 `npm run typecheck` 可做离线回归检查；测试替换网络调用，不会创建账户。

PR 和 `main` 更新会通过 [Offline checks](.github/workflows/offline-checks.yml) 在 Node.js `24.21.0` 上自动执行这两项检查，依赖按锁文件使用 `npm ci --ignore-scripts` 安装。

---

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
      Session Token: rgs_4f5b...

[3/5] Provisioning API key...
      Key ID: k_xxxxxxxxxxxx
      API Key: rgw_9b70...

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
Created Key ID: k_xxxxxxxxxxxx (Revoke anytime via POST https://console-api.blockvectra.com/v1/keys/k_xxxxxxxxxxxx/revoke)
```

---

## 在编程助手中接入 MCP 服务

BlockVectra 在以下地址提供基于 Streamable HTTP 协议的 Model Context Protocol (MCP) 服务：

```
https://docs.blockvectra.com/mcp
```

### 1. Claude Code 配置

#### 免 Key 文档与状态查询
无需 API Key 即可检索文档、读取 Markdown、查询链参数与服务就绪状态：

```bash
claude mcp add --transport http blockvectra-docs https://docs.blockvectra.com/mcp
```

#### 带 Key 调用工具
若需使用 `rpc_call` 和 `data_api_get` 两个链上数据工具，通过 `-H` 参数传递 API Key：

```bash
claude mcp add --transport http -H "x-api-key: $BLOCKVECTRA_API_KEY" blockvectra-docs https://docs.blockvectra.com/mcp
```

### 2. Cursor 配置

在项目根目录 `.cursor/mcp.json` 或 Cursor 设置中添加配置：

#### 免 Key 文档服务
```json
{
  "mcpServers": {
    "blockvectra-docs": {
      "url": "https://docs.blockvectra.com/mcp"
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
        "x-api-key": "${BLOCKVECTRA_API_KEY}"
      }
    }
  }
}
```

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
