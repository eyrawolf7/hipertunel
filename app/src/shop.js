// Tienda: las monedas que coges se guardan en una cartera y se gastan en cosas solo estéticas
// (estela, lo que vuela junto a las paredes, marco del marcador). Nada cambia la partida. Ningún
// artículo es azul: el azul es solo del impulso.
const KEY = 'hipertunel-tienda';

export const SHOP = {
  trail: {
    name: 'Estela', desc: 'Las líneas de velocidad',
    items: [
      { id: 'normal', name: 'Clásica', price: 0, sw: ['#ffffff', '#3a3170'] },
      { id: 'gold', name: 'Dorada', price: 60, sw: ['#ffd23f', '#f0a020'], col: 0xffd23f },
      { id: 'rose', name: 'Rosa', price: 90, sw: ['#ff7ac0', '#ff3d8b'], col: 0xff7ac0 },
      { id: 'lime', name: 'Lima', price: 120, sw: ['#b6f03a', '#6ac41a'], col: 0xb6f03a },
      { id: 'rainbow', name: 'Arcoíris', price: 300, sw: ['#ff3d57', '#ffd23f', '#5fdf8f', '#b58cff'], rainbow: true },
    ],
  },
  life: {
    name: 'Ambiente', desc: 'Lo que vuela junto a las paredes',
    items: [
      { id: 'world', name: 'Del mundo', price: 0, sw: ['#7fc24a', '#ffb0c8'] },
      { id: 'sakura', name: 'Cerezo', price: 80, sw: ['#ffc4d8', '#ff9ab8'], kind: { tex: 'leaf', cols: [0xffc4d8, 0xff9ab8, 0xffe0ea], size: 0.3 } },
      { id: 'stars', name: 'Estrellas', price: 150, sw: ['#fff2a0', '#ffd23f'], kind: { tex: 'dot', cols: [0xfff2a0, 0xffd23f], size: 0.2, glow: true } },
      { id: 'snow', name: 'Nieve', price: 150, sw: ['#ffffff', '#e8f0ff'], kind: { tex: 'dot', cols: [0xffffff, 0xf0f4ff], size: 0.16, glow: false } },
      { id: 'confetti', name: 'Confeti', price: 250, sw: ['#ff3d57', '#ffd23f', '#5fdf8f', '#ff7ac0'], kind: { tex: 'leaf', cols: [0xff3d57, 0xffd23f, 0x5fdf8f, 0xff7ac0, 0xb58cff], size: 0.22 } },
    ],
  },
  hud: {
    name: 'Marcador', desc: 'El color del marcador',
    items: [
      { id: 'grape', name: 'Uva', price: 0, sw: ['#2b2257', '#5a49d6'] },
      { id: 'coral', name: 'Coral', price: 70, sw: ['#b8323f', '#ff6a5a'] },
      { id: 'mint', name: 'Menta', price: 70, sw: ['#1f7a5a', '#4fd6a0'] },
      { id: 'night', name: 'Noche', price: 110, sw: ['#101428', '#3a3f6a'] },
      { id: 'gold', name: 'Oro', price: 400, sw: ['#8a5a00', '#ffd23f'] },
    ],
  },
};

function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d && d.owned) return d; } catch (e) {}
  return { wallet: 0, owned: { trail: ['normal'], life: ['world'], hud: ['grape'] }, eq: { trail: 'normal', life: 'world', hud: 'grape' } };
}

export function createShop() {
  let d = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} };
  const item = (cat, id) => SHOP[cat].items.find((i) => i.id === id);
  return {
    get wallet() { return d.wallet; },
    add(n) { d.wallet += Math.max(0, n | 0); save(); },
    owns: (cat, id) => d.owned[cat].includes(id),
    equipped: (cat) => item(cat, d.eq[cat]) || SHOP[cat].items[0],
    // compra o equipa; devuelve 'equip' | 'buy' | 'poor'
    choose(cat, id) {
      const it = item(cat, id); if (!it) return 'poor';
      if (!d.owned[cat].includes(id)) {
        if (d.wallet < it.price) return 'poor';
        d.wallet -= it.price; d.owned[cat].push(id); d.eq[cat] = id; save(); return 'buy';
      }
      d.eq[cat] = id; save(); return 'equip';
    },
  };
}
