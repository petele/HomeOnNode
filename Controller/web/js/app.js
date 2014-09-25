var curTimeElem;
var timeFormat = "M/DD/YY h:mm:ss a";

var carouselTemp = [
  {"type": "countdown", "tripName": "Antartica", "startDate": "2014-12-26", "image": "./images/antartica.jpg", "visible": true},
  {"type": "message", "header": "Title", "message": "Yay, this is fun", "image": "", "visible": false},
  {"type": "message", "header": "Title", "message": "Yay, this is fun", "image": "", "visible": false},
];

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

  $("#gitHead").text("NYI");
  var now = moment();
  $("#startedAt").text(now.format(timeFormat));
  $("#updatedAt").text(now.format(timeFormat));

  for (var i = 0; i < carouselTemp.length; i++) {
    var item = carouselTemp[i];
    if (item.visible === true) {
      if (item.type === "message") {
        addCarouselItem(item.image, item.header, item.message);
      } else if (item.type ==="countdown") {
        addCarouselCountdown(item.image, item.startDate, item.tripName);
      }
    }
  }
  $("#castCarousel").carousel();
}

function updateTime() {
  var now = moment();
  curTimeElem.text(now.format("h:mm a"));
}

function addCarouselCountdown(img, date, tripName) {
  var item = $("<div class='item'></div>");
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
  var item = $("<div class='item'></div>");
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
