import { z } from 'zod';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Archive } from '../archive';
import type { DbAdapter } from '../db/adapter';
import { importArchiveDocument } from '../node-documents';
import { documentPath,listDocuments } from '../repo/documents';
import { insideArchive } from '../scoped-path';
import type { WriteContext } from '../repo/write';
import { formatIngredient,parseIngredients } from './ingredients';
import { readRecipe,saveRecipe,recipeInput } from './recipes';

const planner=z.object({version:z.union([z.literal(1),z.literal(2)]),retter:z.array(z.object({id:z.string().min(1),navn:z.string().trim().min(1),billede:z.string().nullish(),ingredienser:z.union([z.string(),z.array(z.string())]).nullish(),fremgangsmaade:z.string().nullish(),opskrift:z.string().nullish()})).max(200)});
function parseFile(raw:unknown) {
  if(typeof raw!=='string'||Buffer.byteLength(raw)>50*1024*1024) throw new Error('Vælg en JSON-fil på højst 50 MB.');
  const file=planner.parse(JSON.parse(raw));
  if(new Set(file.retter.map(r=>r.id)).size!==file.retter.length) throw new Error('Filen indeholder gentagne id’er.');
  return file;
}
async function plan(db:DbAdapter,raw:unknown) {
  const file=parseFile(raw), rows=[];
  for(const dish of file.retter) {
    const ref='open-planner:'+dish.id;
    const [existing]=await db.select<{id:string;archived_at:string|null}>('SELECT id,archived_at FROM recipe WHERE source_ref=?',[ref]);
    const old=existing?await readRecipe(db,existing.id):undefined;
    const lines=parseIngredients(dish.ingredienser??[]);
    const steps=dish.fremgangsmaade?.trim()||dish.opskrift?.trim();
    const match=file.version===2 && dish.billede?.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$/);
    const photo=match?{bytes:Buffer.from(match[2],'base64'),ext:match[1]==='png'?'png':'jpg'}:undefined;
    const [stored]=old?.photo_document_id?await db.select<{sha256:string}>('SELECT sha256 FROM document WHERE id=?',[old.photo_document_id]):[];
    const changed=!old || dish.navn!==old.name || (steps && steps!==old.instructions) ||
      (lines.length>0 && JSON.stringify(lines.map(formatIngredient))!==JSON.stringify(old.ingredients.map(formatIngredient))) ||
      (photo && createHash('sha256').update(photo.bytes).digest('hex')!==stored?.sha256);
    const data=recipeInput.parse({name:dish.navn, servings:old?.servings??4, tags:old?.tags??[],allergens:old?.allergens??[],
      ingredients:lines.length?lines:old?.ingredients??[],description:old?.description,prep_minutes:old?.prep_minutes,estimated_cost_minor:old?.estimated_cost_minor,
      instructions:steps??old?.instructions,photo_document_id:old?.photo_document_id});
    rows.push({key:dish.id,ref,id:existing?.id,data,photo,state:existing?.archived_at?'uændret':!old?'ny':changed?'ændret':'uændret',ignored:Boolean(dish.billede&&!photo)});
  }
  return rows;
}
export async function previewPlanner(db:DbAdapter,raw:unknown) {
  return (await plan(db,raw)).map(r=>({key:r.key,name:r.data.name,state:r.state,ignored:r.ignored}));
}
export async function applyPlanner(archive:Archive,ctx:WriteContext,raw:unknown,selected:string[]) {
  return archive.db.transaction(async tx=>{
    let count=0;
    for(const r of await plan(tx,raw)) {
      if(r.state==='uændret'||!selected.includes(r.key)) continue;
      if(r.photo) r.data.photo_document_id=(await importArchiveDocument(archive,'opskriftsfoto.'+r.photo.ext,r.photo.bytes,ctx,'drop',tx)).id;
      await saveRecipe(tx,ctx,r.data,r.id,{source:'import',source_ref:r.ref}); count++;
    }
    return count;
  });
}
export async function exportPlanner(archive:Archive,ids:string[]) {
  const retter=[],visible=new Set((await listDocuments(archive.db)).map(d=>d.id));
  for(const id of new Set(z.array(z.uuid()).max(200).parse(ids))) {
    const r=await readRecipe(archive.db,id);
    const slug=String(r.name).toLowerCase().replaceAll('ø','o').replaceAll('æ','ae').replaceAll('å','a').normalize('NFD').replace(/\p{M}/gu,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    const dish:{id:string;navn:string;ingredienser:string[];fremgangsmaade:string;billede?:string}={id:String(r.source_ref??'').replace(/^open-planner:/,'')||slug,navn:String(r.name),ingredienser:r.ingredients.map(formatIngredient),fremgangsmaade:String(r.instructions??'')};
    if(r.photo_document_id && visible.has(String(r.photo_document_id))) {
      const [d]=await archive.db.select<{sha256:string;ext:string;mime:string}>('SELECT sha256,ext,mime FROM document WHERE id=?',[r.photo_document_id]);
      const bytes=await readFile(await insideArchive(archive.root,join(archive.root,documentPath(d.sha256,d.ext))));
      dish.billede='data:'+d.mime+';base64,'+bytes.toString('base64');
    }
    retter.push(dish);
  }
  return JSON.stringify({version:2,format:'extruda-open-planner-database',sprog:'da',retter});
}
