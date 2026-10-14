# Local MCP setup

GLEECH includes a local stdio MCP server with 62 tools, nine resources and three
resource templates. It controls the open desktop instance using the normal
editing/rendering engine. Windows named-pipe transport is implemented; HTTP,
remote pairing and hosted/cloud access are deferred.

## Connect

1. Run the installed/unpacked GLEECH build you intend to use. Open an image/project.
2. Open hamburger → MCP · AI control. Choose Observe, Edit or Full Control.
3. Select a client profile and use Copy Configuration, or Connection Help's
   step-by-step instructions and Copy Prompt.
4. Merge the GLEECH entry into your client's settings without replacing other
   servers. Restart/reconnect that client. Keep GLEECH open.
5. Close the MCP dialog, then ask the agent to inspect the project before editing.

Copy from the actual executable you will run: installed and development paths
differ. A packaged launcher uses GLEECH's embedded runtime and needs no external
Node installation. Configuration contains a connection-file path, not a live
token. The token remains in per-instance local data. Restarting/disabling GLEECH
requires reconnection. MCP starts Off at each app launch.

## Profiles

The app supplies Codex, ChatGPT Desktop, Cursor, Claude Desktop, Claude Code,
Hermes, Grok Build and Other (JSON). Select the profile to see its current
destination, format and instructions. Codex/ChatGPT Desktop exports TOML for the
local Codex host; the ChatGPT profile does not enable hosted ChatGPT or Dots.
Cursor/Claude/Other use JSON, Hermes uses YAML and Grok Build uses TOML.
GLEECH only copies configuration; it does not modify client settings or sign
into the selected AI client. Test Connection checks the bundled launcher through
an MCP SDK client, not the vendor's model/account service. Native Windows profiles
do not promise WSL or remote execution. See client documentation for host changes.

## Permissions

- **Observe:** inspect state/catalogs and render allowed previews.
- **Edit:** reversible project/stack/mask/preset/variation edits.
- **Full Control:** file operations inside separately approved Import, Project
  and Export folders. Clipboard access is a separate permission.

Approvals apply to paths and are rechecked before writes. Mode changes,
cancellation, locked layers and revision mismatches are enforced. An open modal
can block edits until it is closed. Do not grant broad folders unless needed.

Read get_project_state first and use expectedRevision when editing/rendering.
Use instanceId, not titles, to target effects. MCP stack indexes match visible
top-to-bottom order, index 0 at the top; the internal recipe renders in reverse
display order. Read get_effect_parameters for exact keys, units and ranges.
Unlock a layer explicitly before operations that change a protected layer.
Mutation groups support atomic edits and Undo. Long rendering calls can take
up to five minutes; use the timeout values supplied by the profile.

Resources expose the current project/stack/source, effect/preset/snapshot/mask
libraries, a rendered preview and palettes. Templates address a preset recipe,
saved snapshot or per-effect mask. Isolated batch operations preserve the
working project and use the desktop renderer and approved file scope.

## Starter prompts

- “Inspect the active GLEECH project and describe its layers without editing.”
- “Add a subtle chromatic effect, keep the subject recognizable, and show a preview.”
- “Adjust only unlocked layers. Use the returned revision and show the result.”
- “Save a project and export PNG inside the folders I approved in GLEECH.”

## Verify and troubleshoot

Use Test Connection, inspect diagnostics/activity and confirm the active profile
and executable path. Recopy configuration after changing installation paths.
Ensure GLEECH is open, MCP enabled, the dialog closed and the needed mode/folders
approved. A timeout or stale revision should trigger inspection/retry, not an
automatic broadened grant.

`pnpm test:mcp` checks the tool engine and `pnpm test:mcp-clients` checks all eight
configuration/launcher profiles, activity labels, visible edits, previews, Undo,
diagnostics and persistence. These do not certify every vendor UI/login workflow.
