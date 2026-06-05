# MD Viewer

一个轻量级的 Markdown 文档管理与预览系统，支持分类管理、文档权限控制和 MCP 协议集成。

## 功能特性

- Markdown 实时预览（支持代码高亮、表格、图片等）
- 文档分类管理（Tab 切换、拖拽排序）
- 文档权限控制（公开/私有/密码查看三种模式）
- 暗色模式支持
- MCP 协议集成（AI 助手可直接管理文档）
- Docker 一键部署
- 响应式设计，移动端友好

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| PORT | 服务端口 | 3090 |
| DATA_DIR | 数据目录 | /app/data |
| AUTH_PASSWORD | 登录密码（为空则禁用认证） | 空 |
| SESSION_SECRET | Session 密钥 | 随机生成 |

## 快速开始

### Docker 部署（推荐）

```bash
# 构建镜像
docker build -t md-viewer .

# 运行容器
docker run -d \
  --name md-viewer \
  -p 3929:3090 \
  -v $(pwd)/data/db:/app/data/db \
  -v $(pwd)/data/md:/app/data/md \
  -v $(pwd)/data/config:/app/data/config \
  -e AUTH_PASSWORD=your_password_here \
  md-viewer
```

<details>
<summary>docker-compose.yml 完整示例</summary>

```yaml
version: '3.8'

services:
  md-viewer:
    build: .
    container_name: md-viewer
    restart: unless-stopped
    ports:
      - "3929:3090"
    volumes:
      - ./data/db:/app/data/db
      - ./data/md:/app/data/md
      - ./data/config:/app/data/config
    environment:
      - AUTH_PASSWORD=your_password_here
      - SESSION_SECRET=your_session_secret_here
```

</details>

### 本地运行

```bash
npm install
node src/index.js
```

访问 http://localhost:3090 即可使用。

## MCP 配置

MD Viewer 内置 MCP（Model Context Protocol）端点，AI 助手可通过标准 MCP 协议管理文档。

**端点地址**：`POST /mcp`

**认证方式**：Bearer Token（Token 必须与 `AUTH_PASSWORD` 一致）

### 一键部署（AI Agent Prompt）

将以下 Prompt 发送给任意 AI Agent（Hermes、Claude Code、Cursor 等），自动完成部署和 MCP 配置：

```
帮我部署 md-viewer 并配置 MCP。按顺序执行：

1. 拉取代码：
   git clone https://github.com/apcan/md-viewer.git ~/md-viewer
   cd ~/md-viewer && npm install --registry=https://registry.npmmirror.com

2. 启动服务（后台运行，端口 3929，免密钥）：
   cd ~/md-viewer && nohup node src/index.js > /tmp/md-viewer.log 2>&1 &
   等待 3 秒后检查 http://localhost:3929 是否可访问

3. 根据你当前的客户端类型，自动配置 MCP 连接：
   - Hermes → 在 config.yaml 的 mcp_servers 下添加 md-viewer，transport: http，url: http://localhost:3929/mcp
   - Claude Code → 执行 claude mcp add md-viewer --transport http http://localhost:3929/mcp
   - 其他客户端 → 输出端点信息供用户手动配置

完成后告诉我访问地址和 MCP 配置结果。
```

### Claude Code

```bash
claude mcp add md-viewer --transport http http://localhost:3929/mcp
```

### Hermes Agent

在 `config.yaml` 中添加：

```yaml
mcp_servers:
  md-viewer:
    transport: http
    url: http://localhost:3929/mcp
    headers:
      Authorization: Bearer your_password_here
```

### curl 测试

```bash
# 1. 初始化连接
curl -X POST http://localhost:3929/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_password_here" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

# 2. 列出可用工具
curl -X POST http://localhost:3929/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_password_here" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# 3. 调用工具示例：搜索文档
curl -X POST http://localhost:3929/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_password_here" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_documents","arguments":{"query":"关键词"}}}'
```

## MCP 工具

| 工具名称 | 说明 | 必需参数 | 可选参数 |
|----------|------|----------|----------|
| `list_documents` | 列出所有文档 | — | `category_id` |
| `get_document` | 获取文档详情（含内容和渲染 HTML） | `id` | — |
| `search_documents` | 按文件名或内容关键词搜索文档 | `query` | — |
| `create_document` | 创建新文档 | `filename`, `content` | `category_id` |
| `delete_document` | 删除文档 | `id` | — |
| `list_categories` | 列出所有分类 | — | — |
| `update_document_permission` | 更新文档查看权限 | `id`, `view_permission` | `view_password` |

## API 接口

### 认证相关

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/auth/status` | 否 | 获取认证状态 |
| POST | `/login` | 否 | 用户登录 |
| POST | `/logout` | 否 | 用户登出 |

### 文档管理

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/api/upload` | 否 | 上传 Markdown 文件（multipart/form-data） |
| GET | `/api/documents` | 是 | 获取文档列表，支持 `category_id` 筛选 |
| GET | `/api/documents/:id` | 视权限 | 获取文档内容和渲染 HTML |
| PUT | `/api/documents/:id/category` | 是 | 更新文档分类 |
| PUT | `/api/documents/:id/permission` | 是 | 更新文档查看权限 |
| DELETE | `/api/documents/:id` | 是 | 删除文档 |
| POST | `/api/documents/batch-category` | 是 | 批量更新文档分类 |

### 分类管理

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/categories` | 否 | 获取所有分类 |
| POST | `/api/categories` | 是 | 创建分类 |
| PUT | `/api/categories/:id` | 是 | 更新分类名称 |
| DELETE | `/api/categories/:id` | 是 | 删除分类（"未分类"不可删除） |

### 统计与配置

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/recent-views` | 否 | 最近 10 条浏览记录 |
| GET | `/api/document-counts` | 否 | 按分类统计文档数量 |
| GET | `/api/config` | 是 | 获取系统配置 |
| POST | `/api/config` | 是 | 更新系统配置 |

### 页面路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 文档列表页 |
| GET | `/upload` | 文档上传页 |
| GET | `/view/:id` | Markdown 预览页 |

## 文档权限

每个文档支持三种查看权限模式：

| 权限模式 | 说明 |
|----------|------|
| **公开** (`public`) | 任何人都可以直接查看，无需登录。默认模式 |
| **私有** (`private`) | 需要登录后才能查看，未登录返回 401 |
| **密码查看** (`password`) | 需要输入文档专属密码才能查看，密码错误返回 403 |

> **注意**：如果未设置 `AUTH_PASSWORD` 环境变量，则所有认证保护自动禁用，所有文档均可公开访问。

## 数据持久化

所有数据存放在 `DATA_DIR` 目录（默认 `/app/data`）：

```
/app/data/
├── db/           # SQLite 数据库
│   └── mdviewer.db
├── md/           # 上传的 Markdown 文件
└── config/       # 配置文件
    └── config.json
```

Docker 部署时映射上述三个目录即可持久化所有数据。

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js 18 (Alpine) |
| Web 框架 | Express 4.18 |
| 会话管理 | express-session 1.19 |
| 文件上传 | multer 1.4 |
| 数据库 | better-sqlite3 9.6 (SQLite) |
| Markdown 渲染 | marked 12.0 |
| ID 生成 | uuid 9.0 (v4) |
| 密码加密 | crypto.scryptSync |
| 前端 | Vanilla HTML/CSS/JS（OKLCH 色彩空间 + DM Sans 字体） |
| 容器化 | Docker (node:18-alpine) |

## License

MIT
