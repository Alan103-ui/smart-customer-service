import urllib.request, json, time

BASE = '<INTERNAL_URL_REMOVED>

def test(query, session_id):
    data = json.dumps({'message': query, 'sessionId': session_id}).encode()
    req = urllib.request.Request(BASE, data=data, headers={'Content-Type': 'application/json'})
    t0 = time.time()
    resp = urllib.request.urlopen(req, timeout=90)
    result = json.loads(resp.read().decode())
    elapsed = time.time() - t0
    return result, elapsed

print('=== RAG 优化测试（含 Rerank）===')
print()

# 测试1：短查询（触发查询改写）
print('[测试1] 短查询 + 查询改写')
result, t = test('报销', 'test-1')
print(f'  查询: 报销')
print(f'  回复: {result.get("reply", "")[:100]}')
print(f'  意图: {result.get("intent", "")}')
print(f'  耗时: {t:.2f}s')
print()

# 测试2：标准查询
print('[测试2] 标准查询')
result, t = test('如何申请费用报销', 'test-2')
print(f'  查询: 如何申请费用报销')
print(f'  回复: {result.get("reply", "")[:100]}')
print(f'  意图: {result.get("intent", "")}')
print(f'  耗时: {t:.2f}s')
print()

# 测试3：检查后端日志中的 Rerank 调用
print('[测试3] 检查 Rerank 是否生效')
print('  请查看后端控制台输出，应看到类似日志：')
print('  [Rerank] 查询: ...  文档数: N  耗时: Xs')
print()

print('=== 测试完成 ===')
