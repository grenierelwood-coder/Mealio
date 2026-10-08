/** Run on the installed project, with its deployment environment. Stops claiming readiness if any step fails. */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),directory=path.join(cwd,'test-reports')
fs.mkdirSync(directory,{recursive:true})
const npmCli=process.env.npm_execpath
if(!npmCli){
 console.error('Lancer ce contrôle avec npm run verify:production.')
 process.exit(1)
}
const checks=[]
for(const script of ['test','test:ui','typecheck','build']){
 console.log(`\nContrôle : npm run ${script}`)
 const started=Date.now();const result=spawnSync(process.execPath,[npmCli,'run',script],{cwd,encoding:'utf8',shell:false,maxBuffer:32*1024*1024})
 const output=(result.stdout||'')+(result.stderr||'')+(result.error?`\n${result.error.message}`:'')
 fs.writeFileSync(path.join(directory,`preproduction-${script.replace(':','-')}.txt`),output)
 const passed=result.status===0;checks.push({command:`npm run ${script}`,status:passed?'pass':'fail',durationMs:Date.now()-started})
 console.log(passed?'✓ Réussi':'Échec — dernières lignes :\n'+output.trim().split('\n').slice(-12).join('\n'))
}
const passed=checks.every(c=>c.status==='pass')
fs.writeFileSync(path.join(directory,'preproduction-local.json'),JSON.stringify({date:new Date().toISOString(),scope:'installation locale : tests, typage et build ; pas de cycle Supabase réel',passed,checks},null,2))
console.log(`\n${passed?'Contrôles de l’installation réussis. Les parcours sur les DB réelles restent à confirmer.':'Installation non validée : corriger les contrôles en échec avant la production.'}\nRapport : test-reports/preproduction-local.json`)
if(!passed)process.exitCode=1
