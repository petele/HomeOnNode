'use strict';

var log = require('./SystemLog');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

function ZWave(ozwConfig) {
  var _self = this;
  var _isReady = false;
  var _zwave = null;
  var _nodes = null;
  var _debouncers = null;
  var _homeId = null;
  var OZWave = null;
  try {
    OZWave = require('openzwave-shared');
  } catch (ex) {
    log.exception('[ZWAVE] Unable to initialize Open ZWave Library.', ex);
    _self.emit('zwave_unavailable');
    return false;
  }

  var ZWaveConfig = {
    ConsoleOutput: false,
    Logging: false,
    SaveConfiguration: true,
    DriverMaxAttempts: 3
  };

  if (ozwConfig) {
    if (ozwConfig.consoleOutput === true) {
      ZWaveConfig.ConsoleOutput = true;
    }
    if (ozwConfig.logging === true) {
      ZWaveConfig.Logging = true;
    }
    if (ozwConfig.configPath) {
      ZWaveConfig.ConfigPath = ozwConfig.configPath;
    }
    if (ozwConfig.userPath) {
      ZWaveConfig.UserPath = ozwConfig.userPath;
    }
    if (ozwConfig.networkKey) {
      var keys = ozwConfig.networkKey.split(',');
      if (keys.length === 16) {
        ZWaveConfig.NetworkKey = ozwConfig.networkKey;
      } else {
        log.error('[ZWAVE] Invalid network key');
        _self.emit('error', 'invalid network key');
        return false;
      }
    }
  }

  function init() {
    log.init('[ZWAVE] Init start.');
    _zwave = new OZWave(ZWaveConfig);
    _zwave.on('connected', handleConnected);
    _zwave.on('driver ready', driverReady);
    _zwave.on('driver failed', driverFailed);
    _zwave.on('node added', nodeAdded);
    _zwave.on('node available', nodeAvailable);
    _zwave.on('node ready', nodeReady);
    _zwave.on('node event', nodeEvent);
    _zwave.on('value added', valueAdded);
    _zwave.on('value changed', valueChanged);
    _zwave.on('value refreshed', valueRefreshed);
    _zwave.on('value removed', valueRemoved);
    _zwave.on('notification', handleNotification);
    _zwave.on('scan complete', scanComplete);
    _zwave.on('polling enabled', onPollingEnabled);
    _zwave.on('polling disabled', onPollingDisabled);
    _zwave.on('controller command', handleControllerCommand);
    process.on('SIGINT', handleSigInt);
    log.init('[ZWAVE] Init complete.');
    _self.connect();
  }

  /*****************************************************************************
   *
   * Base connect/disconnect functions
   *
   ****************************************************************************/

  this.connect = function() {
    if (_isReady === false) {
      _nodes = [];
      _debouncers = [];
      log.log('[ZWAVE] Connecting...');
      _zwave.connect('/dev/ttyUSB0');
      return true;
    } else {
      log.error('[ZWAVE] Already connected.');
    }
    return false;
  };

  this.disconnect = function() {
    log.log('[ZWAVE] Disconnecting...');
    try {
      if (_zwave) {
        _zwave.disconnect();
      }
      _isReady = false;
      _nodes = [];
      _debouncers = [];
      return true;
    } catch (ex) {
      log.exception('[ZWAVE] disconnect', ex);
    }
    return false;
  };

  /*****************************************************************************
   *
   * Event handlers
   *
   ****************************************************************************/

  function handleSigInt() {
    log.log('[ZWAVE] SIGINT received.');
    _self.disconnect();
  }

  function handleControllerCommand(ctrlState, ctrlError) {
    var uLog = log.debug;
    if (ctrlError) {
      uLog = log.error;
    }
    uLog('[ZWAVE] handleControllerCommand');
    uLog('  ctrlState: ' + JSON.stringify(ctrlState));
    uLog('  ctrlError: ' + JSON.stringify(ctrlError));
  }

  function onPollingEnabled(nodeId) {
    log.debug('[ZWAVE] onPollingEnabled node[' + nodeId + ']');
    _self.emit('polling_enabled', nodeId);
  }

  function onPollingDisabled(nodeId) {
    log.debug('[ZWAVE] onPollingDisabled node[' + nodeId + ']');
    _self.emit('polling_disabled', nodeId);
  }

  function nodeEvent(nodeId, value) {
    log.debug('[ZWAVE] nodeEventR node[' + nodeId + ']');
    var debouncer = _debouncers[nodeId];
    if (!debouncer) {
      debouncer = debounce(function(nodeId, value) {
        log.log('[ZWAVE] nodeEvent node[' + nodeId + ']');
        log.debug('  ' + JSON.stringify(value));
        _self.emit('node_event', nodeId, value);
      }, 100);
      _debouncers[nodeId] = debouncer;
    }
    debouncer(nodeId, value);
  }

  function handleConnected() {
    log.log('[ZWAVE] Connected');
    _self.emit('connected');
  }

  function driverReady(homeId) {
    log.log('[ZWAVE] Driver ready: 0x' + homeId.toString(16));
    _homeId = homeId;
    _self.emit('driver_ready');
  }

  function driverFailed() {
    log.error('[ZWAVE] Driver failed.');
    _self.emit('driver_failed');
    _self.disconnect();
  }

  function scanComplete() {
    log.log('[ZWAVE] Scan complete.');
    _isReady = true;
    _self.emit('ready', _nodes);
  }

  function valueAdded(nodeId, comClass, value) {
    log.debug('[ZWAVE] valueAdded');
    setNodeValue(nodeId, comClass, value);
    emitChange('node_value_change', value);
  }

  function valueChanged(nodeId, comClass, value) {
    log.debug('[ZWAVE] valueChanged');
    setNodeValue(nodeId, comClass, value);
    emitChange('node_value_change', value);
  }

  function valueRefreshed(nodeId, comClass, value) {
    log.debug('[ZWAVE] valueRefreshed');
    setNodeValue(nodeId, comClass, value);
    emitChange('node_value_refresh', value);
  }

  function setNodeValue(nodeId, comClass, value) {
    var msg = '[ZWAVE] setNodeValue nodeId[' + nodeId + ']';
    msg += '[0x' + comClass.toString(16) + ']';
    msg += '[' + value.index + ']';
    log.debug(msg);
    log.debug('  ' + JSON.stringify(value));
    try {
      /* jshint -W069 */
      // jscs:disable requireDotNotation
      if (!_nodes[nodeId]['classes'][comClass]) {
        _nodes[nodeId]['classes'][comClass] = {};
      }
      _nodes[nodeId]['classes'][comClass][value.index] = value;
      // jscs:enable
      /* jshint +W069 */
    } catch (ex) {
      log.exception('[ZWAVE] setNodeValue', ex);
    }
  }

  function valueRemoved(nodeId, comClass, index) {
    var msg = '[ZWAVE] valueRemoved nodeId[' + nodeId + ']';
    msg += '[0x' + comClass.toString(16) + '][' + index + ']';
    log.debug(msg);
    try {
      /* jshint ignore:start */
      // jscs:disable requireDotNotation
      if (_nodes[nodeId]['classes'][comClass] &&
          _nodes[nodeId]['classes'][comClass][index]) {
        delete _nodes[nodeId]['classes'][comClass][index];
        _self.emit('node_value_removed', nodeId, comClass, index);
      }
      // jscs:enable
      /* jshint ignore:end */
    } catch (ex) {
      log.exception('[ZWAVE] valueRemoved', ex);
    }
  }

  function nodeAdded(nodeId) {
    log.debug('[ZWAVE] nodeAdded node[' + nodeId + ']');
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
      ready: false
    };
  }

  function nodeAvailable(nodeId, nodeInfo) {
    log.debug('[ZWAVE] nodeAvailable node[' + nodeId + ']');
    updateNodeInfo(nodeId, nodeInfo);
  }

  function nodeReady(nodeId, nodeInfo) {
    log.debug('[ZWAVE] nodeReady node[' + nodeId + ']');
    updateNodeInfo(nodeId, nodeInfo);
    _nodes[nodeId].ready = true;
  }

  function handleNotification(nodeId, notif) {
    var kind = '';
    if (notif === 0) {
      kind = 'message complete';
    } else if (notif === 1) {
      kind = 'timeout';
    } else if (notif === 2) {
      kind = 'no operation';
    } else if (notif === 3) {
      kind = 'awake';
    } else if (notif === 4) {
      kind = 'asleep';
    } else if (notif === 5) {
      kind = 'dead';
    } else if (notif === 6) {
      kind = 'alive';
    }
    log.debug('[ZWAVE] Notification: Node[' + nodeId + '] ' + kind);
  }


  /*****************************************************************************
   *
   * Internal help functions
   *
   ****************************************************************************/

  function emitChange(eventName, info) {
    var emit = false;
    /* jshint -W106 */
    // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
    if (info.class_id === 49) {
      // sensor data
      emit = true;
    } else if (info.class_id === 128) {
      // battery level
      emit = true;
    } else if (info.class_id === 113 && info.instance === 1 && info.index === 1) {
      // tamper alarm
      emit = true;
    }

    if (emit === true) {
      log.log('[ZWAVE] emitChange: ' + JSON.stringify(info));
      _self.emit(eventName, info.node_id, info);
    }
    // jscs:enable
    /* jshint +W106 */
  }

  function sendControllerCommand(cmdName, highPower, nodeId1, nodeId2) {
    log.log('[ZWAVE] sendControllerCommand ' + cmdName);
    log.debug('[ZWAVE]  highPower: ' + highPower);
    log.debug('[ZWAVE]  Nodes: ' + nodeId1 + ', ' + nodeId2);
    if (_isReady === true && _zwave) {
      try {
        return _zwave.beginControllerCommand(
          cmdName, highPower, nodeId1, nodeId2);
      } catch (ex) {
        log.exception('[ZWAVE] sendControllerCommand', ex);
        return false;
      }
    }
    return false;
  }

  function updateNodeInfo(nodeId, nodeInfo) {
    log.log('[ZWAVE] updateNodeInfo node[' + nodeId + ']');
    log.debug('  ' + JSON.stringify(nodeInfo));
    _nodes[nodeId].manufacturer = nodeInfo.manufacturer;
    _nodes[nodeId].manufacturerId = nodeInfo.manufacturerid;
    _nodes[nodeId].product = nodeInfo.product;
    _nodes[nodeId].productType = nodeInfo.producttype;
    _nodes[nodeId].productId = nodeInfo.productid;
    _nodes[nodeId].type = nodeInfo.type;
    _nodes[nodeId].name = nodeInfo.name;
    _nodes[nodeId].loc = nodeInfo.loc;
    for (var comClass in _nodes[nodeId].classes) {
      switch (comClass) {
        case 0x25: // COMMAND_CLASS_SWITCH_BINARY
        case 0x26: // COMMAND_CLASS_SWITCH_MULTILEVEL
        case 0x30: // COMMAND_CLASS_SENSOR_BINARY
        case 0x31: // COMMAND_CLASS_SENSOR_MULTILEVEL
        case 0x60: // COMMAND_CLASS_MULTI_INSTANCE
        case 0x84: // COMMAND_CLASS_MULTI_INSTANCE
          _self.setNodePoll(nodeId, true, comClass);
          break;
      }
    }
  }

  var debounce = function(func, wait) {
    var immediate = true;
    var timeout;
    var args;
    var context;
    var timestamp;
    var result;

    var later = function() {
      var last = Date.now() - timestamp;

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

    return function() {
      context = this;
      args = arguments;
      timestamp = Date.now();
      var callNow = immediate && !timeout;
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

  function checkIfReady(throwError) {
    if (_isReady === true && _zwave) {
      return true;
    } else {
      log.error('[ZWAVE] Not ready.');
      if (throwError) {
        _self.emit('error', 'zwave not ready');
      }
      return false;
    }
  }


  /*****************************************************************************
   *
   * Public API
   *
   ****************************************************************************/

  this.setNodeBinary = function(nodeId, value) {
    log.log('[ZWAVE] setNodeBinary node[' + nodeId + '] = ' + value);
    if (checkIfReady(true)) {
      try {
        if (value === true) {
          _zwave.setNodeOn(nodeId);
          return true;
        } else if (value === false) {
          _zwave.setNodeOff(nodeId);
          return true;
        } else {
          log.error('[ZWAVE] setNodeBinary - unexpected value');
        }
      } catch (ex) {
        log.exception('[ZWAVE] setNodeBinary', ex);
      }
    }
    return false;
  };

  this.setNodeLevel = function(nodeId, value) {
    log.log('[ZWAVE] setNodeLevel node[' + nodeId + '] = ' + value);
    if (checkIfReady(true)) {
      try {
        var v = parseInt(value);
        _zwave.setLevel(nodeId, v);
        return true;
      } catch (ex) {
        log.exception('[ZWAVE] setNodeLevel', ex);
      }
    }
    return false;
  };

  this.setNodePoll = function(nodeId, enabled, comClass) {
    var msg = '[ZWAVE] setNodePoll[' + enabled + '] for node[' + nodeId + ']';
    msg += '[0x' + comClass.toString(16) + ']';
    log.log(msg);
    if (checkIfReady(true)) {
      try {
        if (enabled === true) {
          _zwave.enablePoll(nodeId, comClass);
          return true;
        } else if (enabled === false) {
          _zwave.disablePoll(nodeId, comClass);
          return true;
        } else {
          log.error('[ZWAVE] setNodePoll - unexpected value');
        }
      } catch (ex) {
        log.exception('[ZWAVE] setNodePoll', ex);
      }
    }
    return false;
  };

  this.setNodeName = function(nodeId, name) {
    log.log('[ZWAVE] Set node[' + nodeId + '] name to: ' + name);
    if (checkIfReady(true)) {
      try {
        _zwave.setName(nodeId, name);
        return true;
      } catch (ex) {
        log.exception('[ZWAVE] setNodeName', ex);
      }
    }
    return false;
  };

  this.setNodeLocation = function(nodeId, location) {
    log.log('[ZWAVE] setNodeLocation node[' + nodeId + '] = ' + location);
    if (checkIfReady(true)) {
      try {
        _zwave.setLocation(nodeId, location);
        return true;
      } catch (ex) {
        log.exception('[ZWAVE] setNodeLocation', ex);
      }
    }
    return false;
  };

  this.getNodeConfig = function(nodeId) {
    log.log('[ZWAVE] getNodeConfig node[' + nodeId + ']');
    if (checkIfReady(true)) {
      try {
        return _zwave.requestAllConfigParams(nodeId);
      } catch (ex) {
        log.exception('[ZWAVE] getNodeConfig', ex);
      }
    }
    return false;
  };

  this.getNode = function(nodeId) {
    log.debug('[ZWAVE] getNode [' + nodeId + ']');
    if (checkIfReady(true)) {
      if (nodeId) {
        try {
          return _nodes[nodeId];
        } catch (ex) {
          log.exception('[ZWAVE] getNode', ex);
        }
      } else {
        return _nodes;
      }
    }
    return false;
  };

  this.healNetwork = function(nodeId) {
    log.debug('[ZWAVE] healNetwork [' + nodeId + ']');
    if (checkIfReady(true)) {
      try {
        if (nodeId) {
          _zwave.healNetworkNode(nodeId);
        } else {
          _zwave.healNetwork();
        }
        return true;
      } catch (ex) {
        log.exception('[ZWAVE] healNetwork', ex);
      }
    }
    return false;
  };

  this.addDevice = function() {
    log.log('[ZWAVE] addDevice');
    if (checkIfReady(true)) {
      return sendControllerCommand('AddDevice', true);
    }
    return false;
  };

  this.removeDevice = function(nodeId) {
    log.log('[ZWAVE] removeDevice');
    if (checkIfReady(true)) {
      return sendControllerCommand('RemoveDevice', true, nodeId);
    }
    return false;
  };

  this.getConfigParam = function(nodeId, paramId) {
    log.log('[ZWAVE] getConfigParam node[' + nodeId + '][' + paramId + ']');
    if (checkIfReady(true)) {
      return _zwave.requestConfigParam(nodeId, paramId);
    }
    return false;
  };

  this.setConfigParam = function(nodeId, paramId, value) {
    var msg = '[ZWAVE] setConfigParam node[' + nodeId + '][' + paramId + '] = ';
    msg += value.toString();
    log.log(msg);
    if (checkIfReady(true)) {
      return _zwave.setConfigParam(nodeId, paramId, value);
    }
    return false;
  };

  this.isReady = function() {
    var result = checkIfReady(false);
    log.debug('[ZWAVE] isReady: ' + result);
    return result;
  };

  this.__getRawZWaveObject = function() {
    log.warn('[ZWAVE] __getRawZWaveObject: not meant for general consumption');
    return _zwave;
  };

  if (OZWave) {
    init();
    return true;
  } else {
    _self.emit('error', 'OZWave unavailable');
    return false;
  }
}

util.inherits(ZWave, EventEmitter);

module.exports = ZWave;
