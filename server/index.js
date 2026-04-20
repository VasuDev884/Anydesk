import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const PORT = process.env.PORT || 5000;

const app = express();
app.use(cors({
  origin:"https://anydesk-p6gu.onrender.com/"
}));
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

/**
 * Room state shape:
 * {
 *   hostSocketId: string | null,
 *   viewers: Set<string>
 * }
 */
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

function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  if (!room.hostSocketId && room.viewers.size === 0) {
    rooms.delete(roomId);
  }
}

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on("join-room", ({ roomId, role }) => {
    if (!roomId || !role) return;

    const room = getOrCreateRoom(roomId);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = role;

    if (role === "host") {
      room.hostSocketId = socket.id;
      io.to(roomId).emit("room-info", {
        roomId,
        hostPresent: true,
        viewerCount: room.viewers.size
      });
      console.log(`Host joined room ${roomId}: ${socket.id}`);
      return;
    }

    room.viewers.add(socket.id);
    io.to(roomId).emit("room-info", {
      roomId,
      hostPresent: !!room.hostSocketId,
      viewerCount: room.viewers.size
    });

    if (room.hostSocketId) {
      io.to(room.hostSocketId).emit("viewer-joined", {
        viewerId: socket.id,
        roomId
      });
    }

    console.log(`Viewer joined room ${roomId}: ${socket.id}`);
  });

  socket.on("offer", ({ target, sdp }) => {
    if (!target || !sdp) return;
    io.to(target).emit("offer", {
      from: socket.id,
      sdp
    });
  });

  socket.on("answer", ({ target, sdp }) => {
    if (!target || !sdp) return;
    io.to(target).emit("answer", {
      from: socket.id,
      sdp
    });
  });

  socket.on("ice-candidate", ({ target, candidate }) => {
    if (!target || !candidate) return;
    io.to(target).emit("ice-candidate", {
      from: socket.id,
      candidate
    });
  });

  socket.on("leave-room", () => {
    const { roomId, role } = socket.data || {};
    if (!roomId) return;

    const room = rooms.get(roomId);
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
    io.to(roomId).emit("room-info", {
      roomId,
      hostPresent: !!room.hostSocketId,
      viewerCount: room.viewers.size
    });

    cleanupRoom(roomId);
  });

  socket.on("disconnect", () => {
    const { roomId, role } = socket.data || {};
    const room = roomId ? rooms.get(roomId) : null;

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

      io.to(roomId).emit("room-info", {
        roomId,
        hostPresent: !!room.hostSocketId,
        viewerCount: room.viewers.size
      });

      cleanupRoom(roomId);
    }

    console.log(`Socket disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Signaling server running on http://localhost:${PORT}`);
});
