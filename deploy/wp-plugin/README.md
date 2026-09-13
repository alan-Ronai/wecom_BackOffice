# KB Sync (WordPress plugin)

1. Copy this folder to `wp-content/plugins/kb-sync` on the WordPress site and activate **KB Sync** under *Plugins*.
2. Open *Settings → KB Sync* and set the **Webhook URL** to `https://<kb-host>/api/v1/connectors/<connectorId>/webhook` (the connector id is shown in the KB admin after the connector is created).
3. Set **Shared secret** to exactly the `webhookSecret` entered in the KB connector config, and **Post types** to the WordPress post types to sync (default `post,page`).

The plugin posts `{ event, post_type, post_id, modified_gmt }` on `save_post` and `before_delete_post`, signed with `X-KB-Signature: hex(HMAC-SHA256(body, secret))`. The API rejects any request whose signature does not match.
