export type XGUIColorScheme = "light" | "dark"

export type XGUIColors = {
  activeMask: string
  background0: string
  background1: string
  background2: string
  background3: string
  background4: string
  background5: string
  brand: string
  destructive: string
  foreground4: string
  foreground5: string
  footerText: string
  informationBarTipsStrongBackground: string
  informationBarWarnWeakBackground: string
  indigo: string
  link: string
  separator: string
  textOnColor: string
  textPlaceholder: string
  textPrimary: string
  textSecondary: string
  toastForeground: string
}

export const xguiColors = {
  light: {
    activeMask: "rgba(0,0,0,0.2)",
    background0: "#EDEDED",
    background1: "#F7F7F7",
    background2: "#FFFFFF",
    background3: "#F7F7F7",
    background4: "#4C4C4C",
    background5: "#FFFFFF",
    brand: "#07C160",
    destructive: "#FA5151",
    foreground4: "rgba(0,0,0,0.15)",
    foreground5: "rgba(0,0,0,0.05)",
    footerText: "rgba(0,0,0,0.2)",
    informationBarTipsStrongBackground: "#FA9D3B",
    informationBarWarnWeakBackground: "rgba(250,81,81,0.1)",
    indigo: "#1485EE",
    link: "#576B95",
    separator: "rgba(0,0,0,0.1)",
    textOnColor: "#FFFFFF",
    textPlaceholder: "rgba(0,0,0,0.3)",
    textPrimary: "rgba(0,0,0,0.9)",
    textSecondary: "rgba(0,0,0,0.55)",
    toastForeground: "rgba(255,255,255,0.9)",
  },
  dark: {
    activeMask: "rgba(255,255,255,0.2)",
    background0: "#111111",
    background1: "#1E1E1E",
    background2: "#191919",
    background3: "#202020",
    background4: "#404040",
    background5: "#2C2C2C",
    brand: "#07C160",
    destructive: "#FA5151",
    foreground4: "rgba(255,255,255,0.15)",
    foreground5: "rgba(255,255,255,0.1)",
    footerText: "rgba(255,255,255,0.2)",
    informationBarTipsStrongBackground: "#C87D2F",
    informationBarWarnWeakBackground: "rgba(250,81,81,0.1)",
    indigo: "#1196FF",
    link: "#7D90A9",
    separator: "rgba(255,255,255,0.05)",
    textOnColor: "#FFFFFF",
    textPlaceholder: "rgba(255,255,255,0.3)",
    textPrimary: "rgba(255,255,255,0.8)",
    textSecondary: "rgba(255,255,255,0.5)",
    toastForeground: "rgba(255,255,255,0.9)",
  },
} as const satisfies Record<XGUIColorScheme, XGUIColors>
