# 网页版与 GitHub 上线说明

目标仓库：`YuXing-Zhan/forest-disease-web`。网页位于 `apps/web`，原识别后端位于 `services/api`。小程序代码保留在本地用于参考。

## 本地体验

需要 Node.js 22+、Python 3.12。两个终端分别执行：

```powershell
cd services/api
uv sync --extra dev
uv run uvicorn --app-dir src app.main:app --host 127.0.0.1 --port 8000
```

```powershell
cd apps/web
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173`。开发服务器自动转发 `/v1` 请求到本机 8000 端口。进入“接口设置”，后端地址留空，测试连接，填写自己的 Kindwise / DeepSeek 密钥并保存。也可在后端配置服务端密钥后，通过原开发者问题解锁通道。

个人密钥和开发者令牌使用 `sessionStorage`，默认只在当前浏览器会话保留。关闭后浏览器恢复会话可能保留，应使用“清除个人密钥/退出开发者通道”主动清除。记录仅在 `localStorage` 保存任务编号、树种、时间与后端地址，不存密钥和照片。

## GitHub Pages 发布

1. 在仓库 Settings → Pages → Build and deployment 中选择 **GitHub Actions**。
2. 在 Settings → Secrets and variables → Actions → Variables 中添加 `VITE_API_BASE_URL`，值为可公开访问的 HTTPS **后端根地址**，例如 `https://api.example.com`。这里不填写任何 API 密钥。
3. 后端环境设置 `CORS_ORIGINS=https://yuxing-zhan.github.io`。允许多个来源时用英文逗号分隔；来源不包含 `/forest-disease-web` 路径。
4. 推送 `main`，或在 Actions 中手动运行 `Deploy web to GitHub Pages`。
5. 预期网页地址：`https://yuxing-zhan.github.io/forest-disease-web/`。实际以成功工作流输出的地址为准。

未设置 `VITE_API_BASE_URL` 时网页仍可打开，用户需在“接口设置”自行填写后端地址。GitHub Pages 仅运行静态网页，不能运行 Python 后端。只有网页部署成功不能证明真实识别服务已经上线。

原微信 `wx.cloud.callContainer` 通道不能直接由普通浏览器调用。继续使用现有云托管后端时，必须为其配置浏览器能访问的 HTTPS 入口与跨域来源；仅配置 MINIAPP 访问的服务不可直接复用。

## 自有服务器：网页与接口一起部署

仓库根目录提供 `Dockerfile.web` 和 `compose.web.yaml`：

```powershell
Copy-Item .env.web.example .env.web
docker compose -f compose.web.yaml up -d --build
```

访问 `http://127.0.0.1:8000`。生产环境在前面配置 Nginx/Caddy 的 HTTPS 域名反向代理到 8000。`compose.web.yaml` 仅绑定本机回环地址，避免跳过 HTTPS 代理公开服务。若所有用户填写自己的 API，服务端密钥可留空。

如需开发者通道，将 `KINDWISE_API_KEY`、`DEEPSEEK_API_KEY` 和独立的 `DEVELOPER_ACCESS_SECRET` 放在服务器 `.env.web` 中，使用实际支持图片输入的复核模型。`.env.web` 被 Git 忽略。SQLite 与上传目录保存在 Docker 命名卷中；当前方案按单实例运行，后台任务随进程重启可能中断，大规模运行前应改持久化任务队列和对象存储。

## 验证与发布边界

```powershell
cd apps/web
npm run build
npm test
```

本机浏览器测试使用已安装的 Chrome；CI 自动安装 Chromium。自动测试模拟外部模型返回，覆盖四图输入、缺图拦截、配置与解锁、上传与查询、双模型查看、报告下载、历史记录与连接失败；不会消耗真实 API 额度。

后端测试：在 `services/api` 执行 `uv run pytest -q`。真实识别验收还需使用可用的 API 密钥和带标注的叶片图片。专业服务失败时页面会明确标注模拟候选，不能作为识别成功。

首次推送只应包含源码、锁文件、测试和部署文档。不要上传 `.env`、预览二维码、开发者工具目录、数据库或用户照片。
