'use client'
import { create } from 'zustand'
import { USE_API } from './config'
import { api } from './api'
import {
  DEFAULT_PUSH_AUTO_SETTINGS,
  DEFAULT_PUSH_HISTORY,
  DEFAULT_PUSH_TEMPLATES,
  type PushAutoEventId,
  type PushAutoSetting,
  type PushCampaign,
  type PushTemplate,
} from './pushCrm'
import { clearAppDataLocalCache, persistAppDataLocally } from './localCache'

const PUSH_KEY = 'kakapo-push'

type PushState = {
  autoSettings: PushAutoSetting[]
  history: PushCampaign[]
  templates: PushTemplate[]
}

function loadPushState(): PushState {
  if (USE_API || typeof window === 'undefined') {
    return {
      autoSettings: DEFAULT_PUSH_AUTO_SETTINGS,
      history: DEFAULT_PUSH_HISTORY,
      templates: DEFAULT_PUSH_TEMPLATES,
    }
  }
  try {
    const raw = localStorage.getItem(PUSH_KEY)
    if (!raw) {
      return {
        autoSettings: DEFAULT_PUSH_AUTO_SETTINGS,
        history: DEFAULT_PUSH_HISTORY,
        templates: DEFAULT_PUSH_TEMPLATES,
      }
    }
    const parsed = JSON.parse(raw) as Partial<PushState>
    const autoMap = new Map((parsed.autoSettings || []).map(s => [s.id, s]))
    const autoSettings = DEFAULT_PUSH_AUTO_SETTINGS.map(def => ({
      ...def,
      ...(autoMap.get(def.id) || {}),
    }))
    const history = Array.isArray(parsed.history) && parsed.history.length
      ? parsed.history
      : DEFAULT_PUSH_HISTORY
    const templates = Array.isArray(parsed.templates) && parsed.templates.length
      ? parsed.templates
      : DEFAULT_PUSH_TEMPLATES
    return { autoSettings, history, templates }
  } catch {
    return {
      autoSettings: DEFAULT_PUSH_AUTO_SETTINGS,
      history: DEFAULT_PUSH_HISTORY,
      templates: DEFAULT_PUSH_TEMPLATES,
    }
  }
}

function savePushState(state: PushState) {
  if (typeof window === 'undefined' || !persistAppDataLocally()) return
  try {
    localStorage.setItem(PUSH_KEY, JSON.stringify(state))
  } catch { /* quota */ }
}

interface PushStore extends PushState {
  hydrated: boolean
  hydrate: () => void
  setAutoEnabled: (id: PushAutoEventId, enabled: boolean) => void
  addCampaign: (campaign: PushCampaign) => void
  setHistory: (history: PushCampaign[]) => void
  fetchFromApi: () => Promise<void>
  isAutoEnabled: (id: PushAutoEventId) => boolean
}

export const usePushStore = create<PushStore>((set, get) => ({
  ...loadPushState(),
  hydrated: false,
  hydrate: () => {
    set({ ...loadPushState(), hydrated: true })
  },
  setAutoEnabled: (id, enabled) => {
    const autoSettings = get().autoSettings.map(s => (s.id === id ? { ...s, enabled } : s))
    const next = { ...get(), autoSettings }
    savePushState({ autoSettings, history: next.history, templates: next.templates })
    set({ autoSettings })
    if (USE_API) api.updatePushSettings({ autoSettings }).catch(console.error)
  },
  addCampaign: campaign => {
    const history = [campaign, ...get().history].slice(0, 50)
    const next = { autoSettings: get().autoSettings, history, templates: get().templates }
    savePushState(next)
    set({ history })
    if (USE_API) api.sendPushCampaign(campaign).catch(console.error)
  },
  setHistory: history => {
    const next = { autoSettings: get().autoSettings, history, templates: get().templates }
    savePushState(next)
    set({ history })
  },
  fetchFromApi: async () => {
    if (!USE_API) {
      set({ ...loadPushState(), hydrated: true })
      return
    }
    try {
      clearAppDataLocalCache()
      const remote = await api.getPushState()
      const autoMap = new Map((remote.autoSettings || []).map(s => [s.id, s]))
      const autoSettings = DEFAULT_PUSH_AUTO_SETTINGS.map(def => ({
        ...def,
        ...(autoMap.get(def.id) || {}),
      }))
      const history = remote.history?.length ? remote.history : []
      const templates = DEFAULT_PUSH_TEMPLATES
      set({ autoSettings, history, templates, hydrated: true })
    } catch (e) {
      console.error(e)
      set({
        autoSettings: DEFAULT_PUSH_AUTO_SETTINGS,
        history: [],
        templates: DEFAULT_PUSH_TEMPLATES,
        hydrated: true,
      })
    }
  },
  isAutoEnabled: id => {
    const row = get().autoSettings.find(s => s.id === id)
    return row?.enabled ?? false
  },
}))

export function hydratePushStore() {
  if (USE_API) {
    void usePushStore.getState().fetchFromApi()
    return
  }
  usePushStore.getState().hydrate()
}

export async function syncPushFromApi() {
  await usePushStore.getState().fetchFromApi()
}

export function usePushHistory() {
  return usePushStore(s => s.history)
}

export function usePushAutoSettings() {
  return usePushStore(s => s.autoSettings)
}

export function usePushTemplates() {
  return usePushStore(s => s.templates)
}
