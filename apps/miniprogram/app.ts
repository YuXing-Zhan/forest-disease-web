import { API_MODE, CLOUD_ENV_ID, CLOUD_SERVICE_NAME, LOCAL_API_BASE_URL } from "./config"

App({
  globalData: {},

  onLaunch() {
    if (API_MODE === "cloud") {
      wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true })
      // 用户选图期间提前唤醒按量计费服务，隐藏冷启动等待。
      Promise.resolve(wx.cloud.callContainer({
        config: { env: CLOUD_ENV_ID },
        path: "/health",
        method: "GET",
        header: { "X-WX-SERVICE": CLOUD_SERVICE_NAME },
      })).catch(() => undefined)
      return
    }
    wx.request({
      url: `${LOCAL_API_BASE_URL}/health`,
      method: "GET",
      timeout: 8000,
      fail: () => undefined,
    })
  },
})
