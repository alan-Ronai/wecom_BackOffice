# TLS certificate

Place the certificate issued by the company's internal CA here:

- `cert.pem` — server certificate (plus intermediate chain, server first)
- `key.pem`  — private key, mode 600

Request a certificate for the DNS name in `PUBLIC_URL` (default `kb.wecom.local`).
For a lab install without a CA: `openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=kb.wecom.local"`.
Both files are ignored by git.
