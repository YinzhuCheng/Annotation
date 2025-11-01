# Local-First LLM-Assisted Annotation System (Cloudflare Pages)

English | [中文](#中文说明)

## Overview
- Fully browser-based. No backend storage; data stays on your device.
- Two modes: Manual and LLM Agent.
- Cloudflare Pages deploys the static site; a Pages Function acts as a secure LLM proxy.

## Quick Start
1. Install Node 18+.
2. Install deps:
   ```bash
   npm i
   ```
3. Dev server:
   ```bash
   npm run dev
   ```
4. Build:
   ```bash
   npm run build
   ```

## Features
- Mode switching with autosave
- LLM config stored locally (API key, model, base URL, provider)
- OCR via Tesseract.js (client-side)
- LaTeX Correction button (uses your configured LLM to produce MathJax-compatible output)
- Image paste/upload preview; composed image path written during export
- Import/Export XLSX with header:
  ```
  id	Question	Question_type	Options	Answer	Subfield	Source	Image	Image_dependency	Academic_Level	Difficulty
  ```

## Cloudflare Pages
- Place the function under `functions/llm.ts` to expose `/api/llm`.
- Connect the repo to Cloudflare Pages and deploy.

---

## 中文说明

### 概述
- 完全前端浏览器实现，不保存到服务器，数据仅存于本地。
- 支持手动模式与 LLM 代理模式。
- 通过 Cloudflare Pages 部署静态站点，并使用 Pages Function 作为安全代理。

### 快速开始
1. 安装 Node 18+。
2. 安装依赖：
   ```bash
   npm i
   ```
3. 启动开发：
   ```bash
   npm run dev
   ```
4. 构建：
   ```bash
   npm run build
   ```

### 功能
- 模式切换与自动保存
- LLM 配置仅保存在本地（API Key、模型、Base URL、服务商）
- 本地 OCR（Tesseract.js）
- LaTeX 纠正按钮（调用已配置的 LLM，输出适配 MathJax 的结果）
- 图片粘贴/上传预览；导出时写入合成图片路径
- 按如下表头导入/导出 XLSX：
  ```
  id	Question	Question_type	Options	Answer	Subfield	Source	Image	Image_dependency	Academic_Level	Difficulty
  ```

### Cloudflare Pages
- 将函数放置于 `functions/llm.ts`，对外提供 `/api/llm`。
- 将仓库连接 Cloudflare Pages 完成部署。
