



const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient, ObjectId } = require("mongodb");
const mongoClient = new MongoClient(process.env.MONGODB_URI);
let reportsCollection;
mongoClient.connect().then(() => {
  reportsCollection = mongoClient.db("kikku_chat").collection("reports");
  console.log("MongoDB connected successfully!");
}).catch(err => console.error("MongoDB connection error:", err));
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

 const chatMessageTimes = new Map();
socket.on("chat-message", message => {
  const partnerId = partners[socket.id];

  if (!partnerId || typeof message !== "string") return;

  const cleanMessage = message.trim().slice(0, 1000);
  if (!cleanMessage) return;

  const now = Date.now();

  let times = chatMessageTimes.get(socket.id) || [];

  times = times.filter(time => now - time < 10000);

  if (times.length >= 5) {
    socket.emit("chat-rate-limit", {
      message: "Too many messages. Please wait."
    });
    return;
  }

   times.push(now);
  chatMessageTimes.set(socket.id, times);

  io.to(partnerId).emit("chat-message", cleanMessage);
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


socket.on("report-user", async reason => {  const partnerId = partners[socket.id] || videoPartners[socket.id];

  if (!partnerId) {
    socket.emit("report-result", {
      ok: false,
      message: "No stranger connected."
    });
    return;
  }

  const allowedReasons = [
    "Inappropriate content",
    "Harassment",
    "Spam",
    "Other"
  ];

  const cleanReason = String(reason || "").slice(0, 100);

  if (!allowedReasons.includes(cleanReason)) return;

  try {
  await reportsCollection.insertOne({
    reporter: socket.id,
    reportedUser: partnerId,
    reason: cleanReason,
    createdAt: new Date()
  });

  socket.emit("report-result", {
    ok: true,
    message: "Report saved successfully."
  });
} catch (error) {
  console.error("Report save error:", error);
  socket.emit("report-result", {
    ok: false,
    message: "Report save failed."
  });
}
});

socket.on("block-user", () => {
  const textPartnerId = partners[socket.id];
  const videoPartnerId = videoPartners[socket.id];

  const partnerIds = [...new Set(
    [textPartnerId, videoPartnerId].filter(Boolean)
  )];

  if (partnerIds.length === 0) {
    socket.emit("block-result", {
      ok: false,
      message: "No user to block."
    });
    return;
  }

  if (!blockedUsers.has(socket.id)) {
    blockedUsers.set(socket.id, new Set());
  }

  partnerIds.forEach(id => blockedUsers.get(socket.id).add(id));

  if (textPartnerId) disconnectPartner(socket);
  if (videoPartnerId) disconnectVideoPartner(socket);

  socket.emit("block-result", {
    ok: true,
    message: "User blocked successfully."
  });
});

socket.on("disconnect", () => {
    chatMessageTimes.delete(socket.id);
    
    disconnectVideoPartner(socket);
    disconnectPartner(socket);
    console.log("User disconnected:", socket.id);
  });

});
// ADMIN LOGIN
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

app.post("/admin-login", express.json(), (req, res) => {
  const password = req.body.password;

  if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: "Invalid password"
    });
  }

  res.json({
    success: true,
    message: "Admin login successful"
  });
});
// DELETE ADMIN REPORT
app.delete("/admin-reports/:id", async (req, res) => {
  const password = req.headers["x-admin-password"];

  if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  try {
    const result = await reportsCollection.deleteOne({
      _id: new ObjectId(req.params.id)
    });

    res.json({
      success: result.deletedCount === 1
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: "Invalid report ID"
    });
  }
});
// ADMIN REPORTS
app.get("/admin-reports", async (req, res) => {
  const password = req.headers["x-admin-password"];

  if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  try {
    const reports = await reportsCollection
      .find()
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    res.json({
      success: true,
      reports
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to load reports"
    });
  }
});
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
    console.log("KIKKU CHAT Server running!");
    console.log("Port:", PORT);
});
  
