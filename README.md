# 林木叶片病害识别工具

## 网页版

现已提供桌面/手机自适应网页：四类图片上传、可选树种与现场备注、专业识别、通用大模型复核、双模型切换、本机记录和接口设置。

前端：React + TypeScript + Vite，位于 `apps/web`。后端复用 `services/api`。默认由用户配置 API，也支持原有开发者解锁通道。

本地运行、GitHub Pages 发布和自有服务器部署见 [WEB_DEPLOY.md](WEB_DEPLOY.md)。识别技术说明见 [识别与大模型复核技术交接.md](识别与大模型复核技术交接.md)。

GitHub Pages 仅托管网页，识别接口需独立部署为 HTTPS 服务；完整同站容器部署使用根目录 `Dockerfile.web`。

以下为原小程序与后端开发说明。

当前仓库正在实现“微信小程序采集 + 云端识别 + 专家网页复核”的林木叶片病害辅助识别系统。

## 当前里程碑

当前已打通端到端识别与可选双模型复核链路：

1. 创建包含 1～4 张叶片图片的病例；
2. 保留正面、背面、病斑近照和健康对照四种图片角色；
3. Kindwise `plant.health` 病害初筛；
4. 当前使用 DeepSeek V4.1 Flash 进行多模态复核；
5. 展示确实证据、支持证据、不确定项、可信度与后续建议；
6. 复核服务失败时仍保留专业接口初筛结果。

当前设置 `LLM_REVIEW_PROVIDERS=deepseek`，只需配置 `DEEPSEEK_API_KEY`。
OpenAI 适配代码暂时保留，但默认不会调用；未配置 DeepSeek 密钥时也不会发起外部调用。

## 启动后端

```powershell
Copy-Item .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

启动后访问：

- API 文档：`http://localhost:8000/docs`
- 健康检查：`http://localhost:8000/health`
- MinIO 控制台：`http://localhost:9001`

## 运行测试

```powershell
docker compose -f infra/docker-compose.yml run --rm api pytest
```

如果 Docker Desktop 尚未启动，也可以使用本机 Python 3.12 隔离环境：

```powershell
Set-Location services/api
uv sync --python C:\Python312\python.exe --extra dev
uv run pytest
uv run uvicorn --app-dir src app.main:app --reload
```

## 打开微信小程序

1. 启动后端 API；
2. 在微信开发者工具中导入 `apps/miniprogram`；
3. 尚无正式 AppID 时使用测试号或游客模式；
4. 开发者工具联调默认请求 `http://127.0.0.1:8000`；
5. 真机联调时，在 `apps/miniprogram/config.ts` 中改成同一局域网内可访问的 HTTPS 地址。

小程序 TypeScript 检查：

```powershell
Set-Location apps/miniprogram
npm install
npm run typecheck
```

## 文档

- `开发实施计划.md`
- `叶片病害识别_API与免训练检索方案.md`
- `林木病害识别工具_API优先技术路线.md`
