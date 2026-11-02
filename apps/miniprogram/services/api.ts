import {
  API_MODE,
  CLOUD_ENV_ID,
  CLOUD_SERVICE_NAME,
  LOCAL_API_BASE_URL,
} from "../config"
import type { DiseaseCase, ImageRole, UploadedImage } from "../types/contracts"
import { getProviderAccessInput } from "./settings"

function normalizeData<T>(data: any): T {
  return (typeof data === "string" ? JSON.parse(data) : data) as T
}

function request<T>(path: string, options: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const success = (response: any) => {
      const data = normalizeData<any>(response.data)
      if (response.statusCode >= 200 && response.statusCode < 300) {
        resolve(data as T)
        return
      }
      reject(new Error(data?.detail || `请求失败：${response.statusCode}`))
    }
    const fail = (error: any) => reject(new Error(error.errMsg || "网络连接失败"))
    if (API_MODE === "cloud") {
      Promise.resolve(wx.cloud.callContainer({
        ...options,
        config: { env: CLOUD_ENV_ID },
        path,
        header: {
          "X-WX-SERVICE": CLOUD_SERVICE_NAME,
          ...(options.header as Record<string, string> || {}),
        },
      })).then(success).catch(fail)
      return
    }
    wx.request({ url: `${LOCAL_API_BASE_URL}${path}`, ...options, success, fail })
  })
}

export function uploadImage(filePath: string, role: ImageRole): Promise<UploadedImage> {
  if (API_MODE === "cloud") {
    return uploadCloudImage(filePath, role)
  }
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${LOCAL_API_BASE_URL}/v1/uploads`,
      filePath,
      name: "file",
      formData: { role },
      success(response: any) {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`图片上传失败：${response.statusCode}`))
          return
        }
        try {
          resolve(JSON.parse(response.data) as UploadedImage)
        } catch {
          reject(new Error("服务器返回了无法解析的上传结果"))
        }
      },
      fail(error: any) {
        reject(new Error(error.errMsg || "图片上传失败"))
      },
    })
  })
}

async function uploadCloudImage(filePath: string, role: ImageRole): Promise<UploadedImage> {
  const suffix = filePath.split(".").pop()?.toLowerCase()
  const extension = suffix === "png" || suffix === "webp" ? suffix : "jpg"
  const contentType = extension === "png"
    ? "image/png"
    : extension === "webp"
      ? "image/webp"
      : "image/jpeg"
  const cloudPath = [
    "leaf-cases",
    `${Date.now()}_${Math.random().toString(16).slice(2)}_${role}.${extension}`,
  ].join("/")
  const uploaded = await wx.cloud.uploadFile({ cloudPath, filePath })
  const fileID = uploaded.fileID as string
  try {
    const temporary = await wx.cloud.getTempFileURL({ fileList: [fileID] })
    const item = temporary.fileList?.[0]
    if (!item?.tempFileURL || (item.code && item.code !== "SUCCESS")) {
      throw new Error(item?.errMsg || "无法取得云存储临时地址")
    }
    return await request<UploadedImage>("/v1/uploads/cloud", {
      method: "POST",
      header: { "content-type": "application/json" },
      data: {
        role,
        file_id: fileID,
        temp_url: item.tempFileURL,
        content_type: contentType,
      },
    })
  } finally {
    Promise.resolve(wx.cloud.deleteFile({ fileList: [fileID] })).catch(() => undefined)
  }
}

export function createCase(input: {
  species_input?: string
  images: UploadedImage[]
}): Promise<DiseaseCase> {
  return request<DiseaseCase>("/v1/cases", {
    method: "POST",
    header: {
      "content-type": "application/json",
      "Idempotency-Key": `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    },
    data: {
      ...input,
      access: getProviderAccessInput(),
    },
  })
}

export interface AccessConfiguration {
  question: string
  developer_access_available: boolean
  token_hours: number
}

export interface DeveloperUnlockResult {
  access_token: string
  expires_at: string
  enabled_providers: string[]
}

export function getAccessConfiguration(): Promise<AccessConfiguration> {
  return request<AccessConfiguration>("/v1/access/configuration", { method: "GET" })
}

export function unlockDeveloperAccess(answer: string): Promise<DeveloperUnlockResult> {
  return request<DeveloperUnlockResult>("/v1/access/developer/unlock", {
    method: "POST",
    header: { "content-type": "application/json" },
    data: { answer },
  })
}

export function getCase(caseId: string): Promise<DiseaseCase> {
  return request<DiseaseCase>(`/v1/cases/${caseId}`, {
    method: "GET",
  })
}
