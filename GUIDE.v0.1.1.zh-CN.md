# Codex / Claude Code 接入 Memory

在运行 AI 客户端的电脑上安装 Node.js 22+，然后执行：

```sh
npx --yes --allow-remote=all https://github.com/NyaRu-Kiss/rutter-direct-memory/releases/download/v0.1.1/rutter-direct-memory-0.1.1.tgz
```

Windows PowerShell 可使用 `npx.cmd`。安装包从 GitHub 下载，无需登录 npm 或 GitHub，不需要克隆仓库、安装 MCP 依赖或提供服务器 SSH 密码。`--allow-remote=all` 明确允许这次 URL 下载，不会修改用户保存的 npm 设置。

## 首次配置

| 提示 | 怎么填 |
| --- | --- |
| Memory API 地址 | 管理员提供的 Knowledge API 地址，末尾带 `/v3`，例如 `https://memory.example.com/v3`。此处是格式示例，不能直接照填；面板的 8125 端口也不能作为 API 地址。 |
| Service ID | 目标实例的 Service ID；本项目默认部署填写 `default`。 |
| Memory 用户凭证 | 你在目标 Memory 服务中的 `User_Key`。使用管理员发给你的 Key，或在目标面板「API Key / User_Key 管理」中创建自己的 Key 并保存。新 Key 只显示一次，输入安装器时不回显。 |

模型 API Key 和模型地址继续由 Codex / Claude Code 自己使用。Memory 用户凭证不要填写模型 API Key、面板登录密码或 SSH 密码。

远程 API 必须使用 HTTPS。`http://127.0.0.1:8424/v3` 适用于本机 Knowledge；若使用 `http://127.0.0.1:18424/v3` 连接远程服务，须先建立并保持本机 18424 到远程 Knowledge 的转发。只有 HTTP 面板入口时，管理员还需提供 HTTPS API，或为已有 SSH 权限的用户安排转发。GitHub 下载只解决安装包分发，不会自动提供服务端 HTTPS 或 SSH 通道。

## 已安装过，为什么没有询问配置

本机已有 `~/.config/rutter-direct-memory/config.json` 时，安装器直接复用其中的地址、Service ID 和凭证，只更新 Hook 和 MCP。普通安装不会自动切换到新的服务器。

重新填写三个值：

```sh
npx --yes --allow-remote=all https://github.com/NyaRu-Kiss/rutter-direct-memory/releases/download/v0.1.1/rutter-direct-memory-0.1.1.tgz --reconfigure
```

安装器会备份被修改的客户端设置。显示安装成功只表示本机配置已写入，服务连通和权限需在客户端会话中确认。安装器不会要求用户把凭证发送给模型。

## 开始使用并自动上传

1. 重启 Codex 或 Claude Code。若出现 Hook 信任提示，核对本地命令路径后按客户端提示确认。
2. 新建会话并发送第一条消息，在浏览器中选择 Team、Project、Agent；Task 可以留空。
3. 若要上传，勾选“上传本会话的用户文本和最终助手回复到项目 L0”，确认选择后返回客户端。
4. 助手完成回复后，Stop Hook 自动上传支持的主会话文本；在对应项目的聊天记忆详情中查看 L0。

每个新会话都需单独同意上传。不勾选仍可读取 Memory 和使用 MCP；选择“本次不使用 Memory”后，该会话跳过上下文读取、上传和 MCP 会话候选。上传不包括工具调用及输出、子 Agent 和思考过程；中断、压缩或删除 transcript 时不能保证完整补传。

MCP 提供 `current_assets`、`search_memory` 和 `list_knowledge` 三个只读工具。调用时需要在本机页面选择本次查询所属的客户端会话。

## 升级与卸载

重新执行安装命令可更新同版本安装；升级时改用新 Release 提供的固定版本命令。`--client codex` 或 `--client claude` 可仅配置一个客户端。

卸载时在完整安装命令后追加 `--uninstall`。卸载移除本接入的 Hook 和 MCP，保留本机 Memory 凭证、会话选择和上传状态。客户端运行文件保存在用户目录，清理 npx 缓存不会使 Hook 或 MCP 失效。

Windows、macOS 的安装入口已提供，原生客户端完整流程尚未完成逐版本验证。
