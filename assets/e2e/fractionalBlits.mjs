/**
 * HOW MANY BLITS LAND OFF-PIXEL, and which code path issues them.
 *
 *     bin/e2e fractionalBlits
 *
 * A 1:1 `drawImage` onto whole-pixel coordinates is a straight copy; a fractional destination resamples every
 * pixel through a bilinear filter. So this counts both and names the top offenders by stack, which is how the
 * block half-dimensions were found still fractional after the lattice itself had been snapped (18% of blits,
 * all of them block faces, down to 4% once `bw`/`bd`/`bh` were rounded too).
 *
 * See docs/PERFORMANCE.md §4.1.
 */
import { chromium } from 'playwright'
import { BASE } from './base.mjs'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
await p.addInitScript(()=>{const w=window;w.__int=0;w.__frac=0;w.__fracStacks={}
  const o=CanvasRenderingContext2D.prototype.drawImage
  CanvasRenderingContext2D.prototype.drawImage=function(...a){
    if(this.canvas&&String(this.canvas.className).includes('nebcanvas')){
      const dx=a.length>=9?a[5]:a[1], dy=a.length>=9?a[6]:a[2]
      if(Number.isInteger(dx)&&Number.isInteger(dy)) w.__int++
      else { w.__frac++
        const k=(new Error().stack??'').split('\n').slice(2,4).join(' <- ').replace(/https?:\/\/[^ ]*\//g,'')
        w.__fracStacks[k]=(w.__fracStacks[k]??0)+1 }
    }
    return o.apply(this,a) }
})
await p.goto(`${BASE}/templates`,{waitUntil:'networkidle'}); await p.waitForTimeout(2500)
const sf=async(a,v)=>{const f=p.getByLabel(a,{exact:false}).first(); if(await f.count()===0)return; await f.fill(String(v)); await f.press('Enter').catch(()=>{})}
await sf('Map columns',100); await sf('Map rows',60); await p.waitForTimeout(600)
await p.selectOption('select','city').catch(()=>{}); await p.waitForTimeout(500)
await p.getByRole('button',{name:/^Woodland city/}).first().click(); await p.waitForTimeout(400)
await p.getByRole('button',{name:/Build this world/}).click(); await p.waitForTimeout(9000)
await p.evaluate(()=>{const c=document.querySelector('canvas.nebcanvas')??document.querySelector('canvas'); for(let i=0;i<12;i++)c.dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true}))})
await p.waitForTimeout(900)
await p.keyboard.down('w'); await p.keyboard.down('d'); await p.waitForTimeout(4000)
await p.evaluate(()=>{window.__int=0;window.__frac=0;window.__fracStacks={}})
await p.waitForTimeout(3000)
const r=await p.evaluate(()=>({i:window.__int,f:window.__frac,s:window.__fracStacks}))
console.log(`whole-pixel blits ${r.i}   fractional ${r.f}  (${(100*r.f/(r.i+r.f)).toFixed(1)}%)`)
for(const [k,n] of Object.entries(r.s).sort((a,b)=>b[1]-a[1]).slice(0,5)) console.log(`   ${String(n).padStart(6)}x  ${k.slice(0,170)}`)
await p.keyboard.up('w'); await p.keyboard.up('d'); await b.close()
