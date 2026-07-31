import type {
  ClientConversation,
  ClientMessageSearchResult,
  ContactApp,
  ContactGroup,
  ContactUser,
  SearchClientMessagesInput,
} from "@/lib/client-data-api"
import { searchClientMessages } from "@/lib/client-data-api"
import {
  createLocalSearchService,
  type ConversationSearchResult,
  type DirectorySearchItem,
  type LocalSearchScope,
} from "@/lib/local-search"

export type ClientSearchScope = "all" | "directory" | "conversation" | "messages"
export type ClientSearchResults = Readonly<{
  conversations: ConversationSearchResult[]
  directory: DirectorySearchItem[]
  messages: ClientMessageSearchResult[]
}>
export type MessageSearchProvider = (
  input: SearchClientMessagesInput,
) => Promise<ClientMessageSearchResult[]>

export function createClientSearchService(input: {
  apps: ContactApp[]
  contacts: ContactUser[]
  conversations: ClientConversation[]
  currentUserId: string
  groups: ContactGroup[]
  messageSearch?: MessageSearchProvider
}) {
  const local = createLocalSearchService({
    apps: input.apps,
    contacts: input.contacts,
    conversations: input.conversations,
    currentUserId: input.currentUserId,
    groups: input.groups,
  })
  const messageSearch = input.messageSearch ?? searchClientMessages
  return {
    async search(
      request: { keyword: string; scope: ClientSearchScope },
      options: { signal?: AbortSignal } = {},
    ): Promise<ClientSearchResults> {
      const keyword = request.keyword.trim()
      if (!keyword) return emptySearchResults()
      const localScope: LocalSearchScope = request.scope === "messages" ? "all" : request.scope
      const localResults = local.search({ keyword, scope: localScope })
      const messages =
        (request.scope === "all" || request.scope === "messages") && Array.from(keyword).length >= 2
          ? await messageSearch({ keyword, signal: options.signal })
          : []
      return {
        conversations: request.scope === "messages" ? [] : localResults.conversations,
        directory: request.scope === "messages" ? [] : localResults.directory,
        messages,
      }
    },
  }
}

function emptySearchResults(): ClientSearchResults {
  return { conversations: [], directory: [], messages: [] }
}
