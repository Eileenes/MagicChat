export {
  DesktopMessageRepository,
  configureMessageCacheTarget,
  getMessageCacheTarget,
} from "./message-cache-client"
export { MessageManager } from "./message-manager"
export {
  HistoryWindowStore,
  type HistoryWindowSnapshot,
  type HistoryWindowTarget,
} from "./history-window-store"
export {
  clearManagedMessageCache,
  messageCacheTargetKey,
  registerMessageCacheClearHandler,
} from "./message-cache-control"
export {
  isMessageOperationCancelled,
  MessageOperationCancelledError,
  type MessageOperationToken,
} from "./message-operation"
export {
  catchUpConversationMessages,
  MessageCatchUpError,
  prioritizeConversationSyncs,
} from "./message-catch-up"
