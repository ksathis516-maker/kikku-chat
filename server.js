
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let waitingUsers = [];
let partners = {};

function removeFromQueue(id) {
  waitingUsers = waitingUsers.filter(user => user !== id);
}

function findPartner(socket) {
  removeFromQueue(socket.id);

  while (waitingUsers.length > 0) {
    const otherId = waitingUsers.shift();
    const other = io.sockets.sockets.get(otherId);

    if (other && other.connected && !partners[otherId]) {
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

  // VIDEO CALL SIGNALING

  socket.on("video-offer", data => {
    const partnerId = partners[socket.id];

    if (partnerId && data) {
      io.to(partnerId).emit("video-offer", data);
    }
  });

  socket.on("video-answer", data => {
    const partnerId = partners[socket.id];

    if (partnerId && data) {
      io.to(partnerId).emit("video-answer", data);
    }
  });

  socket.on("ice-candidate", data => {
    const partnerId = partners[socket.id];

    if (partnerId && data) {
      io.to(partnerId).emit("ice-candidate", data);
    }
  });

  socket.on("disconnect", () => {
    disconnectPartner(socket);
    console.log("User disconnected:", socket.id);
  });

});
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
    console.log("KIKKU CHAT Server running!");
    console.log("Port:", PORT);
});
  
