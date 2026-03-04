"""
API 自动化测试脚本
测试所有已注册接口是否正常响应
"""
import urllib.request
import urllib.error
import json
import time
import sys

BASE = "http://127.0.0.1:8000"

def get(path):
    try:
        with urllib.request.urlopen(f"{BASE}{path}", timeout=5) as r:
            data = json.loads(r.read())
            return r.status, data
    except urllib.error.HTTPError as e:
        return e.code, {}
    except Exception as e:
        return 0, {"error": str(e)}

def test(name, path, check_fn=None):
    status, data = get(path)
    ok = status == 200 and (check_fn is None or check_fn(data))
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name} -> HTTP {status}")
    if not ok and data:
        print(f"       data={str(data)[:120]}")
    return ok

# 等服务启动
print("Waiting for backend...")
for _ in range(10):
    try:
        urllib.request.urlopen(f"{BASE}/health", timeout=2)
        break
    except:
        time.sleep(1)
else:
    print("FAIL: Backend not started")
    sys.exit(1)

print("=" * 50)
print("API Test Report")
print("=" * 50)

results = []

# 基础接口
results.append(test("健康检查",         "/health",               lambda d: d.get("status") == "healthy"))
results.append(test("根路径",           "/",                     lambda d: "message" in d))
results.append(test("OpenAPI文档",      "/openapi.json",         lambda d: "paths" in d))

# 患者接口
results.append(test("患者列表",         "/api/v1/patients",      lambda d: d.get("total", 0) == 5))
results.append(test("患者列表-搜索",    "/api/v1/patients?search=%E5%BC%A0",  lambda d: d.get("total", 0) >= 1))
results.append(test("患者列表-阶段过滤","/api/v1/patients?phase=recovery",    lambda d: d.get("total", 0) >= 1))

# 获取第一个患者ID
_, list_data = get("/api/v1/patients")
patients = list_data.get("items", [])
if patients:
    pid = patients[0]["id"]
    results.append(test(f"患者详情",        f"/api/v1/patients/{pid}",          lambda d: "name" in d))
    results.append(test(f"患者全览",        f"/api/v1/patients/{pid}/summary",  lambda d: "recent_labs" in d))
    results.append(test(f"化验结果-患者",   f"/api/v1/lab/patient/{pid}",       lambda d: isinstance(d, list) and len(d) > 0))
    # 获取第一个化验ID
    _, lab_list = get(f"/api/v1/lab?patient_id={pid}")
    labs = lab_list.get("items", [])
    if labs:
        lid = labs[0]["id"]
        results.append(test(f"化验详情", f"/api/v1/lab/{lid}", lambda d: "structured_items" in d))

# 化验列表
results.append(test("化验列表",         "/api/v1/lab",           lambda d: len(d.get("items", [])) > 0))

# Agent 接口
results.append(test("Agent任务列表",    "/api/v1/agent/tasks",   lambda d: isinstance(d, (list, dict))))

print("=" * 50)
passed = sum(results)
total = len(results)
print(f"Result: {passed}/{total} passed")
if passed == total:
    print("ALL TESTS PASSED")
else:
    print("SOME TESTS FAILED")
    sys.exit(1)
