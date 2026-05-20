/* =============================================
   GRID LOCK — script.js
   Sliding Puzzle Game Engine
   ============================================= */

'use strict';

/* ══════════════════════════════════════════════
   1. CONSTANTS & CONFIGURATION
══════════════════════════════════════════════ */
const CONFIG = {
  MIN_SHUFFLES:    { 3: 30,  4: 60,  5: 100 },
  TILE_ANIM_DELAY: 15,        // ms between tile render stagger
  SOUND_VOL:       0.18,
  LS_BEST_PREFIX:  'gridlock_best_',
  LS_THEME:        'gridlock_theme',
  LS_SOUND:        'gridlock_sound',
};

const CONFETTI_COLORS = [
  '#00d4ff', '#7b5cff', '#00ff88', '#ff4466',
  '#ffcc00', '#ff8800', '#00ccff', '#dd44ff',
];

/* ══════════════════════════════════════════════
   2. AUDIO ENGINE
   Web Audio API — synthesised clicks & chimes
══════════════════════════════════════════════ */
class AudioEngine {
  constructor() {
    this.ctx   = null;
    this.muted = JSON.parse(localStorage.getItem(CONFIG.LS_SOUND) ?? 'false');
  }

  _ctx() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch { /* audio not supported */ }
    }
    return this.ctx;
  }

  _beep(freq, type = 'sine', duration = 0.08, gain = CONFIG.SOUND_VOL, delay = 0) {
    if (this.muted) return;
    const ctx = this._ctx();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const g   = ctx.createGain();

    osc.type    = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    g.gain.setValueAtTime(0, ctx.currentTime + delay);
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + delay + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + duration);

    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + duration + 0.01);
  }

  slide()   { this._beep(440,  'square',   0.06, 0.12); }
  invalid() { this._beep(180,  'sawtooth', 0.07, 0.08); }

  win() {
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((n, i) => this._beep(n, 'sine', 0.3, 0.15, i * 0.12));
  }

  shuffle() { this._beep(300, 'triangle', 0.05, 0.08); }

  toggle() {
    this.muted = !this.muted;
    localStorage.setItem(CONFIG.LS_SOUND, JSON.stringify(this.muted));
    return this.muted;
  }
}

/* ══════════════════════════════════════════════
   3. PUZZLE LOGIC
   Solvability check, shuffle, move validation
══════════════════════════════════════════════ */
class PuzzleLogic {
  /**
   * Count inversions in a flat board array (ignoring the empty tile 0).
   */
  static countInversions(tiles) {
    const arr = tiles.filter(v => v !== 0);
    let inv = 0;
    for (let i = 0; i < arr.length - 1; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        if (arr[i] > arr[j]) inv++;
      }
    }
    return inv;
  }

  /**
   * Solvability rules:
   *  - Odd grid size  (3×3): inversions must be even.
   *  - Even grid size (4×4): (inversions + blank_row_from_bottom) must be even.
   */
  static isSolvable(tiles, size) {
    const inv = PuzzleLogic.countInversions(tiles);
    if (size % 2 === 1) {
      return inv % 2 === 0;
    } else {
      const emptyIdx     = tiles.indexOf(0);
      const emptyRow     = Math.floor(emptyIdx / size);          // 0-indexed from top
      const rowFromBottom = size - emptyRow;                      // 1-indexed from bottom
      return (inv + rowFromBottom) % 2 === 0;
    }
  }

  /** Solved state: [1, 2, 3, ..., n-1, 0] */
  static goalState(size) {
    const n = size * size;
    return [...Array(n - 1).keys()].map(i => i + 1).concat(0);
  }

  /**
   * Generate a random solvable shuffle.
   * Strategy: perform random moves from the solved state — always solvable.
   */
  static generateSolvable(size) {
    const n      = size * size;
    let   tiles  = PuzzleLogic.goalState(size);
    let   empty  = n - 1;  // index of 0
    const steps  = CONFIG.MIN_SHUFFLES[size] || 80;
    let   lastEmpty = -1;

    for (let s = 0; s < steps; s++) {
      const neighbors = PuzzleLogic.getNeighborIndices(empty, size);
      // Avoid going back to last position
      const filtered  = neighbors.filter(i => i !== lastEmpty);
      const picked    = filtered.length ? filtered : neighbors;
      const swapIdx   = picked[Math.floor(Math.random() * picked.length)];

      lastEmpty             = empty;
      [tiles[empty], tiles[swapIdx]] = [tiles[swapIdx], tiles[empty]];
      empty = swapIdx;
    }

    // Verify we didn't accidentally land on solved (very unlikely but safe)
    const goal = PuzzleLogic.goalState(size);
    if (tiles.every((v, i) => v === goal[i])) return PuzzleLogic.generateSolvable(size);

    return tiles;
  }

  /** Return indices of valid sliding neighbors of the empty cell */
  static getNeighborIndices(emptyIdx, size) {
    const row     = Math.floor(emptyIdx / size);
    const col     = emptyIdx % size;
    const result  = [];
    if (row > 0)        result.push(emptyIdx - size);   // top
    if (row < size - 1) result.push(emptyIdx + size);   // bottom
    if (col > 0)        result.push(emptyIdx - 1);      // left
    if (col < size - 1) result.push(emptyIdx + 1);      // right
    return result;
  }

  /** True if the clicked tile can move into the empty space */
  static canMove(tileIdx, emptyIdx, size) {
    return PuzzleLogic.getNeighborIndices(emptyIdx, size).includes(tileIdx);
  }

  /** True when the board matches the goal */
  static isSolved(tiles, size) {
    const goal = PuzzleLogic.goalState(size);
    return tiles.every((v, i) => v === goal[i]);
  }
}

/* ══════════════════════════════════════════════
   4. TIMER
══════════════════════════════════════════════ */
class GameTimer {
  constructor(onTick) {
    this.onTick   = onTick;
    this.elapsed  = 0;
    this._start   = null;
    this._raf     = null;
    this.running  = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._start  = performance.now() - this.elapsed;
    const loop   = (now) => {
      if (!this.running) return;
      this.elapsed = now - this._start;
      this.onTick(this.elapsed);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    return this.elapsed;
  }

  reset() {
    this.stop();
    this.elapsed = 0;
    this.onTick(0);
  }

  static format(ms) {
    const total = Math.floor(ms / 1000);
    const m     = Math.floor(total / 60).toString().padStart(2, '0');
    const s     = (total % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }
}

/* ══════════════════════════════════════════════
   5. GAME STATE MANAGER
══════════════════════════════════════════════ */
class GridLock {
  constructor() {
    this.size      = 3;
    this.tiles     = [];      // flat array of tile values (0 = empty)
    this.emptyIdx  = 0;
    this.moves     = 0;
    this.started   = false;
    this.solved    = false;
    this.history   = [];      // stack of {tiles, emptyIdx} for undo
    this.audio     = new AudioEngine();
    this.timer     = new GameTimer((ms) => this._onTick(ms));
    this._initDOM();
    this._initEvents();
    this._applyTheme(localStorage.getItem(CONFIG.LS_THEME) || 'dark');
    this._updateSoundIcon();
    this.startGame(this.size);
  }

  /* ── DOM refs ── */
  _initDOM() {
    this.boardEl     = document.getElementById('puzzleBoard');
    this.moveEl      = document.getElementById('moveCount');
    this.timerEl     = document.getElementById('timerDisplay');
    this.bestEl      = document.getElementById('bestScore');
    this.undoBtn     = document.getElementById('undoBtn');
    this.shuffleBtn  = document.getElementById('shuffleBtn');
    this.hintBtn     = document.getElementById('hintBtn');
    this.modal       = document.getElementById('victoryModal');
    this.modalMoves  = document.getElementById('modalMoves');
    this.modalTime   = document.getElementById('modalTime');
    this.modalBest   = document.getElementById('modalBest');
    this.modalRecord = document.getElementById('modalRecord');
    this.confettiEl  = document.getElementById('confettiContainer');
    this.themeToggle = document.getElementById('themeToggle');
    this.themeIcon   = document.getElementById('themeIcon');
    this.soundToggle = document.getElementById('soundToggle');
    this.soundIcon   = document.getElementById('soundIcon');
  }

  /* ── Event wiring ── */
  _initEvents() {
    // Difficulty buttons
    document.querySelectorAll('.diff-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.solved) this._closeModal();
        const size = parseInt(btn.dataset.size, 10);
        document.querySelectorAll('.diff-btn').forEach(b => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        this.startGame(size);
      });
    });

    // Controls
    this.shuffleBtn.addEventListener('click', () => this.startGame(this.size));
    this.undoBtn.addEventListener('click',    () => this.undo());
    this.hintBtn.addEventListener('click',    () => this.showHint());

    // Modal actions
    document.getElementById('playAgainBtn').addEventListener('click', () => {
      this._closeModal();
      this.startGame(this.size);
    });
    document.getElementById('changeDiffBtn').addEventListener('click', () => {
      this._closeModal();
    });

    // Theme & sound
    this.themeToggle.addEventListener('click', () => this._toggleTheme());
    this.soundToggle.addEventListener('click', () => {
      const muted = this.audio.toggle();
      this._updateSoundIcon();
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => this._handleKey(e));

    // Close modal on overlay click
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this._closeModal();
    });
  }

  /* ── Start / Restart game ── */
  startGame(size) {
    this.size     = size;
    this.moves    = 0;
    this.started  = false;
    this.solved   = false;
    this.history  = [];

    this.tiles    = PuzzleLogic.generateSolvable(size);
    this.emptyIdx = this.tiles.indexOf(0);

    this.timer.reset();
    this._updateStats();
    this._updateBest();
    this._renderBoard();
    this._setUndoEnabled(false);
    this.boardEl.classList.remove('solved');
    this.audio.shuffle();
  }

  /* ── Render entire board ── */
  _renderBoard() {
    const { size, tiles } = this;
    this.boardEl.innerHTML = '';
    this.boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;

    // Tile font scaling
    const fontSize = size === 3 ? '1.8rem' : size === 4 ? '1.35rem' : '1rem';
    this.boardEl.style.setProperty('--tile-font', fontSize);

    tiles.forEach((val, idx) => {
      const tile = document.createElement('button');
      tile.className = 'tile';
      tile.style.fontSize = fontSize;

      if (val === 0) {
        tile.classList.add('empty');
        tile.setAttribute('aria-hidden', 'true');
        tile.tabIndex = -1;
      } else {
        tile.textContent = val;
        tile.setAttribute('aria-label', `Tile ${val}`);
        tile.setAttribute('role', 'gridcell');
        tile.dataset.idx = idx;
        tile.style.animationDelay = `${idx * CONFIG.TILE_ANIM_DELAY}ms`;
        tile.classList.add('slide-in');

        // Mark movable tiles
        if (PuzzleLogic.canMove(idx, this.emptyIdx, size)) {
          tile.classList.add('can-move');
        }

        // Mark correct tiles
        if (val === idx + 1) tile.classList.add('correct');

        tile.addEventListener('click', () => this._handleTileClick(idx));
        tile.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this._handleTileClick(idx);
          }
        });
      }

      this.boardEl.appendChild(tile);
    });
  }

  /* ── Handle tile click ── */
  _handleTileClick(idx) {
    if (this.solved) return;
    if (!PuzzleLogic.canMove(idx, this.emptyIdx, this.size)) {
      this.audio.invalid();
      return;
    }

    // Save history before move
    this.history.push({ tiles: [...this.tiles], emptyIdx: this.emptyIdx });
    if (this.history.length > 50) this.history.shift(); // cap history

    // Perform move
    const ei = this.emptyIdx;
    [this.tiles[ei], this.tiles[idx]] = [this.tiles[idx], this.tiles[ei]];
    this.emptyIdx = idx;
    this.moves++;

    // Start timer on first move
    if (!this.started) {
      this.started = true;
      this.timer.start();
    }

    this.audio.slide();
    this._updateStats();
    this._renderBoard();
    this._setUndoEnabled(true);

    // Check win
    if (PuzzleLogic.isSolved(this.tiles, this.size)) {
      this._onSolved();
    }
  }

  /* ── Undo ── */
  undo() {
    if (!this.history.length || this.solved) return;
    const prev       = this.history.pop();
    this.tiles       = prev.tiles;
    this.emptyIdx    = prev.emptyIdx;
    this.moves       = Math.max(0, this.moves - 1);
    this._updateStats();
    this._renderBoard();
    this._setUndoEnabled(this.history.length > 0);
    this.audio.slide();
  }

  /* ── Hint: highlight one tile that should move ── */
  showHint() {
    if (this.solved) return;
    const neighbors = PuzzleLogic.getNeighborIndices(this.emptyIdx, this.size);
    if (!neighbors.length) return;

    // Pick the neighbor whose value matches the goal for that position
    const goal = PuzzleLogic.goalState(this.size);
    let best   = null;

    for (const ni of neighbors) {
      if (this.tiles[ni] === goal[ni]) continue; // already correct
      // Prefer the tile that when moved gets closest to correct position
      if (best === null || this.tiles[ni] < this.tiles[best]) best = ni;
    }

    if (best === null) best = neighbors[0];

    const tiles = this.boardEl.querySelectorAll('.tile');
    // Find the DOM tile at position 'best'
    for (const tile of tiles) {
      if (parseInt(tile.dataset.idx, 10) === best) {
        tile.classList.remove('hint-glow');
        void tile.offsetWidth; // reflow to restart animation
        tile.classList.add('hint-glow');
        tile.addEventListener('animationend', () => tile.classList.remove('hint-glow'), { once: true });
        break;
      }
    }
  }

  /* ── Keyboard navigation ── */
  _handleKey(e) {
    if (this.solved) return;
    const keyMap = {
      ArrowUp:    'up',    w: 'up',
      ArrowDown:  'down',  s: 'down',
      ArrowLeft:  'left',  a: 'left',
      ArrowRight: 'right', d: 'right',
    };

    const dir = keyMap[e.key];
    if (!dir) return;
    e.preventDefault();

    // The tile that should slide INTO the empty space
    const { emptyIdx, size } = this;
    const eRow = Math.floor(emptyIdx / size);
    const eCol = emptyIdx % size;

    let tileIdx = -1;
    if (dir === 'up'    && eRow < size - 1) tileIdx = emptyIdx + size;
    if (dir === 'down'  && eRow > 0)        tileIdx = emptyIdx - size;
    if (dir === 'left'  && eCol < size - 1) tileIdx = emptyIdx + 1;
    if (dir === 'right' && eCol > 0)        tileIdx = emptyIdx - 1;

    if (tileIdx !== -1 && this.tiles[tileIdx] !== 0) {
      this._handleTileClick(tileIdx);
    }
  }

  /* ── Win handler ── */
  _onSolved() {
    this.solved = true;
    const elapsed = this.timer.stop();
    this.boardEl.classList.add('solved');
    this.audio.win();

    // Best score
    const key     = CONFIG.LS_BEST_PREFIX + this.size;
    const prevBest = parseInt(localStorage.getItem(key) || '999999999', 10);
    const isRecord = elapsed < prevBest;
    if (isRecord) localStorage.setItem(key, Math.floor(elapsed));

    // Show modal after animation
    setTimeout(() => {
      this._launchConfetti();
      this.modalMoves.textContent  = this.moves;
      this.modalTime.textContent   = GameTimer.format(elapsed);
      this.modalBest.textContent   = GameTimer.format(isRecord ? elapsed : prevBest);
      this.modalRecord.hidden      = !isRecord;
      this.modal.hidden            = false;
      document.getElementById('playAgainBtn').focus();
    }, 500);
  }

  /* ── Confetti ── */
  _launchConfetti() {
    this.confettiEl.innerHTML = '';
    const count = 60;
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.cssText = `
        left: ${Math.random() * 100}%;
        background: ${CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]};
        width: ${4 + Math.random() * 8}px;
        height: ${4 + Math.random() * 8}px;
        border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
        animation-duration: ${0.8 + Math.random() * 1.4}s;
        animation-delay: ${Math.random() * 0.6}s;
      `;
      this.confettiEl.appendChild(el);
    }
  }

  /* ── Close modal ── */
  _closeModal() {
    this.modal.hidden = true;
    this.confettiEl.innerHTML = '';
  }

  /* ── UI Updates ── */
  _updateStats() {
    this.moveEl.textContent  = this.moves;
    this.timerEl.textContent = GameTimer.format(this.timer.elapsed);
  }

  _updateBest() {
    const key  = CONFIG.LS_BEST_PREFIX + this.size;
    const best = localStorage.getItem(key);
    this.bestEl.textContent = best ? GameTimer.format(parseInt(best, 10)) : '--:--';
  }

  _onTick(ms) {
    this.timerEl.textContent = GameTimer.format(ms);
  }

  _setUndoEnabled(enabled) {
    this.undoBtn.disabled = !enabled;
  }

  /* ── Theme ── */
  _applyTheme(theme) {
    this._theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    this.themeIcon.textContent = theme === 'light' ? '☽' : '☀';
    localStorage.setItem(CONFIG.LS_THEME, theme);
  }

  _toggleTheme() {
    this._applyTheme(this._theme === 'dark' ? 'light' : 'dark');
  }

  /* ── Sound icon ── */
  _updateSoundIcon() {
    this.soundIcon.textContent = this.audio.muted ? '♩' : '♪';
    this.soundToggle.title     = this.audio.muted ? 'Sound off' : 'Sound on';
  }
}

/* ══════════════════════════════════════════════
   6. BOOT
══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  window._gridLock = new GridLock();
});
