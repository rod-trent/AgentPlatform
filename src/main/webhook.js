"use strict";

/**
 * webhook.js — Local HTTP trigger server.
 *
 * Listens on 127.0.0.1:<port> for POST /trigger/:agentId requests.
 * Only accepts loopback connections — never exposed to the network.
 *
 * Usage:
 *   webhook.start(7171, triggerFn);  // start server
 *   webhook.stop();                  // tear down
 *   webhook.getPort();               // current port
 */

const http = require("http");

let _server   = null;
let _port     = 7171;
let _trigger  = null;  // function(agentId) provided by the caller

function start(port, triggerFn) {
  if (_server) stop(); // restart if already running
  _port    = port || 7171;
  _trigger = triggerFn;

  _server = http.createServer((req, res) => {
    // Only accept loopback requests
    const remote = req.socket.remoteAddress;
    if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") {
      res.writeHead(403);
      res.end(JSON.stringify({ ok: false, error: "Forbidden" }));
      return;
    }

    // GET /  →  usage info
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        description: "AI Agent Platform webhook server",
        endpoints: [
          { method: "POST", path: "/trigger/:agentId", description: "Trigger an agent by ID" },
          { method: "GET",  path: "/health",           description: "Health check" },
        ],
      }));
      return;
    }

    // GET /health
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, status: "running" }));
      return;
    }

    // POST /trigger/:agentId
    const match = req.url.match(/^\/trigger\/([a-z0-9-]+)$/i);
    if (req.method === "POST" && match) {
      const agentId = match[1];
      if (typeof _trigger === "function") {
        _trigger(agentId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, agentId, queued: true }));
      } else {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Worker not ready" }));
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
  });

  _server.listen(_port, "127.0.0.1", () => {
    console.log(`[webhook] Listening on http://127.0.0.1:${_port}`);
  });

  _server.on("error", (err) => {
    console.error(`[webhook] Server error: ${err.message}`);
    _server = null;
  });
}

function stop() {
  if (_server) {
    _server.close();
    _server = null;
    console.log("[webhook] Server stopped");
  }
}

function isRunning() {
  return _server !== null;
}

function getPort() {
  return _port;
}

module.exports = { start, stop, isRunning, getPort };
