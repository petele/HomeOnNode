/*!
 *
 *  Web Starter Kit
 *  Copyright 2014 Google Inc. All rights reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License
 *
 */

var fb;
var visible = "#dStatus";
var acLRLabel, acBRLabel, acKILabel, doorFrontLabel, harmonyActivityNameLabel;
var modifierList;
var systemStateLabel, tempInsideLabel, tempOutsideLabel;
var timeStartedLabel, timeUpdatedLabel;

var buttonList, lampList, ulState, ulDoor;
var ulLights;

var labelOff = "off";
var labelOn = "ON";
var timeFormat = "M/DD/YY h:mm:ss a";

(function () {
  'use strict';

  var querySelector = document.querySelector.bind(document);

  var navdrawerContainer = querySelector('.navdrawer-container');
  var body = document.body;
  var appbarElement = querySelector('.app-bar');
  var menuBtn = querySelector('.menu');
  var main = querySelector('main');

  function closeMenu() {
    body.classList.remove('open');
    appbarElement.classList.remove('open');
    navdrawerContainer.classList.remove('open');
  }

  function toggleMenu() {
    body.classList.toggle('open');
    appbarElement.classList.toggle('open');
    navdrawerContainer.classList.toggle('open');
    navdrawerContainer.classList.add('opened');
  }

  main.addEventListener('click', closeMenu);
  menuBtn.addEventListener('click', toggleMenu);
  navdrawerContainer.addEventListener('click', function (event) {
    if (event.target.nodeName === 'A' || event.target.nodeName === 'LI') {
      var elem = event.target;
      var toShow = elem.dataset["page"];
      var title = elem.innerText;
      showPage(toShow, title);
      closeMenu();
    }
  });

  function showPage(selector, title) {
    document.querySelector("h1.logo span").innerText = title;
    document.querySelector(visible).setAttribute("hidden", "hidden");
    document.querySelector(selector).removeAttribute("hidden");
    visible = selector;
  }

  showPage("#dCommands", "Commands");
})();


function init() {
  acLRLabel = $("#acLR .itemVal");
  acBRLabel = $("#acBR .itemVal");
  acKILabel = $("#acKI .itemVal");
  doorFrontLabel = $("#doorFront .itemVal");
  harmonyActivityNameLabel = $("#harmonyActivityName .itemVal");
  systemStateLabel = $("#systemState .itemVal");
  tempInsideLabel = $("#tempInside .itemVal");
  tempOutsideLabel = $("#tempOutside .itemVal");
  timeUpdatedLabel = $("#timeUpdated .itemVal");
  timeStartedLabel = $("#timeStarted .itemVal");
  buttonList = $("#buttonList");
  lampList = {};
  ulLights = $("#ulLights");
  ulDoor = $("#ulDoor");
  ulState = $("#ulState");
  modifierList = $("#modifierSelector");
  

  fb = new Firebase("https://boiling-torch-4633.firebaseio.com/");
  fb.auth(fbKey, function(error) {
    if(error) {
      console.error("[FIREBASE] Auth failed. " + error.toString());
    } else {
      console.log("[FIREBASE] Auth success.");
    }
  });
  fb.child("config/commands").on("value", function(snapshot) {
    var val = snapshot.val();
    var k = Object.keys(val);
    buttonList.html("");
    for (var i = 0; i < k.length; i++) {
      var label = val[k[i]].label;
      if (label) {
        var but = $("<button></button>");
        but
          .attr("type", "button")
          .addClass("button--primary")
          .addClass("button--command")
          .text(label)
          .data("command", k[i])
          .on("click", commandPressed);
        buttonList.append(but);
      }
    }
  });
  fb.child("config/light_recipes").on("value", function(snapshot) {
    var val = snapshot.val();
    var k = Object.keys(val);
    modifierList.html("");
    for (var i = 0; i < k.length; i++) {
      var opt = $("<option></option>");
      opt
        .attr("value", k[i])
        .text(k[i]);
      if (k[i] === "Default") {
        opt.attr("selected", "selected");
      }
      modifierList.append(opt);
    }
  });
  fb.child("state/hue/lights").on("value", function(snapshot) {
    var val = snapshot.val();
    for (var i = 1; i < val.length; i++) {
      var lamp = val[i];
      var lampName = lamp.name;
      var lampItem = lampList[lampName];
      if (lampItem === undefined) {
        var template = "<li><div class='itemDesc'>[NAME]</div><span class='itemVal label'></span></li>";
        template = template.replace("[NAME]", lampName);
        lampItem = $(template);
        ulLights.append(lampItem);
        lampList[lampName] = lampItem;
      }
      var lampState = lampItem.find(".itemVal");
      if (lamp.state.on === true) {
        lampState.text(labelOn);
        lampState.removeClass("label-gray");
        lampState.addClass("label-blue");
      } else {
        lampState.text(labelOff);
        lampState.addClass("label-gray");
        lampState.removeClass("label-blue");
      }
    }
  });
  fb.child("logs/system_state").endAt().limit(50).on("child_added", function(snapshot) {
    var val = snapshot.val();
    var li = $("<li></li>");
    var dt = $("<div class='itemDesc'></div>");
    dt.text(moment(val.date).format("M/DD/YY h:mm:ss a"));
    var sp = $("<span class='label itemVal'></span>");
    sp.text(val.state);
    if (val.state === "HOME") {
      sp.addClass("label-green");
    } else if (val.state === "AWAY") {
      sp.addClass("label-blue");
    } else if (val.state === "ARMED") {
      sp.addClass("label-blue-secondary");
    } else if (val.state === "SLEEP") {
      sp.addClass("label-gray");
    }
    li.append(dt);
    li.append(sp);
    ulState.prepend(li);
  });
  fb.child("logs/door").endAt().limit(50).on("child_added", function(snapshot) {
    var val = snapshot.val();
    var li = $("<li></li>")
    var dt = $("<div class='itemDesc'></div>");
    dt.text(moment(val.date).format("M/DD/YY h:mm:ss a"));
    var sp = $("<span class='label itemVal'></span>");
    sp.text(val.state);
    if (val.state === "CLOSED") {
      sp.addClass("label-blue");
    } else {
      sp.addClass("label-red");
    }
    li.append(dt);
    li.append(sp);
    ulDoor.prepend(li);
  });
  fb.child("state/ac").on("value", function(snapshot) {
    var val = snapshot.val();
    if (val.LR === 0) {
      acLRLabel.text(labelOff)
        .removeClass("label-blue")
        .addClass("label-gray");
    } else {
      acLRLabel.text(val.LR)
        .addClass("label-blue")
        .removeClass("label-gray");
    }
    if (val.BR === 0) {
      acBRLabel.text(labelOff)
        .removeClass("label-blue")
        .addClass("label-gray");
    } else {
      acBRLabel.text(val.BR)
        .addClass("label-blue")
        .removeClass("label-gray");
    }
    if (val.KI === 0) {
      acKILabel.text(labelOff)
        .removeClass("label-blue")
        .addClass("label-gray");
    } else {
      acKILabel.text(val.KI)
        .addClass("label-blue")
        .removeClass("label-gray");
    }
  });
  fb.child("state/doors").on("value", function(snapshot) {
    var val = snapshot.val();
    if (val.FRONT_DOOR === "CLOSED") {
      doorFrontLabel
        .text("CLOSED")
        .removeClass("label-red")
        .addClass("label-blue");
    } else {
      doorFrontLabel
        .text("OPEN")
        .addClass("label-red")
        .removeClass("label-blue");
    }
  });
  fb.child("state/harmony_activity_name").on("value", function(snapshot) {
    var val = snapshot.val();
    if (val === "PowerOff") {
      harmonyActivityNameLabel
        .text(val)
        .addClass("label-gray")
        .removeClass("label-blue");
    } else {
      harmonyActivityNameLabel
        .text(val)
        .removeClass("label-gray")
        .addClass("label-blue");
    }
  });
  fb.child("state/system_state").on("value", function(snapshot) {
    var val = snapshot.val();
    systemStateLabel.text(val);
    val = val.replace(/\w\S*/g, function(txt){return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();})
    document.querySelector("h1.logo strong").innerText = "@" + val;
  });
  fb.child("state/temperature").on("value", function(snapshot) {
    var val = snapshot.val();
    tempInsideLabel.html(Math.round(val.inside) + "&deg;F");
    tempOutsideLabel.html(Math.round(val.outside) + "&deg;F");
  });
  fb.child("state/time").on("value", function(snapshot) {
    var val = snapshot.val();
    var tlu = moment(val.last_updated).format(timeFormat); //.fromNow();
    var ts = moment(val.started).format(timeFormat); //.fromNow();
    timeUpdatedLabel.text(tlu);
    timeStartedLabel.text(ts);
  });
}

function commandPressed(evt) {
  var buttonPressed = $(evt.target);
  var command = buttonPressed.data("command");
  var modifier = modifierList.val();
  var cmd = {
    "command": command,
    "modifier": modifier
  };
  fb.child("commands").push(cmd);
  console.log("commandPressed", cmd);
  buttonPressed.addClass("button--active");
  setTimeout(function() {
    buttonPressed.removeClass("button--active");
  }, 750);
}


init();
