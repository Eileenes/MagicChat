import * as React from "react"
import { Loader2, Search, UserPlus, UsersRound } from "lucide-react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  searchContactUsers,
  type ContactUser,
  type FriendRequest,
} from "@/lib/client-data-api"
import { getClientDataErrorMessage } from "@/lib/client-data-state"

export function FriendManagementDialog({
  acceptRequest,
  cancelRequest,
  contacts,
  createRequest,
  currentUserId,
  deleteFriend,
  ensureUsers,
  incomingRequests,
  onOpenChange,
  open,
  outgoingRequests,
  rejectRequest,
  usersById,
}: {
  acceptRequest: (requestId: string) => Promise<void>
  cancelRequest: (requestId: string) => Promise<void>
  contacts: ContactUser[]
  createRequest: (userId: string) => Promise<void>
  currentUserId: string
  deleteFriend: (userId: string) => Promise<void>
  ensureUsers: (userIds: string[]) => Promise<void>
  incomingRequests: FriendRequest[]
  onOpenChange: (open: boolean) => void
  open: boolean
  outgoingRequests: FriendRequest[]
  rejectRequest: (requestId: string) => Promise<void>
  usersById: Readonly<Record<string, ContactUser>>
}) {
  const [query, setQuery] = React.useState("")
  const [resultIds, setResultIds] = React.useState<string[]>([])
  const [searching, setSearching] = React.useState(false)
  const [updatingKey, setUpdatingKey] = React.useState("")
  const incoming = incomingRequests.map((request) => ({
    request,
    user: usersById[request.requesterUserId],
  }))
  const outgoing = outgoingRequests.map((request) => ({
    request,
    user: usersById[request.addresseeUserId],
  }))
  const friends = contacts.filter((contact) => contact.id !== currentUserId)
  const friendIds = new Set(friends.map((friend) => friend.id))
  const pendingIds = new Set([
    ...incomingRequests.map((request) => request.requesterUserId),
    ...outgoingRequests.map((request) => request.addresseeUserId),
  ])

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault()
    const value = query.trim()
    if (!value || searching) return
    setSearching(true)
    try {
      const ids = await searchContactUsers(value)
      await ensureUsers(ids)
      setResultIds(ids)
    } catch (error) {
      toast.error(getClientDataErrorMessage(error, "查找用户失败"))
    } finally {
      setSearching(false)
    }
  }

  async function run(key: string, action: () => Promise<void>, success: string) {
    setUpdatingKey(key)
    try {
      await action()
      toast.success(success)
    } catch (error) {
      toast.error(getClientDataErrorMessage(error, "好友操作失败"))
    } finally {
      setUpdatingKey("")
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>好友管理</DialogTitle>
          <DialogDescription>
            通过完整邮箱、手机号或用户 ID 精确查找用户。
          </DialogDescription>
        </DialogHeader>
        <Tabs className="min-h-0 flex-1" defaultValue="friends">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="friends">好友 {friends.length}</TabsTrigger>
            <TabsTrigger value="incoming">收到 {incoming.length}</TabsTrigger>
            <TabsTrigger value="outgoing">发出 {outgoing.length}</TabsTrigger>
            <TabsTrigger value="search">添加</TabsTrigger>
          </TabsList>
          <FriendListTab
            empty="暂无好友"
            items={friends.map((user) => ({ key: user.id, user }))}
            renderAction={({ user }) =>
              user ? (
                <Button
                  disabled={updatingKey === `delete:${user.id}`}
                  onClick={() =>
                    void run(
                      `delete:${user.id}`,
                      () => deleteFriend(user.id),
                      "好友已删除"
                    )
                  }
                  size="sm"
                  variant="outline"
                >
                  删除
                </Button>
              ) : null
            }
            value="friends"
          />
          <FriendListTab
            empty="暂无收到的好友申请"
            items={incoming.map(({ request, user }) => ({
              key: request.id,
              request,
              user,
            }))}
            renderAction={({ request }) => (
              <div className="flex gap-2">
                <Button
                  disabled={updatingKey === request?.id}
                  onClick={() =>
                    void run(
                      request!.id,
                      () => rejectRequest(request!.id),
                      "已拒绝好友申请"
                    )
                  }
                  size="sm"
                  variant="outline"
                >
                  拒绝
                </Button>
                <Button
                  disabled={updatingKey === request?.id}
                  onClick={() =>
                    void run(
                      request!.id,
                      () => acceptRequest(request!.id),
                      "已添加好友"
                    )
                  }
                  size="sm"
                >
                  接受
                </Button>
              </div>
            )}
            value="incoming"
          />
          <FriendListTab
            empty="暂无发出的好友申请"
            items={outgoing.map(({ request, user }) => ({
              key: request.id,
              request,
              user,
            }))}
            renderAction={({ request }) => (
              <Button
                disabled={updatingKey === request?.id}
                onClick={() =>
                  void run(
                    request!.id,
                    () => cancelRequest(request!.id),
                    "好友申请已取消"
                  )
                }
                size="sm"
                variant="outline"
              >
                取消申请
              </Button>
            )}
            value="outgoing"
          />
          <TabsContent className="min-h-0 overflow-y-auto pt-4" value="search">
            <form className="flex gap-2" onSubmit={handleSearch}>
              <Input
                aria-label="精确查找用户"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="完整邮箱、手机号或用户 ID"
                value={query}
              />
              <Button disabled={searching || !query.trim()} type="submit">
                {searching ? <Loader2 className="animate-spin" /> : <Search />}
                查找
              </Button>
            </form>
            <div className="mt-4 grid gap-2">
              {resultIds.map((id) => {
                const user = usersById[id]
                if (!user) return null
                const unavailable = friendIds.has(id) || pendingIds.has(id)
                return (
                  <FriendRow
                    action={
                      <Button
                        disabled={unavailable || updatingKey === `add:${id}`}
                        onClick={() =>
                          void run(
                            `add:${id}`,
                            () => createRequest(id),
                            "好友申请已发送"
                          )
                        }
                        size="sm"
                      >
                        <UserPlus />
                        {friendIds.has(id)
                          ? "已是好友"
                          : pendingIds.has(id)
                            ? "申请处理中"
                            : "添加好友"}
                      </Button>
                    }
                    key={id}
                    user={user}
                  />
                )
              })}
              {!searching && resultIds.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
                  <UsersRound className="size-8" />
                  输入完整信息查找用户
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

type FriendListItem = {
  key: string
  request?: FriendRequest
  user?: ContactUser
}

function FriendListTab({
  empty,
  items,
  renderAction,
  value,
}: {
  empty: string
  items: FriendListItem[]
  renderAction: (item: FriendListItem) => React.ReactNode
  value: string
}) {
  return (
    <TabsContent className="min-h-0 overflow-y-auto pt-4" value={value}>
      <div className="grid gap-2">
        {items.map((item) =>
          item.user ? (
            <FriendRow action={renderAction(item)} key={item.key} user={item.user} />
          ) : null
        )}
        {items.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {empty}
          </div>
        )}
      </div>
    </TabsContent>
  )
}

function FriendRow({ action, user }: { action: React.ReactNode; user: ContactUser }) {
  const displayName = user.nickname || user.name
  return (
    <div className="flex items-center gap-3 rounded-md border p-3">
      <Avatar className="size-9">
        {user.avatar && <AvatarImage alt={displayName} src={user.avatar} />}
        <AvatarFallback>{Array.from(displayName)[0] ?? "?"}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{displayName}</div>
        <div className="truncate text-xs text-muted-foreground">{user.email}</div>
      </div>
      {action}
    </div>
  )
}
