import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ExternalLinkConfirmationDialog } from "@/components/external-link-confirmation-dialog"

describe("外链安全确认", () => {
  it("对 HTTP 链接展示未加密警告并在确认后返回规范化地址", async () => {
    const onConfirm = vi.fn()
    render(
      <ExternalLinkConfirmationDialog
        onConfirm={onConfirm}
        onOpenChange={vi.fn()}
        url="http://intranet.example.test:8080/docs"
      />,
    )

    expect(screen.getByRole("alertdialog", { name: "打开不安全的 HTTP 链接？" })).toBeVisible()
    expect(screen.getByText(/连接未加密/)).toBeVisible()
    expect(screen.getByText("目标地址 · intranet.example.test")).toBeVisible()
    expect(screen.getByText("http://intranet.example.test:8080/docs")).toBeVisible()

    await userEvent.click(screen.getByRole("button", { name: "继续打开" }))

    expect(onConfirm).toHaveBeenCalledWith("http://intranet.example.test:8080/docs")
  })

  it("不会为 HTTPS 链接展示确认弹窗", () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <ExternalLinkConfirmationDialog
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
        url="https://example.com/docs"
      />,
    )

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
