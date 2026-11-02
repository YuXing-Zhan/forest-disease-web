const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const automator = require("miniprogram-automator")

const projectPath = path.resolve(__dirname, "..")
const cliPath = path.resolve(projectPath, "..", "..", "微信web开发者工具", "cli.bat")
const artifactDir = path.join(__dirname, "artifacts")

async function waitForPage(miniProgram, expectedPath, timeoutMs = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const page = await miniProgram.currentPage()
    if (page && page.path === expectedPath) return page
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  const current = await miniProgram.currentPage()
  throw new Error(`等待页面 ${expectedPath} 超时，当前页面为 ${current?.path || "unknown"}`)
}

async function main() {
  fs.mkdirSync(artifactDir, { recursive: true })
  let miniProgram
  try {
    miniProgram = await automator.connect({ wsEndpoint: "ws://127.0.0.1:9420" })
  } catch {
    miniProgram = await automator.launch({
      cliPath,
      projectPath,
      trustProject: true,
      port: 9420,
      timeout: 60000,
    })
  }

  const consoleMessages = []
  const exceptions = []
  miniProgram.on("console", (entry) => consoleMessages.push(entry))
  miniProgram.on("exception", (entry) => exceptions.push(entry))

  try {
    const identifyPage = await miniProgram.reLaunch("/pages/identify/index")
    await identifyPage.waitFor(500)
    assert.equal(identifyPage.path, "pages/identify/index")

    const initial = await identifyPage.data()
    assert.equal(initial.slots.length, 4)
    assert.equal(initial.canSubmit, false)

    await identifyPage.setData({
      slots: initial.slots.map((slot, index) => ({
        ...slot,
        tempPath: index === 2 ? "mock://lesion.jpg" : "",
      })),
      speciesInput: "杨树",
      canSubmit: true,
    })

    await miniProgram.mockWxMethod("uploadFile", {
      statusCode: 200,
      data: JSON.stringify({
        object_key: "cases/e2e/lesion_closeup.jpg",
        role: "lesion_closeup",
        content_type: "image/jpeg",
        size_bytes: 1024,
      }),
    })

    await identifyPage.callMethod("submit")
    let resultPage
    try {
      resultPage = await waitForPage(miniProgram, "pages/result/index", 15000)
    } catch (error) {
      const currentPage = await miniProgram.currentPage()
      const debugState = {
        currentPage: currentPage?.path,
        pageData: currentPage ? await currentPage.data() : null,
        exceptions,
        consoleMessages,
      }
      await miniProgram.screenshot({ path: path.join(artifactDir, "failure.png") })
      console.error(JSON.stringify(debugState, null, 2))
      throw error
    }
    await resultPage.waitFor(500)

    const resultData = await resultPage.data()
    assert.equal(resultData.loading, false)
    assert.equal(resultData.errorMessage, "")
    assert.equal(resultData.diseaseCase.status, "completed")
    assert.equal(resultData.diseaseCase.result.strength, "D")
    assert.equal(resultData.diseaseCase.species_input, "杨树")
    assert.ok(resultData.diseaseCase.result.information.score > 0)

    const demoReviews = [
      {
        provider: "OpenAI",
        model: "gpt-5.6-sol",
        status: "completed",
        primary_diagnosis: "紫荆假尾孢叶斑病（疑似）",
        conclusion: "症状与初筛候选较吻合，但仅凭照片不能确诊病原。",
        supports_initial_candidate: "支持",
        confidence_level: "中等",
        confidence_basis: "树种、症状形态和属级候选相互支持",
        confirmed_evidence: ["用户提供树种为紫荆", "叶片可见褐色坏死斑"],
        supporting_evidence: ["专业接口首选假尾孢菌属"],
        uncertainties: ["缺少叶背图和显微证据"],
        differential_diagnoses: ["其他真菌性叶斑病"],
        next_actions: ["补拍同一叶片背面"],
        warning: "本结果用于初筛，不构成病原确诊。",
      },
      {
        provider: "DeepSeek",
        model: "deepseek-flash",
        status: "completed",
        primary_diagnosis: "紫荆叶斑病（疑似）",
        conclusion: "总体支持初筛方向，仍需排除其他真菌性叶斑。",
        supports_initial_candidate: "部分支持",
        confidence_level: "中等",
        confidence_basis: "可见症状相符，但可区分特征不足",
        confirmed_evidence: ["病斑呈褐色不规则分布"],
        supporting_evidence: ["宿主关系与候选方向相符"],
        uncertainties: ["单张照片缺少叶背信息"],
        differential_diagnoses: ["炭疽类病害"],
        next_actions: ["补充健康叶片对照"],
        warning: "不要依据本结果直接选择药剂。",
      },
    ]
    const diseaseCaseWithReviews = {
      ...resultData.diseaseCase,
      result: {
        ...resultData.diseaseCase.result,
        llm_review: {
          ...resultData.diseaseCase.result.llm_review,
          status: "completed",
          agreement: "基本一致",
          summary: "两种模型总体支持首选候选，对证据充分程度的判断略有差异。",
          reviews: demoReviews,
        },
      },
    }
    await resultPage.setData({
      diseaseCase: diseaseCaseWithReviews,
      reviewCards: demoReviews,
      reviewOptions: [
        { filter: "all", label: "同时查看" },
        { filter: "OpenAI", label: "GPT-5.6 Sol" },
        { filter: "DeepSeek", label: "DeepSeek" },
      ],
    })
    await resultPage.waitFor(300)
    const reviewData = await resultPage.data()
    assert.equal(reviewData.reviewCards.length, 2)

    await miniProgram.screenshot({ path: path.join(artifactDir, "result.png") })

    if (exceptions.length) {
      throw new Error(`小程序运行异常：${JSON.stringify(exceptions)}`)
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          page: resultPage.path,
          caseId: resultData.diseaseCase.case_id,
          strength: resultData.diseaseCase.result.strength,
          completeness: resultData.diseaseCase.result.information.score,
          screenshot: path.join(artifactDir, "result.png"),
          consoleMessageCount: consoleMessages.length,
        },
        null,
        2,
      ),
    )
  } finally {
    miniProgram.disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
