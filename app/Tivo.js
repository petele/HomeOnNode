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
  const KEYPRESS_TIMEOUT = 350;
  let _tivo;
  let _ready = false;
  const _self = this;
  const _host = ipAddress;
  const _commandQueue = [];
  let _reconnecting = false;

  /**
   * Connect to the TiVo device.
   *
   * @return {Boolean} connection result
   */
  this.connect = function() {
    if (_ready) {
      return true;
    }
    if (_tivo) {
      log.warn(LOG_PREFIX, 'Connection attempt already in progress...');
      return false;
    }
    log.init(LOG_PREFIX, 'Connecting...');
    _reconnecting = false;

    return new Promise((resolve, reject) => {
      _tivo = net.connect({host: _host, port: 31339});
      _initListeners();
      _tivo.on('ready', () => {
        _ready = true;
        _self.emit('ready');
        resolve(true);
      });
    });
  };

  /**
   *
   */
  function _initListeners() {
    _tivo.on('connect', () => {
      _self.emit('connect');
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
   * Sends a command to the Tivo.
   *
   * @param {String} cmd The command to send.
   * @return {Promise} The promise that will be resolved on completion.
   */
  this.send = function(cmd) {
    const msg = `send('${cmd}')`;
    if (!_isReady()) {
      log.warn(LOG_PREFIX, `${msg} failed, Tivo not ready.`, cmd);
      return Promise.reject(new Error('not_ready'));
    }
    if (!COMMANDS.includes(cmd)) {
      log.warn(LOG_PREFIX, `${msg} failed, invalid command.`);
      return Promise.reject(new Error('invalid_command'));
    }
    log.debug(LOG_PREFIX, msg);
    return Promise.resolve(_send(cmd));
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
   * Make the commands visible
   */
  this.KEYS = COMMANDS;

  /**
   * Reconnect to the Tivo.
   */
  function _reconnect() {
    _ready = false;
    if (_reconnecting) {
      return;
    }
    _reconnecting = true;
    _tivo = null;
    _ready = false;
    log.debug(LOG_PREFIX, `Reconnecting in 3 second...`);
    setTimeout(() => {
      _self.connect();
      // _connectToTivo();
    }, 3000);
  }

  /**
   * Handle incoming data.
   *
   * @param {String} data
   */
  function _handleData(data) {
    const str = data.toString();
    _self.emit('data', str);
    log.verbose(LOG_PREFIX, 'handleData', str);
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
   * @return {String}
   */
  function _send(cmd) {
    _commandQueue.push(cmd);
    if (_commandQueue.length === 1) {
      _sendNextCommand();
      return 'sent';
    }
    log.verbose(LOG_PREFIX, `Command (${cmd}) queued...`);
    return 'queued';
  }

  /**
   * Sends the next command in the queue.
   */
  function _sendNextCommand() {
    if (_commandQueue.length === 0) {
      return;
    }
    const cmd = _commandQueue.shift();
    log.verbose(LOG_PREFIX, `Sending command: ${cmd}`);
    _tivo.write(cmd + '\r', undefined, () => {
      // log.verbose(LOG_PREFIX, `Send complete`);
      setTimeout(() => {
        _sendNextCommand();
      }, KEYPRESS_TIMEOUT);
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
}

util.inherits(Tivo, EventEmitter);

module.exports = Tivo;
