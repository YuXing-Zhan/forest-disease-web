import { test, expect, type Page } from "@playwright/test";

const health = {
  model_version: "test",
  result: {
    is_plant: { binary: true },
    is_healthy: { binary: false },
    disease: {
      suggestions: [
        {
          id: "test",
          name: "Test leaf spot",
          probability: 0.75,
          details: { local_name: "直连测试叶斑病" },
        },
      ],
    },
  },
};
const review = {
  primary_diagnosis: "疑似叶斑病",
  conclusion: "应补拍叶背",
  supports_initial_candidate: "部分支持",
  confidence_level: "中等",
  confidence_basis: "图像有限",
  confirmed_evidence: ["可见褐色病斑"],
  supporting_evidence: ["病斑形态相符"],
  uncertainties: ["缺少叶背"],
  differential_diagnoses: ["非生物伤害"],
  next_actions: ["补拍叶背"],
  warning: "仅供初筛",
};
async function configure(page: Page, kindwise = true, deepseek = true) {
  await page.goto("/#settings");
  await expect(
    page.getByRole("button", { name: "纯网页直连", exact: true }),
  ).toHaveClass("selected");
  if (kindwise) await page.getByLabel("Kindwise API Key").fill("test-kindwise");
  if (deepseek) await page.getByLabel("DeepSeek API Key").fill("test-deepseek");
  await page.getByRole("button", { name: "保存设置" }).click();
  await page.getByRole("link", { name: "病害识别" }).click();
  const png = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#3f704d";
      ctx.fillRect(0, 0, 16, 16);
      return canvas.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
  await page
    .getByLabel("选择叶片正面")
    .setInputFiles({ name: "leaf.png", mimeType: "image/png", buffer: png });
}
test("direct mode preprocesses images, sends each key only to its provider, stores reports without keys or photos", async ({
  page,
}) => {
  let backendRequests = 0,
    healthCalls = 0,
    reviewCalls = 0;
  page.on("request", (req) => {
    if (new URL(req.url()).pathname.startsWith("/v1/")) backendRequests++;
  });
  await page.route("https://api.plant.id/v3/**", async (route) => {
    healthCalls++;
    expect(route.request().headers()["api-key"]).toBe("test-kindwise");
    expect(route.request().headers().authorization).toBeUndefined();
    const body = route.request().postDataJSON();
    expect(body.images).toHaveLength(1);
    expect(body.images[0]).not.toContain("data:");
    expect(body.similar_images).toBe(true);
    return route.fulfill({ json: health });
  });
  await page.route(
    "https://api.deepseek.com/chat/completions",
    async (route) => {
      reviewCalls++;
      expect(route.request().headers().authorization).toBe(
        "Bearer test-deepseek",
      );
      expect(route.request().headers()["api-key"]).toBeUndefined();
      const body = route.request().postDataJSON();
      expect(body.model).toBe("deepseek-flash");
      expect(body.messages[1].content[1].image_url.url).toMatch(
        /^data:image\/jpeg;base64,/,
      );
      expect(body.messages[1].content[0].text).toContain("直连测试叶斑病");
      return route.fulfill({
        json: { choices: [{ message: { content: JSON.stringify(review) } }] },
      });
    },
  );
  await configure(page);
  await page.getByLabel("树种名称").fill("紫荆");
  await page.getByRole("button", { name: "开始识别" }).click();
  await expect(page.getByText("可见褐色病斑")).toBeVisible();
  const archive = await page.evaluate(() =>
    localStorage.getItem("forest-web-history-v1"),
  );
  expect(archive).not.toContain("test-kindwise");
  expect(archive).not.toContain("test-deepseek");
  expect(archive).not.toContain("base64");
  await page.reload();
  await page.getByRole("link", { name: "识别记录" }).click();
  await page.getByRole("button", { name: /紫荆/ }).click();
  await expect(page.getByText("可见褐色病斑")).toBeVisible();
  expect(backendRequests).toBe(0);
  expect(healthCalls).toBe(1);
  expect(reviewCalls).toBe(1);
});
test("invalid model JSON keeps real professional screening and labels review failure", async ({
  page,
}) => {
  await page.route("https://api.plant.id/v3/**", (route) =>
    route.fulfill({ json: health }),
  );
  await page.route("https://api.deepseek.com/chat/completions", (route) =>
    route.fulfill({
      json: {
        choices: [{ message: { content: '{"conclusion": "incomplete"}' } }],
      },
    }),
  );
  await configure(page);
  await page.getByRole("button", { name: "开始识别" }).click();
  await expect(page.getByText("直连测试叶斑病").first()).toBeVisible();
  await expect(page.getByText(/DeepSeek 本次复核失败/)).toBeVisible();
  await expect(page.getByText("模拟候选")).toHaveCount(0);
});
test("professional API authentication failure produces no simulated diagnosis or saved report", async ({
  page,
}) => {
  await page.route("https://api.plant.id/v3/**", (route) =>
    route.fulfill({
      status: 401,
      json: { error: "do-not-expose-provider-body" },
    }),
  );
  await configure(page, true, false);
  await page.getByRole("button", { name: "开始识别" }).click();
  await expect(page.getByRole("alert")).toContainText("密钥无效或已过期");
  await expect(page.getByRole("alert")).not.toContainText("do-not-expose");
  expect(
    await page.evaluate(() => localStorage.getItem("forest-web-history-v1")),
  ).toBeNull();
});
test("model-only mode states missing professional screening and uses strength D", async ({
  page,
}) => {
  await page.route("https://api.deepseek.com/chat/completions", (route) =>
    route.fulfill({
      json: { choices: [{ message: { content: JSON.stringify(review) } }] },
    }),
  );
  await configure(page, false, true);
  await page.getByRole("button", { name: "开始识别" }).click();
  await expect(
    page.getByText("专业初筛不可用，以下仅为 DeepSeek 图片观察与建议。"),
  ).toBeVisible();
  await expect(page.locator(".strength strong")).toHaveText("D");
});
test("key check uses only non-inference endpoints and invalid images never reach providers", async ({
  page,
}) => {
  const calls: string[] = [];
  await page.route("https://api.plant.id/v3/**", (route) => {
    calls.push(route.request().url());
    return route.fulfill({ json: {} });
  });
  await page.route("https://api.deepseek.com/**", (route) => {
    calls.push(route.request().url());
    return route.fulfill({ json: { data: [] } });
  });
  await configure(page);
  await page.getByRole("link", { name: "接口设置" }).click();
  await page.getByRole("button", { name: "检查密钥连接" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Kindwise 鉴权通过；DeepSeek 鉴权通过",
  );
  expect(calls.sort()).toEqual([
    "https://api.deepseek.com/models",
    "https://api.plant.id/v3/usage_info",
  ]);
  await page.getByRole("link", { name: "病害识别" }).click();
  await page
    .getByLabel("选择叶片正面")
    .setInputFiles({
      name: "bad.png",
      mimeType: "image/png",
      buffer: Buffer.from("not-an-image"),
    });
  await page.getByRole("button", { name: "开始识别" }).click();
  await expect(page.getByRole("alert")).toContainText("图片无法解码");
  expect(calls).toHaveLength(2);
});
