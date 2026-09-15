# Connectors

How an external system talks to the Knowledge Platform, and what a connector plugin has to send.

## WordPress webhook

`POST /api/v1/connectors/:id/webhook` is public and unauthenticated — there is no session, so
everything the route trusts has to come out of the request itself. A WordPress site posts one
delivery per `save_post` / `before_delete_post`.

### Body

```json
{
  "event": "save_post",
  "post_type": "post",
  "post_id": 41,
  "modified_gmt": "2026-09-15T08:30:00",
  "sent_at": "2026-09-15T08:30:01+00:00",
  "nonce": "b3f1c2a0e9d84f17"
}
```

### Headers

| Header | Required | Meaning |
| --- | --- | --- |
| `Content-Type` | yes | `application/json` |
| `X-KB-Signature` | yes | `hex(HMAC-SHA256(rawBody, webhookSecret))` — over the exact bytes sent |
| `X-KB-Nonce` | see below | Mirrors the `nonce` field in the body |

### What each guard actually stops

Three separate things have to hold before a delivery is turned into a sync run:

1. **`X-KB-Signature` must verify** over the raw body. This is what proves the request came from
   the site that holds the shared secret. A mismatch is `401 BAD_SIGNATURE`.
2. **`sent_at` must be within five minutes** of the API's clock (`MAX_WEBHOOK_SKEW_MS`). This
   bounds how long a captured request stays useful. Outside the window is also
   `401 BAD_SIGNATURE` — unchanged from before, and deliberately not a distinct code, so probing
   cannot tell a stale capture from a bad secret.
3. **The body must not have been seen before.** The API stores `sha256(rawBody)` per connector in
   `webhook_nonces` and answers `409 REPLAY` to the second arrival of identical bytes. Rows are
   purged an hour after they are written, by the nightly `trash.purge` job.

Guard 3 is the one added for the pilot. Guards 1 and 2 together left a five-minute window in
which anyone who could observe a delivery could post it again, unchanged, as many times as they
liked — each one a real sync run.

### Why the replay key is the body and not the header

`X-KB-Nonce` is outside the HMAC. An attacker replaying a captured body can put whatever they
like in a header, so a key derived from the header would protect nothing. The signed bytes are
the only thing they cannot vary without invalidating the signature, which is why the key is
`sha256(rawBody)`.

That makes the **`nonce` field inside the body** the part that matters, and the header merely its
visible mirror. Without a body nonce, two saves of the same post inside the same second produce
byte-identical bodies (`sent_at` has second precision) and the second is refused as a replay.
A plugin must therefore generate a fresh random `nonce` per delivery, put it in the JSON body
*before* signing, and copy it into `X-KB-Nonce`.

It is part of the request contract: `WebhookBodySchema`
(`packages/connectors/src/wordpress/webhook.ts`) declares `nonce` as a non-empty string, so a
plugin that sends it as a number fails validation rather than having the field quietly dropped.
It is `optional()` in the schema for exactly one reason — the release of grace below has to be a
real one for sites still running a plugin that predates the field. Anything written against this
document sends it.

### Upgrading an old plugin

`WEBHOOK_REQUIRE_NONCE` (in `deploy/.env.example`, default `false`) controls what happens when
`X-KB-Nonce` is absent:

- **`false`** — the delivery is accepted and the API logs a deprecation warning naming the
  connector. Replay protection is still in force; only the same-second false positive above is
  possible. Leave it here for one release.
- **`true`** — a delivery with no `X-KB-Nonce` is `400 MISSING_NONCE`. Set this once every site
  runs a plugin new enough to send it, so a forgotten site fails loudly instead of silently
  losing the occasional same-second edit.

The plugin itself lives in `deploy/wp-plugin/`; its README documents the signing side.
