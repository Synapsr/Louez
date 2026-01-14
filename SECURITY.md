# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take security seriously at Louez. If you discover a security vulnerability, please report it responsibly.

### How to Report

**Email**: [security@louez.io](mailto:security@louez.io)

Please include the following information in your report:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

### What to Expect

1. **Acknowledgment**: We will acknowledge receipt of your report within 48 hours
2. **Investigation**: We will investigate and validate the vulnerability within 7 days
3. **Resolution**: We aim to patch critical vulnerabilities within 14 days
4. **Disclosure**: We will coordinate with you on public disclosure timing

### Security Best Practices for Deployment

When deploying Louez, ensure you follow these security practices:

- **Environment Variables**: Never commit `.env` files. Use `.env.example` as a template
- **AUTH_SECRET**: Generate a strong, random secret (minimum 32 characters)
- **Database**: Use strong passwords and restrict network access
- **HTTPS**: Always use HTTPS in production
- **Updates**: Keep dependencies updated regularly

### Scope

The following are in scope for security reports:

- Authentication/authorization bypasses
- SQL injection
- Cross-site scripting (XSS)
- Cross-site request forgery (CSRF)
- Remote code execution
- Sensitive data exposure
- Server-side request forgery (SSRF)

### Out of Scope

- Denial of service attacks
- Social engineering
- Physical security
- Issues in third-party dependencies (report to the respective maintainers)

## Security Updates

Security updates will be released as patch versions and announced via:

- GitHub Security Advisories
- Release notes

Thank you for helping keep Louez and its users safe!
