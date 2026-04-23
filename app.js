/**
 * app.js — AI vs AI Auto-Play Controller
 * Two agents compete autonomously. Matches are tracked, logged, and visualized.
 * Inspired by the Uno MCTS project: agents discover strategy through play.
 */
(function () {
    'use strict';

    // ===== STATE =====
    let game = new ChessEngine();
    let whiteAI = new ChessAI(4, 'aggressive');
    let blackAI = new ChessAI(4, 'positional');
    let running = false;
    let paused = false;
    let moveDelay = 500;
    let lastMove = null;
    let moveList = [];
    let matchCount = 0;
    let totalMovesPlayed = 0;
    let totalNodesSearched = 0;
    let whiteWins = 0;
    let blackWins = 0;
    let draws = 0;
    let matchLog = [];
    let timeoutId = null;

    const SPEED_MAP = [1500, 800, 500, 200, 50];
    const SPEED_LABELS = ['1.5s', '800ms', '500ms', '200ms', '50ms'];

    // ===== PARTICLES =====
    function initParticles() {
        const c = document.getElementById('particles-canvas');
        const ctx = c.getContext('2d');
        const ps = [];
        function resize() { c.width = innerWidth; c.height = innerHeight; }
        resize(); addEventListener('resize', resize);
        for (let i = 0; i < 40; i++) ps.push({ x: Math.random() * c.width, y: Math.random() * c.height, r: Math.random() * 1.5 + 0.5, dx: (Math.random() - 0.5) * 0.25, dy: (Math.random() - 0.5) * 0.25, a: Math.random() * 0.3 + 0.1 });
        (function draw() {
            ctx.clearRect(0, 0, c.width, c.height);
            for (const p of ps) { p.x += p.dx; p.y += p.dy; if (p.x < 0) p.x = c.width; if (p.x > c.width) p.x = 0; if (p.y < 0) p.y = c.height; if (p.y > c.height) p.y = 0; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fillStyle = `rgba(99,102,241,${p.a})`; ctx.fill(); }
            requestAnimationFrame(draw);
        })();
    }

    // ===== RENDER BOARD =====
    function renderBoard(animateMove) {
        const boardEl = document.getElementById('chess-board');

        // Capture old piece positions for animation
        let oldPositions = {};
        if (animateMove && lastMove) {
            const oldSquares = boardEl.querySelectorAll('.square');
            oldSquares.forEach(sq => {
                const piece = sq.querySelector('.piece');
                if (piece) {
                    const rect = sq.getBoundingClientRect();
                    oldPositions[sq.dataset.index] = { x: rect.left, y: rect.top };
                }
            });
        }

        boardEl.innerHTML = '';
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const idx = r * 8 + c;
                const sq = document.createElement('div');
                sq.className = 'square ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
                sq.dataset.index = idx;
                if (lastMove && (idx === lastMove.from || idx === lastMove.to)) sq.classList.add('last-move');
                if (game.isInCheck(game.turn) && idx === game.findKing(game.turn)) sq.classList.add('check');
                const p = game.board[idx];
                if (p) {
                    const span = document.createElement('span');
                    span.className = 'piece ' + (p.color === COLOR.WHITE ? 'white-piece' : 'black-piece');
                    span.textContent = PIECE_UNICODE[p.color + p.piece];
                    span.dataset.index = idx;
                    sq.appendChild(span);
                }
                boardEl.appendChild(sq);
            }
        }

        // Animate the moved piece sliding from old square to new square
        if (animateMove && lastMove) {
            const toIdx = lastMove.to;
            const fromIdx = lastMove.from;
            const toSq = boardEl.querySelector(`.square[data-index="${toIdx}"]`);
            const piece = toSq ? toSq.querySelector('.piece') : null;
            if (piece && oldPositions[fromIdx]) {
                const newRect = toSq.getBoundingClientRect();
                const dx = oldPositions[fromIdx].x - newRect.left;
                const dy = oldPositions[fromIdx].y - newRect.top;
                // Start at old position, animate to new
                piece.style.transform = `translate(${dx}px, ${dy}px)`;
                piece.style.transition = 'none';
                // Force reflow then animate
                piece.offsetHeight;
                piece.style.transition = 'transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                piece.style.transform = 'translate(0, 0)';
                // Clean up after animation
                piece.addEventListener('transitionend', () => {
                    piece.style.transform = '';
                    piece.style.transition = '';
                }, { once: true });
            }
        }

        // Coordinates
        const ranks = document.getElementById('rank-labels');
        const files = document.getElementById('file-labels');
        ranks.innerHTML = ''; files.innerHTML = '';
        for (let i = 0; i < 8; i++) { const s = document.createElement('span'); s.textContent = 8 - i; ranks.appendChild(s); }
        for (const f of 'abcdefgh') { const s = document.createElement('span'); s.textContent = f; files.appendChild(s); }
    }

    // ===== UPDATE UI =====
    function updateEval() {
        const quickAI = new ChessAI(1, 'positional');
        const raw = quickAI.evaluate(game);
        const whiteEval = game.turn === COLOR.WHITE ? raw : -raw;
        const cp = whiteEval / 100;
        const pct = Math.max(5, Math.min(95, 50 + cp * 4));
        document.getElementById('eval-bar-white').style.width = pct + '%';
        document.getElementById('eval-bar-black').style.width = (100 - pct) + '%';
        document.getElementById('eval-center').textContent = (cp >= 0 ? '+' : '') + cp.toFixed(1);
    }

    function updateTurnIndicator() {
        const dot = document.querySelector('.turn-dot');
        const text = document.getElementById('turn-text');
        if (!running || paused) {
            dot.className = 'turn-dot ' + (paused ? 'paused' : 'ended');
            text.textContent = paused ? 'Paused' : 'Waiting...';
        } else {
            dot.className = 'turn-dot';
            const side = game.turn === COLOR.WHITE ? 'White' : 'Black';
            const strat = game.turn === COLOR.WHITE ? whiteAI.strategy : blackAI.strategy;
            text.textContent = `${side} (${strat}) thinking...`;
        }
    }

    function updateStats(result) {
        document.getElementById('stat-turn').textContent = game.turn === COLOR.WHITE ? 'White' : 'Black';
        document.getElementById('stat-move-num').textContent = moveList.length;
        if (result) {
            document.getElementById('stat-nodes').textContent = result.nodes.toLocaleString();
            document.getElementById('stat-time').textContent = result.time + 'ms';
            document.getElementById('stat-score').textContent = (result.score / 100).toFixed(2);
        }
    }

    function updateHeaderStats() {
        document.getElementById('total-matches').textContent = matchCount;
        document.getElementById('total-moves-stat').textContent = totalMovesPlayed.toLocaleString();
        document.getElementById('total-nodes-stat').textContent = totalNodesSearched > 1e6 ? (totalNodesSearched / 1e6).toFixed(1) + 'M' : totalNodesSearched.toLocaleString();
        document.getElementById('white-wins').textContent = whiteWins;
        document.getElementById('black-wins').textContent = blackWins;
    }

    function updateAgentLabels() {
        const ws = document.getElementById('white-strategy').value;
        const wd = document.getElementById('white-depth').value;
        const bs = document.getElementById('black-strategy').value;
        const bd = document.getElementById('black-depth').value;
        document.getElementById('white-agent-type').textContent = `${ws.charAt(0).toUpperCase() + ws.slice(1)} · Depth ${wd}`;
        document.getElementById('black-agent-type').textContent = `${bs.charAt(0).toUpperCase() + bs.slice(1)} · Depth ${bd}`;
    }

    // ===== MOVE LIST =====
    function renderMoveList() {
        const el = document.getElementById('move-list');
        if (moveList.length === 0) { el.innerHTML = '<div class="move-list-empty">Waiting for match to start...</div>'; return; }
        let html = '';
        for (let i = 0; i < moveList.length; i += 2) {
            const n = Math.floor(i / 2) + 1;
            const wCls = i === moveList.length - 1 ? ' move-latest' : '';
            const bCls = i + 1 === moveList.length - 1 ? ' move-latest' : '';
            html += `<div class="move-row"><span class="move-num">${n}.</span><span class="move-w${wCls}">${moveList[i]}</span><span class="move-b${bCls}">${moveList[i + 1] || ''}</span></div>`;
        }
        el.innerHTML = html;
        el.scrollTop = el.scrollHeight;
    }

    // ===== MATCH LOG =====
    function addMatchLog(result, reason, numMoves) {
        matchLog.push({ result, reason, numMoves, match: matchCount });
        const el = document.getElementById('match-log');
        let cls = 'match-entry';
        let icon = '', text = '';
        if (result === 'white') { cls += ' white-win'; icon = '♔'; text = 'White wins'; }
        else if (result === 'black') { cls += ' black-win'; icon = '♚'; text = 'Black wins'; }
        else { cls += ' draw-result'; icon = '½'; text = 'Draw'; }
        const entry = document.createElement('div');
        entry.className = cls;
        entry.innerHTML = `<span class="match-num">#${matchCount}</span><span class="match-result">${icon} ${text}</span><span class="match-detail">${reason} · ${numMoves} moves</span>`;
        // Remove empty placeholder
        const empty = el.querySelector('.move-list-empty');
        if (empty) empty.remove();
        el.prepend(entry);
    }

    // ===== GAME OVER =====
    function showGameOver(status) {
        const overlay = document.getElementById('gameover-overlay');
        const icon = document.getElementById('go-icon');
        const text = document.getElementById('go-text');
        const sub = document.getElementById('go-sub');
        const numMoves = moveList.length;

        matchCount++;
        if (status.result === 'white') { whiteWins++; icon.textContent = '♔'; text.textContent = `White wins by ${status.reason}!`; }
        else if (status.result === 'black') { blackWins++; icon.textContent = '♚'; text.textContent = `Black wins by ${status.reason}!`; }
        else { draws++; icon.textContent = '½'; text.textContent = `Draw — ${status.reason}`; }

        addMatchLog(status.result === 'draw' ? 'draw' : status.result, status.reason, numMoves);
        updateHeaderStats();

        const autoRematch = document.getElementById('auto-rematch').checked;
        sub.textContent = autoRematch ? 'Starting next match in 2s...' : 'Match ended.';

        overlay.style.display = 'flex';
        setTimeout(() => { overlay.style.display = 'none'; }, 2500);

        if (autoRematch) {
            setTimeout(() => { resetGame(); startMatch(); }, 2800);
        } else {
            running = false;
            updateTurnIndicator();
            document.getElementById('btn-start').disabled = false;
            document.getElementById('btn-pause').disabled = true;
        }
    }

    // ===== GAME LOOP =====
    function playNextMove() {
        if (!running || paused) return;

        const status = game.getGameStatus();
        if (status.over) { showGameOver(status); return; }

        const currentAI = game.turn === COLOR.WHITE ? whiteAI : blackAI;
        updateTurnIndicator();

        // Use setTimeout so UI updates between moves
        timeoutId = setTimeout(() => {
            if (!running || paused) return;

            const result = currentAI.findBestMove(game);
            if (!result || !result.move) { running = false; return; }

            const san = game.moveToSAN(result.move);
            game.makeMove(result.move);
            lastMove = result.move;
            moveList.push(san);
            totalMovesPlayed++;
            totalNodesSearched += result.nodes;

            renderBoard(true);
            renderMoveList();
            updateEval();
            updateStats(result);
            updateHeaderStats();

            // Check game over after move
            const newStatus = game.getGameStatus();
            if (newStatus.over) { showGameOver(newStatus); return; }

            // Schedule next move
            playNextMove();
        }, moveDelay);
    }

    function startMatch() {
        if (running) return;
        running = true;
        paused = false;

        // Build AIs from settings
        const ws = document.getElementById('white-strategy').value;
        const wd = parseInt(document.getElementById('white-depth').value);
        const bs = document.getElementById('black-strategy').value;
        const bd = parseInt(document.getElementById('black-depth').value);
        whiteAI = new ChessAI(wd, ws);
        blackAI = new ChessAI(bd, bs);
        updateAgentLabels();

        document.getElementById('btn-start').disabled = true;
        document.getElementById('btn-pause').disabled = false;

        playNextMove();
    }

    function pauseMatch() {
        if (!running) return;
        paused = !paused;
        const btn = document.getElementById('btn-pause');
        btn.innerHTML = paused ? '<span class="ctrl-icon">▶</span> Resume' : '<span class="ctrl-icon">⏸</span> Pause';
        updateTurnIndicator();
        if (!paused) playNextMove();
    }

    function resetGame() {
        running = false;
        paused = false;
        if (timeoutId) clearTimeout(timeoutId);

        const fen = document.getElementById('fen-input').value.trim();
        game = fen ? new ChessEngine(fen) : new ChessEngine();
        lastMove = null;
        moveList = [];

        renderBoard();
        renderMoveList();
        updateEval();
        updateTurnIndicator();
        updateStats(null);

        document.getElementById('btn-start').disabled = false;
        document.getElementById('btn-pause').disabled = true;
        document.getElementById('btn-pause').innerHTML = '<span class="ctrl-icon">⏸</span> Pause';
    }

    // ===== INIT =====
    function init() {
        initParticles();
        renderBoard();
        updateEval();
        updateTurnIndicator();
        updateAgentLabels();

        // Controls
        document.getElementById('btn-start').addEventListener('click', startMatch);
        document.getElementById('btn-pause').addEventListener('click', pauseMatch);
        document.getElementById('btn-reset').addEventListener('click', resetGame);

        // Speed
        document.getElementById('speed-slider').addEventListener('input', (e) => {
            const v = parseInt(e.target.value);
            moveDelay = SPEED_MAP[v];
            document.getElementById('speed-value').textContent = SPEED_LABELS[v];
        });

        // Strategy selectors
        ['white-strategy', 'white-depth', 'black-strategy', 'black-depth'].forEach(id => {
            document.getElementById(id).addEventListener('change', updateAgentLabels);
        });

        // FEN
        document.getElementById('btn-load-fen').addEventListener('click', () => {
            resetGame();
        });

        // Puzzle presets
        document.querySelectorAll('.puzzle-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById('fen-input').value = btn.dataset.fen;
                resetGame();
            });
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
