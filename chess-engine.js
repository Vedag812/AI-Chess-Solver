/**
 * chess-engine.js — Full chess rules engine
 * Handles board state, move generation, validation, check/checkmate/stalemate.
 */

const PIECE = { KING: 'k', QUEEN: 'q', ROOK: 'r', BISHOP: 'b', KNIGHT: 'n', PAWN: 'p' };
const COLOR = { WHITE: 'w', BLACK: 'b' };

const PIECE_UNICODE = {
    wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
    bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟'
};

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

class ChessEngine {
    constructor(fen) {
        this.board = Array(64).fill(null);
        this.turn = COLOR.WHITE;
        this.castling = { K: true, Q: true, k: true, q: true };
        this.enPassant = -1;
        this.halfmove = 0;
        this.fullmove = 1;
        this.moveHistory = [];
        this.positionHistory = [];
        this.loadFEN(fen || INITIAL_FEN);
    }

    clone() {
        const c = new ChessEngine();
        c.board = [...this.board];
        c.turn = this.turn;
        c.castling = { ...this.castling };
        c.enPassant = this.enPassant;
        c.halfmove = this.halfmove;
        c.fullmove = this.fullmove;
        c.moveHistory = [...this.moveHistory];
        c.positionHistory = [...this.positionHistory];
        return c;
    }

    loadFEN(fen) {
        const parts = fen.trim().split(/\s+/);
        this.board = Array(64).fill(null);
        let sq = 0;
        for (const ch of parts[0]) {
            if (ch === '/') continue;
            if (ch >= '1' && ch <= '8') { sq += parseInt(ch); continue; }
            const color = ch === ch.toUpperCase() ? COLOR.WHITE : COLOR.BLACK;
            const piece = ch.toLowerCase();
            this.board[sq] = { color, piece };
            sq++;
        }
        this.turn = (parts[1] || 'w') === 'w' ? COLOR.WHITE : COLOR.BLACK;
        const cas = parts[2] || '-';
        this.castling = { K: cas.includes('K'), Q: cas.includes('Q'), k: cas.includes('k'), q: cas.includes('q') };
        this.enPassant = (parts[3] && parts[3] !== '-') ? this.algebraicToIndex(parts[3]) : -1;
        this.halfmove = parseInt(parts[4] || '0');
        this.fullmove = parseInt(parts[5] || '1');
        this.positionHistory = [this.toFEN().split(' ').slice(0, 4).join(' ')];
    }

    toFEN() {
        let fen = '';
        for (let r = 0; r < 8; r++) {
            let empty = 0;
            for (let c = 0; c < 8; c++) {
                const p = this.board[r * 8 + c];
                if (!p) { empty++; continue; }
                if (empty) { fen += empty; empty = 0; }
                fen += p.color === COLOR.WHITE ? p.piece.toUpperCase() : p.piece;
            }
            if (empty) fen += empty;
            if (r < 7) fen += '/';
        }
        fen += ' ' + this.turn;
        let cas = '';
        if (this.castling.K) cas += 'K';
        if (this.castling.Q) cas += 'Q';
        if (this.castling.k) cas += 'k';
        if (this.castling.q) cas += 'q';
        fen += ' ' + (cas || '-');
        fen += ' ' + (this.enPassant >= 0 ? this.indexToAlgebraic(this.enPassant) : '-');
        fen += ' ' + this.halfmove + ' ' + this.fullmove;
        return fen;
    }

    algebraicToIndex(s) { return (8 - parseInt(s[1])) * 8 + (s.charCodeAt(0) - 97); }
    indexToAlgebraic(i) { return String.fromCharCode(97 + (i % 8)) + (8 - Math.floor(i / 8)); }
    row(i) { return Math.floor(i / 8); }
    col(i) { return i % 8; }
    inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
    idx(r, c) { return r * 8 + c; }

    generatePseudoMoves(color) {
        const moves = [];
        for (let i = 0; i < 64; i++) {
            const p = this.board[i];
            if (!p || p.color !== color) continue;
            const r = this.row(i), c = this.col(i);
            switch (p.piece) {
                case PIECE.PAWN: this._pawnMoves(i, r, c, color, moves); break;
                case PIECE.KNIGHT: this._knightMoves(i, r, c, color, moves); break;
                case PIECE.BISHOP: this._slidingMoves(i, r, c, color, [[-1,-1],[-1,1],[1,-1],[1,1]], moves); break;
                case PIECE.ROOK: this._slidingMoves(i, r, c, color, [[-1,0],[1,0],[0,-1],[0,1]], moves); break;
                case PIECE.QUEEN: this._slidingMoves(i, r, c, color, [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]], moves); break;
                case PIECE.KING: this._kingMoves(i, r, c, color, moves); break;
            }
        }
        return moves;
    }

    _pawnMoves(i, r, c, color, moves) {
        const dir = color === COLOR.WHITE ? -1 : 1;
        const startRow = color === COLOR.WHITE ? 6 : 1;
        const promoRow = color === COLOR.WHITE ? 0 : 7;
        // Forward
        const f1 = this.idx(r + dir, c);
        if (this.inBounds(r + dir, c) && !this.board[f1]) {
            if (r + dir === promoRow) {
                for (const pr of [PIECE.QUEEN, PIECE.ROOK, PIECE.BISHOP, PIECE.KNIGHT])
                    moves.push({ from: i, to: f1, promotion: pr });
            } else {
                moves.push({ from: i, to: f1 });
                // Double push
                if (r === startRow) {
                    const f2 = this.idx(r + 2 * dir, c);
                    if (!this.board[f2]) moves.push({ from: i, to: f2 });
                }
            }
        }
        // Captures
        for (const dc of [-1, 1]) {
            if (!this.inBounds(r + dir, c + dc)) continue;
            const ti = this.idx(r + dir, c + dc);
            const target = this.board[ti];
            if (target && target.color !== color) {
                if (r + dir === promoRow) {
                    for (const pr of [PIECE.QUEEN, PIECE.ROOK, PIECE.BISHOP, PIECE.KNIGHT])
                        moves.push({ from: i, to: ti, promotion: pr });
                } else {
                    moves.push({ from: i, to: ti });
                }
            }
            // En passant
            if (ti === this.enPassant) {
                moves.push({ from: i, to: ti, enPassant: true });
            }
        }
    }

    _knightMoves(i, r, c, color, moves) {
        for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
            const nr = r + dr, nc = c + dc;
            if (!this.inBounds(nr, nc)) continue;
            const ti = this.idx(nr, nc);
            const t = this.board[ti];
            if (!t || t.color !== color) moves.push({ from: i, to: ti });
        }
    }

    _slidingMoves(i, r, c, color, dirs, moves) {
        for (const [dr, dc] of dirs) {
            let nr = r + dr, nc = c + dc;
            while (this.inBounds(nr, nc)) {
                const ti = this.idx(nr, nc);
                const t = this.board[ti];
                if (t) {
                    if (t.color !== color) moves.push({ from: i, to: ti });
                    break;
                }
                moves.push({ from: i, to: ti });
                nr += dr; nc += dc;
            }
        }
    }

    _kingMoves(i, r, c, color, moves) {
        for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
            const nr = r + dr, nc = c + dc;
            if (!this.inBounds(nr, nc)) continue;
            const ti = this.idx(nr, nc);
            const t = this.board[ti];
            if (!t || t.color !== color) moves.push({ from: i, to: ti });
        }
        // Castling
        if (color === COLOR.WHITE && i === 60) {
            if (this.castling.K && !this.board[61] && !this.board[62] && this.board[63]?.piece === PIECE.ROOK && this.board[63]?.color === COLOR.WHITE) {
                if (!this.isSquareAttacked(60, COLOR.BLACK) && !this.isSquareAttacked(61, COLOR.BLACK) && !this.isSquareAttacked(62, COLOR.BLACK))
                    moves.push({ from: 60, to: 62, castle: 'K' });
            }
            if (this.castling.Q && !this.board[59] && !this.board[58] && !this.board[57] && this.board[56]?.piece === PIECE.ROOK && this.board[56]?.color === COLOR.WHITE) {
                if (!this.isSquareAttacked(60, COLOR.BLACK) && !this.isSquareAttacked(59, COLOR.BLACK) && !this.isSquareAttacked(58, COLOR.BLACK))
                    moves.push({ from: 60, to: 58, castle: 'Q' });
            }
        }
        if (color === COLOR.BLACK && i === 4) {
            if (this.castling.k && !this.board[5] && !this.board[6] && this.board[7]?.piece === PIECE.ROOK && this.board[7]?.color === COLOR.BLACK) {
                if (!this.isSquareAttacked(4, COLOR.WHITE) && !this.isSquareAttacked(5, COLOR.WHITE) && !this.isSquareAttacked(6, COLOR.WHITE))
                    moves.push({ from: 4, to: 6, castle: 'k' });
            }
            if (this.castling.q && !this.board[3] && !this.board[2] && !this.board[1] && this.board[0]?.piece === PIECE.ROOK && this.board[0]?.color === COLOR.BLACK) {
                if (!this.isSquareAttacked(4, COLOR.WHITE) && !this.isSquareAttacked(3, COLOR.WHITE) && !this.isSquareAttacked(2, COLOR.WHITE))
                    moves.push({ from: 4, to: 2, castle: 'q' });
            }
        }
    }

    isSquareAttacked(sq, byColor) {
        const r = this.row(sq), c = this.col(sq);
        // Knights
        for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
            const nr = r + dr, nc = c + dc;
            if (this.inBounds(nr, nc)) {
                const p = this.board[this.idx(nr, nc)];
                if (p && p.color === byColor && p.piece === PIECE.KNIGHT) return true;
            }
        }
        // King
        for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
            const nr = r + dr, nc = c + dc;
            if (this.inBounds(nr, nc)) {
                const p = this.board[this.idx(nr, nc)];
                if (p && p.color === byColor && p.piece === PIECE.KING) return true;
            }
        }
        // Pawns
        const pdir = byColor === COLOR.WHITE ? 1 : -1;
        for (const dc of [-1, 1]) {
            const nr = r + pdir, nc = c + dc;
            if (this.inBounds(nr, nc)) {
                const p = this.board[this.idx(nr, nc)];
                if (p && p.color === byColor && p.piece === PIECE.PAWN) return true;
            }
        }
        // Sliding: rook/queen (straights)
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            let nr = r + dr, nc = c + dc;
            while (this.inBounds(nr, nc)) {
                const p = this.board[this.idx(nr, nc)];
                if (p) {
                    if (p.color === byColor && (p.piece === PIECE.ROOK || p.piece === PIECE.QUEEN)) return true;
                    break;
                }
                nr += dr; nc += dc;
            }
        }
        // Sliding: bishop/queen (diagonals)
        for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
            let nr = r + dr, nc = c + dc;
            while (this.inBounds(nr, nc)) {
                const p = this.board[this.idx(nr, nc)];
                if (p) {
                    if (p.color === byColor && (p.piece === PIECE.BISHOP || p.piece === PIECE.QUEEN)) return true;
                    break;
                }
                nr += dr; nc += dc;
            }
        }
        return false;
    }

    findKing(color) {
        for (let i = 0; i < 64; i++) {
            const p = this.board[i];
            if (p && p.color === color && p.piece === PIECE.KING) return i;
        }
        return -1;
    }

    isInCheck(color) {
        const kingSq = this.findKing(color);
        if (kingSq < 0) return false;
        return this.isSquareAttacked(kingSq, color === COLOR.WHITE ? COLOR.BLACK : COLOR.WHITE);
    }

    makeMove(move) {
        const saved = {
            board: [...this.board],
            turn: this.turn,
            castling: { ...this.castling },
            enPassant: this.enPassant,
            halfmove: this.halfmove,
            fullmove: this.fullmove
        };

        const piece = this.board[move.from];
        const captured = this.board[move.to];
        const isPawnMove = piece.piece === PIECE.PAWN;
        const isCapture = !!captured || move.enPassant;

        // En passant capture
        if (move.enPassant) {
            const epCapSq = move.to + (piece.color === COLOR.WHITE ? 8 : -8);
            this.board[epCapSq] = null;
        }

        // Move piece
        this.board[move.to] = piece;
        this.board[move.from] = null;

        // Promotion
        if (move.promotion) {
            this.board[move.to] = { color: piece.color, piece: move.promotion };
        }

        // Castling rook move
        if (move.castle) {
            switch (move.castle) {
                case 'K': this.board[61] = this.board[63]; this.board[63] = null; break;
                case 'Q': this.board[59] = this.board[56]; this.board[56] = null; break;
                case 'k': this.board[5] = this.board[7]; this.board[7] = null; break;
                case 'q': this.board[3] = this.board[0]; this.board[0] = null; break;
            }
        }

        // Update castling rights
        if (piece.piece === PIECE.KING) {
            if (piece.color === COLOR.WHITE) { this.castling.K = false; this.castling.Q = false; }
            else { this.castling.k = false; this.castling.q = false; }
        }
        if (move.from === 63 || move.to === 63) this.castling.K = false;
        if (move.from === 56 || move.to === 56) this.castling.Q = false;
        if (move.from === 7 || move.to === 7) this.castling.k = false;
        if (move.from === 0 || move.to === 0) this.castling.q = false;

        // En passant square
        if (isPawnMove && Math.abs(move.to - move.from) === 16) {
            this.enPassant = (move.from + move.to) / 2;
        } else {
            this.enPassant = -1;
        }

        // Halfmove clock
        this.halfmove = (isPawnMove || isCapture) ? 0 : this.halfmove + 1;
        if (this.turn === COLOR.BLACK) this.fullmove++;
        this.turn = this.turn === COLOR.WHITE ? COLOR.BLACK : COLOR.WHITE;

        // Store position for repetition detection
        this.positionHistory.push(this.toFEN().split(' ').slice(0, 4).join(' '));

        return { saved, captured, move };
    }

    unmakeMove(undoData) {
        const s = undoData.saved;
        this.board = s.board;
        this.turn = s.turn;
        this.castling = s.castling;
        this.enPassant = s.enPassant;
        this.halfmove = s.halfmove;
        this.fullmove = s.fullmove;
        this.positionHistory.pop();
    }

    generateLegalMoves(color) {
        color = color || this.turn;
        const pseudoMoves = this.generatePseudoMoves(color);
        const legal = [];
        for (const m of pseudoMoves) {
            const undo = this.makeMove(m);
            if (!this.isInCheck(color)) {
                legal.push(m);
            }
            this.unmakeMove(undo);
        }
        return legal;
    }

    isCheckmate() {
        return this.isInCheck(this.turn) && this.generateLegalMoves().length === 0;
    }

    isStalemate() {
        return !this.isInCheck(this.turn) && this.generateLegalMoves().length === 0;
    }

    isDraw() {
        if (this.halfmove >= 100) return 'fifty-move';
        if (this.isStalemate()) return 'stalemate';
        // Threefold repetition
        const currentPos = this.toFEN().split(' ').slice(0, 4).join(' ');
        let count = 0;
        for (const p of this.positionHistory) { if (p === currentPos) count++; }
        if (count >= 3) return 'repetition';
        // Insufficient material
        const pieces = { w: [], b: [] };
        for (let i = 0; i < 64; i++) {
            const p = this.board[i];
            if (p && p.piece !== PIECE.KING) pieces[p.color].push(p.piece);
        }
        if (pieces.w.length === 0 && pieces.b.length === 0) return 'insufficient';
        if (pieces.w.length === 0 && pieces.b.length === 1 && (pieces.b[0] === PIECE.BISHOP || pieces.b[0] === PIECE.KNIGHT)) return 'insufficient';
        if (pieces.b.length === 0 && pieces.w.length === 1 && (pieces.w[0] === PIECE.BISHOP || pieces.w[0] === PIECE.KNIGHT)) return 'insufficient';
        return false;
    }

    moveToSAN(move) {
        const piece = this.board[move.from];
        if (!piece) return '???';
        const to = this.indexToAlgebraic(move.to);
        const captured = this.board[move.to] || move.enPassant;
        let san = '';
        if (move.castle === 'K' || move.castle === 'k') return 'O-O';
        if (move.castle === 'Q' || move.castle === 'q') return 'O-O-O';
        if (piece.piece !== PIECE.PAWN) {
            san += piece.piece.toUpperCase();
            // Disambiguation
            const others = this.generatePseudoMoves(piece.color).filter(m =>
                m.to === move.to && m.from !== move.from &&
                this.board[m.from]?.piece === piece.piece
            );
            if (others.length > 0) {
                const sameCol = others.some(m => this.col(m.from) === this.col(move.from));
                const sameRow = others.some(m => this.row(m.from) === this.row(move.from));
                if (!sameCol) san += String.fromCharCode(97 + this.col(move.from));
                else if (!sameRow) san += (8 - this.row(move.from));
                else san += this.indexToAlgebraic(move.from);
            }
        }
        if (captured) {
            if (piece.piece === PIECE.PAWN) san += String.fromCharCode(97 + this.col(move.from));
            san += 'x';
        }
        san += to;
        if (move.promotion) san += '=' + move.promotion.toUpperCase();
        // Check / checkmate
        const undo = this.makeMove(move);
        if (this.isCheckmate()) san += '#';
        else if (this.isInCheck(this.turn)) san += '+';
        this.unmakeMove(undo);
        return san;
    }

    getGameStatus() {
        if (this.isCheckmate()) return { over: true, result: this.turn === COLOR.WHITE ? 'black' : 'white', reason: 'checkmate' };
        const draw = this.isDraw();
        if (draw) return { over: true, result: 'draw', reason: draw };
        return { over: false, inCheck: this.isInCheck(this.turn) };
    }
}
