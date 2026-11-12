# Rutter Direct Memory

Install the Memory Hook and MCP for Codex CLI and Claude Code on Windows,
Linux, or macOS. Requires Node.js 22+ and an interactive terminal.

Run the public GitHub release with npm/npx; no GitHub login, repository clone,
Git executable, SSH password, or download from the Memory server is required:

```sh
npx --yes https://github.com/NyaRu-Kiss/rutter-direct-memory/releases/download/v0.1.0/rutter-direct-memory-0.1.0.tgz
```

On Windows PowerShell, use `npx.cmd` if script execution policy blocks `npx.ps1`.
MCP dependencies are bundled. The package has no install lifecycle scripts.
The package is distributed through GitHub Releases; it is not currently
published to the npm registry under the bare name `rutter-direct-memory`.

The installer asks for the Memory API URL (including `/v3`), Service ID, and
your personal Memory user credential. Do not enter a model API key or server
SSH password. It backs up existing client settings and registers both Hook
and MCP. Restart your AI client and approve its Hook trust prompt if shown.

New conversations ask you to choose Team, Project and Agent. Task is optional.
To upload the conversation, explicitly check the option to upload user text
and final assistant replies to project L0. Tool calls/output, subagents and
reasoning are excluded. Choosing no Memory disables it for that conversation.

Downloading this installer does not require access to the Memory server.
Reading memories and uploading conversations still require a reachable Memory
API. Remote API URLs must use HTTPS; HTTP is accepted only on loopback.
A public HTTP domain alone does not satisfy this requirement.

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
