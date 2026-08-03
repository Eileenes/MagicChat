import { Platform } from "react-native"

import type { AuthenticatedTarget, ServerTarget } from "@/core/server-target"
import {
  commitResourceCacheTarget,
  createResourceCacheTarget,
  getCachedResource,
  removeCachedResource,
  removeServerResourceCache as removeServerResourceCacheStore,
} from "@/data/resources/resource-cache-store"
import { downloadResource } from "@/data/resources/resource-downloader"
import {
  getAttachmentCacheExtension,
  hasExpectedVoiceCacheExtension,
} from "@/data/resources/resource-file-extension"
import { requestResourceReadUrl } from "@/data/resources/resource-request-pool"
import type {
  AttachmentResourceReference,
  AvatarResourceReference,
  ResolvedResource,
} from "@/core/resource-models"
import { SharedTaskPool } from "@/data/resources/shared-task-pool"
import { resolveServerAssetUrl } from "@/lib/server-asset-url"

const downloadTasks = new SharedTaskPool<ResolvedResource>()

export async function getCachedAttachmentResource(
  server: ServerTarget,
  reference: AttachmentResourceReference
) {
  const identity = getAttachmentIdentity(reference.fileId)
  const resource = await getCachedResource(
    server,
    identity
  )
  if (!resource) return null
  if (!hasExpectedVoiceCacheExtension(reference, resource.uri)) {
    await removeCachedResource(server, identity)
    return null
  }
  return withMimeType(resource, reference.mimeType)
}

export async function ensureAttachmentResource(
  session: AuthenticatedTarget,
  reference: AttachmentResourceReference,
  options: { signal?: AbortSignal } = {}
) {
  const identity = getAttachmentIdentity(reference.fileId)
  const cached = await getCachedAttachmentResource(session, reference)
  if (cached) return cached

  const resource = await runDownloadOnce(
    session,
    identity,
    async () => {
      const rechecked = await getCachedAttachmentResource(session, reference)
      if (rechecked) return rechecked

      const readUrl = await requestResourceReadUrl(session, reference.fileId)
      if (Platform.OS === "web") {
        return createRemoteResource(
          identity,
          readUrl.url,
          readUrl.sizeBytes ?? reference.expectedSizeBytes ?? 0,
          reference.mimeType
        )
      }

      return downloadToCache({
        expectedSizeBytes: readUrl.sizeBytes ?? reference.expectedSizeBytes,
        extension: getAttachmentCacheExtension(reference, readUrl.url),
        identity,
        server: session,
        sourceUrl: readUrl.url,
      })
    },
    options.signal
  )

  return withMimeType(resource, reference.mimeType)
}

export function invalidateAttachmentResource(
  server: ServerTarget,
  reference: AttachmentResourceReference
) {
  return removeCachedResource(server, getAttachmentIdentity(reference.fileId))
}

export function resolveAvatarResourceUrl(
  server: ServerTarget,
  avatar: string
) {
  const resolved = resolveServerAssetUrl(server.url, avatar).trim()
  if (!resolved) return ""

  try {
    const url = new URL(resolved)
    url.hash = ""
    return url.toString()
  } catch {
    return resolved
  }
}

export async function ensureAvatarResource(
  server: ServerTarget,
  reference: AvatarResourceReference,
  options: { signal?: AbortSignal } = {}
): Promise<ResolvedResource | null> {
  const sourceUrl = resolveAvatarResourceUrl(server, reference.url)
  if (!sourceUrl) return null
  const identity = getAvatarIdentity(sourceUrl)
  const cached = await getCachedResource(server, identity)
  if (cached) return cached

  if (Platform.OS === "web") {
    return createRemoteResource(identity, sourceUrl, 0)
  }

  return runDownloadOnce(
    server,
    identity,
    async () => {
      const rechecked = await getCachedResource(server, identity)
      if (rechecked) return rechecked

      return downloadToCache({
        extension: getUrlExtension(sourceUrl, ".image"),
        identity,
        server,
        sourceUrl,
      })
    },
    options.signal
  )
}

export function invalidateAvatarResource(
  server: ServerTarget,
  avatar: string
) {
  const sourceUrl = resolveAvatarResourceUrl(server, avatar)
  if (!sourceUrl) return Promise.resolve()
  return removeCachedResource(server, getAvatarIdentity(sourceUrl))
}

export async function removeServerResourceCache(server: ServerTarget) {
  const taskPrefix = createDownloadTaskPrefix(server)
  const activeTasks = downloadTasks.listByPrefix(taskPrefix)

  await Promise.allSettled(activeTasks)
  await removeServerResourceCacheStore(server)
}

async function downloadToCache({
  expectedSizeBytes,
  extension,
  identity,
  server,
  sourceUrl,
}: {
  expectedSizeBytes?: number
  extension: string
  identity: string
  server: ServerTarget
  sourceUrl: string
}) {
  const target = await createResourceCacheTarget(server, identity, extension)
  const downloaded = await downloadResource({
    expectedSizeBytes,
    sourceUrl,
    temporaryFile: target.temporaryFile,
  })
  return commitResourceCacheTarget(target, downloaded.sizeBytes)
}

function runDownloadOnce(
  server: ServerTarget,
  identity: string,
  operation: () => Promise<ResolvedResource>,
  signal?: AbortSignal
) {
  const taskKey = `${createDownloadTaskPrefix(server)}${identity}`
  return downloadTasks.run(taskKey, operation, signal)
}

function createDownloadTaskPrefix(server: ServerTarget) {
  return `${server.id}\n${server.url}\n`
}

function createRemoteResource(
  identity: string,
  uri: string,
  sizeBytes: number,
  mimeType?: string
): ResolvedResource {
  return {
    identity,
    mimeType,
    sizeBytes,
    source: "network",
    uri,
  }
}

function withMimeType(resource: ResolvedResource, mimeType?: string) {
  return mimeType ? { ...resource, mimeType } : resource
}

function getAttachmentIdentity(fileId: string) {
  return `attachment:${fileId}`
}

function getAvatarIdentity(url: string) {
  return `avatar:${url}`
}

function getUrlExtension(value: string, fallback: string) {
  try {
    return getPathExtension(new URL(value).pathname) || fallback
  } catch {
    return fallback
  }
}

function getPathExtension(value: string) {
  const match = /\.[a-zA-Z0-9]{1,10}$/.exec(value)
  return match ? match[0].toLowerCase() : ""
}
