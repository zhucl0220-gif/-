"""测试 /nutrition/plan/{patient_id}"""
import urllib.request, json

# 1. 拿第一个患者 ID
r = urllib.request.urlopen('http://127.0.0.1:8000/api/v1/patients?page_size=5')
patients = json.loads(r.read())['items']
print(f'■ 共 {len(patients)} 位患者\n')

# 2. 分别测试每个患者的营养方案
for p in patients:
    r2 = urllib.request.urlopen(f'http://127.0.0.1:8000/api/v1/nutrition/plan/{p["id"]}')
    plan = json.loads(r2.read())
    t = plan['targets']
    src = '规则' if plan['rule_based'] else f'DB({plan.get("generated_by","")})'
    print(f'  {p["name"]:6s} [{plan["phase_label"]:12s}] 来源:{src:8s} '
          f'热量:{t["energy"]} kcal  蛋白:{t["protein"]} g  '
          f'建议:{len(plan["suggestions"])}条')

print('\n✅ /nutrition/plan 接口正常')
