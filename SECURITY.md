# Security policy

Please use GitHub's private vulnerability reporting or a private security
advisory for vulnerabilities that could expose imported profiles, execute
untrusted content, bypass profile-size limits, or introduce script injection.
Do not include private character data, credentials, tokens, server addresses,
or production logs in a public issue.

The project has no hosted backend. Imported SimC profiles are processed in the
browser and should remain text-only. Security fixes should preserve that local,
no-eval boundary and include a regression test.
