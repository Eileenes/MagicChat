import AsyncStorage from "@react-native-async-storage/async-storage"
import { useQueryClient } from "@tanstack/react-query"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { isValidServerUrl } from "@/core/server-model"
import { logout } from "@/data/auth/auth-api"
import type { AuthenticatedTarget } from "@/core/server-target"
import { clearSessionData } from "@/data/auth/session-cache"

export type AuthSession = AuthenticatedTarget

const AUTH_SESSION_STORAGE_KEY = "@magicchat/auth-session/v1"

type AuthContextValue = {
  invalidateSession: () => Promise<void>
  isAuthenticated: boolean
  isHydrated: boolean
  isSigningOut: boolean
  session: AuthSession | null
  signIn: (session: AuthSession) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: React.PropsWithChildren) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<AuthSession | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const sessionRef = useRef<AuthSession | null>(null)
  const sessionMutationVersionRef = useRef(0)
  const signOutPromiseRef = useRef<Promise<void> | null>(null)
  useEffect(() => {
    let isActive = true
    const hydrationVersion = sessionMutationVersionRef.current

    void AsyncStorage.getItem(AUTH_SESSION_STORAGE_KEY)
      .then((storedSession) => {
        if (
          !isActive ||
          sessionMutationVersionRef.current !== hydrationVersion
        ) {
          return
        }
        const restoredSession = parsePersistedAuthSession(storedSession)
        sessionRef.current = restoredSession
        setSession(restoredSession)
      })
      .catch(() => undefined)
      .finally(() => {
        if (isActive) setIsHydrated(true)
      })

    return () => {
      isActive = false
    }
  }, [])

  const signIn = useCallback(async (nextSession: AuthSession) => {
    sessionMutationVersionRef.current += 1
    sessionRef.current = nextSession
    setSession(nextSession)
    await AsyncStorage.setItem(
      AUTH_SESSION_STORAGE_KEY,
      JSON.stringify(nextSession)
    ).catch(() => undefined)
  }, [])

  const invalidateSession = useCallback(async () => {
    const currentSession = sessionRef.current

    sessionMutationVersionRef.current += 1
    sessionRef.current = null
    setSession(null)
    await AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY).catch(() => undefined)

    if (currentSession) {
      await clearSessionData(queryClient, currentSession)
    }
  }, [queryClient])

  const signOut = useCallback(() => {
    if (signOutPromiseRef.current) {
      return signOutPromiseRef.current
    }

    const currentSession = sessionRef.current
    if (!currentSession) {
      return Promise.resolve()
    }

    setIsSigningOut(true)
    const operation = logout(currentSession.url)
      .then(async () => {
        if (sessionRef.current === currentSession) {
          await invalidateSession()
        }
      })
      .finally(() => {
        signOutPromiseRef.current = null
        setIsSigningOut(false)
      })

    signOutPromiseRef.current = operation
    return operation
  }, [invalidateSession])

  const value = useMemo(
    () => ({
      invalidateSession,
      isAuthenticated: session !== null,
      isHydrated,
      isSigningOut,
      session,
      signIn,
      signOut,
    }),
    [invalidateSession, isHydrated, isSigningOut, session, signIn, signOut]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function parsePersistedAuthSession(value: string | null): AuthSession | null {
  if (!value) return null

  try {
    const candidate = JSON.parse(value) as Partial<AuthSession>
    if (
      typeof candidate.id !== "string" ||
      candidate.id.length === 0 ||
      typeof candidate.url !== "string" ||
      !isValidServerUrl(candidate.url) ||
      typeof candidate.userId !== "string" ||
      candidate.userId.length === 0
    ) {
      return null
    }

    return {
      id: candidate.id,
      url: candidate.url,
      userId: candidate.userId,
    }
  } catch {
    return null
  }
}

export function useAuth() {
  const value = useContext(AuthContext)

  if (!value) {
    throw new Error("useAuth 必须在 AuthProvider 内使用")
  }

  return value
}

export function useAuthenticatedSession() {
  const { session } = useAuth()

  if (!session) {
    throw new Error("当前页面需要已认证的用户会话")
  }

  return session
}
