/** Wave 4 alert sink. Production implementation (W3) writes wave 3's `notifications` table. */
export interface NotifyInput {
  userIds: string[];
  /** A subset of `NotificationKindSchema`: the kinds raised by a background sink rather than a user action. */
  kind: 'feedback' | 'source' | 'system' | 'gap';
  title: string;
  body?: string;
  href?: string;
  entityType?: string;
  entityId?: string;
}
export interface Notifier {
  notify(input: NotifyInput): Promise<void>;
}
