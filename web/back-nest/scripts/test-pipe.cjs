'use strict';
const net = require('net');

// Raw Windows named pipe path - must use literal backslashes
// \\.\pipe\LOCALDB#C3C60CFD\tsql\query
const pipe = '\\\\.\\pipe\\LOCALDB#C3C60CFD\\tsql\\query';
console.log('Pipe path:', pipe);
console.log('Length:', pipe.length);

const s = net.createConnection(pipe);
s.on('connect', () => {
  console.log('Connected to named pipe!');
  // TDS Pre-Login packet (minimal, requesting no encryption)
  const prelogin = Buffer.from([
    0x12, 0x01, 0x00, 0x20, 0x00, 0x00, 0x01, 0x00, // header
    0x00, 0x00, 0x1b, 0x00, 0x06, // VERSION token
    0x01, 0x00, 0x21, 0x00, 0x01, // ENCRYPTION token
    0x02, 0x00, 0x22, 0x00, 0x00, // INSTOPT token (empty)
    0x03, 0x00, 0x22, 0x00, 0x04, // THREADID token
    0xff,                          // terminator
    0x0e, 0x00, 0x0c, 0xa8, 0x00, 0x00, // VERSION data
    0x02,                          // ENCRYPTION: ENCRYPT_REQ
    0x00, 0x00, 0x00, 0x00        // THREADID data
  ]);
  s.write(prelogin);
  s.setTimeout(3000);
});
s.on('data', d => {
  console.log('Got response, first 16 bytes:', d.slice(0, 16).toString('hex'));
  console.log('Encryption byte (if prelogin response):', d[8]);
  s.destroy();
});
s.on('error', e => console.error('Error:', e.code, e.message));
s.on('timeout', () => { console.log('Timeout'); s.destroy(); });
s.on('close', () => process.exit(0));
