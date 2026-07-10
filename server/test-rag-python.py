import urllib.request, json, sys

token = open('data/.token', 'r', encoding='utf-8').read().strip()
port = 3002

def post(path, body):
    data = json.dumps(body, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        f'http://localhost:{port}{path}',
        data=data,
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json; charset=utf-8'},
        method='POST'
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))

def get(path):
    req = urllib.request.Request(
        f'http://localhost:{port}{path}',
        headers={'Authorization': f'Bearer {token}'},
        method='GET'
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode('utf-8'))

print('═' * 60)
print('RAG 系统全面测试（Python）')
print('═' * 60)

# 1. 获取 FAQ 列表
print('\n[1] 获取 FAQ 列表...')
try:
    faqs = get('/api/admin/faq')
    print(f'  ✅ 共 {len(faqs)} 条 FAQ')
    for f in faqs[:3]:
        print(f'    - {f.get("question","?")[:40]}')
except Exception as e:
    print(f'  ❌ 失败: {e}')

# 2. 测试英文关键词
print('\n[2] 测试英文关键词 "business license"...')
try:
    r = post('/api/eval/rag', {'query': 'business license', 'sessionId': 'test-001'})
    print(f'  ✅ 候选数: {r.get("candidateCount", 0)}')
    for c in (r.get('candidates') or [])[:3]:
        print(f'    - {c.get("question","?")[:40]} | conf={c.get("confidence",0):.3f}')
except Exception as e:
    print(f'  ❌ 失败: {e}')

# 3. 测试中文关键词（用 FAQ 里有的问题）
print('\n[3] 测试中文关键词 "营业执照怎么办理"...')
try:
    r = post('/api/eval/rag', {'query': '营业执照怎么办理', 'sessionId': 'test-001'})
    print(f'  ✅ 候选数: {r.get("candidateCount", 0)}')
    for c in (r.get('candidates') or [])[:3]:
        print(f'    - {c.get("question","?")[:40]} | conf={c.get("confidence",0):.3f}')
except Exception as e:
    print(f'  ❌ 失败: {e}')

# 4. 测试语义搜索（直接调用）
print('\n[4] 直接测试 semanticSearch...')
try:
    import subprocess, json
    result = subprocess.run(
        ['node', '-e', '''
        const v = require("./vector-store");
        v.searchByFAQCacheAsync("营业执照怎么办理", null, 5, 0.01, true, true).then(r => {
          console.log(JSON.stringify(r.map(x => ({question: x.question, score: x.score, rerankScore: x.rerankScore})));
        }).catch(e => console.error(e.message));
        '''],
        capture_output=True, text=True, cwd='.'
    )
    if result.returncode == 0:
        data = json.loads(result.stdout)
        print(f'  ✅ 返回 {len(data)} 条')
        for d in data[:3]:
            print(f'    - {d.get("question","?")[:40]} | score={d.get("score",0):.4f} | rerank={d.get("rerankScore",0):.4f}')
    else:
        print(f'  ❌ 失败: {result.stderr[:200]}')
except Exception as e:
    print(f'  ❌ 异常: {e}')

print('\n' + '═' * 60)
print('测试完成')
print('═' * 60)
