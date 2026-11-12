# Codex / Claude Code 接入 Memory

在运行 AI 客户端的电脑上安装 Node.js 22+，然后执行：

```sh
npx --yes --allow-remote=all https://github.com/NyaRu-Kiss/rutter-direct-memory/releases/download/v0.1.2/rutter-direct-memory-0.1.2.tgz
```

Windows PowerShell 可使用 `npx.cmd`。安装包从 GitHub 下载，无需登录 npm 或 GitHub，不需要克隆仓库、安装 MCP 依赖或提供服务器 SSH 密码。`--allow-remote=all` 明确允许这次 URL 下载，不会修改用户保存的 npm 设置。

## 首次配置

| 提示 | 怎么填 |
| --- | --- |
| Memory API 地址 | 管理员提供的 Knowledge API 地址，末尾带 `/v3`，例如 `https://memory.example.com/v3`。此处是格式示例，不能直接照填；面板的 8125 端口也不能作为 API 地址。 |
| Service ID | 目标实例的 Service ID；回车使用 `default`。 |
| Memory 用户凭证 | 你在目标 Memory 服务中的 `User_Key`。使用管理员发给你的 Key，或在目标面板「API Key / User_Key 管理」中创建自己的 Key 并保存。新 Key 只显示一次，输入安装器时不回显。 |

模型 API Key 和模型地址继续由 Codex / Claude Code 自己使用。Memory 用户凭证不要填写模型 API Key、面板登录密码或 SSH 密码。

远程 API 必须使用 HTTPS。`http://127.0.0.1:8424/v3` 适用于本机 Knowledge；若使用 `http://127.0.0.1:18424/v3` 连接远程服务，须先建立并保持本机 18424 到远程 Knowledge 的转发。只有 HTTP 面板入口时，管理员还需提供 HTTPS API，或为已有 SSH 权限的用户安排转发。GitHub 下载只解决安装包分发，不会自动提供服务端 HTTPS 或 SSH 通道。

## 当前服务器无需 SSH 的接入方式

当前部署的 HTTPS Memory API 为 `https://efficiencybyai.com/knowledge/v3`。可以直接访问，无需 SSH 转发或服务器密码；仍需填写你自己的 Memory User_Key。

首次安装可在安装命令后追加 `--server https://efficiencybyai.com/knowledge`。已安装过本机或 SSH 转发配置时，运行：

```sh
npx --yes --allow-remote=all https://github.com/NyaRu-Kiss/rutter-direct-memory/releases/download/v0.1.2/rutter-direct-memory-0.1.2.tgz --server https://efficiencybyai.com/knowledge --reconfigure
```

Windows PowerShell 使用 `npx.cmd`。Memory API 地址回车使用预填值，Service ID 回车使用 `default`，凭证填写服务器面板创建的完整 User_Key。完成后重启客户端并开启新会话，旧 SSH 转发窗口可以按 Ctrl+C 退出。`--server` 不带 `/v3`；直接填写 API 地址时须保留 `/knowledge/v3`。

## 已安装过，为什么没有询问配置

本机已有 `~/.config/rutter-direct-memory/config.json` 时，安装器先验证已有地址、Service ID 和凭证。通过后复用；格式错误或凭证无效时引导重新填写。普通安装不会自动切换到新的服务器。

重新填写三个值：

```sh
npx --yes --allow-remote=all https://github.com/NyaRu-Kiss/rutter-direct-memory/releases/download/v0.1.2/rutter-direct-memory-0.1.2.tgz --reconfigure
```

Memory 凭证必须是完整的 `sk-mem-` 开头的 User_Key，不能填写 `default`。安装器会连接目标服务验证凭证，验证成功才保存配置并安装 Hook、MCP；验证失败或取消时保留原配置。网络故障会明确提示检查地址或 SSH 转发。安装器会备份被修改的配置，不会要求用户把凭证发送给模型。具体资产权限在会话选择页确认。

每次安装、重新安装或升级成功后，都会开启上传总开关，包括此前主动关闭的情况，不需要另行执行 `upload.cjs --enable` 或输入 `YES`。

## 开始使用并自动上传

1. 重启 Codex 或 Claude Code。若出现 Hook 信任提示，核对本地命令路径后按客户端提示确认。
2. 新建会话并发送第一条消息，在浏览器中选择 Team、Project、Agent；Task 可以留空。
3. “上传本会话的用户文本和最终助手回复到项目 L0”默认勾选。不希望上传时取消勾选，确认选择后返回客户端。
4. 助手完成回复后，Stop Hook 自动上传支持的主会话文本；在对应项目的聊天记忆详情中查看 L0。

每个新会话都需确认资产及上传选择。取消勾选仍可读取 Memory 和使用 MCP；选择“本次不使用 Memory”后，该会话跳过上下文读取、上传和 MCP 会话候选。上传不包括工具调用及输出、子 Agent 和思考过程；中断、压缩或删除 transcript 时不能保证完整补传。

MCP 提供 `current_assets`、`search_memory` 和 `list_knowledge` 三个只读工具。调用时需要在本机页面选择本次查询所属的客户端会话。

运行期间检测到 Memory 地址、Service ID 或凭证变化，或者上传接口返回 401/403，仍会自动停止上传并清除待传队列。检查配置后重新运行安装命令，通过验证即可恢复总开关，新会话默认勾选上传。恢复后不会主动补传停用期间的历史；同一配置下已开启上传时重复安装会保留待传队列。

旧版教程保留在 [v0.1.1 教程](GUIDE.v0.1.1.zh-CN.md)。

## 升级与卸载

重新执行安装命令可更新同版本安装；升级时改用新 Release 提供的固定版本命令。`--client codex` 或 `--client claude` 可仅配置一个客户端。

卸载时在完整安装命令后追加 `--uninstall`。卸载移除本接入的 Hook 和 MCP，保留本机 Memory 凭证、会话选择和上传状态。客户端运行文件保存在用户目录，清理 npx 缓存不会使 Hook 或 MCP 失效。

Windows、macOS 的安装入口已提供，原生客户端完整流程尚未完成逐版本验证。
