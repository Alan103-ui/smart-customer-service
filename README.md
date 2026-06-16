# 🤖 广康集团AI助手

基于 **CodeBuddy Agent SDK** 构建的智能客服系统，支持多轮对话、FAQ 知识库检索、自动意图识别、人工转接、对话持久化存储和管理后台。

## ✨ 功能特性

| 功能 | 说明 |
|------|------|
| 🔄 多轮对话 | WebSocket 实时通信，支持连续对话，上下文保持 |
| 📚 FAQ 知识库检索 | 内置 8 条常见客服 FAQ，关键词匹配 + Agent SDK 智能回复 |
| 🎯 自动意图识别 | 自动识别用户意图（退货/配送/支付/账号等），显示置信度 |
| 👨💼 自动转人工 | 无法识别或用户主动请求时自动转接人工客服 |
| 💾 对话持久化 | SQLite 数据库存储所有对话记录，服务器重启不丢失 |
| 📊 管理后台 | 查看对话记录、满意度统计、解决率分析 |
| ⭐ 满意度评价 | 用户可对每次服务进行 1-5 星评价 |

## 🏗️ 技术架构

```
smart-customer-service/
├── server/              # 后端（Express + WebSocket + SQLite）
│   └── index.js        # 主服务，含 FAQ 知识库 + 意图识别 + Agent SDK 集成
├── client/              # 前端（React + Vite + TypeScript + Tailwind）
│   ├── src/
│   │   ├── App.tsx                # 主应用入口
│   │   ├── components/
│   │   │   └── ChatWindow.tsx   # 聊天窗口组件
│   │   └── pages/
│   │       └── AdminDashboard.tsx # 管理后台页面
│   └── vite.config.js
└── data/                # SQLite 数据库目录
```

## 🚀 快速启动

### 1. 安装依赖

```bash
# 后端依赖
cd d:/Clow/projects/smart-customer-service/server
npm install

# 前端依赖
cd ../client
npm install
```

### 2. 配置环境变量（可选）

```bash
# server 目录创建 .env 文件（可选，SDK 会使用默认认证）
# CODEBUDDY_API_KEY=your_key_here
```

### 3. 启动服务

**方式一：分别启动**
```bash
# 终端 1：启动后端
cd d:/Clow/projects/smart-customer-service/server
npm run dev

# 终端 2：启动前端
cd d:/Clow/projects/smart-customer-service/client
npm run dev
```

**方式二：使用启动脚本**
```bash
cd d:/Clow/projects/smart-customer-service
# 使用提供的 start.bat（Windows）
start.bat
```

### 4. 访问应用

- 🖥️ **用户端**：http://localhost:5173
- 📊 **管理后台**：点击用户端右上角「管理后台」按钮
- 🔌 **WebSocket**：ws://localhost:3001/ws
- 🌐 **后端 API**：http://localhost:3001

## 📡 API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/admin/stats` | GET | 获取统计概览（总会话、解决率、人工转接数、平均满意度） |
| `/api/admin/conversations` | GET | 获取对话记录列表（`?limit=100&offset=0`） |
| `/api/admin/conversations/:sessionId` | GET | 获取指定会话详情 |
| `/api/admin/satisfaction` | POST | 提交满意度评价 |

## 🛠️ 自定义 FAQ 知识库

编辑 `server/index.js` 中的 `FAQ_KNOWLEDGE_BASE` 数组：

```javascript
const FAQ_KNOWLEDGE_BASE = [
  {
    id: 'faq_001',
    question: '您的问题？',
    keywords: ['关键词1', '关键词2'],
    answer: '标准回复内容',
    intent: 'intent_name',
    needHuman: false   // true = 触发后自动转人工
  },
  // 添加更多...
];
```

## 🔧 生产环境建议

当前为演示版本，生产部署前建议：

1. **安全隔离**：将 Agent SDK 移到独立容器/服务
2. **持久化升级**：将 SQLite 替换为 MySQL/PostgreSQL
3. **认证鉴权**：为管理后台添加登录认证
4. **人工客服对接**：对接真实的客服系统（如企微、WebSocket 多客服）
5. **FAQ 管理界面**：在管理后台添加 FAQ 的增删改查功能

## 📝 开发说明

- Agent SDK 通过 `query()` API 调用 CodeBuddy 生成智能回复
- 意图识别优先使用本地关键词匹配（快速响应）
- 置信度 < 0.4 时自动转人工
- 所有对话通过 WebSocket 实时推送
- 满意度评价通过 WebSocket 消息类型 `satisfaction` 处理

## 📦 依赖说明

**后端**：`@tencent-ai/agent-sdk`、`express`、`ws`、`better-sqlite3`、`uuid`
**前端**：`react`、`vite`、`typescript`、`uuid`（无 Tailwind 运行时依赖）
