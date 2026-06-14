const { WebSocketServer } = require('ws');
const db = require('./db');

// Map<companyId, Set<WebSocket>>
const companyClients = new Map();

function initWebSocketServer(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const row = token && db.prepare(`
      SELECT u.company_id, u.id AS user_id FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > datetime('now') AND u.is_active = 1
    `).get(token);

    if (!row?.company_id) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    const companyId = row.company_id;
    ws.userId = row.user_id;            // used for targeted (direct) messages
    if (!companyClients.has(companyId)) companyClients.set(companyId, new Set());
    companyClients.get(companyId).add(ws);

    const cleanup = () => companyClients.get(companyId)?.delete(ws);
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });

  return wss;
}

// Sends a JSON payload to every connected client for a given company.
function broadcast(companyId, payload) {
  const clients = companyClients.get(companyId);
  if (!clients) return;
  const data = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

// Sends a JSON payload only to the given users' sockets within a company
// (used for direct messages so private content isn't pushed to everyone).
function sendToUsers(companyId, userIds, payload) {
  const clients = companyClients.get(companyId);
  if (!clients) return;
  const ids = new Set(userIds.filter(Boolean));
  const data = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN && ids.has(ws.userId)) ws.send(data);
  }
}

module.exports = { initWebSocketServer, broadcast, sendToUsers };
