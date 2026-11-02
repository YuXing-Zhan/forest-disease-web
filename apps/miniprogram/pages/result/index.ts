import { getCase } from "../../services/api"
import { ModelReview } from "../../types/contracts"

const STRENGTH_LABELS: Record<string, string> = {
  A: "证据较充分",
  B: "较强候选",
  C: "初步候选",
  D: "信息不足",
}

Page({
  data: {
    caseId: "",
    diseaseCase: null as any,
    strengthLabel: "",
    loading: true,
    errorMessage: "",
    reviewFilter: "all",
    reviewCards: [] as ModelReview[],
    reviewOptions: [] as Array<{ filter: string; label: string }>,
    timingRows: [] as Array<{ label: string; value: string }>,
    sizeSummary: "",
  },

  onLoad(options: Record<string, string>) {
    const caseId = options.caseId || ""
    this.setData({ caseId })
    this.loadResult()
  },

  async loadResult() {
    if (!this.data.caseId) {
      this.setData({ loading: false, errorMessage: "缺少病例编号" })
      return
    }
    try {
      const diseaseCase = await getCase(this.data.caseId)
      const strength = diseaseCase.result?.strength || "D"
      const reviews: ModelReview[] = diseaseCase.result?.llm_review?.reviews || []
      const reviewOptions = reviews.length > 1
        ? [
            { filter: "all", label: "同时查看" },
            ...reviews.map((review) => ({
              filter: review.provider,
              label: review.provider === "OpenAI" ? "GPT-5.6 Sol" : review.provider,
            })),
          ]
        : []
      const clientTiming = wx.getStorageSync(`caseTiming:${this.data.caseId}`) || {}
      const serverTiming = diseaseCase.timings || {}
      const timingRows = [
        { label: "图片压缩", ms: clientTiming.compressionMs },
        { label: "图片上传", ms: clientTiming.uploadMs },
        { label: "创建任务", ms: clientTiming.caseCreationMs },
        { label: "图片检查", ms: serverTiming.quality_check_ms },
        { label: "专业模型初筛", ms: serverTiming.kindwise_ms },
        { label: "DeepSeek 复核", ms: serverTiming.llm_review_ms },
        { label: "服务端总处理", ms: serverTiming.total_processing_ms },
        {
          label: "端到端总耗时",
          ms: clientTiming.completedAt && clientTiming.submitStartedAt
            ? clientTiming.completedAt - clientTiming.submitStartedAt
            : undefined,
        },
      ]
        .filter((item) => typeof item.ms === "number")
        .map((item) => ({ label: item.label, value: formatDuration(item.ms as number) }))
      const sizeSummary = clientTiming.originalBytes
        ? `${formatBytes(clientTiming.originalBytes)} → ${formatBytes(clientTiming.storedBytes)}`
        : ""
      this.setData({
        diseaseCase,
        strengthLabel: STRENGTH_LABELS[strength] || "待复核",
        reviewCards: reviews,
        reviewOptions,
        timingRows,
        sizeSummary,
        loading: false,
      })
    } catch (error) {
      this.setData({
        loading: false,
        errorMessage: error instanceof Error ? error.message : "结果加载失败",
      })
    }
  },

  selectReview(event: { currentTarget: { dataset: { filter: string } } }) {
    const filter = event.currentTarget.dataset.filter as string
    const reviews: ModelReview[] = this.data.diseaseCase?.result?.llm_review?.reviews || []
    const reviewCards = filter === "all"
      ? reviews
      : reviews.filter((review) => review.provider === filter)
    this.setData({ reviewFilter: filter, reviewCards })
  },

  startNewCase() {
    wx.reLaunch({ url: "/pages/identify/index" })
  },
})

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} 秒`
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
