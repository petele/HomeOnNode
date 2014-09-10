function KeyPadController($scope, $window, $http, $timeout) {
  $scope.visible = "none";
  $scope.modifier = null;
  $scope.modifierOffAt = 0;
  $scope.acLROn = false;
  $scope.acBROn = false;
  $scope.acKIOn = false;
  $scope.acFastCool = false;
  $scope.lightFH = false;
  $scope.lightLR = false;
  $scope.lightIK = false;
  $scope.lightKI = false;
  $scope.lightBR = false;
  $scope.lightBS = false;
  $scope.bMorn = false;
  $scope.harmony_activity = "";
  $scope.doorState = null;
  $scope.homeState = null;
  $scope.doorSpin = false;
  $scope.homeSpin = false;

  $scope.getDoorState = function() {
    $scope.doorSpin = true;
    $http.post(piController.url_base + "/door/", piController.user_key)
      .success(function (data, status, headers, config) {
        $scope.doorState = data;
        $scope.doorSpin = false;
      })
      .error(function() {
        $scope.doorSpin = false;
      });
  };

  $scope.getHomeState = function() {
    $scope.homeSpin = true;
    $http.post(piController.url_base + "/state/", piController.user_key)
      .success(function (data, status, headers, config) {
        $scope.homeState = data;
        $scope.homeSpin = false;
      })
      .error(function() {
        $scope.homeSpin = false;
      });
  };

  $scope.parseData = function(status) {
    try {
      $scope.acLROn = status["ac"]["LR"] != "Off";
      $scope.acBROn = status["ac"]["BR"] != "Off";
      $scope.acKIOn = status["ac"]["KI"] != "Off";
      if ((status["ac"]["KI"] == "65") && (status["ac"]["KI"] == "65") && (status["ac"]["KI"] == "65")) {
        $scope.acFastCool = true;
      } else {
        $scope.acFastCool = false;
      }
      $scope.door = status["door"];
      $scope.lr_temp = status["ac"]["LR"];
      $scope.br_temp = status["ac"]["BR"];
      $scope.inside_temp = status["temperature"]["inside"];
      $scope.outside_temp = status["temperature"]["outside"];
      $scope.time_started = status["time"]["start"];
      $scope.time_updated = status["time"]["updated"];
      $scope.harmony_activity = status["harmony_activity"];
      $scope.state = status["system_state"];
      $scope.lightLR = status['hue']['lights'][1]['state']['on'] &&
                       status['hue']['lights'][2]['state']['on'];
      $scope.lightBS = status['hue']['lights'][3]['state']['on'];
      $scope.lightKI = status['hue']['lights'][4]['state']['on'];
      $scope.lightBR = status['hue']['lights'][5]['state']['on'] &&
                       status['hue']['lights'][6]['state']['on'];
      $scope.lightFH = status['hue']['lights'][7]['state']['on'];
      $scope.lightIK = status['hue']['lights'][8]['state']['on'] &&
                       status['hue']['lights'][9]['state']['on'] &&
                       status['hue']['lights'][10]['state']['on'];
      $scope.bMorn = status['hue']['lights'][1]['state']['on'] &&
                     status['hue']['lights'][2]['state']['on'] &&
                     status['hue']['lights'][5]['state']['on'] &&
                     status['hue']['lights'][6]['state']['on'] &&
                     status['harmony_activity'] == "FMRadio";
      piController.status = status;
    } catch (ex) {
      console.log("Error in parseData", ex);
    }
  };

  $scope.checkTimer = function() {
    if ($scope.modifierOffAt < Date.now()) {
      $scope.modifier = null;
      $scope.modifierOffAt = 0;
    }
    $timeout($scope.checkTimer, 1000*10);
  };

  $scope.setVisible = function(item) {
    $scope.visible = item;
  };

  $scope.setModifier = function(modifier) {
    if (modifier == $scope.modifier) {
      $scope.modifier = null;
      $scope.modifierOffAt = 0;
    } else {
      $scope.modifier = modifier;
      $scope.modifierOffAt = Date.now() + (10 * 1000);
    }
  };

  $scope.pushButton = function(command) {
    var cmd = {"command": command};
    cmd["user_key"] = piController.user_key;
    cmd["user_uuid"] = piController.user_uuid;
    if ($scope.modifier !== null) {
      cmd["modifier"] = $scope.modifier;
    }
    $scope.modifier = null;
    $scope.modifierOffAt = 0;
    $http.post(piController.url_base + "/cmds/add", cmd)
      .success(function (data, status, headers, config) {
        console.log("Data sent", data);
      });
  };

  $scope.channelOpened = function() {
    console.log("Channel Connected");
  };

  $scope.channelClosed = function() {
    console.log("Channel closed");
    $scope.ready = false;
  };

  $scope.channelMessage = function(data) {
    var msg = data["data"];
    msg = JSON.parse(msg);
    $scope.parseData(msg);
  };

  $scope.parseData(piController.status);
  $scope.ready = true;
  $scope.visible = "table";
  $scope.checkTimer();
  try {
    $scope.channel = piController.appengine_channel;
    $scope.socket = $scope.channel.open();
    $scope.socket.onopen = $scope.channelOpened;
    $scope.socket.onmessage = $scope.channelMessage;
    $scope.socket.onclose = $scope.channelClosed;
  } catch (ex) {
   console.log("Error setting up channel", ex);
  }
  $scope.getDoorState();
  $scope.getHomeState();
}
