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
  ["Apple", "Android"],
  ["Pizza", "Burger"],
  ["Coffee", "Tea"],
  ["Dog", "Cat"],
  ["Summer", "Winter"],
  ["Island", ""],
  ["Desert", ""],
  ["Mountain", ""],
  ["Netflix", "Disney"],
  ["Google", "Apple"],
  ["Messi", "Ronaldo"],
   ["Dubai", ""],
  ["Tokyo", ""],
  ["Rome", ""],
  ["YouTube", "TikTok"],
  ["Facebook", "Instagram"],
  ["WhatsApp", "Telegram"],
  ["Amazon", "Walmart"],
  ["Beach", ""],
  ["Forest", ""],
  ["Netflix", "Disney"],
  ["iPhone", "Android"],
  ["London", ""],
  ["Berlin", ""],
  ["Google", "Apple"],
  ["Pizza", "Burger"],
  ["Coffee", "Tea"],
  ["Dog", "Cat"],
  ["Lion", "Tiger"],
  ["Messi", "Ronaldo"],
  ["Batman", "Superman"],
   ["Pyramids", ""],
  ["TajMahal", ""],
  ["Train", "Airplane"],
  ["Summer", "Winter"],
  ["Summer", "Winter"],
   ["Volcano", ""],
  ["Pizza", "Burger"],
  ["Dog", "Cat"],
  ["Coffee", "Tea"],
  ["Apple", "Android"],
  ["Paris", ""],
  
  ["Sydney", ""],
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

    // add player (no duplicates). If same name reconnects, keep score if present
    if (!rooms[room].players.some(p => p.id === socket.id)) {
      // if a player with same name exists (left earlier), we keep their score and update id
      const existingByName = rooms[room].players.find(p => p.name === name);
      if (existingByName && !rooms[room].players.some(p => p.id === socket.id)) {
        // replace the old entry's id (this handles rejoin by same player)
        existingByName.id = socket.id;
      } else {
        rooms[room].players.push({
          id: socket.id,
          name,
          alive: true,
          role: null,
          score: 0
        });
      }
    }

    io.to(room).emit("state", rooms[room]);
  });

  // START GAME (assign roles & words privately) — keep scores intact
  socket.on("startGame", () => {
    const room = rooms[socket.roomCode];
    if (!room) return;

    if (room.players.length < 3) {
      socket.emit("error", "Minimum 3 players required");
      return;
    }

    const [civilianWord, undercoverWord] =
      WORD_PAIRS[Math.floor(Math.random() * WORD_PAIRS.length)];

    const undercoverIndex = Math.floor(Math.random() * room.players.length);

    // assign roles; preserve score property
    room.players = room.players.map((p, idx) => {
      const role = idx === undercoverIndex ? "undercover" : "civilian";
      const word = role === "undercover" ? undercoverWord : civilianWord;
      io.to(p.id).emit("role", { role, word });
      return { ...p, role, alive: true, score: p.score ?? 0 };
    });

    room.phase = "playing";
    room.votesByPlayer = {};
    room.voteCount = {};
    room.message = "🎮 Game started! Discuss carefully.";

    io.to(socket.roomCode).emit("state", room);
  });

  // START VOTING - host triggers this
  socket.on("start-voting", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;

    room.phase = "voting";
    room.votesByPlayer = {};
    room.voteCount = {};
    room.message = "🗳️ Voting has started!";

    io.to(roomCode).emit("state", room);
  });

  // VOTE - server enforces one vote per socket, no self-vote
  socket.on("vote", ({ room, votedName }) => {
    const game = rooms[room];
    if (!game || game.phase !== "voting") return;

    const voter = game.players.find(p => p.id === socket.id);
    if (!voter || !voter.alive) return;
    if (voter.name === votedName) return; // no self vote
    if (game.votesByPlayer[socket.id]) return; // already voted

    game.votesByPlayer[socket.id] = votedName;
    game.voteCount[votedName] = (game.voteCount[votedName] || 0) + 1;

    io.to(room).emit("votes", game.voteCount);

    checkVotingComplete(room);
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
  socket.on("disconnect", () => leaveRoom());

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
  const aliveCount = game.players.filter(p => p.alive).length;
  const votesCast = Object.keys(game.votesByPlayer).length;

  if (votesCast === aliveCount) {
    resolveVoting(roomCode);
  }
}

function resolveVoting(roomCode) {
  const game = rooms[roomCode];
  if (!game) return;

  const entries = Object.entries(game.voteCount).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    // no votes (edge case)
    game.phase = "playing";
    game.message = "No votes cast. Discussion continues.";
    io.to(roomCode).emit("state", game);
    return;
  }

  const [topName, topVotes] = entries[0];
  const secondVotes = entries[1]?.[1] || 0;

  // tie or no majority -> replay
  if (topVotes === secondVotes) {
    game.phase = "playing";
    game.message = "🤝 No majority. No one was eliminated.";
    game.votesByPlayer = {};
    game.voteCount = {};
    io.to(roomCode).emit("state", game);
    return;
  }

  // eliminate topName
  const eliminatedPlayer = game.players.find(p => p.name === topName);
  if (eliminatedPlayer) eliminatedPlayer.alive = false;

  // scoring & messages
  if (eliminatedPlayer.role === "undercover") {
    // undercover caught -> all alive civilians +3
    game.players
      .filter(p => p.role === "civilian" && p.alive)
      .forEach(p => p.score = (p.score || 0) + 3);

    game.phase = "ended";
    game.message = `🎉 ${topName} was the UNDERCOVER! Civilians win!`;
    io.to(roomCode).emit("state", game);
    return;
  } else {
    // civilian eliminated -> undercover gets +2
    const undercover = game.players.find(p => p.role === "undercover");
    if (undercover) undercover.score = (undercover.score || 0) + 2;

    game.message = `☠️ ${topName} was a CIVILIAN and eliminated.`;
    // now check if game ends (undercover win condition) or continue
    determineWinner(roomCode);
    return;
  }
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

//server.listen(3000, () => console.log("Backend running on http://localhost:3000"));

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Backend running on port", PORT);
});
