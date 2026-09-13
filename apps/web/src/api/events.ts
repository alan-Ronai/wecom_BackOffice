import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { EVENTS, EventSchema, type Event } from '@wecom/shared';
import { keys } from './keys.js';

/**
 * Live updates: one EventSource on `/events`, every payload validated with the shared
 * `EventSchema`, then translated into query invalidations. Names come from `EVENTS` only.
 */
export function useEvents(): { connected: boolean; last?: Event } {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [last, setLast] = useState<Event>();

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/events', { withCredentials: true });
    const onOpen = () => setConnected(true);
    const onError = () => setConnected(false);
    es.addEventListener('open', onOpen);
    es.addEventListener('error', onError);

    const handle = (raw: MessageEvent) => {
      let json: unknown;
      try {
        json = JSON.parse(raw.data as string);
      } catch {
        return;
      }
      const parsed = EventSchema.safeParse(json);
      if (!parsed.success) return;
      const ev = parsed.data as Event;
      setLast(ev);
      if (ev.name.startsWith('document.')) {
        const id = (ev.payload as { documentId: string }).documentId;
        void qc.invalidateQueries({ queryKey: keys.doc(id) });
        void qc.invalidateQueries({ queryKey: ['documents'] });
        void qc.invalidateQueries({ queryKey: keys.versions(id) });
        void qc.invalidateQueries({ queryKey: keys.trash });
      } else if (ev.name.startsWith('suggestion.')) {
        void qc.invalidateQueries({ queryKey: ['suggestions'] });
        void qc.invalidateQueries({ queryKey: keys.sources });
      } else if (ev.name.startsWith('sync.')) {
        void qc.invalidateQueries({ queryKey: keys.sources });
      } else if (ev.name === 'system.status' || ev.name === 'job.failed') {
        void qc.invalidateQueries({ queryKey: keys.admin.system });
        void qc.invalidateQueries({ queryKey: keys.health });
      }
    };

    for (const name of EVENTS) es.addEventListener(name, handle as EventListener);
    return () => es.close();
  }, [qc]);

  return { connected, last };
}
