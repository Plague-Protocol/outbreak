// Puzzle pages: a torn map to piece together, a keypad, a box of cut wires. Loaded the first time one
// is needed (it is not in the main bundle). The page only collects an answer; the core checks it.
import { stepDef } from '../core/content';
import type { Task } from '../core/types';

export interface PuzzleHooks {
  /** Check an answer with the core; true if it was right (the step is then done). */
  solve(answer: number[] | string): boolean;
  /** The page has closed (solved or walked away from). */
  close(): void;
}

const WIRE_COLORS = ['#e8443a', '#3f8fe8', '#f2c230', '#4cc46a'];
const WIRE_NAMES = ['red', 'blue', 'yellow', 'green'];

let root: HTMLElement | null = null;

function page(): HTMLElement {
  if (root) return root;
  root = document.createElement('div');
  root.id = 'puzzle';
  root.className = 'screen';
  document.body.appendChild(root);
  return root;
}

/** Open the page for a puzzle step. */
export function showPuzzle(t: Task, hooks: PuzzleHooks): void {
  const el = page();
  el.innerHTML = '';
  const def = stepDef(t.id);
  const head = document.createElement('header');
  head.innerHTML = `<small>${t.puzzle === 'keypad' ? 'Keypad' : t.puzzle === 'wires' ? 'Junction box' : 'Puzzle'}</small><h1></h1>`;
  head.querySelector('h1')!.textContent = def.short.replace(/^the /, '').toUpperCase();
  const help = document.createElement('p');
  help.className = 'help';
  const body = document.createElement('div');
  body.className = `body ${t.puzzle}`;
  const foot = document.createElement('footer');
  const leave = document.createElement('button');
  leave.className = 'close';
  leave.textContent = 'Step away';
  foot.appendChild(leave);
  el.append(head, help, body, foot);
  el.classList.add('on');

  let finished = false;
  const close = () => { el.classList.remove('on'); hooks.close(); };
  leave.addEventListener('click', () => { if (!finished) close(); });
  const won = () => {
    finished = true;
    el.classList.add('solved');
    window.setTimeout(() => { el.classList.remove('solved'); close(); }, 700);
  };
  const shake = () => { body.classList.remove('wrong'); void body.offsetWidth; body.classList.add('wrong'); };

  if (t.puzzle === 'tiles') {
    help.textContent = 'Tap a piece to turn it. Turn every piece the right way up.';
    const turns = Array<number>(9).fill(0);
    const art = tornMap();
    for (let i = 0; i < 9; i++) {
      const tile = document.createElement('button');
      tile.className = 'tile';
      tile.style.backgroundImage = `url(${art})`;
      tile.style.backgroundPosition = `${(i % 3) * 50}% ${Math.floor(i / 3) * 50}%`;
      const show = () => { tile.style.transform = `rotate(${((t.scramble![i]! + turns[i]!) % 4) * 90}deg)`; };
      show();
      tile.addEventListener('click', () => {
        if (finished) return;
        turns[i] = (turns[i]! + 1) % 4;
        show();
        if (t.scramble!.every((r, k) => (r + turns[k]!) % 4 === 0) && hooks.solve(turns.slice())) won();
      });
      body.appendChild(tile);
    }
  } else if (t.puzzle === 'keypad') {
    help.textContent = `The code: ${t.code.split('').join(' ')}`;
    const screen = document.createElement('div');
    screen.className = 'readout';
    let typed = '';
    const show = () => { screen.textContent = typed.padEnd(4, '·'); };
    show();
    const pad = document.createElement('div');
    pad.className = 'keys';
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK']) {
      const b = document.createElement('button');
      b.textContent = k;
      b.addEventListener('click', () => {
        if (finished) return;
        if (k === 'C') typed = '';
        else if (k === 'OK') {
          if (hooks.solve(typed)) { screen.textContent = 'OPEN'; won(); return; }
          typed = '';
          shake();
        } else if (typed.length < 4) typed += k;
        show();
      });
      pad.appendChild(b);
    }
    body.append(screen, pad);
  } else if (t.puzzle === 'wires') {
    help.textContent = 'Tap a wire on the left, then the same colour on the right.';
    const joined = Array<number>(4).fill(-1);
    let picked = -1;
    const left = document.createElement('div');
    left.className = 'col';
    const right = document.createElement('div');
    right.className = 'col';
    const ends: HTMLButtonElement[] = [];
    const starts: HTMLButtonElement[] = [];
    const paint = () => {
      starts.forEach((b, i) => { b.classList.toggle('picked', picked === i); b.classList.toggle('done', joined[i]! >= 0); });
      ends.forEach((b, j) => b.classList.toggle('done', joined.includes(j)));
    };
    for (let i = 0; i < 4; i++) {
      const b = document.createElement('button');
      b.className = 'wire';
      b.style.setProperty('--c', WIRE_COLORS[i]!);
      b.setAttribute('aria-label', `${WIRE_NAMES[i]} wire`);
      b.addEventListener('click', () => { if (!finished && joined[i]! < 0) { picked = i; paint(); } });
      starts.push(b);
      left.appendChild(b);
    }
    t.scramble!.forEach((colour, j) => {
      const b = document.createElement('button');
      b.className = 'wire end';
      b.style.setProperty('--c', WIRE_COLORS[colour]!);
      b.setAttribute('aria-label', `${WIRE_NAMES[colour]} terminal`);
      b.addEventListener('click', () => {
        if (finished || picked < 0 || joined.includes(j)) return;
        if (t.scramble![j] !== picked) { picked = -1; paint(); shake(); return; } // wrong colour: spark, try again
        joined[picked] = j;
        picked = -1;
        paint();
        if (joined.every((x) => x >= 0) && hooks.solve(joined.slice())) won();
      });
      ends.push(b);
      right.appendChild(b);
    });
    const gap = document.createElement('div');
    gap.className = 'gap';
    body.append(left, gap, right);
  }
}

/** A transit map, drawn once: coloured lines, stations, the river, torn edges between the pieces. */
let mapArt: string | null = null;
function tornMap(): string {
  if (mapArt) return mapArt;
  const c = document.createElement('canvas');
  c.width = c.height = 300;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9e2cf';
  g.fillRect(0, 0, 300, 300);
  g.fillStyle = '#b9d3e3'; // the river
  g.beginPath(); g.moveTo(0, 210); g.bezierCurveTo(90, 170, 170, 260, 300, 220); g.lineTo(300, 260); g.bezierCurveTo(170, 300, 90, 210, 0, 250); g.fill();
  const line = (color: string, pts: number[][]) => {
    g.strokeStyle = color; g.lineWidth = 9; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x!, y!) : g.moveTo(x!, y!))); g.stroke();
    g.fillStyle = '#fff'; g.strokeStyle = '#222'; g.lineWidth = 2.5;
    for (const [x, y] of pts) { g.beginPath(); g.arc(x!, y!, 6, 0, Math.PI * 2); g.fill(); g.stroke(); }
  };
  line('#2f9a4a', [[20, 40], [110, 40], [150, 90], [150, 280]]); // the Green Line, under the river
  line('#d8402e', [[20, 150], [100, 150], [190, 70], [285, 70]]);
  line('#2f6ea8', [[60, 285], [60, 200], [200, 140], [285, 140]]);
  line('#e0a020', [[230, 20], [230, 285]]);
  g.fillStyle = '#222'; g.font = 'bold 20px system-ui, sans-serif';
  g.fillText('HALDEN METRO', 18, 24);
  g.font = '11px system-ui, sans-serif';
  g.fillText('Harbour', 170, 275);
  g.fillText('Central', 158, 112);
  // the tears: an arrow in the corner shows which way is up
  g.fillStyle = '#222'; g.beginPath(); g.moveTo(270, 280); g.lineTo(285, 255); g.lineTo(300, 280); g.fill();
  mapArt = c.toDataURL();
  return mapArt;
}
