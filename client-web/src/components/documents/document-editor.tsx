import * as React from "react"
import { DragHandle } from "@tiptap/extension-drag-handle-react"
import Placeholder from "@tiptap/extension-placeholder"
import TaskItem from "@tiptap/extension-task-item"
import TaskList from "@tiptap/extension-task-list"
import TextAlign from "@tiptap/extension-text-align"
import { Color, TextStyle } from "@tiptap/extension-text-style"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Copy,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Palette,
  Pilcrow,
  Quote,
  Redo2,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
  Unlink,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

import "./document-editor.css"

export function DocumentEditor({
  onTitleChange,
  title,
}: {
  onTitleChange: (title: string) => void
  title: string
}) {
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
        link: { openOnClick: false },
      }),
      TextStyle,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
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
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="document-editor mx-auto min-h-full max-w-4xl border bg-background px-8 py-12 shadow-md sm:px-14 sm:py-16">
          <input
            aria-label="文档页面标题"
            className="mb-8 w-full border-b bg-transparent pb-5 text-4xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/60"
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="无标题文档"
            value={title}
          />
          <EditorContent editor={editor} />
          <DocumentBlockHandle editor={editor} />
        </div>
      </div>
    </div>
  )
}

function DocumentBlockHandle({ editor }: { editor: Editor }) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [activeBlock, setActiveBlock] = React.useState<{
    nodeSize: number
    pos: number
  } | null>(null)

  const handleNodeChange = React.useCallback(
    ({ node, pos }: { node: { nodeSize: number } | null; pos: number }) => {
      setActiveBlock(node ? { nodeSize: node.nodeSize, pos } : null)
    },
    []
  )

  function handleMenuOpenChange(open: boolean) {
    setMenuOpen(open)
    editor.commands.setMeta("lockDragHandle", open)
  }

  function duplicateBlock() {
    if (!activeBlock) return
    const node = editor.state.doc.nodeAt(activeBlock.pos)
    if (!node) return

    const insertPos = activeBlock.pos + activeBlock.nodeSize
    editor.view.dispatch(
      editor.state.tr
        .insert(insertPos, node.copy(node.content))
        .scrollIntoView()
    )
    editor.commands.focus(insertPos + 1)
  }

  function deleteBlock() {
    if (!activeBlock) return
    editor
      .chain()
      .focus()
      .setNodeSelection(activeBlock.pos)
      .deleteSelection()
      .run()
  }

  function transformBlock(format: BlockFormat) {
    if (!activeBlock) return
    const node = editor.state.doc.nodeAt(activeBlock.pos)
    if (!node) return

    let selectionPos = activeBlock.pos + 1
    let selectionNode = node
    while (!selectionNode.isTextblock && selectionNode.firstChild) {
      selectionNode = selectionNode.firstChild
      selectionPos += 1
    }
    editor.commands.setTextSelection(selectionPos)

    if (editor.isActive("bulletList")) {
      editor.chain().focus().toggleBulletList().run()
    }
    if (editor.isActive("orderedList")) {
      editor.chain().focus().toggleOrderedList().run()
    }
    if (editor.isActive("taskList")) {
      editor.chain().focus().toggleTaskList().run()
    }
    if (editor.isActive("blockquote")) {
      editor.chain().focus().toggleBlockquote().run()
    }
    if (editor.isActive("codeBlock")) {
      editor.chain().focus().toggleCodeBlock().run()
    }

    editor.chain().focus().setParagraph().run()

    switch (format) {
      case "paragraph":
        return
      case "heading-1":
        editor.chain().focus().setHeading({ level: 1 }).run()
        return
      case "heading-2":
        editor.chain().focus().setHeading({ level: 2 }).run()
        return
      case "heading-3":
        editor.chain().focus().setHeading({ level: 3 }).run()
        return
      case "bullet-list":
        editor.chain().focus().toggleBulletList().run()
        return
      case "ordered-list":
        editor.chain().focus().toggleOrderedList().run()
        return
      case "task-list":
        editor.chain().focus().toggleTaskList().run()
        return
      case "blockquote":
        editor.chain().focus().toggleBlockquote().run()
        return
      case "code-block":
        editor.chain().focus().toggleCodeBlock().run()
    }
  }

  return (
    <DragHandle
      className="document-block-handle"
      editor={editor}
      nested
      onNodeChange={handleNodeChange}
    >
      <DropdownMenu open={menuOpen} onOpenChange={handleMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="块操作"
            className="cursor-grab bg-background shadow-xs active:cursor-grabbing"
            size="icon-xs"
            title="点击打开菜单，拖动调整位置"
            type="button"
            variant="outline"
          >
            <GripVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-36" side="left">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Pilcrow />
              转换为
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40">
              <DropdownMenuItem onSelect={() => transformBlock("paragraph")}>
                <Pilcrow />
                正文
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("heading-1")}>
                <Heading1 />
                一级标题
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("heading-2")}>
                <Heading2 />
                二级标题
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("heading-3")}>
                <Heading3 />
                三级标题
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => transformBlock("bullet-list")}>
                <List />
                无序列表
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("ordered-list")}>
                <ListOrdered />
                有序列表
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("task-list")}>
                <ListTodo />
                待办列表
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("blockquote")}>
                <Quote />
                引用
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("code-block")}>
                <Code />
                代码块
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={duplicateBlock}>
            <Copy />
            复制块
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={deleteBlock} variant="destructive">
            <Trash2 />
            删除块
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </DragHandle>
  )
}

type BlockFormat =
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bullet-list"
  | "ordered-list"
  | "task-list"
  | "blockquote"
  | "code-block"

function DocumentToolbar({ editor }: { editor: Editor }) {
  const paragraphAlign = editor.getAttributes("paragraph").textAlign as
    string | undefined
  const headingAlign = editor.getAttributes("heading").textAlign as
    string | undefined
  const currentAlign = paragraphAlign ?? headingAlign ?? "left"

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
        active={editor.isActive("underline")}
        label="下划线"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("strike")}
        label="删除线"
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough />
      </ToolbarButton>
      <TextColorMenu editor={editor} />
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
        active={editor.isActive("taskList")}
        label="待办列表"
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListTodo />
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        active={currentAlign === "left"}
        label="左对齐"
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
      >
        <AlignLeft />
      </ToolbarButton>
      <ToolbarButton
        active={currentAlign === "center"}
        label="居中对齐"
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
      >
        <AlignCenter />
      </ToolbarButton>
      <ToolbarButton
        active={currentAlign === "right"}
        label="右对齐"
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
      >
        <AlignRight />
      </ToolbarButton>
      <ToolbarButton
        active={currentAlign === "justify"}
        label="两端对齐"
        onClick={() => editor.chain().focus().setTextAlign("justify").run()}
      >
        <AlignJustify />
      </ToolbarButton>
      <ToolbarSeparator />
      <LinkMenu editor={editor} />
    </div>
  )
}

const textColors = [
  { label: "默认颜色", value: null },
  { label: "灰色", value: "#64748b" },
  { label: "红色", value: "#ef4444" },
  { label: "橙色", value: "#f97316" },
  { label: "黄色", value: "#ca8a04" },
  { label: "绿色", value: "#16a34a" },
  { label: "青色", value: "#0d9488" },
  { label: "蓝色", value: "#2563eb" },
  { label: "紫色", value: "#7c3aed" },
  { label: "粉色", value: "#db2777" },
] as const

function TextColorMenu({ editor }: { editor: Editor }) {
  const currentColor = editor.getAttributes("textStyle").color as
    string | undefined

  function setTextColor(color: string | null) {
    if (color) editor.chain().focus().setColor(color).run()
    else editor.chain().focus().unsetColor().run()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="字体颜色"
          className="relative"
          size="icon-sm"
          title="字体颜色"
          type="button"
          variant="ghost"
        >
          <Palette />
          <span
            aria-hidden
            className="absolute right-1 bottom-0.5 left-1 h-0.5 rounded-full bg-foreground"
            style={currentColor ? { backgroundColor: currentColor } : undefined}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-48">
        <DropdownMenuLabel>字体颜色</DropdownMenuLabel>
        <div className="grid grid-cols-5 gap-1 p-1">
          {textColors.map((color) => (
            <DropdownMenuItem
              aria-label={color.label}
              className={cn(
                "size-7 justify-center p-0",
                currentColor === color.value && "ring-2 ring-ring"
              )}
              key={color.label}
              onSelect={() => setTextColor(color.value)}
              title={color.label}
            >
              {color.value ? (
                <span
                  className="size-4 rounded-full border border-black/10"
                  style={{ backgroundColor: color.value }}
                />
              ) : (
                <span className="text-xs font-semibold">A</span>
              )}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function LinkMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = React.useState(false)
  const [url, setUrl] = React.useState("")
  const linkActive = editor.isActive("link")

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      const href = editor.getAttributes("link").href
      setUrl(typeof href === "string" ? href : "")
    }
    setOpen(nextOpen)
  }

  function applyLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = url.trim()
    if (!value) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run()
      setOpen(false)
      return
    }

    const href = /^(https?:\/\/|mailto:|tel:)/i.test(value)
      ? value
      : `https://${value}`
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run()
    setOpen(false)
  }

  function removeLink() {
    editor.chain().focus().extendMarkRange("link").unsetLink().run()
    setOpen(false)
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-label="链接"
          aria-pressed={linkActive || undefined}
          className={cn(linkActive && "bg-muted text-foreground")}
          size="icon-sm"
          title="链接"
          type="button"
          variant="ghost"
        >
          <LinkIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-80 p-3">
        <form className="flex items-center gap-2" onSubmit={applyLink}>
          <Input
            aria-label="链接地址"
            autoFocus
            onChange={(event) => setUrl(event.target.value)}
            placeholder="输入链接地址"
            value={url}
          />
          <Button size="sm" type="submit">
            应用
          </Button>
          {linkActive && (
            <Button
              aria-label="移除链接"
              onClick={removeLink}
              size="icon-sm"
              title="移除链接"
              type="button"
              variant="ghost"
            >
              <Unlink />
            </Button>
          )}
        </form>
      </PopoverContent>
    </Popover>
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
