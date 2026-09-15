import { useEffect, useRef, useState } from 'react';
import { useAiSettings, useAiSettingVersions, usePutAiSettings } from '../../../api/hooks/aiAdmin.js';
import { buildSystemPromptPreview } from '../../../lib/promptPreview.js';
import { fmtDate } from '../../../lib/format.js';
import { useToast } from '../../ui/Toast.js';

/**
 * One editable block.
 *
 * The draft is local so a save that is still in flight does not fight the keystrokes after it, and
 * the `dirty` ref is what keeps a refetch from overwriting an edit in progress — the effect
 * re-syncs from the server only while the field is untouched.
 */
function TextBlock({
  label,
  value,
  version,
  onSave,
}: {
  label: string;
  value: string;
  version: number;
  onSave: (t: string) => Promise<void>;
}) {
  const [text, setText] = useState(value);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setText(value);
  }, [value]);
  return (
    <section className="settings-card">
      <h2>
        {label} <span className="chip">גרסה {version}</span>
      </h2>
      <textarea
        className="ai-textarea"
        dir="rtl"
        rows={8}
        value={text}
        aria-label={label}
        onChange={(e) => {
          dirty.current = true;
          setText(e.target.value);
        }}
      />
      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={text === value}
          onClick={() =>
            void onSave(text).then(() => {
              dirty.current = false;
            })
          }
        >
          שמור
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={text === value}
          onClick={() => {
            dirty.current = false;
            setText(value);
          }}
        >
          בטל
        </button>
      </div>
    </section>
  );
}

const VERSION_LABEL: Record<string, string> = {
  'ai.brief': 'תיאור החברה',
  'ai.style': 'כללי סגנון',
  'ai.models': 'מודלים',
  'ai.limits': 'מגבלות',
};

/**
 * הנחיות — the two admin-editable prompt blocks (spec §1.7), their version history, and a preview
 * of where they land in the assembled system prompt.
 *
 * The version chip is not decoration: the prompt version is stamped on every suggestion and every
 * eval run, so "גרסה 3" here is what an admin matches against a row in אנליטיקת הצעות.
 */
export function PromptsTab() {
  const s = useAiSettings();
  const put = usePutAiSettings();
  const [showHistory, setShowHistory] = useState(false);
  const versions = useAiSettingVersions(showHistory);
  const toast = useToast();
  const [showPreview, setShowPreview] = useState(false);
  if (!s.data) return <p className="muted">טוען…</p>;
  const save = (key: 'brief' | 'style') => async (text: string) => {
    try {
      await put.mutateAsync({ [key]: { text } });
      toast('ההנחיות נשמרו', 'ok');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'השמירה נכשלה', 'warn');
    }
  };
  return (
    <div className="ai-prompts">
      <TextBlock
        label="תיאור החברה"
        value={s.data.brief.text}
        version={s.data.brief.version}
        onSave={save('brief')}
      />
      <TextBlock
        label="כללי סגנון"
        value={s.data.style.text}
        version={s.data.style.version}
        onSave={save('style')}
      />
      <div className="row">
        <button type="button" className="btn ghost" onClick={() => setShowPreview((v) => !v)}>
          תצוגת system prompt
        </button>
        <button type="button" className="btn ghost" onClick={() => setShowHistory((v) => !v)}>
          היסטוריית גרסאות
        </button>
      </div>
      {showPreview ? (
        <pre className="ai-preview" dir="rtl">
          {buildSystemPromptPreview(s.data)}
        </pre>
      ) : null}
      {showHistory ? (
        <table className="table" aria-label="היסטוריית גרסאות">
          <thead>
            <tr>
              <th>מפתח</th>
              <th>גרסה</th>
              <th>מי</th>
              <th>מתי</th>
              <th>טקסט</th>
            </tr>
          </thead>
          <tbody>
            {(versions.data ?? []).map((v) => (
              <tr key={v.key + v.version}>
                <td>{VERSION_LABEL[v.key] ?? v.key}</td>
                <td>{v.version}</td>
                <td>{v.updatedByName ?? v.updatedBy ?? '—'}</td>
                <td>{fmtDate(v.updatedAt)}</td>
                <td className="ai-ver-text">{String((v.value as { text?: string })?.text ?? '')}</td>
              </tr>
            ))}
            {!versions.data?.length ? (
              <tr>
                <td colSpan={5} className="muted">
                  אין עדיין היסטוריה.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
