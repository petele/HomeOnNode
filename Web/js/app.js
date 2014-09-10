var fb;


function init() {
  fb = new Firebase("https://boiling-torch-4633.firebaseio.com/");
  fb.auth(fbKey, function(error) {
    if(error) {
      console.error("[FIREBASE] Auth failed. " + error.toString());
    } else {
      console.log("[FIREBASE] Auth success.");
    }
  });
  fb.child("state/ac").on("value", function(snapshot) {
    var val = snapshot.val();
    $("#acLR .itemVal").text(val.LR);
    $("#acBR .itemVal").text(val.BR);
    $("#acKI .itemVal").text(val.KI);
  });
  fb.child("state/doors").on("value", function(snapshot) {
    var val = snapshot.val();
    $("#doorFront .itemVal").text(val.FRONT_DOOR);
  });
  fb.child("state/harmony_activity_name").on("value", function(snapshot) {
    var val = snapshot.val();
    $("#harmonyActivityName .itemVal").text(val);
  });
  fb.child("state/system_state").on("value", function(snapshot) {
    var val = snapshot.val();
    $("#systemState .itemVal").text(val);
  });
  fb.child("state/temperature").on("value", function(snapshot) {
    var val = snapshot.val();
    $("#tempInside .itemVal").html(val.inside + "&deg;F");
    $("#tempOutside .itemVal").html(val.outside + "&deg;F");
  });
  fb.child("state/time").on("value", function(snapshot) {
    var val = snapshot.val();
    $("#timeUpdated .itemVal").text(moment(val.last_updated).format("L LT"));
    $("#timeStarted .itemVal").text(moment(val.started).format("L LT"));
  });
  fb.child("state/hue/lights").on("value", function(snapshot) {
    var val = snapshot.val();
    if (val.length - 1 != $("#lightList").children().length) {
      $("#lightList").html("");
      for (var i = 1; i < val.length; i++) {
        var l = "<li><div class='itemDesc'>[NAME]</div><span class='itemVal label [LABEL_VAL]'>[VAL]</span></li>";
        l = l.replace("[NAME]", val[i].name);
        l = l.replace("[VAL]", val[i].state.on);
        if (val[i].state.on === true) {
          l = l.replace("[LABEL_VAL]", "label-primary");
        } else {
          l = l.replace("[LABEL_VAL]", "label-default");
        }
        var item = $(l);
        $("#lightList").append(item);
      }
    } else {
      var items = $("#lightList li");
      for (var i = 1; i < val.length; i++) {
        var item = items[i-1];
        item = $(item);
        item.find(".itemVal")
          .removeClass("label-danger")
          .removeClass("label-success")
          .text(val[i].state.on);
        if (val[i].state.on === true) {
          item.find(".itemVal").addClass("label-success");
        } else {
          item.find(".itemVal").addClass("label-danger");
        }
      }
    }
  });
  fb.child("config/commands").on("value", function(snapshot) {
    var val = snapshot.val();
    var k = Object.keys(val);
    $("#pnlBut").html("");
    for (var i = 0; i < k.length; i++) {
      var label = val[k[i]].label;
      if (label) {
        var but = $("<button></button>");
        but
          .attr("type", "button")
          .addClass("btn")
          .addClass("btn-default")
          .text(label)
          .on("click", function(a,b,c) {
            console.log("CLICK", this, a, b, c);
          });
        $("#pnlBut").append(but);
      }
    }
  });
  fb.child("logs/system_state").endAt().limit(25).on("child_added", function(snapshot) {
    var val = snapshot.val();
    var li = $("<li></li>")
    var dt = $("<div class='itemDesc'></div>");
    dt.text(moment(val.date).format("L LT"));
    var sp = $("<span class='label'></span>");
    sp.text(val.state);
    if (val.state === "HOME") {
      sp.addClass("label-success");
    } else if (val.state === "AWAY") {
      sp.addClass("label-primary");
    } else if (val.state === "ARMED") {
      sp.addClass("label-info");
    } else if (val.state === "SLEEP") {
      sp.addClass("label-default");
    }
    li.append(dt);
    li.append(sp);
    $("#stateList").prepend(li);
  });
  fb.child("logs/door").endAt().limit(25).on("child_added", function(snapshot) {
    var val = snapshot.val();
    var li = $("<li></li>")
    var dt = $("<div class='itemDesc'></div>");
    dt.text(moment(val.date).format("L LT"));
    var sp = $("<span class='label'></span>");
    sp.text(val.state);
    if (val.state === "CLOSED") {
      sp.addClass("label-primary");
    } else {
      sp.addClass("label-danger");
    }
    li.append(dt);
    li.append(sp);
    $("#doorList").prepend(li);
  });

}

$("document").ready(function() {
  init();
});
