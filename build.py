import json,urllib.request,time,re,html
def get(u):
    time.sleep(1.1); return json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'night-chorus-prototype'})))
B="https://api.inaturalist.org/v1/"
frogs=[24263,24268,1668858,1668922,25078,65979,65982,1273326,60341,1668927,64988,1668859,64977,65986,24233,64968,66002,24230,1668962,24261,26695,1668953]
groups={'frogs':frogs,'katydids':[118951,48122,84752,122041,225604,326091],
'crickets':[225607,146737,780312,460377,129233,226219,322913,523711,1360980],
'cicadas':[469274,83853,244017,469282,1496502,244334,469268,740041]}
OK={'cc0','cc-by','cc-by-nc','cc-by-sa','cc-by-nc-sa','cc-by-nd','cc-by-nc-nd'}
species=[];al=[]
for g,ids in groups.items():
  tx={t['id']:t for t in get(B+"taxa/"+",".join(map(str,ids)))['results']}
  for i in ids:
    t=tx[i]
    obs=get(B+f"observations?place_id=19&taxon_id={i}&sounds=true&quality_grade=research&per_page=30&order_by=votes")['results']
    snd=[]
    for o in obs:
      for s in o.get('sounds',[]):
        lc=(s.get('license_code') or '').lower()
        if lc in OK and s.get('file_url') and len(snd)<3:
          snd.append({'url':s['file_url'],'recordist':(o['user'].get('name') or o['user']['login']),'license':lc.upper(),'source':f"https://www.inaturalist.org/observations/{o['id']}",'date':o.get('observed_on'),'place':o.get('place_guess')})
    if not snd: print('NO SOUND',t['name']); continue
    h=get(B+f"observations/histogram?interval=month_of_year&place_id=19&taxon_id={i}&verifiable=true")['results']['month_of_year']
    p=t.get('default_photo') or {}
    photo=None
    if (p.get('license_code') or '').lower() in OK: photo={'url':p['medium_url'],'credit':p.get('attribution'),'license':p['license_code'].upper(),'source':f"https://www.inaturalist.org/photos/{p['id']}"}
    summ=re.sub('<[^>]+>','',html.unescape(t.get('wikipedia_summary') or ''))
    species.append({'id':t['name'].lower().replace(' ','-'),'inat_id':i,'group':g,'common':t.get('preferred_common_name') or t['name'],'scientific':t['name'],'summary':summ,'wikipedia':t.get('wikipedia_url'),'months_AL':h,'photo':photo,'sounds':snd})
    al.append(species[-1]['id']); print(g,t['name'],len(snd))
json.dump(species,open('data/species.json','w'),indent=1)
json.dump({'AL':{'name':'Alabama','inat_place_id':19,'species':al,'source':'iNaturalist research-grade observations with sounds, place_id=19'}},open('data/states.json','w'),indent=1)
