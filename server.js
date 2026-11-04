
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let waitingUsers = [];
let partners = {};

const blockedUsers = new Map();

function isBlocked(a, b) {
  return blockedUsers.get(a)?.has(b) ||
         blockedUsers.get(b)?.has(a);
}


let videoWaitingUsers = [];
let videoPartners = {};

function removeFromQueue(id) {
  waitingUsers = waitingUsers.filter(user => user !== id);
}

function findPartner(socket) {
  removeFromQueue(socket.id);

  while (waitingUsers.length > 0) {
    const otherId = waitingUsers.shift();
    const other = io.sockets.sockets.get(otherId);

    if (other && other.connected && !partners[otherId] && !isBlocked(socket.id, otherId)) {
      partners[socket.id] = otherId;
      partners[otherId] = socket.id;

      socket.emit("matched");
      other.emit("matched");

      return;
    }
  }

  waitingUsers.push(socket.id);
  socket.emit("waiting");
}

function disconnectPartner(socket) {
  const partnerId = partners[socket.id];

  if (partnerId) {
    delete partners[socket.id];
    delete partners[partnerId];

    io.to(partnerId).emit("partner-left");
  }

  removeFromQueue(socket.id);
}


function removeVideoFromQueue(id) {
  videoWaitingUsers = videoWaitingUsers.filter(user => user !== id);
}

function disconnectVideoPartner(socket) {
  const partnerId = videoPartners[socket.id];

  if (partnerId) {
    delete videoPartners[socket.id];
    delete videoPartners[partnerId];
    io.to(partnerId).emit("video-partner-left");
  }

  removeVideoFromQueue(socket.id);
}

function findVideoPartner(socket) {
  removeVideoFromQueue(socket.id);

  while (videoWaitingUsers.length > 0) {
    const otherId = videoWaitingUsers.shift();
    const other = io.sockets.sockets.get(otherId);

    if (other && other.connected && !videoPartners[otherId] && !isBlocked(socket.id, otherId)) {
      videoPartners[socket.id] = otherId;
      videoPartners[otherId] = socket.id;

      socket.emit("video-matched", { initiator: false });
      other.emit("video-matched", { initiator: true });
      return;
    }
  }

  videoWaitingUsers.push(socket.id);
  socket.emit("video-waiting");
}

io.on("connection", socket => {

  console.log("User connected:", socket.id);

  socket.on("find-stranger", () => {
    disconnectPartner(socket);
    findPartner(socket);
  });

  socket.on("chat-message", message => {
    const partnerId = partners[socket.id];

    if (partnerId && typeof message === "string") {
      const cleanMessage = message.trim().slice(0, 1000);

      if (cleanMessage) {
        io.to(partnerId).emit("chat-message", cleanMessage);
      }
    }
  });

  // VIDEO CALL MATCHING AND SIGNALING

socket.on("find-video-stranger", () => {
  disconnectVideoPartner(socket);
  findVideoPartner(socket);
});

socket.on("next-video-stranger", () => {
  disconnectVideoPartner(socket);
  findVideoPartner(socket);
});

socket.on("video-offer", data => {
  const partnerId = videoPartners[socket.id];
  if (partnerId && data) {
    io.to(partnerId).emit("video-offer", data);
  }
});

socket.on("video-answer", data => {
  const partnerId = videoPartners[socket.id];
  if (partnerId && data) {
    io.to(partnerId).emit("video-answer", data);
  }
});

socket.on("ice-candidate", data => {
  const partnerId = videoPartners[socket.id];
  if (partnerId && data) {
    io.to(partnerId).emit("ice-candidate", data);
  }
});

socket.on("disconnect", () => {
    disconnectVideoPartner(socket);
    disconnectPartner(socket);
    console.log("User disconnected:", socket.id);
  });

});
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
    console.log("KIKKU CHAT Server running!");
    console.log("Port:", PORT);
});
  
