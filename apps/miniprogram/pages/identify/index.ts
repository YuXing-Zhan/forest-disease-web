import { createCase, uploadImage } from "../../services/api"
import { getProviderStatus } from "../../services/settings"
import type { ImageRole } from "../../types/contracts"

interface ImageSlot {
  role: ImageRole
  title: string
  hint: string
  recommended: boolean
  symptom: boolean
  tempPath: string
  compressionMs: number
}

const INITIAL_SLOTS: ImageSlot[] = [
  {
    role: "leaf_front",
    title: "叶片正面",
    hint: "拍完整叶片及病斑分布",
    recommended: true,
    symptom: true,
    tempPath: "",
    compressionMs: 0,
  },
  {
    role: "leaf_back",
    title: "叶片背面",
    hint: "展示霉层、孢子或虫孔背面",
    recommended: true,
    symptom: true,
    tempPath: "",
    compressionMs: 0,
  },
  {
    role: "lesion_closeup",
    title: "病斑近照",
    hint: "清晰拍摄病健交界和纹理",
    recommended: true,
    symptom: true,
    tempPath: "",
    compressionMs: 0,
  },
  {
    role: "healthy_control",
    title: "健康对照",
    hint: "同树或同树种的健康叶片",
    recommended: true,
    symptom: false,
    tempPath: "",
    compressionMs: 0,
  },
]

Page({
  data: {
    slots: INITIAL_SLOTS,
    speciesInput: "",
    submitting: false,
    canSubmit: false,
    apiReady: false,
    apiStatusText: "尚未配置识别 API",
    errorMessage: "",
  },

  onShow() {
    const status = getProviderStatus()
    this.setData({
      apiReady: status.ready,
      apiStatusText: status.summary,
    })
  },

  openSettings() {
    wx.switchTab({ url: "/pages/settings/index" })
  },

  chooseImage(event: any) {
    const index = Number(event.currentTarget.dataset.index)
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["camera", "album"],
      sizeType: ["compressed"],
      success: async (result: any) => {
        const startedAt = Date.now()
        const originalPath = result.tempFiles[0].tempFilePath
        let tempPath = originalPath
        try {
          const compressed = await new Promise<any>((resolve, reject) => {
            wx.compressImage({ src: originalPath, quality: 82, success: resolve, fail: reject })
          })
          tempPath = compressed.tempFilePath
        } catch {
          // 个别格式无法二次压缩时仍允许使用微信已经压缩过的图片。
        }
        const compressionMs = Date.now() - startedAt
        const slots = this.data.slots.map((slot: ImageSlot, slotIndex: number) =>
          slotIndex === index ? { ...slot, tempPath, compressionMs } : slot,
        )
        this.setData({ slots, canSubmit: this.hasSymptomImage(slots) })
      },
    })
  },

  removeImage(event: any) {
    const index = Number(event.currentTarget.dataset.index)
    const slots = this.data.slots.map((slot: ImageSlot, slotIndex: number) =>
      slotIndex === index ? { ...slot, tempPath: "", compressionMs: 0 } : slot,
    )
    this.setData({ slots, canSubmit: this.hasSymptomImage(slots) })
  },

  hasSymptomImage(slots: ImageSlot[]) {
    return slots.some((slot) => slot.symptom && Boolean(slot.tempPath))
  },

  onSpeciesInput(event: any) {
    this.setData({ speciesInput: event.detail.value })
  },

  async submit() {
    if (!this.data.apiReady) {
      wx.showModal({
        title: "需要配置接口",
        content: "请先填写自己的 API Key，或通过小组验证启用开发者通道。",
        confirmText: "去设置",
        success: (result: any) => {
          if (result.confirm) this.openSettings()
        },
      })
      return
    }
    if (this.data.submitting || !this.hasSymptomImage(this.data.slots)) {
      wx.showToast({ title: "请至少上传一张症状叶片图", icon: "none" })
      return
    }

    this.setData({ submitting: true, errorMessage: "" })
    wx.showLoading({ title: "正在上传", mask: true })
    try {
      const selected = this.data.slots.filter((slot: ImageSlot) => slot.tempPath)
      const submitStartedAt = Date.now()
      const uploadStartedAt = Date.now()
      const images = await Promise.all(
        selected.map((slot: ImageSlot) => uploadImage(slot.tempPath, slot.role)),
      )
      const uploadMs = Date.now() - uploadStartedAt
      const caseCreationStartedAt = Date.now()
      const diseaseCase = await createCase({
        species_input: this.data.speciesInput.trim() || undefined,
        images,
      })
      const caseCreationMs = Date.now() - caseCreationStartedAt
      wx.setStorageSync(`caseTiming:${diseaseCase.case_id}`, {
        compressionMs: selected.reduce(
          (total: number, slot: ImageSlot) => total + slot.compressionMs,
          0,
        ),
        uploadMs,
        caseCreationMs,
        submitStartedAt,
        originalBytes: images.reduce((total, image) => total + image.size_bytes, 0),
        storedBytes: images.reduce((total, image) => total + image.stored_size_bytes, 0),
      })
      wx.hideLoading()
      wx.navigateTo({ url: `/pages/progress/index?caseId=${diseaseCase.case_id}` })
    } catch (error) {
      wx.hideLoading()
      const errorDetails = error as { message?: string; errMsg?: string } | null
      const errorMessage =
        errorDetails?.message || errorDetails?.errMsg || String(error || "请检查网络后重试")
      this.setData({ errorMessage })
      wx.showModal({
        title: "提交失败",
        content: errorMessage,
        showCancel: false,
      })
    } finally {
      this.setData({ submitting: false })
    }
  },
})
