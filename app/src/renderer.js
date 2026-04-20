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
let currentRoomId = null;
let isJoining = false;

const hostPeerConnections = new Map();

let viewerPeerConnection = null;
let currentHostId = null;
let pendingViewerCandidates = [];
const pendingHostCandidates = new Map();

/*
========================================================
CHANGE ONLY THIS BLOCK
Replace these values:
YOUR_TURN_HOST
YOUR_TURN_USERNAME
YOUR_TURN_PASSWORD
========================================================
*/
const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },

    {
      urls: "turn:YOUR_TURN_HOST:80",
      username: "YOUR_TURN_USERNAME",
      credential: "YOUR_TURN_PASSWORD"
    },
    {
      urls: "turn:YOUR_TURN_HOST:443",
      username: "YOUR_TURN_USERNAME",
      credential: "YOUR_TURN_PASSWORD"
    },
    {
      urls: "turn:YOUR_TURN_HOST:443?transport=tcp",
      username: "YOUR_TURN_USERNAME",
      credential: "YOUR_TURN_PASSWORD"
    },
    {
      urls: "turns:YOUR_TURN_HOST:443",
      username: "YOUR_TURN_USERNAME",
      credential: "YOUR_TURN_PASSWORD"
    }
  ],
  iceCandidatePoolSize: 10
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

function getServerUrl() {
  return serverUrlInput.value.trim().replace(/\/+$/, "");
}

function getRoomId() {
  return roomIdInput.value.trim();
}

async function showVideo(stream, muted = false) {
  if (!stream) return;

  if (remoteVideo.srcObject !== stream) {
    remoteVideo.srcObject = stream;
  }

  remoteVideo.muted = muted;
  remoteVideo.autoplay = true;
  remoteVideo.playsInline = true;

  videoPlaceholder.style.display = "none";

  try {
    const playPromise = remoteVideo.play();
    if (playPromise !== undefined) {
      await playPromise;
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error("Video play error:", error);
    }
  }
}

function clearVideo() {
  try {
    if (!remoteVideo.paused) {
      remoteVideo.pause();
    }
  } catch (error) {
    console.error("Video pause error:", error);
  }

  if (remoteVideo.srcObject) {
    remoteVideo.srcObject = null;
  }

  videoPlaceholder.style.display = "block";
}

function cleanupHostPeer(viewerId) {
  const pc = hostPeerConnections.get(viewerId);
  if (pc) {
    pc.onicecandidate = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.onicegatheringstatechange = null;
    pc.onicecandidateerror = null;
    pc.ontrack = null;
    pc.close();
    hostPeerConnections.delete(viewerId);
  }

  pendingHostCandidates.delete(viewerId);
}

function cleanupViewerPeer() {
  if (viewerPeerConnection) {
    viewerPeerConnection.onicecandidate = null;
    viewerPeerConnection.ontrack = null;
    viewerPeerConnection.onconnectionstatechange = null;
    viewerPeerConnection.oniceconnectionstatechange = null;
    viewerPeerConnection.onicegatheringstatechange = null;
    viewerPeerConnection.onicecandidateerror = null;
    viewerPeerConnection.close();
    viewerPeerConnection = null;
  }

  currentHostId = null;
  pendingViewerCandidates = [];
}

async function flushViewerCandidates() {
  if (!viewerPeerConnection || !viewerPeerConnection.remoteDescription) return;

  while (pendingViewerCandidates.length) {
    const candidate = pendingViewerCandidates.shift();
    if (!candidate) continue;

    try {
      await viewerPeerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error("Viewer pending ICE error:", error);
    }
  }
}

async function flushHostCandidates(viewerId) {
  const pc = hostPeerConnections.get(viewerId);
  const queue = pendingHostCandidates.get(viewerId);

  if (!pc || !pc.remoteDescription || !queue?.length) return;

  while (queue.length) {
    const candidate = queue.shift();
    if (!candidate) continue;

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error("Host pending ICE error:", error);
    }
  }
}

async function logSelectedCandidatePair(pc, label = "PC") {
  try {
    const stats = await pc.getStats();
    stats.forEach((report) => {
      if (
        report.type === "candidate-pair" &&
        report.state === "succeeded" &&
        report.nominated
      ) {
        console.log(`${label} selected candidate pair:`, report);
      }
    });
  } catch (error) {
    console.error(`${label} stats error:`, error);
  }
}

async function createAndSendOffer(viewerId) {
  if (!localStream || !socket) return;
  if (hostPeerConnections.has(viewerId)) return;

  const videoTracks = localStream.getVideoTracks();
  if (!videoTracks.length) {
    setStatus("No video track found in shared screen.");
    return;
  }

  const pc = createHostPeerConnection(viewerId);
  hostPeerConnections.set(viewerId, pc);

  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  try {
    const offer = await pc.createOffer({
      offerToReceiveVideo: true,
      offerToReceiveAudio: false
    });

    await pc.setLocalDescription(offer);

    socket.emit("offer", {
      target: viewerId,
      sdp: pc.localDescription
    });

    setStatus(`Viewer connected: ${viewerId}\nOffer sent.`);
  } catch (error) {
    console.error("Offer creation error:", error);
    cleanupHostPeer(viewerId);
    setStatus(`Failed to create offer: ${error.message}`);
  }
}

setRole("host");

hostBtn.addEventListener("click", () => setRole("host"));
viewerBtn.addEventListener("click", () => setRole("viewer"));

connectBtn.addEventListener("click", connectToRoom);
shareBtn.addEventListener("click", startSharing);
leaveBtn.addEventListener("click", leaveRoom);

function ensureSocket() {
  if (socket) return socket;

  const serverUrl = getServerUrl();

  socket = window.io(serverUrl, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
  });

  socket.on("connect", () => {
    setStatus(`Connected to signaling server.\nSocket: ${socket.id}`);

    if (currentRoomId && !isJoining) {
      socket.emit("join-room", {
        roomId: currentRoomId,
        role
      });
      isJoining = true;
    }
  });

  socket.on("connect_error", (error) => {
    console.error("Socket connection error:", error);
    setStatus(`Connection error: ${error.message}`);
  });

  socket.on("disconnect", (reason) => {
    setStatus(`Disconnected: ${reason}`);
  });

  socket.on("room-info", ({ roomId, hostPresent, viewerCount }) => {
    currentRoomId = roomId;
    isJoining = false;

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

    await createAndSendOffer(viewerId);
  });

  socket.on("viewer-list", async ({ viewerIds }) => {
    if (role !== "host") return;
    if (!localStream) return;

    for (const viewerId of viewerIds) {
      await createAndSendOffer(viewerId);
    }
  });

  socket.on("offer", async ({ from, sdp }) => {
    if (role !== "viewer") return;

    cleanupViewerPeer();

    currentHostId = from;
    viewerPeerConnection = createViewerPeerConnection(from);

    try {
      await viewerPeerConnection.setRemoteDescription(
        new RTCSessionDescription(sdp)
      );

      await flushViewerCandidates();

      const answer = await viewerPeerConnection.createAnswer();
      await viewerPeerConnection.setLocalDescription(answer);

      socket.emit("answer", {
        target: from,
        sdp: viewerPeerConnection.localDescription
      });

      setStatus("Received offer from host.\nAnswer sent.");
    } catch (error) {
      console.error("Answer creation error:", error);
      setStatus(`Failed to answer: ${error.message}`);
    }
  });

  socket.on("answer", async ({ from, sdp }) => {
    if (role !== "host") return;

    const pc = hostPeerConnections.get(from);
    if (!pc) return;

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await flushHostCandidates(from);
      setStatus(`Viewer ${from} answered.`);
    } catch (error) {
      console.error("Set remote description error:", error);
      setStatus(`Failed to set answer: ${error.message}`);
    }
  });

  socket.on("ice-candidate", async ({ from, candidate }) => {
    try {
      if (!candidate) return;

      if (role === "host") {
        const pc = hostPeerConnections.get(from);
        if (!pc) return;

        if (!pc.remoteDescription) {
          if (!pendingHostCandidates.has(from)) {
            pendingHostCandidates.set(from, []);
          }
          pendingHostCandidates.get(from).push(candidate);
          return;
        }

        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } else if (role === "viewer" && viewerPeerConnection) {
        if (!viewerPeerConnection.remoteDescription) {
          pendingViewerCandidates.push(candidate);
          return;
        }

        await viewerPeerConnection.addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      }
    } catch (error) {
      console.error("ICE candidate error:", error);
    }
  });

  socket.on("host-left", () => {
    setStatus("Host left the room.");
    cleanupViewerPeer();
    clearVideo();
  });

  socket.on("viewer-left", ({ viewerId }) => {
    cleanupHostPeer(viewerId);
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

  currentRoomId = roomId;

  const s = ensureSocket();

  if (s.connected) {
    s.emit("join-room", {
      roomId,
      role
    });
    isJoining = true;
  }

  setStatus(`Joining room "${roomId}" as ${role}...`);
}

async function startSharing() {
  if (role !== "host") {
    setStatus("Only the host can share the screen.");
    return;
  }

  try {
    if (!currentRoomId) {
      connectToRoom();
    } else {
      ensureSocket();
    }

    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      localStream = null;
    }

    for (const [viewerId] of hostPeerConnections.entries()) {
      cleanupHostPeer(viewerId);
    }

    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: 24,
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });

    const videoTracks = localStream.getVideoTracks();
    console.log("Local stream:", localStream);
    console.log("Local video tracks:", videoTracks);

    if (!videoTracks.length) {
      throw new Error("No video track found in selected screen.");
    }

    const [track] = videoTracks;

    track.onended = () => {
      setStatus("Screen sharing stopped.");

      for (const [viewerId] of hostPeerConnections.entries()) {
        cleanupHostPeer(viewerId);
      }

      localStream = null;
      clearVideo();
    };

    await showVideo(localStream, true);
    setStatus("Screen sharing started.\nWaiting for viewers...");

    if (socket?.connected && currentRoomId) {
      socket.emit("request-viewers", { roomId: currentRoomId });
    }
  } catch (error) {
    console.error("Share screen error:", error);
    setStatus(`Failed to share screen: ${error.message}`);
  }
}

function createHostPeerConnection(viewerId) {
  const pc = new RTCPeerConnection(rtcConfig);

  pc.onicecandidate = (event) => {
    if (event.candidate && socket) {
      socket.emit("ice-candidate", {
        target: viewerId,
        candidate: event.candidate
      });
    }
  };

  pc.onicecandidateerror = (event) => {
    console.error("Host ICE candidate error:", event);
  };

  pc.onicegatheringstatechange = () => {
    console.log("Host ICE gathering state:", pc.iceGatheringState);
  };

  pc.onconnectionstatechange = async () => {
    console.log("Host PC state:", pc.connectionState);

    if (pc.connectionState === "connected") {
      setStatus(`Connected to viewer ${viewerId}`);
      await logSelectedCandidatePair(pc, "Host");
    }

    if (pc.connectionState === "failed") {
      setStatus(`Connection failed with viewer ${viewerId}.`);
      console.error("Host peer connection failed.");
    }

    if (pc.connectionState === "closed") {
      cleanupHostPeer(viewerId);
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log("Host ICE state:", pc.iceConnectionState);

    if (pc.iceConnectionState === "failed") {
      setStatus(`Host ICE failed for viewer ${viewerId}.`);
      console.error("Host ICE failed.");
    }

    if (pc.iceConnectionState === "closed") {
      cleanupHostPeer(viewerId);
    }
  };

  return pc;
}

function createViewerPeerConnection(hostId) {
  const pc = new RTCPeerConnection(rtcConfig);

  pc.onicecandidate = (event) => {
    if (event.candidate && socket) {
      socket.emit("ice-candidate", {
        target: hostId,
        candidate: event.candidate
      });
    }
  };

  pc.onicecandidateerror = (event) => {
    console.error("Viewer ICE candidate error:", event);
  };

  pc.onicegatheringstatechange = () => {
    console.log("Viewer ICE gathering state:", pc.iceGatheringState);
  };

  pc.ontrack = async (event) => {
    console.log("Viewer received track event:", event);
    console.log("Streams:", event.streams);
    console.log("Track kind:", event.track?.kind);
    console.log("Track readyState:", event.track?.readyState);
    console.log("Track muted:", event.track?.muted);
    console.log("Track enabled:", event.track?.enabled);

    let stream = event.streams?.[0];

    if (!stream && event.track) {
      stream = new MediaStream([event.track]);
    }

    if (!stream) {
      setStatus("Viewer received track, but stream was empty.");
      return;
    }

    await showVideo(stream, false);
    setStatus("Receiving host screen.");
  };

  pc.onconnectionstatechange = async () => {
    console.log("Viewer PC state:", pc.connectionState);

    if (pc.connectionState === "connected") {
      setStatus("Viewer connected. Waiting for host screen...");
      await logSelectedCandidatePair(pc, "Viewer");
    }

    if (pc.connectionState === "failed") {
      setStatus("Viewer connection failed.");
      console.error("Viewer peer connection failed.");
    }

    if (pc.connectionState === "closed") {
      cleanupViewerPeer();
      clearVideo();
      setStatus("Viewer connection closed.");
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log("Viewer ICE state:", pc.iceConnectionState);

    if (
      pc.iceConnectionState === "connected" ||
      pc.iceConnectionState === "completed"
    ) {
      setStatus("Receiving host screen...");
    }

    if (pc.iceConnectionState === "failed") {
      setStatus("ICE failed.");
      console.error("Viewer ICE failed.");
    }

    if (pc.iceConnectionState === "closed") {
      cleanupViewerPeer();
      clearVideo();
      setStatus("Viewer connection lost.");
    }
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

  cleanupViewerPeer();

  for (const [viewerId] of hostPeerConnections.entries()) {
    cleanupHostPeer(viewerId);
  }

  currentRoomId = null;
  isJoining = false;
  clearVideo();
  setStatus("Left room.");
  setRoomInfo("");
}