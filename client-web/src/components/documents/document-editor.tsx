import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import Placeholder from "@tiptap/extension-placeholder"
import StarterKit from "@tiptap/starter-kit"
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import "./document-editor.css"

export function DocumentEditor() {
  const editor = useEditor({
    content: "",
    editorProps: {
      attributes: {
        "aria-label": "文档正文",
        class: "document-editor-content",
      },
    },
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: "开始撰写文档…",
      }),
    ],
    shouldRerenderOnTransaction: true,
  })

  if (!editor) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DocumentToolbar editor={editor} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-10 sm:px-8">
        <div className="document-editor mx-auto min-h-full max-w-3xl rounded-lg border bg-background px-8 py-12 shadow-md sm:px-14 sm:py-16">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}

function DocumentToolbar({ editor }: { editor: Editor }) {
  return (
    <div
      aria-label="文档格式工具栏"
      className="flex h-12 shrink-0 items-center justify-center gap-0.5 overflow-x-auto border-b bg-background px-3 py-1.5"
      role="toolbar"
    >
      <ToolbarButton
        disabled={!editor.can().chain().focus().undo().run()}
        label="撤销"
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 />
      </ToolbarButton>
      <ToolbarButton
        disabled={!editor.can().chain().focus().redo().run()}
        label="重做"
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 />
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        active={editor.isActive("heading", { level: 1 })}
        label="一级标题"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("heading", { level: 2 })}
        label="二级标题"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("heading", { level: 3 })}
        label="三级标题"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 />
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        active={editor.isActive("bold")}
        label="粗体"
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("italic")}
        label="斜体"
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("strike")}
        label="删除线"
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("code")}
        label="行内代码"
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code />
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        active={editor.isActive("bulletList")}
        label="无序列表"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("orderedList")}
        label="有序列表"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("blockquote")}
        label="引用"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("codeBlock")}
        label="代码块"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code className="rounded border p-0.5" />
      </ToolbarButton>
      <ToolbarButton
        label="分割线"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <Minus />
      </ToolbarButton>
    </div>
  )
}

function ToolbarButton({
  active = false,
  children,
  className,
  disabled = false,
  label,
  onClick,
}: {
  active?: boolean
  children: React.ReactNode
  className?: string
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={active || undefined}
      className={cn(active && "bg-muted text-foreground", className)}
      disabled={disabled}
      onClick={onClick}
      size="icon-sm"
      title={label}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  )
}

function ToolbarSeparator() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-border" />
}
