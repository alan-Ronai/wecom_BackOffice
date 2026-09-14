import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { RichTextToolbar, richTextExtensions } from './RichText.js';
import {
  useSaveSource,
  useSaveSourceDraft,
  useSourceDocument,
  useSourceDraft,
  useUploadAsset,
} from '../../api/hooks/sourcedocs.js';
import { ApiError } from '../../api/unwrap.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';

const AUTOSAVE_MS = 3000;

/**
 * TipTap editor for the source document.
 *
 * Everything it produces is re-sanitized server-side on `PUT /documents/:id/source`, so the
 * editor's own allowlist (the extension set below) is a usability boundary, not the security one.
 * Concurrency is optimistic: the last `etag` is sent as `If-Match`, and a 412 opens the same
 * "reload / keep editing" choice the step editor offers — W6 folds the two dialogs into one.
 */
export function SourceEditor({ documentId, onSaved }: { documentId: string; onSaved?: (v: number) => void }) {
  const doc = useSourceDocument(documentId);
  const draft = useSourceDraft(documentId);
  const save = useSaveSource(documentId);
  const saveDraft = useSaveSourceDraft(documentId);
  const upload = useUploadAsset();
  const modal = useModal();
  const toast = useToast();
  const etag = useRef<string | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<number | null>(null);

  const editor = useEditor({
    // Shared with the compact body editor (`RichText`), so the two surfaces cannot drift.
    extensions: richTextExtensions(),
    editorProps: {
      attributes: {
        dir: 'rtl',
        class: 'prose source-html',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'מסמך המקור',
      },
      handlePaste: (_view, event) => handleFiles(event.clipboardData?.files),
      handleDrop: (_view, event) => handleFiles(event.dataTransfer?.files),
    },
    onUpdate: ({ editor: ed }) => {
      setDirty(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        saveDraft.mutate(ed.getHTML());
      }, AUTOSAVE_MS);
    },
  });

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  function handleFiles(files?: FileList | null): boolean {
    if (!files?.length || !editor) return false;
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return false;
    void (async () => {
      for (const f of images) {
        try {
          const a = await upload.mutateAsync(f);
          editor.chain().focus().setImage({ src: a.url, alt: f.name }).run();
        } catch (err) {
          toast(err instanceof Error ? err.message : 'העלאת התמונה נכשלה', 'warn');
        }
      }
    })();
    return true;
  }

  // Load: an autosaved draft newer than the saved version wins, and the user is told.
  useEffect(() => {
    if (!editor || doc.isPending || draft.isPending) return;
    etag.current = doc.data?.etag;
    const serverHtml = doc.data?.html ?? '';
    const d = draft.data;
    if (d && d.html && d.html !== serverHtml && (!doc.data || d.updatedAt > doc.data.updatedAt)) {
      editor.commands.setContent(d.html, { emitUpdate: false });
      setDirty(true);
      toast('נטענה טיוטה שלא נשמרה כגרסה', '');
    } else editor.commands.setContent(serverHtml, { emitUpdate: false });
    // Deliberately keyed on "both queries have settled", not on the data: re-running on every
    // `doc.data` identity change would throw away what the user is typing.
  }, [editor, doc.isPending, draft.isPending]);

  const reload = useCallback(async () => {
    const fresh = await doc.refetch();
    etag.current = fresh.data?.etag;
    editor?.commands.setContent(fresh.data?.html ?? '', { emitUpdate: false });
    setDirty(false);
  }, [doc, editor]);

  async function saveVersion() {
    if (!editor) return;
    const label = await modal.prompt('שמירת גרסת מקור', 'תיאור הגרסה', '');
    if (label === null) return;
    try {
      const s = await save.mutateAsync({
        html: editor.getHTML(),
        label: label || undefined,
        etag: etag.current,
      });
      etag.current = s.etag;
      editor.commands.setContent(s.html, { emitUpdate: false }); // server-sanitized
      setDirty(false);
      toast(`נשמרה גרסת מקור ${s.version}`, 'ok');
      onSaved?.(s.version);
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) {
        if (
          await modal.confirm(
            'מסמך המקור השתנה בינתיים',
            'עורך אחר שמר גרסה חדשה. לטעון מחדש? השינויים שלך נשמרים כטיוטה.',
            'טען מחדש',
          )
        )
          await reload();
        return;
      }
      toast(err instanceof Error ? err.message : 'השמירה נכשלה', 'warn');
    }
  }

  if (!editor) return null;
  return (
    <div className="source-editor" dir="rtl">
      <RichTextToolbar editor={editor} onPickImage={handleFiles}>
        <span className="grow" />
        <span className="muted">
          {dirty ? 'שינויים לא שמורים' : doc.data ? `גרסת מקור ${doc.data.version}` : 'מסמך חדש'}
        </span>
        <button type="button" className="btn primary" disabled={save.isPending} onClick={saveVersion}>
          שמור גרסה
        </button>
      </RichTextToolbar>
      <EditorContent editor={editor} />
    </div>
  );
}
