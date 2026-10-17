import * as React from "react"

/* Appearance: theme, density, type size.

   Row heights are Carbon's scale (24 / 32 / 40). Type size is a setting rather
   than a fixed number because there is no correct value — it depends on the
   typeface and the reader. Both are written to <html> as data attributes so the
   CSS variables reach the shadcn components without prop drilling. Dark mode
   uses shadcn's own .dark token block; nothing here re-invents the palette. */

export type Theme = "light" | "dark" | "system"
export type Density = "compact" | "standard" | "relaxed"
export type Size = "sm" | "md" | "lg"

export interface AppearanceState {
  theme: Theme
  density: Density
  size: Size
  setTheme: (v: Theme) => void
  setDensity: (v: Density) => void
  setSize: (v: Size) => void
}

const STORAGE_KEY = "acc.appearance"

const DEFAULTS = { theme: "system" as Theme, density: "standard" as Density, size: "md" as Size }

function read(): typeof DEFAULTS {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

const AppearanceContext = React.createContext<AppearanceState>({ ...DEFAULTS, setTheme: () => {}, setDensity: () => {}, setSize: () => {} })

export const AppearanceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = React.useState(read)

  const apply = React.useCallback((next: typeof DEFAULTS) => {
    const root = document.documentElement
    const dark =
      next.theme === "dark" ||
      (next.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
    root.classList.toggle("dark", dark)
    root.dataset.density = next.density
    root.dataset.size = next.size
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }, [])

  React.useEffect(() => {
    apply(state)
  }, [state, apply])

  React.useEffect(() => {
    if (state.theme !== "system") return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => apply(state)
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [state, apply])

  const value = React.useMemo<AppearanceState>(
    () => ({
      ...state,
      setTheme: (theme) => setState((s) => ({ ...s, theme })),
      setDensity: (density) => setState((s) => ({ ...s, density })),
      setSize: (size) => setState((s) => ({ ...s, size })),
    }),
    [state],
  )

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export const useAppearance = () => React.useContext(AppearanceContext)
