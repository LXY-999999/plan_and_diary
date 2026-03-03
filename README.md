# Plan & Diary

一个自用的目标拆解 + 周计划执行 Web App（React + TypeScript + Vite）。

## 功能概览

- 年目标 / 月目标二选一
- 手动拆解链路：目标 → 周目标 → 日目标（上午/下午/晚上）
- 思维导图/树状可视化（React Flow）
- 一周看板（7 天 * 3 时段）
  - 任务可标记 ✅ 完成 / ❌ 未完成
- ChatGPT 自动拆解 7 天计划
  - 输入 OpenAI API Key（仅保存在本地浏览器）
- 主题切换（元气 / 薄荷）
- 本地持久化（localStorage）

## 启动方式

```bash
cd plan_and_diary
npm install
npm run dev
```

浏览器打开控制台显示的本地地址（默认 `http://localhost:5173`）。

## 构建

```bash
npm run build
npm run preview
```

## 使用说明

1. 在“目标入口”设置年目标或月目标。
2. 在“月/年 → 周目标”添加一个或多个周目标，并选中当前要拆解的周目标。
3. 在“周 → 日(早中晚)”手动添加任务。
4. 如需 AI 自动拆解：
   - 输入 OpenAI API Key
   - 点击“自动生成7天早中晚”
5. 在“一周 To-Do”中执行并标记 ✅ / ❌。
6. 所有数据会自动存到本地；可用“清空数据”重置。

## 数据与隐私

- 数据存储在浏览器 `localStorage`（键：`plan_and_diary_v1`）
- OpenAI API Key 也只存本地，不会上传到本项目自建服务器
- 调用 OpenAI 时由浏览器直接请求官方 API

## 已知限制

- 当前树图主要展示到“天”层级，未把每条早/中/晚子任务都画成节点
- AI 拆解依赖网络与有效 API Key
- 未接入用户登录与多端同步

## 像原生 App 使用（PWA）

本项目已接入 PWA（可安装到主屏幕、支持离线缓存静态资源）。

### 部署到 Vercel

1. 将代码推送到 GitHub
2. Vercel 导入仓库（Framework: Vite）
3. Build Command: `npm run build`
4. Output Directory: `dist`

### 手机安装

- iPhone (Safari)：打开站点 → 分享 → 添加到主屏幕
- Android (Chrome)：打开站点 → 菜单 → 添加到主屏幕

安装后会以独立窗口启动，体验更接近原生应用。

## 需求映射（简版）

- 目标入口（年/月）：✅
- 月→周手动拆解：✅
- 周→日（早中晚）手动拆解：✅
- ChatGPT 自动拆解 7 天 * 3 时段：✅
- 思维导图/树可视化：✅
- 一周主界面待办 + 勾叉：✅
- 元气简约风格 + 多主题：✅
- 本地持久化：✅
