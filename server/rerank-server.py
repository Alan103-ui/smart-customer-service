"""
独立的 Rerank 服务（Flask + sentence-transformers）
使用 bge-reranker-v2-m3 模型（专业中文重排序模型）

部署步骤：
1. 安装依赖：pip install flask flask-cors sentence-transformers torch
2. 运行脚本：python rerank-server.py
3. 服务监听：http://0.0.0.0:8000

API 接口：
- POST /rerank
  Body: {"query": "用户查询", "documents": ["文档1", "文档2", ...]}
  Response: {"results": [{"index": 0, "document": "文档1", "score": 0.95}, ...]}

- GET /health
  Response: {"status": "ok", "model": "bge-reranker-v2-m3"}
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import time
import traceback

app = Flask(__name__)
CORS(app)  # 允许跨域

# ============ 加载 Rerank 模型 ============
print("正在加载 bge-reranker-v2-m3 模型...")
reranker = None

try:
    from sentence_transformers import CrossEncoder
    # 使用 HuggingFace 模型（自动下载）
    reranker = CrossEncoder('BAAI/bge-reranker-v2-m3', max_length=512)
    print("✅ 模型加载成功")
except Exception as e:
    print(f"❌ 模型加载失败: {e}")
    print("请先安装依赖：pip install sentence-transformers torch")
    reranker = None

# ============ API 路由 ============

@app.route('/health', methods=['GET'])
def health():
    """健康检查"""
    return jsonify({
        'status': 'ok' if reranker else 'error',
        'model': 'bge-reranker-v2-m3',
        'reranker_loaded': reranker is not None
    })

@app.route('/rerank', methods=['POST'])
def rerank():
    """Rerank 接口"""
    if not reranker:
        return jsonify({'error': 'Rerank 模型未加载，请检查服务端日志'}), 500
    
    try:
        data = request.get_json()
        query = data.get('query', '')
        documents = data.get('documents', [])
        
        if not query or not documents:
            return jsonify({'error': '缺少 query 或 documents 参数'}), 400
        
        # 构造句子对（query, document）
        sentence_pairs = [[query, doc] for doc in documents]
        
        # 计算相关性分数
        scores = reranker.predict(sentence_pairs, show_progress_bar=False)
        
        # 构造返回结果（按分数降序排序）
        results = []
        for i, score in enumerate(scores):
            results.append({
                'index': i,
                'document': documents[i],
                'score': float(score)
            })
        
        # 按分数降序排序
        results.sort(key=lambda x: x['score'], reverse=True)
        
        print(f"[Rerank] 查询: \"{query[:30]}...\", 文档数: {len(documents)}, 耗时: {time.time() - start:.2f}s")
        
        return jsonify({'results': results})
    
    except Exception as e:
        print(f"[Rerank] 错误: {e}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

# ============ 主函数 ============

if __name__ == '__main__':
    import time
    start = time.time()
    
    print("=" * 50)
    print("Rerank 服务启动中...")
    print(f"模型: BAAI/bge-reranker-v2-m3")
    print(f"监听: http://0.0.0.0:8000")
    print(f"健康检查: http://localhost:8000/health")
    print(f"Rerank API: http://localhost:8000/rerank")
    print("=" * 50)
    
    app.run(host='0.0.0.0', port=8000, debug=False)
