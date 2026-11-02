import { getCase } from "../../services/api"

const STATUS_TEXT: Record<string, string> = {
  queued: "任务正在排队",
  quality_checking: "正在检查图片质量",
  identifying: "正在进行初步识别",
  reviewing: "正在进行大模型复核",
  completed: "识别完成",
  needs_more_information: "需要补充信息",
  failed: "识别暂时失败",
}

Page({
  data: {
    caseId: "",
    statusText: "正在创建任务",
    errorMessage: "",
  },

  timer: 0 as any,

  onLoad(options: Record<string, string>) {
    const caseId = options.caseId || ""
    this.setData({ caseId })
    if (!caseId) {
      this.setData({ errorMessage: "缺少病例编号" })
      return
    }
    this.poll()
  },

  onUnload() {
    this.stopPolling()
  },

  stopPolling() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = 0
    }
  },

  async poll() {
    try {
      const diseaseCase = await getCase(this.data.caseId)
      this.setData({
        statusText: STATUS_TEXT[diseaseCase.status] || "正在处理",
        errorMessage: diseaseCase.error_message || "",
      })
      if (diseaseCase.status === "completed") {
        this.stopPolling()
        const key = `caseTiming:${diseaseCase.case_id}`
        const timing = wx.getStorageSync(key) || {}
        wx.setStorageSync(key, { ...timing, completedAt: Date.now() })
        wx.redirectTo({ url: `/pages/result/index?caseId=${diseaseCase.case_id}` })
        return
      }
      if (["failed", "needs_more_information"].includes(diseaseCase.status)) {
        this.stopPolling()
        return
      }
      this.timer = setTimeout(() => this.poll(), 1000)
    } catch (error) {
      this.setData({
        errorMessage: error instanceof Error ? error.message : "无法查询识别进度",
      })
      this.timer = setTimeout(() => this.poll(), 2500)
    }
  },

  backToIdentify() {
    this.stopPolling()
    wx.reLaunch({ url: "/pages/identify/index" })
  },
})
