import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMarkNotificationsRead, useNotifications, type Notification } from '../../api/hooks/collab.js';
import { ago, fmtDate } from '../../lib/format.js';
import { LoadError } from '../ui/index.js';

type Tab = 'all' | Notification['kind'];

const TABS: [Tab, string][] = [
  ['all', 'הכל'],
  ['suggestion', 'הצעות'],
  ['sync', 'סנכרון'],
  ['mention', 'אזכורים'],
  ['review', 'סקירות'],
  ['system', 'מערכת'],
];

// Exhaustive over `NotificationKindSchema`, so widening the contract is a compile error here
// rather than a blank glyph in the bell. `feedback` and `source` arrive with wave 4.
const ICON: Record<Notification['kind'], string> = {
  suggestion: '💡',
  sync: '⟳',
  mention: '@',
  review: '📤',
  publish: '✓',
  system: '🗄',
  feedback: '💬',
  source: '📄',
};

/**
 * Card 6d. Shared by the bell panel and the `/notifications` route, because they are the same
 * list at two sizes — a second implementation for mobile is how the two drift.
 *
 * Opening a notification marks *that one* read rather than the whole list: "סמן הכל כנקרא" is a
 * deliberate act, and silently clearing the unread count because someone glanced at the panel
 * loses the one signal that says there is something here.
 */
export function NotificationList({ onNavigate }: { onNavigate?: () => void }) {
  const go = useNavigate();
  const [tab, setTab] = useState<Tab>('all');
  const list = useNotifications();
  const markRead = useMarkNotificationsRead();

  const all = list.data?.items ?? [];
  const items = tab === 'all' ? all : all.filter((n) => n.kind === tab);
  const unread = list.data?.unread ?? 0;
  const countOf = (t: Tab) => (t === 'all' ? all.length : all.filter((n) => n.kind === t).length);

  const open = (n: Notification) => {
    if (!n.readAt) markRead.mutate({ ids: [n.id] });
    onNavigate?.();
    if (n.href) go(n.href);
  };

  return (
    <div className="notif-list">
      <div className="notif-head">
        <b>התראות {unread ? <span className="chip chip-red">{unread}</span> : null}</b>
        <button
          className="btn xs"
          disabled={!unread || markRead.isPending}
          onClick={() => markRead.mutate({ all: true })}
        >
          סמן הכל כנקרא
        </button>
      </div>

      <div className="tabs" role="tablist" aria-label="סוג התראה">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={'tab' + (tab === k ? ' on' : '')}
            onClick={() => setTab(k)}
          >
            {label}
            <span className="cnt">{countOf(k)}</span>
          </button>
        ))}
      </div>

      {list.isError ? <LoadError what="התראות" error={list.error} /> : null}

      <div className="notif-rows">
        {!items.length && !list.isError ? (
          <div className="empty">
            <b>אין התראות</b>
            {tab === 'all' ? 'כשמשהו יקרה — הצעה חדשה, אזכור, סקירה — זה יופיע כאן' : ''}
          </div>
        ) : null}
        {items.map((n) => (
          <button
            key={n.id}
            className={'notif-row' + (n.readAt ? '' : ' unread')}
            aria-label={`${n.title}${n.readAt ? '' : ' · לא נקרא'}`}
            onClick={() => open(n)}
          >
            <span className="ic" aria-hidden="true">
              {ICON[n.kind]}
            </span>
            <span className="tx">
              <span className="t">{n.title}</span>
              {n.body ? <span className="b">{n.body}</span> : null}
            </span>
            <span className="when" title={fmtDate(n.createdAt)}>
              {ago(Date.parse(n.createdAt))}
            </span>
            {!n.readAt ? <span className="dot" aria-hidden="true" /> : null}
          </button>
        ))}
      </div>

      <div className="notif-foot">
        <span className="muted small">מתעדכן בזמן אמת · SSE</span>
      </div>
    </div>
  );
}
