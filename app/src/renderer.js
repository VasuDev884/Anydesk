const remoteVideo = document.getElementById("remoteVideo");
const videoPlaceholder = document.getElementById("videoPlaceholder");
const statusEl = document.getElementById("status");
const roomInfoEl = document.getElementById("roomInfo");

const serverUrlInput = document.getElementById("serverUrl");
const roomIdInput = document.getElementById("roomId");

const hostBtn = document.getElementById("hostBtn");
const viewerBtn = document.getElementById("viewerBtn");
const connectBtn = document.getElementById("connectBtn");
const shareBtn = document.getElementById("shareBtn");
const leaveBtn = document.getElementById("leaveBtn");

let role = "host";
let socket = null;
let localStream = null;

// For host: peer connections by viewer id
const hostPeerConnections = new Map();

// For viewer: a single host peer connection
let viewerPeerConnection = null;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

function setStatus(message) {
  statusEl.textContent = message;
}

function setRoomInfo(info) {
  roomInfoEl.textContent = info;
}

function setRole(nextRole) {
  role = nextRole;

  hostBtn.classList.toggle("active", role === "host");
  viewerBtn.classList.toggle("active", role === "viewer");

  shareBtn.disabled = role !== "host";
  shareBtn.style.opacity = role === "host" ? "1" : "0.5";
}

setRole("host");

hostBtn.addEventListener("click", () => setRole("host"));
viewerBtn.addEventListener("click", () => setRole("viewer"));

connectBtn.addEventListener("click", connectToRoom);
shareBtn.addEventListener("click", startSharing);
leaveBtn.addEventListener("click", leaveRoom);

function getServerUrl() {
  return serverUrlInput.value.trim();
}

function getRoomId() {
  return roomIdInput.value.trim();
}

function ensureSocket() {
  if (socket?.connected) return socket;

  const serverUrl = getServerUrl();
  socket = window.io(serverUrl, {
    transports: ["websocket"]
  });

  socket.on("connect", () => {
    setStatus(`Connected to signaling server.\nSocket: ${socket.id}`);
  });

  socket.on("connect_error", (error) => {
    setStatus(`Connection error: ${error.message}`);
  });

  socket.on("room-info", ({ roomId, hostPresent, viewerCount }) => {
    setRoomInfo(
      `Room: ${roomId}\nHost present: ${hostPresent ? "Yes" : "No"}\nViewers: ${viewerCount}`
    );
  });

  socket.on("viewer-joined", async ({ viewerId }) => {
    if (role !== "host") return;
    if (!localStream) {
      setStatus("A viewer joined, but no shared screen is active yet.");
      return;
    }

    const pc = createHostPeerConnection(viewerId);
    hostPeerConnections.set(viewerId, pc);

    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit("offer", {
      target: viewerId,
      sdp: offer
    });

    setStatus(`Viewer connected: ${viewerId}\nOffer sent.`);
  });

  socket.on("offer", async ({ from, sdp }) => {
    if (role !== "viewer") return;

    viewerPeerConnection = createViewerPeerConnection(from);
    await viewerPeerConnection.setRemoteDescription(new RTCSessionDescription(sdp));

    const answer = await viewerPeerConnection.createAnswer();
    await viewerPeerConnection.setLocalDescription(answer);

    socket.emit("answer", {
      target: from,
      sdp: answer
    });

    setStatus("Received offer from host.\nAnswer sent.");
  });

  socket.on("answer", async ({ from, sdp }) => {
    if (role !== "host") return;

    const pc = hostPeerConnections.get(from);
    if (!pc) return;

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    setStatus(`Viewer ${from} answered.`);
  });

  socket.on("ice-candidate", async ({ from, candidate }) => {
    try {
      if (role === "host") {
        const pc = hostPeerConnections.get(from);
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } else if (role === "viewer" && viewerPeerConnection) {
        await viewerPeerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (error) {
      console.error("ICE candidate error:", error);
    }
  });

  socket.on("host-left", () => {
    setStatus("Host left the room.");
    remoteVideo.srcObject = null;
    videoPlaceholder.style.display = "block";

    if (viewerPeerConnection) {
      viewerPeerConnection.close();
      viewerPeerConnection = null;
    }
  });

  socket.on("viewer-left", ({ viewerId }) => {
    const pc = hostPeerConnections.get(viewerId);
    if (pc) {
      pc.close();
      hostPeerConnections.delete(viewerId);
    }
    setStatus(`Viewer left: ${viewerId}`);
  });

  return socket;
}

function connectToRoom() {
  const roomId = getRoomId();
  if (!roomId) {
    setStatus("Please enter a room ID.");
    return;
  }

  const s = ensureSocket();
  s.emit("join-room", {
    roomId,
    role
  });

  setStatus(`Joining room "${roomId}" as ${role}...`);
}

async function startSharing() {
  if (role !== "host") {
    setStatus("Only the host can share the screen.");
    return;
  }

  try {
    if (!socket?.connected) {
      connectToRoom();
    }

    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: 24
      },
      audio: false
    });

    const [track] = localStream.getVideoTracks();

    track.onended = () => {
      setStatus("Screen sharing stopped.");
      for (const [, pc] of hostPeerConnections.entries()) {
        pc.close();
      }
      hostPeerConnections.clear();
      localStream = null;
    };

    remoteVideo.srcObject = localStream;
    remoteVideo.muted = true;
    videoPlaceholder.style.display = "none";
    setStatus("Screen sharing started.\nWaiting for viewers...");

    if (socket?.connected) {
      const roomId = getRoomId();
      socket.emit("join-room", { roomId, role: "host" });
    }
  } catch (error) {
    console.error(error);
    setStatus(`Failed to share screen: ${error.message}`);
  }
}

function createHostPeerConnection(viewerId) {
  const pc = new RTCPeerConnection(rtcConfig);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", {
        target: viewerId,
        candidate: event.candidate
      });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log("Host PC state:", pc.connectionState);
  };

  return pc;
}

function createViewerPeerConnection(hostId) {
  const pc = new RTCPeerConnection(rtcConfig);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", {
        target: hostId,
        candidate: event.candidate
      });
    }
  };

  pc.ontrack = (event) => {
    const [stream] = event.streams;
    remoteVideo.srcObject = stream;
    videoPlaceholder.style.display = "none";
    setStatus("Receiving host screen.");
  };

  pc.onconnectionstatechange = () => {
    console.log("Viewer PC state:", pc.connectionState);
  };

  return pc;
}

function leaveRoom() {
  if (socket?.connected) {
    socket.emit("leave-room");
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  if (viewerPeerConnection) {
    viewerPeerConnection.close();
    viewerPeerConnection = null;
  }

  for (const [, pc] of hostPeerConnections.entries()) {
    pc.close();
  }
  hostPeerConnections.clear();

  remoteVideo.srcObject = null;
  videoPlaceholder.style.display = "block";
  setStatus("Left room.");
  setRoomInfo("");
}
