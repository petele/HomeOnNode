var curTimeElem;
var timeFormat = "M/DD/YY h:mm:ss a";


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
    var msg = "High of <b>[HIGH]&deg;F</b> with a low of <b>[LOW]&deg;F</b>, [RAIN]% chance of [PRECIPTYPE].";
    msg = msg.replace("[HIGH]", Math.floor(snapshot.temperatureMax));
    msg = msg.replace("[LOW]", Math.floor(snapshot.temperatureMin));
    msg = msg.replace("[RAIN]", Math.floor(snapshot.precipProbability * 100));
    msg = msg.replace("[PRECIPTYPE]", snapshot.precipType);
    $("#weatherForecast p").html(msg);
  });
}

function fbInit() {
  var fb = new Firebase("https://boiling-torch-4633.firebaseio.com/");
  fb.auth(FBKey, function(error) {
    if(error) {
      console.error("[FIREBASE] Auth failed. " + error.toString());
    } else {
      console.log("[FIREBASE] Auth success.");
    }
  });
  fb.child("state/version").on("value", function(snapshot) {
    snapshot = snapshot.val();
    $("#gitHead").text(snapshot);
  });
  fb.child("state/time").on("value", function(snapshot) {
    snapshot = snapshot.val();
    $("#startedAt").text(moment(snapshot.started).format(timeFormat));
    $("#updatedAt").text(moment(snapshot.last_updated).format(timeFormat));
  });
  fb.child("carousel").on("value", function(snapshot) {
    $(".fbCarItem").remove();
    $("#weatherForecast").addClass("active");
    snapshot.forEach(function(childSnap) {
      var item = childSnap.val();
      if (item.visible === true) {
        var image = item.image;
        var header, message;
        if (item.type === "message") {
          header = item.header;
          message = item.message;
        } else if (item.type ==="countdown") {
          var tripStart = moment(item.startDate);
          var duration = Math.floor(moment.duration(tripStart - moment()).as("hours"));
          header = duration + " hours";
          if (duration > 1000) {
            duration = Math.floor(moment.duration(tripStart - moment()).as("days"));
            header = duration + " days";
          }
          message = "Until " + item.header;
        }
        addCarouselItem(image, header, message);
      }
    });
    $("#castCarousel").carousel();
  });
}

function updateTime() {
  curTimeElem.text(moment().format("h:mm a"));
}

function addCarouselItem(img, header, message) {
  var item = $("<div class='item fbCarItem'></div>");
  var image = $("<img>");
  if (img) {
    image.attr("src", img);
  }
  var cap = $("<div class='carousel-caption'></div>");
  var h = $("<h1></h1>").html(header);
  var p = $("<p></p>").html(message);
  cap
    .append(h)
    .append(p);
  item
    .append(image)
    .append(cap);
  $("#castCarousel .carousel-inner").append(item);
}

init();
fbInit();

