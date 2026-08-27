// Tabler exposes per-icon runtime entry points without per-icon declarations.
// eslint-disable-next-line import/no-unresolved
import IconEye from "@tabler/icons-react-native/IconEye"
// eslint-disable-next-line import/no-unresolved
import IconEyeOff from "@tabler/icons-react-native/IconEyeOff"
// eslint-disable-next-line import/no-unresolved
import IconRefresh from "@tabler/icons-react-native/IconRefresh"
import { useEffect, useRef, useState } from "react"
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native"
import { YStack } from "tamagui"

import { ApiRequestError } from "@/data/api-client"
import { MobileSessionCompatibilityError } from "@/data/auth/auth-api"
import {
  loadAccountLoginAssistance,
  loadLoginCredentials,
  saveLoginAccount,
  saveLoginCredentials,
} from "@/data/auth/credential-store"
import {
  useEmailCodeLoginMutation,
  useLoginMutation,
  useRequestEmailCodeMutation,
} from "@/data/auth/auth-hooks"
import type { AuthenticatedUser } from "@/core/models"
import type { ServerTarget } from "@/core/server-target"
import {
  LoginMethodTabs,
  resolveLoginMethod,
  type LoginMethod,
} from "@/features/auth/login-method-tabs"
import {
  XGUIButton,
  XGUIInformationBar,
  XGUIInput,
  useXGUITheme,
  useXGUIToast,
} from "@/xgui"

const ACCOUNT_INPUT_ID = "login-account"
const EMAIL_CODE_INPUT_ID = "login-email-code"
const PASSWORD_INPUT_ID = "login-password"
const EMAIL_CODE_RETRY_SECONDS = 15

type LoginFormState = {
  account: string
  emailCode: string
  isLoading: boolean
  password: string
  serverKey: string
}

type RetryCodeState = {
  seconds: number
  serverKey: string
}

export function LoginForm({
  connectionFailed,
  connectionReady,
  emailCodeLoginEnabled,
  assistanceAccountId,
  initialAccount,
  onLoginSuccess,
  onRetryConnection,
  passwordLoginEnabled,
  server,
}: {
  connectionFailed: boolean
  connectionReady: boolean
  emailCodeLoginEnabled: boolean
  assistanceAccountId?: string
  initialAccount?: string
  onLoginSuccess: (user: AuthenticatedUser) => Promise<void>
  onRetryConnection: () => void
  passwordLoginEnabled: boolean
  server: ServerTarget
}) {
  const passwordLoginMutation = useLoginMutation(server)
  const emailCodeLoginMutation = useEmailCodeLoginMutation(server)
  const requestEmailCodeMutation = useRequestEmailCodeMutation(server)
  const toast = useXGUIToast()
  const { colors } = useXGUITheme()
  const accountInputRef = useRef<TextInput>(null)
  const emailCodeInputRef = useRef<TextInput>(null)
  const passwordInputRef = useRef<TextInput>(null)
  const serverKey = `${server.id}\n${server.url}`
  const [formState, setFormState] = useState<LoginFormState>({
    account: "",
    emailCode: "",
    isLoading: true,
    password: "",
    serverKey: "",
  })
  const [preferredLoginMethod, setPreferredLoginMethod] =
    useState<LoginMethod>("email-code")
  const [retryCodeState, setRetryCodeState] = useState<RetryCodeState>({
    seconds: 0,
    serverKey: "",
  })
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [isLoginInitializing, setIsLoginInitializing] = useState(false)
  const isCurrentServer = formState.serverKey === serverKey
  const account = isCurrentServer ? formState.account : ""
  const emailCode = isCurrentServer ? formState.emailCode : ""
  const password = isCurrentServer ? formState.password : ""
  const isCredentialsLoading = !isCurrentServer || formState.isLoading
  const retryCodeAfter =
    retryCodeState.serverKey === serverKey ? retryCodeState.seconds : 0
  const activeLoginMethod = resolveLoginMethod({
    emailCodeLoginEnabled,
    passwordLoginEnabled,
    preferredMethod: preferredLoginMethod,
  })
  const isPending =
    isLoginInitializing ||
    passwordLoginMutation.isPending ||
    emailCodeLoginMutation.isPending ||
    requestEmailCodeMutation.isPending
  const isFormUnavailable = isCredentialsLoading || isPending
  const areInputsUnavailable =
    isCredentialsLoading || requestEmailCodeMutation.isPending
  const canSignIn =
    !isCredentialsLoading &&
    account.trim().length > 0 &&
    (activeLoginMethod === "email-code"
      ? emailCode.length === 8
      : activeLoginMethod === "password"
        ? password.length > 0
        : false)
  const isSignInDisabled = !canSignIn || isPending || !connectionReady

  useEffect(() => {
    let isCancelled = false

    void Promise.all([
      loadLoginCredentials({ id: server.id, url: server.url }),
      assistanceAccountId ? loadAccountLoginAssistance(assistanceAccountId) : Promise.resolve(null),
    ])
      .then(([credentials, assistance]) => {
        if (!isCancelled) {
          setFormState({
            account: assistance?.account.trim() || initialAccount?.trim() || credentials?.account || "",
            emailCode: "",
            isLoading: false,
            password: credentials?.password ?? "",
            serverKey,
          })
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setFormState({
            account: initialAccount?.trim() ?? "",
            emailCode: "",
            isLoading: false,
            password: "",
            serverKey,
          })
        }
      })

    return () => {
      isCancelled = true
    }
  }, [assistanceAccountId, initialAccount, server.id, server.url, serverKey])

  useEffect(() => {
    if (retryCodeAfter <= 0) return

    const timer = setTimeout(
      () =>
        setRetryCodeState((current) =>
          current.serverKey === serverKey
            ? { ...current, seconds: Math.max(0, current.seconds - 1) }
            : current
        ),
      1000
    )
    return () => clearTimeout(timer)
  }, [retryCodeAfter, serverKey])

  function handleAccountChange(value: string) {
    setFormState((current) => ({
      account: value,
      emailCode: current.serverKey === serverKey ? current.emailCode : "",
      isLoading: false,
      password: current.serverKey === serverKey ? current.password : "",
      serverKey,
    }))
  }

  function handlePasswordChange(value: string) {
    setFormState((current) => ({
      account: current.serverKey === serverKey ? current.account : "",
      emailCode: current.serverKey === serverKey ? current.emailCode : "",
      isLoading: false,
      password: value,
      serverKey,
    }))
  }

  function handleEmailCodeChange(value: string) {
    setFormState((current) => ({
      account: current.serverKey === serverKey ? current.account : "",
      emailCode: value.replace(/\D/g, "").slice(0, 8),
      isLoading: false,
      password: current.serverKey === serverKey ? current.password : "",
      serverKey,
    }))
  }

  function showError(message: string) {
    toast.show({
      message,
      modal: false,
      type: "error",
    })
  }

  async function handleRequestEmailCode() {
    if (isFormUnavailable || retryCodeAfter > 0) return

    const email = account.trim()
    if (!email) {
      showError("请输入邮箱地址")
      accountInputRef.current?.focus()
      return
    }

    toast.hide()

    try {
      await requestEmailCodeMutation.mutateAsync(email)
      setRetryCodeState({
        seconds: EMAIL_CODE_RETRY_SECONDS,
        serverKey,
      })
      toast.show({
        duration: 1_000,
        message: "验证码已发送",
        modal: false,
        type: "success",
      })
    } catch (error: unknown) {
      toast.show({
        message:
          error instanceof ApiRequestError ? error.message : "验证码发送失败",
        modal: false,
        type: "error",
      })
    }
  }

  async function handleSignIn(method: LoginMethod) {
    if (
      !connectionReady ||
      !canSignIn ||
      isPending ||
      activeLoginMethod !== method
    ) {
      return
    }

    toast.show({
      duration: 0,
      message: "正在登录",
      type: "loading",
    })
    setIsLoginInitializing(true)

    try {
      let user: AuthenticatedUser
      if (method === "password") {
        user = await attemptLoginRequest(() =>
          passwordLoginMutation.mutateAsync({ account, password })
        )
        await saveLoginCredentials(server, { account, password }).catch(() => {
          // A successful login must not be blocked by local credential storage.
        })
      } else {
        user = await attemptLoginRequest(() =>
          emailCodeLoginMutation.mutateAsync({
            code: emailCode,
            email: account,
          })
        )
        await saveLoginAccount(server, account).catch(() => {
          // A successful login must not be blocked by local credential storage.
        })
      }
      await onLoginSuccess(user)
    } catch (error: unknown) {
      const message =
        error instanceof ApiRequestError ? error.message : "登录失败"
      showError(
        method === "password"
          ? message.replace("邮箱或密码错误", "账号或密码错误")
          : message
      )
    } finally {
      setIsLoginInitializing(false)
    }
  }

  return (
    <View style={[styles.formSurface, { backgroundColor: colors.background0 }]}>
        <YStack gap="$2">
          <LoginMethodTabs
            activeMethod={activeLoginMethod}
            disabled={isFormUnavailable}
            emailCodeContent={
              <YStack gap="$4">
                <View style={styles.fieldGroup}>
                  <XGUIInput
                    accessibilityLabel="邮箱"
                    clearable
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect={false}
                    disabled={areInputsUnavailable}
                    id={ACCOUNT_INPUT_ID}
                    keyboardType="email-address"
                    label="邮箱"
                    onChangeText={handleAccountChange}
                    onSubmitEditing={() => emailCodeInputRef.current?.focus()}
                    placeholder="输入邮箱"
                    ref={accountInputRef}
                    returnKeyType="next"
                    separator
                    spellCheck={false}
                    value={account}
                  />
                  <XGUIInput
                    accessibilityLabel="邮箱验证码"
                    autoCapitalize="none"
                    autoComplete="one-time-code"
                    disabled={areInputsUnavailable}
                    id={EMAIL_CODE_INPUT_ID}
                    keyboardType="number-pad"
                    label="验证码"
                    onChangeText={handleEmailCodeChange}
                    onSubmitEditing={() => void handleSignIn("email-code")}
                    placeholder="输入验证码"
                    ref={emailCodeInputRef}
                    returnKeyType="done"
                    textContentType="oneTimeCode"
                    trailing={
                      <EmailCodeAction
                        disabled={
                          isFormUnavailable ||
                          passwordLoginMutation.isPending ||
                          emailCodeLoginMutation.isPending ||
                          retryCodeAfter > 0 ||
                          account.trim().length === 0
                        }
                        label={
                          requestEmailCodeMutation.isPending
                            ? "发送中"
                            : retryCodeAfter > 0
                              ? `${retryCodeAfter} 秒`
                              : "获取验证码"
                        }
                        loading={requestEmailCodeMutation.isPending}
                        onPress={() => void handleRequestEmailCode()}
                      />
                    }
                    value={emailCode}
                  />
                </View>

                {connectionFailed ? (
                  <XGUIInformationBar
                    actionAccessibilityLabel="重新连接服务器"
                    actionIcon={(color) => (
                      <IconRefresh color={color} size={24} strokeWidth={1} />
                    )}
                    floating={false}
                    message="服务器无法连接"
                    onActionPress={onRetryConnection}
                    variant="warn-strong"
                  />
                ) : null}
                <LoginButton
                  disabled={isSignInDisabled}
                  isLoading={emailCodeLoginMutation.isPending}
                  onPress={() => void handleSignIn("email-code")}
                  testID="email-code-login-submit-button"
                />
              </YStack>
            }
            emailCodeLoginEnabled={emailCodeLoginEnabled}
            onMethodChange={(method) => {
              setPreferredLoginMethod(method)
              toast.hide()
            }}
            passwordContent={
              <YStack gap="$4">
                <View style={styles.fieldGroup}>
                  <XGUIInput
                    accessibilityLabel="账号"
                    clearable
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect={false}
                    disabled={areInputsUnavailable}
                    id={ACCOUNT_INPUT_ID}
                    keyboardType="email-address"
                    label="账号"
                    onChangeText={handleAccountChange}
                    onSubmitEditing={() => passwordInputRef.current?.focus()}
                    placeholder="输入邮箱或手机号"
                    ref={accountInputRef}
                    returnKeyType="next"
                    separator
                    spellCheck={false}
                    value={account}
                  />
                  <XGUIInput
                    accessibilityLabel="密码"
                    autoCapitalize="none"
                    autoComplete="password"
                    disabled={areInputsUnavailable}
                    id={PASSWORD_INPUT_ID}
                    label="密码"
                    onChangeText={handlePasswordChange}
                    onSubmitEditing={() => void handleSignIn("password")}
                    placeholder="输入密码"
                    ref={passwordInputRef}
                    returnKeyType="done"
                    secureTextEntry={!passwordVisible}
                    trailing={
                      <PasswordVisibilityAction
                        disabled={isFormUnavailable}
                        onPress={() => setPasswordVisible((visible) => !visible)}
                        visible={passwordVisible}
                      />
                    }
                    value={password}
                  />
                </View>

                {connectionFailed ? (
                  <XGUIInformationBar
                    actionAccessibilityLabel="重新连接服务器"
                    actionIcon={(color) => (
                      <IconRefresh color={color} size={24} strokeWidth={1} />
                    )}
                    floating={false}
                    message="服务器无法连接"
                    onActionPress={onRetryConnection}
                    variant="warn-strong"
                  />
                ) : null}
                <LoginButton
                  disabled={isSignInDisabled}
                  isLoading={passwordLoginMutation.isPending}
                  onPress={() => void handleSignIn("password")}
                  testID="password-login-submit-button"
                />
              </YStack>
            }
            passwordLoginEnabled={passwordLoginEnabled}
          />
        </YStack>
    </View>
  )
}

async function attemptLoginRequest<T>(operation: () => Promise<T>) {
  let lastError: unknown

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation()
    } catch (error: unknown) {
      lastError = error
      if (error instanceof MobileSessionCompatibilityError) throw error
      if (
        error instanceof ApiRequestError &&
        error.status !== undefined &&
        error.status < 500 &&
        error.status !== 429
      ) {
        throw error
      }
    }
  }

  throw lastError
}

function EmailCodeAction({
  disabled,
  label,
  loading,
  onPress,
}: {
  disabled: boolean
  label: string
  loading: boolean
  onPress: () => void
}) {
  return (
    <XGUIButton
      accessibilityLabel={label}
      disabled={disabled}
      loading={loading}
      onPress={onPress}
      size="mini"
      style={styles.inputAction}
      variant="secondary"
    >
      {loading ? null : label}
    </XGUIButton>
  )
}

function PasswordVisibilityAction({
  disabled,
  onPress,
  visible,
}: {
  disabled: boolean
  onPress: () => void
  visible: boolean
}) {
  const { colors } = useXGUITheme()
  const Icon = visible ? IconEye : IconEyeOff

  return (
    <Pressable
      accessibilityLabel={visible ? "隐藏密码" : "显示密码"}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={styles.passwordAction}
    >
      {({ pressed }) => {
        const color = disabled
          ? colors.foreground4
          : pressed
            ? colors.textSecondary
            : colors.textPlaceholder

        return <Icon color={color} size={18} />
      }}
    </Pressable>
  )
}

function LoginButton({
  disabled,
  isLoading,
  onPress,
  testID,
}: {
  disabled: boolean
  isLoading: boolean
  onPress: () => void
  testID: string
}) {
  return (
    <XGUIButton
      accessibilityLabel="登录"
      disabled={disabled}
      loading={isLoading}
      onPress={onPress}
      testID={testID}
    >
      {isLoading ? "登录中…" : "登录"}
    </XGUIButton>
  )
}

const styles = StyleSheet.create({
  fieldGroup: {
    borderRadius: 8,
    overflow: "hidden",
    width: "100%",
  },
  formSurface: {
    borderRadius: 12,
    overflow: "hidden",
    width: "100%",
  },
  inputAction: {
    marginLeft: 8,
    paddingHorizontal: 8,
    width: 92,
  },
  passwordAction: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    marginLeft: 8,
    width: 28,
  },
})
