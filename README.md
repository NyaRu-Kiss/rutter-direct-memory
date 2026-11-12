# Rutter Direct Memory

Install the Memory Hook and MCP for Codex CLI and Claude Code on Windows,
Linux, or macOS. Requires Node.js 22+ and an interactive terminal.

中文操作步骤与配置项说明：[使用教程](https://github.com/NyaRu-Kiss/rutter-direct-memory/blob/main/GUIDE.zh-CN.md)。

Run the public GitHub release with npm/npx; no GitHub login, repository clone,
Git executable, SSH password, or download from the Memory server is required:

```sh
npx --yes --allow-remote=all https://github.com/NyaRu-Kiss/rutter-direct-memory/releases/download/v0.1.2/rutter-direct-memory-0.1.2.tgz
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
| Service ID | The target instance's Service ID; press Enter to use `default`. |
| Memory user credential | Your own User_Key for that Memory instance. Obtain it from your administrator or create one in the panel's API Key / User_Key management page. Save it when shown. |

Do not enter a model API key, panel login password, or server SSH password.
The installer backs up existing client settings and registers both Hook and
MCP. Restart your AI client and approve its Hook trust prompt if shown.

If `~/.config/rutter-direct-memory/config.json` already exists, a normal install
verifies its server address and credential before reuse. Invalid configuration or rejected credentials trigger reconfiguration. Downloading this
package does not switch an existing local setup to a remote server. To enter
all three values again, run:

```sh
npx --yes --allow-remote=all https://github.com/NyaRu-Kiss/rutter-direct-memory/releases/download/v0.1.2/rutter-direct-memory-0.1.2.tgz --reconfigure
```

The credential must be a complete `sk-mem-` User_Key, never `default`. The installer verifies the authenticated asset catalog before saving credentials or updating Hook/MCP settings. Network or API failures stop installation and preserve the previous configuration. Successful verification confirms connectivity and identity; individual asset permissions are checked when selecting assets.

New conversations ask you to choose Team, Project and Agent. Task is optional.
Every successful install, reinstall, or upgrade enables the local upload switch, including when it was previously disabled. New conversation pages preselect uploading user text and final assistant replies to project L0; uncheck the option to disable upload for that conversation. Tool calls/output, subagents and
reasoning are excluded. Choosing no Memory disables it for that conversation. Changes to the runtime connection or credential and upload authorization failures (401/403) still stop uploading and clear pending messages. Check the configuration and rerun the installer to restore uploading for new conversations; disabled-period history is not automatically backfilled. Reinstalling an already enabled, unchanged configuration preserves pending messages.

The package is downloaded from GitHub. Completing installation, reading
memories, and uploading conversations require a reachable Memory API. Remote API URLs must use HTTPS; HTTP is accepted only on loopback.
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
