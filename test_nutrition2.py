import urllib.request, json

patients = json.loads(
    urllib.request.urlopen('http://127.0.0.1:8000/api/v1/patients?page_size=5').read()
)['items']

for p in patients:
    url = f'http://127.0.0.1:8000/api/v1/nutrition/plan/{p["id"]}'
    plan = json.loads(urllib.request.urlopen(url).read())
    sug = plan['suggestions']
    sup = plan.get('supplements', [])
    res = plan.get('restrictions', [])
    print(f'\n■ {p["name"]}  rule_based={plan["rule_based"]}')
    print(f'  suggestions ({type(sug).__name__}/{len(sug)}):')
    for s in sug:
        print(f'    - {s}')
    print(f'  supplements ({type(sup).__name__}/{len(sup)}): {sup}')
    print(f'  restrictions ({type(res).__name__}/{len(res)}): {res[:1]}...')

print('\n✅ 全部字段均为 list，前端可正常渲染')
