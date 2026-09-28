const P = Object.fromEntries((process.argv[2]||'').split('&').filter(Boolean).map(p=>p.split('=')));
const G = require('./tests/harness')(P);
G.setStep(()=>0);
const f1=(deg)=>{const r=deg*Math.PI/180;G.motion(9.8*Math.cos(Math.PI/2+r),9.8*Math.sin(Math.PI/2+r));G.update(1/60);};
console.log(' inclinación | carriles/s  (objetivo: la curva de Boost 2)');

for (const deg of [1,2,3,5,8,10,15,20,30,45,60,90]){
  let v=null;
  for (let i=0;i<8 && v===null;i++){
    G.start(); for(let k=0;k<80;k++) f1(0);
    const ini=G.laneF;
    for(let k=0;k<60;k++) f1(deg);
    if (G.state==='play') v=Math.abs(G.laneF-ini);
  }
  const obj = Math.abs(Math.sin(deg*Math.PI/180))>=0.019/0.981 ? Math.abs(Math.sin(deg*Math.PI/180))*30.56 : 0;
  console.log(String(deg).padStart(8)+'°  '+String(v===null?'(muere)':v.toFixed(1)).padStart(8)+'      objetivo '+obj.toFixed(1));
}
