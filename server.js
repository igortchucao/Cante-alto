const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');

let QRCode = null;
try { QRCode = require('qrcode'); } catch (_) { /* QR e opcional */ }

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));

// ---------------------------------------------------------------------------
// Banco de palavras (boas pra encaixar em musica)
// ---------------------------------------------------------------------------
const WORDS = [
  'amor', 'coração', 'saudade', 'chão', 'luar', 'estrela', 'mar', 'dança',
  'beijo', 'paixão', 'vida', 'sonho', 'festa', 'verão', 'casa', 'caminho',
  'tempo', 'fogo', 'cerveja', 'café', 'chuva', 'sol', 'lua', 'flor',
  'anjo', 'dinheiro', 'madrugada', 'estrada', 'viola', 'samba', 'carnaval',
  'praia', 'coreto', 'violão', 'noite', 'dia', 'mundo', 'liberdade', 'felicidade',
  'lágrima', 'sorriso', 'esperança', 'destino', 'coragem', 'cidade'
];

// ---------------------------------------------------------------------------
// Salas (várias ao mesmo tempo, identificadas por código)
// ---------------------------------------------------------------------------
const rooms = new Map(); // code -> room

function genCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I,O,0,1 (confundem)
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function makeRoom(mode, scoring) {
  return {
    code: genCode(),
    mode: mode === 'web' ? 'web' : 'local',
    scoring: scoring !== false, // votos definem pontuação? (padrão: sim)
    state: 'lobby', // lobby | round | reveal | singing | voting | results
    hostId: null,
    players: new Map(), // socketId -> { id, name, score }
    currentWord: null,
    winnerId: null,
    usedWords: [],
    votes: new Map(), // voterId -> 'good' | 'bad'
    ready: new Set(), // quem já marcou "próxima" na tela de resultado
  };
}

function playersList(room) {
  return [...room.players.values()]
    .map(p => ({ id: p.id, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

function broadcastLobby(room) {
  io.to(room.code).emit('lobby:update', { players: playersList(room), state: room.state });
}

function pickWord(room) {
  if (room.usedWords.length >= WORDS.length) room.usedWords = [];
  let w;
  do { w = WORDS[Math.floor(Math.random() * WORDS.length)]; }
  while (room.usedWords.includes(w));
  room.usedWords.push(w);
  return w;
}

function eligibleVoters(room) {
  return [...room.players.keys()].filter(id => id !== room.winnerId);
}

// Estado ao vivo dos votos, mandado pro host a cada mudança
function emitVotingState(room) {
  const voters = eligibleVoters(room).map(id => ({
    id,
    name: room.players.get(id).name,
    value: room.votes.get(id) || null, // 'good' | 'bad' | null (ainda não votou)
  }));
  io.to(room.code + ':host').emit('voting:update', {
    voters,
    voted: room.votes.size,
    total: voters.length,
  });
}

function finishVoting(room) {
  if (room.state !== 'voting') return;
  let good = 0, bad = 0;
  for (const v of room.votes.values()) v === 'good' ? good++ : bad++;
  const winner = room.players.get(room.winnerId);
  const nailedIt = good > bad;                       // maioria favorável
  // marcado: precisa da maioria pra pontuar | desmarcado: quem apertou primeiro já pontua
  const scored = room.scoring ? nailedIt : true;
  if (winner && scored) winner.score += 1;
  room.state = 'results';
  room.ready.clear();
  io.to(room.code).emit('voting:results', {
    winnerId: room.winnerId,
    winnerName: winner ? winner.name : '',
    good, bad, nailedIt, scored, scoring: room.scoring,
    players: playersList(room),
  });
  io.to(room.code).emit('ready:update', { ready: 0, total: room.players.size });
}

// Começa uma rodada (usado tanto pelo host quanto pelo avanço automático)
function beginRound(room) {
  room.state = 'round';
  room.winnerId = null;
  room.votes.clear();
  room.ready.clear();
  room.currentWord = pickWord(room);
  io.to(room.code).emit('round:start', { word: room.currentWord });
}

// Maioria dos jogadores marcou "próxima"?
function checkAdvance(room) {
  const total = room.players.size;
  if (total > 0 && room.ready.size * 2 > total) beginRound(room);
}

function roomOf(socket) {
  const code = socket.data.room;
  return code ? rooms.get(code) : null;
}

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {

  socket.on('host:create', ({ mode, scoring } = {}) => {
    const room = makeRoom(mode, scoring);
    rooms.set(room.code, room);
    room.hostId = socket.id;
    socket.data.room = room.code;
    socket.data.role = 'host';
    socket.join(room.code);
    socket.join(room.code + ':host');
    socket.emit('host:created', { code: room.code, mode: room.mode, scoring: room.scoring, players: [], state: 'lobby' });
    console.log(`[sala ${room.code}] criada (${room.mode}, pontuação: ${room.scoring})`);
  });

  socket.on('player:join', ({ code, name }) => {
    code = (code || '').toString().trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) { socket.emit('join:error', { message: 'Sala não encontrada. Confira o código.' }); return; }
    name = (name || '').toString().trim().slice(0, 20) || 'Jogador';
    socket.data.room = code;
    socket.data.role = 'player';
    socket.join(code);
    room.players.set(socket.id, { id: socket.id, name, score: 0 });
    socket.emit('player:joined', { id: socket.id, name, code, state: room.state });
    broadcastLobby(room);
  });

  socket.on('host:startRound', () => {
    const room = roomOf(socket);
    if (!room || socket.id !== room.hostId) return;
    beginRound(room);
  });

  // Host liga/desliga a pontuação (dentro da sala, a qualquer momento)
  socket.on('host:setScoring', ({ scoring }) => {
    const room = roomOf(socket);
    if (!room || socket.id !== room.hostId) return;
    room.scoring = !!scoring;
    console.log(`[sala ${room.code}] pontuação: ${room.scoring}`);
  });

  // Host fecha a sala e volta pra tela de escolha Local/Web
  socket.on('host:close', () => {
    const room = roomOf(socket);
    if (!room || socket.id !== room.hostId) return;
    io.to(room.code).emit('host:left'); // jogadores voltam pra tela de entrada
    rooms.delete(room.code);
    socket.leave(room.code);
    socket.leave(room.code + ':host');
    socket.data.room = null;
    socket.data.role = null;
    console.log(`[sala ${room.code}] fechada pelo host`);
  });

  // Jogador marca/desmarca "próxima" na tela de resultado
  socket.on('player:ready', () => {
    const room = roomOf(socket);
    if (!room || room.state !== 'results') return;
    if (!room.players.has(socket.id)) return;
    if (room.ready.has(socket.id)) room.ready.delete(socket.id);
    else room.ready.add(socket.id);
    io.to(room.code).emit('ready:update', { ready: room.ready.size, total: room.players.size });
    checkAdvance(room);
  });

  // O primeiro tap que chegar no servidor vence. Server = fonte da verdade.
  socket.on('player:tap', () => {
    const room = roomOf(socket);
    if (!room || room.state !== 'round' || room.winnerId) return;
    if (!room.players.has(socket.id)) return;
    room.winnerId = socket.id;
    room.state = 'reveal';
    const w = room.players.get(socket.id);
    io.to(room.code).emit('round:winner', { winnerId: w.id, winnerName: w.name, word: room.currentWord });
  });

  socket.on('host:noWinner', () => {
    const room = roomOf(socket);
    if (!room || socket.id !== room.hostId || room.state !== 'round') return;
    room.state = 'lobby';
    io.to(room.code).emit('round:empty');
  });

  socket.on('host:startSinging', ({ seconds }) => {
    const room = roomOf(socket);
    if (!room || socket.id !== room.hostId) return;
    room.state = 'singing';
    const w = room.players.get(room.winnerId);
    io.to(room.code).emit('singing:start', {
      winnerId: room.winnerId,
      winnerName: w ? w.name : '',
      word: room.currentWord,
      seconds,
    });
  });

  socket.on('host:startVoting', () => {
    const room = roomOf(socket);
    if (!room || socket.id !== room.hostId) return;
    room.state = 'voting';
    room.votes.clear();
    const w = room.players.get(room.winnerId);
    io.to(room.code).emit('voting:start', {
      winnerId: room.winnerId,
      winnerName: w ? w.name : '',
      voters: eligibleVoters(room).map(id => ({ id, name: room.players.get(id).name })),
    });
    emitVotingState(room);
  });

  socket.on('player:vote', ({ value }) => {
    const room = roomOf(socket);
    if (!room || room.state !== 'voting') return;
    if (socket.id === room.winnerId) return; // quem cantou nao vota em si mesmo
    if (!room.players.has(socket.id)) return;
    if (value !== 'good' && value !== 'bad') return;
    room.votes.set(socket.id, value); // pode trocar quantas vezes quiser até o tempo acabar
    emitVotingState(room);
    // fim só pelo cronômetro (host:endVoting) — deixa a galera mudar de ideia
  });

  socket.on('host:endVoting', () => {
    const room = roomOf(socket);
    if (!room || socket.id !== room.hostId) return;
    finishVoting(room);
  });

  socket.on('host:reset', () => {
    const room = roomOf(socket);
    if (!room || socket.id !== room.hostId) return;
    room.state = 'lobby';
    room.winnerId = null;
    room.currentWord = null;
    room.votes.clear();
    broadcastLobby(room);
  });

  socket.on('disconnect', () => {
    const room = roomOf(socket);
    if (!room) return;
    if (room.players.has(socket.id)) {
      room.players.delete(socket.id);
      room.ready.delete(socket.id);
      broadcastLobby(room);
      if (room.state === 'results') {
        io.to(room.code).emit('ready:update', { ready: room.ready.size, total: room.players.size });
        checkAdvance(room); // maioria pode ter mudado com um a menos
      }
    }
    if (socket.id === room.hostId) {
      room.hostId = null;
      io.to(room.code).emit('host:left');
    }
    // limpa sala vazia
    if (!room.hostId && room.players.size === 0) {
      rooms.delete(room.code);
      console.log(`[sala ${room.code}] encerrada`);
    }
  });
});

// ---------------------------------------------------------------------------
// Endereço local (rede Wi-Fi) e gerador de QR code
// ---------------------------------------------------------------------------
function localIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// Base de entrada na REDE LOCAL (ex.: http://192.168.0.5:3000/)
app.get('/info', (req, res) => {
  res.json({ lanUrl: `http://${localIP()}:${PORT}/` });
});

// Health check — usado pelo ping que mantém o servidor acordado no Render free
app.get('/healthz', (req, res) => res.type('text').send('ok'));

// QR de qualquer URL: /qr?data=<url-encoded>
app.get('/qr', async (req, res) => {
  const data = (req.query.data || '').toString();
  if (!QRCode || !data) return res.status(404).end();
  try {
    const buf = await QRCode.toBuffer(data, { margin: 1, width: 320 });
    res.type('png').send(buf);
  } catch (_) { res.status(500).end(); }
});

server.listen(PORT, () => {
  const ip = localIP();
  console.log('\n  🎤  CANTE ALTO  🎤\n');
  console.log(`  Tela principal (host):  http://localhost:${PORT}/host`);
  console.log(`  (rede local)            http://${ip}:${PORT}/host\n`);
  console.log('  No host você escolhe Local (mesmo Wi-Fi) ou Web (internet).');
  console.log('  Web precisa do servidor publicado ou exposto por túnel.\n');
});
