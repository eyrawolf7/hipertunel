// Comprueba que en vertical no se puede empezar a jugar: el móvil tiene que estar ya en horizontal
// antes de pulsar Jugar, porque girarlo después descoloca el cero del giroscopio.
// Requiere: npm run serve en otra terminal.  Uso: node tests/orientacion.js
const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({headless:'new', args:['--ignore-gpu-blocklist','--enable-gpu']});
  const p = await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  // móvil en VERTICAL, con pantalla táctil
  await p.emulate({ viewport:{width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:2},
    userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  await p.goto('http://localhost:5173/index.html');
  await new Promise(r=>setTimeout(r,1800));
  const vert = await p.evaluate(()=>({ avisoVisible: document.getElementById('rotate').classList.contains('on'),
    botonTapado: (()=>{ const r=document.getElementById('bPlay').getBoundingClientRect();
      const el=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2); return el && el.id!=='bPlay'; })() }));
  console.log('EN VERTICAL:', JSON.stringify(vert));
  await p.screenshot({path:'/tmp/vertical.png'});
  // ahora se gira a HORIZONTAL
  await p.setViewport({width:844,height:390,isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await new Promise(r=>setTimeout(r,1200));
  const hor = await p.evaluate(()=>({ avisoVisible: document.getElementById('rotate').classList.contains('on') }));
  console.log('EN HORIZONTAL:', JSON.stringify(hor));
  await p.screenshot({path:'/tmp/horizontal.png'});
  console.log('errores:', errs.length?errs.join(' | '):'ninguno');
  await b.close();
  const fallos = [];
  if (!vert.avisoVisible) fallos.push('En vertical no se muestra el aviso de girar el móvil');
  if (!vert.botonTapado) fallos.push('En vertical se puede pulsar Jugar: hay que girar el móvil antes');
  if (hor.avisoVisible) fallos.push('En horizontal sigue saliendo el aviso de girar el móvil');
  console.log(fallos.length ? 'FALLOS:\n- ' + fallos.join('\n- ') : 'Todo OK');
  process.exit(fallos.length ? 1 : 0);
})();
