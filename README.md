# Rutter Direct Memory

Install the Memory Hook and MCP for Codex CLI and Claude Code on Windows,
Linux, or macOS. Requires Node.js 22+ and an interactive terminal.

中文操作步骤：[使用教程](https://github.com/NyaRu-Kiss/rutter-direct-memory/blob/main/GUIDE.zh-CN.md)。

Run this command on the computer where your AI client runs:

```sh
npx --yes --allow-remote=all https://github.com/NyaRu-Kiss/rutter-direct-memory/releases/download/v0.1.3/rutter-direct-memory-0.1.3.tgz
```

On Windows PowerShell use `npx.cmd` if script policy blocks `npx.ps1`.
`--allow-remote=all` permits this URL download (required by npm 12) without
changing saved npm settings. The package is distributed through GitHub Releases,
not the npm registry under the bare name `rutter-direct-memory`.

## One prompt to connect

The default API is `https://efficiencybyai.com/knowledge/v3`, with Service ID
`default`. No server flags, SSH tunnel, or server password are needed. First
installation asks only for your personal Memory User_Key, with hidden input.
Obtain it from your administrator or create one in the server panel's API Key /
User_Key management page. Enter a complete `sk-mem-` key, never `default`, a model
API key, or a panel password.

The installer verifies the authenticated asset catalog, backs up configuration,
registers Hook and MCP for both clients, and enables the local upload switch.
Restart your AI client and confirm its Hook trust prompt if shown. Model API
keys and model configuration remain in your AI client.

Repeat the same command to upgrade. Correct public HTTPS configuration is
verified and reused without prompting. If an old configuration points to a local
forward or another instance, the installer asks for this server's User_Key before
migrating it; credentials from a different endpoint are not sent automatically.
Failed or cancelled verification preserves the previous configuration.

## Conversations and upload

New conversations ask you to choose Team, Project, and Agent; Task is optional.
Uploading user text and final assistant replies to project L0 is preselected.
Uncheck it to disable upload, or choose no Memory for that conversation. Tools,
subagents, and reasoning are excluded. MCP supplies three read-only tools:
`current_assets`, `search_memory`, and `list_knowledge`.

Every successful install, reinstall, or upgrade enables the upload switch,
including when previously disabled. Runtime connection changes and upload
401/403 responses still stop uploads and clear pending messages. Rerun the
installer after correcting the configuration to restore uploads for new
conversations. Disabled-period history is not automatically backfilled.
Reinstalling an already enabled, unchanged identity preserves pending messages.

## Options

Append options to the same npx command:

```text
--reconfigure        Replace your Memory User_Key
--client codex       Configure only Codex
--client claude      Configure only Claude Code
--server https://memory.example.com --reconfigure
                     Advanced setup for another deployment: API, Service ID, key
--uninstall          Remove this integration's Hook and MCP configuration
--help               Show usage without changing client configuration
```

Runtime files live in `~/.config/rutter-direct-memory/releases/<content-version>/`.
Clearing npx cache does not break Hook or MCP. Uninstall keeps credentials,
conversation selections, and upload state. Remote APIs require HTTPS.

MCP dependencies are bundled; there are no install lifecycle scripts. Native
Windows/macOS end-to-end client flows have not been verified for every version.
Source files are maintained in `agents/direct-memory-access/` of the main Rutter
repository. Previous tutorials remain available in this repository.
