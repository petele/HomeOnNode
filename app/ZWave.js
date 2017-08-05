'use strict';

const util = require('util');
const log = require('./SystemLog2');
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'ZWAVE';

/**
 * ZWave API
 * @constructor
 */
function ZWave() {
  const ZWAVE_CONFIG = {
    ConsoleOutput: false,
    Logging: false,
    SaveConfiguration: true,
    DriverMaxAttempts: 3,
  };
  const _self = this;
  let _ready = false;
  let _zwave = null;
  let _nodes = null;
  let _debouncers = null;
  let OZWave = null;

  /**
   * Init
   */
  function _init() {
    log.init(LOG_PREFIX, 'Starting...');
    try {
      OZWave = require('openzwave-shared');
    } catch (ex) {
      log.exception(LOG_PREFIX, 'Unable to initialize Open ZWave Library.', ex);
      _self.emit('zwave_unavailable');
      return;
    }
    _zwave = new OZWave(ZWAVE_CONFIG);
    _zwave.on('connected', _handleConnected);
    _zwave.on('driver ready', _driverReady);
    _zwave.on('driver failed', _driverFailed);
    _zwave.on('node added', _nodeAdded);
    _zwave.on('node available', _nodeAvailable);
    _zwave.on('node ready', _nodeReady);
    _zwave.on('node event', _nodeEvent);
    _zwave.on('value added', _valueAdded);
    _zwave.on('value changed', _valueChanged);
    _zwave.on('value refreshed', _valueRefreshed);
    _zwave.on('value removed', _valueRemoved);
    _zwave.on('notification', _handleNotification);
    _zwave.on('scan complete', _scanComplete);
    _zwave.on('polling enabled', _onPollingEnabled);
    _zwave.on('polling disabled', _onPollingDisabled);
    _zwave.on('controller command', _handleControllerCommand);
    process.on('SIGINT', () => {
      log.log(LOG_PREFIX, 'SIGINT received.');
      _self.disconnect();
    });
    _connect();
  }

  /**
   * Connect to the ZWave Device via USB
   */
  function _connect() {
    if (OZWave && _zwave && _ready === true) {
      log.warn(LOG_PREFIX, 'Already connected.');
      return;
    }
    _nodes = [];
    _debouncers = [];
    log.log(LOG_PREFIX, 'Connecting...');
    _zwave.connect('/dev/ttyUSB0');
    return;
  }

  /**
   * Disconnect from the ZWave device
   *
   * @return {Boolean} true if it successfully disconnected
   */
  this.shutdown = function() {
    log.log(LOG_PREFIX, 'Disconnecting...');
    try {
      if (_zwave) {
        _zwave.disconnect('/dev/ttyUSB0');
      }
      _ready = false;
      _nodes = [];
      _debouncers = [];
      return true;
    } catch (ex) {
      log.exception(LOG_PREFIX, 'disconnect', ex);
    }
    return false;
  };


  /**
   * Handle Controller Command
   *
   * @param {Object} ctrlState
   * @param {Object} ctrlError
   */
  function _handleControllerCommand(ctrlState, ctrlError) {
    const obj = {
      ctrlState: ctrlState,
      ctrlError: ctrlError,
    };
    log.debug(LOG_PREFIX, 'handleControllerCommand', obj);
  }

  /**
   * Handle Polling Enabled
   *
   * @param {Number} nodeId
   */
  function _onPollingEnabled(nodeId) {
    log.log(LOG_PREFIX, `onPollingEnabled(${nodeId})`);
  }

  /**
   * Handle Polling Disabled
   *
   * @param {Number} nodeId
   */
  function _onPollingDisabled(nodeId) {
    log.log(LOG_PREFIX, `onPollingDisabled(${nodeId})`);
  }

  /**
   * Handle Node Event
   *
   * @param {Number} nodeId
   * @param {Object} value
   */
  function _nodeEvent(nodeId, value) {
    let debouncer = _debouncers[nodeId];
    if (!debouncer) {
      debouncer = _debounce(function(nodeId, value) {
        log.debug(LOG_PREFIX, `nodeEvent(${nodeId}, ${value})`);
        _self.emit('node_event', nodeId, value);
      }, 500);
      _debouncers[nodeId] = debouncer;
    }
    debouncer(nodeId, value);
  }

  /**
   * Handle Connected
   */
  function _handleConnected() {
    log.log(LOG_PREFIX, 'Connected.');
  }

  /**
   * Handle Driver Ready
   *
   * @param {Object} homeId
   */
  function _driverReady(homeId) {
    log.debug(LOG_PREFIX, `Scanning for nodes in 0x${homeId.toString(16)}`);
  }

  /**
   * Handle Driver Failed
   */
  function _driverFailed() {
    log.error(LOG_PREFIX, 'Driver failed.');
    _self.emit('driver_failed');
    _self.disconnect();
  }

  /**
   * Scan Complete - the ZWave system is ready
   */
  function _scanComplete() {
    log.log(LOG_PREFIX, 'Ready.');
    _ready = true;
    _self.emit('ready', _nodes);
  }

  /**
   * Handle Value Added
   *
   * @param {Number} nodeId
   * @param {Object} comClass
   * @param {value} value
   */
  function _valueAdded(nodeId, comClass, value) {
    _setNodeValue(nodeId, comClass, value);
    _emitChange('node_value_change', value);
  }

  /**
   * Handle Value Changed
   *
   * @param {Number} nodeId
   * @param {Object} comClass
   * @param {value} value
   */
  function _valueChanged(nodeId, comClass, value) {
    _setNodeValue(nodeId, comClass, value);
    _emitChange('node_value_change', value);
  }

  /**
   * Handle Value Refreshed
   *
   * @param {Number} nodeId
   * @param {Object} comClass
   * @param {value} value
   */
  function _valueRefreshed(nodeId, comClass, value) {
    _setNodeValue(nodeId, comClass, value);
    _emitChange('node_value_refresh', value);
  }

  /**
   * Set Node Value Added
   *
   * @param {Number} nodeId
   * @param {Object} comClass
   * @param {value} value
   */
  function _setNodeValue(nodeId, comClass, value) {
    try {
      const msg = `setNodeValue(${nodeId}, '${value.label}', ${value.value})`;
      log.debug(LOG_PREFIX, msg);
      if (!_nodes[nodeId]['classes'][comClass]) {
        _nodes[nodeId]['classes'][comClass] = {};
      }
      _nodes[nodeId]['classes'][comClass][value.index] = value;
    } catch (ex) {
      log.exception(LOG_PREFIX, 'setNodeValue', ex);
    }
  }

  /**
   * Handle Value Removed
   *
   * @param {Number} nodeId
   * @param {Object} comClass
   * @param {Number} index
   */
  function _valueRemoved(nodeId, comClass, index) {
    try {
      const msg = `valueRemoved(${nodeId}, ${index})`;
      log.log(LOG_PREFIX, msg);
      if (_nodes[nodeId]['classes'][comClass] &&
          _nodes[nodeId]['classes'][comClass][index]) {
        delete _nodes[nodeId]['classes'][comClass][index];
        _self.emit('node_value_removed', nodeId, comClass, index);
      }
    } catch (ex) {
      log.exception(LOG_PREFIX, 'valueRemoved', ex);
    }
  }

  /**
   * Handle Node Added
   *
   * @param {Number} nodeId
   */
  function _nodeAdded(nodeId) {
    log.debug(LOG_PREFIX, `nodeAdded(${nodeId})`);
    _nodes[nodeId] = {
      manufacturer: '',
      manufacturerId: '',
      product: '',
      productId: '',
      productType: '',
      type: '',
      name: '',
      loc: '',
      classes: {},
      ready: false,
    };
  }

  /**
   * Handle Node Added
   *
   * @param {Number} nodeId
   * @param {Object} nodeInfo
   */
  function _nodeAvailable(nodeId, nodeInfo) {
    log.debug(LOG_PREFIX, `nodeAvailable(${nodeId})`, nodeInfo);
    _updateNodeInfo(nodeId, nodeInfo);
  }

  /**
   * Handle Node Ready
   *
   * @param {Number} nodeId
   * @param {Object} nodeInfo
   */
  function _nodeReady(nodeId, nodeInfo) {
    log.debug(LOG_PREFIX, `nodeReady(${nodeId})`, nodeInfo);
    _updateNodeInfo(nodeId, nodeInfo);
    _nodes[nodeId].ready = true;
  }

  /**
   * Handle Notification
   *
   * @param {Number} nodeId
   * @param {Number} notif
   */
  function _handleNotification(nodeId, notif) {
    let msg = `handleNotification(${nodeId}, `;
    if (notif === 0) {
      // kind = 'message complete';
    } else if (notif === 1) {
      log.warn(LOG_PREFIX, msg + '\'timeout\')');
    } else if (notif === 2) {
      // kind = 'no operation';
    } else if (notif === 3) {
      // kind = 'awake';
    } else if (notif === 4) {
      // kind = 'asleep';
    } else if (notif === 5) {
      log.warn(LOG_PREFIX, msg + '\'dead\')');
    } else if (notif === 6) {
      // kind = 'alive';
    }
  }

  /**
   * Emits a Change
   *
   * @fires ZWave#*
   * @param {String} eventName
   * @param {Object} info
   */
  function _emitChange(eventName, info) {
    let emit = false;
    if (info.class_id === 48) {
      // binary sensor 0x30
      emit = true;
    } else if (info.class_id === 49) {
      // sensor multilevel 0x31
      emit = true;
    } else if (info.class_id === 113) {
      // alarm 0x71
      emit = true;
    } else if (info.class_id === 128) {
      // battery level 0x80
      emit = true;
    }
    if (emit === true) {
      log.debug(LOG_PREFIX, `emitChange('${eventName}')`);
      _self.emit(eventName, info.node_id, info);
    }
  }

  /**
   * Update Node Info
   *
   * @param {Number} nodeId
   * @param {Object} nodeInfo
   */
  function _updateNodeInfo(nodeId, nodeInfo) {
    log.debug(LOG_PREFIX, `updateNodeInfo(${nodeId})`, nodeInfo);
    _nodes[nodeId].manufacturer = nodeInfo.manufacturer;
    _nodes[nodeId].manufacturerId = nodeInfo.manufacturerid;
    _nodes[nodeId].product = nodeInfo.product;
    _nodes[nodeId].productType = nodeInfo.producttype;
    _nodes[nodeId].productId = nodeInfo.productid;
    _nodes[nodeId].type = nodeInfo.type;
    _nodes[nodeId].name = nodeInfo.name;
    _nodes[nodeId].loc = nodeInfo.loc;
    // eslint-disable-next-line guard-for-in
    for (let comClass in _nodes[nodeId].classes) {
      switch (comClass) {
        case 0x25: // COMMAND_CLASS_SWITCH_BINARY
        case 0x26: // COMMAND_CLASS_SWITCH_MULTILEVEL
        case 0x30: // COMMAND_CLASS_SENSOR_BINARY
        case 0x31: // COMMAND_CLASS_SENSOR_MULTILEVEL
        case 0x60: // COMMAND_CLASS_MULTI_INSTANCE
        case 0x84: // COMMAND_CLASS_MULTI_INSTANCE
          log.log(LOG_PREFIX, `enablePoll(${nodeId}, ${comClass})`);
          _zwave.enablePoll(nodeId, comClass);
          break;
      }
    }
    _self.emit('nodes_updated', _nodes);
  }

  /**
   * Debouncer
   *
   * @param {Function} func
   * @param {Number} wait
   * @return {Function}
   */
  const _debounce = function(func, wait) {
    let immediate = true;
    let timeout;
    let args;
    let context;
    let timestamp;
    let result;

    const later = function() {
      const last = Date.now() - timestamp;

      if (last < wait && last >= 0) {
        timeout = setTimeout(later, wait - last);
      } else {
        timeout = null;
        if (!immediate) {
          result = func.apply(context, args);
          if (!timeout) {
            context = args = null;
          }
        }
      }
    };

    /**
     * Debounce Function
     *
     * @this something
     * @return {Function}
     */
    return function(...args) {
      context = this;
      timestamp = Date.now();
      const callNow = immediate && !timeout;
      if (!timeout) {
        timeout = setTimeout(later, wait);
      }
      if (callNow) {
        result = func.apply(context, args);
        context = args = null;
      }
      return result;
    };
  };


  _init();
}

util.inherits(ZWave, EventEmitter);

module.exports = ZWave;
