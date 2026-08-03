import { ExternalLink, TriangleAlert } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { parseExternalWebLink } from "@shared/external-link"

export function ExternalLinkConfirmationDialog({
  onConfirm,
  onOpenChange,
  url,
}: {
  onConfirm(url: string): void
  onOpenChange(open: boolean): void
  url?: string
}) {
  const parsedLink = url ? parseExternalWebLink(url) : undefined
  const link = parsedLink?.protocol === "http:" ? parsedLink : undefined

  return (
    <AlertDialog open={Boolean(link)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <TriangleAlert aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>打开不安全的 HTTP 链接？</AlertDialogTitle>
          <AlertDialogDescription>
            该连接未加密，传输内容可能被窃听或篡改。请确认目标地址可信。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {link && (
          <div className="min-w-0 rounded-md bg-muted px-3 py-2">
            <div className="text-xs text-muted-foreground">目标地址 · {link.hostname}</div>
            <div className="mt-1 max-h-24 overflow-auto font-mono text-xs break-all">
              {link.url}
            </div>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={() => link && onConfirm(link.url)}>
            <ExternalLink aria-hidden="true" />
            继续打开
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
