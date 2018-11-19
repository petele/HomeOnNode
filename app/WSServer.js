'use strict';

const util = require('util');
const WebSocket = require('ws');
const log = require('./SystemLog2');
const EventEmitter = require('events').EventEmitter;

/**
 * WebSocket Server
 * @constructor
 *
 * @fires WSServer#message
 * @param {String} name Name of the WebSocket Server.
 * @param {Number} port Port to listen on.
*/
function WSServer(name, port) {
  const PING_INTERVAL = 30 * 1000;
  const _self = this;
  this.running = false;
  let _logPrefix = name.toUpperCase() + '_WSS';
  let _wss;
  let _pingInterval;

  /**
   * Init the WebSocket Server
  */
  function _init() {
    if (!port) {
      port = 8881;
    }
    log.init(_logPrefix, `Starting...`, port);
    try {
      _wss = new WebSocket.Server({port: port});
    } catch (ex) {
      log.error(_logPrefix, 'Unable to start WebSocket server', ex);
      return;
    }
    _self.running = true;
    log.debug(_logPrefix, 'WebSocket server started...');
    _wss.on('connection', _wsConnection);
    _wss.on('error', _wsError);
    _pingInterval = setInterval(_pingClients, PING_INTERVAL);
  }

  /**
   * Handles incoming connection
   *
   * @param {Object} ws WebSocket connection.
   * @param {Object} request Original HTTP Request.
   */
  function _wsConnection(ws, request) {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    let fromIP = 'unknown';
    if (request && request.connection && request.connection.remoteAddress) {
      fromIP = request.connection.remoteAddress;
    }
    fromIP = 'ws://' + fromIP;
    ws.on('message', (msg) => {
      _wsMessage(msg, fromIP);
    });
    log.debug(_logPrefix, `Client connected from ${fromIP}`);
  }

  /**
   * Handles an incoming message
   *
   * @param {String} msg Incoming message, expect JSON-able string.
   * @param {String} fromIP Incoming IP address of the request.
   */
  function _wsMessage(msg, fromIP) {
    try {
      msg = JSON.parse(msg);
    } catch (ex) {
      log.error(_logPrefix, `Unable to parse message ${msg}`, ex);
      return;
    }
    log.verbose(_logPrefix, `Message received from ${fromIP}.`, msg);
    _self.emit('message', msg, fromIP);
  }

  /**
   * Handles errors
   *
   * @param {Error} err The incoming error.
   */
  function _wsError(err) {
    log.error(_logPrefix, 'Unknown error', err);
  }

  /**
   * Pings the connected clients to ensure they're still connected
   */
  function _pingClients() {
    _wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping('', false, true);
    });
  }

  /**
   * Sends a message to all attached clients.
   *
   * @param {String} msg The message to send.
   */
  this.broadcast = function(msg) {
    if (!_wss) {
      log.error(_logPrefix, 'Unable to broadcast, server is not running.');
      return;
    }
    _wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN && ws.isAlive === true) {
        try {
          ws.send(msg, (err) => {
            if (err) {
              ws.isAlive = false;
              log.error(_logPrefix, 'Error sending message to client', err);
            }
          });
        } catch (ex) {
          ws.isAlive = false;
          log.exception(_logPrefix, 'Exception sending message to client.', ex);
        }
      }
    });
  };

  /**
   * Shuts down the web socket server
   *
   * @return {Promise} Resolves when the server has closed.
   */
  this.shutdown = function() {
    if (!_wss) {
      log.error(_logPrefix, 'Unable to broadcast, server is not running.');
      return;
    }
    _self.running = false;
    if (_pingInterval) {
      clearInterval(_pingInterval);
      _pingInterval = null;
    }
    return new Promise(function(resolve, reject) {
      _wss.close(() => {
        _wss = null;
        resolve();
      });
    });
  };

  _init();
}
util.inherits(WSServer, EventEmitter);

module.exports = WSServer;
