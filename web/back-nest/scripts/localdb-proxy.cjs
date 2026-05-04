/**
 * LocalDB TCP → Named Pipe proxy
 *
 * SQL Server LocalDB only listens on a Windows named pipe, not TCP.
 * Prisma's SQL Server connector requires TCP. This proxy bridges the gap:
 *   TCP localhost:14333  →  named pipe  \\.\pipe\LOCALDB#...\tsql\query
 *
 * Usage:
 *   node scripts/localdb-proxy.cjs
 */

'use strict';

const net = require('net');
const { execSync } = require('child_process');

const TCP_PORT = parseInt(process.env.LOCALDB_PROXY_PORT || '14333', 10);

function getPipePath() {
  if (process.env.LOCALDB_PIPE) return process.env.LOCALDB_PIPE;
  try {
    const out = execSync('SqlLocalDB.exe info MSSQLLocalDB', { encoding: 'utf8' });
    // SqlLocalDB returns e.g.: np:\\.\pipe\LOCALDB#C3C60CFD\tsql\query
    // Strip the "np:" prefix — net.createConnection expects just the UNC pipe path
    const match = out.match(/Instance pipe name:\s+np:(\\\\[^\r\n]+)/);
    if (match) return match[1].trim();
  } catch (_) {}
  return '\\\\.\\pipe\\LOCALDB#2B28C679\\tsql\\query';
}

const PIPE_PATH = getPipePath();
console.log(`[localdb-proxy] Pipe: ${PIPE_PATH}`);
console.log(`[localdb-proxy] Listening on 127.0.0.1:${TCP_PORT}`);

const server = net.createServer((tcpSocket) => {
  tcpSocket.pause();

  const pipeSocket = net.createConnection(PIPE_PATH);

  pipeSocket.once('connect', () => {
    tcpSocket.resume();

    // Bidirectional pipe with proper half-close handling
    tcpSocket.on('data', (d) => {
      if (!pipeSocket.write(d)) tcpSocket.pause();
    });
    pipeSocket.on('drain', () => tcpSocket.resume());

    pipeSocket.on('data', (d) => {
      if (!tcpSocket.write(d)) pipeSocket.pause();
    });
    tcpSocket.on('drain', () => pipeSocket.resume());

    tcpSocket.on('end', () => pipeSocket.end());
    pipeSocket.on('end', () => tcpSocket.end());

    tcpSocket.on('error', () => pipeSocket.destroy());
    pipeSocket.on('error', (err) => {
      console.error('[localdb-proxy] Pipe error:', err.message);
      tcpSocket.destroy();
    });
  });

  pipeSocket.on('error', (err) => {
    console.error('[localdb-proxy] Failed to connect to pipe:', err.message);
    tcpSocket.destroy();
  });
});

server.on('error', (err) => {
  console.error('[localdb-proxy] Server error:', err.message);
  process.exit(1);
});

server.listen(TCP_PORT, '127.0.0.1', () => {
  console.log('[localdb-proxy] Ready.');
});
