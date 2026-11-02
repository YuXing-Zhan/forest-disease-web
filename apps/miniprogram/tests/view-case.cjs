const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const automator = require("miniprogram-automator")

const caseId = process.argv[2]
assert.match(caseId || "", /^[0-9a-f-]{36}$/i, "请提供有效的病例编号")

const projectPath = path.resolve(__dirname, "..")
const cliPath = path.resolve(projectPath, "..", "..", "微信web开发者工具", "cli.bat")
const artifactDir = path.join(__dirname, "artifacts")

async function waitForResult(page, timeoutMs = 15000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const data = await page.data()
    if (!data.loading) return data
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error("等待真实病例结果页超时")
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

  try {
    const page = await miniProgram.reLaunch(`/pages/result/index?caseId=${caseId}`)
    const data = await waitForResult(page)
    assert.equal(data.errorMessage, "")
    assert.equal(data.diseaseCase.case_id, caseId)
    assert.equal(data.diseaseCase.result.llm_review.reviews.length, 1)
    assert.equal(data.diseaseCase.result.llm_review.reviews[0].provider, "DeepSeek")

    const screenshot = path.join(artifactDir, "deepseek-real-result.png")
    await miniProgram.screenshot({ path: screenshot })
    console.log(JSON.stringify({
      ok: true,
      caseId,
      strength: data.diseaseCase.result.strength,
      completeness: data.diseaseCase.result.information.score,
      llmStatus: data.diseaseCase.result.llm_review.status,
      model: data.diseaseCase.result.llm_review.reviews[0].model,
      screenshot,
    }, null, 2))
  } finally {
    miniProgram.disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
