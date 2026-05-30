# Security Policy

## Supported Versions

Trellis follows semantic versioning. Security fixes are backported only to the latest minor release of the current major version.

| Version | Supported          |
| ------- | ------------------ |
| 3.x     | :white_check_mark: |
| < 3.0   | :x:                |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email `tbrew@turtle.tech` with:

- A description of the issue and its potential impact
- Steps to reproduce, or a proof-of-concept
- Any suggested mitigation, if you have one
- Your name and affiliation, if you want acknowledgement in the release notes

You will receive an acknowledgement within 72 hours. We aim to triage within one week and ship a fix within 30 days for high-severity issues. We will coordinate a disclosure timeline with you before publishing details.

## Scope

In scope:

- The `trellis` npm package and CLI
- The Trellis kernel, VCS, CMS, server, and sync modules
- The MCP server and decision-trace auto-capture middleware

Out of scope (report to the relevant project):

- Vulnerabilities in third-party dependencies (report upstream, then notify us)
- Issues in the hosted Trellis Cloud platform (separate disclosure process)
- Social engineering, physical access, or denial-of-service against test infrastructure

## Cryptographic Identity

Trellis uses Ed25519 signatures on causal ops. Reports about signature forgery, key derivation, or governance bypass receive priority handling.
