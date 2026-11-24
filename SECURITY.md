# Security Policy

## Supported Versions

Only the latest release of `aem-mcp-server` on npm gets security fixes.
Please upgrade to the newest version before you report an issue.

| Version        | Supported |
| -------------- | --------- |
| latest (1.x)   | ✅        |
| older releases | ❌        |

## Reporting a Vulnerability

**Please do not open public issues, pull requests or discussions for security problems.**

Report vulnerabilities privately through GitHub:

1. Open the [Security tab](https://github.com/easingthemes/aem-mcp-server/security) of this repository.
2. Click **Report a vulnerability**.
3. Include:
   - the affected version and transport (stdio or HTTP),
   - the affected tool(s) or code path,
   - steps to reproduce or a proof of concept,
   - the impact you expect (for example credential exposure, unauthorized AEM writes, path or query injection).

Do not put real AEM hostnames, credentials or customer content in the report.

## What to Expect

- We acknowledge reports within 7 days.
- We aim to confirm the issue and share a fix plan within 30 days.
- We coordinate the disclosure date with you. Default embargo is 90 days, or until a fixed release is out, whichever is sooner.
- After the fix is released, we publish a GitHub Security Advisory and credit you, unless you ask us not to.

## Scope

In scope: code in this repository and the published `aem-mcp-server` npm package.

Out of scope: vulnerabilities in Adobe Experience Manager itself, in your AEM instance configuration, or in third-party dependencies with no exploitable path through this server (report those upstream).
