# Security policy

Tessera keeps people's notes, and the server holds whole workspaces. We take security reports
seriously and answer every one.

## Reporting a vulnerability

**Please don't open a public issue, discussion or pull request for security problems.**

Report privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability** ([private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).
Only the maintainers can see the report, and we can work on a fix and an advisory with you there.

If you can't use GitHub, email **femboypuppy@tutanota.de** with "Security" in the subject.

A good report includes:

- what an attacker can do, and what they need first (an account, a role, a malicious file or plugin);
- the affected part (web app, desktop app, server, a plugin, an importer) and version or commit;
- steps to reproduce, ideally a minimal proof of concept;
- any idea you have for a fix.

## What happens next

| When | What |
| --- | --- |
| Within 3 working days | We confirm we received your report. |
| Within 10 working days | We tell you whether we can reproduce it and how severe we think it is. |
| When a fix is ready | We release it, publish a GitHub security advisory (with a CVE when it applies) and credit you, unless you'd rather stay anonymous. |

We ask that you give us time to release a fix before telling anyone else. We aim to fix critical
issues within 30 days and will keep you updated if it takes longer.

## Supported versions

| Version | Security fixes |
| --- | --- |
| Latest release | ✅ |
| `main` | ✅ |
| Older releases | ❌ Upgrade to the latest release |

Self-hosters: watch the repository's releases (Watch → Custom → Releases) to hear about fixes.

## Scope

In scope, for example:

- the server (`apps/server`): authentication, sessions and tokens, roles and permissions (a viewer
  must never be able to write), invites, asset uploads, path handling, rate limits;
- the plugin sandbox: a plugin reaching data or APIs it wasn't granted, or escaping its iframe;
- importers and the markdown codec: script injection or path traversal from imported files (zip slip);
- the editor and embeds: rendering unsanitized HTML, unsafe links or iframes;
- the desktop app: file system access beyond the workspace folder, the updater, deep links;
- the build and release pipeline: workflows, published binaries and container images.

Out of scope: vulnerabilities in third-party dependencies with no demonstrated impact on Tessera
(report those upstream; Dependabot tracks them here), self-XSS, missing security headers without a
demonstrated attack, denial of service through excessive traffic, and reports from automated
scanners without a working proof of concept.

## Safe harbor

We won't take legal action against research done in good faith that follows this policy: test
only on your own installation or accounts you own, don't access or change other people's data,
don't degrade the service for others, and give us reasonable time to fix the issue before
disclosure.

## How we keep Tessera secure

- Untrusted input is validated with zod at every boundary, and HTML is sanitized with DOMPurify
  before it's rendered (SPEC.md section 11).
- Plugins run in sandboxed iframes with a strict CSP and permission checks on every call.
- CodeQL scans every pull request; Dependabot keeps dependencies current; `pnpm audit` runs in CI.
- Every GitHub Action is pinned to a commit, and workflows run with the least permissions they need.
