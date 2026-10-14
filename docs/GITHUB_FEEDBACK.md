# Native GitHub feedback

Bug Report and Feature Request submit GitHub issues from native forms using the
user's GitHub account. Device authorization opens GitHub in a browser; issue
submission remains in GLEECH. There is no account-free hosted relay.

## User privacy and behavior

Version, beta marker, OS, Electron and Chromium are always added to Environment.
The optional bug-only stack attachment contains settings and seed, not images,
shader code, painted strokes or file paths. Feature requests omit that checkbox.
Review descriptions before submitting: ordinary issues are public once the
destination repository is public. Use the private channel in SECURITY.md for
vulnerabilities, not these forms.

Switching tabs retains drafts/sign-in in the current session. Drafts are not
persisted across restarts. Sign out clears saved credentials. Tokens use the
OS protected-storage path and are not written to project/preset files or copied
into issue bodies. Request IDs and receipt checks reduce duplicate submissions;
an uncertain response is reconciled rather than blindly reposted.

## Maintainer setup

Configure `apps/desktop/src/shared/feedback-github.json` with the GitHub App's
public Client ID. This is safe public configuration, not a client secret/PAT.
The current destination is `Pixhell42/GLEECH` in shared support configuration.

Register/install a GitHub App with Device Flow, user token expiration and Issues
read/write for the destination repository. No webhook, embedded private key or
client secret is required for this desktop device flow. Keep unrelated
Contents/Actions/Administration access out of the reporting app. Enable Issues
and verify installation scope on the actual public destination before release.

If the release uses a new GitHub repository, recheck app installation and issue
access; retaining a repository name alone does not transfer app permissions.
For an app installed on a personal account, open GitHub Settings > Applications

> Installed GitHub Apps, choose Configure next to the reporting app, and add the
> actual destination under Repository access. Save the selection and verify Issues
> read/write access before testing a real report. See GitHub's
> [installed-app instructions](https://docs.github.com/en/apps/using-github-apps/reviewing-and-modifying-installed-github-apps).
> Configure forks to their own reporting destination and GitHub App.

GitHub documents [app registration](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
and [device authorization](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).

## Verification

`pnpm test:github-feedback` mocks device flow, validation, submission, retry,
drafts/sign-in and failures; it creates no live issues. Maintainer hands-on
testing separately verifies real sign-in/submission. Rebuild after public Client
ID/destination changes. A build with no Client ID permits editing drafts but
disables sign-in/submission.
