// /trace/live — the judge view beside the mirrored phone (PLAN §5.7, §14).

export function traceLivePage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Setu trace</title>
<style>
:root{--bg:#0f1115;--card:#171a21;--fg:#e8e8ea;--mut:#9aa0aa;--ok:#3fb950;--warn:#d29922;--bad:#f85149;--llm:#a371f7;--pol:#58a6ff;--dev:#db6d28}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,"Noto Sans Oriya",sans-serif}
header{position:sticky;top:0;background:var(--bg);padding:10px 16px;border-bottom:1px solid #2a2f3a;display:flex;gap:16px;flex-wrap:wrap;align-items:center}
h1{font-size:16px;margin:0}label{color:var(--mut);font-size:13px}#n{color:var(--mut)}
main{padding:12px 16px;display:flex;flex-direction:column-reverse;gap:10px}
.c{background:var(--card);border:1px solid #2a2f3a;border-radius:8px;padding:10px 12px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.b{font-size:12px;padding:1px 7px;border-radius:10px;border:1px solid currentColor}
.llm{color:var(--llm)}.policy{color:var(--pol)}.device{color:var(--dev)}.ok{color:var(--ok)}.fallback{color:var(--warn)}.failed{color:var(--bad)}.ov{color:var(--warn)}
.chosen{font-weight:600;font-size:15px}.mut{color:var(--mut);font-size:12px}ul{margin:4px 0 0 18px;padding:0}li{margin:1px 0}
table{border-collapse:collapse;font-size:12px;margin-top:4px}td{padding:1px 8px 1px 0;color:var(--mut)}
details summary{cursor:pointer;color:var(--mut);font-size:12px}
</style></head><body>
<header><h1>Setu · live decision trace</h1><span id="n">0 steps</span>
<label><input type="checkbox" id="fOv"> overrides only</label>
<label><input type="checkbox" id="fFb"> fallbacks only</label>
<label>tier <select id="fTier"><option value="">all</option><option>cloud</option><option>weak</option><option>device</option></select></label>
<label>tool <input id="fTool" size="10" placeholder="e.g. teach"></label></header>
<main id="list"></main>
<script>
const list=document.getElementById('list');const all=[];
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function card(t){const d=document.createElement('div');d.className='c';d._t=t;
if(t.kind==='late_generation'){d.innerHTML='<div class="row"><span class="mut">'+new Date(t.at).toLocaleTimeString()+'</span><span class="b">late explanation</span><span class="mut">'+esc(t.conceptId)+' · critic '+esc(t.verdict)+' · '+(t.cached?'cached for next time':'discarded')+'</span></div>';return d}
const tools=(t.tools||[]).map(x=>'<li><b>'+esc(x.tool)+'</b> <span class="'+esc(x.status)+'">'+esc(x.status)+'</span> <span class="mut">'+esc(JSON.stringify(x.args))+(x.note?' — '+esc(x.note):'')+'</span></li>').join('');
const cands=(t.candidates||[]).map(c=>'<tr><td>'+esc(c.action)+'</td><td>'+esc(c.concept)+'</td><td>'+esc(c.score)+'</td></tr>').join('');
const diff=Object.entries(t.state_diff||{}).map(([k,v])=>'<li>'+esc(k)+': '+esc(v)+'</li>').join('');
const calls=(t.llm_calls||[]).map(c=>'<li>'+esc(c.job)+' · '+esc(c.provider||'-')+' · '+esc(c.latency_ms)+' ms · '+esc(c.outcome)+'</li>').join('');
d.innerHTML='<div class="row"><span class="mut">'+new Date(t.at||Date.now()).toLocaleTimeString()+'</span><span class="b">'+esc(t.trigger)+'</span><span class="b '+(t.tier==='device'?'device':'')+'">'+esc(t.tier)+'</span><span class="b '+esc(t.decided_by)+'">decided by '+esc(t.decided_by)+'</span>'+(t.override?'<span class="b ov">override</span>':'')+'<span class="b '+esc(t.status||'ok')+'">'+esc(t.status||'ok')+'</span>'+(t.latency_ms!=null?'<span class="mut">'+t.latency_ms+' ms</span>':'')+'<span class="mut">'+esc(t.profileId||'')+'</span></div>'
+'<div class="chosen">→ '+esc(t.chosen)+'</div><div>'+esc(t.reason)+'</div>'
+(t.why?'<div class="mut">learner sees: “'+esc(t.why)+'”</div>':'')
+(t.fallback_used?'<div class="fallback">fallback: '+esc(t.fallback_used)+'</div>':'')
+'<details open><summary>tools in order</summary><ul>'+tools+'</ul></details>'
+(calls?'<details><summary>LLM calls</summary><ul>'+calls+'</ul></details>':'')
+'<details><summary>facts used · candidates</summary><ul>'+(t.facts_used||[]).map(f=>'<li>'+esc(f)+'</li>').join('')+'</ul><table>'+cands+'</table></details>'
+(t.critic&&t.critic.verdict!=='n/a'?'<details><summary>critic: '+esc(t.critic.verdict)+'</summary><ul>'+t.critic.checks.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></details>':'')
+(diff?'<details open><summary>state change</summary><ul>'+diff+'</ul></details>':'');
return d}
function visible(t){const ov=fOv.checked,fb=fFb.checked,tier=fTier.value,tool=fTool.value.trim();
return(!ov||t.override)&&(!fb||t.fallback_used||t.status==='fallback')&&(!tier||t.tier===tier)&&(!tool||(t.tools||[]).some(x=>x.tool.includes(tool)))}
function add(t){all.push(t);const d=card(t);d.style.display=visible(t)?'':'none';list.appendChild(d);n.textContent=all.length+' steps'}
function refilter(){for(const d of list.children)d.style.display=visible(d._t)?'':'none'}
for(const el of [fOv,fFb,fTier,fTool])el.addEventListener('input',refilter);
const key=new URLSearchParams(location.search).get('key')||'',q=key?'?key='+encodeURIComponent(key):'';
fetch('/api/trace/recent'+q).then(r=>r.json()).then(ts=>ts.forEach(add));
const es=new EventSource('/api/trace/stream'+q);es.addEventListener('trace',e=>{if(e.data)add(JSON.parse(e.data))});
</script></body></html>`;
}
