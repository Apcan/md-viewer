# MD Viewer

Markdown 文档在线查看器，支持分类、标签、版本管理、权限控制。

## 技术栈
- 后端：Node.js + Express + better-sqlite3
- 前端：原生 HTML/CSS/JS（无框架）
- 部署：Docker，镜像推送到阿里云 ACR

## 项目结构
- `src/index.js` — 后端入口（1572行，需要重构拆分）
- `public/*.html` — 前端页面（内联 CSS/JS，需要拆分）
- `Dockerfile` — Docker 构建

## 关键约束
- 数据目录：/app/data（Docker 内）
- 端口：3090
- 认证：AUTH_PASSWORD 环境变量
- 权限：文档有 public/private/password 三种

## 部署
```bash
docker build -t crpi-euirnll46jx3ex3l.cn-hangzhou.personal.cr.aliyuncs.com/apcan/md-viewer:latest .
docker push crpi-euirnll46jx3ex3l.cn-hangzhou.personal.cr.aliyuncs.com/apcan/md-viewer:latest
```
