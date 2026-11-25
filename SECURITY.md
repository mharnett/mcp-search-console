# Security policy

mcp-google-gsc is a Model Context Protocol (MCP) server that reads Google Search Console. I maintain it on my own. If you find a way to make it write, or a way to make it leak a credential, please tell me privately.

## Reporting a problem

Please keep the details out of public issues, pull requests and discussions.

- If this repo's **Security** tab shows a **Report a vulnerability** button, use it. That report is private.
- If there's no button, open an issue that asks for a private contact and says nothing else about the problem.

In the private report, the useful details are the version, the tool or command, the smallest steps that show the problem and what someone could do with it. Please use made-up account ids, and leave out real tokens and account data.

## In scope

- **A write of any kind.** All four tools are reads, and the server asks for Search Console's read-only scope by default, so there's no write gate and no PAUSED staging. A way to make it change Search Console data is in scope.
- **Credential leakage.** A token, secret or key that ends up in a tool result, an error message or a log, or that gets sent anywhere other than the platform it belongs to.

## What I assume

- **A single-user Mac.** I build this for one person running it on their own Mac, or on another computer only they use. The server runs as you, over stdio, and can read what you can. Anyone able to run programs under your account can use your credentials.
- **Your own platform credentials.** You connect the server to properties you already have access to, and Google decides what that login can do. A leaked token or key works without the server.
