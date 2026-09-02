# Manual AI

将说明书、设备资料与使用经验整理成自己的知识库。支持章节、知识卡片、来源追溯、搜索和可配置 AI。

**[打开浏览器体验版](https://myd9.github.io/manual-ai/)**

## 两种运行方式

| 功能 | GitHub Pages 浏览器版 | 本地完整版 |
| --- | --- | --- |
| 手动新建、编辑、分类、标签、收藏 | 支持 | 支持 |
| 章节排序、卡片、笔记、回收站 | 支持 | 支持 |
| TXT / Markdown 和粘贴文字 | 支持 | 支持 |
| 本地关键词搜索 | 支持 | 支持 |
| 备份 | 浏览器版 JSON 导出与恢复 | SQLite 与附件 ZIP 备份 |
| PDF / Word / 图片解析、OCR、网页提取 | 使用本地完整版 | 支持，部分格式需要额外组件 |
| AI 识别分类、生成章节卡片、资料问答 | 使用本地完整版 | 配置自己的兼容 API 后使用 |
| 向量与混合检索 | 使用本地完整版 | 配置自己的向量 API 后使用 |

GitHub Pages 只提供静态网页，无法运行 Python 后端。浏览器体验版从空资料库开始，数据保存在访问者自己的 `localStorage`，不会调用作者电脑、模型服务或远程数据库。清除站点数据会清除浏览器资料，请定期导出备份；浏览器版备份与本地完整版备份格式不同。

## 本地完整版

主要面向 Windows，密钥加密存储使用 Windows DPAPI。准备 Python 3.11+ 和 Node.js 22.13+：

```powershell
git clone https://github.com/MYD9/manual-ai.git
cd manual-ai
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
npm ci
npm run build
.venv/Scripts/python.exe -X utf8 scripts/launcher.py start
```

打开 `http://127.0.0.1:8765/`。之后可使用仓库内的启动/停止脚本。资料默认保存在当前用户的本地应用数据目录，首次启动为空。

在“设置与备份”中配置自己的服务地址、模型和 API Key。对话与向量可使用不同服务；例如对话使用 DeepSeek，向量使用百炼 `text-embedding-v4`。百炼使用控制台提供的 OpenAI 兼容地址，结尾为 `/compatible-mode/v1`；适配器按每批 10 条建立 v3/v4 向量索引。

`.doc` 等格式转换需要自行安装 LibreOffice。无 AI 配置时，仍能使用手动整理和本地关键词搜索。云端 AI 仅对用户主动启用的资料发送提取文字，处理前请确认适合交给自己选择的服务。

## 开发与验证

```powershell
npm run typecheck
npm test
.venv/Scripts/python.exe -m pytest tests -q
npm run build:pages
```

本地完整前端开发：`npm run dev`，通过代理访问 8765 后端。GitHub Pages 使用独立 Vite 入口和浏览器存储适配器，复用现有组件与动效体系。`main` 分支更新后，GitHub Actions 自动检查、构建并发布 `dist-pages`。

## 公开版本的隐私边界

- 本仓库采用独立的新提交历史，不包含作者本机项目的历史提交。
- 不包含作者的数据库、说明书、PDF、图片附件、对话、API Key、向量索引、日志、备份包或本机交接记录。
- 测试只使用在临时目录中创建的虚构资料，不读取真实资料库。
- GitHub Pages 构建没有模型密钥或后端服务环境变量。页面通过内容安全策略禁止网络 API 请求。
- 公开源码不等于公开个人资料。运行本地版本时，勿把数据目录或密钥添加到 Git。

目前未声明开源许可证；公开访问源码不自动授予额外使用许可。
