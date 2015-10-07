'use strict';

var log = require('./SystemLog');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

log.setDebug(true);

function ZWave() {
  var _self = this;

  var OZWave = null;
  try {
    OZWave = require('openzwave-shared');
  } catch (ex) {
    log.exception('[ZWAVE] Unable to initialize Open ZWave Library.', ex);
    _self.emit('zwave_unavailable');
  }

  var _isReady = false;
  var _zwave = null;
  var _nodes = null;

  var zwaveDebugConfig = {
    ConsoleOutput: true,
    Logging: true
  };

  function init() {
    log.init('[ZWAVE] Init start.');
    _nodes = [];
    //_zwave = new OZWave(zwaveDebugConfig);
    _zwave = new OZWave();
    _zwave.on('connected', handleConnected);
    _zwave.on('driver ready', driverReady);
    _zwave.on('driver failed', driverFailed);
    _zwave.on('node added', nodeAdded);
    _zwave.on('node available', nodeAvailable);
    _zwave.on('node event', nodeEvent);
    _zwave.on('value added', valueAdded);
    _zwave.on('value changed', valueChanged);
    _zwave.on('value refreshed', valueRefreshed);
    _zwave.on('value removed', valueRemoved);
    _zwave.on('node ready', nodeReady);
    _zwave.on('notification', handleNotification);
    _zwave.on('scan complete', scanComplete);
    _zwave.on('polling enabled', onPollingEnabled);
    _zwave.on('polling disabled', onPollingDisabled);
    _zwave.on('controller command', function(r,s) {
      console.log('controller commmand feedback: r=%d, s=%d',r,s);
    });
    log.init('[ZWAVE] Init complete.');
    _self.connect();
  }

  this.connect = function() {
    if (_isReady === false) {
      log.log('[ZWAVE] Connect.');
      _zwave.connect('/dev/ttyUSB0');
    } else {
      log.error('[ZWAVE] Already connected.');
    }
  };

  this.disconnect = function() {
    log.log('[ZWAVE] Disconnect.');
    if (_zwave) {
      _zwave.disconnect();
    }
    _isReady = false;
    _nodes = [];
  };

  function onPollingEnabled(a,b,c) {
    console.log('onPollingEnabled', a ,b, c);
  }

  function onPollingDisabled(a,b,c) {
    console.log('onPollingDisabled', a ,b, c);
  }

  function nodeAvailable(nodeId, nodeInfo) {
    updateNodeInfo(nodeId, nodeInfo);
  }

  function nodeEvent(nodeId, value) {
    log.log('[ZWAVE] nodeEvent node[' + nodeId + ']');
    log.debug(JSON.stringify(value));
    _self.emit('node_event', nodeId, value);
  }

  function handleConnected() {
    log.log('[ZWAVE] Connected');
    _self.emit('connected');
  }

  function driverReady(homeId) {
    log.log('[ZWAVE] Driver ready: ' + homeId);
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

  function nodeAdded(nodeId) {
    log.log('[ZWAVE] nodeAdded node[' + nodeId + ']');
    _nodes[nodeId] = {
      manufacturer: '', manufacturerId: '', product: '', productId: '',
      productType: '', type: '', name: '', loc: '', classes: {}, ready: false};
  }

  function valueAdded(nodeId, comClass, value) {
    log.log('[ZWAVE] valueAdded node[' + nodeId + '][' + comClass + ']');
    log.debug(JSON.stringify(value));
    if (!_nodes[nodeId]['classes'][comClass]) {
      _nodes[nodeId]['classes'][comClass] = {};
    }
    _nodes[nodeId]['classes'][comClass][value.index] = value;
  }

  function valueChanged(nodeId, comClass, value) {
    log.log('[ZWAVE] valueChanged node[' + nodeId + '][' + comClass + ']');
    log.debug(JSON.stringify(value));
    _nodes[nodeId]['classes'][comClass][value.index] = value;
  }

  function valueRefreshed(nodeId, comClass, value) {
    log.log('[ZWAVE] valueRefreshed node[' + nodeId + '][' + comClass + ']');
    log.debug(JSON.stringify(value));
    _nodes[nodeId]['classes'][comClass][value.index] = value;
  }

  function valueRemoved(nodeId, comClass, index) {
    log.log('[ZWAVE] valueRemoved node[' + nodeId + '][' + comClass + ']');
    log.debug(JSON.stringify(index));
    if (_nodes[nodeId]['classes'][comClass] && 
        _nodes[nodeId]['classes'][comClass][index]) {
      delete _nodes[nodeId]['classes'][comClass][index];
    }
  }

  function updateNodeInfo(nodeId, nodeInfo) {
    log.log('[ZWAVE] updateNodeInfo node[' + nodeId + ']');
    log.debug(JSON.stringify(nodeInfo));
    _nodes[nodeId].manufacturer = nodeInfo.manufacturer;
    _nodes[nodeId].manufacturerId = nodeInfo.manufacturerid;
    _nodes[nodeId].product = nodeInfo.product;
    _nodes[nodeId].productType = nodeInfo.producttype;
    _nodes[nodeId].productId= nodeInfo.productid;
    _nodes[nodeId].type = nodeInfo.type;
    _nodes[nodeId].name = nodeInfo.name;
    _nodes[nodeId].loc = nodeInfo.loc;  
  }

  function nodeReady(nodeId, nodeInfo) {
    log.log('[ZWAVE] nodeReady node[' + nodeId + ']');
    _nodes[nodeId].ready = true;
    updateNodeInfo(nodeId, nodeInfo);
    for (var comClass in _nodes[nodeId]['classes']) {
      switch (comClass) {
        case 0x25: // COMMAND_CLASS_SWITCH_BINARY
        case 0x26: // COMMAND_CLASS_SWITCH_MULTILEVEL
        case 0x30: // COMMAND_CLASS_SENSOR_BINARY 
        case 0x31: // COMMAND_CLASS_SENSOR_MULTILEVEL 
        case 0x60: // COMMAND_CLASS_MULTI_INSTANCE 
        case 0x84: // COMMAND_CLASS_MULTI_INSTANCE ??
          _zwave.enablePoll(nodeId, comClass);
          break;
      }
      var values = _nodes[nodeId]['classes'][comClass];
    }
  }

  function handleNotification(nodeId, notif) {
    var kind = '';
    if (notif === 0) {
      kind = 'message complete';
    } else if (notif === 1) {
      kind = 'timeout';
    } else if (notif === 2) {
      kind = 'nop';
    } else if (notif === 3) {
      kind = 'awake';
    } else if (notif === 4) {
      kind = 'asleep';
    } else if (notif === 5) {
      kind = 'dead';
    } else if (notif === 6) {
      kind = 'alive';
    }
    log.log('[ZWAVE] Notification: Node[' + nodeId + '] ' + kind);
  }

  this.setNodeBinary = function(nodeId, value) {
    if (_isReady === true && _zwave) {
      try  {
        var result = null;
        if (value === true) {
          result = _zwave.setNodeOn(nodeId);
          log.log('[ZWAVE] Set node[' + nodeId + '] ON');
        } else if (value === false) {
          result = _zwave.setNodeOff(nodeId);
          log.log('[ZWAVE] Set node[' + nodeId + '] OFF');
        } else {
          log.error('[ZWAVE] setNodeBinary - expected true/false, got: ' + value);
        }
        return result;
      } catch (ex) {
        log.exception('[ZWAVE] Unable to setNodeBinary', ex);
      }
    } else {
      log.error('[ZWAVE] Not ready. (setNodeBinary)');
    }
  };

  this.setNodeLevel = function(nodeId, value) {
    if (_isReady === true && _zwave) {
      try  {
        var result = null;
        var v = parseInt(value);
        result = _zwave.setLevel(nodeId, v);
        log.log('[ZWAVE] Set node[' + nodeId + '] to ' + v);
        return result;
      } catch (ex) {
        log.exception('[ZWAVE] Unable to setNodeLevel', ex);
      } 
    } else {
      log.error('[ZWAVE] Not ready. (setNodeLevel)');
    }
  };

  this.pollNode = function(nodeId, enabled, comClass) {
    if (_isReady === true && _zwave) {
      try {
        var result = null;
        if (enabled === true) {
          result = _zwave.enablePoll(nodeId, comClass);
          log.log('[ZWAVE] Enabled polling on node[' + nodeId + '] for ' + comClass);
        } else if (enabled === false) {
          result = _zwave.disablePoll(nodeId, comClass);
          log.log('[ZWAVE] Disabled polling on node[' + nodeId + '] for ' + comClass);
        } else {
          log.warn('[ZWAVE] pollNode: Unexpected value for enabled. ' + enabled);
        }
        return result;
      } catch (ex) {
        log.exception('[ZWAVE] Unable to setup polling.', ex);
      }
    } else {
      log.error('[ZWAVE] Not ready. (pollNode)');
    }
  };

  this.setNodeName = function(nodeId, name) {
    if (_isReady === true && _zwave) {
      try {
        var result = null;
        result = _zwave.setName(nodeId, name);
        log.log('[ZWAVE] Set node[' + nodeId + '] name to: ' + name);
        return result;
      } catch (ex) {
        var msg = '[ZWAVE] Unable to set name of node[' + nodeId + '] to: ' + name;
        log.exception(msg, ex);
      }
    } else {
      log.error('[ZWAVE] Not ready. (setNodeName)');
    }
  };

  this.setNodeLocation = function(nodeId, location) {
    if (_isReady === true && _zwave) {
      try {
        var result = null;
        result = _zwave.setLocation(nodeId, location);
        log.log('[ZWAVE] Set node[' + nodeId + '] location to: ' + location);
        return result;
      } catch (ex) {
        var msg = '[ZWAVE] Unable to set location of node[' + nodeId + '] to: ' + location;
        log.exception(msg, ex);
      }  
    } else {
      log.error('[ZWAVE] Not ready. (setNodeLocation)');
    }  
  };

  this.getConfig = function(nodeId) {
    if (_isReady === true && _zwave) {
      try {
        return _zwave.requestAllConfigParams(nodeId);
      } catch (ex) {
        log.exception('[ZWAVE] Error retreiving config', ex);
      }
    } else {
      log.error('[ZWAVE] Not ready. (getConfig)');   
    }
  };

  this.getNodes = function() {
    log.log('[ZWAVE] getNodes');
    return _nodes;
  };

  this.raw = function() {
    return _zwave;
  };

  if (OZWave) {
    init();
  }

}

util.inherits(ZWave, EventEmitter);

module.exports = ZWave;
