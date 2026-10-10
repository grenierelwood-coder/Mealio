import test from 'node:test'
import assert from 'node:assert/strict'
import { newRecipesForKH,recordRecipeAnalysis } from '../../app/utils/recipe-watch-server'
import { pantryPurchaseDefault } from '../../app/utils/pantry-purchase-default'
import { GET } from '../../app/api/admin/recipe-watch/route'
import { createSessionValue } from '../../app/utils/auth-server'
// @ts-expect-error DB test double
import { setDbResolver,calls } from '../../test-support/db.mjs'
// @ts-expect-error session test double
import { setCookies } from '../../test-support/headers.mjs'
test('achat présence : mayonnaise 250g, quantité indépendante du booléen présence',()=>{assert.deepEqual(pantryPurchaseDefault({nom:'Mayonnaise',unite_reference:'Gramme'}),{default_quantity:250,default_unit:'Gramme'});assert.equal(pantryPurchaseDefault({nom:'Oignon',unite_reference:'Pièce'}).default_quantity,1);assert.equal(pantryPurchaseDefault({nom:'Huile',unite_reference:'Millilitre'}).default_quantity,1000)})
test('surveillance : aucune requête pour un autre foyer',async()=>{setDbResolver(()=>{throw new Error('Interdit')});assert.deepEqual(await newRecipesForKH('Autre'),[]);assert.equal(await recordRecipeAnalysis('Autre','r'),null);assert.equal(calls.length,0)})
test('surveillance KH : seulement les recettes jamais analysées, toutes les pages',async()=>{const page=Array.from({length:500},(_,n)=>({id:String(n),title:`Recette ${n}`}));setDbResolver((c:any)=>({data:c.source==='mealio'?page.map(r=>({recipe_id:r.id})):c.range[0]===0?page:[{id:'new',title:'Nouvelle'}],error:null}));assert.deepEqual(await newRecipesForKH('KH'),[{id:'new',title:'Nouvelle'}]);assert.deepEqual(calls.filter((c:any)=>c.source==='cookiwiki').map((c:any)=>c.range),[[0,499],[500,999]])})
test('surveillance : ne pas annoncer zéro recette en cas de SQL manquant',async()=>{setDbResolver(()=>({data:null,error:{message:'missing'}}));await assert.rejects(()=>newRecipesForKH('KH'),/SQL Mealio/);assert.match((await recordRecipeAnalysis('KH','r'))!,/non enregistré/)})
test('surveillance : enregistrement limité à KH après analyse',async()=>{setDbResolver(()=>({data:null,error:null}));assert.equal(await recordRecipeAnalysis('KH','recipe'),null);assert.equal(calls[0].action,'upsert');assert.equal(calls[0].payload.user_id,'KH');assert.equal(calls[0].payload.recipe_id,'recipe');assert.ok(Date.parse(calls[0].payload.tested_at))})
test('API surveillance : session obligatoire et isolation du foyer',async()=>{process.env.MEALIO_SESSION_SECRET='watch-secret-test-----------------------';setCookies({});assert.equal((await GET()).status,401);setCookies({mealio_session:createSessionValue('Autre','uuid')});setDbResolver(()=>{throw new Error('Interdit')});assert.deepEqual(await (await GET()).json(),{enabled:false,recipes:[]});assert.equal(calls.length,0);setCookies({mealio_session:createSessionValue('KH','uuid')});setDbResolver(()=>({data:[],error:null}));assert.deepEqual(await (await GET()).json(),{enabled:true,recipes:[]});setCookies({})})
