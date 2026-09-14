/** Wave 4 alert sink. Production implementation (W3) writes wave 3's `notifications` table. */
export interface NotifyInput {
  userIds: string[];
  /**
   * A subset of `NotificationKindSchema` — the kinds raised by a lane rather than by a user
   * action. Append-only: wave 5 adds `learning` (V2 assignments/refresh) and `gap` (V3), both
   * already accepted by `notifications.kind` since `0038_wave5_permissions_settings.js`.
   */
  kind: 'feedback' | 'source' | 'system' | 'learning' | 'gap';
  title: string;
  body?: string;
  href?: string;
  entityType?: string;
  entityId?: string;
}
export interface Notifier {
  notify(input: NotifyInput): Promise<void>;
}
