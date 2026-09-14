/** Wave 4 alert sink. Production implementation (W3) writes wave 3's `notifications` table. */
export interface NotifyInput {
  userIds: string[];
  kind: 'feedback' | 'source' | 'system';
  title: string;
  body?: string;
  href?: string;
  entityType?: string;
  entityId?: string;
}
export interface Notifier {
  notify(input: NotifyInput): Promise<void>;
}
