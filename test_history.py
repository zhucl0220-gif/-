import urllib.request, json

r = urllib.request.urlopen('http://127.0.0.1:8000/api/v1/patients?page_size=1')
pid = json.loads(r.read())['items'][0]['id']

r2 = urllib.request.urlopen(f'http://127.0.0.1:8000/api/v1/lab/{pid}/history?limit=6')
d = json.loads(r2.read())
print('patient:', d['patient_name'], '  records:', len(d['history']))
for h in d['history']:
    m = h['metrics']
    print(f"  {h['report_date']}  risk={h['risk_level']:7s}  alb={m.get('albumin')}  pa={m.get('prealbumin')}  alt={m.get('alt')}")
print('\n✅ history 接口验证通过')
