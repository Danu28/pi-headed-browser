# Security Policy

## Reporting a vulnerability

Please report security issues privately to the repository owner via GitHub Security Advisories or by opening a private issue.

Do not include secrets, tokens, or credentials in public issues.

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅        |

## Scope

This extension launches a headed Chromium via Playwright with a persistent profile directory. It can navigate to arbitrary URLs and run `browser_eval` JavaScript in the page context. Treat eval input as untrusted and avoid passing secrets into it.
