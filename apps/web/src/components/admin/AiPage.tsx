import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCan } from '../../api/hooks/me.js';
import { Empty } from '../ui/index.js';
import { AdminTabs } from './ai/Tabs.js';
import { PromptsTab } from './ai/PromptsTab.js';
import { ModelsTab } from './ai/ModelsTab.js';

// The three heavier tabs are split: an admin opening `/admin/ai` to edit the brief should not
// download the transcript browser to do it.
const EvalTab = lazy(() => import('./ai/EvalTab.js').then((m) => ({ default: m.EvalTab })));
const SuggestionAnalyticsTab = lazy(() =>
  import('./ai/SuggestionAnalyticsTab.js').then((m) => ({ default: m.SuggestionAnalyticsTab })),
);
const ConversationsTab = lazy(() =>
  import('./ai/ConversationsTab.js').then((m) => ({ default: m.ConversationsTab })),
);

export const TAB_LABELS = [
  { id: 'prompts', label: 'הנחיות' },
  { id: 'models', label: 'מודלים' },
  { id: 'eval', label: 'הערכה' },
  { id: 'analytics', label: 'אנליטיקת הצעות' },
  { id: 'conversations', label: 'שיחות' },
];

/**
 * `/admin/ai` — the whole AI console behind `ai.manage` (spec §5 "Admin AI page").
 *
 * The gate is on the page, not on each tab: every route these five tabs call requires
 * `ai.manage`, so a partial view would be five empty states rather than a screen.
 *
 * The tab lives in the URL, so an admin can link a colleague at אנליטיקת הצעות rather than at
 * "the AI page, third tab".
 */
export function AiPage() {
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'prompts';
  if (!can('ai.manage'))
    return (
      <div className="page">
        <Empty title="אין הרשאה לניהול הבינה המלאכותית">המסך מיועד למנהלי מערכת.</Empty>
      </div>
    );
  return (
    <div className="page ai-admin">
      <div className="lib-head">
        <h1>בינה מלאכותית</h1>
      </div>
      <AdminTabs
        tabs={TAB_LABELS}
        value={tab}
        onChange={(id) => {
          const next = new URLSearchParams(sp);
          next.set('tab', id);
          setSp(next, { replace: true });
        }}
        controls="ai-tabpanel"
      />
      <div id="ai-tabpanel" role="tabpanel">
        <Suspense fallback={<p className="muted">טוען…</p>}>
          {tab === 'prompts' && <PromptsTab />}
          {tab === 'models' && <ModelsTab />}
          {tab === 'eval' && <EvalTab />}
          {tab === 'analytics' && <SuggestionAnalyticsTab />}
          {tab === 'conversations' && <ConversationsTab />}
        </Suspense>
      </div>
    </div>
  );
}
