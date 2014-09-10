var fb;
var curTimeElem;
var carousels;
var carouselIndicators;


function addCarousel(heading, body, imgSrc) {


  var msg = "<h1>[HEADING]</h1><p>[BODY]</p>";
  msg = msg.replace("[HEADING]", heading);
  msg = msg.replace("[BODY]", body);
  var content = $("<div class='carousel-caption'></div>");
  content.html(msg);
  var container = $("<div class='container'></div>");
  container.append(content);
  var item = $("<div class='item'></div>");
  if (imgSrc) {
    var img = $("<img>");
    img.attr("src", imgSrc);
    item.append(img);
  }
  item.append(container);

  var indicator = $("<li></li>")
    .attr("data-target", "#myCarousel")
    .attr("data-slide-to", carousels.children().length);

  if (carousels.children().length === 0) {
    item.addClass("active");
  }
  carousels.append(item);
  carouselIndicators.append(indicator);
}






function init() {
  curTimeElem = $("#curTime");
  carousels = $(".carousel-inner");
  carouselIndicators = $(".carousel-indicators");

  var weatherRef = new Firebase('https://publicdata-weather.firebaseio.com/newyork');
  weatherRef.child('currently').on('value', function(snapshot) {
    snapshot = snapshot.val();
    $("#tempNow").html(Math.round(snapshot.temperature) + "&deg;F");
    var icon = snapshot.icon;
    icon = icon.replace("-day", "");
    icon = icon.replace("-night", "");
    $("#tempIcon").attr("src", "./images/" + snapshot.icon + ".png");
  });
  weatherRef.child('daily/data/0').on('value', function(snapshot) {
    snapshot = snapshot.val();
    $("#tempHigh").html("<b>High</b> " + snapshot.temperatureMax);
    $("#tempLow").html("<b>Low</b> " + snapshot.temperatureMin);
    $("#tempRain").html("<b>Rain</b> " + snapshot.precipProbability * 100 + "%");
    $("#tempWind").html("<b>Wind</b> " + snapshot.windSpeed);
    $("#tempSummary").html(snapshot.summary);
  });


  setInterval(function() {
    var now = moment();
    var tripStart = moment("2014-12-26");
    var duration = Math.floor(moment.duration(tripStart - now).as("days"));
    $("#daysToAntartica").text(duration);
    curTimeElem.text(now.format("h:mm a"));
  }, 1000);
}

$("document").ready(function() {

  init();
});
