import urllib.request, json

r = urllib.request.urlopen('http://127.0.0.1:8000/api/v1/consent/records?page=1&page_size=10')
d = json.loads(r.read())

print(f"is_mock={d['is_mock']}  total={d['total']}")
for item in d['items']:
    print(f"  {item['patient_name']:6s}  {item['document_name']:12s}  "
          f"v={item['version']}  status={item['status']:7s}  pdf={bool(item['pdf_url'])}")

# 测试状态筛选
r2 = urllib.request.urlopen('http://127.0.0.1:8000/api/v1/consent/records?status_filter=pending')
d2 = json.loads(r2.read())
print(f"\npending 筛选: total={d2['total']}  items={[x['patient_name'] for x in d2['items']]}")

print("\n✅ /consent/records 接口正常")
