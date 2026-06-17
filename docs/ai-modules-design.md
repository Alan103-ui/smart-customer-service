# RAG对话系统核心AI模块设计

> 设计日期：2026-06-15
> 目标系统：广康集团AI助手智能客服系统

---

## 模块1：多轮对话记忆模块

### 功能定义

**核心能力**：
- 自动识别对话上下文关联（指代消解、省略补全）
- 分层存储对话历史（短期记忆 / 长期记忆）
- 智能检索相关历史对话（向量相似度 + 时间衰减）
- 自动维护会话状态（话题追踪、意图演化）

**用户价值**：
- 用户可自然追问（"它多少钱？" → 系统知道"它"指什么）
- 跨轮次信息聚合（"对比下A和B" → 系统记得A和B分别是什么）
- 上下文纠错（"不对，我说的是XX" → 系统能修正前文理解）

---

### 输入输出规格

#### 输入
```typescript
interface MemoryModuleInput {
  // 当前用户输入
  currentQuery: string;

  // 会话元数据
  sessionId: string;
  userId: string;
  timestamp: number;

  // 当前轮次状态
  currentIntent?: string;       // 当前识别的意图
  currentEntities?: Entity[];   // 当前提取的实体

  // 系统输出（上一轮）
  lastResponse?: string;         // 上一轮AI回复
  lastRetrievedDocs?: Doc[];    // 上一轮检索到的文档
}
```

#### 输出
```typescript
interface MemoryModuleOutput {
  // 增强后的查询（补全指代、消歧后）
  enhancedQuery: string;

  // 上下文实体（跨轮次聚合）
  aggregatedEntities: Entity[];

  // 相关历史轮次（按相关性排序）
  relevantHistory: HistoryTurn[];

  // 会话状态
  sessionState: {
    topicChain: string[];      // 话题链（如 ["报销", "材料", "审批"]）
    intentEvolution: string[];  // 意图演化（如 ["query", "compare", "confirm"]）
    unresolvedRefs: string[];   // 未解决的指代（如 ["它", "这个方法"]）
  };

  // 置信度
  confidence: number;           // 0-1，指代消解置信度
  needsClarification: boolean;  // 是否需要向用户确认
}
```

#### 核心数据结构
```typescript
interface HistoryTurn {
  turnId: string;
  query: string;
  response: string;
  intent: string;
  entities: Entity[];
  retrievedDocs: Doc[];
  timestamp: number;
  relevanceScore: number;  // 与当前查询的相关性（0-1）
}

interface Entity {
  type: 'person' | 'org' | 'policy' | 'amount' | 'time' | 'location' | 'other';
  value: string;
  confidence: number;
  source: 'current' | 'history';  // 来自当前轮次还是历史
}
```

---

### 关键边界条件

| 边界场景 | 处理策略 | 降级方案 |
|---------|---------|---------|
| **对话历史超过50轮** | 只保留最近20轮 + 长期记忆摘要 | 摘要由LLM定期生成 |
| **指代消解置信度 < 0.6** | 向用户确认（"您指的是XX吗？"） | 使用当前轮次独立处理 |
| **跨话题跳转（话题链断裂）** | 重置话题链，开始新话题 | 保留历史但不主动关联 |
| **用户明确说"重新开始"** | 清空短期记忆，保留长期记忆 | - |
| **多用户共享会话** | 不支持（sessionId绑定userId） | 报错并提示重新发起会话 |
| **历史轮次检索超时（>500ms）** | 只使用最近5轮 | 跳过历史检索 |
| **实体冲突（前后轮次实体不一致）** | 以最近轮次为准，标记冲突 | 向用户确认 |

---

### 技术实现要点

**存储方案**：
- 短期记忆：Redis（TTL=2小时，自动过期）
- 长期记忆：MongoDB（会话摘要、关键实体、用户画像）
- 向量索引：Milvus/Chroma（历史轮次向量化存储）

**检索策略**：
```
相关性 = 0.7 × 向量相似度 + 0.3 × 时间衰减因子
时间衰减因子 = exp(-Δt / 3600)  // Δt为时间间隔（秒）
```

**性能要求**：
- 记忆检索延迟：< 200ms（P95）
- 存储容量：支持10,000个并发会话

---

## 模块2：LLM智能改写答案模块

### 功能定义

**核心能力**：
- 将FAQ/知识库的标准答案改写为自然对话风格
- 支持多种语气调节（专业、亲切、简洁、详细）
- 支持个性化表达（根据用户画像调整用词）
- 自动添加衔接语、过渡句（消除机械感）

**改写维度**：
- **口语化**："须提供" → "需要您提供"
- **自然化**："根据XX规定" → "根据咱们公司的规定"
- **个性化**：新用户（详细引导）/ 老用户（简洁直接）
- **情感化**：根据问题类型添加共情表达（如投诉类问题先道歉）

---

### 输入输出规格

#### 输入
```typescript
interface RewriteModuleInput {
  // 原始答案（来自FAQ或知识库）
  originalAnswer: string;

  // 用户问题（上下文）
  userQuery: string;

  // 改写配置
  tone: 'professional' | 'friendly' | 'concise' | 'detailed';
  personality?: {
    userName?: string;
    isNewUser: boolean;
    preferredStyle?: string;  // 用户偏好（从画像读取）
  };

  // 对话上下文
  conversationContext?: {
    turnCount: number;       // 当前是对话第几轮
    previousResponse?: string; // 上一轮AI回复（避免重复）
  };

  // 可选：指定改写重点
  emphasis?: string[];  // 如 ["材料清单", "审批时间"]
}
```

#### 输出
```typescript
interface RewriteModuleOutput {
  // 改写后的答案
  rewrittenAnswer: string;

  // 改写详情
  rewriteDetails: {
    originalLength: number;
    rewrittenLength: number;
    changesCount: number;     // 改动处数
    addedEmpathy: boolean;    // 是否添加了共情表达
    addedTransition: boolean;  // 是否添加了过渡语
  };

  // 质量评估
  qualityScore: {
    fluency: number;        // 流畅度（0-1）
    naturalness: number;     // 自然度（0-1）
    completeness: number;    // 信息完整度（0-1）
  };

  // 备选答案（不同语气）
  alternatives?: {
    tone: string;
    answer: string;
  }[];
}
```

---

### 关键边界条件

| 边界场景 | 处理策略 | 降级方案 |
|---------|---------|---------|
| **原始答案为空** | 返回固定提示（"抱歉，我暂时没有找到相关信息"） | - |
| **原始答案过长（>500字）** | 先摘要再改写（避免输出过长） | 分段输出 |
| **改写后流畅度 < 0.7** | 回退到原始答案 | 标记"需要人工审核" |
| **用户指定"原样输出"** | 跳过改写模块 | - |
| **答案包含敏感词** | 先脱敏再改写 | 返回"相关内容不便展示" |
| **改写超时（>3秒）** | 返回原始答案 | - |
| **语气配置无效** | 使用默认语气（friendly） | - |
| **原始答案包含代码/公式** | 保留原格式，只改写文字部分 | - |

---

### 技术实现要点

**Prompt模板**：
```
你是企业客服助手的答案改写员。请将以下标准答案改写为更自然、更口语化的表达。

用户问题：{userQuery}
原始答案：{originalAnswer}
语气要求：{tone}
用户信息：{personality}

改写要求：
1. 保持信息完整，不要遗漏关键点
2. 使用口语化表达，避免书面语
3. 添加适当的过渡语（如"好的"、"明白了"、"这样的话"）
4. 如果是新用户，添加引导性提示
5. 直接返回改写后的答案，不要解释

改写后的答案：
```

**质量评估**：
- 使用小模型（如qwen2.5:3b）快速评估流畅度
- 如果质量不达标，自动重试（最多2次）

**性能要求**：
- 改写延迟：< 1秒（P95）
- 支持批量改写（用于FAQ预改写）

---

## 模块3：智能意图理解模块

### 功能定义

**核心能力**：
- 深层语义解析（不只看关键词，理解真实意图）
- 模糊表达消歧（"这个" → 结合上下文确定指代）
- 多意图拆分（"报销流程和预算申请是啥？" → 两个独立意图）
- 隐含需求推断（用户说"材料太多" → 隐含需求"能否简化流程"）

**意图分类体系**：
```
一级分类：
- 信息查询（query）
- 流程咨询（process）
- 问题投诉（complaint）
- 建议反馈（suggestion）
- 闲聊问候（greeting）

二级分类（以信息查询为例）：
- 查询-政策类（policy）
- 查询-操作类（operation）
- 查询-数据类（data）
```

---

### 输入输出规格

#### 输入
```typescript
interface IntentModuleInput {
  // 用户原始输入
  userQuery: string;

  // 对话上下文（可选）
  context?: {
    previousIntents: string[];  // 前序轮次意图
    sessionTopic: string;        // 当前话题
    userProfile?: UserProfile;   // 用户画像
  };

  // 可选：领域词典（提升识别精度）
  domainTerms?: string[];
}
```

#### 输出
```typescript
interface IntentModuleOutput {
  // 主意图
  primaryIntent: {
    level1: string;          // 一级分类
    level2?: string;         // 二级分类（可选）
    confidence: number;      // 置信度（0-1）
  };

  // 子意图（多意图场景）
  subIntents?: {
    intent: string;
    confidence: number;
    extractedInfo: Record<string, any>;
  }[];

  // 实体提取
  entities: Entity[];

  // 隐含需求（如有）
  implicitNeeds?: {
    need: string;
    confidence: number;
    evidence: string;  // 支持证据（原文片段）
  }[];

  // 消歧结果（如有歧义）
  disambiguation?: {
    ambiguousTerm: string;
    candidates: string[];  // 可能的含义
    needClarification: boolean;
  };

  // 建议的后续动作
  suggestedActions?: string[];
}
```

---

### 关键边界条件

| 边界场景 | 处理策略 | 降级方案 |
|---------|---------|---------|
| **意图置信度 < 0.5** | 向用户确认（"您是想问XX吗？"） | 返回可能的意图列表 |
| **多意图（>3个）** | 只处理前3个，提示用户分步提问 | 合并为单个综合意图 |
| **实体缺失关键信息** | 追问（"请问您说的是哪个城市？"） | 使用默认值或范围查询 |
| **输入为纯表情/符号** | 识别为"闲聊问候"，返回友好提示 | - |
| **输入包含敏感词** | 识别为"违规内容"，拒绝回答 | - |
| **隐含需求置信度 < 0.6** | 不主动推断，只处理显式意图 | - |
| **跨语言输入（中英混合）** | 支持（先翻译再理解） | 提示"请使用中文提问" |
| **输入过长（>200字）** | 截断前200字，标记为"复杂问题" | 引导用户分步提问 |

---

### 技术实现要点

**意图识别流程**：
```
用户query
    ↓
1. 预处理（分词、去除停用词、拼写纠错）
    ↓
2. 多意图检测（LLM + 规则）
    ↓
3. 实体提取（NER模型 / LLM）
    ↓
4. 隐含需求推断（LLM）
    ↓
5. 消歧（如有歧义）
    ↓
输出结构化意图
```

**Prompt模板（意图识别）**：
```
请分析以下用户问题的意图和实体。

用户问题：{userQuery}
对话上下文：{context}

请按以下JSON格式返回：
{
  "primaryIntent": {
    "level1": "一级分类（query/process/complaint/suggestion/greeting）",
    "level2": "二级分类（可选）",
    "confidence": 0.9
  },
  "entities": [
    {"type": "policy", "value": "报销", "confidence": 0.95}
  ],
  "implicitNeeds": [],
  "needClarification": false
}

只返回JSON，不要有其他内容。
```

**性能要求**：
- 意图识别延迟：< 500ms（P95）
- 支持并发：100 QPS

---

## 模块集成架构

```
┌─────────────────────────────────────────────────────────────┐
│                    用户提问                                 │
└────────────────────┬────────────────────────────────────────┘
                     ↓
        ┌────────────────────────────┐
        │   模块3：意图理解模块        │
        │   （最先执行）              │
        └────────────┬───────────────┘
                     ↓ 输出：结构化意图 + 实体
        ┌────────────────────────────┐
        │   模块1：对话记忆模块        │
        │   （增强查询）              │
        └────────────┬───────────────┘
                     ↓ 输出：enhancedQuery + 相关历史
        ┌────────────────────────────┐
        │   RAG检索（BM25 + 向量）   │
        └────────────┬───────────────┘
                     ↓ 输出：retrievedDocs
        ┌────────────────────────────┐
        │   模块2：答案改写模块        │
        │   （最后执行）              │
        └────────────┬───────────────┘
                     ↓ 输出：naturalAnswer
┌────────────────────┴────────────────────────────────────────┐
│                    AI回复用户                                │
└─────────────────────────────────────────────────────────────┘
```

**执行顺序**：
1. 意图理解（最先） → 2. 对话记忆（增强查询） → 3. RAG检索 → 4. 答案改写（最后）

---

## 实施优先级建议

| 模块 | 实施难度 | 用户感知度 | 推荐优先级 |
|-----|---------|-----------|-----------|
| **模块3：意图理解** | 中 | 高（减少误判） | ⭐⭐⭐⭐⭐ 第一优先 |
| **模块1：对话记忆** | 高 | 高（自然追问） | ⭐⭐⭐⭐ 第二优先 |
| **模块2：答案改写** | 低 | 中（提升体验） | ⭐⭐⭐ 第三优先 |

**理由**：
- 意图理解是基础，影响后续所有环节
- 对话记忆用户体验提升最明显（能自然追问）
- 答案改写可以逐步优化，不影响核心功能

---

## 下一步行动

1. **确认设计方案**（当前步骤） ✅
2. **选择优先实施的模块**（1-2个）
3. **我来实现代码**（预计每个模块1-2小时）

**请告诉我您的决定**：
- 按推荐优先级实施（意图理解 → 对话记忆 → 答案改写）
- 自定义顺序（您指定先实施哪几个模块）
- 先实现某个模块的MVP版本（快速验证效果）
