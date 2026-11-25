import { useEffect, useState } from 'react';
import { TriangleAlert, Utensils } from 'lucide-react';
import { ModuleTitle } from './module-icon';
import { allergenWords } from '../../../packages/core/src/food/allergens';
import type { readRecipe } from '../../../packages/core/src/food/recipes';
import type { weekPlan, shopping } from '../../../packages/core/src/food/week';
import type { previewPlanner } from '../../../packages/core/src/food/planner';
import { parseIngredients } from '../../../packages/core/src/food/ingredients';

type Dish={id:string;name:string};
type Recipe=Awaited<ReturnType<typeof readRecipe>>;
type Ingredient=Recipe['ingredients'][number];
type Week=Awaited<ReturnType<typeof weekPlan>>;
type Item=Awaited<ReturnType<typeof shopping>>['items'][number]&{label:string};
type Preview=Awaited<ReturnType<typeof previewPlanner>>;
type Local=<T>(action:string,data?:unknown)=>Promise<T>;
const kr=(n:number)=>new Intl.NumberFormat('da-DK',{style:'currency',currency:'DKK'}).format(n/100);
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Copenhagen'}).format(new Date());
function add(day:string,n:number){const d=new Date(day+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10);}
const meals={breakfast:'Morgenmad',lunch:'Frokost',dinner:'Aftensmad',snack:'Mellemmåltid'};
const departments=['Frugt og grønt','Kød og fisk','Mejeri','Brød','Kolonial','Frost','Andet'];

export function Food({local,run}:{local:Local;run:(action:()=>Promise<void>)=>Promise<void>}) {
  const [tab,setTab]=useState('Opskrifter'),[day,setDay]=useState(today),[dishes,setDishes]=useState<Dish[]>([]),[week,setWeek]=useState<Week>();
  const [items,setItems]=useState<Item[]>([]),[notice,setNotice]=useState(''),[query,setQuery]=useState(''),[version,reload]=useState(0);
  const [recipe,setRecipe]=useState<Recipe|null>(),[lines,setLines]=useState<Ingredient[]>([]),[paste,setPaste]=useState('');
  const [photos,setPhotos]=useState<Dish[]>([]),[file,setFile]=useState(''),[preview,setPreview]=useState<Preview>([]),[selected,setSelected]=useState<string[]>([]);
  const [include,setInclude]=useState(false),[pick,setPick]=useState<string[]>([]);
  const food=<T,>(op:string,params:object={})=>local<T>('food',{op,day,...params});
  useEffect(()=>{
    let live=true;
    Promise.all([local<Dish[]>('recipes'),local<Week>('food',{op:'week',day}),local<Item[]>('food',{op:'shopping',day}),local<{id:string;ext:string;title:string}[]>('documents')])
      .then(([r,w,i,docs])=>{if(live){setDishes(r);setWeek(w);setItems(i);setPhotos(docs.filter(x=>['jpg','jpeg','png'].includes(x.ext)).map(d=>({id:d.id,name:d.title})));}})
      .catch(e=>{if(live)setNotice(String(e));});return ()=>{live=false;};
  },[local,day,version]);
  const mutate=(op:string,params:object={})=>run(async()=>{await food(op,params);reload(n=>n+1);});
  function edit(id?:string){void run(async()=>{const r=id?await food<Recipe>('read',{id}):null;setRecipe(r);setLines(r?.ingredients??[]);setPaste('');});}
  async function download(ids:string[]){const json=await food<string>('export',{selected:ids});const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='open-planner.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
  return <><ModuleTitle name="Madplan"/><div className="actions">{['Uge','Opskrifter','Indkøbsliste'].map(t=><button key={t} aria-pressed={t===tab} onClick={()=>setTab(t)}>{t}</button>)}</div>
  {tab!=='Opskrifter' && <div className="actions"><button onClick={()=>setDay(add(day,-7))}>Forrige uge</button><label>Uge fra<input type="date" value={day} onChange={e=>{if(e.target.value)setDay(e.target.value);}}/></label><button onClick={()=>setDay(today())}>Denne uge</button><button onClick={()=>setDay(add(day,7))}>Næste uge</button></div>}
  {tab==='Opskrifter' && <><h2>Opskrifter</h2><div className="actions"><button onClick={()=>edit()}>Ny opskrift</button><button onClick={()=>void run(async()=>{const n=await local<number>('addStarterCatalog');reload(v=>v+1);setNotice(n+' retter tilføjet.');})}>Tilføj startkatalog</button></div>
  <label>Søg efter ret<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label>
  {!dishes.length && <p><Utensils aria-hidden="true"/> Saml de retter, du vil bruge i din madplan.</p>}
  <ul className="records">{dishes.filter(d=>d.name.toLowerCase().includes(query.toLowerCase())).map(d=><li key={d.id}><button onClick={()=>edit(d.id)}>{d.name}</button><label><input type="checkbox" checked={pick.includes(d.id)} onChange={e=>setPick(e.target.checked?[...pick,d.id]:pick.filter(id=>id!==d.id))}/>Eksportér</label></li>)}</ul>
  {recipe!==undefined && <form key={String(recipe?.id??'new')} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(async()=>{
    const num=(key:string)=>f.get(key)?Number(f.get(key)):null;
    await food('save',{id:recipe?.id,values:{name:f.get('name'),description:f.get('description'),instructions:f.get('instructions'),servings:num('servings'),prep_minutes:num('prep'),
      estimated_cost_minor:num('price')===null?null:Math.round(Number(f.get('price'))*100),tags:String(f.get('tags')).split(',').map(s=>s.trim()).filter(Boolean),
      allergens:f.getAll('allergens'),ingredients:lines,photo_document_id:f.get('photo')||null}});setRecipe(undefined);reload(v=>v+1);
  });}}><h2>{recipe?'Redigér opskrift':'Ny opskrift'}</h2>
  <label>Navn<input name="name" defaultValue={recipe?.name} required/></label><label>Beskrivelse<textarea name="description" defaultValue={recipe?.description??''}/></label>
  <label>Portioner<input type="number" min="1" required name="servings" defaultValue={recipe?.servings??4}/></label>
  <label>Tid i minutter<input type="number" min="0" name="prep" defaultValue={recipe?.prep_minutes??''}/></label>
  <label>Pris for opskriften i kr.<input type="number" min="0" step=".01" name="price" defaultValue={recipe?.estimated_cost_minor!=null?recipe.estimated_cost_minor/100:''}/></label>
  <label>Tags, adskilt med komma<input name="tags" defaultValue={recipe?.tags.join(', ')}/></label>
  <label>Foto fra arkivet<select name="photo" defaultValue={recipe?.photo_document_id??''}><option value="">Intet foto</option>{photos.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
  <fieldset><legend>Allergener</legend>{Object.entries(allergenWords).map(([k,words])=><label key={k}><input type="checkbox" name="allergens" value={k} defaultChecked={recipe?.allergens.includes(k)}/>{words[0]}</label>)}</fieldset>
  <label>Indsæt ingredienslinjer<textarea value={paste} onChange={e=>setPaste(e.target.value)}/></label><button type="button" onClick={()=>{setLines([...lines,...parseIngredients(paste)]);setPaste('');}}>Tilføj linjer</button>
  <table><thead><tr>{['Mængde','Enhed','Vare','Note',''].map((x,i)=><th key={i}>{x}</th>)}</tr></thead><tbody>{lines.map((line,i)=><tr key={i}>{(['amount','unit','name','note'] as const).map((k,j)=><td key={k}><input aria-label={['Mængde','Enhed','Vare','Note'][j]+' '+(i+1)} type={k==='amount'?'number':'text'} step="any" required={k==='name'} value={line[k]??''} onChange={e=>setLines(lines.map((l,n)=>n===i?{...l,[k]:k==='amount'?(e.target.value?Number(e.target.value):null):e.target.value||null}:l))}/></td>)}<td><button type="button" onClick={()=>setLines(lines.filter((_,n)=>n!==i))}>Fjern</button></td></tr>)}</tbody></table>
  <button type="button" onClick={()=>setLines([...lines,{name:''}])}>Ny ingrediens</button><label>Fremgangsmåde<textarea name="instructions" defaultValue={recipe?.instructions??''}/></label>
  <button>Gem opskrift</button><button type="button" onClick={()=>setRecipe(undefined)}>Annuller</button>
  {recipe && <button type="button" onClick={()=>void run(async()=>{await food('archive',{id:recipe.id});setRecipe(undefined);reload(v=>v+1);})}>Arkivér</button>}</form>}
  <h2>Open Planner</h2><button disabled={!pick.length} onClick={()=>void run(()=>download(pick))}>Eksportér valgte opskrifter</button>
  <label>Importér JSON<input type="file" accept=".json" onChange={e=>{const f=e.target.files?.[0];if(f)void run(async()=>{if(f.size>50*1024*1024)throw Error('Filen er større end 50 MB.');
    const text=await f.text();const rows=await food<Preview>('preview',{values:text});setFile(text);setPreview(rows);setSelected(rows.filter(r=>r.state==='ny').map(r=>r.key));});}}/></label>
  {preview.length>0 && <><p>{['ny','ændret','uændret'].map((s,i)=>preview.filter(r=>r.state===s).length+' '+['nye','ændrede','uændrede'][i]).join(' · ')}</p>{preview.map(r=><label key={r.key}><input type="checkbox" disabled={r.state==='uændret'} checked={selected.includes(r.key)} onChange={e=>setSelected(e.target.checked?[...selected,r.key]:selected.filter(k=>k!==r.key))}/>{r.name} · {r.state}{r.ignored?' · Billedstien ignoreres':''}</label>)}<button onClick={()=>void run(async()=>{await food('apply',{values:file,selected});setPreview([]);setFile('');reload(v=>v+1);})}>Importér valgte</button></>}</>}
  {tab==='Uge' && week && <><h2>Ugens måltider</h2><p>Anslået pris {kr(week.price)} · {week.unpriced} uden pris · Budget {kr(week.budget)} · Forbrug {kr(week.actual)}</p>
  <button onClick={()=>void mutate('copyWeek')}>Kopiér sidste uge</button><button onClick={()=>void run(()=>download(week.entries.flatMap(r=>r.recipe_id?[r.recipe_id]:[])))}>Eksportér ugens retter</button>
  {Array.from({length:7},(_,i)=>add(week.start,i)).map(date=><section key={date}><h3>{new Date(date+'T12:00:00Z').toLocaleDateString('da-DK',{weekday:'long',month:'short',day:'numeric'})}</h3>
  {week.entries.filter(e=>e.plan_date===date).map(r=><div key={r.id}><strong>{meals[r.meal as keyof typeof meals]} · {r.title}</strong>
  {r.warnings?.map(w=><span className="warning-badge" key={w}><TriangleAlert size={16} aria-hidden="true"/>{w}</span>)}
  <label>Flyt til<input type="date" value={date} onChange={e=>{if(e.target.value)void mutate('slot',{id:r.id,values:{meal:r.meal,plan_date:e.target.value,recipe_id:r.recipe_id,title:r.recipe_id?null:r.title,servings:r.servings}});}}/></label></div>)}
  <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const title=String(f.get('title')).trim();const recipe=dishes.find(d=>d.name===title);
    void mutate('slot',{values:{plan_date:date,meal:f.get('meal'),recipe_id:recipe?.id,title:recipe?null:title,servings:Number(f.get('servings'))}});}}>
  <label>Måltid<select name="meal" defaultValue="dinner">{Object.entries(meals).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
  <label>Opskrift eller fri titel<input required list="food-recipes" name="title"/></label><label>Portioner<input required type="number" min="1" name="servings" defaultValue="4"/></label><button>Planlæg</button></form></section>)}
  <datalist id="food-recipes">{dishes.map(d=><option key={d.id} value={d.name}/>)}</datalist></>}
  {tab==='Indkøbsliste' && <><h2>Indkøbsliste</h2><button onClick={()=>void mutate('generate')}>Lav indkøbsliste for ugen</button>{departments.map(cat=><section key={cat}>{items.some(r=>r.category===cat)&&<h3>{cat}</h3>}
  {items.filter(r=>r.category===cat).map(r=><div key={r.id} className="actions"><label><input type="checkbox" checked={Boolean(r.checked)} onChange={e=>void mutate('editShopping',{values:{day,id:r.id,checked:e.target.checked}})}/>{r.label}</label>
  <select aria-label={'Afdeling for '+r.name} value={r.category} onChange={e=>void mutate('editShopping',{values:{day,id:r.id,category:e.target.value}})}>{departments.map(d=><option key={d}>{d}</option>)}</select><button onClick={()=>void mutate('editShopping',{values:{day,id:r.id,remove:true}})}>Slet</button></div>)}</section>)}
  <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void mutate('editShopping',{values:{day,name:f.get('name')}});}}><label>Manuel vare<input name="name" required/></label><button>Tilføj vare</button></form>
  <label><input type="checkbox" checked={include} onChange={e=>setInclude(e.target.checked)}/>Medtag afkrydsede varer</label><button onClick={()=>void run(async()=>{const text=await food<string>('text',{checked:include});await navigator.clipboard.writeText(text);setNotice('Indkøbslisten er kopieret.');})}>Kopiér som tekst</button></>}
  <p role="status">{notice}</p></>;
}
