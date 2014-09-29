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
    var msg = "High of [HIGH]&deg;F with a low of [LOW]&deg;F, [RAIN]% chance of precipitation.";
    msg = msg.replace("[HIGH]", Math.floor(snapshot.temperatureMax));
    msg = msg.replace("[LOW]", Math.floor(snapshot.temperatureMin));
    msg = msg.replace("[RAIN]", Math.floor(snapshot.precipProbability * 100));
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
    snapshot = snapshot.val();
    for (var i = 0; i < snapshot.length; i++) {
      var item = snapshot[i];
      if (item.visible === true) {
        if (item.type === "message") {
          addCarouselItem(item.image, item.header, item.message);
        } else if (item.type ==="countdown") {
          addCarouselCountdown(item.image, item.startDate, item.tripName);
        }
      }
    }
    $("#castCarousel").carousel();
  });
}

function updateTime() {
  curTimeElem.text(moment().format("h:mm a"));
}

function addCarouselCountdown(img, date, tripName) {
  var item = $("<div class='item fbCarItem'></div>");
  var image = $("<img>");
  if (img) {
    image.attr("src", img);
  }
  var cap = $("<div class='carousel-caption'></div>");
  var tripStart = moment(date);
  var h = $("<h1></h1>");
  var p = $("<p></p>");
  cap
    .append(h)
    .append(p);
  item
    .append(image)
    .append(cap);
  $("#castCarousel .carousel-inner").append(item);

  var refreshCountdown = function() {
    var duration = Math.floor(moment.duration(tripStart - moment()).as("hours"));
    p.text("Hours until " + tripName);
    if (duration > 1000) {
      duration = Math.floor(moment.duration(tripStart - moment()).as("days"));
      p.text("Days until " + tripName);
    }
    h.text(duration);
    setTimeout(refreshCountdown, 60000);
  }
  refreshCountdown();
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

