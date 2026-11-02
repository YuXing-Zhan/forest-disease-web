import {
  getAccessConfiguration,
  unlockDeveloperAccess,
} from "../../services/api"
import {
  clearDeveloperAccess,
  clearOwnApiKeys,
  getProviderApiSettings,
  getProviderStatus,
  saveDeveloperAccess,
  saveOwnApiKeys,
} from "../../services/settings"

Page({
  data: {
    kindwiseApiKey: "",
    deepseekApiKey: "",
    question: "开发者所在班级是？",
    answer: "",
    developerAccessAvailable: false,
    developerUnlocked: false,
    accessSummary: "尚未配置识别 API",
    enabledProviders: [] as string[],
    expiresText: "",
    saving: false,
    unlocking: false,
  },

  onShow() {
    this.refreshLocalState()
    this.loadConfiguration()
  },

  async loadConfiguration() {
    try {
      const configuration = await getAccessConfiguration()
      this.setData({
        question: configuration.question,
        developerAccessAvailable: configuration.developer_access_available,
      })
    } catch {
      // 离线时仍允许编辑并保存自备密钥。
    }
  },

  refreshLocalState() {
    const settings = getProviderApiSettings()
    const status = getProviderStatus()
    this.setData({
      kindwiseApiKey: settings.kindwiseApiKey,
      deepseekApiKey: settings.deepseekApiKey,
      developerUnlocked: status.developerUnlocked,
      accessSummary: status.summary,
      enabledProviders: status.providers,
      expiresText: settings.developerAccessExpiresAt
        ? this.formatDate(settings.developerAccessExpiresAt)
        : "",
    })
  },

  formatDate(value: string) {
    const date = new Date(value)
    const pad = (number: number) => String(number).padStart(2, "0")
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  },

  onKindwiseInput(event: any) {
    this.setData({ kindwiseApiKey: event.detail.value })
  },

  onDeepseekInput(event: any) {
    this.setData({ deepseekApiKey: event.detail.value })
  },

  onAnswerInput(event: any) {
    this.setData({ answer: event.detail.value })
  },

  saveKeys() {
    saveOwnApiKeys(this.data.kindwiseApiKey, this.data.deepseekApiKey)
    this.refreshLocalState()
    wx.showToast({ title: "已保存到本机", icon: "success" })
  },

  clearKeys() {
    wx.showModal({
      title: "清除自备密钥",
      content: "将从当前微信设备删除已保存的 API Key。",
      success: (result: any) => {
        if (!result.confirm) return
        clearOwnApiKeys()
        this.refreshLocalState()
      },
    })
  },

  async unlock() {
    const answer = this.data.answer.trim()
    if (!answer || this.data.unlocking) {
      wx.showToast({ title: "请先填写答案", icon: "none" })
      return
    }
    this.setData({ unlocking: true })
    try {
      const result = await unlockDeveloperAccess(answer)
      saveDeveloperAccess(
        result.access_token,
        result.expires_at,
        result.enabled_providers,
      )
      this.setData({ answer: "" })
      this.refreshLocalState()
      wx.showToast({ title: "开发者通道已启用", icon: "success" })
    } catch (error) {
      const detail = error as { message?: string } | null
      wx.showModal({
        title: "未能解锁",
        content: detail?.message || "答案不正确或服务暂不可用",
        showCancel: false,
      })
    } finally {
      this.setData({ unlocking: false })
    }
  },

  lockDeveloperAccess() {
    clearDeveloperAccess()
    this.refreshLocalState()
    wx.showToast({ title: "开发者通道已关闭", icon: "none" })
  },
})
