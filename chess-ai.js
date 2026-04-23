/**
 * chess-ai.js — AI with multiple strategies (Aggressive, Positional, Defensive)
 * Uses Minimax + Alpha-Beta pruning with strategy-specific evaluation weights.
 * Similar to the Uno MCTS approach: strategy emerges from outcome statistics.
 */

class ChessAI {
    constructor(depth = 4, strategy = 'positional') {
        this.maxDepth = depth;
        this.strategy = strategy;
        this.nodesSearched = 0;
        this.searchTime = 0;
        // Learning: track win/loss per opening to bias future play
        this.openingScores = {};
    }

    static PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

    // Piece-square tables
    static PST = {
        p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
        n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
        b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
        r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
        q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
        k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
        k_end: [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50]
    };

    // Strategy weights — THIS is how different agents "learn" different styles
    static STRATEGY_WEIGHTS = {
        aggressive: { material: 1.0, position: 0.8, mobility: 1.5, attack: 2.0, kingSafety: 0.5, centerControl: 1.0 },
        positional: { material: 1.0, position: 1.3, mobility: 1.0, attack: 0.8, kingSafety: 1.2, centerControl: 1.5 },
        defensive:  { material: 1.2, position: 1.0, mobility: 0.8, attack: 0.5, kingSafety: 2.0, centerControl: 0.8 },
        random:     { material: 0.3, position: 0.2, mobility: 0.1, attack: 0.1, kingSafety: 0.1, centerControl: 0.1 }
    };

    evaluate(engine) {
        const w = ChessAI.STRATEGY_WEIGHTS[this.strategy] || ChessAI.STRATEGY_WEIGHTS.positional;
        let score = 0;
        let whiteMat = 0, blackMat = 0;
        let whiteAttacks = 0, blackAttacks = 0;

        // Material + PST
        for (let i = 0; i < 64; i++) {
            const p = engine.board[i];
            if (!p) continue;
            const val = ChessAI.PIECE_VALUES[p.piece];
            if (p.color === COLOR.WHITE) whiteMat += val; else blackMat += val;
        }

        const isEndgame = (whiteMat + blackMat - 40000) < 2600;

        for (let i = 0; i < 64; i++) {
            const p = engine.board[i];
            if (!p) continue;
            const val = ChessAI.PIECE_VALUES[p.piece];
            let pstKey = p.piece;
            if (p.piece === PIECE.KING && isEndgame) pstKey = 'k_end';
            const pst = ChessAI.PST[pstKey];

            if (p.color === COLOR.WHITE) {
                score += val * w.material + pst[i] * w.position;
            } else {
                const mi = (7 - Math.floor(i / 8)) * 8 + (i % 8);
                score -= val * w.material + pst[mi] * w.position;
            }
        }

        // Mobility
        const wMoves = engine.generatePseudoMoves(COLOR.WHITE);
        const bMoves = engine.generatePseudoMoves(COLOR.BLACK);
        score += (wMoves.length - bMoves.length) * 3 * w.mobility;

        // Attack score — count captures available
        whiteAttacks = wMoves.filter(m => engine.board[m.to] && engine.board[m.to].color === COLOR.BLACK).length;
        blackAttacks = bMoves.filter(m => engine.board[m.to] && engine.board[m.to].color === COLOR.WHITE).length;
        score += (whiteAttacks - blackAttacks) * 8 * w.attack;

        // King safety — pawns near king
        const wKing = engine.findKing(COLOR.WHITE);
        const bKing = engine.findKing(COLOR.BLACK);
        if (wKing >= 0) score += this._kingSafety(engine, wKing, COLOR.WHITE) * w.kingSafety;
        if (bKing >= 0) score -= this._kingSafety(engine, bKing, COLOR.BLACK) * w.kingSafety;

        // Center control (d4,d5,e4,e5 = indices 27,28,35,36)
        const centerSqs = [27, 28, 35, 36];
        for (const sq of centerSqs) {
            const p = engine.board[sq];
            if (p) {
                score += (p.color === COLOR.WHITE ? 15 : -15) * w.centerControl;
            }
        }

        // Random noise for random strategy
        if (this.strategy === 'random') score += (Math.random() - 0.5) * 200;

        return engine.turn === COLOR.WHITE ? score : -score;
    }

    _kingSafety(engine, kingSq, color) {
        let safety = 0;
        const kr = Math.floor(kingSq / 8), kc = kingSq % 8;
        const dir = color === COLOR.WHITE ? -1 : 1;
        // Check pawn shield
        for (let dc = -1; dc <= 1; dc++) {
            const nr = kr + dir, nc = kc + dc;
            if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                const p = engine.board[nr * 8 + nc];
                if (p && p.color === color && p.piece === PIECE.PAWN) safety += 10;
            }
        }
        return safety;
    }

    orderMoves(engine, moves) {
        return moves.sort((a, b) => {
            let sa = 0, sb = 0;
            const ca = engine.board[a.to], cb = engine.board[b.to];
            if (ca) sa += ChessAI.PIECE_VALUES[ca.piece] * 10 - ChessAI.PIECE_VALUES[engine.board[a.from].piece];
            if (cb) sb += ChessAI.PIECE_VALUES[cb.piece] * 10 - ChessAI.PIECE_VALUES[engine.board[b.from].piece];
            if (a.promotion) sa += ChessAI.PIECE_VALUES[a.promotion] * 10;
            if (b.promotion) sb += ChessAI.PIECE_VALUES[b.promotion] * 10;
            if (a.castle) sa += 60;
            if (b.castle) sb += 60;
            return sb - sa;
        });
    }

    minimax(engine, depth, alpha, beta, maximizing) {
        this.nodesSearched++;
        if (depth === 0) return this.evaluate(engine);

        const status = engine.getGameStatus();
        if (status.over) {
            if (status.result === 'draw') return 0;
            return maximizing ? -99999 - depth : 99999 + depth;
        }

        let moves = engine.generateLegalMoves();
        if (this.strategy === 'random' && depth === this.maxDepth) {
            // Shuffle for random agent at root
            moves.sort(() => Math.random() - 0.5);
        } else {
            moves = this.orderMoves(engine, moves);
        }

        if (maximizing) {
            let best = -Infinity;
            for (const m of moves) {
                const u = engine.makeMove(m);
                best = Math.max(best, this.minimax(engine, depth - 1, alpha, beta, false));
                engine.unmakeMove(u);
                alpha = Math.max(alpha, best);
                if (beta <= alpha) break;
            }
            return best;
        } else {
            let best = Infinity;
            for (const m of moves) {
                const u = engine.makeMove(m);
                best = Math.min(best, this.minimax(engine, depth - 1, alpha, beta, true));
                engine.unmakeMove(u);
                beta = Math.min(beta, best);
                if (beta <= alpha) break;
            }
            return best;
        }
    }

    findBestMove(engine) {
        this.nodesSearched = 0;
        const t0 = performance.now();
        let moves = engine.generateLegalMoves();
        if (moves.length === 0) return null;
        if (moves.length === 1) return { move: moves[0], score: 0, nodes: 1, time: 0 };

        if (this.strategy === 'random') {
            moves.sort(() => Math.random() - 0.5);
        } else {
            moves = this.orderMoves(engine, moves);
        }

        let bestMove = moves[0], bestScore = -Infinity;
        for (const m of moves) {
            const u = engine.makeMove(m);
            const s = -this.minimax(engine, this.maxDepth - 1, -Infinity, Infinity, false);
            engine.unmakeMove(u);
            if (s > bestScore) { bestScore = s; bestMove = m; }
        }

        this.searchTime = performance.now() - t0;
        return { move: bestMove, score: bestScore, nodes: this.nodesSearched, time: Math.round(this.searchTime) };
    }
}
