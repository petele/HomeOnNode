'use strict';

const net = require('net');
const util = require('util');
const log = require('./SystemLog2');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'TIVO';

// 'SETCH', 'FORCECH',
const COMMANDS = [
  'TELEPORT TIVO', 'TELEPORT LIVETV', 'TELEPORT GUIDE', 'TELEPORT NOWPLAYING',
  'IRCODE THUMBSUP', 'IRCODE THUMBSDOWN',
  'IRCODE CHANNELUP', 'IRCODE CHANNELDOWN',
  'IRCODE TIVO', 'IRCODE EXIT', 'IRCODE INFO',
  'IRCODE UP', 'IRCODE DOWN', 'IRCODE LEFT', 'IRCODE RIGHT', 'IRCODE SELECT',
  'IRCODE CC_ON', 'IRCODE CC_OFF',
  'IRCODE PLAY', 'IRCODE FORWARD', 'IRCODE REVERSE',
  'IRCODE PAUSE', 'IRCODE SLOW', 'IRCODE REPLAY', 'IRCODE ADVANCE',
  'IRCODE RECORD',
  'IRCODE NUM0', 'IRCODE NUM1', 'IRCODE NUM2', 'IRCODE NUM3', 'IRCODE NUM4',
  'IRCODE NUM5', 'IRCODE NUM6', 'IRCODE NUM7', 'IRCODE NUM8', 'IRCODE NUM9',
  'IRCODE ACTION_A', 'IRCODE ACTION_B', 'IRCODE ACTION_C', 'IRCODE ACTION_D',
  'IRCODE NETFLIX', 'IRCODE BACK',
];


/**
 * Tivo API.
 * @constructor
 *
 * @see https://www.tivo.com/assets/images/abouttivo/resources/downloads/brochures/TiVo_TCP_Network_Remote_Control_Protocol.pdf
 * @param {String} ipAddress
 *
*/
function Tivo(ipAddress) {
  // const _self = this;
  let _tivo;
  let _ready = false;
  let _host = ipAddress;
  let _commandQueue = [];
  let _reconnecting = false;

  /**
   * Init
  */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...', {ip: _host});
    _connectToTivo();
  }

  /**
   * Sends a command to the Tivo.
   *
   * @param {String} cmd The command to send.
   * @return {Promise} The promise that will be resolved on completion.
   */
  this.send = function(cmd) {
    log.debug(LOG_PREFIX, `send('${cmd}')`);
    if (!_isReady()) {
      return Promise.reject(new Error('not_ready'));
    }
    if (!COMMANDS.includes(cmd)) {
      return Promise.reject(new Error('invalid_command'));
    }
    _send(cmd);
    return Promise.resolve();
  };

  /**
   * Closes the TiVo connection.
   */
  this.close = function() {
    log.log(LOG_PREFIX, `Shutting down TiVo connection.`);
    _ready = false;
    _reconnecting = true;
    if (_tivo) {
      _tivo.end();
      _tivo = null;
    }
  };

  /**
   * Connect to the Tivo.
   */
  function _connectToTivo() {
    log.debug(LOG_PREFIX, 'Connecting to the Tivo...');
    _reconnecting = false;
    _tivo = net.connect({host: _host, port: 31339});
    _tivo.on('connect', () => {
      _ready = true;
      log.debug(LOG_PREFIX, `Connected`);
    });
     _tivo.on('ready', () => {
      _ready = true;
      log.debug(LOG_PREFIX, `Ready`);
    });
    _tivo.on('data', (data) => {
      _handleData(data);
    });
    _tivo.on('error', (data) => {
      _handleError(data);
    });
    _tivo.on('close', (data) => {
      _handleClose(data);
    });
  }

  /**
   * Reconnect to the Tivo.
   */
  function _reconnect() {
    _ready = false;
    if (_reconnecting) {
      return;
    }
    _reconnecting = true;
    log.debug(LOG_PREFIX, `Reconnecting in 3 second...`);
    setTimeout(() => {
      _connectToTivo();
    }, 3000);
  }

  /**
   * Handle incoming data.
   *
   * @param {String} data
   */
  function _handleData(data) {
    const str = data.toString();
    log.debug(LOG_PREFIX, 'handleData', str);
  }

  /**
   * Handle connection errors.
   *
   * @param {Error} error
   */
  function _handleError(error) {
    log.exception(LOG_PREFIX, 'Connection error', error);
    _reconnect();
  }

  /**
   * Handle closed connection.
   *
   * @param {Boolean} hadError
   */
  function _handleClose(hadError) {
    log.warn(LOG_PREFIX, 'Connection closed', hadError);
    _reconnect();
  }

  /**
   * Sends a command, or queues it up for sending.
   *
   * @param {String} cmd
   */
  function _send(cmd) {
    _commandQueue.push(cmd);
    if (_commandQueue.length === 1) {
      _sendNextCommand();
      return;
    }
    log.debug(LOG_PREFIX, `Command (${cmd}) queued...`);
  }

  /**
   * Sends the next command in the queue.
   */
  function _sendNextCommand() {
    if (_commandQueue.length === 0) {
      return;
    }
    const cmd = _commandQueue.shift();
    log.debug(LOG_PREFIX, `Sending command: ${cmd}`);
    _tivo.write(cmd + '\r', undefined, () => {
      log.verbose(LOG_PREFIX, `Send complete`);
      setTimeout(() => {
        _sendNextCommand();
      }, 1000);
    });
  }

  /**
   * Checks if the Tivo connection is ready/available.
   *
   * @return {boolean} True if the ready.
   */
  function _isReady() {
    if (_ready) {
      return true;
    }
    log.error(LOG_PREFIX, 'Tivo not ready.');
    return false;
  }

  _init();
}

util.inherits(Tivo, EventEmitter);

module.exports = Tivo;
