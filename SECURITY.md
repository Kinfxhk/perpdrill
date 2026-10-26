# Security

perpdrill M0 is a local educational scaffold. It does not take orders,
hold accounts, or connect to a venue. The optional server stub prints a
version string and, only with `listen`, accepts connections on
`127.0.0.1`.

## Reporting

Use GitHub private vulnerability reporting:

https://github.com/Kinfxhk/perpdrill/security/advisories/new

Please do not file a public issue for an unfixed vulnerability.

## In scope

- The web scaffold serving unexpected third-party content (the page
  policy is `default-src 'self'`).
- The localhost stub listening beyond loopback by default.
- Secrets committed to the tree.

## Out of scope

- Trading losses, prop-evaluation outcomes, or disagreement with a firm's
  official numbers. M0 does not compute those.
- Hosting a modified copy without offering source. That is an AGPL
  obligation, not a security bug.

There is no bug bounty.
