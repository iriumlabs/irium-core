# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| Latest  | Yes       |
| Older   | No        |

Only the latest release of Irium Core receives security updates. Always update to the latest version.

## Reporting a Vulnerability

If you discover a security vulnerability in Irium Core, please do NOT open a public GitHub issue.

Instead, report it privately by emailing the maintainers or opening a [GitHub Security Advisory](https://github.com/iriumlabs/irium-core/security/advisories/new).

Please include:

- A description of the vulnerability
- Steps to reproduce it
- The potential impact
- Your suggested fix if you have one

You will receive a response within 72 hours. If the vulnerability is confirmed, a fix will be prioritized and a patched release will be issued as soon as possible.

## Scope

This security policy covers:

- The Irium Core desktop application (Tauri frontend + Rust backend)
- The bundled iriumd, irium-wallet, and irium-miner binaries
- The auto-updater pipeline

## Out of Scope

- The Irium blockchain protocol itself (report those to the [irium repo](https://github.com/iriumlabs/irium))
- Third-party dependencies (report those to the respective upstream projects)
