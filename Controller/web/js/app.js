
var curTimeElem;


function init() {
  window.castReceiverManager = cast.receiver.CastReceiverManager.getInstance();
  window.castReceiverManager.start();
  curTimeElem = $("#curTime");
  updateTime();
  setInterval(updateTime, 1000);
  var weatherRef = new Firebase('https://publicdata-weather.firebaseio.com/newyork');
  weatherRef.child('currently').on('value', function(snapshot) {
    snapshot = snapshot.val();
    $("#tempNow").html(Math.round(snapshot.temperature));
    var icon = snapshot.icon;
    icon = icon.replace("-day", "");
    icon = icon.replace("-night", "");
    $("#tempIcon").attr("src", "./images/" + icon + ".png");
  });
  weatherRef.child('daily/data/0').on('value', function(snapshot) {
    snapshot = snapshot.val();
    $("#weatherForecast h1").text(snapshot.summary);
    var msg = "High of [HIGH]&deg;F with a low of [LOW]&deg;F, [RAIN]% chance of precipitation.";
    msg = msg.replace("[HIGH]", Math.floor(snapshot.temperatureMax));
    msg = msg.replace("[LOW]", Math.floor(snapshot.temperatureMin));
    msg = msg.replace("[RAIN]", Math.floor(snapshot.precipProbability * 100));
    $("#weatherForecast p").html(msg);
  });
}

function updateTime() {
  var now = moment();
  curTimeElem.text(now.format("h:mm a"));
}


init();
