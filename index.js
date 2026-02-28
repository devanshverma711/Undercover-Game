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

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

const WORD_PAIRS = [
  ["Apple", "Pie"],
  ["Pizza", ""],
  ["Paytm", "PhonePe"],
  ["Coffee", ""],
  ["Shahrukh", "Salman"],
  ["Summer", ""],
  ["Fan", "AC"],
  ["Island", ""],
  ["Heaven", "Hell"],
  ["Desert", ""],
  ["Mountain", ""],
  ["Netflix", "Disney"],
  ["Google", "Apple"],
  ["Podcast", ""],
  ["Messi", "Chetri"],
  ["Dubai", ""],
  ["Diwali", "Holi"],
  ["Tokyo", ""],
  ["Petrol", "Diesel"],
  ["Passport", "Visa"],
  ["Rome", ""],
  ["YouTube", "TikTok"],
  ["GoldDigger", ""],
  ["Facebook", "Instagram"],
  ["Love",""],
  ["WhatsApp", "Telegram"],
  ["Amazon", "Dmart"],
  ["Beach", ""],
  ["GPay","Paytm"],
  ["Forest", ""],
  ["Pogo", "HotStar"],
  ["Visa","Passport" ],
  ["Samsung", "Android"],
  ["London", ""],
  ["Haldi", "Mehendi"],
  ["Berlin", ""],
  ["Google", "Internet"],
  ["Pizza", "Burger"],
  ["Coffee", "Tea"],
  ["Dog", "Cat"],
  ["Lion", "Tiger"],
  ["Messi", "Argentina"],
  ["Batman", "Superman"],
  ["Pyramids", ""],
  ["Virat", "Rohit"],
  ["TajMahal", ""],
  ["Train", "Engine"],
  ["Summer", "Hot"],
  ["Pepsi", "Fizz"],
  ["Volcano", ""],
  ["Superman","Batman"],
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
  ["Judge", "Lawyer"],
  ["Ronaldo",""],
  ["Group",""],
  ["Choco","Chips"],
  ["Camping",""],
  ["Concert",""],
  ["Undercover",""],
  ["Covid","Corona"],
  ["FIFA",""],
  ["Wifi", "Internet"],
  ["Password", "OTP"],
  ["Tax",""],
  ["Income",""],
  ["DM", "Text"],
  ["Deer",""],
  ["Excel",""],
  ["Crime", "Murder"],
  ["Notes",""],
  ["Rose","Valentine"],
  ["Wine","Blood"],
  ["Salary", "Bonus"],
  ["Tax", "GST"],
  ["Loan", "Debt"],
  ["Profit", "Revenue"],
  ["Hero", "Villain"],
  ["Police", ""],
  ["TCS","Wipro"],
  ["Client", "Customer"],
  ["Injection", ""],
  ["Team", "Group"],
  ["Roast", ""],
  ["Meme", ""],
  ["Jail", "Prison"],
  ["Hangover", ""],
  ["Date", "Hangout"],
  ["Crush", ""],  
  ["Selfie", "Photo"], 
  ["Beer",""],
  ["Rose","Red"],
  ["Tailor", ""],
  ["English","England"],
  ["Poison",""],
  ["Help","Need"],
  ["Emoji",""],
  ["China","USA"],
  ["Moon","Earth"]
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
        message: "",
        speakingOrder: [],
        wordDeck: shuffle([...WORD_PAIRS]),
        wordIndex: 0
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

  if (room.wordIndex >= room.wordDeck.length) {
    room.wordDeck = shuffle([...WORD_PAIRS]);
    room.wordIndex = 0;
  }

  const [civilianWord, undercoverWord] = room.wordDeck[room.wordIndex];
  room.wordIndex++;
  room.currentWord = civilianWord;

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


  // 🎤 GENERATE RANDOM SPEAKING ORDER
  const alivePlayers = room.players.filter(p => p.alive);
  const shuffled = shuffle([...alivePlayers]);

  room.speakingOrder = shuffled.map((p, index) => ({
    playerId: p.id,
    name: p.name,
    order: index + 1
  }));

  // Attach order to each player object
  room.players = room.players.map(p => {
    const found = room.speakingOrder.find(s => s.playerId === p.id);
    return {
      ...p,
      speakingNumber: found ? found.order : null
    };
  });

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
  //gusseing
  socket.on("submitGuess", ({ guess }) => {
  const roomCode = socket.roomCode;
  const game = rooms[roomCode];
  if (!game) return;

  // only guessing phase allowed
  if (game.phase !== "guessing") return;

  // only eliminated undercover can guess
  if (socket.id !== game.guessingPlayerId) return;

  const correctWord = game.currentWord;

  const isCorrect =
    guess.trim().toLowerCase() ===
    correctWord.trim().toLowerCase();

  if (isCorrect) {
    const undercover = game.players.find(p => p.id === socket.id);
    if (undercover) undercover.score += 5;

    game.message = "🕵️ Undercover guessed correctly!";
  } else {
    game.players
      .filter(p => p.role === "civilian")
      .forEach(p => p.score += 2);

    game.message = "🎉 Undercover guessed wrong!";
  }

  game.phase = "ended";
  game.isGuessingPhase = false;
  game.guessingPlayerId = null;

  io.to(roomCode).emit("state", game);
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
    room.guessingPlayerId = null;
    room.currentWord = null;
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

    game.message = `🎉 ${topName} was the UNDERCOVER! `;
  } else {
    const undercover = game.players.find(p => p.role === "undercover");
    if (undercover) undercover.score = (undercover.score ?? 0) + 2;

    game.message = `☠️ ${topName} was a CIVILIAN! `;
  }

  // 🔍 THEN check if game ends
  /*const alive = game.players.filter(p => p.alive);
  const undercoverAlive = alive.some(p => p.role === "undercover");

  if (!undercoverAlive) {
    game.phase = "ended";
    game.message += " | Civilians win!";
  } else if (alive.length <= 2) {
    const undercover = game.players.find(p => p.role === "undercover");
    if (undercover) undercover.score = (undercover.score ?? 0) + 5;

    game.phase = "ended";
    game.message += " | Undercover wins !";
  } else {
    game.phase = "playing";
    game.votesByPlayer = {};
    game.voteCount = {};
  }*/
  const alive = game.players.filter(p => p.alive);
  const undercoverAlive = alive.some(p => p.role === "undercover");

  // ⭐ IF UNDERCOVER ELIMINATED
  if (!undercoverAlive) {

    // 🔥 HARD MODE → GUESSING PHASE
    if (game.mode === "hard") {
      const eliminatedUndercover =
        game.players.find(p => p.role === "undercover" && !p.alive);

      game.phase = "guessing";
      game.isGuessingPhase = true;
      game.guessingPlayerId = eliminatedUndercover.id;
      game.message += " | 🧠 Undercover gets one final guess!";

      io.to(roomCode).emit("guessing-started", {
        playerId: eliminatedUndercover.id
      });

      io.to(roomCode).emit("state", game);
      return; // ⛔ STOP NORMAL FLOW
    }

    // ✅ NORMAL MODE
    game.phase = "ended";
    game.message += " | Civilians win!";
  }
  else if (alive.length <= 2) {
    const undercover = game.players.find(p => p.role === "undercover");
    if (undercover) undercover.score = (undercover.score ?? 0) + 5;

    game.phase = "ended";
    game.message += " | Undercover wins !";
  }
  else {
    game.phase = "playing";
    game.votesByPlayer = {};
    game.voteCount = {};
  }

  // 🔁 REGENERATE ORDER FOR NEXT ROUND
  if (game.phase === "playing") {
    const alivePlayers = game.players.filter(p => p.alive);
    const shuffled = shuffle([...alivePlayers]);

    game.speakingOrder = shuffled.map((p, index) => ({
      playerId: p.id,
      name: p.name,
      order: index + 1
    }));

    game.players = game.players.map(p => {
      const found = game.speakingOrder.find(s => s.playerId === p.id);
      return {
        ...p,
        speakingNumber: found ? found.order : null
      };
    });
  }
  io.to(roomCode).emit("state", game);
}

function checkEndGame(game) {
  if (!game) return false;

  const alivePlayers = game.players.filter(p => p.alive);
  const aliveUndercover = alivePlayers.filter(p => p.role === "undercover");

  // 🎯 CASE 1: Undercover eliminated → Civilians win
  if (aliveUndercover.length === 0) {
    //const civilian = game.players.find(p => p.role === "civilian");
    //if (civilian) civilian.score = (civilian.score || 0) + 5;
    game.phase = "ended";
    game.message = "🎉 Civilians win!";

    // 🔥 Give 1 point to civilians
    //game.players.forEach(p => {
      //if (p.role === "civilian") {
        //p.score = (p.score || 0) + 1;
      //}
    //});

    return true;
  }

  // 🎯 CASE 2: 2 players left and undercover alive → Undercover wins
  if (alivePlayers.length <= 2 && aliveUndercover.length > 0) {
    const undercover = game.players.find(p => p.role === "undercover");
    //if (undercover) undercover.score = (undercover.score || 0) + 5;

    game.phase = "ended";
    game.message = "🕵️ Undercover wins!";
    
    

    return true;
  }

  return false;
}


/*function determineWinner(roomCode) {
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
}*/

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Backend running on port", PORT);
});
