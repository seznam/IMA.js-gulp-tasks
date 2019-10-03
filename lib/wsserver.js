'use strict';

var ws = require('ws');
const log = require('fancy-log');
module.exports = WsServer;

/** Simple websocket server. */
function WsServer(options) {
  this._server = null;
  try {
    this._server = new ws.Server({
      port: options.port || 5888,
      clientTracking: true
    });
    const server = this._server;

    this._server.on('connection', function connection(ws) {
      log('WsServer: client connected! (' + server.clients.size + ')');
      ws.on('message', function incoming(data) {
        log(
          'WsServer: sending message to ' + server.clients.size + ' clients!'
        );
        server.clients.forEach(function each(client) {
          if (client !== ws && client.readyState === ws.OPEN) {
            client.send(data);
          }
        });
      });
    });
  } catch (error) {
    log('error: ', error);
  }

  this.emit = function(...args) {
    if (this._server) {
      this._server.emit(args);
    }
  };
}
