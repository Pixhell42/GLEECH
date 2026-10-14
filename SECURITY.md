# Security

## Reporting

For a vulnerability, use [GitHub private vulnerability reporting](https://github.com/Pixhell42/GLEECH/security/advisories/new)
when enabled. Do not put credentials, exploit details involving private data or
real user files in a public bug report. If private reporting is unavailable,
contact the maintainer through the [GitHub profile](https://github.com/Pixhell42)
to arrange a private channel before sharing sensitive details.

Include the GLEECH version/platform, affected component, minimal safe reproduction
and expected impact. Native Bug Report/Feature Request forms create ordinary
issues and are not private vulnerability-reporting channels. Do not submit
secrets or private artwork in those forms.

## Scope and handling

GLEECH is beta software with no published long-term support schedule. Security
fixes target the current maintained release/development baseline. Older/unknown
versions should not be assumed patched. The maintainer will investigate reports;
no fixed response-time commitment is promised.

Electron isolation, bounded file formats, public-HTTPS shader fetching, shader
subset validation, protected feedback credentials and MCP modes/folder grants
reduce exposure. They are not a guarantee that arbitrary content or imported
GPU code is harmless. Keep drivers and the app current; use grants appropriate
to the task. HTTP/remote MCP is not implemented.

## Development and release checks

Scan the intended public snapshot/history with a redacting secrets scanner and
review personal paths, private content and archives separately. A public GitHub
App Client ID is configuration, not a client secret. Never embed PATs, private
keys, signing credentials or live device/access tokens. Rotate genuinely exposed
credentials; deleting a file or starting fresh history does not revoke them.

Run `pnpm audit --prod --json` and review all-dependency advisories separately.
Use disposable hosted PR runners with read-only tokens. Keep signing/publication
jobs isolated from untrusted changes and maintain a verified artifact/source link.
Unpatched build-tool advisories must be reviewed before release; no automatic
dependency "fix" should replace validation.
