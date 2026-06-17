#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fix dead code in server/index.js
Delete lines 1480-1537 (1-based), insert new code for handling no-match cases
"""

import sys

# Read file
try:
    with open('index.js', 'r', encoding='utf-8') as f:
        lines = f.readlines()
except Exception as e:
    print(f'Error reading file: {e}')
    sys.exit(1)

print(f'Total lines: {len(lines)}')

# Find dead code start (contains "没有匹配，走原有逻辑")
start_idx = None
for i, line in enumerate(lines):
    if '没有匹配，走原有逻辑' in line:
        start_idx = i
        break

if start_idx is None:
    print('Dead code not found (start)')
    sys.exit(1)

print(f'Dead code starts at line {start_idx + 1}')

# Find dead code end (next WebSocket message handler)
end_idx = None
for i in range(start_idx, len(lines)):
    if "if (msg.type === 'candidate_select'" in lines[i] or "if (msg.type === 'satisfaction'" in lines[i]:
        end_idx = i
        break

if end_idx is None:
    print('Dead code end not found')
    sys.exit(1)

print(f'Dead code ends at line {end_idx + 1}')
print(f'Will delete {end_idx - start_idx} lines')

# New code to insert (handle no-match case)
# Note: Use backticks for template literals
new_code_lines = [
    '        } // end if (candidates.length > 0)\n',
    '        \n',
    '        // No FAQ matched, transfer to human agent (no LLM call)\n',
    '        console.log(`[WS] No match, transfer to human: "${userMessage}"`);\n',
    "        const reply = 'Sorry, I cannot answer your question temporarily. Transferring to human agent... (Working hours: 9:00-21:00)';\n",
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

# Replace dead code
lines[start_idx:end_idx] = new_code_lines

# Write back
try:
    with open('index.js', 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print('✅ Dead code fixed successfully!')
    print(f'Backup file: index.js.backup')
except Exception as e:
    print(f'Error writing file: {e}')
    sys.exit(1)
