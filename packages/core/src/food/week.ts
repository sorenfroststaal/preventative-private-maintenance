import { z } from 'zod';
import type { DbAdapter } from '../db/adapter';
import { now } from '../db/migrate';
import type { WriteContext } from '../repo/write';
import { allergyWarnings, change } from './recipes';
import { normalizeName, formatAmount } from './ingredients';

export function shift(day: string, n: number) {
  const d=new Date(z.iso.date().parse(day)+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+n);
  return d.toISOString().slice(0,10);
}
export function monday(day: string) { return shift(day,-((new Date(shift(day,0)+'T00:00:00Z').getUTCDay()+6)%7)); }
export const slot = z.strictObject({plan_date:z.iso.date(),meal:z.enum(['breakfast','lunch','dinner','snack']).default('dinner'),recipe_id:z.uuid().nullish(),
  title:z.string().trim().min(1).nullish(),servings:z.number().int().positive().nullish(),note:z.string().nullish()}).refine(x=>Boolean(x.recipe_id || x.title));
export async function saveSlot(db:DbAdapter,ctx:WriteContext,raw:unknown,id?:string) {
  const data=slot.parse(raw);
  return db.transaction(async tx=>{
    if(id && !(await tx.select('SELECT id FROM meal_plan_entry WHERE id=?',[z.uuid().parse(id)])).length) throw new Error('Måltidet findes ikke.');
    return change(tx,ctx,'meal_plan_entry',id??crypto.randomUUID(),{...data,recipe_id:data.recipe_id??null,title:data.title??null, ...(!id && {created_at:now()})});
  });
}
export async function copyWeek(db:DbAdapter,ctx:WriteContext,day:string) {
  const start=monday(day);
  return db.transaction(async tx=>{
    const rows=await tx.select<z.infer<typeof slot>>('SELECT plan_date,meal,recipe_id,title,servings,note FROM meal_plan_entry WHERE plan_date BETWEEN ? AND ? ORDER BY plan_date,id',[shift(start,-7),shift(start,-1)]);
    for(const row of rows) await saveSlot(tx,ctx,{...row,plan_date:shift(row.plan_date,7)});
    return rows.length;
  });
}
export async function weekPlan(db:DbAdapter,day:string,userId?:string,includeWarnings=true) {
  const start=monday(day), end=shift(start,6);
  const rows=await db.select<{id:string;plan_date:string;meal:string;recipe_id:string|null;title:string;servings:number|null;cost:number|null;base:number|null}>(
    'SELECT e.id,e.plan_date,e.meal,e.recipe_id,COALESCE(r.name,e.title) AS title,e.servings,r.estimated_cost_minor AS cost,r.servings AS base FROM meal_plan_entry e LEFT JOIN recipe r ON r.id=e.recipe_id WHERE e.plan_date BETWEEN ? AND ? ORDER BY e.plan_date,e.meal,e.id',[start,end]);
  const entries=[];
  let price=0,unpriced=0;
  for(const r of rows) {
    if(r.recipe_id && r.cost===null) unpriced++;
    if(r.cost!==null && r.base) price+=r.cost*(r.servings??r.base)/r.base;
    entries.push({...r,...(includeWarnings && {warnings:r.recipe_id?await allergyWarnings(db,r.recipe_id,userId):[]})});
  }
  const [totals]=await db.select<{budget:number;actual:number}>(`WITH RECURSIVE cats(id) AS (
    SELECT id FROM category WHERE name='Mad og dagligvarer' AND kind='expense' UNION SELECT c.id FROM category c JOIN cats ON c.parent_id=cats.id
  ), days(d) AS (SELECT ? UNION ALL SELECT date(d,'+1 day') FROM days WHERE d<?)
  SELECT COALESCE((SELECT ROUND(SUM(l.amount_minor*1.0/CAST(strftime('%d',d,'start of month','+1 month','-1 day') AS INTEGER))) FROM days
    JOIN budget b ON b.year=CAST(strftime('%Y',d) AS INTEGER) JOIN budget_line l ON l.budget_id=b.id WHERE l.category_id IN cats AND (l.month IS NULL OR l.month=CAST(strftime('%m',d) AS INTEGER))),0) AS budget,
    COALESCE((SELECT -SUM(amount_minor) FROM bank_transaction WHERE category_id IN cats AND currency='DKK' AND booking_date BETWEEN ? AND ?),0) AS actual`,[start,end,start,end]);
  return {start,end,entries,price:Math.round(price),unpriced,...totals};
}

const departments=['Frugt og grønt','Kød og fisk','Mejeri','Brød','Kolonial','Frost','Andet'] as const;
export function department(name:string) {
  const words=[/kartof|løg|tomat|æble|salat|gulerod/,/kød|kylling|laks|fisk|bacon/,/mælk|fløde|ost|smør|yoghurt|æg/,/brød|bolle/,/salt|peber|mel|pasta|ris|linser|olie|sukker/,/frost|frosne/];
  const idx=words.findIndex(r=>r.test(name.toLowerCase()));
  return departments[idx<0?6:idx];
}
type ShoppingRow={id:string;name:string;amount:number|null;unit:string|null;category:string;checked:number;source:string;position:number};
export async function shopping(db:DbAdapter,day:string) {
  const [list]=await db.select<{id:string}>('SELECT id FROM shopping_list WHERE week_start=? AND archived_at IS NULL ORDER BY created_at,id LIMIT 1',[monday(day)]);
  const items=list?await db.select<ShoppingRow>('SELECT * FROM shopping_item WHERE list_id=? ORDER BY category,position,id',[list.id]):[];
  return {id:list?.id,items};
}
async function listId(db:DbAdapter,ctx:WriteContext,day:string) {
  return (await shopping(db,day)).id??change(db,ctx,'shopping_list',crypto.randomUUID(),{name:'Ugens indkøb',week_start:monday(day),created_at:now()});
}
export async function generateShopping(db:DbAdapter,ctx:WriteContext,day:string) {
  const start=monday(day);
  return db.transaction(async tx=>{
    const id=await listId(tx,ctx,start);
    const old=(await shopping(tx,start)).items.filter(i=>i.source==='plan');
    const key=(name:string,unit:string|null)=>JSON.stringify([normalizeName(name),unit]);
    const saved=new Map(old.map(i=>[key(i.name,i.unit),i]));
    const ingredients=await tx.select<{entry:string;name:string;unit:string|null;amount:number|null;scale:number}>(`SELECT e.id AS entry,i.name,i.unit,i.amount,
      1.0*COALESCE(e.servings,r.servings)/r.servings AS scale FROM meal_plan_entry e JOIN recipe r ON r.id=e.recipe_id
      JOIN recipe_ingredient i ON i.recipe_id=r.id WHERE e.plan_date BETWEEN ? AND ? ORDER BY e.plan_date,e.id,i.position`,[start,shift(start,6)]);
    const sums=new Map<string,{name:string;unit:string|null;amount:number;entries:Set<string>}>();
    for(const row of ingredients) {
      const name=normalizeName(row.name), unit=row.amount===null?'retter':row.unit==='kg'?'g':['dl','l'].includes(row.unit??'')?'ml':row.unit;
      const k=key(name,unit);
      const sum=sums.get(k)??{name,unit,amount:0,entries:new Set<string>()};
      if(row.amount===null) {sum.entries.add(row.entry);sum.amount=sum.entries.size;}
      else sum.amount+=row.amount*row.scale*(row.unit==='kg'||row.unit==='l'?1000:row.unit==='dl'?100:1);
      sums.set(k,sum);
    }
    for(const row of old) await change(tx,ctx,'shopping_item',row.id,null);
    let position=0;
    for(const [k,row] of sums) await change(tx,ctx,'shopping_item',crypto.randomUUID(),{list_id:id,name:row.name,amount:row.amount,unit:row.unit,
      checked:saved.get(k)?.checked??0,category:saved.get(k)?.category??department(row.name),position:position++,source:'plan'});
    return shopping(tx,start);
  });
}
export function shoppingLabel(row:Pick<ShoppingRow,'name'|'amount'|'unit'>) {
  if(row.amount===null) return row.name;
  if(row.unit==='retter') return row.name+' ('+row.amount+' retter)';
  const large=row.amount>=1000 && (row.unit==='g'||row.unit==='ml');
  return [formatAmount(large?row.amount/1000:row.amount),large?(row.unit==='g'?'kg':'l'):row.unit,row.name].filter(Boolean).join(' ');
}
export async function editShopping(db:DbAdapter,ctx:WriteContext,raw:unknown) {
  const req=z.strictObject({day:z.iso.date(),id:z.uuid().optional(),remove:z.boolean().optional(),name:z.string().trim().min(1).optional(),
    amount:z.number().positive().nullish(),unit:z.string().nullish(),category:z.enum(departments).optional(),checked:z.boolean().optional()}).parse(raw);
  return db.transaction(async tx=>{
    const {items}=await shopping(tx,req.day);
    const old=items.find(i=>i.id===req.id);
    if(req.id && !old) throw new Error('Varen findes ikke.');
    if(req.remove && old) return change(tx,ctx,'shopping_item',old.id,null);
    if(!req.name && !old) throw new Error('Angiv et varenavn.');
    return change(tx,ctx,'shopping_item',req.id??crypto.randomUUID(),{...(!old&&{list_id:await listId(tx,ctx,req.day),source:'manual',position:items.length}),
      name:req.name??old?.name,amount:req.amount,unit:req.unit,category:req.category??old?.category??department(req.name??''),checked:Number(req.checked??old?.checked??false)});
  });
}
export function shoppingText(items:ShoppingRow[],includeChecked:boolean) {
  return departments.map(cat=>{const rows=items.filter(i=>(i.category??'Andet')===cat&&(includeChecked||!i.checked));return rows.length?[cat,...rows.map(shoppingLabel)].join('\n'):'';}).filter(Boolean).join('\n\n');
}
