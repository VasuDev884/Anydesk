# Remote Desk MVP

A basic AnyDesk-like MVP built with **Electron + WebRTC + Socket.IO**.

## What it does
- Create or join a room
- Host can share their screen
- Viewer can watch the host screen in near real time
- Built as a desktop app with Electron
- Uses a Node.js signaling server

## What it does not do yet
- Remote mouse/keyboard control
- File transfer
- Authentication
- TURN server for hard NAT cases
- Production-grade encryption/session management

## Project structure

remote-desk-mvp/
- server/  -> signaling server
- app/     -> Electron desktop client

## Run locally

### 1) Start the signaling server
```bash
cd server
npm install
npm run dev
```

Server runs at: `http://localhost:5000`

### 2) Start the Electron app
In a new terminal:

```bash
cd app
npm install
npm start
```

## How to test
- Open one Electron window and choose **Host**
- Enter a room id like `demo-room`
- Click **Start sharing**
- Open another Electron window and choose **Viewer**
- Join the same room id
- The viewer should see the host screen stream

## Notes
- On first run, your OS may ask for screen recording permissions.
- This MVP is intentionally simple to make the WebRTC flow easy to understand.

## Next features to add
1. Host approval before a viewer joins
2. Remote control event channel
3. Native mouse/keyboard bridge in Electron main process
4. File transfer over WebRTC data channels
5. Login + device pairing
6. TURN server support for better connectivity
