<?php
/**
 * Plugin Name: KB Sync
 * Description: Notifies the wecom knowledge platform when a post is saved or deleted (HMAC-signed webhook).
 * Version: 1.1.0
 */
if (!defined('ABSPATH')) exit;

define('KB_SYNC_OPTION', 'kb_sync_settings');

function kb_sync_settings() {
  $s = get_option(KB_SYNC_OPTION, []);
  return ['url' => $s['url'] ?? '', 'secret' => $s['secret'] ?? '', 'types' => $s['types'] ?? 'post,page'];
}

function kb_sync_send($event, $post_id, $post) {
  $s = kb_sync_settings();
  if (!$s['url'] || !$s['secret']) return;
  $types = array_map('trim', explode(',', $s['types']));
  if (!in_array($post->post_type, $types, true)) return;
  if (wp_is_post_revision($post_id) || wp_is_post_autosave($post_id)) return;
  $rest_type = $post->post_type === 'post' ? 'posts' : ($post->post_type === 'page' ? 'pages' : $post->post_type);
  // sent_at is part of the signed body: the KB rejects a replayed request whose
  // timestamp is more than five minutes from its own clock. Keep the server's time in sync.
  $body = wp_json_encode(['event' => $event, 'post_type' => $rest_type, 'post_id' => (int) $post_id, 'modified_gmt' => str_replace(' ', 'T', $post->post_modified_gmt), 'sent_at' => gmdate('Y-m-d\\TH:i:s\\Z')]);
  $sig = hash_hmac('sha256', $body, $s['secret']);
  wp_remote_post($s['url'], ['timeout' => 5, 'blocking' => false, 'headers' => ['Content-Type' => 'application/json', 'X-KB-Signature' => $sig], 'body' => $body]);
}

add_action('save_post', function ($post_id, $post, $update) { if ($post->post_status === 'publish' || $post->post_status === 'draft') kb_sync_send('save_post', $post_id, $post); }, 10, 3);
add_action('before_delete_post', function ($post_id, $post) { kb_sync_send('delete_post', $post_id, $post); }, 10, 2);

add_action('admin_menu', function () {
  add_options_page('KB Sync', 'KB Sync', 'manage_options', 'kb-sync', function () {
    if (isset($_POST['kb_sync']) && check_admin_referer('kb_sync_save')) {
      update_option(KB_SYNC_OPTION, ['url' => esc_url_raw($_POST['kb_sync']['url']), 'secret' => sanitize_text_field($_POST['kb_sync']['secret']), 'types' => sanitize_text_field($_POST['kb_sync']['types'])]);
      echo '<div class="updated"><p>Saved.</p></div>';
    }
    $s = kb_sync_settings();
    echo '<div class="wrap"><h1>KB Sync</h1><form method="post">'; wp_nonce_field('kb_sync_save');
    echo '<table class="form-table"><tr><th>Webhook URL</th><td><input name="kb_sync[url]" class="regular-text" value="' . esc_attr($s['url']) . '" placeholder="https://kb.lan/api/v1/connectors/&lt;id&gt;/webhook"></td></tr>';
    echo '<tr><th>Shared secret</th><td><input name="kb_sync[secret]" class="regular-text" value="' . esc_attr($s['secret']) . '"></td></tr>';
    echo '<tr><th>Post types</th><td><input name="kb_sync[types]" class="regular-text" value="' . esc_attr($s['types']) . '"></td></tr></table>';
    submit_button('Save'); echo '</form></div>';
  });
});
