const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

/* 🔥 IMPORTANT: allow polling properly */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
  })
);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["polling"], // REQUIRED on Render free tier
});

const rooms = {};

const WORD_PAIRS = [
  ["Apple", "Pie"],
  ["Pizza", ""],
  ["Coffee", ""],
  ["Dog", "Cat"],
  ["Summer", ""],
  ["Island", ""],
  ["Desert", ""],
  ["Mountain", ""],
  ["Netflix", "Disney"],
  ["Google", "Apple"],
  ["Messi", "Chetri"],
   ["Dubai", ""],
  ["Tokyo", ""],
  ["Rome", ""],
  ["YouTube", "TikTok"],
  ["Facebook", "Instagram"],
  ["WhatsApp", "Telegram"],
  ["Amazon", "Dmart"],
  ["Beach", ""],
  ["Forest", ""],
  ["Pogo", "HotStar"],
  ["Samsung", "Android"],
  ["London", ""],
  ["Berlin", ""],
  ["Google", "Internet"],
  ["Pizza", "Burger"],
  ["Coffee", "Tea"],
  ["Dog", "Cat"],
  ["Lion", "Tiger"],
  ["Messi", "Argentina"],
  ["Batman", "Superman"],
  ["Pyramids", ""],
  ["TajMahal", ""],
  ["Train", "Engine"],
  ["Summer", "Hot"],
  ["Pepsi", "Fizz"],
   ["Volcano", ""],
  ["KFC", ""],
  ["Dog", "Cat"],
  ["Coffee", "Expresso"],
  ["Apple", "Android"],
  ["Paris", ""],
  ["Sydney", ""],
  ["Snow",""],
  ["Waffle",""],
  ["Speaker",""],
  ["Trump",""],
  ["Ronaldo",""],
  ["Group",""],
  ["Choco","Chips"],
  ["Camping",""],
  ["Concert",""],
  ["Undercover",""],
  ["FIFA",""],
  ["Tax",""],
  ["Income",""],
  ["Deer",""],
  ["Excel",""],
  ["Notes",""],
  ["Rose","Valentine"],
  ["Wine","Blood"],
  ["Salary", "Bonus"],
  ["Tax", "GST"],
  ["Loan", "Debt"],
  ["Profit", "Revenue"],
  ["Client", "Customer"],
  ["Team", "Group"],
  ["Roast", ""],
  ["Meme", ""],
  ["Hangover", ""],
  ["Crush", ""],  
  ["Selfie", "Photo"],  
  ["Rose","Red"],
  ["English","England"]
];

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // JOIN ROOM
  socket.on("join-room", ({ room, name }) => {
    socket.join(room);
    socket.roomCode = room;
    console.log("JOIN:", room, name);
    if (!rooms[room]) {
      rooms[room] = {
        players: [],
        hostId: socket.id,
        phase: "lobby",
        votesByPlayer: {},
        voteCount: {},
        message: ""
      };
    }
    const existingByName = rooms[room].players.find(p => p.name === name);
    if (existingByName) {
      existingByName.id = socket.id;
      existingByName.connected = true;
      socket.roomCode = room;
      io.to(room).emit("state", rooms[room]);
      return;
    }
    if (rooms[room].phase !== "lobby") {
      socket.emit("game-error", "Game in progress. You will join next round.");
      socket.leave(room);
      return;
    }
    // add player (no duplicates). If same name reconnects, keep score if present
    if (!rooms[room].players.some(p => p.id === socket.id)) {
      // if a player with same name exists (left earlier), we keep their score and update id
      if (existingByName && !rooms[room].players.some(p => p.id === socket.id)) {
        // replace the old entry's id (this handles rejoin by same player)
        existingByName.id = socket.id;
      } else {
        rooms[room].players.push({
          id: socket.id,
          name,
          alive: true,
          role: null,
          score: existingByName?.score ?? 0,
          connected: true
        });
      }
    }

    io.to(room).emit("state", rooms[room]);
  });

 socket.on("startGame", ({ mode = "normal" } = {}) => {
  const room = rooms[socket.roomCode];
  if (!room) return;

  if (room.players.length < 3) {
    socket.emit("game-error", "Minimum 3 players required");
    return;
  }

  room.mode = mode;

  const [civilianWord, undercoverWord] =
    WORD_PAIRS[Math.floor(Math.random() * WORD_PAIRS.length)];

  const undercoverIndex = Math.floor(Math.random() * room.players.length);

  room.players = room.players.map((p, idx) => {
    const isUndercover = idx === undercoverIndex;

    // 🧠 TRUE ROLE (server-only)
    const trueRole = isUndercover ? "undercover" : "civilian";

    // 🎭 WHAT PLAYER SEES
    let visibleRole = "civilian";
    let word = civilianWord;

    if (isUndercover) {
      if (!undercoverWord) {
        // Case: ["Pizza", ""]
        visibleRole = "undercover";
        word = null;
      } else if (room.mode === "normal") {
        // Case: normal mode
        visibleRole = "undercover";
        word = undercoverWord;
      } else if (room.mode === "hard") {
        // 🔥 HARD MODE DECEPTION
        visibleRole = "civilian";
        word = undercoverWord;
      }
    }

    io.to(p.id).emit("role", { role: visibleRole, word });

    return {
      ...p,
      role: trueRole, // store truth
      alive: true,
      score: p.score ?? 0,
    };
  });

  room.phase = "playing";
  room.votesByPlayer = {};
  room.voteCount = {};
  room.message =
    room.mode === "hard"
      ? "🔥 Hard Mode! Trust no one."
      : "🎮 Game started! Discuss carefully.";

  io.to(socket.roomCode).emit("state", room);
});


  // START VOTING - host triggers this
  socket.on("start-voting", (roomCode) => {
    const room = rooms[roomCode]; 
    if (!room) return;
    const aliveCount = room.players.filter(p => p.alive && p.connected !== false).length;
    if (aliveCount <= 2) {
      checkEndGame(room);
      io.to(roomCode).emit("state", room);
      return;
    }
    room.phase = "voting";
    room.votesByPlayer = {};
    room.voteCount = {};
    room.message = "🗳️ Voting has started!";

    io.to(roomCode).emit("state", room);
  });

  // VOTE - server enforces one vote per socket, no self-vote
  socket.on("vote", ({ room, votedName }) => {
    const roomCode = socket.roomCode;
    const game = rooms[roomCode];
    if (!game || game.phase !== "voting") return;
    if (!game.players.find(p => p.id === socket.id && p.connected !== false)) {
      return;
    }

    const voter = game.players.find(p => p.id === socket.id);
    if (!voter || !voter.alive) return;
    if (voter.name === votedName) return; // no self vote
    if (game.votesByPlayer[socket.id]) return; // already voted

    game.votesByPlayer[socket.id] = votedName;
    game.voteCount[votedName] = (game.voteCount[votedName] || 0) + 1;

    io.to(roomCode).emit("votes", game.voteCount);

    checkVotingComplete(roomCode);
  });

  // PLAY AGAIN - host resets the whole game to lobby but keeps scores
  socket.on("play-again", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;

    // keep scores, reset alive & role
    room.players = room.players.map(p => ({
      ...p,
      alive: true,
      role: null,
      score: p.score ?? 0
    }));

    room.phase = "lobby";
    room.votesByPlayer = {};
    room.voteCount = {};
    room.message = "Play again: waiting in lobby.";

    io.to(roomCode).emit("state", room);
  });

  // LEAVE ROOM / DISCONNECT
  socket.on("leaveRoom", () => leaveRoom());
  socket.on("disconnect", () => {
    const roomCode = socket.roomCode;
    if (!roomCode || !rooms[roomCode]) return;

    const room = rooms[roomCode];
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.connected = false;
      room.message = `⚠️ ${player.name} disconnected. Waiting to reconnect...`;
      io.to(roomCode).emit("state", room);
    }
  });


  function leaveRoom() {
    const roomCode = socket.roomCode;
    if (!roomCode || !rooms[roomCode]) return;
    const room = rooms[roomCode];
    rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== socket.id);

    // if no players left, delete room
    if (rooms[roomCode].players.length === 0) {
      delete rooms[roomCode];
      return;
    }
    if (room.hostId === socket.id) {
      room.hostId = room.players[0].id; // next player becomes host
      room.message = `👑 Host left. ${room.players[0].name} is now the host.`;
    }
    io.to(roomCode).emit("state", rooms[roomCode]);
  }
});

// VOTING HELPERS
function checkVotingComplete(roomCode) {
  const game = rooms[roomCode];
  if (!game) return;
  //const aliveCount = game.players.filter(p => p.alive).length;
  const votesCast = Object.keys(game.votesByPlayer).length;
  const aliveAndConnected = game.players.filter(
      p => p.alive && p.connected !== false
    ).length;

  if (votesCast === aliveAndConnected) {
    resolveVoting(roomCode);
  }
}


function resolveVoting(roomCode) {
  const game = rooms[roomCode];
  if (!game) return;

  const entries = Object.entries(game.voteCount).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    game.phase = "playing";
    game.message = "No votes cast. Discussion continues.";
    io.to(roomCode).emit("state", game);
    return;
  }

  const [topName, topVotes] = entries[0];
  const secondVotes = entries[1]?.[1] || 0;

  if (topVotes === secondVotes) {
    game.phase = "playing";
    game.message = "🤝 No majority. No one was eliminated.";
    game.votesByPlayer = {};
    game.voteCount = {};
    io.to(roomCode).emit("state", game);
    return;
  }

  const eliminatedPlayer = game.players.find(p => p.name === topName);
  if (!eliminatedPlayer) return;

  eliminatedPlayer.alive = false;

  // 🎯 SCORING FIRST
  if (eliminatedPlayer.role === "undercover") {
    game.players
      .filter(p => p.role === "civilian" && p.alive)
      .forEach(p => p.score = (p.score ?? 0) + 3);

    game.message = `🎉 ${topName} was the UNDERCOVER! Civilians gain +3`;
  } else {
    const undercover = game.players.find(p => p.role === "undercover");
    if (undercover) undercover.score = (undercover.score ?? 0) + 2;

    game.message = `☠️ ${topName} was a CIVILIAN! Undercover gains +2`;
  }

  // 🔍 THEN check if game ends
  const alive = game.players.filter(p => p.alive);
  const undercoverAlive = alive.some(p => p.role === "undercover");

  if (!undercoverAlive) {
    game.phase = "ended";
    game.message += " | Civilians win!";
  } else if (alive.length <= 2) {
    const undercover = game.players.find(p => p.role === "undercover");
    if (undercover) undercover.score = (undercover.score ?? 0) + 5;

    game.phase = "ended";
    game.message += " | Undercover wins +5!";
  } else {
    game.phase = "playing";
    game.votesByPlayer = {};
    game.voteCount = {};
  }

  io.to(roomCode).emit("state", game);
}


/*function checkEndGame(game) {
  if (!game) return false;

  const alivePlayers = game.players.filter(p => p.alive);
  const aliveUndercover = alivePlayers.filter(p => p.role === "undercover");

  if (alivePlayers.length <= 2) {
    if (aliveUndercover.length > 0) {
      game.phase = "ended";
      game.message = "🕵️ Undercover wins!";
    } else {
      game.phase = "ended";
      game.message = "🎉 Civilians win!";
    }
    return true;
  }

  return false;
}
*/
function checkEndGame(game) {
  if (!game) return false;

  const alivePlayers = game.players.filter(p => p.alive);
  const aliveUndercover = alivePlayers.filter(p => p.role === "undercover");

  // 🎯 CASE 1: Undercover eliminated → Civilians win
  if (aliveUndercover.length === 0) {
    const civilian = game.players.find(p => p.role === "civilian");
    if (civilian) civilian.score = (civilian.score || 0) + 5;
    game.phase = "ended";
    game.message = "🎉 Civilians win!";

    // 🔥 Give 1 point to civilians
    game.players.forEach(p => {
      if (p.role === "civilian") {
        p.score = (p.score || 0) + 1;
      }
    });

    return true;
  }

  // 🎯 CASE 2: 2 players left and undercover alive → Undercover wins
  if (alivePlayers.length <= 2 && aliveUndercover.length > 0) {
    const undercover = game.players.find(p => p.role === "undercover");
    if (undercover) undercover.score = (undercover.score || 0) + 5;

    game.phase = "ended";
    game.message = "🕵️ Undercover wins!";
    
    

    return true;
  }

  return false;
}


function determineWinner(roomCode) {
  const game = rooms[roomCode];
  if (!game) return;

  const alive = game.players.filter(p => p.alive);
  const undercoverAlive = alive.some(p => p.role === "undercover");

  if (!undercoverAlive) {
    game.phase = "ended";
    game.message += " Civilians win!";
    io.to(roomCode).emit("state", game);
    return;
  }

  if (alive.length <= 2) {
    // undercover wins -> give undercover +5
    const undercover = game.players.find(p => p.role === "undercover");
    if (undercover) undercover.score = (undercover.score || 0) + 5;

    game.phase = "ended";
    game.message += " Undercover wins!";
    io.to(roomCode).emit("state", game);
    return;
  }

  // continue playing
  game.phase = "playing";
  game.votesByPlayer = {};
  game.voteCount = {};
  io.to(roomCode).emit("state", game);
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Backend running on port", PORT);
});
