"""Build assets/ai/<project>.json from the files present.
3D captures: assets/ai/3d/<shot>[-<style>].jpg ; renders: assets/ai/render/<shot>[-<style>][-dusk].jpg (+ .thumb.jpg)."""
import json, os, sys
project = sys.argv[1] if len(sys.argv) > 1 else 'apartment'
plan = json.load(open(f'data/{ "house" if project == "townhouse" else project }.json'))
styles = ['original'] + [s['id'] for s in json.load(open('data/styles.json'))['styles']]
shots = []
for sh in plan.get('shots', []):
    renders = {}
    for st in styles:
        suf = '' if st == 'original' else f'-{st}'
        before, after = f'assets/ai/3d/{sh["id"]}{suf}.jpg', f'assets/ai/render/{sh["id"]}{suf}.jpg'
        if not (os.path.exists(before) and os.path.exists(after)): continue
        r = {'before': before, 'after': after}
        if os.path.exists(after.replace('.jpg', '.thumb.jpg')): r['thumb'] = after.replace('.jpg', '.thumb.jpg')
        dusk = f'assets/ai/render/{sh["id"]}{suf}-dusk.jpg'
        if os.path.exists(dusk): r['dusk'] = dusk
        renders[st] = r
    if renders: shots.append({'id': sh['id'], 'name': sh['name'], 'nameEn': sh.get('nameEn', ''), 'renders': renders})
out = {'project': project, 'model': 'Nano Banana Pro via Higgsfield', 'shots': shots}
json.dump(out, open(f'assets/ai/{project}.json', 'w'), ensure_ascii=False, indent=1)
print(f'{len(shots)} shots,', sum(len(s["renders"]) for s in shots), 'renders')
