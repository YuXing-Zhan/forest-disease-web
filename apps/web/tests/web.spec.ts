import { test, expect } from "@playwright/test";

const caseId = "3613f79e-f187-45ba-8f36-a944e96bbf69";
test("desktop and phone show all image roles without horizontal overflow", async ({
  page,
}) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "从一片叶子，读懂树的健康。" }),
    ).toBeVisible();
    await expect(page.getByLabel("选择叶片正面")).toBeAttached();
    expect(await page.locator("input[type=file]").count()).toBe(4);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `../../.web-test/preview-${width}.png`,
      fullPage: true,
    });
  }
});
test("missing images cannot be submitted; unhealthy control alone is insufficient", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "开始识别" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "请至少选择一张症状叶片图片",
  );
  await page
    .getByLabel("选择健康对照")
    .setInputFiles({
      name: "leaf.png",
      mimeType: "image/png",
      buffer: Buffer.from("test-image"),
    });
  await page.getByRole("button", { name: "开始识别" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "请至少选择一张症状叶片图片",
  );
});
test("settings, upload, progress, evidence review, export and history", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/access/configuration")
      return route.fulfill({
        json: { question: "测试问题", developer_access_available: true },
      });
    if (path === "/v1/access/developer/unlock") {
      expect(route.request().postDataJSON().answer).toBe("test-answer");
      return route.fulfill({
        json: {
          access_token: "test-token",
          expires_at: "2099-01-01T00:00:00Z",
          enabled_providers: ["kindwise"],
        },
      });
    }
    if (path === "/v1/uploads")
      return route.fulfill({
        json: { role: "leaf_front", object_key: "test/leaf.jpg" },
      });
    if (path === "/v1/cases") {
      const body = route.request().postDataJSON();
      expect(body.images).toEqual([
        { role: "leaf_front", object_key: "test/leaf.jpg" },
      ]);
      expect(body.species_input).toBe("紫荆");
      expect(body.access.developer_access_token).toBe("test-token");
      return route.fulfill({
        status: 202,
        json: {
          case_id: caseId,
          status: "queued",
          species_input: "紫荆",
          created_at: new Date().toISOString(),
        },
      });
    }
    return route.fulfill({
      json: {
        case_id: caseId,
        status: "completed",
        species_input: "紫荆",
        timings: { total_processing_ms: 3000 },
        result: {
          strength: "C",
          information: {
            score: 40,
            provided: ["树种信息"],
            missing: ["健康对照"],
          },
          candidates: [
            {
              candidate_id: "kindwise:test",
              display_name: "测试叶斑病",
              evidence_level: "中",
              supporting_evidence: ["初筛支持证据"],
              conflicting_evidence: ["缺少镜检"],
            },
          ],
          llm_review: {
            status: "completed",
            agreement: "基本一致",
            summary: "测试复核摘要",
            requested_evidence: [],
            reviews: ["DeepSeek", "OpenAI"].map((provider) => ({
              provider,
              model: "test-model",
              status: "completed",
              primary_diagnosis: "疑似叶斑",
              conclusion: "需要更多证据",
              supports_initial_candidate: "部分支持",
              confidence_level: "中等",
              confidence_basis: "现有图像有限",
              confirmed_evidence: ["可见褐斑"],
              supporting_evidence: ["病斑分布"],
              uncertainties: ["缺少叶背"],
              differential_diagnoses: ["非生物伤害"],
              next_actions: ["补拍叶背"],
              warning: "仅供初筛",
            })),
          },
          next_actions: ["补拍近照"],
          safety_note: "测试安全说明",
        },
      },
    });
  });
  await page.goto("/#settings");
  await page.getByRole("button", { name: "测试连接" }).click();
  await page.getByLabel("测试问题").fill("test-answer");
  await page.getByRole("button", { name: "验证并解锁" }).click();
  await expect(page.getByText("开发者通道已解锁。")).toBeVisible();
  await page.getByRole("link", { name: "病害识别" }).click();
  await page
    .getByLabel("选择叶片正面")
    .setInputFiles({
      name: "leaf.png",
      mimeType: "image/png",
      buffer: Buffer.from("test-image"),
    });
  await page.getByLabel("树种名称").fill("紫荆");
  await page.getByRole("button", { name: "开始识别" }).click();
  await expect(page.getByText("测试叶斑病").first()).toBeVisible();
  await expect(page.getByText("可见褐斑")).toHaveCount(2);
  await page.getByRole("button", { name: "DeepSeek", exact: true }).click();
  await expect(page.getByText("可见褐斑")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出识别报告" }).click();
  expect((await download).suggestedFilename()).toContain(caseId.slice(0, 8));
  await page.getByRole("link", { name: "识别记录" }).click();
  await expect(page.getByRole("button", { name: /紫荆/ })).toBeVisible();
  expect(errors).toEqual([]);
});
test("backend connection error is actionable and does not unlock channel", async ({
  page,
}) => {
  await page.route("**/v1/access/configuration", (route) => route.abort());
  await page.goto("/#settings");
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByRole("alert")).toContainText("无法连接识别后端");
  await expect(page.getByRole("button", { name: "验证并解锁" })).toHaveCount(0);
});
