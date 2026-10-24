import type { Workspace } from '../monolith/api'
import type { AppPreferences } from '../monolith/utils/preferences'

type Command = { action: string; payload: unknown; revision: number; commandId: string }
const allowedPreferences = {
  language: ['en', 'zh', 'es', 'ja'],
  fontSize: ['sm', 'md', 'lg'],
  theme: ['light', 'dark'],
  fontFamily: ['inter', 'jakarta', 'jetbrains'],
} as const
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const error = (detail: string, status = 400) => json({ detail }, status)

export function createPreviewStore(seed: Workspace) {
  let workspace = structuredClone(seed)
  const receipts = new Map<string, string>()
  const snapshot = () => structuredClone(workspace)
  function command(value: unknown): Response {
    if (!value || typeof value !== 'object') return error('Invalid preview command.')
    const c = value as Partial<Command>
    if (c.action !== 'preferences.update') return error('Read-only reskin preview: accounting actions are not saved. Only appearance and language preferences can change here.', 403)
    if (typeof c.commandId !== 'string' || !c.commandId || !Number.isInteger(c.revision)) return error('Invalid preview command envelope.')
    if (!c.payload || typeof c.payload !== 'object' || Array.isArray(c.payload)) return error('Invalid preferences.')
    for (const [key, val] of Object.entries(c.payload)) {
      const options = allowedPreferences[key as keyof typeof allowedPreferences] as readonly string[] | undefined
      if (!options || typeof val !== 'string' || !options.includes(val)) return error(`Unsupported preview preference: ${key}`)
    }
    const digest = JSON.stringify([c.action, c.payload])
    const receipt = receipts.get(c.commandId)
    if (receipt) return receipt === digest ? json(snapshot()) : error('Preview command ID was reused with different preferences.', 409)
    if (c.revision !== workspace.revision) return error('Preview revision changed. Retry after reloading the preferences.', 409)
    workspace = { ...workspace, revision: workspace.revision + 1, preferences: { ...workspace.preferences, ...c.payload as Partial<AppPreferences> } }
    receipts.set(c.commandId, digest)
    return json(snapshot())
  }
  return { snapshot, command }
}

// This fetch never forwards to a network implementation, even for absolute production URLs.
export function createPreviewFetch(store: ReturnType<typeof createPreviewStore>): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const request = input instanceof Request ? input : new Request(new URL(String(input), 'http://reskin-preview.invalid'), init)
      const method = (init?.method || request.method).toUpperCase()
      const pathname = new URL(request.url).pathname
      if (pathname.endsWith('/monolith/workspace') && method === 'GET') return json(store.snapshot())
      if (pathname.endsWith('/monolith/commands') && method === 'POST') {
        const body = init?.body !== undefined ? new Response(init.body) : request.clone()
        return store.command(await body.json())
      }
      return error('Network access is blocked in this isolated reskin preview.', 403)
    } catch { return error('Malformed request in reskin preview.') }
  }
}
