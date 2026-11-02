const STORAGE_KEY = "providerApiSettings:v1"

export interface ProviderApiSettings {
  kindwiseApiKey: string
  deepseekApiKey: string
  developerAccessToken: string
  developerAccessExpiresAt: string
  developerProviders: string[]
}

const EMPTY_SETTINGS: ProviderApiSettings = {
  kindwiseApiKey: "",
  deepseekApiKey: "",
  developerAccessToken: "",
  developerAccessExpiresAt: "",
  developerProviders: [],
}

export function getProviderApiSettings(): ProviderApiSettings {
  const stored = wx.getStorageSync(STORAGE_KEY) || {}
  const settings = { ...EMPTY_SETTINGS, ...stored } as ProviderApiSettings
  if (
    settings.developerAccessExpiresAt &&
    new Date(settings.developerAccessExpiresAt).getTime() <= Date.now()
  ) {
    settings.developerAccessToken = ""
    settings.developerAccessExpiresAt = ""
    settings.developerProviders = []
    wx.setStorageSync(STORAGE_KEY, settings)
  }
  return settings
}

export function saveOwnApiKeys(kindwiseApiKey: string, deepseekApiKey: string) {
  const current = getProviderApiSettings()
  wx.setStorageSync(STORAGE_KEY, {
    ...current,
    kindwiseApiKey: kindwiseApiKey.trim(),
    deepseekApiKey: deepseekApiKey.trim(),
  })
}

export function saveDeveloperAccess(
  accessToken: string,
  expiresAt: string,
  providers: string[],
) {
  const current = getProviderApiSettings()
  wx.setStorageSync(STORAGE_KEY, {
    ...current,
    developerAccessToken: accessToken,
    developerAccessExpiresAt: expiresAt,
    developerProviders: providers,
  })
}

export function clearDeveloperAccess() {
  const current = getProviderApiSettings()
  wx.setStorageSync(STORAGE_KEY, {
    ...current,
    developerAccessToken: "",
    developerAccessExpiresAt: "",
    developerProviders: [],
  })
}

export function clearOwnApiKeys() {
  const current = getProviderApiSettings()
  wx.setStorageSync(STORAGE_KEY, {
    ...current,
    kindwiseApiKey: "",
    deepseekApiKey: "",
  })
}

export function getProviderAccessInput() {
  const settings = getProviderApiSettings()
  return {
    kindwise_api_key: settings.kindwiseApiKey || undefined,
    deepseek_api_key: settings.deepseekApiKey || undefined,
    developer_access_token: settings.developerAccessToken || undefined,
  }
}

export function getProviderStatus() {
  const settings = getProviderApiSettings()
  const ownProviders = [
    settings.kindwiseApiKey ? "Kindwise" : "",
    settings.deepseekApiKey ? "DeepSeek" : "",
  ].filter(Boolean)
  const developerProviders = settings.developerProviders.map((provider) =>
    provider === "kindwise" ? "Kindwise" : provider === "deepseek" ? "DeepSeek" : provider,
  )
  const providers = Array.from(new Set([...ownProviders, ...developerProviders]))
  return {
    ready: providers.length > 0,
    providers,
    summary: providers.length ? `已启用：${providers.join("、")}` : "尚未配置识别 API",
    developerUnlocked: Boolean(settings.developerAccessToken),
  }
}
