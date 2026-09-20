/** 与 Worker 端 DTO 对应的类型 */

export type NodeType = 'file' | 'folder'

export type NodeDto = {
  id: string
  type: NodeType
  name: string
  parentId: string | null
  size: number | null
  mime: string | null
  starred: boolean
  hasThumb: boolean
  publicSlug: string | null
  createdAt: number
  updatedAt: number
  childCount?: number
  childrenSize?: number
  deletedAt?: number | null
  path?: { id: string; name: string }[]
}

export type NodeList = { items: NodeDto[]; nextCursor: string | null }

export type ShareDto = {
  id: string
  nodeId: string
  name: string
  size: number | null
  mime: string | null
  hasPassword: boolean
  expiresAt: number | null
  maxDownloads: number | null
  downloadCount: number
  status: 'active' | 'expired' | 'exhausted' | 'revoked'
  createdAt: number
  lastAccessAt: number | null
}

export type SessionDto = {
  id: string
  created_at: number
  last_seen_at: number
  expires_at: number
  user_agent: string | null
  ip_country: string | null
  isCurrent: boolean
}

export type CredentialDto = {
  id: string
  name: string
  backedUp: boolean
  lastUsedAt: number | null
  createdAt: number
}

export type Me = {
  userId: string
  email: string
  displayName: string
  hasPassword: boolean
  totpEnabled: boolean
  passkeyCount: number
  recoveryCodesLeft: number
}

export type Bootstrap = {
  initialized: boolean
  authMethods: { password: boolean; totp: boolean }
  /** 跨子域共享认证（BASE_DOMAIN_AUTH）开启时为 true——与 Miniblog 共享登录与账号数据 */
  ssoEnabled: boolean
  me?: Me & { userId: string }
}

export type StorageInfo = {
  used: number
  fileCount: number
  folderCount: number
  trashCount: number
  trashBytes: number
}

export type ShareMeta = {
  needPassword: boolean
  name?: string
  size?: number | null
  mime?: string | null
  hasThumb?: boolean
  expiresAt?: number | null
  previewable?: boolean
}
