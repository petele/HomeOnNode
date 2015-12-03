'use strict';

var ZWave = require('../app/node_modules/ZWave/index');
var log = require('../app/SystemLog');

log.setDebug(true);
log.setLogfile(null);

var zwave = new ZWave();
zwave.on('ready', function(nodes) {
  console.log('Ready', nodes);

  // zwave.setNodeName(2, 'MOTION_LIVINGROOM');
  // zwave.setNodeName(3, 'DOOR_FRONT');

  // console.log(zwave.getNode());

  // console.log(zwave.getNodeConfig(2));
  // console.log(zwave.setConfigParam(2, 111, 300));

  // console.log(zwave.addDevice());

  // zwave.setNodeBinary(3, true);
  // zwave.setNodeBinary(4, false);

  // zwave.disconnect();

});
