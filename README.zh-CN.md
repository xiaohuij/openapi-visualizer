<div align="center">

# API Atlas

**你的 API 规范生态地图——在浏览器中可视化、编排与校验。**

[English](./README.md) · [简体中文](./README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-2.0%20%7C%203.0%20%7C%203.1%20%7C%203.2-6BA539)](https://www.openapis.org/)
[![Arazzo](https://img.shields.io/badge/Arazzo-1.0%20%7C%201.1-854CE6)](https://spec.openapis.org/arazzo/latest.html)
[![AsyncAPI](https://img.shields.io/badge/AsyncAPI-2.x%20%7C%203.x-F41D5E)](https://www.asyncapi.com/)
[![React](https://img.shields.io/badge/React-18-61DAFB)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6)](https://www.typescriptlang.org/)

*前身为 OpenAPI Visualizer*

</div>

---

## 我们要解决什么问题

现代 API 生态横跨多种规范格式：

- **OpenAPI** 描述*有哪些*端点以及如何调用
- **Arazzo** 描述*如何*将这些端点串联成业务工作流
- **AsyncAPI** 描述*如何*通过事件驱动通道传递消息

每种规范有自己的工具链，但**没有任何工具能将三者放在一起查看和操作**——尽管真实的业务流程会
跨越所有边界。结果就是视图割裂、手动交叉引用、没有一个统一的地方来校验工作流目标是否真实
存在于 OpenAPI 文档中。

## API Atlas 做什么

API Atlas 是一个**本地优先、基于浏览器**的 API 规范生态工作台。它将这些规范视为一个互联的
模型，而非孤立的文件：

| 界面 | 你可以做什么 |
|---|---|
| **API** | 将 OpenAPI/Swagger 文档作为渐进式分层架构图探索 |
| **Flow** | 基于绑定的 OpenAPI/AsyncAPI 文档，编排、校验和 Mock 执行 Arazzo 工作流 |

可以这样理解：

- **OpenAPI 是地形图**——有哪些端点、Schema 和安全方案
- **Arazzo 是路线图**——走哪条路、按什么顺序、带什么数据
- **AsyncAPI 是气象图**——哪些消息通道朝哪个方向流动

三张地图共存在**同一个图集**中，在你的浏览器里绑定在一起。

## 核心特性

### API 生态可视化

- **渐进式探索：** 根节点 → 路径/Webhook → 操作 → 参数/请求/响应 → Schema → 字段
- **真实关系模型：** 共享 Schema、参数和安全方案保持为可复用节点，而非重复的树结构
- **完整规范覆盖：** OpenAPI 3.2（含 `QUERY`、`additionalOperations`、`$self`、流式媒体类型）、3.1、3.0 和 Swagger 2.0
- **企业级检查器：** 参数、请求体、响应模型、Schema 约束、源码 YAML、入边/出边关系
- **全局搜索：** 端点、操作 ID、Schema、字段、描述、组件名称
- **可视模型导出：** 规范化 JSON 图谱，用于文档和下游分析

### Arazzo 工作流编排

- **Arazzo 原生编排：** 导入、编辑、导出标准 Arazzo 1.0/1.1 YAML/JSON，保留规范扩展并通过往返验证
- **跨文档绑定：** 将 Arazzo `sourceDescriptions` 绑定到本地 OpenAPI 和 AsyncAPI 文档；从不抓取远程 URL
- **语义解析：** `operationId`、`operationPath`（点号与 JSON Pointer 两种形态）、`channelPath` 目标均可对绑定文档解析，附带可行动的诊断
- **官方 Schema 校验：** 内置 Arazzo JSON Schema（draft 2020-12），67 个官方测试夹具全部通过
- **完整选择器引擎：** RFC 9535 JSONPath（过滤器、函数扩展、Nothing 语义）、XPath 1.0、JSON Pointer——校验、条件判定和 Mock 执行共用同一引擎
- **异步步骤建模：** AsyncAPI 通道/操作/消息索引，支持 send/receive 动作、关联 ID 和超时
- **静态执行计划：** 拓扑排序、绑定解析、动态参数追踪、阻塞步骤分析
- **内存 Mock 执行：** DAG 逐步动画播放，含成功/失败/阻塞状态、请求预览（从不发送）和条件求值
- **步骤检查抽屉：** 全屏详情，含目标绑定、异步设置、DAG 依赖、参数映射、输出、源码片段和诊断
- **丰富的步骤卡片：** 动作徽章展示 HTTP 方法、来源、异步动作、参数数量和请求体——方法徽章可点击跳转到 OpenAPI 操作

## 快速开始

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`，点击 **Pet flow** 加载内置演示（OpenAPI + AsyncAPI + Arazzo，已预绑定）。

### 导入你的生态

1. 点击 **打开文件**（或粘贴 YAML/JSON）导入 OpenAPI、Arazzo 或 AsyncAPI 文档
2. 如果导入的是 Arazzo 工作流，请同时导入它引用的文档
3. 在 Flow 界面侧栏中将每个 source description 绑定到兼容的本地文档
4. 工作流 DAG 自动解析——点击任意步骤查看完整详情

### 运行 Mock 执行

```json
{
  "inputs": { "requestId": "req-1", "petId": "pet-1" },
  "examples": {
    "listPets": { "statusCode": 200, "response": { "body": [{ "id": "pet-1", "name": "Rex" }] } },
    "confirmAdoptionEvent": { "message": { "payload": { "status": "confirmed", "petId": "pet-1" } } }
  }
}
```

将此粘贴到 Mock 执行面板并点击 **运行 Mock**——工作流 DAG 逐步动画。不发送任何网络请求。

## 工作流视图

| 视图 | 用途 |
|---|---|
| **执行视图**（默认） | 纯工作流 DAG——仅显示步骤，调用目标以徽章形式合并在步骤卡片中 |
| **结构视图** | 完整文档拓扑——文档 → Source → 工作流 → 步骤 → 目标 |

## 校验管线

每个文档经过四层校验：

1. **解析器校验**——结构要求、版本支持、YAML/JSON 语法
2. **官方 Schema 校验**——内置 Arazzo JSON Schema，给出可行动的错误信息
3. **语义校验**——重复 ID、依赖环、动作形态、目标解析
4. **运行时表达式校验**——JSONPath/XPath 语法、选择器上下文、输入/输出引用

## 架构

```text
浏览器（纯客户端，零网络出站）
├── 应用外壳 & 界面路由（API / Flow）
├── 文档导入（粘贴 / 文件 / 示例）
├── 三套文档引擎
│   ├── OpenAPI 引擎（2.0 → 3.2）
│   ├── Arazzo 解析/序列化（1.0/1.1）
│   └── AsyncAPI 解析器（2.x/3.x）
├── 文档注册表 & 工作区 Store
├── 语义解析器 & 校验器
│   ├── 能力索引（OpenAPI + AsyncAPI）
│   └── 官方 Schema 校验
├── 选择器引擎（JSONPath · XPath · JSON Pointer）
├── 静态计划 & Mock 执行（仅预览）
└── Workflow Studio UI（DAG 画布 · 步骤抽屉 · 编辑器）
```

<details>
<summary>📚 详细文档</summary>

- [Arazzo 架构](./docs/arazzo/architecture.md)——产品范围、架构决策、模块边界
- [Arazzo 路线图](./docs/arazzo/roadmap.md)——交付计划，含 25 个已完成任务
- [ADR-0001](./docs/arazzo/decisions/0001-arazzo-native-workflow-studio.md)——构建 Arazzo 原生工作流工作室
- [官方 Schema 测试语料](./tests/arazzo-schema/)——来自 OAI 仓库的 67 个内置夹具

</details>

## 路线图

| 阶段 | 状态 | 范围 |
|---|---|---|
| OpenAPI 可视化 | ✅ 已完成 | 2.0 → 3.2 渐进图谱、检查器、搜索、导出 |
| Arazzo 工作流编排 | ✅ 已完成 | 1.0/1.1 编排、校验、Mock 执行、选择器引擎 |
| AsyncAPI 文档支持 | ✅ 已完成 | 2.x/3.x 解析、通道/操作索引、异步步骤建模 |
| 真实执行适配器 | 🔜 下一步 | 按需开启的服务端/浏览器 runner，含身份验证 |
| 团队协作 | 📋 规划中 | 共享工作区、评论、版本对比 |
| 更多规范 | 🔍 探索中 | JSON Schema、gRPC/Proto、GraphQL SDL |

## 开发

```bash
npm install        # 安装依赖
npm run dev        # 启动开发服务器
npm run build      # TypeScript 检查 + 生产构建
npm run verify     # 完整验证套件
npm run preview    # 预览生产构建
```

## 隐私

- 所有文档**在浏览器中解析**——不上传任何内容
- 远程 `sourceDescription` URL **从不自动抓取**
- Mock 执行**不发送任何网络请求**
- `localStorage` 仅存储主题、检查器和语言偏好

## 语言

UI 自动检测系统语言（中文/英文），支持通过页面右下角按钮手动切换。

## 许可证

[MIT License](./LICENSE)。内置的 Arazzo JSON Schema 和测试夹具来自
[OAI/Arazzo-Specification 仓库](https://github.com/OAI/Arazzo-Specification)（Apache License 2.0）。
