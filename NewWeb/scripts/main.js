var fb;

var elemState = document.querySelector("#curState");
var elemTempIn = document.querySelector("#tempIn");
var elemTempOutNow = document.querySelector("#tempOutNow");
var elemTempOutFore = document.querySelector("#tempOutFore");
var elemCurTime = document.querySelector('#curTime');

var elemLightPanel = document.querySelector('light-panel');
var elemStatePanel = document.querySelector('state-panel');
var elemACPanel = document.querySelector('ac-panel');
var elemMediaPanel = document.querySelector('media-panel');

var devices = [];
var modifiers = [];

function fbInit() {
  fb = new Firebase("https://boiling-torch-4633.firebaseio.com/");
  fb.auth(fbKey, function(error) {
    if(error) {
      console.error("[FIREBASE] Auth failed. " + error.toString());
    } else {
      console.log("[FIREBASE] Auth success.");
    }
  });
  fb.child("state/system_state").on("value", function(snapshot) {
    elemStatePanel.state = snapshot.val();
  });
  fb.child("state/harmony/activity_name").on("value", function(snapshot) {
    var val = snapshot.val();
    elemMediaPanel.activity = val;
  });
  fb.child("state/ac").on("value", function(snapshot) {
    var val = snapshot.val();
    var devices = [
      {"label": "Living Room", "command": "LR_AC", "id": "LR", "temp": val.LR},
      {"label": "Kitchen", "command": "KI_AC", "id": "KI", "temp": val.KI},
      {"label": "Bed Room", "command": "BR_AC", "id": "BR", "temp": val.BR}
    ];
    elemACPanel.devices = devices;
  });
  fb.child("state/temperature").on("value", function(snapshot) {
    var val = snapshot.val();
    elemTempIn.innerText = Math.round(val.inside);
    elemTempOutNow.innerText = Math.round(val.outside);
  });
  fb.child("config/commands").on("value", function(snapshot) {
    var newDevices = [];
    var val = snapshot.val();
    var k = Object.keys(val);
    for (var i = 0; i < k.length; i++) {
      var device = {
        "label": val[k[i]].label,
        "command": k[i],
        "kind": val[k[i]].kind,
        "harmony": val[k[i]].harmony
      };
      if (device.label !== undefined) {
        newDevices.push(device);
      }
    }
    devices = newDevices;
    elemStatePanel.devices = devices;
    elemMediaPanel.devices = devices;
    elemLightPanel.devices = devices;
  });
  fb.child("config/light_recipes").on("value", function(snapshot) {
    var newModifiers = [];
    var val = snapshot.val();
    var k = Object.keys(val);
    for (var i = 0; i < k.length; i++) {
      var cmd = {
        "label": k[i],
        "command": k[i]
      }
      newModifiers.push(cmd);
    }
    modifiers = newModifiers;
    elemLightPanel.modifiers = modifiers;
  });
  var weatherRef = new Firebase('https://publicdata-weather.firebaseio.com/newyork');
  weatherRef.child('daily/data/0').on('value', function(snapshot) {
    snapshot = snapshot.val();
    elemTempOutFore.innerText = Math.floor(snapshot.temperatureMax);
  });
}

function init() {
  fbInit();
  setInterval(function() {
    elemCurTime.innerText = moment().format("h:mm a");
  }, 1000);
  var tabs = document.querySelector('paper-tabs');
  var pages = document.querySelector('core-pages');
  tabs.addEventListener('core-select', function() {
    pages.selected = tabs.selected;
  });
}


init();
