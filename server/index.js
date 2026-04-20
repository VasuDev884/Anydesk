import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const PORT = process.env.PORT || 5000;

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    name: "Remote Desk Signaling Server",
    port: PORT
  });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      hostSocketId: null,
      viewers: new Set()
    });
  }
  return rooms.get(roomId);
}

function getRoom(roomId) {
  if (!roomId) return null;
  return rooms.get(roomId) || null;
}

function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  if (!room.hostSocketId && room.viewers.size === 0) {
    rooms.delete(roomId);
    console.log(`Room deleted: ${roomId}`);
  }
}

function emitRoomInfo(roomId) {
  const room = rooms.get(roomId);

  io.to(roomId).emit("room-info", {
    roomId,
    hostPresent: !!room?.hostSocketId,
    viewerCount: room?.viewers.size || 0
  });
}

function safeRole(role) {
  return role === "host" || role === "viewer";
}

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on("join-room", (payload = {}) => {
    try {
      const { roomId, role } = payload;

      if (!roomId || !safeRole(role)) {
        socket.emit("error-message", {
          message: "Invalid roomId or role"
        });
        return;
      }

      const room = getOrCreateRoom(roomId);

      if (role === "host") {
        if (room.hostSocketId && room.hostSocketId !== socket.id) {
          socket.emit("error-message", {
            message: "A host already exists in this room"
          });
          return;
        }

        room.hostSocketId = socket.id;
      } else {
        room.viewers.add(socket.id);
      }

      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.role = role;

      emitRoomInfo(roomId);

      if (role === "host") {
        io.to(socket.id).emit("viewer-list", {
          viewerIds: [...room.viewers]
        });

        console.log(`Host joined room ${roomId}: ${socket.id}`);
        return;
      }

      if (room.hostSocketId) {
        io.to(room.hostSocketId).emit("viewer-joined", {
          viewerId: socket.id,
          roomId
        });
      }

      console.log(`Viewer joined room ${roomId}: ${socket.id}`);
    } catch (error) {
      console.error("join-room error:", error);
      socket.emit("error-message", {
        message: "Failed to join room"
      });
    }
  });

  socket.on("request-viewers", (payload = {}) => {
    try {
      const { roomId } = payload;
      const room = getRoom(roomId);

      socket.emit("viewer-list", {
        viewerIds: room ? [...room.viewers] : []
      });
    } catch (error) {
      console.error("request-viewers error:", error);
      socket.emit("viewer-list", { viewerIds: [] });
    }
  });

  socket.on("offer", (payload = {}) => {
    try {
      const { target, sdp } = payload;

      if (!target || !sdp) return;

      io.to(target).emit("offer", {
        from: socket.id,
        sdp
      });
    } catch (error) {
      console.error("offer error:", error);
    }
  });

  socket.on("answer", (payload = {}) => {
    try {
      const { target, sdp } = payload;

      if (!target || !sdp) return;

      io.to(target).emit("answer", {
        from: socket.id,
        sdp
      });
    } catch (error) {
      console.error("answer error:", error);
    }
  });

  socket.on("ice-candidate", (payload = {}) => {
    try {
      const { target, candidate } = payload;

      if (!target) return;

      io.to(target).emit("ice-candidate", {
        from: socket.id,
        candidate: candidate ?? null
      });
    } catch (error) {
      console.error("ice-candidate error:", error);
    }
  });

  socket.on("leave-room", () => {
    try {
      const { roomId, role } = socket.data || {};
      if (!roomId) return;

      const room = getRoom(roomId);
      if (!room) return;

      if (role === "host" && room.hostSocketId === socket.id) {
        room.hostSocketId = null;
        io.to(roomId).emit("host-left");
      } else if (role === "viewer") {
        room.viewers.delete(socket.id);

        if (room.hostSocketId) {
          io.to(room.hostSocketId).emit("viewer-left", {
            viewerId: socket.id
          });
        }
      }

      socket.leave(roomId);
      emitRoomInfo(roomId);
      cleanupRoom(roomId);

      socket.data.roomId = null;
      socket.data.role = null;
    } catch (error) {
      console.error("leave-room error:", error);
    }
  });

  socket.on("disconnect", () => {
    try {
      const { roomId, role } = socket.data || {};
      const room = getRoom(roomId);

      if (roomId && room) {
        if (role === "host" && room.hostSocketId === socket.id) {
          room.hostSocketId = null;
          io.to(roomId).emit("host-left");
        } else if (role === "viewer") {
          room.viewers.delete(socket.id);

          if (room.hostSocketId) {
            io.to(room.hostSocketId).emit("viewer-left", {
              viewerId: socket.id
            });
          }
        }

        emitRoomInfo(roomId);
        cleanupRoom(roomId);
      }

      console.log(`Socket disconnected: ${socket.id}`);
    } catch (error) {
      console.error("disconnect error:", error);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Signaling server running on http://localhost:${PORT}`);
});