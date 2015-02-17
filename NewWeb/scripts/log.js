var elemDoorList = document.querySelector("#doorList");
var elemStateList = document.querySelector("#stateList");

var eventsDoor = [];
var eventsState = [];

function fbInit() {
  elemDoorList.items = eventsDoor;
  elemStateList.items = eventsState;
  fb = new Firebase("https://boiling-torch-4633.firebaseio.com/");
  fb.auth(fbKey, function(error) {
    if(error) {
      console.error("[FIREBASE] Auth failed. " + error.toString());
    } else {
      console.log("[FIREBASE] Auth success.");
    }
  });
  fb.child("logs/system_state").endAt().limit(125).on("child_added", function(snapshot) {
    eventsState.unshift(snapshot.val());
    elemStateList.items = eventsState;
  });
  fb.child("logs/door").endAt().limit(125).on("child_added", function(snapshot) {
    eventsDoor.unshift(snapshot.val());
    elemDoorList.items = eventsDoor;
  });
}


function init() {
  fbInit();
  var tabs = document.querySelector('paper-tabs');
  var pages = document.querySelector('core-pages');
  tabs.addEventListener('core-select', function() {
    if (tabs.selected === "Home") {
      window.location.replace("/");
    } else {
      pages.selected = tabs.selected;
    }
  });
}


init();