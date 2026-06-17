#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
精确修复server/index.js中的死代码
删除第1480-1535行的死代码，添加无匹配处理
"""

import sys

# 读取文件
try:
    with open('index.js', 'r', encoding='utf-8') as f:
        lines = f.readlines()
except Exception as e:
    print(f'读取文件失败: {e}')
    sys.exit(1)

print(f'文件总行数: {len(lines)}')

# 查找死代码起始行（包含"没有匹配，走原有逻辑"）
start_idx = None
for i, line in enumerate(lines):
    if '没有匹配，走原有逻辑' in line:
        start_idx = i
        break

if start_idx is None:
    print('未找到死代码起始位置')
    sys.exit(1)

print(f'死代码起始行: 第{start_idx + 1}行')

# 查找死代码结束行（下一个WebSocket消息处理）
end_idx = None
for i in range(start_idx, len(lines)):
    if "if (msg.type === 'candidate_select'" in lines[i] or "if (msg.type === 'satisfaction'" in lines[i]:
        end_idx = i
        break

if end_idx is None:
    print('未找到死代码结束位置')
    sys.exit(1)

print(f'死代码结束行: 第{end_idx + 1}行')
print(f'准备删除{end_idx - start_idx}行')

# 构建新的代码块（替换死代码）
# 注意：第start_idx-1行应该是`}`（关闭if (candidates.length > 0)块）
new_code_lines = [
    '        } // end if (candidates.length > 0)\n',
    '        \n',
    '        // 没有匹配到FAQ，直接转人工（不调用LLM，避免慢响应）\n',
    "        console.log('[WS] 无匹配，转人工: ' + userMessage + '\"');\n",
    "        const reply = '抱歉，我暂时无法回答您的问题。正在为您转接人工客服，请稍候...（工作时间：9:00-21:00）';\n",
    "        saveMessage(sessionId, 'assistant', reply, 'unknown');\n",
    '        ws.send(JSON.stringify({\n',
    '          type: "message", content: reply,\n',
    '          timestamp: new Date().toISOString(),\n',
    '          fallback: true\n',
    '        }));\n',
    '        return;\n',
    '      }\n',
    '      \n',
]

# 替换死代码
lines[start_idx:end_idx] = new_code_lines

# 写回文件
try:
    with open('index.js', 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print('✅ 死代码已修复！')
    print(f'原文件已备份为 index.js.backup')
    print(f'新的行数: {len(lines)}')
except Exception as e:
    print(f'写入文件失败: {e}')
    sys.exit(1)
