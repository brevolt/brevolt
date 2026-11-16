# Security policy

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting ("Security" tab, "Report a vulnerability") on this repository.

Please include steps to reproduce and the affected version. Never attach real contact data or credentials.

## Handling of secrets and personal data

- No secrets in the repository: configuration comes from environment variables or `*_FILE` secrets.
- No real personal data in tests, fixtures or logs.
