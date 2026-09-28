// Cuántos carriles de 16 se ven pintados de aviso a la vez. Si son demasiados, el color deja de
// significar "viene un obstáculo" y la pantalla se vuelve ilegible. Uso: node tests/densidad.js
const G = require('./tests/harness')();
const L=16, lm=l=>((l%L)+L)%L;
G.setStep(()=>0);
const filas=[];
for (const z of [300,1000,2000,3000,4500,6000,8000,10000]){
  let picoAvisos=0, picoBloq=0, sumaAvisos=0, n=0;
  for (let rep=0; rep<3; rep++){
    G.start(); G.warp(z);
    for (let i=0;i<60*8;i++){
      G.update(1/60);
      if (G.state!=='play'){ G.start(); G.warp(z); continue; }
      if (i%10) continue;
      const s=G.s;
      // carriles con aviso encendido (pintados de color) en la ventana visible
      let avisos=0, bloq=0;
      for (let l=0;l<L;l++){
        const lista=G.byLane[l];
        let hayAviso=false, hayBloq=false;
        for (const o of lista){
          if (o.type!=='block') continue;
          if (o.z+o.len < s-2 || o.z > s+70) continue;
          hayBloq=true;
          if (o.lit && s+70 >= o.litFrom) hayAviso=true;
        }
        if (hayAviso) avisos++;
        if (hayBloq) bloq++;
      }
      picoAvisos=Math.max(picoAvisos,avisos); picoBloq=Math.max(picoBloq,bloq);
      sumaAvisos+=avisos; n++;
    }
  }
  filas.push({z, mediaAvisos:+(sumaAvisos/n).toFixed(1), picoAvisos, picoBloq, diff:+G.diffAt(z).toFixed(2)});
}
console.log('carriles de 16 con aviso encendido / bloqueados, ventana de 70 m por delante:');
for (const f of filas) console.log('  z'+String(f.z).padStart(6), 'dificultad',String(f.diff).padStart(5), '| avisos media',String(f.mediaAvisos).padStart(5),'pico',String(f.picoAvisos).padStart(3),'| carriles bloqueados pico',f.picoBloq);
