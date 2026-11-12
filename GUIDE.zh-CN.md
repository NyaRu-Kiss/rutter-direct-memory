# Codex / Claude Code 接入 Memory

在运行 AI 客户端的电脑上安装 Node.js 22+，然后执行：

```sh
npx --yes --allow-remote=all https://github.com/NyaRu-Kiss/rutter-direct-memory/releases/download/v0.1.3/rutter-direct-memory-0.1.3.tgz
```

Windows PowerShell 可使用 `npx.cmd`。安装包从 GitHub 下载，无需登录 npm 或 GitHub，不需要克隆仓库、手动修改客户端配置或安装 MCP 依赖。`--allow-remote=all` 允许本次 URL 下载，不会修改用户保存的 npm 设置。

## 只需填写自己的 User_Key

普通安装已内置：

| 配置项 | 默认值 |
| --- | --- |
| Memory API | `https://efficiencybyai.com/knowledge/v3` |
| Service ID | `default` |

这两项不需要输入，也不需要 `--server`。客户端直接通过公网 HTTPS 连接，不使用 SSH，不需要服务器密码。

首次安装只询问个人 Memory User_Key，输入时不会回显。它由管理员发放，或登录当前服务器面板，在「API Key / User_Key 管理」中创建并保存。必须填写完整的 `sk-mem-` 开头的 Key，不能填写 `default`、面板登录密码或模型 API Key。

安装器会验证连接和凭证，成功后自动备份并保存配置、注册 Codex / Claude Code 的 Hook 和 MCP，并开启上传总开关。验证失败或取消时保留原配置。模型 API Key 和模型地址继续由 AI 客户端自己使用。

## 已安装用户也运行同一条命令

- 已有正确 HTTPS 地址和有效凭证：验证后直接复用。
- 旧配置使用本机、SSH 转发或其他实例的地址：提示填写当前 HTTPS 服务的 User_Key，验证成功后备份并替换旧配置。不会自动把其他实例的旧凭证发送到当前服务器。
- 旧凭证无效：提示重新填写 User_Key。

无需额外参数。若要主动更换已保存的 Key，在同一命令后追加 `--reconfigure`，仍只询问 User_Key。

每次安装、重新安装或升级成功均开启上传总开关，包括此前主动关闭的情况，无需再执行 `upload.cjs --enable` 或输入 `YES`。旧 SSH 转发窗口可以按 Ctrl+C 退出。

## 开始使用并自动上传

1. 重启 Codex 或 Claude Code。若出现 Hook 信任提示，核对本地命令路径后按客户端提示确认。
2. 新建会话并发送第一条消息，在浏览器中选择 Team、Project、Agent；Task 可以留空。
3. 上传本会话用户文本和最终助手回复到项目 L0 的选项默认勾选。不希望上传时取消勾选，确认选择后返回客户端。
4. 助手完成回复后，Stop Hook 自动上传支持的主会话文本；在对应项目的聊天记忆详情中查看 L0。

取消勾选上传仍可读取 Memory 和使用 MCP；选择“本次不使用 Memory”后，该会话跳过上下文读取、上传和 MCP 会话候选。上传不包括工具调用及输出、子 Agent 和思考过程；中断、压缩或删除 transcript 时不能保证完整补传。

MCP 提供 `current_assets`、`search_memory` 和 `list_knowledge` 三个只读工具。调用时需要在本机页面选择本次查询所属的客户端会话。

运行期间检测到 Memory 地址、Service ID 或凭证变化，或者上传接口返回 401/403，仍会自动停止上传并清除待传队列。检查配置后重新运行安装命令，通过验证即可恢复新会话上传。不会主动补传停用期间的历史；同一配置已开启上传时重复安装会保留待传队列。

## 其他部署、升级与卸载

连接其他部署时，在 npx 命令后追加 `--server https://memory.example.com --reconfigure`。这会进入高级配置，询问 API 地址、Service ID 和 User_Key；远程 API 必须使用 HTTPS。`--server` 不带 `/v3`，直接填写 API 地址时须包含 `/v3`。

`--client codex` 或 `--client claude` 可仅配置一个客户端。追加 `--uninstall` 会移除本接入的 Hook 和 MCP，保留本机凭证、会话选择和上传状态。客户端运行文件保存在用户目录，清理 npx 缓存不会使 Hook 或 MCP 失效。

旧教程保留在 [v0.1.1 教程](GUIDE.v0.1.1.zh-CN.md)和 [v0.1.2 教程](GUIDE.v0.1.2.zh-CN.md)。Windows、macOS 安装入口已提供，原生客户端完整流程尚未逐版本验证。
