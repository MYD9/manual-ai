'use client';
import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading2,
  Quote,
  Undo2,
  Redo2,
  Table2,
} from 'lucide-react';
import DOMPurify from 'dompurify';
export function SafeHTML({ html }: { html: string }) {
  return (
    <div
      className="richtext"
      dangerouslySetInnerHTML={{
        __html: typeof window === 'undefined' ? '' : DOMPurify.sanitize(html),
      }}
    />
  );
}
export default function RichEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const editor = useEditor({
    extensions: [StarterKit, Image.configure({ allowBase64: false }), TableKit],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'richtext',
        role: 'textbox',
        'aria-label': '卡片正文',
        'aria-multiline': 'true',
      },
    },
  });
  useEffect(() => {
    if (editor && value !== editor.getHTML() && !editor.isFocused)
      editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);
  if (!editor) return <div className="editor-body muted">正在打开编辑器…</div>;
  const buttons = [
    {
      icon: Bold,
      label: '粗体',
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      icon: Italic,
      label: '斜体',
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      icon: Heading2,
      label: '标题',
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      icon: List,
      label: '项目列表',
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      icon: ListOrdered,
      label: '编号列表',
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      icon: Quote,
      label: '引用',
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      icon: Table2,
      label: '插入表格',
      run: () =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      icon: Undo2,
      label: '撤销',
      run: () => editor.chain().focus().undo().run(),
    },
    {
      icon: Redo2,
      label: '重做',
      run: () => editor.chain().focus().redo().run(),
    },
  ];
  return (
    <div>
      <div className="editor-bar">
        {buttons.map((b) => (
          <button
            key={b.label}
            type="button"
            className="icon-btn"
            title={b.label}
            aria-label={b.label}
            onClick={b.run}
          >
            <b.icon />
          </button>
        ))}
      </div>
      <div className="editor-body">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
