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

type AuthPhase = "anonymous" | "preparing" | "authenticated"

type AuthContextValue = {
  beginSignIn: (session: AuthSession) => void
  commitSignIn: (session: AuthSession) => Promise<void>
  invalidateSession: () => Promise<void>
  isAuthenticated: boolean
  isHydrated: boolean
  isPreparingSignIn: boolean
  isSigningOut: boolean
  rollbackSignIn: (session: AuthSession) => Promise<void>
  session: AuthSession | null
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: React.PropsWithChildren) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<AuthSession | null>(null)
  const [phase, setPhase] = useState<AuthPhase>("anonymous")
  const [isHydrated, setIsHydrated] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const sessionRef = useRef<AuthSession | null>(null)
  const phaseRef = useRef<AuthPhase>("anonymous")
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
        phaseRef.current = restoredSession ? "authenticated" : "anonymous"
        setSession(restoredSession)
        setPhase(phaseRef.current)
      })
      .catch(() => undefined)
      .finally(() => {
        if (isActive) setIsHydrated(true)
      })

    return () => {
      isActive = false
    }
  }, [])

  const beginSignIn = useCallback((nextSession: AuthSession) => {
    sessionMutationVersionRef.current += 1
    sessionRef.current = nextSession
    phaseRef.current = "preparing"
    setSession(nextSession)
    setPhase("preparing")
  }, [])

  const commitSignIn = useCallback(async (expectedSession: AuthSession) => {
    if (
      phaseRef.current !== "preparing" ||
      !matchesSession(sessionRef.current, expectedSession)
    ) {
      throw new Error("登录初始化已失效")
    }

    const mutationVersion = sessionMutationVersionRef.current
    await AsyncStorage.setItem(
      AUTH_SESSION_STORAGE_KEY,
      JSON.stringify(expectedSession)
    )
    if (
      sessionMutationVersionRef.current !== mutationVersion ||
      !matchesSession(sessionRef.current, expectedSession)
    ) {
      throw new Error("登录初始化已失效")
    }

    phaseRef.current = "authenticated"
    setPhase("authenticated")
  }, [])

  const rollbackSignIn = useCallback(
    async (expectedSession: AuthSession) => {
      if (
        phaseRef.current !== "preparing" ||
        !matchesSession(sessionRef.current, expectedSession)
      ) {
        return
      }

      sessionMutationVersionRef.current += 1
      sessionRef.current = null
      phaseRef.current = "anonymous"
      setSession(null)
      setPhase("anonymous")
      await AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY).catch(
        () => undefined
      )
      await clearSessionData(queryClient, expectedSession)
    },
    [queryClient]
  )

  const invalidateSession = useCallback(async () => {
    const currentSession = sessionRef.current

    sessionMutationVersionRef.current += 1
    sessionRef.current = null
    phaseRef.current = "anonymous"
    setSession(null)
    setPhase("anonymous")
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
      beginSignIn,
      commitSignIn,
      invalidateSession,
      isAuthenticated: phase === "authenticated",
      isHydrated,
      isPreparingSignIn: phase === "preparing",
      isSigningOut,
      rollbackSignIn,
      session,
      signOut,
    }),
    [
      beginSignIn,
      commitSignIn,
      invalidateSession,
      isHydrated,
      isSigningOut,
      phase,
      rollbackSignIn,
      session,
      signOut,
    ]
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

function matchesSession(
  current: AuthSession | null,
  expected: AuthSession
) {
  return (
    current?.id === expected.id &&
    current.url === expected.url &&
    current.userId === expected.userId
  )
}

export function useAuth() {
  const value = useContext(AuthContext)

  if (!value) {
    throw new Error("useAuth 必须在 AuthProvider 内使用")
  }

  return value
}

export function useAuthenticatedSession() {
  const { isAuthenticated, session } = useAuth()

  if (!isAuthenticated || !session) {
    throw new Error("当前页面需要已认证的用户会话")
  }

  return session
}
