# TLS certificate

Place the certificate issued by the company's internal CA here:

- `cert.pem` — server certificate (plus intermediate chain, server first)
- `key.pem`  — private key, mode 600

Request a certificate for the DNS name in `PUBLIC_URL` (default `kb.wecom.local`), and make sure
it carries that name in a **subjectAltName** extension, not only in the CN. Chrome, Edge and
Safari have ignored the CN since 2017: a certificate with no SAN is rejected outright
(`ERR_CERT_COMMON_NAME_INVALID`) even when the issuing CA is trusted, which on this deployment
reads as "the internal CA is broken" rather than "the certificate is missing a field".

For a lab install without a CA — substitute your own `PUBLIC_URL` host for `kb.wecom.local` in
**both** places:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout key.pem -out cert.pem \
  -subj "/CN=kb.wecom.local" \
  -addext "subjectAltName=DNS:kb.wecom.local"
```

Check what you got before wondering why the browser refuses it:
`openssl x509 -in cert.pem -noout -text | grep -A1 "Subject Alternative Name"`.

Both files are ignored by git.
