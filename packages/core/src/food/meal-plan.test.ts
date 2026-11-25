import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach,afterEach,it,expect } from 'vitest';
import { openArchive,type Archive } from '../archive';
import { createUser } from '../repo/users';
import { searchRecords } from '../repo/search';
import { listDocuments } from '../repo/documents';
import { saveRecipe,readRecipe,archiveRecipe,allergyWarnings } from './recipes';
import { saveSlot,copyWeek,weekPlan,generateShopping,editShopping,shoppingText } from './week';
import { applyPlanner,exportPlanner,previewPlanner } from './planner';

let a: Archive;
const ctx={via:'ui'} as const;
beforeEach(async()=>{a=await openArchive(await mkdtemp(join(tmpdir(),'ppm-food-')),{create:true});});
afterEach(async()=>{await a.close();await rm(a.root,{recursive:true,force:true});});

it('indexes ingredients, replaces and audits rows atomically and archives the recipe',async()=>{
  const id=await saveRecipe(a.db,ctx,{name:'Gryde',ingredients:'100 g linser',tags:['hurtig']});
  expect(await searchRecords(a.db,'linser')).toHaveLength(1);
  await saveRecipe(a.db,ctx,{name:'Gryde',ingredients:'2 dl fløde'},id);
  expect((await readRecipe(a.db,id)).ingredients[0].name).toBe('fløde');
  expect(await searchRecords(a.db,'linser')).toHaveLength(0);
  expect(await a.db.select("SELECT action FROM audit_log WHERE entity_type='recipe_ingredient' ORDER BY rowid")).toEqual([{action:'create'},{action:'delete'},{action:'create'}]);
  await a.db.executeScript("CREATE TRIGGER reject_test BEFORE INSERT ON recipe_ingredient BEGIN SELECT RAISE(ABORT,'test'); END;");
  await expect(saveRecipe(a.db,ctx,{name:'Ny',ingredients:'1 løg'},id)).rejects.toThrow();
  expect((await readRecipe(a.db,id)).ingredients[0].name).toBe('fløde');
  await archiveRecipe(a.db,ctx,id);expect(await searchRecords(a.db,'Gryde')).toHaveLength(0);
});

it('resolves marked and derived allergens without disclosing private people or substances',async()=>{
  const owner=await createUser(a.db,{name:'Demo',personName:'Testperson'});
  await a.db.execute('UPDATE person SET health_private_user_id=?',[owner]);
  await a.db.execute("INSERT INTO health_allergy(id,person_id,substance) SELECT ?,id,'Mælk' FROM person",[crypto.randomUUID()]);
  const id=await saveRecipe(a.db,ctx,{name:'Suppe',ingredients:'1 dl kokosmælk'});
  expect(await allergyWarnings(a.db,id,owner)).toEqual(['Mælk (Testperson)']);
  expect(await allergyWarnings(a.db,id)).toEqual(['Allergi hos et husstandsmedlem (privat)']);
  await saveRecipe(a.db,ctx,{name:'Mælk'},id);expect(await allergyWarnings(a.db,id)).toEqual([]);
  await saveRecipe(a.db,ctx,{name:'Suppe',allergens:['milk']},id);expect(await allergyWarnings(a.db,id)).toHaveLength(1);
});
it('scales portions, counts unpriced recipes, prorates across months and copies previous meals',async()=>{
  const id=await saveRecipe(a.db,ctx,{name:'Suppe',servings:4,estimated_cost_minor:800});
  const other=await saveRecipe(a.db,ctx,{name:'Ukendt'});
  const day='2026-11-30',category=crypto.randomUUID(),budget=crypto.randomUUID();
  await a.db.execute("INSERT INTO category(id,name,kind) VALUES (?,'Mad og dagligvarer','expense')",[category]);
  await a.db.execute("INSERT INTO budget(id,name,year) VALUES (?,'Test',2026)",[budget]);
  for(const [month,n] of [[11,30000],[12,62000]]) await a.db.execute('INSERT INTO budget_line(id,budget_id,category_id,month,amount_minor) VALUES (?,?,?,?,?)',[crypto.randomUUID(),budget,category,month,n]);
  await saveSlot(a.db,ctx,{plan_date:day,recipe_id:id,servings:2});
  await saveSlot(a.db,ctx,{plan_date:day,recipe_id:other});await saveSlot(a.db,ctx,{plan_date:day,title:'Rester'});
  expect(await weekPlan(a.db,day)).toMatchObject({price:400,unpriced:1,budget:13000});
  expect(await copyWeek(a.db,ctx,'2026-12-07')).toBe(3);
});
it('aggregates compatible units and preserves manual items, checks and departments',async()=>{
  const id=await saveRecipe(a.db,ctx,{name:'Suppe',servings:2,ingredients:['1 kg kartofler','500 g kartofler','2 dl mælk','1 l mælk','salt','salt']});
  const day='2026-11-24';await saveSlot(a.db,ctx,{plan_date:day,recipe_id:id,servings:1});
  let {items}=await generateShopping(a.db,ctx,day);
  expect(items).toEqual(expect.arrayContaining([expect.objectContaining({name:'kartofler',amount:750,unit:'g'}),expect.objectContaining({name:'mælk',amount:600,unit:'ml'}),expect.objectContaining({name:'salt',amount:1,unit:'retter'})]));
  await editShopping(a.db,ctx,{day,id:items.find(i=>i.name==='salt')!.id,checked:true,category:'Andet'});
  await editShopping(a.db,ctx,{day,name:'Sæbe'});items=(await generateShopping(a.db,ctx,day)).items;
  expect(items.find(i=>i.name==='salt')).toMatchObject({checked:1,category:'Andet'});
  expect(shoppingText(items,false)).not.toContain('salt');expect(shoppingText(items,true)).toContain('salt (1 retter)');
  expect(items.find(i=>i.name==='Sæbe')?.source).toBe('manual');
});
it('imports both Open Planner fixtures, protects edits and exports the linked photo',async()=>{
  const file=(v:number)=>readFile(new URL('../../../../fixtures/open-planner/v'+v+'.json',import.meta.url),'utf8');
  for(const v of [1,2]) {const raw=await file(v);const rows=await previewPlanner(a.db,raw);if(v===1)expect(rows.some(r=>r.ignored)).toBe(true);
    if(v===2)expect(rows.some(r=>r.state==='ændret')).toBe(true);await applyPlanner(a,ctx,raw,rows.map(r=>r.key));}
  const [r]=await a.db.select<{id:string}>("SELECT id FROM recipe WHERE source_ref='open-planner:pasta-med-kodsovs'");
  const out=JSON.parse(await exportPlanner(a,[r.id]));expect(out.retter[0].billede).toMatch(/^data:image\/png;base64,/);
  expect((await listDocuments(a.db)).some(d=>d.linked)).toBe(true);
  const empty=JSON.stringify({version:1,retter:[{id:'pasta-med-kodsovs',navn:'Pasta med kødsovs',ingredienser:[],opskrift:''}]});
  expect((await previewPlanner(a.db,empty))[0].state).toBe('uændret');
});
