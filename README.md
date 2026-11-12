# Rutter Direct Memory

Install the Memory Hook and MCP for Codex CLI and Claude Code on Windows,
Linux, or macOS. Requires Node.js 22+ and an interactive terminal.

中文操作步骤与配置项说明：[使用教程](https://github.com/NyaRu-Kiss/rutter-direct-memory/blob/main/GUIDE.zh-CN.md)。

Run the public GitHub release with npm/npx; no GitHub login, repository clone,
Git executable, SSH password, or download from the Memory server is required:

```sh
npx --yes --allow-remote=all https://github.com/NyaRu-Kiss/rutter-direct-memory/releases/download/v0.1.1/rutter-direct-memory-0.1.1.tgz
```

The `--allow-remote=all` flag permits this intentional URL download for this
command (required by npm 12); it does not change your saved npm settings.

On Windows PowerShell, use `npx.cmd` if script execution policy blocks `npx.ps1`.
MCP dependencies are bundled. The package has no install lifecycle scripts.
The package is distributed through GitHub Releases; it is not currently
published to the npm registry under the bare name `rutter-direct-memory`.

On first configuration, the installer asks for:

| Field | Value |
| --- | --- |
| Memory API URL | Your administrator's HTTPS Knowledge API URL, ending in `/v3`, for example `https://memory.example.com/v3`. A panel URL on port 8125 is not the Memory API. |
| Service ID | The target instance's Service ID; the default deployment uses `default`. |
| Memory user credential | Your own User_Key for that Memory instance. Obtain it from your administrator or create one in the panel's API Key / User_Key management page. Save it when shown. |

Do not enter a model API key, panel login password, or server SSH password.
The installer backs up existing client settings and registers both Hook and
MCP. Restart your AI client and approve its Hook trust prompt if shown.

If `~/.config/rutter-direct-memory/config.json` already exists, a normal install
reuses its server address and credential without prompting. Downloading this
package does not switch an existing local setup to a remote server. To enter
all three values again, run:

```sh
npx --yes --allow-remote=all https://github.com/NyaRu-Kiss/rutter-direct-memory/releases/download/v0.1.1/rutter-direct-memory-0.1.1.tgz --reconfigure
```

Installation success confirms that local client settings were written; it does
not verify server connectivity or asset access. Check those when selecting
assets in a new client conversation.

New conversations ask you to choose Team, Project and Agent. Task is optional.
To upload the conversation, explicitly check the option to upload user text
and final assistant replies to project L0. Tool calls/output, subagents and
reasoning are excluded. Choosing no Memory disables it for that conversation.

Downloading this installer does not require access to the Memory server.
Reading memories and uploading conversations still require a reachable Memory
API. Remote API URLs must use HTTPS; HTTP is accepted only on loopback.
A public HTTP domain alone does not satisfy this requirement.
`http://127.0.0.1:8424/v3` refers to a local Knowledge service. A URL such as
`http://127.0.0.1:18424/v3` reaches a remote server only while an SSH tunnel or
another local forward to that server is running. The npx installer does not
create a tunnel or configure HTTPS for your server.

Options (append to the same npx command):

```text
--client codex        Configure only Codex
--client claude       Configure only Claude Code
--server https://memory.example.com
                      Prefill the API URL with this server plus /v3
--reconfigure        Enter the Memory address and user credential again
--uninstall          Remove this integration's Hook and MCP configuration
--help               Show usage without changing client configuration
```

Runtime files are copied out of the temporary npx cache to
`~/.config/rutter-direct-memory/releases/<content-version>/`. Clearing the npm
cache does not break the installed Hook or MCP. Repeat the install command to
repair or upgrade; existing settings are backed up before changes. Uninstall
keeps local credentials, conversation selections, and pending upload data.

Windows and macOS entries are provided; native end-to-end client workflows
have not yet been verified on those operating systems.

This repository is the generated standalone client distribution. Its sources
are maintained in `agents/direct-memory-access/` of the main Rutter repository.
