'use strict';

var log = require('./SystemLog');
var EventEmitter = require('events').EventEmitter;

function ZWave() {
  var OZWave = null;
  try {
    OZWave = require('./lib/openzwave-shared.js');
  } catch (ex) {
    log.exception('[ZWAVE] Unable to initialize Open ZWave Library.', ex);
    _self.emit('zwave_unavailable');
  }

  var _isReady = false;
  var _self = this;
  var _zwave = null;
  var _nodes = null;

  var zwaveDebugConfig = {
    ConsoleOutput: true,
    Logging: true
  }

  function init() {
    log.init('[ZWAVE] Init start.');
    _nodes = [];
    //_zwave = new OZWave(zwaveDebugConfig);
    _zwave = new OZWave();
    _zwave.on('connected', handleConnected);
    _zwave.on('driver ready', driverReady;
    _zwave.on('driver failed', driverFailed);
    _zwave.on('node added', addNode);
    _zwave.on('value added', valueAdded);
    _zwave.on('value changed', valueChanged);
    _zwave.on('value removed', valueRemoved);
    _zwave.on('node ready', nodeReady);
    _zwave.on('notification', handleNotification);
    _zwave.on('scan complete', scanComplete);
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
  }

  this.disconnect = function() {
    log.log('[ZWAVE] Disconnect.');
    if (_zwave) {
      _zwave.disconnect();
    }
    _isReady = false;
    _nodes = [];
  }

  function handleConnected(homeId) {
    log.log('[ZWAVE] Connected: ' + homeid);
    _self.emit('connected');
  }

  function driverReady(homeId) {
    log.log('[ZWAVE] Driver ready: ' + homeid);
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

  function addNode(nodeId) {
    log.log('[ZWAVE] addNode ' + nodeId);
    _nodes[nodeId] = {
      manufacturer: '', manufacturerId: '', product: '', productId: '',
      productType: '', type: '', name: '', loc: '', classes: {}, ready: false};
  }

  function valueAdded(nodeId, comClass, value) {
    log.log('[ZWAVE] valueAdded ' + nodeId + ' ' + comClass + ' ' + value);
    if (!_nodes[nodeId]['classes'][comClass]) {
      _nodes[nodeId]['classes'][comClass] = {};
    }
    _nodes[nodeId]['classes'][comClass][value.index] = value;
  }

  function valueChanged(nodeId, comClass, value) {
    log.log('[ZWAVE] valueChanged ' + nodeId + ' ' + comClass + ' ' + value);
    _nodes[nodeId]['classes'][comClass][value.index] = value;
  }

  function valueRemoved(nodeId, comClass, index) {
    log.log('[ZWAVE] valueRemoved ' + nodeId + ' ' + comClass + ' ' + index);
    if (_nodes[nodeId]['classes'][comClass] && 
        _nodes[nodeId]['classes'][comClass][index]) {
      delete _nodes[nodeId]['classes'][comClass][index];
    }
  }

  function nodeReady(nodeId, nodeInfo) {
    log.log('[ZWAVE] nodeReady ' + nodeId + ' ' + nodeInfo);
    _nodes[nodeId]['manufacturer'] = nodeInfo.manufacturer;
    _nodes[nodeId]['manufacturerId'] = nodeInfo.manufacturerid;
    _nodes[nodeId]['product'] = nodeInfo.product;
    _nodes[nodeId]['productType'] = nodeInfo.producttype;
    _nodes[nodeId]['productId'] = nodeInfo.productid;
    _nodes[nodeId]['type'] = nodeInfo.type;
    _nodes[nodeId]['name'] = nodeInfo.name;
    _nodes[nodeId]['loc'] = nodeInfo.loc;
    _nodes[nodeId]['ready'] = true;
    for (comClass in _nodes[nodeId]['classes']) {
      switch (comClass) {
        case 0x25: // COMMAND_CLASS_SWITCH_BINARY
        case 0x26: // COMMAND_CLASS_SWITCH_MULTILEVEL
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
    log.log('[ZWAVE] Notification: Node[' + nodeId + '] ' + notif);
  }

  this.setNodeBinary = function(nodeId, value) {
    if (_isReady === true && _zwave) {
      try  {
        if (value === true) {
          _zwave.setNodeOn(nodeId);
          log.log('[ZWAVE] Set node[' + nodeId + '] ON');
        } else if (value === false) {
          _zwave.setNodeOff(nodeId);
          log.log('[ZWAVE] Set node[' + nodeId + '] OFF');
        } else {
          log.error('[ZWAVE] setNodeBinary - expected true/false, got: ' + value);
        }
      } catch (ex) {
        log.exception('[ZWAVE] Unable to setNodeBinary', ex);
      }
    } else {
      log.error('[ZWAVE] Not ready. (setNodeBinary)');
    }
  }

  this.setNodeLevel = function(nodeId, value) {
    if (_isReady === true && _zwave) {
      try  {
        var v = parseInt(value);
        _zwave.setLevel(nodeId, v);
        log.log('[ZWAVE] Set node[' + nodeId + '] to ' + v);
      } catch (ex) {
        log.exception('[ZWAVE] Unable to setNodeLevel', ex);
      } 
    } else {
      log.error('[ZWAVE] Not ready. (setNodeLevel)');
    }
  }

  this.pollNode = function(nodeId, enabled, comClass) {
    if (_isReady === true && _zwave) {
      try {
        if (enabled === true) {
          _zwave.enablePoll(nodeId, comClass);
          log.log('[ZWAVE] Enabled polling on node[' + nodeId + '] for ' + comClass);
        } else if (enabled === false) {
          _zwave.disablePoll(nodeId, comClass);
          log.log('[ZWAVE] Disabled polling on node[' + nodeId + '] for ' + comClass);
        } else {
          log.warn('[ZWAVE] pollNode: Unexpected value for enabled. ' + enabled);
        }
      } catch (ex) {
        log.exception('[ZWAVE] Unable to setup polling.', ex);
      }
    } else {
      log.error('[ZWAVE] Not ready. (pollNode)');
    }
  }

  this.setNodeName = function(nodeId, name) {
    if (_isReady === true && _zwave) {
      try {
        _zwave.setName(nodeId, name);
        log.log('[ZWAVE] Set node[' + nodeId + '] name to: ' + name);
      } catch (ex) {
        var msg = '[ZWAVE] Unable to set name of node[' + nodeId + '] to: ' + name;
        log.exception(msg, ex);
      }
    } else {
      log.error('[ZWAVE] Not ready. (setNodeName)');
    }
  }

  this.setNodeLocation = function(nodeId, location) {
    if (_isReady === true && _zwave) {
      try {
        _zwave.setLocation(nodeId, location);
        log.log('[ZWAVE] Set node[' + nodeId + '] location to: ' + location);
      } catch (ex) {
        var msg = '[ZWAVE] Unable to set location of node[' + nodeId + '] to: ' + location;
        log.exception(msg, ex);
      }  
    } else {
      log.error('[ZWAVE] Not ready. (setNodeLocation)');
    }  
  }

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
  }

  this.getNodes = function() {
    log.log('[ZWAVE] getNodes');
    return _nodes;
  }

  if (OZWave) {
    init();
  }

}

util.inherits(Nest, EventEmitter);

module.exports = ZWave;
