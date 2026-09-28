// Comprueba la casilla de la pantalla de inicio: con giroscopio (por defecto) o con las flechas
// superpuestas, que la preferencia se recuerda y que cada modo ignora al otro.
// Requiere: npm run serve en otra terminal.  Uso: node tests/controles.js
const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({headless:'new', args:['--ignore-gpu-blocklist','--enable-gpu']});
  const p = await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.emulate({ viewport:{width:844,height:390,isMobile:true,hasTouch:true,deviceScaleFactor:2},
    userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  await p.goto('http://localhost:5173/index.html');
  await new Promise(r=>setTimeout(r,1600));
  const ini = await p.evaluate(()=>({ casillaVisible: !document.getElementById('optTilt').hidden,
    marcada: document.getElementById('cbTilt').checked,
    flechas: document.getElementById('tz').classList.contains('on') }));
  console.log('AL ABRIR       :', JSON.stringify(ini));
  // desmarcar
  await p.click('#cbTilt');
  await new Promise(r=>setTimeout(r,400));
  const off = await p.evaluate(()=>({ marcada: document.getElementById('cbTilt').checked,
    flechas: document.getElementById('tz').classList.contains('on'),
    ayuda: document.getElementById('help').textContent.slice(0,40) }));
  console.log('DESMARCADA     :', JSON.stringify(off));
  // jugar y comprobar que el giroscopio se ignora y las flechas siguen
  await p.click('#bPlay'); await new Promise(r=>setTimeout(r,1200));
  const jug = await p.evaluate(()=>{ for(let i=0;i<120;i++) window.__game.motion(9.8*Math.cos(Math.PI/2+0.7), 9.8*Math.sin(Math.PI/2+0.7));
    return { carril: window.__game.lane, flechas: document.getElementById('tz').classList.contains('on') }; });
  console.log('JUGANDO sin giro:', JSON.stringify(jug), '(carril debe seguir siendo 0)');
  // recargar: debe recordarlo
  await p.reload(); await new Promise(r=>setTimeout(r,1600));
  const rec = await p.evaluate(()=>({ marcada: document.getElementById('cbTilt').checked,
    flechas: document.getElementById('tz').classList.contains('on') }));
  console.log('TRAS RECARGAR  :', JSON.stringify(rec));
  // y ahora al revés: con la casilla marcada el giroscopio manda y las flechas se quitan
  const p2 = await b.newPage();
  p2.on('pageerror',e=>errs.push(e.message));
  await p2.emulate({ viewport:{width:844,height:390,isMobile:true,hasTouch:true,deviceScaleFactor:2},
    userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1' });
  await p2.goto('http://localhost:5173/index.html');
  // comparte navegador con la pestaña anterior, que dejó la preferencia desmarcada: se vuelve a marcar
  await p2.evaluate(()=>localStorage.removeItem('hipertunel-tilt'));
  await p2.reload();
  await new Promise(r=>setTimeout(r,1600));
  await p2.click('#bPlay'); await new Promise(r=>setTimeout(r,1400));
  const con = await p2.evaluate(async ()=>{
    const G = window.__game, f=(d)=>{const r=d*Math.PI/180; G.motion(9.8*Math.cos(Math.PI/2+r),9.8*Math.sin(Math.PI/2+r));};
    const frame = () => new Promise(r=>requestAnimationFrame(()=>r()));
    for(let i=0;i<90;i++){ f(0); await frame(); }
    const l0 = G.lane;
    for(let i=0;i<40;i++){ f(25); await frame(); }
    return { movio: G.lane !== l0, flechas: document.getElementById('tz').classList.contains('on') };
  });
  console.log('CON GIROSCOPIO :', JSON.stringify(con));
  console.log('errores:', errs.length?errs.join(' | '):'ninguno');
  await b.close();
  const fallos = [];
  if (!ini.casillaVisible) fallos.push('La casilla del giroscopio no aparece en el móvil');
  if (!ini.marcada) fallos.push('La casilla no viene marcada por defecto');
  if (off.marcada) fallos.push('La casilla no se desmarca');
  if (!off.flechas) fallos.push('Al desmarcar no aparecen las flechas en pantalla');
  if (jug.carril !== 0) fallos.push('Con la casilla desmarcada el giroscopio sigue moviendo el carril');
  if (!jug.flechas) fallos.push('Jugando sin giroscopio las flechas no se ven');
  if (rec.marcada) fallos.push('No se recuerda la preferencia al recargar');
  if (!con.movio) fallos.push('Con la casilla marcada el giroscopio no mueve');
  if (con.flechas) fallos.push('Con el giroscopio en marcha las flechas siguen estorbando');
  console.log(fallos.length ? 'FALLOS:\n- ' + fallos.join('\n- ') : 'Todo OK');
  process.exit(fallos.length ? 1 : 0);
})();
