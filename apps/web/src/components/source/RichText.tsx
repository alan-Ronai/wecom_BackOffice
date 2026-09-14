/**
 * The shared TipTap surface: one extension set, one toolbar, two mounts.
 *
 * §5.3 asks for "the same TipTap component in a compact mode" for text-kind (T/I) items, and the
 * editor was giving them a raw-HTML `<textarea>` instead — a different product for two of the
 * seven PRD types, and one that interacts badly with the server, which sanitizes `bodyHtml`
 * against the §5.1 allowlist and strips whatever the allowlist does not cover with no editor-side
 * feedback about what went.
 *
 * `compact` drops the table and image controls: an item body is a paragraph or two of script, and
 * an image there would need the asset pipeline the source document has and the body does not.
 */
import { useEffect } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import type { ReactNode } from 'react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';

/** The allowlist the two surfaces share. The server re-sanitizes either way (§5.1). */
export const richTextExtensions = (compact = false) => [
  // StarterKit v3 already ships link and underline; they are disabled here and registered
  // explicitly below so their options stay visible at the call site.
  StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, link: false, underline: false }),
  Underline,
  Link.configure({
    openOnClick: false,
    autolink: true,
    protocols: ['http', 'https'],
    HTMLAttributes: { rel: 'noopener' },
  }),
  ...(compact
    ? []
    : [
        Image.configure({ allowBase64: false }),
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
      ]),
  TextAlign.configure({ types: ['heading', 'paragraph'], defaultAlignment: 'right' }),
];

/**
 * Module scope on purpose. Declared inside `SourceEditor`'s render it was a new component *type*
 * on every keystroke, so React unmounted and remounted all ~18 toolbar buttons instead of
 * updating them — which throws focus to `<body>` for anyone driving the only keyboard surface the
 * editor has, and defeats reconciliation on the one component that re-renders per keypress.
 */
export function ToolbarButton({ on, label, run }: { on?: boolean; label: string; run: () => void }) {
  return (
    <button type="button" className={'tb' + (on ? ' on' : '')} aria-pressed={!!on} onClick={run}>
      {label}
    </button>
  );
}
ToolbarButton.displayName = 'ToolbarButton';

/** The formatting controls, shared by the source editor and the compact body editor. */
export function RichTextToolbar({
  editor,
  compact = false,
  onPickImage,
  children,
}: {
  editor: Editor;
  compact?: boolean;
  /** Only meaningful outside `compact`, where the asset pipeline exists. */
  onPickImage?: (files: FileList | null) => void;
  /** Trailing controls (status text, "שמור גרסה") the owning surface adds. */
  children?: ReactNode;
}) {
  const modal = useModal();
  const toast = useToast();
  const B = ToolbarButton;
  return (
    <div className="toolbar" role="toolbar" aria-label="עיצוב">
      <B label="מודגש" on={editor.isActive('bold')} run={() => editor.chain().focus().toggleBold().run()} />
      <B
        label="נטוי"
        on={editor.isActive('italic')}
        run={() => editor.chain().focus().toggleItalic().run()}
      />
      <B
        label="קו תחתון"
        on={editor.isActive('underline')}
        run={() => editor.chain().focus().toggleUnderline().run()}
      />
      <B
        label="קו חוצה"
        on={editor.isActive('strike')}
        run={() => editor.chain().focus().toggleStrike().run()}
      />
      <span className="vsep" />
      {([1, 2, 3, 4] as const).map((l) => (
        <B
          key={l}
          label={`כותרת ${l}`}
          on={editor.isActive('heading', { level: l })}
          run={() => editor.chain().focus().toggleHeading({ level: l }).run()}
        />
      ))}
      <span className="vsep" />
      <B
        label="תבליטים"
        on={editor.isActive('bulletList')}
        run={() => editor.chain().focus().toggleBulletList().run()}
      />
      <B
        label="מספור"
        on={editor.isActive('orderedList')}
        run={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <B
        label="ציטוט"
        on={editor.isActive('blockquote')}
        run={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <B
        label="קוד"
        on={editor.isActive('codeBlock')}
        run={() => editor.chain().focus().toggleCodeBlock().run()}
      />
      {compact ? null : (
        <>
          <span className="vsep" />
          <B
            label="טבלה"
            run={() => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()}
          />
          <B label="הוסף שורה" run={() => editor.chain().focus().addRowAfter().run()} />
          <B label="הוסף עמודה" run={() => editor.chain().focus().addColumnAfter().run()} />
          <B label="מחק טבלה" run={() => editor.chain().focus().deleteTable().run()} />
        </>
      )}
      <span className="vsep" />
      <B
        label="קישור"
        on={editor.isActive('link')}
        run={() => {
          void (async () => {
            const href = await modal.prompt(
              'קישור',
              'כתובת (http/https)',
              (editor.getAttributes('link').href as string | undefined) ?? '',
            );
            if (href === null) return;
            if (!href) editor.chain().focus().unsetLink().run();
            else if (/^https?:\/\//i.test(href)) editor.chain().focus().setLink({ href }).run();
            else toast('כתובת חייבת להתחיל ב-http:// או https://', 'warn');
          })();
        }}
      />
      {compact || !onPickImage ? null : (
        <label className="tb">
          תמונה
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={(e) => {
              onPickImage(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      )}
      {children}
    </div>
  );
}

/**
 * A self-contained rich-text field: `value` in, sanitized-on-the-server HTML out.
 *
 * Used for the item body (`bodyHtml`) in the step editor. The source document keeps its own
 * `useEditor` because its lifecycle carries drafts, etags and a 412 dialog — but both share the
 * extension set and the toolbar above, which is what "the same component" has to mean here.
 */
export function RichText({
  value,
  onChange,
  compact = false,
  label = 'תוכן הפריט',
}: {
  value: string;
  onChange: (html: string) => void;
  compact?: boolean;
  label?: string;
}) {
  const editor = useEditor({
    extensions: richTextExtensions(compact),
    content: value,
    editorProps: {
      attributes: {
        dir: 'rtl',
        class: 'prose rich-text-body',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
      },
    },
    onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
  });

  // Only when the value changed *outside* the editor (a version restore, a template): comparing
  // against the editor's own HTML is what keeps this from fighting the user's typing.
  useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);

  if (!editor) return null;
  return (
    <div className="source-editor rich-text" dir="rtl">
      <RichTextToolbar editor={editor} compact={compact} />
      <EditorContent editor={editor} />
    </div>
  );
}
