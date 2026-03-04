import urllib.request, json

# 测试1: 患者列表（含风险等级）
r = urllib.request.urlopen('http://127.0.0.1:8000/api/v1/patients?page_size=5')
d = json.loads(r.read())
print('=== 患者列表 ===')
for p in d['items']:
    print(f"  {p['name']:6s} phase={p['current_phase']:20s} risk={p['risk_level']}")

# 测试2: 第一个患者的 summary（化验趋势）
pid = d['items'][0]['id']
r2 = urllib.request.urlopen(f'http://127.0.0.1:8000/api/v1/patients/{pid}/summary')
s = json.loads(r2.read())
labs = s['recent_labs']
print(f"\n=== {s['patient']['name']} summary: {len(labs)}条化验 ===")
if labs:
    items = labs[0].get('structured_items', [])
    for it in items:
        print(f"  {it['name']}: {it['value']} {it['unit']}")
print('active_plan:', bool(s['active_plan']))
print('\n✅ e2e 测试通过')
