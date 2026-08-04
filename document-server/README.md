# Document server

独立的 Hocuspocus/Yjs 协作文档服务。它只管理实时连接、Awareness 和标准 Yjs 二进制状态；项目、目录和权限数据仍由主 Go Server 管理。

## 本地运行

需要 Node.js 22+ 和已经执行主 Server migrations 的 PostgreSQL。

```bash
cp .env.example .env
pnpm install
set -a && . ./.env && set +a
pnpm dev
```

健康检查：`GET /healthz`。

WebSocket 通过同域反向代理暴露在 `/api/client/document/collaboration`。浏览器会自动携带 HttpOnly `user_session` Cookie；Provider 仍需发送 Auth 消息来触发 Hocuspocus 的 `onAuthenticate`。

文档标题以 `Y.Text("title")` 为权威状态。前端通过 `PATCH /api/client/document/collaboration/:documentId/title` 修改标题，服务使用 Hocuspocus DirectConnection 更新 Y.Doc，并在返回成功前持久化状态和 `documents.title` 投影。正文通过 Tiptap Collaboration 绑定到 `Y.XmlFragment("body")`，由 Hocuspocus Provider 实时同步并持久化。目录名称仍由 Go CRUD API 管理。

```ts
new HocuspocusProvider({
  url: `${location.origin.replace(/^http/, "ws")}/api/client/document/collaboration`,
  name: documentId,
  token: "session-cookie",
  document: ydoc,
})
```

持久化数据是未包装、未压缩的 `Y.encodeStateAsUpdate()` 结果，存放在 `document_collab_states.ydoc_state`。写入失败会以指数退避持续重试；进程关闭时等待活跃文档完成持久化，超过 `DOCUMENT_SHUTDOWN_TIMEOUT_MS` 后以失败状态退出。

连接建立后，服务端每隔 `DOCUMENT_AUTH_RECHECK_MS` 重新检查 Session、用户状态和项目成员关系。Session 过期、用户禁用或权限被撤销时，现有连接会以 4403 关闭。

当前部署模型是单实例；启用多实例前需要增加跨实例广播机制。
