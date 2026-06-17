#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
修复server/index.js中的死代码
删除第1480-1536行的死代码，添加无匹配处理
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
    print('未找到死代码（包含"没有匹配，走原有逻辑"）')
    # 尝试查找其他特征
    for i, line in enumerate(lines):
        if 'intentResult.intent' in line and 'intentResult.confidence' in line:
            print(f'找到疑似死代码：第{i+1}行')
            start_idx = i - 5  # 往前5行
            break
    
    if start_idx is None:
        print('未找到死代码，退出')
        sys.exit(1)

print(f'找到死代码起始位置：第{start_idx+1}行')

# 查找死代码结束行（下一个WebSocket消息类型处理）
end_idx = None
for i in range(start_idx, len(lines)):
    if "if (msg.type === 'candidate_select'" in lines[i] or "if (msg.type === 'satisfaction'" in lines[i]:
        end_idx = i
        break

if end_idx is None:
    print('未找到死代码结束位置，尝试查找"} // end WebSocket"')
    for i in range(start_idx, len(lines)):
        if '} // end WebSocket' in lines[i] or "ws.on('close'" in lines[i]:
            end_idx = i
            break
    
    if end_idx is None:
        print('未找到死代码结束位置，退出')
        sys.exit(1)

print(f'找到死代码结束位置：第{end_idx+1}行')
print(f'准备删除{end_idx - start_idx}行')

# 构建新的代码块（替换死代码）
# 注意：第start_idx-1行应该是`}`（关闭if (candidates.length > 0)块）
new_code = '''        } // end if (candidates.length > 0)
        
        // 没有匹配到FAQ，直接转人工（不调用LLM，避免慢响应）
        console.log(`[WS] 无匹配，转人工: "${userMessage}"`);
        const reply = '抱歉，我暂时无法回答您的问题。正在为您转接人工客服，请稍候...（工作时间：9:00-21:00）';
        saveMessage(sessionId, 'assistant', reply, 'unknown');
        ws.send(JSON.stringify({
          type: 'message', content: reply,
          timestamp: new Date().toISOString(),
          fallback: true
        }));
        return;
      }
      
      '''

# 替换死代码
lines[start_idx:end_idx] = [new_code]

# 写回文件
try:
    with open('index.js', 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print('✅ 死代码已修复！')
    print(f'原文件已备份为 index.js.backup')
except Exception as e:
    print(f'写入文件失败: {e}')
    sys.exit(1)
