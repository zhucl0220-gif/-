"""快速测试 /agent/logs 接口"""
import urllib.request, json

try:
    r = urllib.request.urlopen('http://127.0.0.1:8000/api/v1/agent/logs?limit=5')
    d = json.loads(r.read())
    print(f'✅ /agent/logs 返回 {d["total"]} 条记录')
    for item in d['items']:
        steps = len(item.get('steps') or [])
        print(f'  [{item["started_ts"]}] {item["patient_name"]:6s} | {item["status"]:10s} | {steps} 步 | {item["query"][:30]}')
except Exception as e:
    print(f'❌ 请求失败: {e}')
