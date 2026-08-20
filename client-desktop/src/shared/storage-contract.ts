export const storageCacheKinds = ["network", "runtime", "updates"] as const

export type StorageCacheKind = (typeof storageCacheKinds)[number]

export type StorageCacheItem = Readonly<{
  bytes: number
  clearable: boolean
  kind: StorageCacheKind
}>

export type DesktopStorageStats = Readonly<{
  appBytes: number
  cacheItems: ReadonlyArray<StorageCacheItem>
  diagnosticsBytes: number
  disk: Readonly<{
    availableBytes: number
    totalBytes: number
    usedBytes: number
  }>
  messageCacheBytes: number
  otherBytes: number
  userDataBytes: number
}>

export type StorageClearResult = Readonly<{
  expectedBytes: number
  reclaimedBytes: number
  stats: DesktopStorageStats
}>
